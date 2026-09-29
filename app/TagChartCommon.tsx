"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

const MIN_VISIBLE_POINTS = 4;

/** 그래프 위에서 마우스 휠을 굴리면 커서가 있는 지점을 중심으로 확대/축소한다(위로 굴리면 확대,
 * 아래로 굴리면 축소). recharts 자체엔 휠 줌이 없어서, 보여줄 데이터 구간[start, end]을 우리가
 * 들고 있다가 잘라서 넘기는 방식으로 구현 - x축이 날짜/기간 같은 카테고리 축이라 픽셀 위치를
 * "몇 번째 데이터인지"로 근사 환산한다(차트의 왼쪽 여백=plotLeft, 오른쪽 여백=plotRight).
 *
 * React의 onWheel prop으로 붙이면 브라우저가 wheel 리스너를 기본 passive로 등록해서
 * preventDefault()가 무시되고 페이지 전체가 같이 스크롤되는 문제가 실제로 있었다 - 컨테이너에
 * addEventListener(..., { passive: false })로 직접 붙여야 preventDefault가 먹는다.
 *
 * 리스너를 `useEffect(..., [length, ...])`로 붙였을 때는 또 다른 버그가 있었다: 로딩 중엔 차트
 * div 자체가 통째로 언마운트됐다가 데이터가 오면 새 div로 다시 마운트되는데, 태그를 바꿔도
 * 우연히 기간 수(length)가 똑같이 나오면 effect가 재실행되지 않아 리스너가 이미 사라진 예전
 * div에 붙은 채로 남아있었다(다른 태그 선택 시 휠 줌이 먹통되는 문제로 실제 확인됨). div가
 * 마운트/언마운트될 때마다 확실히 다시 붙도록 콜백 ref로 직접 처리한다. */
export function useWheelZoom(length: number, plotLeft: number, plotRight: number) {
  const [range, setRange] = useState<[number, number]>([0, Math.max(0, length - 1)]);

  // 데이터 길이가 바뀌면(태그/기간 변경 등) 줌 범위를 초기화 - effect 대신 렌더 중 상태 조정
  // 패턴(React 공식 권장)을 써서 매번 리렌더 후 추가로 setState가 도는 걸 피한다.
  const [prevLength, setPrevLength] = useState(length);
  if (length !== prevLength) {
    setPrevLength(length);
    setRange([0, Math.max(0, length - 1)]);
  }

  // 휠 핸들러 안에서 항상 최신 length/여백을 보도록 ref로 들고 있는다(콜백 ref 자체는
  // 마운트마다 새로 만들지 않고 아래처럼 한 번만 만들어 재사용해야 클린업이 꼬이지 않는다).
  const latest = useRef({ length, plotLeft, plotRight });
  useEffect(() => {
    latest.current = { length, plotLeft, plotRight };
  }, [length, plotLeft, plotRight]);

  const cleanupRef = useRef<(() => void) | null>(null);
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!el) return;

    const onWheel = (e: globalThis.WheelEvent) => {
      const { length, plotLeft, plotRight } = latest.current;
      if (length <= MIN_VISIBLE_POINTS) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const plotWidth = Math.max(1, rect.width - plotLeft - plotRight);
      const xInPlot = e.clientX - rect.left - plotLeft;
      const fraction = Math.min(1, Math.max(0, xInPlot / plotWidth));

      const zoomFactor = e.deltaY < 0 ? 0.85 : 1 / 0.85;
      // 함수형 업데이트를 써서 트랙패드처럼 휠 이벤트가 짧은 시간에 여러 번 몰아쳐도(리액트가
      // 아직 커밋 전이라도) 매번 직전 range를 정확히 이어받아 계산한다.
      setRange(([start, end]) => {
        const curLength = end - start;
        const cursorIndex = start + fraction * curLength;
        const newLength = Math.min(length - 1, Math.max(MIN_VISIBLE_POINTS - 1, curLength * zoomFactor));

        let newStart = cursorIndex - fraction * newLength;
        let newEnd = newStart + newLength;
        if (newStart < 0) {
          newEnd -= newStart;
          newStart = 0;
        }
        if (newEnd > length - 1) {
          newStart -= newEnd - (length - 1);
          newEnd = length - 1;
        }
        newStart = Math.max(0, newStart);
        return [newStart, newEnd];
      });
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    cleanupRef.current = () => el.removeEventListener("wheel", onWheel);
  }, []);

  function resetZoom() {
    setRange([0, Math.max(0, length - 1)]);
  }

  // range는 확대가 아주 조금씩(휠 한 틱당 15%) 일어날 때도 누적되도록 소수 그대로 들고 있다가
  // 실제 배열을 자를 때만 반올림한다 - 데이터가 몇 개 안 되는 태그(예: 6개짜리)는 반올림을 먼저
  // 해버리면 한 틱의 변화폭이 반 칸도 안 돼서 매번 원래 정수로 다시 스냅되어 확대가 전혀 안
  // 먹히는 문제가 있었다(적게 선택된 태그에서 휠 줌이 먹통되는 문제로 실제 확인됨).
  const sliceRange: [number, number] = [Math.round(range[0]), Math.round(range[1])];
  const isZoomed = sliceRange[0] > 0 || sliceRange[1] < length - 1;
  return { sliceRange, containerRef, resetZoom, isZoomed };
}
