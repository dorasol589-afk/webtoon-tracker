"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LaunchCohort, LaunchMark, LaunchTitle } from "@/lib/launchCohort";
import { formatWon } from "@/lib/format";

const PRICE_PER_DOWNLOAD = 300;
const MAX_OFFSET = 90;
const MIN_SAMPLE = 8;
const MAX_SELECTED = 8;
const PAGE_SIZE = 50;
const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#db2777", "#65a30d"];

type Metric = "download" | "revenue" | "comment" | "star";
type View = "cumulative" | "increase";

const METRICS: { value: Metric; label: string }[] = [
  { value: "download", label: "다운로드" },
  { value: "revenue", label: "추정 매출" },
  { value: "comment", label: "댓글수" },
  { value: "star", label: "별점" },
];

const MARK_LABEL: Record<LaunchMark, string> = { 30: "1개월차", 60: "2개월차", 90: "3개월차", 0: "현재" };

function rawValue(t: LaunchTitle, mark: LaunchMark, metric: Metric): number | null {
  const m = t.marks[mark];
  switch (metric) {
    case "download":
      return m.download;
    case "revenue":
      return m.download === null ? null : m.download * PRICE_PER_DOWNLOAD;
    case "comment":
      return m.comment;
    case "star":
      return m.star;
  }
}

/** 누적: 그 시점까지의 값. 월 증가: 직전 시점 대비 증가분(1개월차는 런칭~30일 증가 = 누적과 같음). 별점은 증가 개념이 없어 항상 누적 */
function valueAt(t: LaunchTitle, mark: LaunchMark, metric: Metric, view: View): number | null {
  if (view === "cumulative" || metric === "star") return rawValue(t, mark, metric);
  if (mark === 30) return rawValue(t, 30, metric);
  if (mark === 60 || mark === 90) {
    const cur = rawValue(t, mark, metric);
    const prev = rawValue(t, mark === 60 ? 30 : 60, metric);
    return cur === null || prev === null ? null : cur - prev;
  }
  return null;
}

