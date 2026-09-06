import type { SeriesSnapshotPoint } from "@/lib/queries";

export type Granularity = "day" | "week" | "month";

const WEEKDAY_TO_NUM: Record<string, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

// 시간대 영향이 없도록 UTC 기준으로만 날짜를 다룬다(로컬 자정 → toISOString 왕복은
// KST 같은 UTC+ 시간대에서 하루가 밀리는 오프바이원을 일으킨다).
function toUTCDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(dateStr: string, days: number): string {
  const date = toUTCDate(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// 연재 요일 다음날을 주차 체크포인트 요일로 잡는다 (예: 월요웹툰이면 화요일마다 확인).
// 매일+ 작품이거나 요일 정보가 없으면 월요일을 기본 체크포인트로 쓴다.
export function getAnchorWeekday(seriesWeekday: string | null | undefined): number {
  const base = seriesWeekday ? WEEKDAY_TO_NUM[seriesWeekday] : undefined;
  return base === undefined ? 1 : (base + 1) % 7;
}

// download_count는 누적값이라 매주 같은 체크포인트 요일의 값을 뽑아서 주차별 변화를 비교한다.
// 그 날짜에 관측치가 없으면 바로 이전 관측치로 대체하고, 그마저 없으면(수집 시작 전) 최초 관측일 데이터를 쓴다.
function aggregateByWeek(data: SeriesSnapshotPoint[], anchorWeekday: number): SeriesSnapshotPoint[] {
  if (data.length === 0) return [];

  const firstDate = data[0].snapshot_date;
  const lastDate = data[data.length - 1].snapshot_date;
  const byDate = new Map(data.map((p) => [p.snapshot_date, p]));

  const forwardDiff = (anchorWeekday - toUTCDate(firstDate).getUTCDay() + 7) % 7;
  let anchor = addDays(firstDate, forwardDiff);

  const points: SeriesSnapshotPoint[] = [];
  while (anchor <= lastDate) {
    const exact = byDate.get(anchor);
    if (exact) {
      points.push(exact);
    } else {
      let carried: SeriesSnapshotPoint | undefined;
      for (const p of data) {
        if (p.snapshot_date > anchor) break;
        carried = p;
      }
      points.push(carried ?? data[0]);
    }
    anchor = addDays(anchor, 7);
  }
  return points;
}

// download_count는 누적값이라 평균/합산이 아니라 그 달의 마지막 스냅샷을 대표값으로 쓴다.
function aggregateByMonth(data: SeriesSnapshotPoint[]): SeriesSnapshotPoint[] {
  const groups = new Map<string, SeriesSnapshotPoint>();
  for (const point of data) {
    const groupKey = point.snapshot_date.slice(0, 7);
    const existing = groups.get(groupKey);
    if (!existing || point.snapshot_date > existing.snapshot_date) {
      groups.set(groupKey, point);
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
}

export function aggregateSeries(
  data: SeriesSnapshotPoint[],
  granularity: Granularity,
  anchorWeekday: number
): SeriesSnapshotPoint[] {
  if (granularity === "day") return data;
  if (granularity === "week") return aggregateByWeek(data, anchorWeekday);
  return aggregateByMonth(data);
}

// 그 날짜가 속한 주(월요일 시작)의 월요일 날짜를 반환.
function mondayOf(dateStr: string): string {
  const date = toUTCDate(dateStr);
  const day = date.getUTCDay(); // 0=일 ... 6=토
  const diffToMonday = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - diffToMonday);
  return date.toISOString().slice(0, 10);
}

/** "2026-08-17"(주의 월요일 날짜) 같은 값을 "8월 3주차" 형태로 표기. 여러 작품을 비교할 때
 * 쓰는 라벨이라 정확한 ISO 주차가 아니라 "그 달의 몇 번째 월요일 주"인지 정도의 직관적 표기다. */
export function formatCalendarWeekLabel(dateStr: string): string {
  const monday = mondayOf(dateStr);
  const [, m, d] = monday.split("-").map(Number);
  const weekOfMonth = Math.ceil(d / 7);
  return `${m}월 ${weekOfMonth}주차`;
}

/** 작품마다 연재 요일이 달라 aggregateSeries("week", ...)의 체크포인트가 서로 다른 날짜로
 * 어긋나는 문제를, 달력 기준 주(월요일 시작)로 통일해서 해결한다 - 여러 작품을 같은 시점끼리
 * 비교해야 하는 관심작품 비교 탭에서만 씀(개별 작품 페이지는 연재 요일 기준이 더 자연스러워 그대로 둠).
 * 결과의 snapshot_date는 그 주의 월요일 날짜(정렬/병합용 키)이고, 값은 그 주에 관측된 마지막 누적값이다. */
export function aggregateByCalendarWeek(data: SeriesSnapshotPoint[]): SeriesSnapshotPoint[] {
  const groups = new Map<string, SeriesSnapshotPoint>();
  for (const point of data) {
    const week = mondayOf(point.snapshot_date);
    const existing = groups.get(week);
    if (!existing || point.snapshot_date > existing.snapshot_date) {
      groups.set(week, point);
    }
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, point]) => ({ snapshot_date: week, download_count: point.download_count }));
}

/** "2026-08-29" 같은 값을 "8월"로 표기(비교 탭의 월간 보기용 라벨). */
export function formatMonthLabel(dateStr: string): string {
  const [, m] = dateStr.split("-").map(Number);
  return `${m}월`;
}

/** aggregateSeries(..., "month", ...)는 그 달의 마지막 "관측일 그대로"를 키로 써서, 작품마다
 * 마지막 관측일이 달라(예: 8/29 vs 8/31) 병합 시 같은 달인데도 다른 열로 갈라지는 문제가 있다.
 * 비교 탭에서는 그 달의 1일로 정규화한 날짜를 키로 써서 모든 작품이 같은 달끼리 묶이게 한다. */
export function aggregateByCalendarMonth(data: SeriesSnapshotPoint[]): SeriesSnapshotPoint[] {
  const groups = new Map<string, SeriesSnapshotPoint>();
  for (const point of data) {
    const monthKey = `${point.snapshot_date.slice(0, 7)}-01`;
    const existing = groups.get(monthKey);
    if (!existing || point.snapshot_date > existing.snapshot_date) {
      groups.set(monthKey, point);
    }
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, point]) => ({ snapshot_date: month, download_count: point.download_count }));
}

export interface DeltaPoint {
  snapshot_date: string;
  delta: number;
}

/** 누적값 배열을 인접 구간 간 증가분(변화량)으로 변환. 첫 포인트는 이전 값이 없어 델타를 낼 수 없으므로 제외. */
export function toDeltaSeries(points: SeriesSnapshotPoint[]): DeltaPoint[] {
  const result: DeltaPoint[] = [];
  for (let i = 1; i < points.length; i++) {
    result.push({ snapshot_date: points[i].snapshot_date, delta: points[i].download_count - points[i - 1].download_count });
  }
  return result;
}
