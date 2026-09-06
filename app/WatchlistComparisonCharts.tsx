"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatWon } from "@/lib/format";
import { formatCalendarWeekLabel, formatMonthLabel, aggregateByCalendarWeek, aggregateByCalendarMonth } from "@/lib/seriesTrend";

export interface ComparisonSeries {
  titleId: number;
  titleName: string;
  /** 댓글수/다운로드수/매출액 세 차트에서 같은 작품이 항상 같은 색을 쓰도록 호출하는 쪽(app/page.tsx)에서 고정해서 넘김 */
  color: string;
  points: { snapshot_date: string; value: number }[];
}

const INACTIVE_COLOR = "#d1d5db";

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
  variant = "line",
  headerControls,
}: {
  series: ComparisonSeries[];
  valueFormatter?: (value: number) => string;
  xLabelFormatter?: (date: string) => string;
  variant?: "line" | "bar";
  headerControls?: ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const withData = series.filter((s) => s.points.length > 0);
  if (withData.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        아직 비교할 데이터가 없습니다.
      </div>
    );
  }
  const chartData = mergeSeries(withData);
  const ChartComponent = variant === "bar" ? BarChart : LineChart;
  const colorFor = (s: ComparisonSeries) => (activeId === null || activeId === String(s.titleId) ? s.color : INACTIVE_COLOR);
  const highlight = (id: string | null) => setActiveId(id);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      {headerControls && <div className="mb-2 flex justify-end gap-1">{headerControls}</div>}
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ChartComponent data={chartData} margin={{ top: variant === "bar" ? 24 : 10, right: 20, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
            <XAxis dataKey="snapshot_date" tick={{ fontSize: 12 }} tickFormatter={xLabelFormatter} />
            <YAxis tick={{ fontSize: 12 }} width={60} tickFormatter={(v) => valueFormatter(Number(v))} />
            {variant !== "bar" && (
              <Tooltip
                labelFormatter={(label) => xLabelFormatter(String(label))}
                formatter={(value) => [value == null ? "-" : valueFormatter(Number(value)), ""]}
              />
            )}
            <Legend
              wrapperStyle={{ fontSize: 12, cursor: "pointer" }}
              onMouseEnter={(o) => highlight(o.dataKey != null ? String(o.dataKey) : null)}
              onMouseLeave={() => highlight(null)}
            />
            {withData.map((s) =>
              variant === "bar" ? (
                <Bar key={s.titleId} dataKey={String(s.titleId)} name={s.titleName} fill={colorFor(s)}>
                  <LabelList
                    dataKey={String(s.titleId)}
                    position="top"
                    fontSize={9}
                    fill={colorFor(s)}
                    formatter={(v) => (v == null ? "" : Math.round(Number(v) / 10000).toLocaleString())}
                  />
                </Bar>
              ) : (
                <Line
                  key={s.titleId}
                  type="monotone"
                  dataKey={String(s.titleId)}
                  name={s.titleName}
                  stroke={colorFor(s)}
                  strokeWidth={activeId === String(s.titleId) ? 3 : 2}
                  dot={false}
                  connectNulls
                  onMouseEnter={() => highlight(String(s.titleId))}
                  onMouseLeave={() => highlight(null)}
                />
              )
            )}
          </ChartComponent>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function CommentComparisonChart({ series }: { series: ComparisonSeries[] }) {
  return <ComparisonChart series={series} />;
}

type Granularity = "day" | "week" | "month";

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "day", label: "일별" },
  { value: "week", label: "주별" },
  { value: "month", label: "월별" },
];

/** 다운로드수 비교는 주별/월별로 볼 때도 작품마다 관측일이 달라 병합이 어긋나지 않도록
 * 달력 기준(월요일 시작 주 / 매월 1일)으로 정규화해서 다시 집계한다. */
function reaggregatePoints(points: { snapshot_date: string; value: number }[], granularity: Granularity) {
  if (granularity === "day") return points;
  const asSnapshots = points.map((p) => ({ snapshot_date: p.snapshot_date, download_count: p.value }));
  const aggregated = granularity === "week" ? aggregateByCalendarWeek(asSnapshots) : aggregateByCalendarMonth(asSnapshots);
  return aggregated.map((p) => ({ snapshot_date: p.snapshot_date, value: p.download_count }));
}

export function DownloadComparisonChart({ series }: { series: ComparisonSeries[] }) {
  const [granularity, setGranularity] = useState<Granularity>("day");
  const adjustedSeries = useMemo(
    () => series.map((s) => ({ ...s, points: reaggregatePoints(s.points, granularity) })),
    [series, granularity]
  );
  const xLabelFormatter =
    granularity === "week" ? formatCalendarWeekLabel : granularity === "month" ? formatMonthLabel : (d: string) => d;

  return (
    <ComparisonChart
      series={adjustedSeries}
      xLabelFormatter={xLabelFormatter}
      headerControls={GRANULARITY_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setGranularity(opt.value)}
          className={`rounded px-2 py-1 text-xs ${
            granularity === opt.value ? "bg-neutral-800 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
          }`}
        >
          {opt.label}
        </button>
      ))}
    />
  );
}

export function RevenueComparisonChart({ series }: { series: ComparisonSeries[] }) {
  return (
    <ComparisonChart
      series={series}
      valueFormatter={formatWon}
      xLabelFormatter={formatCalendarWeekLabel}
      variant="bar"
    />
  );
}
