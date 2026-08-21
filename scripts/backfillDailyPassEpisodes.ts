// 일회성 실행용: "기다리면 무료"(dailyPass) 작품에서 chargeFolderArticleList를 놓쳐 최근 회차가
// 통째로 누락되던 버그(lib/naver.ts fetchAllEpisodes) 수정 후, 기존에 이미 활성 상태인 작품들의
// 회차 목록을 다시 긁어서 누락분을 채운다. 원래 매일 밤 collect.ts가 전체 작품을 다시 돌긴 하지만
// 그건 무료회차 전체(수십만 건)의 댓글수까지 매번 다시 긁어서 여기서 그대로 재실행하기엔 너무
// 오래 걸리므로, 이 스크립트는 회차 목록만 전부 다시 받아서 "새로 발견된(원래 DB에 없던) 회차"의
// 댓글수만 추가로 긁는다 - 기존에 이미 추적 중이던 회차는 오늘 밤 정기 수집기가 알아서 갱신함.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import pLimit from "p-limit";
import { fetchAllEpisodes, fetchCommentStats } from "../lib/naver";
import { getSupabaseAdmin } from "../lib/supabase";

function getKstDateString(): string {
  const now = new Date();
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, "0");
  const d = String(kst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseServiceDate(desc: string): string | null {
  const match = desc.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!match) return null;
  const [, yy, mm, dd] = match;
  return `20${yy}-${mm}-${dd}`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function dedupeBy<T>(arr: T[], keyFn: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of arr) map.set(keyFn(item), item);
  return [...map.values()];
}

async function main() {
  const supabase = getSupabaseAdmin();
  const snapshotDate = getKstDateString();

  console.log("활성 비성인 작품 목록 조회...");
  const titles: { title_id: number; title_name: string }[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("titles")
      .select("title_id,title_name")
      .eq("is_active", true)
      .eq("is_adult", false)
      .order("title_id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    titles.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`대상 ${titles.length}개 작품`);

  const episodeLimit = pLimit(10);
  let episodeFailures = 0;
  let titlesWithNewEpisodes = 0;
  const newFreeEpisodes: { titleId: number; titleName: string; no: number }[] = [];
  let processed = 0;

  await Promise.all(
    titles.map((title) =>
      episodeLimit(async () => {
        try {
          const [episodes, { data: existing }] = await Promise.all([
            fetchAllEpisodes(title.title_id),
            supabase.from("episodes").select("no").eq("title_id", title.title_id),
          ]);
          const existingNos = new Set((existing ?? []).map((e) => e.no));

          const episodeRows = dedupeBy(
            episodes.map((e) => ({
              title_id: title.title_id,
              no: e.no,
              subtitle: e.subtitle,
              service_date: parseServiceDate(e.serviceDateDescription),
              is_free: !e.charge,
            })),
            (r) => String(r.no)
          );
          for (const batch of chunk(episodeRows, 500)) {
            const { error } = await supabase.from("episodes").upsert(batch, { onConflict: "title_id,no" });
            if (error) console.error(`  episodes upsert 실패 (${title.title_name}):`, error.message);
          }

          const newOnes = episodeRows.filter((e) => e.is_free && !existingNos.has(e.no));
          if (newOnes.length > 0) {
            titlesWithNewEpisodes++;
            console.log(`  신규 회차 발견: ${title.title_name} (${newOnes.length}화)`);
          }
          for (const e of newOnes) {
            newFreeEpisodes.push({ titleId: title.title_id, titleName: title.title_name, no: e.no });
          }
        } catch (err) {
          episodeFailures++;
          console.error(`  회차 조회 실패 (${title.title_name}):`, err);
        } finally {
          processed++;
          if (processed % 500 === 0) console.log(`  진행: ${processed}/${titles.length}`);
        }
      })
    )
  );

  console.log(
    `회차 재조회 완료 (실패 ${episodeFailures}건). 신규 회차 발견 작품 ${titlesWithNewEpisodes}개, ` +
      `신규 무료회차 ${newFreeEpisodes.length}개 - 댓글수 수집 시작...`
  );

  const commentLimit = pLimit(15);
  let commentFailures = 0;
  const snapshots: {
    title_id: number;
    no: number;
    snapshot_date: string;
    comment_count: number;
    post_count: number;
  }[] = [];

  await Promise.all(
    newFreeEpisodes.map((ep) =>
      commentLimit(async () => {
        try {
          const stats = await fetchCommentStats(ep.titleId, ep.no);
          snapshots.push({
            title_id: ep.titleId,
            no: ep.no,
            snapshot_date: snapshotDate,
            comment_count: stats.commentCount,
            post_count: stats.postCount,
          });
        } catch (err) {
          commentFailures++;
          console.error(`  댓글수 조회 실패 (titleId=${ep.titleId}, ${ep.no}화):`, err);
        }
      })
    )
  );

  for (const batch of chunk(snapshots, 500)) {
    const { error } = await supabase
      .from("comment_snapshots")
      .upsert(batch, { onConflict: "title_id,no,snapshot_date" });
    if (error) console.error("  comment_snapshots upsert 실패:", error.message);
  }

  console.log(`완료: 신규 회차 댓글 스냅샷 ${snapshots.length}건 저장 (실패 ${commentFailures}건)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
