"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ActiveJobPostingGroup, JobPostingRow } from "@/lib/queries";
import { ddayToDays } from "@/lib/format";
import ApplyToggle from "./ApplyToggle";

const SOURCE_LABEL: Record<string, string> = {
  SARAMIN: "사람인",
  JOBKOREA: "잡코리아",
};

type SortBy = "studio" | "deadline";
type FlatPosting = JobPostingRow & { studioName: string };

export default function RecruitSearch({
  groups,
  readOnly = false,
}: {
  groups: ActiveJobPostingGroup[];
  readOnly?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("studio");

  const flat = useMemo<FlatPosting[]>(
    () => groups.flatMap((g) => g.postings.map((p) => ({ ...p, studioName: g.studioName }))),
    [groups]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? flat.filter((p) => p.studioName.toLowerCase().includes(q) || p.title.toLowerCase().includes(q))
      : flat;
    return [...base].sort((a, b) => {
      if (sortBy === "deadline") {
        return ddayToDays(a.dday) - ddayToDays(b.dday) || a.studioName.localeCompare(b.studioName, "ko");
      }
      return a.studioName.localeCompare(b.studioName, "ko");
    });
  }, [flat, query, sortBy]);

  return (
    <div>
      <div className="mb-6 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="제작사명 또는 공고 제목으로 검색..."
          className="flex-1 rounded border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          className="rounded border border-neutral-200 px-2 py-2 text-sm focus:border-neutral-400 focus:outline-none"
        >
          <option value="studio">기업명순</option>
          <option value="deadline">마감일순</option>
        </select>
      </div>

      {query && <p className="mb-4 text-sm text-neutral-400">{filtered.length.toLocaleString()}건 검색됨</p>}

      {filtered.length === 0 && (
        <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
          {query ? "검색 결과가 없습니다." : "현재 진행중인 공고가 없습니다."}
        </p>
      )}

      {filtered.length > 0 && (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
          {filtered.map((p, i) => (
            <li key={`${p.studioName}-${i}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Link
                  href={`/studios/${encodeURIComponent(p.studioName)}`}
                  className="shrink-0 text-neutral-400 hover:underline"
                >
                  {p.studioName}
                </Link>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-blue-600 hover:underline"
                >
                  {p.title}
                </a>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {p.dday && <span className="text-xs text-neutral-400">{p.dday}</span>}
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
                  {SOURCE_LABEL[p.source] ?? p.source}
                </span>
                <ApplyToggle source={p.source} postingId={p.postingId} initialApplied={p.applied} readOnly={readOnly} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
