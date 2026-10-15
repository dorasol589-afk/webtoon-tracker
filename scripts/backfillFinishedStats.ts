// 일회성 스크립트: 기존 완결작 전체의 (1) 완결일(finished_at) (2) 네이버 시리즈 다운로드수 (3) 총댓글수를 "현재 시점"으로 채운다.
// 완결 후 90일 이내인 작품은 이후 일일 수집기가 계속 이어서 추적하고, 그보다 오래된 작품은 이 1회로 끝(one_time).
// 중간에 끊겨도 다시 실행하면 이어서 한다(오늘자 댓글 스냅샷이 이미 있는 작품은 다시 안 가져옴).
// 사용법: npx tsx scripts/backfillFinishedStats.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import pLimit from "p-limit";
import { getSupabaseAdmin } from "../lib/supabase";
import { fetchCommentStats, fetchSeriesDownloadCount, findMatchingSeriesProduct } from "../lib/naver";

const FINISHED_TRACK_DAYS = 90;

function kstToday(): string {
  const kst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  return `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, "0")}-${String(kst.getDate()).padStart(2, "0")}`;
}
function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface FinishedTitle {
  title_id: number;
  title_name: string;
  finished_at: string | null;
  series_match_checked_at: string | null;
}

async function main() {
  const supabase = getSupabaseAdmin();
  const today = kstToday();
  const cutoff = shift(today, -FINISHED_TRACK_DAYS);

  const titles: FinishedTitle[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("titles")
      .select("title_id,title_name,finished_at,series_match_checked_at")
      .eq("is_finished", true)
      .order("title_id")
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    titles.push(...(data as FinishedTitle[]));
    if (data.length < 1000) break;
  }
  console.log(`완결작 ${titles.length}개 (오늘 ${today}, 90일 추적 기준일 ${cutoff})`);

  // 1) 완결일: 마지막 회차 서비스일(회차 날짜를 못 구하는 성인작 등은 비워둠 - 추적 대상 아님)
  const dateLimit = pLimit(10);
  let dateFilled = 0;
  await Promise.all(
    titles
      .filter((t) => !t.finished_at)
      .map((t) =>
        dateLimit(async () => {
          const { data } = await supabase
            .from("episodes")
            .select("service_date")
            .eq("title_id", t.title_id)
            .not("service_date", "is", null)
            .order("service_date", { ascending: false })
            .limit(1);
          const last = data?.[0]?.service_date as string | undefined;
          if (!last) return;
          const { error } = await supabase.from("titles").update({ finished_at: last }).eq("title_id", t.title_id);
          if (!error) {
            t.finished_at = last;
            dateFilled++;
          }
        })
      )
  );
  const inWindow = titles.filter((t) => t.finished_at && t.finished_at >= cutoff);
  console.log(`[1] 완결일 채움 ${dateFilled}개 / 완결 후 90일 이내(일일 수집 계속) ${inWindow.length}개`);

  // 2) 시리즈 매칭(아직 시도 안 한 작품만) + 현재 다운로드수 1회 저장
  const toMatch = titles.filter((t) => !t.series_match_checked_at);
  console.log(`[2] 시리즈 매칭 시도 ${toMatch.length}개...`);
  const matchLimit = pLimit(4);
  let matched = 0;
  let matchDone = 0;
  await Promise.all(
    toMatch.map((t) =>
      matchLimit(async () => {
        try {
          const match = await findMatchingSeriesProduct(t.title_name);
          if (match) {
            const oneTime = !(t.finished_at && t.finished_at >= cutoff);
            const { error } = await supabase
              .from("series_products")
              .upsert(
                { product_no: match.productNo, title_id: t.title_id, series_title_name: match.seriesTitle, one_time: oneTime },
                { onConflict: "product_no" }
              );
            if (error) console.error(`  series_products 저장 실패 (${t.title_name}):`, error.message);
            else matched++;
          }
          await supabase.from("titles").update({ series_match_checked_at: new Date().toISOString() }).eq("title_id", t.title_id);
        } catch (err) {
          console.error(`  매칭 실패 (${t.title_name}):`, err instanceof Error ? err.message : err);
        } finally {
          matchDone++;
          if (matchDone % 200 === 0) console.log(`  매칭 진행 ${matchDone}/${toMatch.length} (매칭됨 ${matched})`);
        }
      })
    )
  );
  console.log(`  신규 매칭 ${matched}개`);

  const finishedIds = titles.map((t) => t.title_id);
  const products: { product_no: number; title_id: number }[] = [];
  for (const batch of chunk(finishedIds, 200)) {
    const { data } = await supabase.from("series_products").select("product_no,title_id").in("title_id", batch);
    products.push(...((data ?? []) as { product_no: number; title_id: number }[]));
  }
  console.log(`  다운로드수 조회 대상 ${products.length}개`);
  const dlLimit = pLimit(6);
  const dlRows: { product_no: number; title_id: number; snapshot_date: string; download_count: number }[] = [];
  let dlFail = 0;
  await Promise.all(
    products.map((p) =>
      dlLimit(async () => {
        try {
          const downloadCount = await fetchSeriesDownloadCount(p.product_no);
          dlRows.push({ product_no: p.product_no, title_id: p.title_id, snapshot_date: today, download_count: downloadCount });
        } catch {
          dlFail++;
        }
      })
    )
  );
  for (const batch of chunk(dlRows, 500)) {
    const { error } = await supabase.from("series_snapshots").upsert(batch, { onConflict: "product_no,snapshot_date" });
    if (error) console.error("  series_snapshots upsert 실패:", error.message);
  }
  console.log(`[2] 다운로드수 저장 ${dlRows.length}건 (실패 ${dlFail}건)`);

  // 3) 댓글수: 작품별 무료회차 전체를 현재 시점으로 1회 수집해 comment_snapshots(오늘자)에 저장하고,
  //    합계를 titles.final_comment_total에 남긴다(목록/상세는 최신 날짜 합산이라 완결작은 이 값으로 대체 표시).
  console.log(`[3] 댓글수 수집 시작 (작품 ${titles.length}개)...`);
  const commentLimit = pLimit(20);
  const titleLimit = pLimit(6);
  let titlesDone = 0;
  let requests = 0;
  let failures = 0;
  const startedAt = Date.now();
  await Promise.all(
    titles.map((t) =>
      titleLimit(async () => {
        try {
          // 이미 오늘자 스냅샷이 있으면(이어서 실행 / 일일 수집이 이미 쌓은 경우) 다시 가져오지 않고 합계만 계산
          const existing: number[] = [];
          for (let from = 0; ; from += 1000) {
            const { data } = await supabase
              .from("comment_snapshots")
              .select("comment_count")
              .eq("title_id", t.title_id)
              .eq("snapshot_date", today)
              .range(from, from + 999);
            if (!data || data.length === 0) break;
            existing.push(...data.map((r) => r.comment_count as number));
            if (data.length < 1000) break;
          }
          let total: number;
          if (existing.length > 0) {
            total = existing.reduce((a, b) => a + b, 0);
          } else {
            const episodes: { no: number }[] = [];
            for (let from = 0; ; from += 1000) {
              const { data } = await supabase
                .from("episodes")
                .select("no")
                .eq("title_id", t.title_id)
                .eq("is_free", true)
                .order("no")
                .range(from, from + 999);
              if (!data || data.length === 0) break;
              episodes.push(...(data as { no: number }[]));
              if (data.length < 1000) break;
            }
            const results = await Promise.all(
              episodes.map((e) =>
                commentLimit(async () => {
                  try {
                    requests++;
                    const stats = await fetchCommentStats(t.title_id, e.no);
                    return {
                      title_id: t.title_id,
                      no: e.no,
                      snapshot_date: today,
                      comment_count: stats.commentCount,
                      post_count: stats.postCount,
                    };
                  } catch {
                    failures++;
                    return null;
                  }
                })
              )
            );
            const rows = results.filter((r): r is NonNullable<typeof r> => r !== null);
            for (const batch of chunk(rows, 500)) {
              const { error } = await supabase
                .from("comment_snapshots")
                .upsert(batch, { onConflict: "title_id,no,snapshot_date" });
              if (error) console.error(`  comment_snapshots 저장 실패 (${t.title_name}):`, error.message);
            }
            total = rows.reduce((a, r) => a + r.comment_count, 0);
            if (rows.length === 0) return; // 회차가 없거나 전부 실패 - 0으로 덮어쓰지 않음
          }
          await supabase.from("titles").update({ final_comment_total: total }).eq("title_id", t.title_id);
        } catch (err) {
          console.error(`  댓글 수집 실패 (${t.title_name}):`, err instanceof Error ? err.message : err);
        } finally {
          titlesDone++;
          if (titlesDone % 50 === 0) {
            const min = ((Date.now() - startedAt) / 60000).toFixed(1);
            console.log(`  진행 ${titlesDone}/${titles.length}작품, 요청 ${requests}건, 실패 ${failures}건, ${min}분 경과`);
          }
        }
      })
    )
  );
  console.log(`[3] 댓글수 완료: 요청 ${requests}건, 실패 ${failures}건`);
  console.log("완료");
}

main().catch((err) => {
  console.error("실행 중 오류:", err);
  process.exit(1);
});
