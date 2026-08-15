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
  fetchAllFinishedTitles,
  fetchAllEpisodes,
  fetchCommentStats,
  fetchWeekdayRankMap,
  fetchSeriesDownloadCount,
  findMatchingSeriesProduct,
  fetchRealtimeRanking,
  findLastEpisodeNoViaComments,
  fetchTitleInfo,
  type RealtimeRankCategory,
} from "../lib/naver";
import { SERIES_WATCHLIST } from "../lib/seriesWatchlist";
import { fetchSaraminJobs, fetchJobKoreaJobs, findAmbiguousJobKoreaPostings, type JobPosting } from "../lib/recruit";

function getKstDateString(): string {
  const now = new Date();
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, "0");
  const d = String(kst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// 오늘 KST 기준 hour:minute 시각을 실제 epoch ms로 환산 (완결작 백필 시간 예산 마감 계산용)
function getKstDeadlineTimestamp(hour: number, minute: number): number {
  const now = new Date();
  const kstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const deadlineKst = new Date(kstNow);
  deadlineKst.setHours(hour, minute, 0, 0);
  const diffMs = deadlineKst.getTime() - kstNow.getTime();
  return now.getTime() + diffMs;
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

// Supabase(PostgREST)는 명시적 range 없이 select하면 기본 1000행으로 잘라서 반환한다.
// 대상 테이블이 1000행을 넘어가면 뒤쪽 행이 조용히 누락되므로(에러 없이!), 전체를 읽어야 하는
// 곳은 반드시 이 헬퍼로 페이지네이션해야 함 - series_products/titles 조회에서 실제로 이 문제로
// 162개 작품의 다운로드수 수집이 누락된 적 있음.
async function fetchAllRows<T>(
  supabase: ReturnType<typeof import("../lib/supabase").getSupabaseAdmin>,
  table: string,
  select: string,
  build?: (q: any) => any
): Promise<T[]> {
  const all: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let q = supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
  }
  return all;
}

async function main() {
  const startedAt = Date.now();
  const titleLimit = process.env.TITLE_LIMIT ? parseInt(process.env.TITLE_LIMIT, 10) : undefined;
  const hasDb = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const snapshotDate = getKstDateString();

  console.log(`[1/10] 연재중인 작품 목록 조회...`);
  const ongoingTitles = await fetchAllOngoingTitles();
  // titlelist/finished는 이름과 달리 "지금 신작이 안 올라오는 작품" 전체를 돌려줌 - 그 안에서도
  // finish=false인 항목은 진짜 완결이 아니라 장기 휴재중인 작품이라, 연재중 취급으로 합쳐서
  // 매일 댓글/랭킹 수집이 계속되게 함 (휴재작은 요일별 목록에 아예 안 잡히므로 이렇게 안 하면 누락됨).
  const finishedListRaw = await fetchAllFinishedTitles();
  const ongoingIds = new Set(ongoingTitles.map((t) => t.titleId));
  const hiatusNotFinished = finishedListRaw.filter((t) => !t.finish && !ongoingIds.has(t.titleId));
  const allTitles = [...ongoingTitles, ...hiatusNotFinished];
  const titles = titleLimit ? allTitles.slice(0, titleLimit) : allTitles;
  console.log(
    `  요일별 연재작 ${ongoingTitles.length}개 + 휴재중(완결 아님) ${hiatusNotFinished.length}개 = ${allTitles.length}개 중 ${titles.length}개 처리 대상${titleLimit ? " (TITLE_LIMIT 적용)" : ""}`
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
      is_adult: t.adult,
      is_new: t.new,
      last_seen_at: nowIso,
    }));
    for (const batch of chunk(titleRows, 500)) {
      const { error } = await supabase.from("titles").upsert(batch, { onConflict: "title_id" });
      if (error) console.error("  titles upsert 실패:", error.message);
    }

    // TITLE_LIMIT으로 일부만 처리한 경우, 나머지 전체를 비활성 처리해버리는 사고를 방지
    // is_finished=true는 별도(완결 백필 단계)로 관리되는 작품이라 연재목록 기준 비활성화 대상에서 제외
    if (!titleLimit) {
      const currentIds = titles.map((t) => t.titleId);
      const { error: deactivateError } = await supabase
        .from("titles")
        .update({ is_active: false })
        .eq("is_active", true)
        .eq("is_finished", false)
        .not("title_id", "in", `(${currentIds.join(",") || 0})`);
      if (deactivateError) console.error("  titles 비활성화 실패:", deactivateError.message);
    }
  } else {
    console.log("  (SUPABASE_URL/SERVICE_ROLE_KEY 미설정 - 드라이런 모드, DB에 쓰지 않음)");
  }

  console.log(`[2/10] 작품별 상세정보(글/그림/원작 작가, 장르/키워드 태그) 조회...`);
  if (supabase) {
    const infoLimit = pLimit(10);
    const tagRows: { title_id: number; tag_name: string; tag_type: string }[] = [];
    // title_name은 not null 제약이라, upsert의 잠재적 insert 분기가 값을 요구함(기존 행이어도 마찬가지) - 항상 같이 넣어야 함
    const authorRows: {
      title_id: number;
      title_name: string;
      writer: string | null;
      painter: string | null;
      origin_author: string | null;
      age_rating: string;
    }[] = [];
    let infoFailures = 0;
    await Promise.all(
      titles.map((title) =>
        infoLimit(async () => {
          try {
            const info = await fetchTitleInfo(title.titleId);
            for (const g of info.genres) tagRows.push({ title_id: title.titleId, tag_name: g, tag_type: "GENRE" });
            for (const k of info.keywords) tagRows.push({ title_id: title.titleId, tag_name: k, tag_type: "KEYWORD" });
            authorRows.push({
              title_id: title.titleId,
              title_name: title.titleName,
              writer: info.writers.join(", ") || null,
              painter: info.painters.join(", ") || null,
              origin_author: info.originAuthors.join(", ") || null,
              age_rating: info.ageRating,
            });
          } catch (err) {
            infoFailures++;
            console.error(`  상세정보 조회 실패 (titleId=${title.titleId}, ${title.titleName}):`, err);
          }
        })
      )
    );
    const dedupedTagRows = dedupeBy(tagRows, (r) => `${r.title_id}_${r.tag_name}`);
    // 매일 최신 상태로 유지: 이번에 태그를 새로 가져온 작품들의 기존 태그를 지우고 다시 채워서
    // 더 이상 안 붙는 태그는 자동으로 빠지게 함
    const successTitleIds = [...new Set(dedupedTagRows.map((r) => r.title_id))];
    for (const idBatch of chunk(successTitleIds, 500)) {
      const { error } = await supabase.from("title_tags").delete().in("title_id", idBatch);
      if (error) console.error("  title_tags 삭제 실패:", error.message);
    }
    for (const batch of chunk(dedupedTagRows, 500)) {
      const { error } = await supabase.from("title_tags").upsert(batch, { onConflict: "title_id,tag_name" });
      if (error) console.error("  title_tags upsert 실패:", error.message);
    }
    for (const batch of chunk(authorRows, 500)) {
      const { error } = await supabase.from("titles").upsert(batch, { onConflict: "title_id" });
      if (error) console.error("  titles(작가정보) upsert 실패:", error.message);
    }
    console.log(
      `  태그 ${dedupedTagRows.length}건, 작가정보 ${authorRows.length}건 저장 (조회 실패 ${infoFailures}건)`
    );
  } else {
    console.log("  (드라이런 모드 - 상세정보 조회 생략)");
  }

  console.log(`[3/10] 평점/요일별 랭킹(인기순·별점순·조회순) 조회...`);
  // 매일+(dailyPlus) 작품은 이 랭킹 API에 없어 rank가 비어있을 수 있음 (star_score는 titles에서 그대로 나옴)
  const [popularityRanks, ratingRanks, viewRanks] = await Promise.all([
    fetchWeekdayRankMap("user"),
    fetchWeekdayRankMap("star"),
    fetchWeekdayRankMap("view"),
  ]);
  if (supabase) {
    // title_snapshots는 작품당 하루 1행이라 대표 요일 하나만 담김(다른 페이지의 "요일" 배지용).
    // 화/금처럼 여러 요일 연재작의 요일별 정확한 순위는 아래 title_weekday_ranks에 전부 저장함.
    const titleSnapshotRows = titles.map((t) => {
      const rankInfo =
        popularityRanks.get(t.titleId)?.[0] ?? ratingRanks.get(t.titleId)?.[0] ?? viewRanks.get(t.titleId)?.[0];
      return {
        title_id: t.titleId,
        snapshot_date: snapshotDate,
        star_score: t.starScore,
        weekday: rankInfo?.weekday ?? null,
        popularity_rank: popularityRanks.get(t.titleId)?.[0]?.rank ?? null,
        rating_rank: ratingRanks.get(t.titleId)?.[0]?.rank ?? null,
        view_rank: viewRanks.get(t.titleId)?.[0]?.rank ?? null,
      };
    });
    for (const batch of chunk(titleSnapshotRows, 500)) {
      const { error } = await supabase
        .from("title_snapshots")
        .upsert(batch, { onConflict: "title_id,snapshot_date" });
      if (error) console.error("  title_snapshots upsert 실패:", error.message);
    }
    console.log(`  title_snapshots ${titleSnapshotRows.length}건 저장 완료`);

    // 요일마다 순위가 다르므로(같은 작품이라도 화요일 랭킹과 금요일 랭킹은 별개) 작품×요일 단위로 전부 저장
    const weekdayRankRows: {
      title_id: number;
      snapshot_date: string;
      weekday: string;
      popularity_rank: number | null;
      rating_rank: number | null;
      view_rank: number | null;
    }[] = [];
    for (const t of titles) {
      const byWeekday = new Map<
        string,
        { popularity_rank: number | null; rating_rank: number | null; view_rank: number | null }
      >();
      const ensure = (wd: string) => {
        let entry = byWeekday.get(wd);
        if (!entry) {
          entry = { popularity_rank: null, rating_rank: null, view_rank: null };
          byWeekday.set(wd, entry);
        }
        return entry;
      };
      for (const r of popularityRanks.get(t.titleId) ?? []) ensure(r.weekday).popularity_rank = r.rank;
      for (const r of ratingRanks.get(t.titleId) ?? []) ensure(r.weekday).rating_rank = r.rank;
      for (const r of viewRanks.get(t.titleId) ?? []) ensure(r.weekday).view_rank = r.rank;
      for (const [weekday, ranks] of byWeekday) {
        weekdayRankRows.push({ title_id: t.titleId, snapshot_date: snapshotDate, weekday, ...ranks });
      }
    }
    for (const batch of chunk(weekdayRankRows, 500)) {
      const { error } = await supabase
        .from("title_weekday_ranks")
        .upsert(batch, { onConflict: "title_id,snapshot_date,weekday" });
      if (error) console.error("  title_weekday_ranks upsert 실패:", error.message);
    }
    console.log(`  title_weekday_ranks ${weekdayRankRows.length}건 저장 완료`);
  }

  console.log(`[4/10] 실시간 랭킹(인기/신작 × 전체/남성/여성 TOP5) 조회...`);
  const [realtimeRanking, realtimeNewRanking] = await Promise.all([
    fetchRealtimeRanking("DEFAULT"),
    fetchRealtimeRanking("NEW"),
  ]);
  if (supabase) {
    const toRows = (rankTabType: "DEFAULT" | "NEW", ranking: Record<RealtimeRankCategory, { rank: number; titleId: number }[]>) =>
      (Object.entries(ranking) as [RealtimeRankCategory, { rank: number; titleId: number }[]][]).flatMap(
        ([category, items]) =>
          items.map((item) => ({
            rank_tab_type: rankTabType,
            category,
            rank: item.rank,
            title_id: item.titleId,
            snapshot_date: snapshotDate,
          }))
      );
    const realtimeRows = [...toRows("DEFAULT", realtimeRanking), ...toRows("NEW", realtimeNewRanking)];
    const { error } = await supabase
      .from("realtime_ranking_snapshots")
      .upsert(realtimeRows, { onConflict: "rank_tab_type,category,rank,snapshot_date" });
    if (error) console.error("  realtime_ranking_snapshots upsert 실패:", error.message);
    console.log(`  realtime_ranking_snapshots ${realtimeRows.length}건 저장 완료`);
  }

  console.log(`[5/10] 작품별 회차 목록 조회 및 무료회차 판별...`);
  // 성인 작품은 article/list가 로그인 없이는 401(LOGIN)로 막혀있어(확인 완료) 회차 목록을 못 가져옴.
  // 다만 댓글 API는 열려있어서 존재 여부(404)로 이진탐색해 마지막 화 번호를 찾는 방식으로 대체.
  // 이 경우 무료/유료 여부를 알 방법이 없어 발견된 회차 전부를 추적 대상으로 취급함.
  const episodeLimit = pLimit(5);
  const freeEpisodes: { titleId: number; titleName: string; no: number }[] = [];
  let totalEpisodeCount = 0;
  let episodeFetchFailures = 0;
  let adultTitleCount = 0;
  let adultEpisodeCount = 0;

  await Promise.all(
    titles.map((title) =>
      episodeLimit(async () => {
        try {
          if (title.adult) {
            const lastNo = await findLastEpisodeNoViaComments(title.titleId);
            totalEpisodeCount += lastNo;
            adultTitleCount++;
            adultEpisodeCount += lastNo;

            if (supabase && lastNo > 0) {
              const episodeRows = Array.from({ length: lastNo }, (_, i) => ({
                title_id: title.titleId,
                no: i + 1,
                subtitle: null,
                service_date: null,
                is_free: true,
              }));
              for (const batch of chunk(episodeRows, 500)) {
                const { error } = await supabase.from("episodes").upsert(batch, {
                  onConflict: "title_id,no",
                });
                if (error) console.error(`  episodes upsert 실패(성인, ${title.titleId}):`, error.message);
              }
            }

            for (let no = 1; no <= lastNo; no++) {
              freeEpisodes.push({ titleId: title.titleId, titleName: title.titleName, no });
            }
            return;
          }

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
  console.log(`  성인 작품 ${adultTitleCount}개는 댓글 API 이진탐색으로 회차 ${adultEpisodeCount}개 발견`);

  console.log(`[6/10] 무료회차 댓글수 수집...`);
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

  console.log(`[7/10] 결과 저장...`);
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

  console.log(`[8/10] 신작 시리즈 자동 매칭 + 네이버 시리즈 다운로드수 수집 (우선 추적 5개 + 매칭된 전체)...`);
  // 시리즈 매칭을 아직 시도해본 적 없는(series_match_checked_at이 null인) 작품만 새로 시도.
  // 신작이 매일 생기므로 이 단계가 매일 조금씩 돌면서 자동으로 시리즈에 연결해준다.
  // 성공/실패 상관없이 시도했으면 checked_at을 찍어서 매번 똑같이 실패하는 작품을 계속
  // 재검색하지 않게 함(네트워크 오류로 시도 자체가 실패한 건 checked_at을 찍지 않고 다음날 재시도).
  if (supabase) {
    // 완결작은 다운로드수 추적 대상이 아니므로 애초에 매칭 시도도 하지 않음
    const unchecked = await fetchAllRows<{ title_id: number; title_name: string }>(
      supabase,
      "titles",
      "title_id,title_name",
      (q) => q.eq("is_active", true).eq("is_finished", false).is("series_match_checked_at", null)
    );
    if (unchecked && unchecked.length > 0) {
      console.log(`  시리즈 미확인 작품 ${unchecked.length}개 자동 매칭 시도...`);
      const matchLimit = pLimit(4);
      let newlyMatched = 0;
      const checkedIds: number[] = [];
      await Promise.all(
        unchecked.map((t) =>
          matchLimit(async () => {
            try {
              const match = await findMatchingSeriesProduct(t.title_name);
              if (match) {
                const { error } = await supabase!.from("series_products").upsert(
                  { product_no: match.productNo, title_id: t.title_id, series_title_name: match.seriesTitle },
                  { onConflict: "product_no" }
                );
                if (error) console.error(`  series_products 저장 실패 (${t.title_name}):`, error.message);
                else newlyMatched++;
              }
              checkedIds.push(t.title_id);
            } catch (err) {
              console.error(`  시리즈 매칭 시도 실패 (${t.title_name}):`, err);
            }
          })
        )
      );
      for (const batch of chunk(checkedIds, 500)) {
        const { error } = await supabase
          .from("titles")
          .update({ series_match_checked_at: new Date().toISOString() })
          .in("title_id", batch);
        if (error) console.error("  series_match_checked_at 갱신 실패:", error.message);
      }
      console.log(`  신규 매칭 ${newlyMatched}개 (확인 완료 ${checkedIds.length}/${unchecked.length}개)`);
    }
  }

  const seriesTargets = new Map<number, { titleId: number; name: string }>();
  for (const item of SERIES_WATCHLIST) {
    seriesTargets.set(item.productNo, { titleId: item.titleId, name: item.name });
  }
  if (supabase) {
    // 완결작은 다운로드수 추적 대상에서 제외 (연재중/휴재중만) - 매칭된 뒤에 완결되는 경우도 있어
    // series_products가 아니라 titles.is_finished 기준으로 매번 걸러냄
    const nonFinished = await fetchAllRows<{ title_id: number }>(supabase, "titles", "title_id", (q) =>
      q.eq("is_active", true).eq("is_finished", false)
    );
    const nonFinishedIds = new Set(nonFinished.map((t) => t.title_id));
    const products = await fetchAllRows<{ product_no: number; title_id: number; series_title_name: string }>(
      supabase,
      "series_products",
      "product_no,title_id,series_title_name"
    );
    for (const p of products) {
      if (!nonFinishedIds.has(p.title_id)) continue;
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

  console.log(`[9/10] 제작사 채용공고(사람인/잡코리아) 조회...`);
  if (supabase) {
    const { data: recruitLinks, error: linksError } = await supabase
      .from("studio_recruit_links")
      .select("studio_name,saramin_url,jobkorea_url");
    if (linksError) {
      console.error("  studio_recruit_links 조회 실패:", linksError.message);
    } else {
      const recruitLimit = pLimit(4);
      let jobFailures = 0;
      const postingRows: {
        studio_name: string;
        source: string;
        posting_id: string;
        title: string;
        url: string;
        status: string;
        dday: string | null;
      }[] = [];
      const ambiguousJobKorea: (JobPosting & { studioName: string })[] = [];
      await Promise.all(
        (recruitLinks ?? []).map((link) =>
          recruitLimit(async () => {
            const toRows = (source: "SARAMIN" | "JOBKOREA", jobs: JobPosting[]) =>
              jobs.map((j) => ({
                studio_name: link.studio_name,
                source,
                posting_id: j.postingId,
                title: j.title,
                url: j.url,
                status: j.status,
                dday: j.dday,
              }));
            try {
              if (link.saramin_url) postingRows.push(...toRows("SARAMIN", await fetchSaraminJobs(link.saramin_url)));
            } catch (err) {
              jobFailures++;
              console.error(`  사람인 조회 실패 (${link.studio_name}):`, err);
            }
            try {
              if (link.jobkorea_url) {
                const jobs = await fetchJobKoreaJobs(link.jobkorea_url);
                postingRows.push(...toRows("JOBKOREA", jobs));
                ambiguousJobKorea.push(
                  ...findAmbiguousJobKoreaPostings(jobs.map((j) => ({ ...j, studioName: link.studio_name })))
                );
              }
            } catch (err) {
              jobFailures++;
              console.error(`  잡코리아 조회 실패 (${link.studio_name}):`, err);
            }
          })
        )
      );
      // 매일 최신 상태로 유지: 이번에 조회한 제작사의 기존 공고를 지우고 다시 채워서
      // 마감/삭제된 공고는 자동으로 빠지게 함
      const processedStudios = [...new Set((recruitLinks ?? []).map((l) => l.studio_name))];
      for (const batch of chunk(processedStudios, 500)) {
        const { error } = await supabase.from("studio_job_postings").delete().in("studio_name", batch);
        if (error) console.error("  studio_job_postings 삭제 실패:", error.message);
      }
      for (const batch of chunk(postingRows, 500)) {
        const { error } = await supabase
          .from("studio_job_postings")
          .upsert(batch, { onConflict: "studio_name,source,posting_id" });
        if (error) console.error("  studio_job_postings upsert 실패:", error.message);
      }
      console.log(`  채용공고 ${postingRows.length}건 저장 (조회 실패 ${jobFailures}건)`);
      if (ambiguousJobKorea.length > 0) {
        console.log(`  잡코리아 마감여부 불명확 ${ambiguousJobKorea.length}건:`);
        for (const j of ambiguousJobKorea) {
          console.log(`    - [${j.studioName}] ${j.title} (dday="${j.dday}", status=${j.status}) ${j.url}`);
        }
      }
    }
  } else {
    console.log("  (드라이런 모드 - 채용공고 조회 생략)");
  }

  console.log(`[10/10] 완결 웹툰 초기 백필 (회차+댓글수, 작품당 최초 1회, 08:10 KST까지)...`);
  let finishedBackfilledCount = 0;
  let finishedStoppedForTime = false;
  let finishedTotal = 0;
  if (titleLimit) {
    console.log("  (TITLE_LIMIT 테스트 실행이라 완결작 백필은 건너뜀)");
  } else if (supabase) {
    const deadline = getKstDeadlineTimestamp(8, 10);
    console.log(`  마감 시각(KST 08:10): ${new Date(deadline).toISOString()}`);

    // step 1에서 이미 받아둔 목록 재사용 (같은 API를 두 번 호출하지 않도록)
    const finishedTitles = finishedListRaw;
    finishedTotal = finishedTitles.length;
    console.log(`  완결/휴재 작품 목록 ${finishedTitles.length}개 확인`);
    const finishedById = new Map(finishedTitles.map((t) => [t.titleId, t]));

    const nowIso = new Date().toISOString();
    // finish=false인 항목(휴재중)은 step 1에서 이미 titles에 합쳐져 upsert됐으니 여기서는 건드리지 않음 -
    // 안 그러면 방금 연재중으로 바로잡은 값을 이 배치가 다시 덮어쓸 위험이 있음
    const finishedRows = finishedTitles
      .filter((t) => t.finish)
      .map((t) => ({
      title_id: t.titleId,
      title_name: t.titleName,
      author: t.author,
      thumbnail_url: t.thumbnailUrl,
      is_active: true,
      is_finished: true,
      is_on_hiatus: t.rest,
      is_adult: t.adult,
      is_new: t.new,
      last_seen_at: nowIso,
    }));
    for (const batch of chunk(finishedRows, 500)) {
      const { error } = await supabase.from("titles").upsert(batch, { onConflict: "title_id" });
      if (error) console.error("  완결작 titles upsert 실패:", error.message);
    }

    const episodeLimitFinished = pLimit(4);
    const commentLimitFinished = pLimit(8);
    const infoLimitFinished = pLimit(6);

    outer: while (Date.now() < deadline) {
      const { data: pending, error: pendingError } = await supabase
        .from("titles")
        .select("title_id")
        .eq("is_finished", true)
        .is("finished_backfilled_at", null)
        .order("title_id", { ascending: true })
        .limit(1000);
      if (pendingError) {
        console.error("  백필 대상 조회 실패:", pendingError.message);
        break;
      }
      if (!pending || pending.length === 0) {
        console.log("  완결작 백필 대상 없음 (전부 완료됨)");
        break;
      }

      for (const row of pending) {
        if (Date.now() >= deadline) {
          finishedStoppedForTime = true;
          break outer;
        }
        const t = finishedById.get(row.title_id);
        const label = t?.titleName ?? String(row.title_id);
        try {
          const [episodes, info] = await Promise.all([
            episodeLimitFinished(() => fetchAllEpisodes(row.title_id)),
            infoLimitFinished(() => fetchTitleInfo(row.title_id)).catch((err) => {
              console.error(`  상세정보 조회 실패 (완결작, ${label}):`, err);
              return null;
            }),
          ]);

          if (info) {
            const tagRows = [
              ...info.genres.map((g) => ({ title_id: row.title_id, tag_name: g, tag_type: "GENRE" })),
              ...info.keywords.map((k) => ({ title_id: row.title_id, tag_name: k, tag_type: "KEYWORD" })),
            ];
            const { error: delError } = await supabase.from("title_tags").delete().eq("title_id", row.title_id);
            if (delError) console.error(`  title_tags 삭제 실패 (${label}):`, delError.message);
            if (tagRows.length > 0) {
              const { error: tagError } = await supabase
                .from("title_tags")
                .upsert(tagRows, { onConflict: "title_id,tag_name" });
              if (tagError) console.error(`  title_tags upsert 실패 (${label}):`, tagError.message);
            }
            const { error: infoError } = await supabase.from("titles").upsert(
              {
                title_id: row.title_id,
                title_name: label,
                writer: info.writers.join(", ") || null,
                painter: info.painters.join(", ") || null,
                origin_author: info.originAuthors.join(", ") || null,
                age_rating: info.ageRating,
              },
              { onConflict: "title_id" }
            );
            if (infoError) console.error(`  titles(작가정보) upsert 실패 (${label}):`, infoError.message);
          }

          const episodeRows = dedupeBy(
            episodes.map((e) => ({
              title_id: row.title_id,
              no: e.no,
              subtitle: e.subtitle,
              service_date: parseServiceDate(e.serviceDateDescription),
              is_free: !e.charge,
            })),
            (e) => `${e.title_id}_${e.no}`
          );
          for (const batch of chunk(episodeRows, 500)) {
            const { error } = await supabase.from("episodes").upsert(batch, { onConflict: "title_id,no" });
            if (error) console.error(`  episodes upsert 실패 (${label}):`, error.message);
          }

          const freeEpisodes = episodeRows.filter((e) => e.is_free);
          const commentResults = await Promise.all(
            freeEpisodes.map((e) =>
              commentLimitFinished(async () => {
                try {
                  const stats = await fetchCommentStats(row.title_id, e.no);
                  return {
                    title_id: row.title_id,
                    no: e.no,
                    snapshot_date: snapshotDate,
                    comment_count: stats.commentCount,
                    post_count: stats.postCount,
                  };
                } catch {
                  return null;
                }
              })
            )
          );
          const snapshotRows = dedupeBy(
            commentResults.filter((r): r is NonNullable<typeof r> => r !== null),
            (r) => `${r.title_id}_${r.no}`
          );
          for (const batch of chunk(snapshotRows, 500)) {
            const { error } = await supabase
              .from("comment_snapshots")
              .upsert(batch, { onConflict: "title_id,no,snapshot_date" });
            if (error) console.error(`  comment_snapshots upsert 실패 (${label}):`, error.message);
          }

          const { error: markError } = await supabase
            .from("titles")
            .update({ finished_backfilled_at: new Date().toISOString() })
            .eq("title_id", row.title_id);
          if (markError) console.error(`  백필 완료 표시 실패 (${label}):`, markError.message);

          finishedBackfilledCount++;
          if (finishedBackfilledCount % 50 === 0) {
            console.log(`  진행: ${finishedBackfilledCount}개 백필 완료...`);
          }
        } catch (err) {
          console.error(`  완결작 백필 실패 (titleId=${row.title_id}, ${label}):`, err);
        }
      }
    }

    console.log(
      `  완결작 백필 ${finishedBackfilledCount}개 처리${
        finishedStoppedForTime ? " (시간 마감으로 중단 - 내일 새벽 3:10부터 이어서 진행)" : ""
      }`
    );
  } else {
    console.log("  (드라이런 모드 - 완결작 백필 생략)");
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `\n완료: 작품 ${titles.length}개, 회차 ${totalEpisodeCount}개, 무료회차 ${dedupedFreeEpisodes.length}개, ` +
      `댓글수집 성공 ${dedupedSnapshots.length}건 / 실패 ${commentFailures}건, ` +
      `시리즈 다운로드수 성공 ${seriesRows.length}건 / 실패 ${seriesFailures}건, ` +
      `완결작 백필 ${finishedBackfilledCount}/${finishedTotal}개, 소요시간 ${elapsedSec}초`
  );
}

main().catch((err) => {
  console.error("수집기 실행 중 오류:", err);
  process.exit(1);
});
