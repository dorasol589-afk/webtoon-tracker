"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { formatWon } from "@/lib/format";
import { formatCalendarWeekLabel } from "@/lib/seriesTrend";

export interface ComparisonSeries {
  titleId: number;
  titleName: string;
  points: { snapshot_date: string; value: number }[];
}

const COLORS = ["#2563eb", "#059669", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];

/** 작품마다 관측일이 달라도 하나의 그래프에서 비교할 수 있도록 날짜 기준으로 병합 (없는 날짜는 null → 선이 끊기지 않게 connectNulls로 이음) */
function mergeSeries(seriesList: ComparisonSeries[]) {
  const allDates = Array.from(new Set(seriesList.flatMap((s) => s.points.map((p) => p.snapshot_date)))).sort();
  const valueMaps = seriesList.map((s) => new Map(s.points.map((p) => [p.snapshot_date, p.value])));
  return allDates.map((date) => {
    const row: Record<string, string | number | null> = { snapshot_date: date };
    seriesList.forEach((s, i) => {
      row[String(s.titleId)] = valueMaps[i].get(date) ?? null;
    });
    return row;
  });
}

function ComparisonChart({
  series,
  valueFormatter = (v) => v.toLocaleString(),
  xLabelFormatter = (d) => d,
}: {
  series: ComparisonSeries[];
  valueFormatter?: (value: number) => string;
  xLabelFormatter?: (date: string) => string;
}) {
  const withData = series.filter((s) => s.points.length > 0);
  if (withData.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        아직 비교할 데이터가 없습니다.
      </div>
    );
  }
  const chartData = mergeSeries(withData);
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
            <XAxis dataKey="snapshot_date" tick={{ fontSize: 12 }} tickFormatter={xLabelFormatter} />
            <YAxis tick={{ fontSize: 12 }} width={60} tickFormatter={(v) => valueFormatter(Number(v))} />
            <Tooltip
              labelFormatter={(label) => xLabelFormatter(String(label))}
              formatter={(value) => [value == null ? "-" : valueFormatter(Number(value)), ""]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {withData.map((s, i) => (
              <Line
                key={s.titleId}
                type="monotone"
                dataKey={String(s.titleId)}
                name={s.titleName}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function CommentComparisonChart({ series }: { series: ComparisonSeries[] }) {
  return <ComparisonChart series={series} />;
}

export function DownloadComparisonChart({ series }: { series: ComparisonSeries[] }) {
  return <ComparisonChart series={series} />;
}

export function RevenueComparisonChart({ series }: { series: ComparisonSeries[] }) {
  return <ComparisonChart series={series} valueFormatter={formatWon} xLabelFormatter={formatCalendarWeekLabel} />;
}
