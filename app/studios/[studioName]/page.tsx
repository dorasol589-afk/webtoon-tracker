import Link from "next/link";
import { notFound } from "next/navigation";
import { getStudioTitles, getStudioJobPostings, getStudioRecruitLinkInfo } from "@/lib/queries";

export const dynamic = "force-dynamic";

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

const SOURCE_LABEL: Record<string, string> = {
  SARAMIN: "사람인",
  JOBKOREA: "잡코리아",
};

export default async function StudioDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ studioName: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { studioName: rawName } = await params;
  const { tab } = await searchParams;
  const studioName = decodeURIComponent(rawName);
  const selectedTab = tab === "jobs" ? "jobs" : "titles";

  const [studio, postings, recruitLinkInfo] = await Promise.all([
    getStudioTitles(studioName),
    getStudioJobPostings(studioName),
    getStudioRecruitLinkInfo(studioName),
  ]);
  if (!studio) notFound();

  const activePostings = postings.filter((p) => p.status === "ACTIVE");
  const closedPostings = postings.filter((p) => p.status === "CLOSED");

  return (
    <div>
      <div className="mb-6">
        <Link href="/studios" className="mb-2 inline-block text-sm text-neutral-400 hover:text-neutral-600">
          ← 제작사별 작품
        </Link>
        <h1 className="text-lg font-semibold">
          {studio.studioWebsiteUrl ? (
            <a
              href={studio.studioWebsiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              {studio.studioName}
            </a>
          ) : (
            studio.studioName
          )}
        </h1>
        <p className="text-sm text-neutral-400">작품 {studio.titles.length}개</p>
      </div>

      <div className="mb-6 flex gap-2">
        <Link
          href={`/studios/${encodeURIComponent(studioName)}`}
          className={`rounded px-3 py-1.5 text-sm ${
            selectedTab === "titles"
              ? "bg-neutral-800 text-white"
              : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
          }`}
        >
          작품
        </Link>
        <Link
          href={`/studios/${encodeURIComponent(studioName)}?tab=jobs`}
          className={`rounded px-3 py-1.5 text-sm ${
            selectedTab === "jobs"
              ? "bg-neutral-800 text-white"
              : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
          }`}
        >
          채용공고
          {activePostings.length > 0 && (
            <span className="ml-1 text-xs text-emerald-300">{activePostings.length}</span>
          )}
        </Link>
      </div>

      {selectedTab === "titles" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {studio.titles.map((t) => (
            <Link
              key={t.title_id}
              href={`/webtoon/${t.title_id}`}
              className="rounded-lg border border-neutral-200 bg-white p-2 hover:bg-neutral-50"
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
      )}

      {selectedTab === "jobs" && (
        <div>
          {!recruitLinkInfo && (
            <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
              사이트 내 기업 정보가 없습니다.
            </p>
          )}

          {recruitLinkInfo && postings.length === 0 && (
            <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
              현재 진행 중인 공고가 없습니다.
            </p>
          )}

          {activePostings.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 text-sm font-semibold text-neutral-700">진행중인 공고</h2>
              <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
                {activePostings.map((p, i) => (
                  <li key={i}>
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-neutral-50"
                    >
                      <span className="truncate text-blue-600 hover:underline">{p.title}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {p.dday && <span className="text-xs text-neutral-400">{p.dday}</span>}
                        <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
                          {SOURCE_LABEL[p.source] ?? p.source}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {closedPostings.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-neutral-400">마감된 공고</h2>
              <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-neutral-50">
                {closedPostings.map((p, i) => (
                  <li key={i}>
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-neutral-400 hover:bg-neutral-100"
                    >
                      <span className="truncate">{p.title}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {p.dday && <span className="text-xs text-neutral-400">{p.dday}</span>}
                        <span className="rounded bg-neutral-200 px-2 py-0.5 text-xs text-neutral-500">
                          {SOURCE_LABEL[p.source] ?? p.source}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
