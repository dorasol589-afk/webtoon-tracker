"use client";

import { useRouter } from "next/navigation";
import type { TitleSortBy, TitleStatusFilter, TitleTypeFilter, TitlePlatformFilter } from "@/lib/queries";

const PLATFORM_OPTIONS: { value: TitlePlatformFilter; label: string }[] = [
  { value: "all", label: "전체 플랫폼" },
  { value: "naver", label: "네이버웹툰" },
  { value: "kakao", label: "카카오웹툰" },
];

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

type SortValue = TitleSortBy | "views" | "likes";

const SORT_OPTIONS: { value: SortValue; label: string; platforms: TitlePlatformFilter[] }[] = [
  { value: "name", label: "이름순", platforms: ["all", "naver", "kakao"] },
  { value: "launch", label: "런칭일순", platforms: ["all", "naver", "kakao"] },
  { value: "popularity", label: "인기순(네이버)", platforms: ["all", "naver"] },
  { value: "star", label: "별점순(네이버)", platforms: ["all", "naver"] },
  { value: "comments", label: "댓글수순(네이버)", platforms: ["all", "naver"] },
  { value: "views", label: "조회수순(카카오)", platforms: ["all", "kakao"] },
  { value: "likes", label: "좋아요수순(카카오)", platforms: ["all", "kakao"] },
];

const ADULT_OPTIONS: { value: "false" | "true"; label: string }[] = [
  { value: "false", label: "전체" },
  { value: "true", label: "성인 웹툰만" },
];

const selectClass =
  "rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none";

export default function FilterControls({
  platform,
  type,
  status,
  sort,
  adultOnly,
  launchFrom,
  launchTo,
}: {
  platform: TitlePlatformFilter;
  type: TitleTypeFilter;
  status: TitleStatusFilter;
  sort: SortValue;
  adultOnly: boolean;
  launchFrom: string;
  launchTo: string;
}) {
  const router = useRouter();

  function update(
    next: Partial<{
      platform: TitlePlatformFilter;
      type: TitleTypeFilter;
      status: TitleStatusFilter;
      sort: SortValue;
      adultOnly: boolean;
      launchFrom: string;
      launchTo: string;
    }>
  ) {
    const merged = { platform, type, status, sort, adultOnly, launchFrom, launchTo, ...next };
    // 플랫폼을 바꾸면 그쪽에서 의미 없는 필터(요일웹툰/매일+ 타입, 상대 플랫폼 전용 정렬)는 초기화
    if (merged.platform !== "naver") merged.type = "all";
    const sortOption = SORT_OPTIONS.find((o) => o.value === merged.sort);
    if (sortOption && !sortOption.platforms.includes(merged.platform)) merged.sort = "name";

    const sp = new URLSearchParams();
    if (merged.platform !== "all") sp.set("platform", merged.platform);
    if (merged.type !== "all") sp.set("type", merged.type);
    if (merged.status !== "all") sp.set("status", merged.status);
    if (merged.sort !== "name") sp.set("sort", merged.sort);
    if (merged.adultOnly) sp.set("adult", "true");
    if (merged.launchFrom) sp.set("launchFrom", merged.launchFrom);
    if (merged.launchTo) sp.set("launchTo", merged.launchTo);
    const qs = sp.toString();
    router.push(`/titles${qs ? `?${qs}` : ""}`);
  }

  const availableSorts = SORT_OPTIONS.filter((o) => o.platforms.includes(platform));

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <select
        value={platform}
        onChange={(e) => update({ platform: e.target.value as TitlePlatformFilter })}
        className={selectClass}
      >
        {PLATFORM_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {platform === "naver" && (
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
      )}
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
        onChange={(e) => update({ sort: e.target.value as SortValue })}
        className={selectClass}
      >
        {availableSorts.map((o) => (
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
