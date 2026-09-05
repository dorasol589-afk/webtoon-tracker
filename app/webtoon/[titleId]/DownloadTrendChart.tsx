"use client";

import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { SeriesSnapshotPoint } from "@/lib/queries";
import { aggregateSeries, getAnchorWeekday, toDeltaSeries, type Granularity } from "./seriesTrendUtils";

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "day", label: "일별" },
  { value: "week", label: "주별" },
  { value: "month", label: "월별" },
];

export default function DownloadTrendChart({
  data,
  seriesWeekday,
}: {
  data: SeriesSnapshotPoint[];
  seriesWeekday?: string | null;
}) {
  const [granularity, setGranularity] = useState<Granularity>("day");
  const anchorWeekday = useMemo(() => getAnchorWeekday(seriesWeekday), [seriesWeekday]);
  const deltaData = useMemo(() => {
    const aggregated = aggregateSeries(data, granularity, anchorWeekday);
    return toDeltaSeries(aggregated);
  }, [data, granularity, anchorWeekday]);

  if (deltaData.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        변화량을 계산할 만큼 데이터가 쌓이지 않았습니다.
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
          <BarChart data={deltaData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
            <XAxis dataKey="snapshot_date" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} width={60} />
            <Tooltip formatter={(value) => [Number(value).toLocaleString(), "다운로드 변화량"]} />
            <Bar dataKey="delta" fill="#059669" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
