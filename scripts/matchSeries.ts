// 일회성 백필 스크립트: comic.naver.com의 연재작들을 네이버 시리즈(series.naver.com) 작품과
// 이름으로 검색해 매칭한다. 확신 있는 매칭만 series_products 테이블에 저장하고,
// 애매한 건 검토용 엑셀로 뽑는다. 매일 새로 올라오는 신작은 scripts/collect.ts가
// series_match_checked_at을 보고 자동으로 매칭을 시도하므로, 이 스크립트는 그 자동화가
// 놓친(과거에 실패했던) 작품을 다시 훑고 싶을 때만 수동으로 돌리면 된다.
// 사용법: npx tsx scripts/matchSeries.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import pLimit from "p-limit";
import { getSupabaseAdmin } from "../lib/supabase";
import { fetchSeriesDownloadCount, findMatchingSeriesProduct } from "../lib/naver";

interface MatchResult {
  titleId: number;
  titleName: string;
  status: "matched" | "no_candidate_or_mismatch" | "error";
  productNo?: number;
  seriesTitle?: string;
  error?: string;
}

async function main() {
  const supabase = getSupabaseAdmin();

  const titles: { title_id: number; title_name: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("titles")
      .select("title_id,title_name")
      .eq("is_active", true)
      .eq("is_finished", false)
      .is("series_match_checked_at", null)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    titles.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`대상 작품(미확인): ${titles.length}개`);

  const limit = pLimit(4);
  const results: MatchResult[] = [];
  let done = 0;

  await Promise.all(
    titles.map((t) =>
      limit(async () => {
        try {
          const match = await findMatchingSeriesProduct(t.title_name);
          if (match) {
            results.push({
              titleId: t.title_id,
              titleName: t.title_name,
              status: "matched",
              productNo: match.productNo,
              seriesTitle: match.seriesTitle,
            });
          } else {
            results.push({ titleId: t.title_id, titleName: t.title_name, status: "no_candidate_or_mismatch" });
          }
        } catch (err) {
          results.push({ titleId: t.title_id, titleName: t.title_name, status: "error", error: String(err) });
        } finally {
          done++;
          if (done % 50 === 0) console.log(`  진행: ${done}/${titles.length}`);
        }
      })
    )
  );

  const matched = results.filter((r) => r.status === "matched");
  const noMatch = results.filter((r) => r.status === "no_candidate_or_mismatch");
  const errored = results.filter((r) => r.status === "error");
  console.log(`매칭 성공: ${matched.length}개, 매칭 안 됨: ${noMatch.length}개, 조회 실패: ${errored.length}개`);

  if (matched.length > 0) {
    const productRows = matched.map((m) => ({
      product_no: m.productNo!,
      title_id: m.titleId,
      series_title_name: m.seriesTitle!,
    }));
    const { error: insertError } = await supabase.from("series_products").upsert(productRows, {
      onConflict: "product_no",
    });
    if (insertError) console.error("series_products 저장 실패:", insertError.message);

    console.log("매칭된 작품들의 초기 다운로드수 수집...");
    const dlLimit = pLimit(10);
    const now = new Date();
    const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const snapshotDate = `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, "0")}-${String(
      kst.getDate()
    ).padStart(2, "0")}`;
    const snapshotRows: { product_no: number; title_id: number; snapshot_date: string; download_count: number }[] =
      [];
    await Promise.all(
      matched.map((m) =>
        dlLimit(async () => {
          try {
            const count = await fetchSeriesDownloadCount(m.productNo!);
            snapshotRows.push({
              product_no: m.productNo!,
              title_id: m.titleId,
              snapshot_date: snapshotDate,
              download_count: count,
            });
          } catch (err) {
            console.error(`  다운로드수 조회 실패 (${m.titleName}):`, err);
          }
        })
      )
    );
    for (let i = 0; i < snapshotRows.length; i += 500) {
      const batch = snapshotRows.slice(i, i + 500);
      const { error } = await supabase
        .from("series_snapshots")
        .upsert(batch, { onConflict: "product_no,snapshot_date" });
      if (error) console.error("series_snapshots 저장 실패:", error.message);
    }
    console.log(`다운로드수 ${snapshotRows.length}건 저장 완료`);
  }

  // 매칭 성공/실패(no_candidate_or_mismatch) 둘 다 "시도했음"으로 표시해서 매일 밤 자동 매칭이
  // 이미 결론 난 작품을 반복해서 재시도하지 않게 함. 네트워크 오류(error)는 표시하지 않고 남겨서
  // 다음 실행(수동이든 자동이든) 때 다시 시도되게 함.
  const checkedIds = [...matched, ...noMatch].map((r) => r.titleId);
  for (let i = 0; i < checkedIds.length; i += 500) {
    const batch = checkedIds.slice(i, i + 500);
    const { error } = await supabase
      .from("titles")
      .update({ series_match_checked_at: new Date().toISOString() })
      .in("title_id", batch);
    if (error) console.error("series_match_checked_at 갱신 실패:", error.message);
  }

  const fs = await import("fs");
  fs.writeFileSync("series_match_no_match.json", JSON.stringify(noMatch, null, 2));
  fs.writeFileSync("series_match_matched.json", JSON.stringify(matched, null, 2));
  console.log("완료. 매칭 안 된 목록: series_match_no_match.json");
}

main().catch((err) => {
  console.error("매칭 실행 중 오류:", err);
  process.exit(1);
});
