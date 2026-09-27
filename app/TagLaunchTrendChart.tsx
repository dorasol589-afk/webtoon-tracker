"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TagStatRow, TagType } from "@/lib/queries";

type Granularity = "year" | "quarter" | "month";

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "year", label: "연도별" },
  { value: "quarter", label: "분기별" },
  { value: "month", label: "월별" },
];

function bucketKey(date: string, granularity: Granularity): string {
  const [y, m] = date.split("-").map(Number);
  if (granularity === "year") return `${y}`;
  if (granularity === "quarter") return `${y}-Q${Math.ceil(m / 3)}`;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function periodLabel(key: string, granularity: Granularity): string {
  if (granularity === "year") return `${key}년`;
  if (granularity === "quarter") {
    const [y, q] = key.split("-Q");
    return `${y.slice(2)}년 ${q}분기`;
  }
  const [y, m] = key.split("-");
  return `${y.slice(2)}.${m}`;
}

function nextPeriodKey(key: string, granularity: Granularity): string {
  if (granularity === "year") return String(Number(key) + 1);
  if (granularity === "quarter") {
    const [yStr, qStr] = key.split("-Q");
    let y = Number(yStr);
    let q = Number(qStr) + 1;
    if (q > 4) {
      q = 1;
      y += 1;
    }
    return `${y}-Q${q}`;
  }
  const [yStr, mStr] = key.split("-");
  let y = Number(yStr);
  let m = Number(mStr) + 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** 런칭일 목록을 기간 단위로 집계 - 작품이 하나도 없던 기간도 0으로 채워서 추이가 끊기지 않게 한다 */
function buildLaunchSeries(dates: string[], granularity: Granularity): { period: string; count: number }[] {
  if (dates.length === 0) return [];
  const counts = new Map<string, number>();
  for (const d of dates) {
    const key = bucketKey(d, granularity);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sortedKeys = [...counts.keys()].sort();
  const firstKey = sortedKeys[0];
  const lastKey = sortedKeys[sortedKeys.length - 1];

  const result: { period: string; count: number }[] = [];
  let cur = firstKey;
  let guard = 0;
  while (guard < 3000) {
    result.push({ period: periodLabel(cur, granularity), count: counts.get(cur) ?? 0 });
    if (cur === lastKey) break;
    cur = nextPeriodKey(cur, granularity);
    guard++;
  }
  return result;
}

export default function TagLaunchTrendChart({
  tagType,
  options,
  color,
}: {
  tagType: TagType;
  options: TagStatRow[];
  color: string;
}) {
  const [selectedTag, setSelectedTag] = useState(options[0]?.tag_name ?? "");
  const [granularity, setGranularity] = useState<Granularity>("year");
  const [launchDates, setLaunchDates] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedTag) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/tag-launch-dates?tagType=${tagType}&tagName=${encodeURIComponent(selectedTag)}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) throw new Error(json.error);
        setLaunchDates(json.launchDates as string[]);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLaunchDates(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tagType, selectedTag]);

  const chartData = useMemo(() => buildLaunchSeries(launchDates ?? [], granularity), [launchDates, granularity]);
  const minWidth = Math.max(chartData.length * (granularity === "year" ? 40 : 28), 300);

  if (options.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        데이터 없음
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select
          value={selectedTag}
          onChange={(e) => setSelectedTag(e.target.value)}
          className="rounded border border-neutral-300 px-2 py-1 text-xs"
        >
          {options.map((opt) => (
            <option key={opt.tag_name} value={opt.tag_name}>
              {opt.tag_name} ({opt.title_count})
            </option>
          ))}
        </select>
        <span className="mx-1 text-neutral-300">|</span>
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

      {loading && (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          불러오는 중...
        </div>
      )}
      {!loading && error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-8 text-center text-sm text-rose-700">
          {error}
        </div>
      )}
      {!loading && !error && chartData.length === 0 && (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          런칭일 데이터 없음
        </div>
      )}
      {!loading && !error && chartData.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white p-4">
          <div style={{ width: minWidth, height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} width={30} />
                <Tooltip formatter={(value) => [Number(value).toLocaleString(), "런칭 작품 수"]} />
                <Bar dataKey="count" fill={color} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
