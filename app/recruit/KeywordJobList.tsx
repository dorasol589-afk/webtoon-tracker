import type { KeywordJobPostingRow } from "@/lib/queries";
import ApplyToggle from "./ApplyToggle";

const SOURCE_LABEL: Record<string, string> = {
  SARAMIN: "사람인",
  JOBKOREA: "잡코리아",
};

export default function KeywordJobList({
  keyword,
  postings,
  readOnly = false,
}: {
  keyword: string;
  postings: KeywordJobPostingRow[];
  readOnly?: boolean;
}) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 text-base font-semibold">
        &quot;{keyword}&quot; 키워드 공고{" "}
        <span className="text-sm font-normal text-neutral-400">({postings.length.toLocaleString()}건)</span>
      </h2>

      {postings.length === 0 && (
        <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
          현재 &quot;{keyword}&quot;로 검색되는 진행중인 공고가 없습니다.
        </p>
      )}

      {postings.length > 0 && (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
          {postings.map((p) => (
            <li
              key={`${p.source}-${p.postingId}`}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                {p.companyName && <span className="shrink-0 text-neutral-400">{p.companyName}</span>}
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
