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
    .select("title_id,title_name,author,thumbnail_url,is_active,is_finished,is_on_hiatus,is_adult,is_new,studio_name,studio_website_url,synopsis,writer,painter,origin_author")
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
    .select("title_id,title_name,author,thumbnail_url,is_active,is_finished,is_on_hiatus,is_adult,is_new,studio_name,studio_website_url,synopsis,writer,painter,origin_author")
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

export interface ExportTitleRowUnified {
  id: number;
  platform: "naver" | "kakao";
  title_name: string;
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
}): Promise<ExportTitleRowUnified[]> {
  const supabase = getSupabaseAnon();
  const PAGE_SIZE = 1000;
  const all: ExportTitleRowUnified[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .rpc("export_titles_data_unified", {
        filter_platform: opts.platform ?? "all",
        filter_status: opts.status ?? "all",
        filter_type: opts.type ?? "all",
        filter_adult_only: opts.adultOnly ?? false,
        filter_launch_from: opts.launchFrom ?? null,
        filter_launch_to: opts.launchTo ?? null,
        sort_by: opts.sortBy ?? "name",
      })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as ExportTitleRowUnified[];
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
    .select("rank,title_id,titles(title_name,thumbnail_url)")
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
  const { data, error } = await supabase
    .from("titles")
    .select("title_id,title_name,thumbnail_url")
    .in(
      "title_id",
      items.map((i) => i.titleId)
    );
  if (error) throw error;
  const titleMap = new Map((data ?? []).map((t) => [t.title_id, t]));
  return items.map((item) => {
    const title = titleMap.get(item.titleId);
    return {
      rank: item.rank,
      title_id: item.titleId,
      title_name: title?.title_name ?? "",
      thumbnail_url: title?.thumbnail_url ?? null,
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
    supabase.from("titles").select("title_id,thumbnail_url").in("title_id", titleIds),
  ]);
  if (error) throw error;
  if (titleError) throw titleError;

  const byProduct = new Map<number, { snapshot_date: string; download_count: number }[]>();
  for (const row of data ?? []) {
    const list = byProduct.get(row.product_no) ?? [];
    list.push({ snapshot_date: row.snapshot_date, download_count: row.download_count });
    byProduct.set(row.product_no, list);
  }
  const thumbnailByTitle = new Map((titleRows ?? []).map((t) => [t.title_id, t.thumbnail_url as string | null]));

  return SERIES_WATCHLIST.map((w) => {
    const history = byProduct.get(w.productNo) ?? [];
    const latest = history[0];
    const prev = history[1];
    return {
      product_no: w.productNo,
      title_id: w.titleId,
      title_name: w.name,
      thumbnail_url: thumbnailByTitle.get(w.titleId) ?? null,
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
  sortBy?: TitleSortBy | "views" | "likes";
  page?: number;
  pageSize?: number;
  adultOnly?: boolean;
  launchFrom?: string;
  launchTo?: string;
}): Promise<UnifiedTitleListResult> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase.rpc("list_titles_unified", {
    filter_platform: opts.platform ?? "all",
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
}

/** 제작사가 다중/빈값이라 수정이 필요한 작품 전체(연재중+휴재중, 완결 제외) - 홈 화면용 */
export async function getTitlesNeedingStudioFix(): Promise<StudioFixRow[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase
    .from("titles")
    .select("title_id,title_name,thumbnail_url,studio_name")
    .eq("is_active", true)
    .eq("is_finished", false)
    .or("studio_name.eq.다중,studio_name.is.null,studio_name.eq.")
    .order("title_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as StudioFixRow[];
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
}

interface KakaoStudioRow {
  content_id: number;
  title_name: string;
  thumbnail_url: string | null;
  studio_name: string;
  view_count: number | null;
  like_count: number | null;
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

export interface JobPostingRow {
  source: "SARAMIN" | "JOBKOREA";
  postingId: string;
  title: string;
  url: string;
  status: "ACTIVE" | "CLOSED";
  dday: string | null;
  applied: boolean;
}

/** source+posting_id -> applied_at 존재 여부(지원 표시된 공고 키 집합) */
async function getAppliedPostingKeys(): Promise<Set<string>> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase.from("job_posting_applications").select("source,posting_id");
  if (error) throw error;
  return new Set((data ?? []).map((r) => `${r.source}_${r.posting_id}`));
}

/** 특정 제작사의 채용공고 전체(진행중+마감) - 제작사 상세페이지 채용공고 탭용 */
export async function getStudioJobPostings(studioName: string): Promise<JobPostingRow[]> {
  const supabase = getSupabaseAnon();
  const [{ data, error }, appliedKeys] = await Promise.all([
    supabase
      .from("studio_job_postings")
      .select("source,posting_id,title,url,status,dday")
      .eq("studio_name", studioName)
      .order("status", { ascending: true })
      .order("title", { ascending: true }),
    getAppliedPostingKeys(),
  ]);
  if (error) throw error;
  return ((data ?? []) as (Omit<JobPostingRow, "postingId" | "applied"> & { posting_id: string })[]).map((r) => ({
    source: r.source,
    postingId: r.posting_id,
    title: r.title,
    url: r.url,
    status: r.status,
    dday: r.dday,
    applied: appliedKeys.has(`${r.source}_${r.posting_id}`),
  }));
}

export interface ActiveJobPostingGroup {
  studioName: string;
  postings: JobPostingRow[];
}

/** 전체 제작사의 현재 진행중인 채용공고 - 채용공고 탭용 */
export async function getActiveJobPostingsByStudio(): Promise<ActiveJobPostingGroup[]> {
  const supabase = getSupabaseAnon();
  const [{ data, error }, appliedKeys] = await Promise.all([
    supabase
      .from("studio_job_postings")
      .select("studio_name,source,posting_id,title,url,status,dday")
      .eq("status", "ACTIVE")
      .order("studio_name", { ascending: true }),
    getAppliedPostingKeys(),
  ]);
  if (error) throw error;
  const rows = (data ?? []) as (Omit<JobPostingRow, "postingId" | "applied"> & {
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
  studio_name: string | null;
  synopsis: string | null;
  genres: string[];
  is_adult: boolean;
  is_finished: boolean;
  is_on_hiatus: boolean;
  is_active: boolean;
  age_rating: string | null;
}

const KAKAO_TITLE_SELECT =
  "content_id,seo_id,title_name,thumbnail_url,writer,painter,studio_name,synopsis,genres,is_adult,is_finished,is_on_hiatus,is_active,age_rating";

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
}

/** 이번주(월요일~오늘, KST)에 1화가 등록된 연재중인 신작 - 카카오 홈 화면용 */
export async function getKakaoTitlesLaunchedThisWeek(): Promise<KakaoNewLaunchRow[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase.rpc("kakao_titles_launched_this_week", {
    monday_date: getKstMondayDateString(),
  });
  if (error) throw error;
  return (data ?? []) as KakaoNewLaunchRow[];
}

export type UnifiedSearchPlatform = "naver" | "kakao";

export interface UnifiedSearchResult {
  platform: UnifiedSearchPlatform;
  id: number;
  titleName: string;
  thumbnailUrl: string | null;
  author: string | null;
  isAdult: boolean;
}

/** 네이버/카카오 작품을 동시에 검색해 플랫폼 구분된 결과로 합쳐 반환 (홈 화면 통합검색용) */
export async function unifiedSearch(query: string): Promise<UnifiedSearchResult[]> {
  const [naverResults, kakaoResults] = await Promise.all([searchTitles(query), searchKakaoTitles(query)]);
  const combined: UnifiedSearchResult[] = [
    ...naverResults.map((t) => ({
      platform: "naver" as const,
      id: t.title_id,
      titleName: t.title_name,
      thumbnailUrl: t.thumbnail_url,
      author: t.author,
      isAdult: t.is_adult,
    })),
    ...kakaoResults.map((t) => ({
      platform: "kakao" as const,
      id: t.content_id,
      titleName: t.title_name,
      thumbnailUrl: t.thumbnail_url,
      author: [t.writer, t.painter].filter((v, i, arr) => v && arr.indexOf(v) === i).join(" / ") || null,
      isAdult: t.is_adult,
    })),
  ];
  return combined.sort((a, b) => a.titleName.localeCompare(b.titleName, "ko"));
}
