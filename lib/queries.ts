import { getSupabaseAnon, getSupabaseAdmin, hasAdminAccess } from "./supabase";
import { SERIES_WATCHLIST } from "./seriesWatchlist";
import { fetchRealtimeRanking } from "./naver";

/** 쓰기 함수 공용 가드: 공유 배포(service role key 없음)에서는 수정 자체가 불가능해야 함 */
function assertAdminAccess() {
  if (!hasAdminAccess()) {
    throw new Error("읽기 전용 배포에서는 수정할 수 없습니다. 로컬(localhost)에서 수정해주세요.");
  }
}

export interface TitleRow {
  title_id: number;
  title_name: string;
  author: string | null;
  thumbnail_url: string | null;
  is_active: boolean;
  is_finished: boolean;
  is_on_hiatus: boolean;
  is_adult: boolean;
  is_new: boolean;
  studio_name: string | null;
  studio_website_url: string | null;
  synopsis: string | null;
  writer: string | null;
  painter: string | null;
  origin_author: string | null;
  is_novel_origin: boolean;
}

export interface EpisodeRow {
  title_id: number;
  no: number;
  subtitle: string | null;
  service_date: string | null;
  is_free: boolean;
}

export interface TopMoverRow {
  title_id: number;
  no: number;
  title_name: string;
  subtitle: string | null;
  thumbnail_url: string | null;
  comment_count: number;
  delta: number;
}

/** 최신 스냅샷 날짜 (없으면 null - 아직 수집기가 한 번도 안 돈 상태) */
export async function getLatestSnapshotDate(): Promise<string | null> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase.rpc("latest_snapshot_date");
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** 전일 대비 댓글수 증가 TOP N */
export async function getTopMovers(limit = 20): Promise<TopMoverRow[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase.rpc("top_movers", { result_limit: limit });
  if (error) throw error;
  return (data ?? []) as TopMoverRow[];
}

/** 작품명으로 검색 (연재중인 작품만) */
export async function searchTitles(query: string): Promise<TitleRow[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("titles")
    .select("title_id,title_name,author,thumbnail_url,is_active,is_finished,is_on_hiatus,is_adult,is_new,studio_name,studio_website_url,synopsis,writer,painter,origin_author,is_novel_origin")
    .eq("is_active", true)
    .ilike("title_name", `%${query}%`)
    .order("title_name")
    .limit(50);
  if (error) throw error;
  return (data ?? []) as TitleRow[];
}

export async function getTitle(titleId: number): Promise<TitleRow | null> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("titles")
    .select("title_id,title_name,author,thumbnail_url,is_active,is_finished,is_on_hiatus,is_adult,is_new,studio_name,studio_website_url,synopsis,writer,painter,origin_author,is_novel_origin")
    .eq("title_id", titleId)
    .maybeSingle();
  if (error) throw error;
  return data as TitleRow | null;
}

export interface EpisodeWithCount extends EpisodeRow {
  comment_count: number | null;
  treatment: string | null;
}

/** 작품의 회차 목록 + 최신 댓글수 + 사용자가 입력한 트리트먼트 (최신순) */
export async function getEpisodesWithLatestCount(titleId: number): Promise<EpisodeWithCount[]> {
  const supabase = getSupabaseAnon();
  const { data: episodes, error: episodesError } = await supabase
    .from("episodes")
    .select("title_id,no,subtitle,service_date,is_free")
    .eq("title_id", titleId)
    .order("no", { ascending: false });
  if (episodesError) throw episodesError;
  if (!episodes || episodes.length === 0) return [];

  // episode_notes는 부가 기능이라 스키마 미반영 등으로 실패해도 본문 조회 자체는 계속되게 함
  const { data: notes } = await supabase.from("episode_notes").select("no,treatment").eq("title_id", titleId);
  const treatmentByNo = new Map((notes ?? []).map((n) => [n.no, n.treatment as string | null]));

  const latestDate = await getLatestSnapshotDate();
  if (!latestDate) {
    return episodes.map((e) => ({ ...e, comment_count: null, treatment: treatmentByNo.get(e.no) ?? null }));
  }

  const { data: snapshots, error: snapshotsError } = await supabase
    .from("comment_snapshots")
    .select("no,comment_count")
    .eq("title_id", titleId)
    .eq("snapshot_date", latestDate);
  if (snapshotsError) throw snapshotsError;

  const countByNo = new Map((snapshots ?? []).map((s) => [s.no, s.comment_count]));
  return episodes.map((e) => ({
    ...e,
    comment_count: countByNo.get(e.no) ?? null,
    treatment: treatmentByNo.get(e.no) ?? null,
  }));
}

/** 회차별 트리트먼트(내용 메모) 저장 - 대시보드에서 사용자가 직접 입력 */
export async function saveEpisodeTreatment(titleId: number, no: number, treatment: string): Promise<void> {
  assertAdminAccess();
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("episode_notes")
    .upsert(
      { title_id: titleId, no, treatment, updated_at: new Date().toISOString() },
      { onConflict: "title_id,no" }
    );
  if (error) throw error;
}

export interface TitleNotes {
  logline: string | null;
  subject: string | null;
  target_audience: string | null;
  comment: string | null;
}

/** 작품에 사용자가 입력한 로그라인/소재/타깃층/코멘트 (부가 기능이라 실패해도 조용히 null 처리) */
export async function getTitleNotes(titleId: number): Promise<TitleNotes> {
  const supabase = getSupabaseAnon();
  const { data } = await supabase
    .from("title_notes")
    .select("logline,subject,target_audience,comment")
    .eq("title_id", titleId)
    .maybeSingle();
  return {
    logline: data?.logline ?? null,
    subject: data?.subject ?? null,
    target_audience: data?.target_audience ?? null,
    comment: data?.comment ?? null,
  };
}

/** 작품 단위 로그라인/소재/타깃층 저장 - 대시보드에서 사용자가 직접 입력 */
export async function saveTitleNotes(titleId: number, notes: TitleNotes): Promise<void> {
  assertAdminAccess();
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("title_notes")
    .upsert(
      { title_id: titleId, ...notes, updated_at: new Date().toISOString() },
      { onConflict: "title_id" }
    );
  if (error) throw error;
}

/**
 * 노션 등에서 정리해온 개인 분석 메모. title_private_notes는 RLS에 select 정책이 아예
 * 없어서 anon 키로는 애초에 조회가 안 됨(공유 배포에는 절대 안 뜸) - 그래서 여기서도
 * anon이 아니라 admin 클라이언트로만 읽는다. hasAdminAccess()가 false인 배포(공유 URL)에서는
 * 조용히 null을 반환해 이 메모 자체가 화면에 나타나지 않게 한다.
 */
export async function getTitlePrivateNote(titleId: number): Promise<string | null> {
  if (!hasAdminAccess()) return null;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("title_private_notes")
    .select("content")
    .eq("title_id", titleId)
    .maybeSingle();
  return data?.content ?? null;
}

export async function saveTitlePrivateNote(titleId: number, content: string): Promise<void> {
  assertAdminAccess();
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("title_private_notes")
    .upsert({ title_id: titleId, content, updated_at: new Date().toISOString() }, { onConflict: "title_id" });
  if (error) throw error;
}

export interface ExportTitleRowUnified {
  id: number;
  platform: "naver" | "kakao";
  title_name: string;
  thumbnail_url: string | null;
  weekday: string | null;
  is_adult: boolean;
  age_rating: string | null;
  writer: string | null;
  painter: string | null;
  origin_author: string | null;
  studio_name: string | null;
  is_finished: boolean;
  is_on_hiatus: boolean;
  star_score: number | null;
  popularity_rank: number | null;
  launch_date: string | null;
  total_comment_count: number | null;
  download_count: number | null;
  view_count: number | null;
  like_count: number | null;
  genre: string | null;
  subject: string | null;
  logline: string | null;
  target_audience: string | null;
  comment: string | null;
}

