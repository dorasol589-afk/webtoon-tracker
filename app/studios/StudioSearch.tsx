"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { StudioGroup } from "@/lib/queries";
import { formatManwon } from "@/lib/format";

const WEEKDAY_KO: Record<string, string> = {
  MONDAY: "월",
  TUESDAY: "화",
  WEDNESDAY: "수",
  THURSDAY: "목",
  FRIDAY: "금",
  SATURDAY: "토",
  SUNDAY: "일",
  DAILY_PLUS: "매일+",
};

type SortBy = "titleCount" | "downloadCount" | "viewCount";

export default function StudioSearch({ groups }: { groups: StudioGroup[] }) {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("titleCount");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? groups.filter((g) => g.studioName.toLowerCase().includes(q)) : groups;
    return [...base].sort((a, b) => {
      if (sortBy === "downloadCount") {
        return b.totalDownloadCount - a.totalDownloadCount || b.titles.length - a.titles.length;
      }
      if (sortBy === "viewCount") {
        return b.totalViewCount - a.totalViewCount || b.titles.length - a.titles.length;
      }
      return b.titles.length - a.titles.length || b.totalDownloadCount - a.totalDownloadCount;
    });
  }, [groups, query, sortBy]);

  return (
    <div>
      <div className="mb-6 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="제작사명으로 검색..."
          className="flex-1 rounded border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          className="rounded border border-neutral-200 px-2 py-2 text-sm focus:border-neutral-400 focus:outline-none"
        >
          <option value="titleCount">작품수순</option>
          <option value="downloadCount">다운수순(네이버)</option>
          <option value="viewCount">조회수순(카카오)</option>
        </select>
      </div>

      {query && (
        <p className="mb-4 text-sm text-neutral-400">{filtered.length.toLocaleString()}곳 검색됨</p>
      )}

      {filtered.length === 0 && (
        <p className="text-sm text-neutral-400">검색 결과가 없습니다.</p>
      )}

      {filtered.map((group) => (
        <section key={group.studioName} className="mb-8">
          <h2 className="mb-3 flex items-baseline gap-2">
            <Link
              href={`/studios/${encodeURIComponent(group.studioName)}`}
              className="text-base font-semibold hover:underline"
            >
              {group.studioName}
            </Link>
            <span className="text-xs text-neutral-400">{group.titles.length}개</span>
            {group.totalDownloadCount > 0 && (
              <span className="text-xs text-neutral-400">
                네이버 누적 다운로드 {formatManwon(group.totalDownloadCount)}
              </span>
            )}
            {group.totalViewCount > 0 && (
              <span className="text-xs text-neutral-400">
                카카오 누적 조회수 {formatManwon(group.totalViewCount)}
              </span>
            )}
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {group.titles.map((t) => (
              <Link
                key={`${t.platform}-${t.id}`}
                href={t.platform === "kakao" ? `/kakao/webtoon/${t.id}` : `/webtoon/${t.id}`}
                className="w-28 shrink-0 rounded-lg border border-neutral-200 bg-white p-2 hover:bg-neutral-50"
              >
                {t.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.thumbnail_url}
                    alt=""
                    width={112}
                    height={145}
                    className="mb-2 h-auto w-full rounded"
                  />
                )}
                <span
                  className={`mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] ${
                    t.platform === "kakao" ? "bg-yellow-100 text-yellow-800" : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {t.platform === "kakao" ? "카카오" : "네이버"}
                </span>
                <div className="truncate text-sm font-medium">{t.title_name}</div>
                {t.weekday && t.popularity_rank !== null && (
                  <div className="text-xs text-neutral-500">
                    {WEEKDAY_KO[t.weekday] ?? t.weekday}
                    {t.weekday === "DAILY_PLUS" ? "" : "요일"} 인기 {t.popularity_rank}위
                  </div>
                )}
                {t.platform === "naver" && t.download_count !== null && (
                  <div className="text-xs text-neutral-500">다운 {formatManwon(t.download_count)}</div>
                )}
                {t.platform === "kakao" && t.view_count !== null && (
                  <div className="text-xs text-neutral-500">조회 {formatManwon(t.view_count)}</div>
                )}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
