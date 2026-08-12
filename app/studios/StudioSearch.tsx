"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { StudioGroup } from "@/lib/queries";

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

export default function StudioSearch({ groups }: { groups: StudioGroup[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => g.studioName.toLowerCase().includes(q));
  }, [groups, query]);

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="제작사명으로 검색..."
        className="mb-6 w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none"
      />

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
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {group.titles.map((t) => (
              <Link
                key={t.title_id}
                href={`/webtoon/${t.title_id}`}
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
                <div className="truncate text-sm font-medium">{t.title_name}</div>
                {t.weekday && t.popularity_rank !== null && (
                  <div className="text-xs text-neutral-500">
                    {WEEKDAY_KO[t.weekday] ?? t.weekday}
                    {t.weekday === "DAILY_PLUS" ? "" : "요일"} 인기 {t.popularity_rank}위
                  </div>
                )}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
