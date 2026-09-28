"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TagStatRow, TagType, SeriesSnapshotPoint } from "@/lib/queries";
import {
  type Granularity,
  aggregateByCalendarWeek,
  aggregateByCalendarMonth,
  formatCalendarWeekLabel,
  formatMonthLabel,
  toDeltaSeries,
} from "@/lib/seriesTrend";
import { formatWon } from "@/lib/format";
import { TagPicker, MetricTooltip, colorForTag, useTagSelection, useActiveHighlight } from "./TagChartCommon";

const PRICE_PER_DOWNLOAD = 300;

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "day", label: "일별" },
  { value: "week", label: "주별" },
  { value: "month", label: "월별" },
];

type Mode = "download" | "revenue";
type ViewMode = "cumulative" | "delta";

const VIEW_MODE_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "cumulative", label: "누적" },
  { value: "delta", label: "증감" },
];

function reaggregate(points: SeriesSnapshotPoint[], granularity: Granularity): SeriesSnapshotPoint[] {
  if (granularity === "day") return points;
  return granularity === "week" ? aggregateByCalendarWeek(points) : aggregateByCalendarMonth(points);
}

function xLabelFor(granularity: Granularity) {
  if (granularity === "week") return formatCalendarWeekLabel;
  if (granularity === "month") return formatMonthLabel;
  return (d: string) => d;
}

/** 태그마다 관측일이 달라도 하나의 그래프에서 겹쳐 볼 수 있도록 날짜 기준으로 병합 - 다운로드수는
 * 누적값이라 없는 날짜를 0으로 채우면 실제로 없던 급락처럼 보이므로 null로 두고 connectNulls로 잇는다. */
function mergeByDate(
  dataByTag: Record<string, { snapshot_date: string; value: number }[]>,
  tagNames: string[]
): Record<string, string | number | null>[] {
  const allDates = new Set<string>();
  for (const tagName of tagNames) {
    for (const p of dataByTag[tagName] ?? []) allDates.add(p.snapshot_date);
  }
  const sortedDates = [...allDates].sort();
  const valueMaps = new Map(
    tagNames.map((t) => [t, new Map((dataByTag[t] ?? []).map((p) => [p.snapshot_date, p.value]))])
  );
  return sortedDates.map((date) => {
    const row: Record<string, string | number | null> = { snapshot_date: date };
    for (const tagName of tagNames) {
      row[tagName] = valueMaps.get(tagName)?.get(date) ?? null;
    }
    return row;
  });
}

export default function TagMetricTrendChart({
  tagType,
  options,
  mode,
  defaultSelectedCount = 8,
}: {
  tagType: TagType;
  options: TagStatRow[];
  mode: Mode;
  defaultSelectedCount?: number;
}) {
  const { selected, toggleTag, selectAllTags, selectTopNTags, deselectAllTags } = useTagSelection(
    options,
    defaultSelectedCount
  );
  const tagNames = useMemo(
    () => options.filter((o) => selected.has(o.tag_name)).map((o) => o.tag_name),
    [options, selected]
  );
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [viewMode, setViewMode] = useState<ViewMode>("cumulative");
  const [rawByTag, setRawByTag] = useState<Record<string, SeriesSnapshotPoint[]> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { activeTag, setActiveTag, toggleActive } = useActiveHighlight();

  useEffect(() => {
    if (tagNames.length === 0) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 태그 선택 시 새로 fetch하는 동안 로딩 표시
    setLoading(true);
    setError(null);
    fetch(`/api/tag-download-series?tagType=${tagType}&tagNames=${encodeURIComponent(tagNames.join(","))}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) throw new Error(json.error);
        setRawByTag(json.data as Record<string, SeriesSnapshotPoint[]>);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setRawByTag(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tagType, tagNames]);

  const chartData = useMemo(() => {
    if (!rawByTag) return [];
    const valueByTag: Record<string, { snapshot_date: string; value: number }[]> = {};
    for (const tagName of tagNames) {
      const aggregated = reaggregate(rawByTag[tagName] ?? [], granularity);
      if (mode === "revenue") {
        valueByTag[tagName] = toDeltaSeries(aggregated).map((p) => ({
          snapshot_date: p.snapshot_date,
          value: p.delta * PRICE_PER_DOWNLOAD,
        }));
      } else if (viewMode === "delta") {
        valueByTag[tagName] = toDeltaSeries(aggregated).map((p) => ({ snapshot_date: p.snapshot_date, value: p.delta }));
      } else {
        valueByTag[tagName] = aggregated.map((p) => ({ snapshot_date: p.snapshot_date, value: p.download_count }));
      }
    }
    return mergeByDate(valueByTag, tagNames);
  }, [rawByTag, tagNames, granularity, mode, viewMode]);

  if (options.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        데이터 없음
      </div>
    );
  }

  const xLabelFormatter = xLabelFor(granularity);
  const valueFormatter = mode === "revenue" ? formatWon : (v: number) => v.toLocaleString();

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-1">
        <TagPicker
          options={options}
          selected={selected}
          onToggle={toggleTag}
          onSelectAll={selectAllTags}
          onDeselectAll={deselectAllTags}
          onSelectTopN={selectTopNTags}
          topN={defaultSelectedCount}
        />
        <div className="flex gap-1">
          {mode === "download" &&
            VIEW_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setViewMode(opt.value)}
                className={`rounded px-2 py-1 text-xs ${
                  viewMode === opt.value
                    ? "bg-neutral-800 text-white"
                    : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          {mode === "download" && <span className="mx-1 text-neutral-300">|</span>}
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
      </div>

      {activeTag && (
        <div className="mb-2 flex items-center gap-1 text-xs text-neutral-500">
          <span>
            <span className="font-medium text-neutral-700">{activeTag}</span> 강조 중
          </span>
          <button
            type="button"
            onClick={() => setActiveTag(null)}
            className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-500 hover:bg-neutral-200"
          >
            해제
          </button>
        </div>
      )}

      {tagNames.length === 0 && (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          태그를 선택해주세요.
        </div>
      )}
      {tagNames.length > 0 && loading && (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          불러오는 중...
        </div>
      )}
      {tagNames.length > 0 && !loading && error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-8 text-center text-sm text-rose-700">
          {error}
        </div>
      )}
      {tagNames.length > 0 && !loading && !error && chartData.length === 0 && (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          데이터 없음
        </div>
      )}
      {tagNames.length > 0 && !loading && !error && chartData.length > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                <XAxis dataKey="snapshot_date" tick={{ fontSize: 10 }} tickFormatter={xLabelFormatter} />
                <YAxis tick={{ fontSize: 11 }} width={50} domain={[0, "auto"]} tickFormatter={(v) => valueFormatter(Number(v))} />
                <Tooltip
                  content={(props) => (
                    <MetricTooltip
                      {...props}
                      activeTag={activeTag}
                      valueFormatter={valueFormatter}
                      label={typeof props.label === "string" ? xLabelFormatter(props.label) : props.label}
                    />
                  )}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, cursor: "pointer" }}
                  onClick={(o) => o.dataKey != null && toggleActive(String(o.dataKey))}
                />
                {tagNames.map((tagName, idx) => (
                  <Line
                    key={tagName}
                    type="monotone"
                    dataKey={tagName}
                    name={tagName}
                    stroke={colorForTag(idx, tagName, activeTag)}
                    strokeWidth={activeTag === tagName ? 3 : 1.5}
                    dot={false}
                    connectNulls
                    style={{ cursor: "pointer" }}
                    onClick={() => toggleActive(tagName)}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
