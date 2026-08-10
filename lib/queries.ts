import { getSupabaseAnon } from "./supabase";

export interface TitleRow {
  title_id: number;
  title_name: string;
  author: string | null;
  thumbnail_url: string | null;
  is_active: boolean;
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
    .select("title_id,title_name,author,thumbnail_url,is_active")
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
    .select("title_id,title_name,author,thumbnail_url,is_active")
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
