// 일일 수집기: 연재중인 작품의 무료회차 댓글수를 수집해 Supabase에 저장한다.
// 사용법:
//   npx tsx scripts/collect.ts                 # 전체 수집 (SUPABASE_URL/SERVICE_ROLE_KEY 필요)
//   TITLE_LIMIT=5 npx tsx scripts/collect.ts    # 작품 5개만 수집 (DB 미설정시 드라이런으로 콘솔 출력만)
import { config as loadEnv } from "dotenv";
import pLimit from "p-limit";

// 로컬 개발 시 .env.local을 우선 사용 (Next.js 관례). GitHub Actions 등 CI에서는 파일이 없어도 무시됨.
loadEnv({ path: ".env.local" });
loadEnv();
import {
  fetchAllOngoingTitles,
  fetchAllEpisodes,
  fetchCommentStats,
  fetchWeekdayRankMap,
  fetchSeriesDownloadCount,
  fetchRealtimeRanking,
  type RealtimeRankCategory,
} from "../lib/naver";
import { SERIES_WATCHLIST } from "../lib/seriesWatchlist";

function getKstDateString(): string {
  const now = new Date();
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, "0");
  const d = String(kst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseServiceDate(desc: string): string | null {
  // "26.08.09" -> "2026-08-09"
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

// 네이버 API가 같은 회차 번호(no)를 중복으로 내려주는 경우가 있어 upsert 전 제거 필요
// (그대로 두면 "ON CONFLICT DO UPDATE command cannot affect row a second time"로 배치 전체가 실패함)
function dedupeBy<T>(arr: T[], keyFn: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of arr) map.set(keyFn(item), item);
  return [...map.values()];
}

async function main() {
  const startedAt = Date.now();
  const titleLimit = process.env.TITLE_LIMIT ? parseInt(process.env.TITLE_LIMIT, 10) : undefined;
  const hasDb = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const snapshotDate = getKstDateString();

  console.log(`[1/7] 연재중인 작품 목록 조회...`);
  const allTitles = await fetchAllOngoingTitles();
  const titles = titleLimit ? allTitles.slice(0, titleLimit) : allTitles;
  console.log(
    `  전체 연재작 ${allTitles.length}개 중 ${titles.length}개 처리 대상${titleLimit ? " (TITLE_LIMIT 적용)" : ""}`
  );

  let supabase: ReturnType<typeof import("../lib/supabase").getSupabaseAdmin> | null = null;
  if (hasDb) {
    const { getSupabaseAdmin } = await import("../lib/supabase");
    supabase = getSupabaseAdmin();

    const nowIso = new Date().toISOString();
    const titleRows = titles.map((t) => ({
      title_id: t.titleId,
      title_name: t.titleName,
      author: t.author,
      thumbnail_url: t.thumbnailUrl,
      is_active: true,
      is_finished: t.finish,
      is_on_hiatus: t.rest,
      last_seen_at: nowIso,
    }));
    for (const batch of chunk(titleRows, 500)) {
      const { error } = await supabase.from("titles").upsert(batch, { onConflict: "title_id" });
      if (error) console.error("  titles upsert 실패:", error.message);
    }

    // TITLE_LIMIT으로 일부만 처리한 경우, 나머지 전체를 비활성 처리해버리는 사고를 방지
    if (!titleLimit) {
      const currentIds = titles.map((t) => t.titleId);
      const { error: deactivateError } = await supabase
        .from("titles")
        .update({ is_active: false })
        .eq("is_active", true)
        .not("title_id", "in", `(${currentIds.join(",") || 0})`);
      if (deactivateError) console.error("  titles 비활성화 실패:", deactivateError.message);
    }
  } else {
    console.log("  (SUPABASE_URL/SERVICE_ROLE_KEY 미설정 - 드라이런 모드, DB에 쓰지 않음)");
  }

  console.log(`[2/7] 평점/요일별 랭킹(인기순·별점순·조회순) 조회...`);
  // 매일+(dailyPlus) 작품은 이 랭킹 API에 없어 rank가 비어있을 수 있음 (star_score는 titles에서 그대로 나옴)
  const [popularityRanks, ratingRanks, viewRanks] = await Promise.all([
    fetchWeekdayRankMap("user"),
    fetchWeekdayRankMap("star"),
    fetchWeekdayRankMap("view"),
  ]);
  if (supabase) {
    const titleSnapshotRows = titles.map((t) => {
      const rankInfo = popularityRanks.get(t.titleId) ?? ratingRanks.get(t.titleId) ?? viewRanks.get(t.titleId);
      return {
        title_id: t.titleId,
        snapshot_date: snapshotDate,
        star_score: t.starScore,
        weekday: rankInfo?.weekday ?? null,
        popularity_rank: popularityRanks.get(t.titleId)?.rank ?? null,
        rating_rank: ratingRanks.get(t.titleId)?.rank ?? null,
        view_rank: viewRanks.get(t.titleId)?.rank ?? null,
      };
    });
    for (const batch of chunk(titleSnapshotRows, 500)) {
      const { error } = await supabase
        .from("title_snapshots")
        .upsert(batch, { onConflict: "title_id,snapshot_date" });
      if (error) console.error("  title_snapshots upsert 실패:", error.message);
    }
    console.log(`  title_snapshots ${titleSnapshotRows.length}건 저장 완료`);
  }

  console.log(`[3/7] 실시간 랭킹(전체/남성/여성 TOP5) 조회...`);
  const realtimeRanking = await fetchRealtimeRanking();
  if (supabase) {
    const realtimeRows = (Object.entries(realtimeRanking) as [RealtimeRankCategory, { rank: number; titleId: number }[]][]).flatMap(
      ([category, items]) =>
        items.map((item) => ({
          category,
          rank: item.rank,
          title_id: item.titleId,
          snapshot_date: snapshotDate,
        }))
    );
    const { error } = await supabase
      .from("realtime_ranking_snapshots")
      .upsert(realtimeRows, { onConflict: "category,rank,snapshot_date" });
    if (error) console.error("  realtime_ranking_snapshots upsert 실패:", error.message);
    console.log(`  realtime_ranking_snapshots ${realtimeRows.length}건 저장 완료`);
  }

  console.log(`[4/7] 작품별 회차 목록 조회 및 무료회차 판별...`);
  const episodeLimit = pLimit(5);
  const freeEpisodes: { titleId: number; titleName: string; no: number }[] = [];
  let totalEpisodeCount = 0;
  let episodeFetchFailures = 0;

  await Promise.all(
    titles.map((title) =>
      episodeLimit(async () => {
        try {
          const episodes = await fetchAllEpisodes(title.titleId);
          totalEpisodeCount += episodes.length;

          if (supabase) {
            const episodeRows = dedupeBy(
              episodes.map((e) => ({
                title_id: title.titleId,
                no: e.no,
                subtitle: e.subtitle,
                service_date: parseServiceDate(e.serviceDateDescription),
                is_free: !e.charge,
              })),
              (r) => String(r.no)
            );
            for (const batch of chunk(episodeRows, 500)) {
              const { error } = await supabase.from("episodes").upsert(batch, {
                onConflict: "title_id,no",
              });
              if (error) console.error(`  episodes upsert 실패 (${title.titleId}):`, error.message);
            }
          }

          for (const e of episodes) {
            if (!e.charge) {
              freeEpisodes.push({ titleId: title.titleId, titleName: title.titleName, no: e.no });
            }
          }
        } catch (err) {
          episodeFetchFailures++;
          console.error(`  회차 목록 조회 실패 (titleId=${title.titleId}, ${title.titleName}):`, err);
        }
      })
    )
  );
  const dedupedFreeEpisodes = dedupeBy(freeEpisodes, (e) => `${e.titleId}_${e.no}`);
  console.log(
    `  전체 회차 ${totalEpisodeCount}개 중 무료회차 ${dedupedFreeEpisodes.length}개 ` +
      `(중복 ${freeEpisodes.length - dedupedFreeEpisodes.length}건 제거, 회차조회 실패 ${episodeFetchFailures}건)`
  );

  console.log(`[5/7] 무료회차 댓글수 수집...`);
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
    dedupedFreeEpisodes.map((ep) =>
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
          console.error(`  댓글수 조회 실패 (titleId=${ep.titleId}, no=${ep.no}):`, err);
        }
      })
    )
  );
  const dedupedSnapshots = dedupeBy(snapshots, (s) => `${s.title_id}_${s.no}`);
  console.log(`  댓글수 수집 완료: 성공 ${dedupedSnapshots.length}건, 실패 ${commentFailures}건`);

  console.log(`[6/7] 결과 저장...`);
  if (supabase) {
    for (const batch of chunk(dedupedSnapshots, 500)) {
      const { error } = await supabase
        .from("comment_snapshots")
        .upsert(batch, { onConflict: "title_id,no,snapshot_date" });
      if (error) console.error("  comment_snapshots upsert 실패:", error.message);
    }
    console.log(`  Supabase에 ${dedupedSnapshots.length}건 저장 완료`);
  } else {
    console.log("  드라이런 모드 - 샘플 20건 출력:");
    const byComment = [...dedupedSnapshots].sort((a, b) => b.comment_count - a.comment_count);
    for (const s of byComment.slice(0, 20)) {
      const title = dedupedFreeEpisodes.find((e) => e.titleId === s.title_id && e.no === s.no);
      console.log(
        `    ${title?.titleName ?? s.title_id} ${s.no}화 - 댓글 ${s.comment_count}개 (전체 ${s.post_count}개)`
      );
    }
  }

  console.log(`[7/7] 네이버 시리즈 다운로드수 수집 (우선 추적 5개 + 매칭된 전체)...`);
  const seriesTargets = new Map<number, { titleId: number; name: string }>();
  for (const item of SERIES_WATCHLIST) {
    seriesTargets.set(item.productNo, { titleId: item.titleId, name: item.name });
  }
  if (supabase) {
    const { data: products } = await supabase.from("series_products").select("product_no,title_id,series_title_name");
    for (const p of products ?? []) {
      if (!seriesTargets.has(p.product_no)) {
        seriesTargets.set(p.product_no, { titleId: p.title_id, name: p.series_title_name });
      }
    }
  }
  console.log(`  대상 ${seriesTargets.size}개`);

  let seriesFailures = 0;
  const seriesRows: { product_no: number; title_id: number; snapshot_date: string; download_count: number }[] = [];
  const seriesLimit = pLimit(6);
  await Promise.all(
    [...seriesTargets.entries()].map(([productNo, item]) =>
      seriesLimit(async () => {
        try {
          const downloadCount = await fetchSeriesDownloadCount(productNo);
          seriesRows.push({
            product_no: productNo,
            title_id: item.titleId,
            snapshot_date: snapshotDate,
            download_count: downloadCount,
          });
        } catch (err) {
          seriesFailures++;
          console.error(`  시리즈 다운로드수 조회 실패 (${item.name}, productNo=${productNo}):`, err);
        }
      })
    )
  );
  console.log(`  성공 ${seriesRows.length}건 / 실패 ${seriesFailures}건`);
  if (supabase && seriesRows.length > 0) {
    for (let i = 0; i < seriesRows.length; i += 500) {
      const batch = seriesRows.slice(i, i + 500);
      const { error } = await supabase
        .from("series_snapshots")
        .upsert(batch, { onConflict: "product_no,snapshot_date" });
      if (error) console.error("  series_snapshots upsert 실패:", error.message);
    }
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `\n완료: 작품 ${titles.length}개, 회차 ${totalEpisodeCount}개, 무료회차 ${dedupedFreeEpisodes.length}개, ` +
      `댓글수집 성공 ${dedupedSnapshots.length}건 / 실패 ${commentFailures}건, ` +
      `시리즈 다운로드수 성공 ${seriesRows.length}건 / 실패 ${seriesFailures}건, 소요시간 ${elapsedSec}초`
  );
}

main().catch((err) => {
  console.error("수집기 실행 중 오류:", err);
  process.exit(1);
});
