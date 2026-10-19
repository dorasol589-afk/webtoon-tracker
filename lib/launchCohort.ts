import { getSupabaseAnon } from "./supabase";

/** 신작 월차 성과 비교(/launches)의 시점: 0=현재, 30/60/90=런칭 후 30/60/90일째(1/2/3개월차) */
export type LaunchMark = 0 | 30 | 60 | 90;
export const LAUNCH_MARKS: LaunchMark[] = [30, 60, 90, 0];

export interface LaunchMarkValue {
  dlDate: string | null;
  download: number | null;
  cmDate: string | null;
  comment: number | null;
  star: number | null;
}

export interface LaunchTitle {
  titleId: number;
  name: string;
  thumbnail: string | null;
  studio: string | null;
  isAdult: boolean;
  isFinished: boolean;
  launchDate: string;
  marks: Record<LaunchMark, LaunchMarkValue>;
}

/** 런칭 후 경과일(startOffset부터 하루 간격)별 누적 다운로드 - 수집 안 된 날은 null */
export interface LaunchCurve {
  startOffset: number;
  values: (number | null)[];
}

export interface LaunchCohort {
  titles: LaunchTitle[];
  curves: Record<number, LaunchCurve>;
}

export interface LaunchRangeOption {
  value: string;
  label: string;
}

function todayKst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthEnd(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

const FIRST_MONTH = { year: 2026, month: 5 };

/** 런칭 기간 선택지: 최근 100일 / 분기별 / 월별. 수집 시작(2026-08-11) 전에 런칭한 작품도 그 이후 시점의 누적값은 알 수 있어서
 * 2026-05부터(3개월차 값이 수집 기간 안에 들어오는 가장 이른 런칭월) 보여준다. */
export function getLaunchRangeOptions(): LaunchRangeOption[] {
  const today = todayKst();
  const [ty, tm] = today.split("-").map(Number);
  const options: LaunchRangeOption[] = [{ value: "recent", label: "최근 100일 런칭" }];
  const quarters: LaunchRangeOption[] = [];
  const months: LaunchRangeOption[] = [];
  for (let y = ty, m = tm; ; ) {
    months.push({ value: `${y}-${String(m).padStart(2, "0")}`, label: `${y}년 ${m}월 런칭` });
    const q = Math.floor((m - 1) / 3) + 1;
    if (!quarters.some((o) => o.value === `${y}-Q${q}`)) quarters.push({ value: `${y}-Q${q}`, label: `${y}년 ${q}분기 런칭` });
    if (y === FIRST_MONTH.year && m === FIRST_MONTH.month) break;
    if (--m === 0) {
      y--;
      m = 12;
    }
  }
  return [...options, ...quarters, ...months];
}

export function resolveLaunchRange(range: string | undefined): { value: string; from: string; to: string; label: string } {
  const today = todayKst();
  const options = getLaunchRangeOptions();
  const found = options.find((o) => o.value === range) ?? options[0];
  if (found.value === "recent") return { value: "recent", from: addDays(today, -100), to: today, label: found.label };
  const q = found.value.match(/^(\d{4})-Q([1-4])$/);
  if (q) {
    const y = Number(q[1]);
    const sm = (Number(q[2]) - 1) * 3 + 1;
    const end = monthEnd(y, sm + 2);
    return { value: found.value, from: `${y}-${String(sm).padStart(2, "0")}-01`, to: end > today ? today : end, label: found.label };
  }
  const [y, m] = found.value.split("-").map(Number);
  const end = monthEnd(y, m);
  return { value: found.value, from: `${found.value}-01`, to: end > today ? today : end, label: found.label };
}

interface MetricRow {
  title_id: number;
  title_name: string;
  thumbnail_url: string | null;
  studio_name: string | null;
  is_adult: boolean;
  is_finished: boolean;
  launch_date: string;
  mark: number;
  dl_date: string | null;
  download_count: number | null;
  cm_date: string | null;
  comment_total: number | null;
  star_score: number | null;
}

const PAGE = 1000;

/** 런칭 기간(+장르)에 들어오는 신작들의 1/2/3개월차 성과와 현재 값, 그리고 런칭 후 경과일별 다운로드 곡선 */
export async function getLaunchCohort(from: string, to: string, genre: string | null): Promise<LaunchCohort> {
  const supabase = getSupabaseAnon();
  const args = { from_date: from, to_date: to, genre_tag: genre };

  const rows: MetricRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.rpc("launch_cohort_metrics", args).range(offset, offset + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as MetricRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  const byId = new Map<number, LaunchTitle>();
  for (const r of rows) {
    let t = byId.get(r.title_id);
    if (!t) {
      const empty = (): LaunchMarkValue => ({ dlDate: null, download: null, cmDate: null, comment: null, star: null });
      t = {
        titleId: r.title_id,
        name: r.title_name,
        thumbnail: r.thumbnail_url,
        studio: r.studio_name,
        isAdult: r.is_adult,
        isFinished: r.is_finished,
        launchDate: r.launch_date,
        marks: { 0: empty(), 30: empty(), 60: empty(), 90: empty() },
      };
      byId.set(r.title_id, t);
    }
    t.marks[r.mark as LaunchMark] = {
      dlDate: r.dl_date,
      download: r.download_count === null ? null : Number(r.download_count),
      cmDate: r.cm_date,
      comment: r.comment_total === null ? null : Number(r.comment_total),
      star: r.star_score === null ? null : Number(r.star_score),
    };
  }

  const curveRows: { title_id: number; start_offset: number; vals: (number | string | null)[] }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.rpc("launch_download_curves", args).range(offset, offset + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as typeof curveRows;
    curveRows.push(...batch);
    if (batch.length < PAGE) break;
  }
  const curves: Record<number, LaunchCurve> = {};
  for (const c of curveRows) {
    curves[c.title_id] = {
      startOffset: c.start_offset,
      values: c.vals.map((v) => (v === null ? null : Number(v))),
    };
  }

  return { titles: [...byId.values()], curves };
}
