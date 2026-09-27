"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { TagStatRow, TagType } from "@/lib/queries";
import { COMPARISON_COLORS } from "@/lib/chartColors";

type Granularity = "year" | "quarter" | "month";

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "year", label: "연도별" },
  { value: "quarter", label: "분기별" },
  { value: "month", label: "월별" },
];

const INACTIVE_COLOR = "#d1d5db";
const TOOLTIP_MAX_ROWS = 8;

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

function bucketDates(dates: string[], granularity: Granularity): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const key = bucketKey(d, granularity);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** 태그마다 관측 기간이 달라도 하나의 그래프에서 겹쳐 볼 수 있도록 전체 태그를 통틀어 가장 이른
 * 기간 ~ 가장 늦은 기간까지 공통 축을 만들고, 작품이 하나도 없던 기간은 0으로 채운다 */
function buildMergedSeries(
  dataByTag: Record<string, string[]>,
  tagNames: string[],
  granularity: Granularity
): Record<string, string | number>[] {
  const countsByTag = new Map(tagNames.map((t) => [t, bucketDates(dataByTag[t] ?? [], granularity)]));
  const allKeys = new Set<string>();
  for (const counts of countsByTag.values()) {
    for (const k of counts.keys()) allKeys.add(k);
  }
  if (allKeys.size === 0) return [];
  const sortedKeys = [...allKeys].sort();
  const firstKey = sortedKeys[0];
  const lastKey = sortedKeys[sortedKeys.length - 1];

  const rows: Record<string, string | number>[] = [];
  let cur = firstKey;
  let guard = 0;
  while (guard < 3000) {
    const row: Record<string, string | number> = { period: periodLabel(cur, granularity) };
    for (const tagName of tagNames) {
      row[tagName] = countsByTag.get(tagName)?.get(cur) ?? 0;
    }
    rows.push(row);
    if (cur === lastKey) break;
    cur = nextPeriodKey(cur, granularity);
    guard++;
  }
  return rows;
}

function TrendTooltip({
  active,
  label,
  payload,
  activeTag,
}: TooltipContentProps<ValueType, NameType> & { activeTag: string | null }) {
  if (!active || !payload || payload.length === 0) return null;
  const base = activeTag ? payload.filter((p) => String(p.dataKey) === activeTag) : payload;
  const sorted = [...base].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  const shown = sorted.slice(0, TOOLTIP_MAX_ROWS);
  const hiddenCount = sorted.length - shown.length;

  return (
    <div className="rounded border border-neutral-200 bg-white p-2 text-xs shadow-sm">
      <div className="mb-1 font-medium text-neutral-700">{label}</div>
      {shown.map((p) => (
        <div key={String(p.dataKey)} className="flex justify-between gap-3" style={{ color: p.color }}>
          <span>{p.name}</span>
          <span>{Number(p.value).toLocaleString()}</span>
        </div>
      ))}
      {hiddenCount > 0 && <div className="mt-1 text-neutral-400">외 {hiddenCount}개 더</div>}
    </div>
  );
}

function TagPicker({
  options,
  selected,
  onToggle,
}: {
  options: TagStatRow[];
  selected: Set<string>;
  onToggle: (tagName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = search.trim()
    ? options.filter((o) => o.tag_name.includes(search.trim()))
    : options;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
      >
        태그 선택 ({selected.size}/{options.length})
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-20 mt-1 w-64 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="태그 검색..."
              className="mb-2 w-full rounded border border-neutral-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
            />
            <div className="max-h-64 overflow-y-auto">
              {filtered.length === 0 && (
                <div className="p-2 text-center text-xs text-neutral-400">검색 결과 없음</div>
              )}
              {filtered.map((o) => (
                <label
                  key={o.tag_name}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-neutral-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(o.tag_name)}
                    onChange={() => onToggle(o.tag_name)}
                  />
                  <span className="flex-1 truncate">{o.tag_name}</span>
                  <span className="text-neutral-400">{o.title_count}</span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function TagLaunchTrendChart({
  tagType,
  options,
  defaultSelectedCount = 10,
}: {
  tagType: TagType;
  options: TagStatRow[];
  defaultSelectedCount?: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(options.slice(0, defaultSelectedCount).map((o) => o.tag_name))
  );
  const tagNames = useMemo(
    () => options.filter((o) => selected.has(o.tag_name)).map((o) => o.tag_name),
    [options, selected]
  );
  const [granularity, setGranularity] = useState<Granularity>("year");
  const [dataByTag, setDataByTag] = useState<Record<string, string[]> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  function toggleTag(tagName: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tagName)) next.delete(tagName);
      else next.add(tagName);
      return next;
    });
  }

  useEffect(() => {
    if (tagNames.length === 0) {
      setDataByTag({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/tag-launch-dates?tagType=${tagType}&tagNames=${encodeURIComponent(tagNames.join(","))}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) throw new Error(json.error);
        setDataByTag(json.data as Record<string, string[]>);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setDataByTag(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tagType, tagNames]);

  const chartData = useMemo(
    () => (dataByTag ? buildMergedSeries(dataByTag, tagNames, granularity) : []),
    [dataByTag, tagNames, granularity]
  );

  if (options.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        데이터 없음
      </div>
    );
  }

  const colorFor = (idx: number, tagName: string) =>
    activeTag === null || activeTag === tagName ? COMPARISON_COLORS[idx % COMPARISON_COLORS.length] : INACTIVE_COLOR;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-1">
        <TagPicker options={options} selected={selected} onToggle={toggleTag} />
        <div className="flex gap-1">
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
          런칭일 데이터 없음
        </div>
      )}
      {tagNames.length > 0 && !loading && !error && chartData.length > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={30} />
                <Tooltip content={(props) => <TrendTooltip {...props} activeTag={activeTag} />} />
                <Legend
                  wrapperStyle={{ fontSize: 11, cursor: "pointer" }}
                  onMouseEnter={(o) => setActiveTag(o.dataKey != null ? String(o.dataKey) : null)}
                  onMouseLeave={() => setActiveTag(null)}
                />
                {tagNames.map((tagName, idx) => (
                  <Line
                    key={tagName}
                    type="monotone"
                    dataKey={tagName}
                    name={tagName}
                    stroke={colorFor(idx, tagName)}
                    strokeWidth={activeTag === tagName ? 3 : 1.5}
                    dot={false}
                    onMouseEnter={() => setActiveTag(tagName)}
                    onMouseLeave={() => setActiveTag(null)}
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
