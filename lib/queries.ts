import { getSupabaseAnon } from "./supabase";
import { SERIES_WATCHLIST } from "./seriesWatchlist";

export interface TitleRow {
  title_id: number;
  title_name: string;
  author: string | null;
  thumbnail_url: string | null;
  is_active: boolean;
  is_finished: boolean;
  is_on_hiatus: boolean;
  studio_name: string | null;
  studio_website_url: string | null;
  synopsis: string | null;
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
    .select("title_id,title_name,author,thumbnail_url,is_active,is_finished,is_on_hiatus,studio_name,studio_website_url,synopsis")
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
    .select("title_id,title_name,author,thumbnail_url,is_active,is_finished,is_on_hiatus,studio_name,studio_website_url,synopsis")
    .eq("title_id", titleId)
    .maybeSingle();
  if (error) throw error;
  return data as TitleRow | null;
}

export interface EpisodeWithCount extends EpisodeRow {
  comment_count: number | null;
}

/** 작품의 회차 목록 + 최신 댓글수 (최신순) */
export async function getEpisodesWithLatestCount(titleId: number): Promise<EpisodeWithCount[]> {
  const supabase = getSupabaseAnon();
  const { data: episodes, error: episodesError } = await supabase
    .from("episodes")
    .select("title_id,no,subtitle,service_date,is_free")
    .eq("title_id", titleId)
    .order("no", { ascending: false });
  if (episodesError) throw episodesError;
  if (!episodes || episodes.length === 0) return [];

  const latestDate = await getLatestSnapshotDate();
  if (!latestDate) {
    return episodes.map((e) => ({ ...e, comment_count: null }));
  }

  const { data: snapshots, error: snapshotsError } = await supabase
    .from("comment_snapshots")
    .select("no,comment_count")
    .eq("title_id", titleId)
    .eq("snapshot_date", latestDate);
  if (snapshotsError) throw snapshotsError;

  const countByNo = new Map((snapshots ?? []).map((s) => [s.no, s.comment_count]));
  return episodes.map((e) => ({ ...e, comment_count: countByNo.get(e.no) ?? null }));
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

export interface StarRankingRow {
  title_id: number;
  title_name: string;
  thumbnail_url: string | null;
  star_score: number;
}

/** 평점 TOP N (네이버가 제공하지 않는 "전체 웹툰 랭킹"을 직접 계산) */
export async function getOverallStarRanking(limit = 10): Promise<StarRankingRow[]> {
  const supabase = getSupabaseAnon();
  const { data, error } = await supabase.rpc("overall_star_ranking", { result_limit: limit });
  if (error) throw error;
  return (data ?? []) as StarRankingRow[];
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
  download_count: number;
  delta: number;
  snapshot_date: string;
}

/** 우선 추적 작품(lib/seriesWatchlist.ts)의 최신 시리즈 다운로드수 + 전일 대비 증가량 */
export async function getSeriesWatchlistLatest(): Promise<SeriesWatchRow[]> {
  if (SERIES_WATCHLIST.length === 0) return [];
  const supabase = getSupabaseAnon();
  const productNos = SERIES_WATCHLIST.map((w) => w.productNo);
  const { data, error } = await supabase
    .from("series_snapshots")
    .select("product_no,title_id,snapshot_date,download_count")
    .in("product_no", productNos)
    .order("snapshot_date", { ascending: false });
  if (error) throw error;

  const byProduct = new Map<number, { snapshot_date: string; download_count: number }[]>();
  for (const row of data ?? []) {
    const list = byProduct.get(row.product_no) ?? [];
    list.push({ snapshot_date: row.snapshot_date, download_count: row.download_count });
    byProduct.set(row.product_no, list);
  }

  return SERIES_WATCHLIST.map((w) => {
    const history = byProduct.get(w.productNo) ?? [];
    const latest = history[0];
    const prev = history[1];
    return {
      product_no: w.productNo,
      title_id: w.titleId,
      title_name: w.name,
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
