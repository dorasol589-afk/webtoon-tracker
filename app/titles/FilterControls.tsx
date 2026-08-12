"use client";

import { useRouter } from "next/navigation";
import type { TitleSortBy, TitleStatusFilter, TitleTypeFilter } from "@/lib/queries";

const TYPE_OPTIONS: { value: TitleTypeFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "weekday", label: "요일웹툰" },
  { value: "daily_plus", label: "매일+" },
];

const STATUS_OPTIONS: { value: TitleStatusFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "ongoing", label: "연재중" },
  { value: "new", label: "신작" },
  { value: "finished", label: "완결" },
  { value: "hiatus", label: "휴재" },
];

const SORT_OPTIONS: { value: TitleSortBy; label: string }[] = [
  { value: "name", label: "이름순" },
  { value: "popularity", label: "인기순" },
  { value: "star", label: "별점순" },
  { value: "launch", label: "런칭일순" },
  { value: "comments", label: "댓글수순" },
];

const ADULT_OPTIONS: { value: "false" | "true"; label: string }[] = [
  { value: "false", label: "전체" },
  { value: "true", label: "성인 웹툰만" },
];

const selectClass =
  "rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none";

export default function FilterControls({
  type,
  status,
  sort,
  adultOnly,
  launchFrom,
  launchTo,
}: {
  type: TitleTypeFilter;
  status: TitleStatusFilter;
  sort: TitleSortBy;
  adultOnly: boolean;
  launchFrom: string;
  launchTo: string;
}) {
  const router = useRouter();

  function update(
    next: Partial<{
      type: TitleTypeFilter;
      status: TitleStatusFilter;
      sort: TitleSortBy;
      adultOnly: boolean;
      launchFrom: string;
      launchTo: string;
    }>
  ) {
    const sp = new URLSearchParams();
    const merged = { type, status, sort, adultOnly, launchFrom, launchTo, ...next };
    if (merged.type !== "all") sp.set("type", merged.type);
    if (merged.status !== "all") sp.set("status", merged.status);
    if (merged.sort !== "name") sp.set("sort", merged.sort);
    if (merged.adultOnly) sp.set("adult", "true");
    if (merged.launchFrom) sp.set("launchFrom", merged.launchFrom);
    if (merged.launchTo) sp.set("launchTo", merged.launchTo);
    const qs = sp.toString();
    router.push(`/titles${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <select
        value={type}
        onChange={(e) => update({ type: e.target.value as TitleTypeFilter })}
        className={selectClass}
      >
        {TYPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        value={status}
        onChange={(e) => update({ status: e.target.value as TitleStatusFilter })}
        className={selectClass}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        value={adultOnly ? "true" : "false"}
        onChange={(e) => update({ adultOnly: e.target.value === "true" })}
        className={selectClass}
      >
        {ADULT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        value={sort}
        onChange={(e) => update({ sort: e.target.value as TitleSortBy })}
        className={selectClass}
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="flex items-center gap-1 text-sm text-neutral-500">
        런칭일
        <input
          type="date"
          value={launchFrom}
          onChange={(e) => update({ launchFrom: e.target.value })}
          className={selectClass}
        />
        ~
        <input
          type="date"
          value={launchTo}
          onChange={(e) => update({ launchTo: e.target.value })}
          className={selectClass}
        />
        {(launchFrom || launchTo) && (
          <button
            onClick={() => update({ launchFrom: "", launchTo: "" })}
            className="rounded px-2 py-1.5 text-xs text-neutral-500 hover:bg-neutral-100"
          >
            초기화
          </button>
        )}
      </span>
    </div>
  );
}
