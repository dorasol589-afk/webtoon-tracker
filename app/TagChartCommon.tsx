"use client";

import { useState } from "react";
import type { TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { TagStatRow } from "@/lib/queries";
import { COMPARISON_COLORS } from "@/lib/chartColors";

export const INACTIVE_COLOR = "#d1d5db";
const TOOLTIP_MAX_ROWS = 8;

export function colorForTag(idx: number, tagName: string, activeTag: string | null): string {
  return activeTag === null || activeTag === tagName ? COMPARISON_COLORS[idx % COMPARISON_COLORS.length] : INACTIVE_COLOR;
}

export function MetricTooltip({
  active,
  label,
  payload,
  activeTag,
  valueFormatter = (v) => v.toLocaleString(),
}: TooltipContentProps<ValueType, NameType> & {
  activeTag: string | null;
  valueFormatter?: (value: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const filtered = activeTag ? payload.filter((p) => String(p.dataKey) === activeTag) : payload;
  const base = filtered.length > 0 ? filtered : payload;
  const sorted = [...base].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  const shown = sorted.slice(0, TOOLTIP_MAX_ROWS);
  const hiddenCount = sorted.length - shown.length;

  return (
    <div className="rounded border border-neutral-200 bg-white p-2 text-xs shadow-sm">
      <div className="mb-1 font-medium text-neutral-700">{label}</div>
      {shown.map((p) => (
        <div key={String(p.dataKey)} className="flex justify-between gap-3" style={{ color: p.color }}>
          <span>{p.name}</span>
          <span>{valueFormatter(Number(p.value))}</span>
        </div>
      ))}
      {hiddenCount > 0 && <div className="mt-1 text-neutral-400">외 {hiddenCount}개 더</div>}
    </div>
  );
}

export function TagPicker({
  options,
  selected,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onSelectTopN,
  topN,
}: {
  options: TagStatRow[];
  selected: Set<string>;
  onToggle: (tagName: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onSelectTopN: () => void;
  topN: number;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = search.trim() ? options.filter((o) => o.tag_name.includes(search.trim())) : options;

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
            <div className="mb-2 flex gap-1">
              <button
                type="button"
                onClick={onSelectTopN}
                className="flex-1 rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-200"
              >
                상위 {topN}개
              </button>
              <button
                type="button"
                onClick={onSelectAll}
                className="flex-1 rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-200"
              >
                전체 선택
              </button>
              <button
                type="button"
                onClick={onDeselectAll}
                className="flex-1 rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-200"
              >
                전체 해제
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {filtered.length === 0 && (
                <div className="p-2 text-center text-xs text-neutral-400">검색 결과 없음</div>
              )}
              {filtered.map((o) => (
                <label
                  key={o.tag_name}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-neutral-50"
                >
                  <input type="checkbox" checked={selected.has(o.tag_name)} onChange={() => onToggle(o.tag_name)} />
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

export function useTagSelection(options: TagStatRow[], defaultSelectedCount: number) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(options.slice(0, defaultSelectedCount).map((o) => o.tag_name))
  );

  function toggleTag(tagName: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tagName)) next.delete(tagName);
      else next.add(tagName);
      return next;
    });
  }

  function selectAllTags() {
    setSelected(new Set(options.map((o) => o.tag_name)));
  }

  function selectTopNTags() {
    setSelected(new Set(options.slice(0, defaultSelectedCount).map((o) => o.tag_name)));
  }

  function deselectAllTags() {
    setSelected(new Set());
  }

  return { selected, toggleTag, selectAllTags, selectTopNTags, deselectAllTags };
}

/** 범례/선을 클릭하면 그 항목만 계속 강조되도록 고정 - 다시 클릭하면 해제(전체 보기로 복귀) */
export function useActiveHighlight() {
  const [activeTag, setActiveTag] = useState<string | null>(null);
  function toggleActive(tagName: string) {
    setActiveTag((prev) => (prev === tagName ? null : tagName));
  }
  return { activeTag, setActiveTag, toggleActive };
}