function formatValue(v: number | null, metric: Metric): string {
  if (v === null) return "-";
  if (metric === "revenue") return formatWon(v);
  if (metric === "star") return v.toFixed(2);
  return Math.round(v).toLocaleString();
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

interface MarkStat {
  n: number;
  median: number;
  mean: number;
  top10: number;
  max: number;
  sortedDesc: number[];
}

function buildStat(values: number[]): MarkStat | null {
  if (values.length === 0) return null;
  const asc = [...values].sort((a, b) => a - b);
  return {
    n: asc.length,
    median: quantile(asc, 0.5),
    mean: asc.reduce((s, v) => s + v, 0) / asc.length,
    top10: quantile(asc, 0.9),
    max: asc[asc.length - 1],
    sortedDesc: [...asc].reverse(),
  };
}

/** 같은 시점 값이 있는 신작들 중 상위 몇 %인지(동점은 같은 순위) */
function rankOf(stat: MarkStat, v: number): { rank: number; pct: number } {
  const rank = stat.sortedDesc.filter((x) => x > v).length + 1;
  return { rank, pct: Math.max(1, Math.ceil((rank / stat.n) * 100)) };
}

function PercentBadge({ pct, rank, n }: { pct: number; rank: number; n: number }) {
  const cls =
    pct <= 10 ? "bg-rose-100 text-rose-700" : pct <= 25 ? "bg-amber-100 text-amber-700" : "bg-neutral-100 text-neutral-500";
  return (
    <span className={`ml-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] ${cls}`} title={`${n}개 작품 중 ${rank}위`}>
      상위 {pct}%
    </span>
  );
}

export default function LaunchExplorer({ cohort, rangeLabel }: { cohort: LaunchCohort; rangeLabel: string }) {
  const [metric, setMetric] = useState<Metric>("download");
  const [view, setView] = useState<View>("cumulative");
  const [sortMark, setSortMark] = useState<LaunchMark>(30);
  const [query, setQuery] = useState("");
  const [onlyWithSort, setOnlyWithSort] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const effectiveView: View = metric === "star" ? "cumulative" : view;
  const marks: LaunchMark[] = effectiveView === "increase" ? [30, 60, 90] : [30, 60, 90, 0];
  const effectiveSort: LaunchMark = marks.includes(sortMark) ? sortMark : 30;

  const stats = useMemo(() => {
    const result = {} as Record<LaunchMark, MarkStat | null>;
    for (const mark of [30, 60, 90, 0] as LaunchMark[]) {
      const values: number[] = [];
      for (const t of cohort.titles) {
        const v = valueAt(t, mark, metric, effectiveView);
        if (v !== null) values.push(v);
      }
      result[mark] = buildStat(values);
    }
    return result;
  }, [cohort.titles, metric, effectiveView]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = cohort.titles.filter((t) => {
      if (q && !t.name.toLowerCase().includes(q) && !(t.studio ?? "").toLowerCase().includes(q)) return false;
      if (onlyWithSort && valueAt(t, effectiveSort, metric, effectiveView) === null) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      const av = valueAt(a, effectiveSort, metric, effectiveView);
      const bv = valueAt(b, effectiveSort, metric, effectiveView);
      if (av === null && bv === null) return b.launchDate.localeCompare(a.launchDate);
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });
  }, [cohort.titles, query, onlyWithSort, effectiveSort, metric, effectiveView]);

  const toggleSelected = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_SELECTED ? prev : [...prev, id]));

  // 런칭 후 경과일별 누적 곡선: 코호트 전체의 25/50/75% 분위수 + 선택한 작품 곡선
  const chartData = useMemo(() => {
    const factor = metric === "revenue" ? PRICE_PER_DOWNLOAD : 1;
    const curveList = cohort.titles.map((t) => cohort.curves[t.titleId]).filter(Boolean);
    const data: Record<string, number | null>[] = [];
    for (let off = 0; off <= MAX_OFFSET; off++) {
      const vals: number[] = [];
      for (const c of curveList) {
        const v = c.values[off - c.startOffset];
        if (typeof v === "number") vals.push(v * factor);
      }
      const row: Record<string, number | null> = { offset: off, n: vals.length, p25: null, median: null, p75: null };
      if (vals.length >= MIN_SAMPLE) {
        vals.sort((a, b) => a - b);
        row.p25 = quantile(vals, 0.25);
        row.median = quantile(vals, 0.5);
        row.p75 = quantile(vals, 0.75);
      }
      for (const id of selected) {
        const c = cohort.curves[id];
        const v = c ? c.values[off - c.startOffset] : undefined;
        row[`t${id}`] = typeof v === "number" ? v * factor : null;
      }
      data.push(row);
    }
    return data;
  }, [cohort, metric, selected]);

  const showChart = metric === "download" || metric === "revenue";
  const titleById = useMemo(() => new Map(cohort.titles.map((t) => [t.titleId, t])), [cohort.titles]);

  if (cohort.titles.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        {rangeLabel} 조건에 맞는 작품이 없습니다.
      </div>
    );
  }

  const pill = (active: boolean) =>
    `rounded px-2.5 py-1 text-xs ${active ? "bg-neutral-800 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"}`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex gap-1">
          {METRICS.map((m) => (
            <button key={m.value} type="button" onClick={() => setMetric(m.value)} className={pill(metric === m.value)}>
              {m.label}
            </button>
          ))}
        </div>
        <span className="text-neutral-300">|</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setView("cumulative")}
            className={pill(effectiveView === "cumulative")}
          >
            누적
          </button>
          <button
            type="button"
            disabled={metric === "star"}
            onClick={() => setView("increase")}
            className={`${pill(effectiveView === "increase")} disabled:cursor-not-allowed disabled:opacity-40`}
            title={metric === "star" ? "별점은 증가분을 비교하지 않습니다" : "직전 시점 대비 그 달에 늘어난 양"}
          >
            월 증가
          </button>
        </div>
      </div>

      {/* 시점별 신작 평균 */}
      <div className="mb-6 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <th className="px-3 py-2">{rangeLabel} · {cohort.titles.length}개 작품</th>
              {marks.map((mark) => (
                <th key={mark} className="px-3 py-2 text-right">
                  {MARK_LABEL[mark]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["비교 가능 작품 수", (s: MarkStat) => `${s.n}개`],
                ["중앙값", (s: MarkStat) => formatValue(s.median, metric)],
                ["평균", (s: MarkStat) => formatValue(s.mean, metric)],
                ["상위 10% 기준", (s: MarkStat) => formatValue(s.top10, metric)],
                ["최고", (s: MarkStat) => formatValue(s.max, metric)],
              ] as [string, (s: MarkStat) => string][]
            ).map(([label, fn]) => (
              <tr key={label} className="border-b border-neutral-100 last:border-0">
                <td className="px-3 py-1.5 text-neutral-500">{label}</td>
                {marks.map((mark) => (
                  <td key={mark} className="px-3 py-1.5 text-right tabular-nums">
                    {stats[mark] ? fn(stats[mark]!) : "-"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showChart && (
        <section className="mb-6">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-neutral-500">
              런칭 후 경과일별 누적 {metric === "revenue" ? "추정 매출" : "다운로드"}
            </h2>
            <span className="text-xs text-neutral-400">
              굵은 선=신작 중앙값, 점선=상위/하위 25% · 표의 체크박스로 작품을 최대 {MAX_SELECTED}개까지 겹쳐 볼 수 있어요
            </span>
          </div>
          <div className="rounded-lg border border-neutral-200 bg-white p-3">
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis
                    dataKey="offset"
                    type="number"
                    domain={[0, MAX_OFFSET]}
                    ticks={[0, 15, 30, 45, 60, 75, 90]}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `+${v}일`}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    width={64}
                    tickFormatter={(v: number) => (metric === "revenue" ? formatWon(v) : `${Math.round(v / 10000).toLocaleString()}만`)}
                  />
                  <Tooltip
                    isAnimationActive={false}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const n = (payload[0].payload as { n: number }).n;
                      return (
                        <div className="rounded border border-neutral-200 bg-white p-2 text-xs shadow">
                          <div className="mb-1 font-medium">
                            런칭 +{label}일 <span className="font-normal text-neutral-400">(비교 {n}개)</span>
                          </div>
                          {payload
                            .filter((p) => typeof p.value === "number")
                            .map((p) => (
                              <div key={String(p.dataKey)} className="flex justify-between gap-4">
                                <span style={{ color: p.color }}>{p.name}</span>
                                <span className="tabular-nums">{formatValue(p.value as number, metric)}</span>
                              </div>
                            ))}
                        </div>
                      );
                    }}
                  />
                  {[30, 60, 90].map((x) => (
                    <ReferenceLine key={x} x={x} stroke="#d4d4d4" strokeDasharray="4 4" />
                  ))}
                  <Line dataKey="p75" name="상위 25%" stroke="#a3a3a3" strokeDasharray="4 3" dot={false} strokeWidth={1} isAnimationActive={false} connectNulls />
                  <Line dataKey="p25" name="하위 25%" stroke="#a3a3a3" strokeDasharray="4 3" dot={false} strokeWidth={1} isAnimationActive={false} connectNulls />
                  <Line dataKey="median" name="신작 중앙값" stroke="#171717" strokeWidth={3} dot={false} isAnimationActive={false} connectNulls />
                  {selected.map((id, i) => (
                    <Line
                      key={id}
                      dataKey={`t${id}`}
                      name={titleById.get(id)?.name ?? String(id)}
                      stroke={COLORS[i % COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {selected.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {selected.map((id, i) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggleSelected(id)}
                    className="flex items-center gap-1 text-neutral-600 hover:line-through"
                    title="클릭하면 그래프에서 제외"
                  >
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                    {titleById.get(id)?.name}
                  </button>
                ))}
                <button type="button" onClick={() => setSelected([])} className="text-neutral-400 hover:text-neutral-700">
                  모두 해제
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE_SIZE);
          }}
          placeholder="작품명/제작사 검색"
          className="w-56 rounded border border-neutral-300 px-2.5 py-1 text-sm"
        />
        <label className="flex items-center gap-1.5 text-xs text-neutral-500">
          <input type="checkbox" checked={onlyWithSort} onChange={(e) => setOnlyWithSort(e.target.checked)} />
          {MARK_LABEL[effectiveSort]} 값이 있는 작품만
        </label>
        <span className="text-xs text-neutral-400">열 제목을 누르면 그 시점 기준으로 정렬</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <th className="w-8 px-2 py-2" />
              <th className="px-3 py-2">작품</th>
              <th className="px-3 py-2">런칭일</th>
              {marks.map((mark) => (
                <th key={mark} className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setSortMark(mark)}
                    className={`${effectiveSort === mark ? "font-semibold text-neutral-900" : "hover:text-neutral-800"}`}
                  >
                    {MARK_LABEL[mark]}
                    {effectiveSort === mark ? " ▼" : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((t) => (
              <tr key={t.titleId} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                <td className="px-2 py-2 text-center">
                  {showChart && (
                    <input
                      type="checkbox"
                      checked={selected.includes(t.titleId)}
                      disabled={!selected.includes(t.titleId) && selected.length >= MAX_SELECTED}
                      onChange={() => toggleSelected(t.titleId)}
                      aria-label={`${t.name} 그래프에 표시`}
                    />
                  )}
                </td>
                <td className="px-3 py-2">
                  <Link href={`/webtoon/${t.titleId}`} className="flex items-center gap-2">
                    {t.thumbnail && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.thumbnail} alt="" width={28} height={36} loading="lazy" className="h-9 w-7 shrink-0 rounded object-cover" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-medium hover:underline">{t.name}</span>
                      <span className="block truncate text-xs text-neutral-400">
                        {t.studio ?? "제작사 미상"}
                        {t.isFinished && " · 완결"}
                        {t.isAdult && " · 성인"}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-neutral-500">{t.launchDate}</td>
                {marks.map((mark) => {
                  const v = valueAt(t, mark, metric, effectiveView);
                  const stat = stats[mark];
                  const r = v !== null && stat ? rankOf(stat, v) : null;
                  return (
                    <td key={mark} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {formatValue(v, metric)}
                      {r && stat && <PercentBadge pct={r.pct} rank={r.rank} n={stat.n} />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + PAGE_SIZE)}
          className="mt-3 w-full rounded border border-neutral-200 bg-white py-2 text-sm text-neutral-600 hover:bg-neutral-50"
        >
          더 보기 ({limit}/{rows.length})
        </button>
      )}

      <p className="mt-3 text-xs leading-relaxed text-neutral-400">
        1·2·3개월차는 런칭 후 30·60·90일째 값(그 날짜 ±3일 안에서 가장 가까운 수집 기록)이고, 아직 그 날이 안 지났거나 수집을 시작한
        2026-08-11 이전이라 기록이 없으면 &quot;-&quot;입니다. 퍼센트 배지는 같은 시점 값이 있는 신작들 중 순위로, 비교 대상 작품이 달라서
        시점마다 모집단 크기가 다릅니다. 추정 매출은 다운로드 × 300원, 댓글수는 그 시점의 전체 회차 댓글 합계입니다. 성인 작품은 런칭일이
        수집기가 처음 발견한 날이라 실제보다 늦을 수 있습니다.
      </p>
    </div>
  );
}
