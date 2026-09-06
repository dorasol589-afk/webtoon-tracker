"use client";

import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { SeriesSnapshotPoint } from "@/lib/queries";
import { aggregateSeries, getAnchorWeekday, toDeltaSeries, type Granularity } from "@/lib/seriesTrend";

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "day", label: "일별" },
  { value: "week", label: "주별" },
  { value: "month", label: "월별" },
];

export default function SeriesDownloadChart({
  data,
  seriesWeekday,
}: {
  data: SeriesSnapshotPoint[];
  seriesWeekday?: string | null;
}) {
  const [granularity, setGranularity] = useState<Granularity>("day");
  const anchorWeekday = useMemo(() => getAnchorWeekday(seriesWeekday), [seriesWeekday]);
  // 누적값 옆에 그 구간에 얼마나 늘었는지(변화량)도 툴팁에 같이 보여주기 위해 델타를 미리 계산해둔다.
  const chartData = useMemo(() => {
    const aggregated = aggregateSeries(data, granularity, anchorWeekday);
    const deltaByDate = new Map(toDeltaSeries(aggregated).map((d) => [d.snapshot_date, d.delta]));
    return aggregated.map((p) => ({ ...p, delta: deltaByDate.get(p.snapshot_date) ?? null }));
  }, [data, granularity, anchorWeekday]);

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
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
            <XAxis dataKey="snapshot_date" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} width={60} />
            <Tooltip
              formatter={(value, name, props) => {
                const delta = (props?.payload as { delta: number | null } | undefined)?.delta;
                const deltaText =
                  delta == null ? "" : ` (${delta >= 0 ? "▲" : "▼"}${Math.abs(delta).toLocaleString()})`;
                return [`${Number(value).toLocaleString()}${deltaText}`, "다운로드수"];
              }}
            />
            <Line type="monotone" dataKey="download_count" stroke="#059669" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
