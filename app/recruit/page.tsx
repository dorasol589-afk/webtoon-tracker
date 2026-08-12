import Link from "next/link";
import { getActiveJobPostingsByStudio } from "@/lib/queries";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  SARAMIN: "사람인",
  JOBKOREA: "잡코리아",
};

export default async function RecruitPage() {
  let groups: Awaited<ReturnType<typeof getActiveJobPostingsByStudio>> = [];
  let loadError = false;
  try {
    groups = await getActiveJobPostingsByStudio();
  } catch {
    loadError = true;
  }

  const totalCount = groups.reduce((sum, g) => sum + g.postings.length, 0);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">채용공고</h1>
      <p className="mb-6 text-sm text-neutral-400">
        {!loadError && `현재 진행중인 공고 ${totalCount.toLocaleString()}건`}
      </p>

      {loadError && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          Supabase 연결 설정이 필요합니다.
        </div>
      )}

      {!loadError && totalCount === 0 && (
        <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
          현재 진행중인 공고가 없습니다.
        </p>
      )}

      {!loadError && totalCount > 0 && (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
          {groups.map((g) =>
            g.postings.map((p, i) => (
              <li key={`${g.studioName}-${i}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <Link
                    href={`/studios/${encodeURIComponent(g.studioName)}`}
                    className="shrink-0 text-neutral-400 hover:underline"
                  >
                    {g.studioName}
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
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