/** 전체 작품 엑셀 내보내기용 데이터(네이버+카카오 통합, 플랫폼 필터 포함, 페이지네이션 없음) */
export async function getExportTitlesDataUnified(opts: {
  platform?: TitlePlatformFilter;
  status?: TitleStatusFilter;
  type?: TitleTypeFilter;
  adultOnly?: boolean;
  launchFrom?: string;
  launchTo?: string;
  sortBy?: TitleSortBy | "views" | "likes";
  genre?: string;
}): Promise<ExportTitleRowUnified[]> {
  const supabase = getSupabaseAnon();
  const PAGE_SIZE = 1000;
  const all: ExportTitleRowUnified[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    // export_titles_data_unified가 네이버+카카오를 통째로 훑는 무거운 쿼리라 anon 롤의 짧은
    // statement_timeout에 가끔(불규칙하게) 걸리는 걸 실제로 겪었다 - 몇 번 재시도하면 대체로
    // 통과해서(부하 변동성으로 보임) 재시도로 흡수한다.
    let rows: ExportTitleRowUnified[] | null = null;
    let lastError: { code?: string; message: string } | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
      const { data, error } = await supabase
        .rpc("export_titles_data_unified", {
          filter_platform: opts.platform ?? "all",
          filter_status: opts.status ?? "all",
          filter_type: opts.type ?? "all",
          filter_adult_only: opts.adultOnly ?? false,
          filter_launch_from: opts.launchFrom ?? null,
          filter_launch_to: opts.launchTo ?? null,
          sort_by: opts.sortBy ?? "name",
          filter_genre: opts.genre ?? "all",
        })
        .range(offset, offset + PAGE_SIZE - 1);
      if (!error) {
        rows = (data ?? []) as ExportTitleRowUnified[];
        break;
      }
      lastError = error;
      if (error.code !== "57014") break; // statement timeout 외의 에러는 재시도해도 소용없음
    }
    if (rows === null) throw lastError;
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

export interface CommentSnapshotRaw {
  no: number;
  snapshot_date: string;
  comment_count: number;
}

/** 작품의 회차×날짜별 댓글수 전체 (엑셀 내보내기용, 날짜별로 넓게 펼치기 전 원본) */
export async function getAllCommentSnapshots(titleId: number): Promise<CommentSnapshotRaw[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("comment_snapshots")
    .select("no,snapshot_date,comment_count")
    .eq("title_id", titleId)
    .order("snapshot_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CommentSnapshotRaw[];
}

export interface PopularityHistoryPoint {
  snapshot_date: string;
  popularity_rank: number | null;
}

/** 작품의 날짜별 인기순위 추이 (엑셀 내보내기용) */
export async function getPopularityRankHistory(titleId: number): Promise<PopularityHistoryPoint[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("title_snapshots")
    .select("snapshot_date,popularity_rank")
    .eq("title_id", titleId)
    .order("snapshot_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PopularityHistoryPoint[];
}

export interface SnapshotPoint {
  snapshot_date: string;
  comment_count: number;
}

/** 특정 회차의 날짜별 댓글수 추이 */
export async function getEpisodeHistory(titleId: number, no: number): Promise<SnapshotPoint[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("comment_snapshots")
    .select("snapshot_date,comment_count")
    .eq("title_id", titleId)
    .eq("no", no)
    .order("snapshot_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SnapshotPoint[];
}

export type Weekday =
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY"
  | "SUNDAY"
  | "DAILY_PLUS";

export interface PopularityRankRow {
  title_id: number;
  title_name: string;
  thumbnail_url: string | null;
  popularity_rank: number;
  is_novel_origin: boolean;
  launch_date: string | null;
  download_count: number | null;
  total_comment_count: number | null;
  star_score: number | null;
}

/** 요일별 인기순위 (네이버 order=user 기준, 해당 요일 안에서의 순위) */
export async function getWeekdayPopularityRanking(
  weekday: Weekday,
  limit = 20
): Promise<PopularityRankRow[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase.rpc("weekday_popularity_ranking", {
    target_weekday: weekday,
    result_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as PopularityRankRow[];
}

export type RealtimeRankCategory = "TOTAL" | "MALE" | "FEMALE";
export type RealtimeRankTabType = "DEFAULT" | "NEW";

export interface RealtimeRankRow {
  rank: number;
  title_id: number;
  title_name: string;
  thumbnail_url: string | null;
  is_novel_origin: boolean;
  weekday: string | null;
  popularity_rank: number | null;
  launch_date: string | null;
  download_count: number | null;
  total_comment_count: number | null;
  star_score: number | null;
}

export interface NaverTitlePerf {
  title_id: number;
  weekday: string | null;
  popularity_rank: number | null;
  launch_date: string | null;
  download_count: number | null;
  total_comment_count: number | null;
  star_score: number | null;
}

export interface KakaoTitlePerf {
  content_id: number;
  launch_date: string | null;
  view_count: number | null;
}

/** title_id 목록에 대한 요일/인기순위/다운로드수/총댓글수/런칭일 일괄 조회 (검색결과, 실시간 랭킹 등
 * DB 랭킹 쿼리 없이 title_id 목록만 있는 경우 공용으로 씀) */
export async function getNaverTitlesPerf(titleIds: number[]): Promise<Map<number, NaverTitlePerf>> {
  if (titleIds.length === 0) return new Map();
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase.rpc("naver_titles_perf", { target_ids: titleIds });
  if (error) throw error;
  return new Map(((data ?? []) as NaverTitlePerf[]).map((r) => [r.title_id, r]));
}

/** 카카오 버전(조회수 + 런칭일만 - 인기순위/댓글수는 신뢰성/API 차단 문제로 미제공) */
export async function getKakaoTitlesPerf(contentIds: number[]): Promise<Map<number, KakaoTitlePerf>> {
  if (contentIds.length === 0) return new Map();
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase.rpc("kakao_titles_perf", { target_ids: contentIds });
  if (error) throw error;
  return new Map(((data ?? []) as KakaoTitlePerf[]).map((r) => [r.content_id, r]));
}

/**
 * 네이버 실시간 랭킹 TOP5 (요일 구분 없는 진짜 플랫폼 전체 순위, 전체/남성/여성).
 * rankTabType=DEFAULT: 실시간 인기랭킹, NEW: 실시간 신작랭킹.
 */
export async function getRealtimeRanking(
  category: RealtimeRankCategory,
  rankTabType: RealtimeRankTabType = "DEFAULT"
): Promise<RealtimeRankRow[]> {
  const supabase = getSupabaseAnon();
  const latestDate = await getLatestSnapshotDate();
  if (!latestDate) return [];
  const { data, error } = await supabase
    .from("realtime_ranking_snapshots")
    .select("rank,title_id,titles(title_name,thumbnail_url,is_novel_origin)")
    .eq("rank_tab_type", rankTabType)
    .eq("category", category)
    .eq("snapshot_date", latestDate)
    .order("rank", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const title = Array.isArray(r.titles) ? r.titles[0] : r.titles;
    return {
      rank: r.rank,
      title_id: r.title_id,
      title_name: title?.title_name ?? "",
      thumbnail_url: title?.thumbnail_url ?? null,
      is_novel_origin: title?.is_novel_origin ?? false,
      weekday: null,
      popularity_rank: null,
      launch_date: null,
      download_count: null,
      total_comment_count: null,
      star_score: null,
    };
  });
}

/**
 * 네이버 실시간 랭킹 TOP5를 매번 네이버에서 직접 가져옴(DB 스냅샷 아님).
 * "실시간" 랭킹은 네이버 쪽에서 하루에도 여러 번 바뀌는데 수집기는 새벽 3:10에 한 번만 찍어서
 * 낮에 보면 항상 어제 새벽 기준으로 멈춰 보였음 - 홈 화면에서는 매 요청마다 최신값을 보여주려고
 * DB 대신 실시간 API를 직접 호출한다(과거 추이 저장용 realtime_ranking_snapshots는 그대로 유지).
 */
export async function getRealtimeRankingLive(
  category: RealtimeRankCategory,
  rankTabType: RealtimeRankTabType = "DEFAULT"
): Promise<RealtimeRankRow[]> {
  const ranking = await fetchRealtimeRanking(rankTabType);
  const items = ranking[category];
  if (items.length === 0) return [];
  const supabase = getSupabaseAnon();
  const titleIds = items.map((i) => i.titleId);
  const [{ data, error }, perfMap] = await Promise.all([
    supabase.from("titles").select("title_id,title_name,thumbnail_url,is_novel_origin").in("title_id", titleIds),
    getNaverTitlesPerf(titleIds),
  ]);
  if (error) throw error;
  const titleMap = new Map((data ?? []).map((t) => [t.title_id, t]));
  return items.map((item) => {
    const title = titleMap.get(item.titleId);
    const perf = perfMap.get(item.titleId);
    return {
      rank: item.rank,
      title_id: item.titleId,
      title_name: title?.title_name ?? "",
      thumbnail_url: title?.thumbnail_url ?? null,
      is_novel_origin: title?.is_novel_origin ?? false,
      weekday: perf?.weekday ?? null,
      popularity_rank: perf?.popularity_rank ?? null,
      launch_date: perf?.launch_date ?? null,
      download_count: perf?.download_count ?? null,
      total_comment_count: perf?.total_comment_count ?? null,
      star_score: perf?.star_score ?? null,
    };
  });
}

export interface TitleSnapshot {
  star_score: number | null;
  weekday: string | null;
  popularity_rank: number | null;
  rating_rank: number | null;
  view_rank: number | null;
}

/** 작품의 최신 평점/요일별 랭킹 (매일+ 작품은 rank가 전부 null일 수 있음) */
export async function getLatestTitleSnapshot(titleId: number): Promise<TitleSnapshot | null> {
  const supabase = getSupabaseAnon();
  const latestDate = await getLatestSnapshotDate();
  if (!latestDate) return null;
  const { data, error } = await supabase
    .from("title_snapshots")
    .select("star_score,weekday,popularity_rank,rating_rank,view_rank")
    .eq("title_id", titleId)
    .eq("snapshot_date", latestDate)
    .maybeSingle();
  if (error) throw error;
  return data as TitleSnapshot | null;
}

export interface SeriesWatchRow {
  product_no: number;
  title_id: number;
  title_name: string;
  thumbnail_url: string | null;
  is_novel_origin: boolean;
  download_count: number;
  delta: number;
  snapshot_date: string;
}

/** 우선 추적 작품(lib/seriesWatchlist.ts)의 최신 시리즈 다운로드수 + 전일 대비 증가량 */
export async function getSeriesWatchlistLatest(): Promise<SeriesWatchRow[]> {
  if (SERIES_WATCHLIST.length === 0) return [];
  const supabase = getSupabaseAnon();
  const productNos = SERIES_WATCHLIST.map((w) => w.productNo);
  const titleIds = SERIES_WATCHLIST.map((w) => w.titleId);
  const [{ data, error }, { data: titleRows, error: titleError }] = await Promise.all([
    supabase
      .from("series_snapshots")
      .select("product_no,title_id,snapshot_date,download_count")
      .in("product_no", productNos)
      .order("snapshot_date", { ascending: false }),
    supabase.from("titles").select("title_id,thumbnail_url,is_novel_origin").in("title_id", titleIds),
  ]);
  if (error) throw error;
  if (titleError) throw titleError;

  const byProduct = new Map<number, { snapshot_date: string; download_count: number }[]>();
  for (const row of data ?? []) {
    const list = byProduct.get(row.product_no) ?? [];
    list.push({ snapshot_date: row.snapshot_date, download_count: row.download_count });
    byProduct.set(row.product_no, list);
  }
  const titleInfoByTitle = new Map(
    (titleRows ?? []).map((t) => [t.title_id, { thumbnail_url: t.thumbnail_url as string | null, is_novel_origin: t.is_novel_origin as boolean }])
  );

  return SERIES_WATCHLIST.map((w) => {
    const history = byProduct.get(w.productNo) ?? [];
    const latest = history[0];
    const prev = history[1];
    return {
      product_no: w.productNo,
      title_id: w.titleId,
      title_name: w.name,
      thumbnail_url: titleInfoByTitle.get(w.titleId)?.thumbnail_url ?? null,
      is_novel_origin: titleInfoByTitle.get(w.titleId)?.is_novel_origin ?? false,
      download_count: latest?.download_count ?? 0,
      delta: latest && prev ? latest.download_count - prev.download_count : 0,
      snapshot_date: latest?.snapshot_date ?? "",
    };
  }).sort((a, b) => b.download_count - a.download_count);
}

/** 작품이 네이버 시리즈와 매칭되어 있으면 productNo/이름 반환 (우선 워치리스트 + DB 매칭 전체) */
export async function getSeriesProductForTitle(
  titleId: number
): Promise<{ productNo: number; name: string } | null> {
  const seed = SERIES_WATCHLIST.find((w) => w.titleId === titleId);
  if (seed) return { productNo: seed.productNo, name: seed.name };

  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("series_products")
    .select("product_no,series_title_name")
    .eq("title_id", titleId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { productNo: data.product_no, name: data.series_title_name };
}

export interface SeriesSnapshotPoint {
  snapshot_date: string;
  download_count: number;
}

/** 특정 시리즈 작품의 날짜별 다운로드수 추이 */
export async function getSeriesHistory(productNo: number): Promise<SeriesSnapshotPoint[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("series_snapshots")
    .select("snapshot_date,download_count")
    .eq("product_no", productNo)
    .order("snapshot_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SeriesSnapshotPoint[];
}

export async function getEpisode(titleId: number, no: number): Promise<EpisodeRow | null> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("episodes")
    .select("title_id,no,subtitle,service_date,is_free")
    .eq("title_id", titleId)
    .eq("no", no)
    .maybeSingle();
  if (error) throw error;
  return data as EpisodeRow | null;
}

/** 회차에 사용자가 입력한 트리트먼트 (부가 기능이라 실패해도 null로 조용히 처리) */
export async function getEpisodeTreatment(titleId: number, no: number): Promise<string | null> {
  const supabase = getSupabaseAnon();
  const { data } = await supabase
    .from("episode_notes")
    .select("treatment")
    .eq("title_id", titleId)
    .eq("no", no)
    .maybeSingle();
  return (data?.treatment as string | null) ?? null;
}

export type TitleSortBy = "name" | "popularity" | "star" | "launch" | "comments";
export type TitleStatusFilter = "all" | "ongoing" | "new" | "finished" | "hiatus";
export type TitleTypeFilter = "all" | "weekday" | "daily_plus";

export interface TitleListRow {
  title_id: number;
  title_name: string;
  thumbnail_url: string | null;
  author: string | null;
  studio_name: string | null;
  is_finished: boolean;
  is_on_hiatus: boolean;
  is_adult: boolean;
  is_new: boolean;
  weekday: string | null;
  star_score: number | null;
  popularity_rank: number | null;
  launch_date: string | null;
  total_comment_count: number | null;
  is_novel_origin: boolean;
  download_count: number | null;
}

export interface TitleListResult {
  rows: TitleListRow[];
  totalCount: number;
}

/** 전체 작품 리스트 (연재구분/상태/성인 필터, 정렬, 페이지네이션) */
export async function listTitles(opts: {
  type?: TitleTypeFilter;
  status?: TitleStatusFilter;
  sortBy?: TitleSortBy;
  page?: number;
  pageSize?: number;
  adultOnly?: boolean;
  launchFrom?: string;
  launchTo?: string;
}): Promise<TitleListResult> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase.rpc("list_titles", {
    filter_type: opts.type ?? "all",
    filter_status: opts.status ?? "all",
    sort_by: opts.sortBy ?? "name",
    page_num: opts.page ?? 1,
    page_size: opts.pageSize ?? 50,
    filter_adult_only: opts.adultOnly ?? false,
    filter_launch_from: opts.launchFrom ?? null,
    filter_launch_to: opts.launchTo ?? null,
  });
  if (error) throw error;
  const rows = (data ?? []) as (TitleListRow & { total_count: number })[];
  const totalCount = rows[0]?.total_count ?? 0;
  return { rows: rows.map(({ total_count: _total_count, ...r }) => r), totalCount };
}

export type TitlePlatformFilter = "all" | "naver" | "kakao";

export interface UnifiedTitleListRow {
  id: number;
  platform: "naver" | "kakao";
  title_name: string;
  thumbnail_url: string | null;
  author: string | null;
  studio_name: string | null;
  is_finished: boolean;
  is_on_hiatus: boolean;
  is_adult: boolean;
  is_new: boolean;
  weekday: string | null;
  launch_date: string | null;
  popularity_rank: number | null;
  star_score: number | null;
  comment_count: number | null;
  view_count: number | null;
  like_count: number | null;
  download_count: number | null;
}

export interface UnifiedTitleListResult {
  rows: UnifiedTitleListRow[];
  totalCount: number;
}

/** 전체 작품 리스트(네이버+카카오 통합, 플랫폼 필터 포함) - /titles 페이지 전용 */
export async function listTitlesUnified(opts: {
  platform?: TitlePlatformFilter;
  type?: TitleTypeFilter;
  status?: TitleStatusFilter;
  sortBy?: TitleSortBy | "views" | "likes" | "downloads";
  page?: number;
  pageSize?: number;
  adultOnly?: boolean;
  launchFrom?: string;
  launchTo?: string;
  genre?: string;
}): Promise<UnifiedTitleListResult> {
  const supabase = getSupabaseAnon();
  // list_titles_unified가 네이버+카카오를 통째로 훑는 무거운 쿼리라 anon 롤의 짧은
  // statement_timeout에 가끔(불규칙하게) 걸리는 걸 실제로 겪었다(export 쪽과 동일 원인) -
  // 몇 번 재시도하면 대체로 통과해서 재시도로 흡수한다.
  let data: unknown[] | null = null;
  let lastError: { code?: string; message: string } | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
    const result = await supabase.rpc("list_titles_unified", {
      filter_platform: opts.platform ?? "all",
      filter_type: opts.type ?? "all",
      filter_status: opts.status ?? "all",
      sort_by: opts.sortBy ?? "name",
      page_num: opts.page ?? 1,
      page_size: opts.pageSize ?? 50,
      filter_adult_only: opts.adultOnly ?? false,
      filter_launch_from: opts.launchFrom ?? null,
      filter_launch_to: opts.launchTo ?? null,
      filter_genre: opts.genre ?? "all",
    });
    if (!result.error) {
      data = result.data;
      break;
    }
    lastError = result.error;
    if (result.error.code !== "57014") break; // statement timeout 외의 에러는 재시도해도 소용없음
  }
  if (data === null) throw lastError;
  const rows = (data ?? []) as (UnifiedTitleListRow & { total_count: number })[];
  const totalCount = rows[0]?.total_count ?? 0;
  return { rows: rows.map(({ total_count: _total_count, ...r }) => r), totalCount };
}

function getKstMondayDateString(): string {
  const now = new Date();
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const day = kst.getDay(); // 0=일요일 ... 6=토요일
  const diffToMonday = day === 0 ? 6 : day - 1;
  kst.setDate(kst.getDate() - diffToMonday);
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, "0");
  const d = String(kst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 이번주(월요일~오늘, KST)에 1화가 등록된 연재중인 신작 - 홈 화면 "이번주 신작"용 */
export async function getTitlesLaunchedThisWeek(): Promise<TitleListRow[]> {
  const monday = getKstMondayDateString();
  const { rows } = await listTitles({
    status: "ongoing",
    launchFrom: monday,
    sortBy: "launch",
    pageSize: 200,
  });
  return rows;
}

/** 제작사명 직접 수정 - 홈 화면에서 다중/빈값 바로 고치기용 */
export async function updateTitleStudioName(titleId: number, studioName: string): Promise<void> {
  assertAdminAccess();
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("titles")
    .update({ studio_name: studioName || null })
    .eq("title_id", titleId);
  if (error) throw error;
}

export interface StudioFixRow {
  title_id: number;
  title_name: string;
  thumbnail_url: string | null;
  studio_name: string | null;
  is_novel_origin: boolean;
  weekday: string | null;
  popularity_rank: number | null;
  launch_date: string | null;
  download_count: number | null;
  total_comment_count: number | null;
  star_score: number | null;
}

/** 제작사가 다중/빈값이라 수정이 필요한 작품 전체(연재중+휴재중, 완결 제외) - 홈 화면용 */
export async function getTitlesNeedingStudioFix(): Promise<StudioFixRow[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("titles")
    .select("title_id,title_name,thumbnail_url,studio_name,is_novel_origin")
    .eq("is_active", true)
    .eq("is_finished", false)
    .or("studio_name.eq.다중,studio_name.is.null,studio_name.eq.")
    .order("title_name", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as Omit<StudioFixRow, "weekday" | "popularity_rank" | "launch_date" | "download_count" | "total_comment_count" | "star_score">[];
  const perfMap = await getNaverTitlesPerf(rows.map((r) => r.title_id));
  return rows.map((r) => {
    const perf = perfMap.get(r.title_id);
    return {
      ...r,
      weekday: perf?.weekday ?? null,
      popularity_rank: perf?.popularity_rank ?? null,
      launch_date: perf?.launch_date ?? null,
      download_count: perf?.download_count ?? null,
      total_comment_count: perf?.total_comment_count ?? null,
      star_score: perf?.star_score ?? null,
    };
  });
}

export interface StudioTitleRow {
  id: number;
  platform: "naver" | "kakao";
  title_name: string;
  thumbnail_url: string | null;
  studio_name: string;
  studio_website_url: string | null;
  weekday: string | null;
  popularity_rank: number | null;
  star_score: number | null;
  download_count: number | null;
  view_count: number | null;
  like_count: number | null;
  launch_date: string | null;
  total_comment_count: number | null;
}

export interface StudioGroup {
  studioName: string;
  studioWebsiteUrl: string | null;
  totalDownloadCount: number;
  totalViewCount: number;
  titles: StudioTitleRow[];
}

interface NaverStudioRow {
  title_id: number;
  title_name: string;
  thumbnail_url: string | null;
  studio_name: string;
  studio_website_url: string | null;
  weekday: string | null;
  popularity_rank: number | null;
  star_score: number | null;
  download_count: number | null;
  launch_date: string | null;
  total_comment_count: number | null;
}

interface KakaoStudioRow {
  content_id: number;
  title_name: string;
  thumbnail_url: string | null;
  studio_name: string;
  view_count: number | null;
  like_count: number | null;
  launch_date: string | null;
}

function sumDownloadCount(titles: StudioTitleRow[]): number {
  return titles.reduce((sum, t) => sum + (t.download_count ?? 0), 0);
}

function sumViewCount(titles: StudioTitleRow[]): number {
  return titles.reduce((sum, t) => sum + (t.view_count ?? 0), 0);
}

function sortStudioTitles(titles: StudioTitleRow[]): StudioTitleRow[] {
  return titles.sort((a, b) => {
    const rankA = a.popularity_rank ?? Infinity;
    const rankB = b.popularity_rank ?? Infinity;
    if (rankA !== rankB) return rankA - rankB;
    return (b.star_score ?? 0) - (a.star_score ?? 0);
  });
}

/** 네이버/카카오 원본 행을 공통 StudioTitleRow 형태로 합치기 - getTitlesByStudio/getStudioTitles가 공유 */
async function fetchAllStudioTitles(): Promise<StudioTitleRow[]> {
  const supabase = getSupabaseAnon();
  const [naverResult, kakaoResult] = await Promise.all([
    supabase.rpc("titles_by_studio"),
    supabase.rpc("kakao_titles_by_studio"),
  ]);
  if (naverResult.error) throw naverResult.error;
  if (kakaoResult.error) throw kakaoResult.error;

  const naverRows = ((naverResult.data ?? []) as NaverStudioRow[]).map(
    (r): StudioTitleRow => ({
      id: r.title_id,
      platform: "naver",
      title_name: r.title_name,
      thumbnail_url: r.thumbnail_url,
      studio_name: r.studio_name,
      studio_website_url: r.studio_website_url,
      weekday: r.weekday,
      popularity_rank: r.popularity_rank,
      star_score: r.star_score,
      download_count: r.download_count,
      view_count: null,
      like_count: null,
      launch_date: r.launch_date,
      total_comment_count: r.total_comment_count,
    })
  );
  const kakaoRows = ((kakaoResult.data ?? []) as KakaoStudioRow[]).map(
    (r): StudioTitleRow => ({
      id: r.content_id,
      platform: "kakao",
      title_name: r.title_name,
      thumbnail_url: r.thumbnail_url,
      studio_name: r.studio_name,
      studio_website_url: null,
      weekday: null,
      popularity_rank: null,
      star_score: null,
      download_count: null,
      view_count: r.view_count,
      like_count: r.like_count,
      launch_date: r.launch_date,
      total_comment_count: null,
    })
  );
  return [...naverRows, ...kakaoRows];
}

/** 제작사별로 그룹핑한 작품 목록 (제목/인기순위/다운로드수 합계 포함 카드용, 작품 수 많은 제작사 순).
 * 네이버/카카오 양쪽에서 studio_name 문자열이 같으면 같은 그룹으로 합쳐진다. */
export async function getTitlesByStudio(): Promise<StudioGroup[]> {
  const rows = await fetchAllStudioTitles();

  const groups = new Map<string, StudioTitleRow[]>();
  for (const row of rows) {
    const list = groups.get(row.studio_name) ?? [];
    list.push(row);
    groups.set(row.studio_name, list);
  }

  return [...groups.entries()]
    .map(([studioName, titles]) => ({
      studioName,
      studioWebsiteUrl: titles.find((t) => t.studio_website_url)?.studio_website_url ?? null,
      totalDownloadCount: sumDownloadCount(titles),
      totalViewCount: sumViewCount(titles),
      titles: sortStudioTitles(titles),
    }))
    .sort((a, b) => b.titles.length - a.titles.length || a.studioName.localeCompare(b.studioName, "ko"));
}

/** 특정 제작사(별칭 반영된 대표 표기)의 작품만 조회 - 제작사 상세페이지 작품 탭용 */
export async function getStudioTitles(studioName: string): Promise<StudioGroup | null> {
  const rows = (await fetchAllStudioTitles()).filter((r) => r.studio_name === studioName);
  if (rows.length === 0) return null;
  return {
    studioName,
    studioWebsiteUrl: rows.find((t) => t.studio_website_url)?.studio_website_url ?? null,
    totalDownloadCount: sumDownloadCount(rows),
    totalViewCount: sumViewCount(rows),
    titles: sortStudioTitles(rows),
  };
}

/**
 * 제작사 엑셀 다운로드용 - export_titles_data_unified와 같은 컬럼을 채우되, 전체 카탈로그를
 * 훑는 무거운 쿼리 대신 대상 작품 id로만 좁힌 가벼운 조회 여러 개로 조합한다.
 * (export_titles_data_unified를 그대로 쓰고 JS에서 studio_name으로 걸러내는 방식은 실제로
 * anon 롤 statement_timeout을 자주 일으켜서 - 확인함 - 이 방식으로 바꿈)
 * getExportTitlesForStudio(제작사 1곳)와 getExportTitlesForAllStudios(전체)가 공유.
 */
async function enrichStudioTitleRows(titles: StudioTitleRow[]): Promise<ExportTitleRowUnified[]> {
  const supabase = getSupabaseAnon();
  const naverIds = titles.filter((t) => t.platform === "naver").map((t) => t.id);
  const kakaoIds = titles.filter((t) => t.platform === "kakao").map((t) => t.id);

  const naverExtra = new Map<
    number,
    {
      is_finished: boolean;
      is_on_hiatus: boolean;
      is_adult: boolean;
      age_rating: string | null;
      writer: string | null;
      painter: string | null;
      origin_author: string | null;
    }
  >();
  const genreByTitle = new Map<number, string>();
  const launchByTitle = new Map<number, string>();
  const commentByTitle = new Map<number, number>();
  const notesByTitle = new Map<
    number,
    { subject: string | null; logline: string | null; target_audience: string | null; comment: string | null }
  >();

  if (naverIds.length > 0) {
    const [{ data: titleRows }, { data: tagRows }, { data: episodeRows }, { data: notesRows }, { data: latestDate }] =
      await Promise.all([
        supabase
          .from("titles")
          .select("title_id,is_finished,is_on_hiatus,is_adult,age_rating,writer,painter,origin_author")
          .in("title_id", naverIds),
        supabase.from("title_tags").select("title_id,tag_name").eq("tag_type", "GENRE").in("title_id", naverIds),
        supabase.from("episodes").select("title_id,service_date").in("title_id", naverIds),
        supabase
          .from("title_notes")
          .select("title_id,subject,logline,target_audience,comment")
          .in("title_id", naverIds),
        supabase.from("comment_snapshots").select("snapshot_date").order("snapshot_date", { ascending: false }).limit(1),
      ]);
    for (const t of titleRows ?? []) naverExtra.set(t.title_id, t);
    for (const t of tagRows ?? []) {
      genreByTitle.set(t.title_id, [genreByTitle.get(t.title_id), t.tag_name].filter(Boolean).join(", "));
    }
    for (const e of episodeRows ?? []) {
      if (!e.service_date) continue;
      const cur = launchByTitle.get(e.title_id);
      if (!cur || e.service_date < cur) launchByTitle.set(e.title_id, e.service_date);
    }
    for (const n of notesRows ?? []) notesByTitle.set(n.title_id, n);

    const lastDate = latestDate?.[0]?.snapshot_date as string | undefined;
    if (lastDate) {
      const PAGE_SIZE = 1000;
      // 1단계: 전체 최신 날짜 기준으로 한 번에 조회 (연재중인 작품 대다수는 이걸로 끝남).
      // 작품당 회차 수가 많으면 행 수가 PostgREST 기본 상한(1000)을 넘어 뒤쪽 작품들의 댓글
      // 합계가 조용히 0으로 빠지는 문제가 실제로 있었다 - 페이지네이션으로 수정.
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data: commentRows, error } = await supabase
          .from("comment_snapshots")
          .select("title_id,comment_count")
          .eq("snapshot_date", lastDate)
          .in("title_id", naverIds)
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) break;
        for (const c of commentRows ?? []) {
          commentByTitle.set(c.title_id, (commentByTitle.get(c.title_id) ?? 0) + c.comment_count);
        }
        if (!commentRows || commentRows.length < PAGE_SIZE) break;
      }

      // 2단계: 완결작은 밤샘 수집기가 더 이상 돌지 않아(연재중인 작품만 수집 - 원래 설계)
      // 전체 최신 날짜엔 스냅샷이 없다. 1단계에서 못 찾은 나머지(보통 완결작 소수)만 대상으로
      // 각자의 가장 최근 날짜를 구하는데, (title_id, no, snapshot_date desc) 인덱스를 타도록
      // 작품마다 별도의 작은 쿼리로 조회한다 - 전체를 date desc로 훑으면(페이지네이션) 대상
      // 작품들의 오래된 히스토리 전체를 다 넘겨야 해서 훨씬 느리다 (실측: 53페이지/2.7초 대
      // 병렬 소쿼리는 수백ms 수준).
      const missingIds = naverIds.filter((id) => !commentByTitle.has(id));
      if (missingIds.length > 0) {
        const latestDates = await Promise.all(
          missingIds.map(async (id) => {
            const { data } = await supabase
              .from("comment_snapshots")
              .select("snapshot_date")
              .eq("title_id", id)
              .order("snapshot_date", { ascending: false })
              .limit(1);
            return { id, date: data?.[0]?.snapshot_date as string | undefined };
          })
        );
        await Promise.all(
          latestDates
            .filter((d): d is { id: number; date: string } => !!d.date)
            .map(async ({ id, date }) => {
              const { data } = await supabase
                .from("comment_snapshots")
                .select("comment_count")
                .eq("title_id", id)
                .eq("snapshot_date", date);
              const sum = (data ?? []).reduce((acc, r) => acc + r.comment_count, 0);
              commentByTitle.set(id, sum);
            })
        );
      }
    }
  }

  const kakaoExtra = new Map<
    number,
    {
      is_finished: boolean;
      is_on_hiatus: boolean;
      is_adult: boolean;
      age_rating: string | null;
      writer: string | null;
      painter: string | null;
      origin_author: string | null;
      genres: string[] | null;
    }
  >();
  if (kakaoIds.length > 0) {
    const { data: kakaoRows } = await supabase
      .from("kakao_titles")
      .select("content_id,is_finished,is_on_hiatus,is_adult,age_rating,writer,painter,origin_author,genres")
      .in("content_id", kakaoIds);
    for (const t of kakaoRows ?? []) kakaoExtra.set(t.content_id, t);
  }

  return titles.map((t): ExportTitleRowUnified => {
    if (t.platform === "naver") {
      const extra = naverExtra.get(t.id);
      const notes = notesByTitle.get(t.id);
      return {
        id: t.id,
        platform: "naver",
        title_name: t.title_name,
        thumbnail_url: t.thumbnail_url,
        weekday: t.weekday,
        is_adult: extra?.is_adult ?? false,
        age_rating: extra?.age_rating ?? null,
        writer: extra?.writer ?? null,
        painter: extra?.painter ?? null,
        origin_author: extra?.origin_author ?? null,
        studio_name: t.studio_name,
        is_finished: extra?.is_finished ?? false,
        is_on_hiatus: extra?.is_on_hiatus ?? false,
        star_score: t.star_score,
        popularity_rank: t.popularity_rank,
        launch_date: launchByTitle.get(t.id) ?? null,
        total_comment_count: commentByTitle.get(t.id) ?? null,
        download_count: t.download_count,
        view_count: null,
        like_count: null,
        genre: genreByTitle.get(t.id) ?? null,
        subject: notes?.subject ?? null,
        logline: notes?.logline ?? null,
        target_audience: notes?.target_audience ?? null,
        comment: notes?.comment ?? null,
      };
    }
    const extra = kakaoExtra.get(t.id);
    return {
      id: t.id,
      platform: "kakao",
      title_name: t.title_name,
      thumbnail_url: t.thumbnail_url,
      weekday: null,
      is_adult: extra?.is_adult ?? false,
      age_rating: extra?.age_rating ?? null,
      writer: extra?.writer ?? null,
      painter: extra?.painter ?? null,
      origin_author: extra?.origin_author ?? null,
      studio_name: t.studio_name,
      is_finished: extra?.is_finished ?? false,
      is_on_hiatus: extra?.is_on_hiatus ?? false,
      star_score: null,
      popularity_rank: null,
      launch_date: null,
      total_comment_count: null,
      download_count: null,
      view_count: t.view_count,
      like_count: t.like_count,
      genre: extra?.genres && extra.genres.length > 0 ? extra.genres.join(", ") : null,
      subject: null,
      logline: null,
      target_audience: null,
      comment: null,
    };
  });
}

/** 제작사 1곳 엑셀 다운로드용 */
export async function getExportTitlesForStudio(studioName: string): Promise<ExportTitleRowUnified[]> {
  const studio = await getStudioTitles(studioName);
  if (!studio) return [];
  return enrichStudioTitleRows(studio.titles);
}

/** 제작사별 작품 전체 엑셀 다운로드용(제작사 목록 페이지) */
export async function getExportTitlesForAllStudios(): Promise<ExportTitleRowUnified[]> {
  const groups = await getTitlesByStudio();
  return enrichStudioTitleRows(groups.flatMap((g) => g.titles));
}

export interface JobPostingRow {
  source: "SARAMIN" | "JOBKOREA";
  postingId: string;
  title: string;
  url: string;
  status: "ACTIVE" | "CLOSED";
  dday: string | null;
  applied: boolean;
  starred: boolean;
}

/** source+posting_id -> applied_at 존재 여부(지원 표시된 공고 키 집합) */
async function getAppliedPostingKeys(): Promise<Set<string>> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase.from("job_posting_applications").select("source,posting_id");
  if (error) throw error;
  return new Set((data ?? []).map((r) => `${r.source}_${r.posting_id}`));
}

/**
 * source+posting_id -> starred_at 존재 여부(별표 표시된 공고 키 집합). job_posting_stars는
 * title_private_notes와 동일하게 select 정책이 없어서 anon 키로는 조회가 안 됨 - 그래서
 * anon이 아니라 admin 클라이언트로만 읽고, hasAdminAccess()가 false인 공유 배포에서는 조회
 * 자체를 생략하고 빈 집합을 반환해 별표 여부가 화면에 절대 드러나지 않게 한다.
 */
async function getStarredPostingKeys(): Promise<Set<string>> {
  if (!hasAdminAccess()) return new Set();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("job_posting_stars").select("source,posting_id");
  if (error) throw error;
  return new Set((data ?? []).map((r) => `${r.source}_${r.posting_id}`));
}

/** 특정 제작사의 채용공고 전체(진행중+마감) - 제작사 상세페이지 채용공고 탭용 */
export async function getStudioJobPostings(studioName: string): Promise<JobPostingRow[]> {
  const supabase = getSupabaseAnon();
  const [{ data, error }, appliedKeys, starredKeys] = await Promise.all([
    supabase
      .from("studio_job_postings")
      .select("source,posting_id,title,url,status,dday")
      .eq("studio_name", studioName)
      .order("status", { ascending: true })
      .order("title", { ascending: true }),
    getAppliedPostingKeys(),
    getStarredPostingKeys(),
  ]);
  if (error) throw error;
  return ((data ?? []) as (Omit<JobPostingRow, "postingId" | "applied" | "starred"> & { posting_id: string })[]).map(
    (r) => ({
      source: r.source,
      postingId: r.posting_id,
      title: r.title,
      url: r.url,
      status: r.status,
      dday: r.dday,
      applied: appliedKeys.has(`${r.source}_${r.posting_id}`),
      starred: starredKeys.has(`${r.source}_${r.posting_id}`),
    })
  );
}

export interface KeywordJobPostingRow {
  source: "SARAMIN" | "JOBKOREA";
  postingId: string;
  title: string;
  companyName: string | null;
  url: string;
  status: "ACTIVE" | "CLOSED";
  dday: string | null;
  applied: boolean;
  starred: boolean;
}

/** 특정 제작사에 안 묶인 키워드 검색 채용공고("웹툰PD" 등) - 채용공고 페이지 키워드 섹션용 */
export async function getKeywordJobPostings(keyword: string): Promise<KeywordJobPostingRow[]> {
  const supabase = getSupabaseAnon();
  const [{ data, error }, appliedKeys, starredKeys] = await Promise.all([
    supabase
      .from("keyword_job_postings")
      .select("source,posting_id,title,company_name,url,status,dday")
      .eq("keyword", keyword)
      .eq("status", "ACTIVE")
      .order("company_name", { ascending: true }),
    getAppliedPostingKeys(),
    getStarredPostingKeys(),
  ]);
  if (error) throw error;
  return ((data ?? []) as (Omit<KeywordJobPostingRow, "postingId" | "companyName" | "applied" | "starred"> & {
    posting_id: string;
    company_name: string | null;
  })[]).map((r) => ({
    source: r.source,
    postingId: r.posting_id,
    title: r.title,
    companyName: r.company_name,
    url: r.url,
    status: r.status,
    dday: r.dday,
    applied: appliedKeys.has(`${r.source}_${r.posting_id}`),
    starred: starredKeys.has(`${r.source}_${r.posting_id}`),
  }));
}

export interface ActiveJobPostingGroup {
  studioName: string;
  postings: JobPostingRow[];
}

/** 전체 제작사의 현재 진행중인 채용공고 - 채용공고 탭용 */
export async function getActiveJobPostingsByStudio(): Promise<ActiveJobPostingGroup[]> {
  const supabase = getSupabaseAnon();
  const [{ data, error }, appliedKeys, starredKeys] = await Promise.all([
    supabase
      .from("studio_job_postings")
      .select("studio_name,source,posting_id,title,url,status,dday")
      .eq("status", "ACTIVE")
      .order("studio_name", { ascending: true }),
    getAppliedPostingKeys(),
    getStarredPostingKeys(),
  ]);
  if (error) throw error;
  const rows = (data ?? []) as (Omit<JobPostingRow, "postingId" | "applied" | "starred"> & {
    studio_name: string;
    posting_id: string;
  })[];

  const groups = new Map<string, JobPostingRow[]>();
  for (const row of rows) {
    const list = groups.get(row.studio_name) ?? [];
    list.push({
      source: row.source,
      postingId: row.posting_id,
      title: row.title,
      url: row.url,
      status: row.status,
      dday: row.dday,
      applied: appliedKeys.has(`${row.source}_${row.posting_id}`),
      starred: starredKeys.has(`${row.source}_${row.posting_id}`),
    });
    groups.set(row.studio_name, list);
  }
  return [...groups.entries()].map(([studioName, postings]) => ({ studioName, postings }));
}

/** 채용공고를 실제로 수집 중인(사람인/잡코리아 링크가 등록된) 제작사 이름 목록 - 채용공고 탭 필터용.
 * 여기 없는 제작사는 "공고가 없는" 게 아니라 애초에 수집 대상이 아닌 것이라 구분이 필요함. */
export async function getTrackedRecruitStudioNames(): Promise<string[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("studio_recruit_links")
    .select("studio_name")
    .order("studio_name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => r.studio_name);
}

/** 채용공고 지원 여부 토글(존재 = 지원함) */
export async function setJobApplied(source: string, postingId: string, applied: boolean): Promise<void> {
  assertAdminAccess();
  const supabase = getSupabaseAdmin();
  if (applied) {
    const { error } = await supabase
      .from("job_posting_applications")
      .upsert({ source, posting_id: postingId }, { onConflict: "source,posting_id" });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("job_posting_applications")
      .delete()
      .eq("source", source)
      .eq("posting_id", postingId);
    if (error) throw error;
  }
}

/** 채용공고 별표 토글(존재 = 별표됨). 공유 배포에서는 assertAdminAccess에서 막힘 */
export async function setJobStarred(source: string, postingId: string, starred: boolean): Promise<void> {
  assertAdminAccess();
  const supabase = getSupabaseAdmin();
  if (starred) {
    const { error } = await supabase
      .from("job_posting_stars")
      .upsert({ source, posting_id: postingId }, { onConflict: "source,posting_id" });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("job_posting_stars")
      .delete()
      .eq("source", source)
      .eq("posting_id", postingId);
    if (error) throw error;
  }
}

export interface ManualJobPostingRow {
  id: number;
  title: string;
  companyName: string | null;
  url: string;
  deadlineDate: string | null;
  isClosed: boolean;
}

/** 사람인/잡코리아 자동 수집 대상이 아닌 곳(회사 홈페이지 등)에 올라온 공고를 직접 등록한 목록.
 * 공유 URL에서도 보이는 공개 기능(anon SELECT 허용) - 쓰기만 관리자 전용. */
export async function getManualJobPostings(): Promise<ManualJobPostingRow[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("manual_job_postings")
    .select("id,title,company_name,url,deadline_date,is_closed")
    .order("is_closed", { ascending: true })
    .order("deadline_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as { id: number; title: string; company_name: string | null; url: string; deadline_date: string | null; is_closed: boolean }[]).map(
    (r) => ({
      id: r.id,
      title: r.title,
      companyName: r.company_name,
      url: r.url,
      deadlineDate: r.deadline_date,
      isClosed: r.is_closed,
    })
  );
}

/** 직접 등록한 공고 추가 */
export async function addManualJobPosting(input: {
  title: string;
  companyName: string;
  url: string;
  deadlineDate: string;
}): Promise<void> {
  assertAdminAccess();
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("manual_job_postings").insert({
    title: input.title,
    company_name: input.companyName || null,
    url: input.url,
    deadline_date: input.deadlineDate || null,
  });
  if (error) throw error;
}

/** 직접 등록한 공고 마감 처리 토글 */
export async function setManualJobPostingClosed(id: number, closed: boolean): Promise<void> {
  assertAdminAccess();
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("manual_job_postings").update({ is_closed: closed }).eq("id", id);
  if (error) throw error;
}

/** 직접 등록한 공고 삭제 */
export async function deleteManualJobPosting(id: number): Promise<void> {
  assertAdminAccess();
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("manual_job_postings").delete().eq("id", id);
  if (error) throw error;
}

/**
 * 채용정보 링크 등록 여부 - 제작사 상세페이지에서 메시지 분기용.
 * null: studio_recruit_links에 아예 등록 안 됨 -> "사이트 내 기업 정보가 없습니다."
 * 등록은 됐지만 공고가 0건 -> "현재 진행 중인 공고가 없습니다."
 */
export async function getStudioRecruitLinkInfo(
  studioName: string
): Promise<{ hasSaramin: boolean; hasJobKorea: boolean } | null> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("studio_recruit_links")
    .select("saramin_url,jobkorea_url")
    .eq("studio_name", studioName)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { hasSaramin: !!data.saramin_url, hasJobKorea: !!data.jobkorea_url };
}

export interface DownloadRankRow {
  title_id: number;
  title_name: string;
  thumbnail_url: string | null;
  studio_name: string | null;
  download_count: number;
  is_novel_origin: boolean;
  weekday: string | null;
  launch_date: string | null;
  total_comment_count: number | null;
  star_score: number | null;
}

/** 다운로드수 상위 작품 랭킹(제작사 포함) - 홈 화면용 */
export async function getTopTitlesByDownload(limit = 10): Promise<DownloadRankRow[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase.rpc("top_titles_by_download", { result_limit: limit });
  if (error) throw error;
  return (data ?? []) as DownloadRankRow[];
}

export type TagType = "GENRE" | "KEYWORD";

export interface TagStatRow {
  tag_name: string;
  title_count: number;
}

/** 장르/키워드별 통계 (연재중인 작품 기준, 작품 수 많은 순) - 네이버 태그(article/list/info) 그대로 집계 */
export async function getTagStats(tagType: TagType, limit = 15): Promise<TagStatRow[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase.rpc("tag_stats", {
    tag_type_filter: tagType,
    result_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as TagStatRow[];
}

/** 작품의 장르 태그 목록 (title_tags에 매일 수집기가 저장해둔 값) */
export async function getTitleGenres(titleId: number): Promise<string[]> {
  const supabase = getSupabaseAnon();
  const { data } = await supabase
    .from("title_tags")
    .select("tag_name")
    .eq("title_id", titleId)
    .eq("tag_type", "GENRE");
  return (data ?? []).map((r) => r.tag_name as string);
}

// ===================== 카카오웹툰 =====================

export interface KakaoTitleRow {
  content_id: number;
  seo_id: string;
  title_name: string;
  thumbnail_url: string | null;
  writer: string | null;
  painter: string | null;
  origin_author: string | null;
  studio_name: string | null;
  synopsis: string | null;
  genres: string[];
  is_adult: boolean;
  is_finished: boolean;
  is_on_hiatus: boolean;
  is_new: boolean;
  is_active: boolean;
  age_rating: string | null;
}

const KAKAO_TITLE_SELECT =
  "content_id,seo_id,title_name,thumbnail_url,writer,painter,origin_author,studio_name,synopsis,genres,is_adult,is_finished,is_on_hiatus,is_new,is_active,age_rating";

/** 작품명으로 검색 (연재중인 작품만) */
export async function searchKakaoTitles(query: string): Promise<KakaoTitleRow[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("kakao_titles")
    .select(KAKAO_TITLE_SELECT)
    .eq("is_active", true)
    .ilike("title_name", `%${query}%`)
    .order("title_name")
    .limit(50);
  if (error) throw error;
  return (data ?? []) as KakaoTitleRow[];
}

export async function getKakaoTitle(contentId: number): Promise<KakaoTitleRow | null> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("kakao_titles")
    .select(KAKAO_TITLE_SELECT)
    .eq("content_id", contentId)
    .maybeSingle();
  if (error) throw error;
  return data as KakaoTitleRow | null;
}

export interface KakaoEpisodeRow {
  content_id: number;
  no: number;
  title: string | null;
  service_date: string | null;
  use_type: string;
}

/** 작품의 회차 목록 (최신순). 카카오는 댓글수를 추적하지 않아 회차 정보만 반환 */
export async function getKakaoEpisodes(contentId: number): Promise<KakaoEpisodeRow[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("kakao_episodes")
    .select("content_id,no,title,service_date,use_type")
    .eq("content_id", contentId)
    .order("no", { ascending: false });
  if (error) throw error;
  return (data ?? []) as KakaoEpisodeRow[];
}

export interface KakaoStatPoint {
  snapshot_date: string;
  view_count: number | null;
  like_count: number | null;
}

/** 작품의 날짜별 조회수/좋아요수 추이 */
export async function getKakaoStatHistory(contentId: number): Promise<KakaoStatPoint[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("kakao_stat_snapshots")
    .select("snapshot_date,view_count,like_count")
    .eq("content_id", contentId)
    .order("snapshot_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as KakaoStatPoint[];
}

export interface KakaoTopRow {
  content_id: number;
  title_name: string;
  thumbnail_url: string | null;
  studio_name: string | null;
  view_count: number | null;
  like_count: number | null;
  launch_date: string | null;
}

/** 조회수/좋아요수 상위 작품 랭킹 - 카카오 홈 화면용 */
export async function getKakaoTopTitles(sortBy: "views" | "likes" = "views", limit = 10): Promise<KakaoTopRow[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase.rpc("kakao_top_titles", { sort_by: sortBy, result_limit: limit });
  if (error) throw error;
  return (data ?? []) as KakaoTopRow[];
}

export interface KakaoNewLaunchRow {
  content_id: number;
  title_name: string;
  thumbnail_url: string | null;
  launch_date: string | null;
  view_count: number | null;
}

/** 카카오 사이트의 "신작" 카테고리(kakao_titles.is_new)에 속하면서 최근 daysBack일 안에
 * 1화가 등록된 작품 - 카카오 홈 화면용 */
export async function getKakaoTitlesLaunchedRecently(daysBack = 7): Promise<KakaoNewLaunchRow[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase.rpc("kakao_titles_launched_recently", { days_back: daysBack });
  if (error) throw error;
  return (data ?? []) as KakaoNewLaunchRow[];
}

export interface KakaoStudioFixRow {
  content_id: number;
  title_name: string;
  thumbnail_url: string | null;
  launch_date: string | null;
  view_count: number | null;
}

/** 제작사 정보가 비어있는 연재중 작품 전체 - 카카오 홈 화면 "제작사 정보 필요"용 */
export async function getKakaoTitlesNeedingStudioFix(): Promise<KakaoStudioFixRow[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase.rpc("kakao_titles_needing_studio_fix");
  if (error) throw error;
  return (data ?? []) as KakaoStudioFixRow[];
}

/** 카카오 작품 제작사명 직접 수정 - 홈 화면에서 빈값 바로 고치기용 */
export async function updateKakaoTitleStudioName(contentId: number, studioName: string): Promise<void> {
  assertAdminAccess();
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("kakao_titles")
    .update({ studio_name: studioName || null })
    .eq("content_id", contentId);
  if (error) throw error;
}

export type UnifiedSearchPlatform = "naver" | "kakao";

export interface UnifiedSearchResult {
  platform: UnifiedSearchPlatform;
  id: number;
  titleName: string;
  thumbnailUrl: string | null;
  author: string | null;
  isAdult: boolean;
  isNovelOrigin: boolean;
  launchDate: string | null;
  weekday: string | null;
  popularityRank: number | null;
  downloadCount: number | null;
  totalCommentCount: number | null;
  viewCount: number | null;
  starScore: number | null;
}

/** 네이버/카카오 작품을 동시에 검색해 플랫폼 구분된 결과로 합쳐 반환 (홈 화면 통합검색용) */
export async function unifiedSearch(query: string): Promise<UnifiedSearchResult[]> {
  const [naverResults, kakaoResults] = await Promise.all([searchTitles(query), searchKakaoTitles(query)]);
  const [naverPerfMap, kakaoPerfMap] = await Promise.all([
    getNaverTitlesPerf(naverResults.map((t) => t.title_id)),
    getKakaoTitlesPerf(kakaoResults.map((t) => t.content_id)),
  ]);
  const combined: UnifiedSearchResult[] = [
    ...naverResults.map((t) => {
      const perf = naverPerfMap.get(t.title_id);
      return {
        platform: "naver" as const,
        id: t.title_id,
        titleName: t.title_name,
        thumbnailUrl: t.thumbnail_url,
        author: t.author,
        isAdult: t.is_adult,
        isNovelOrigin: t.is_novel_origin,
        launchDate: perf?.launch_date ?? null,
        weekday: perf?.weekday ?? null,
        popularityRank: perf?.popularity_rank ?? null,
        downloadCount: perf?.download_count ?? null,
        totalCommentCount: perf?.total_comment_count ?? null,
        viewCount: null,
        starScore: perf?.star_score ?? null,
      };
    }),
    ...kakaoResults.map((t) => {
      const perf = kakaoPerfMap.get(t.content_id);
      return {
        platform: "kakao" as const,
        id: t.content_id,
        titleName: t.title_name,
        thumbnailUrl: t.thumbnail_url,
        author: [t.writer, t.painter].filter((v, i, arr) => v && arr.indexOf(v) === i).join(" / ") || null,
        isAdult: t.is_adult,
        // 카카오는 원작 크레딧 데이터 구조가 달라 소설원작 여부를 아직 판별하지 않음
        isNovelOrigin: false,
        launchDate: perf?.launch_date ?? null,
        weekday: null,
        popularityRank: null,
        downloadCount: null,
        totalCommentCount: null,
        viewCount: perf?.view_count ?? null,
        starScore: null,
      };
    }),
  ];
  return combined.sort((a, b) => a.titleName.localeCompare(b.titleName, "ko"));
}

// --- 관심작품(닉네임 기반, 로그인 없음) ---
// 댓글수/다운로드수 비교가 네이버 데이터에서만 가능해(카카오는 댓글수 자체가 없음) 네이버 title_id만 대상으로 함.
// user_watchlist는 이 사이트에서 유일하게 anon 키로 쓰기(추가/삭제)가 허용된 테이블.

export interface WatchlistEntry {
  titleId: number;
  createdAt: string;
}

export async function getWatchlist(userName: string): Promise<WatchlistEntry[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("user_watchlist")
    .select("title_id,created_at")
    .eq("user_name", userName)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({ titleId: r.title_id as number, createdAt: r.created_at as string }));
}

export async function isTitleWatchlisted(userName: string, titleId: number): Promise<boolean> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("user_watchlist")
    .select("title_id")
    .eq("user_name", userName)
    .eq("title_id", titleId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function addToWatchlist(userName: string, titleId: number): Promise<void> {
  const supabase = getSupabaseAnon();
  const { error } = await supabase.from("user_watchlist").insert({ user_name: userName, title_id: titleId });
  if (error && error.code !== "23505") throw error; // 이미 추가된 작품(중복 pk)은 조용히 무시
}

export async function removeFromWatchlist(userName: string, titleId: number): Promise<void> {
  const supabase = getSupabaseAnon();
  const { error } = await supabase
    .from("user_watchlist")
    .delete()
    .eq("user_name", userName)
    .eq("title_id", titleId);
  if (error) throw error;
}

export interface TitleBasic {
  title_id: number;
  title_name: string;
  thumbnail_url: string | null;
  is_novel_origin: boolean;
}

export async function getTitlesBasic(titleIds: number[]): Promise<Map<number, TitleBasic>> {
  if (titleIds.length === 0) return new Map();
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("titles")
    .select("title_id,title_name,thumbnail_url,is_novel_origin")
    .in("title_id", titleIds);
  if (error) throw error;
  return new Map((data ?? []).map((t) => [t.title_id as number, t as TitleBasic]));
}

export interface TitleCommentHistoryPoint {
  snapshot_date: string;
  total_comment_count: number;
}

/** 작품 하나의 날짜별 총 댓글수 추이(회차별 누적 댓글수를 날짜별로 합산) */
export async function getTitleCommentHistory(titleId: number): Promise<TitleCommentHistoryPoint[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase.rpc("title_comment_history", { p_title_id: titleId });
  if (error) throw error;
  return (data ?? []) as TitleCommentHistoryPoint[];
}

/** getSeriesHistory의 title_id 기반 버전 (series_products에서 product_no를 먼저 찾음) */
export async function getDownloadHistoryByTitleId(titleId: number): Promise<SeriesSnapshotPoint[]> {
  const product = await getSeriesProductForTitle(titleId);
  if (!product) return [];
  return getSeriesHistory(product.productNo);
}
