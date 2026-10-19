"use client";

import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { SnapshotPoint } from "@/lib/queries";

type Granularity = "day" | "week" | "month";

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "day", label: "일별" },
  { value: "week", label: "주별" },
  { value: "month", label: "월별" },
];

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

// 연재 요일 하루 전(월요웹툰이면 일요일) 기록을 주차 체크포인트로 잡는다. 새 회차가 요일 전날 밤 10~11시에 올라오므로 그날
// 저녁 수집값이 "다음 회차 올라오기 직전"(이전 회차가 올라온 지 거의 7일 - 댓글이 최종값에 가깝게 쌓인 시점)이다.
// 매일+ 작품이거나 요일 정보가 없으면 월요일을 기본 체크포인트로 쓴다.
// 오래된 구간(2026-10-05 이전)은 예전 기준으로 정리된 기록만 남아 있어 직전 관측치로 대체돼 표시될 수 있다.
function getAnchorWeekday(seriesWeekday: string | null | undefined): number {
  const base = seriesWeekday ? WEEKDAY_TO_NUM[seriesWeekday] : undefined;
  return base === undefined ? 1 : (base + 6) % 7;
}

// comment_count는 누적값이라 매주 같은 체크포인트 요일(연재요일 하루 전)의 값을 뽑아서 주차별 변화를 비교한다.
// 그 날짜에 관측치가 없으면 바로 이전 관측치로 대체하고, 그마저 없으면(수집 시작 전) 최초 관측일 데이터를 쓴다.
// 라벨은 계산된 가상의 체크포인트 날짜가 아니라 실제로 쓰인 관측치의 날짜를 그대로 보여준다.
function aggregateByWeek(data: SnapshotPoint[], anchorWeekday: number): SnapshotPoint[] {
  if (data.length === 0) return [];

  const firstDate = data[0].snapshot_date;
  const lastDate = data[data.length - 1].snapshot_date;
  const byDate = new Map(data.map((p) => [p.snapshot_date, p]));

  const forwardDiff = (anchorWeekday - toUTCDate(firstDate).getUTCDay() + 7) % 7;
  let anchor = addDays(firstDate, forwardDiff);

  const points: SnapshotPoint[] = [];
  while (anchor <= lastDate) {
    const exact = byDate.get(anchor);
    if (exact) {
      points.push(exact);
    } else {
      let carried: SnapshotPoint | undefined;
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

// comment_count는 누적값이라 평균/합산이 아니라 그 달의 마지막 스냅샷을 대표값으로 쓴다.
// 라벨은 가상의 월 시작일이 아니라 실제로 관측된 그 스냅샷의 날짜를 그대로 보여준다.
function aggregateByMonth(data: SnapshotPoint[]): SnapshotPoint[] {
  const groups = new Map<string, SnapshotPoint>();
  for (const point of data) {
    const groupKey = point.snapshot_date.slice(0, 7);
    const existing = groups.get(groupKey);
    if (!existing || point.snapshot_date > existing.snapshot_date) {
      groups.set(groupKey, point);
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
}

function aggregate(data: SnapshotPoint[], granularity: Granularity, anchorWeekday: number): SnapshotPoint[] {
  if (granularity === "day") return data;
  if (granularity === "week") return aggregateByWeek(data, anchorWeekday);
  return aggregateByMonth(data);
}

export default function CommentTrendChart({
  data,
  seriesWeekday,
}: {
  data: SnapshotPoint[];
  seriesWeekday?: string | null;
}) {
  const [granularity, setGranularity] = useState<Granularity>("day");
  const anchorWeekday = useMemo(() => getAnchorWeekday(seriesWeekday), [seriesWeekday]);
  // 누적 댓글수 옆에 직전 구간(일/주/월) 대비 얼마나 늘었는지도 툴팁에 같이 보여주기 위해 증감을 미리 계산해둔다.
  const chartData = useMemo(
    () =>
      aggregate(data, granularity, anchorWeekday).map((p, i, arr) => ({
        ...p,
        delta: i === 0 ? null : p.comment_count - arr[i - 1].comment_count,
      })),
    [data, granularity, anchorWeekday]
  );

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        아직 수집된 데이터가 없습니다.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-2 flex justify-end gap-1">
        {GRANULARITY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setGranularity(opt.value)}
            className={`rounded px-2 py-1 text-xs ${
              granularity === opt.value
                ? "bg-neutral-800 text-white"
                : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
            <XAxis dataKey="snapshot_date" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} width={50} />
            <Tooltip
              formatter={(value, name, props) => {
                const delta = (props?.payload as { delta: number | null } | undefined)?.delta;
                const deltaText =
                  delta == null ? "" : ` (${delta >= 0 ? "▲" : "▼"}${Math.abs(delta).toLocaleString()})`;
                return [`${Number(value).toLocaleString()}${deltaText}`, "댓글수"];
              }}
            />
            <Line type="monotone" dataKey="comment_count" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
