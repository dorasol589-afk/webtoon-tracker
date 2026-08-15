import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getTitle,
  getEpisodesWithLatestCount,
  getLatestTitleSnapshot,
  getSeriesProductForTitle,
  getSeriesHistory,
  getTitleNotes,
} from "@/lib/queries";
import SeriesDownloadChart from "./SeriesDownloadChart";
import TitleNotesForm from "./TitleNotesForm";
import StudioNameEditor from "@/app/StudioNameEditor";
import { hasAdminAccess } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const WEEKDAY_KO: Record<string, string> = {
  MONDAY: "월",
  TUESDAY: "화",
  WEDNESDAY: "수",
  THURSDAY: "목",
  FRIDAY: "금",
  SATURDAY: "토",
  SUNDAY: "일",
};

export default async function TitlePage({
  params,
  searchParams,
}: {
  params: Promise<{ titleId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { titleId } = await params;
  const { tab } = await searchParams;
  const id = Number(titleId);
  if (!Number.isInteger(id)) notFound();
  const readOnly = !hasAdminAccess();

  const title = await getTitle(id);
  if (!title) notFound();

  const seriesProduct = await getSeriesProductForTitle(id);

  const [episodes, snapshot, seriesHistory, titleNotes] = await Promise.all([
    getEpisodesWithLatestCount(id),
    getLatestTitleSnapshot(id),
    seriesProduct ? getSeriesHistory(seriesProduct.productNo) : Promise.resolve([]),
    getTitleNotes(id),
  ]);

  const selectedTab = tab === "stats" ? "stats" : "list";
  const topByComments = [...episodes]
    .filter((e) => e.comment_count !== null)
    .sort((a, b) => (b.comment_count as number) - (a.comment_count as number))
    .slice(0, 10);

  return (
    <div>
      <div className="mb-6 flex items-start gap-4">
        {title.thumbnail_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={title.thumbnail_url}
            alt=""
            width={112}
            height={145}
            className="h-auto w-28 shrink-0 rounded-lg"
          />
        )}
        <div>
          <h1 className="text-xl font-semibold">{title.title_name}</h1>
          <p className="text-sm text-neutral-500">{title.author}</p>
          {title.is_new && (
            <span className="mt-1 mr-1 inline-block rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
              신작
            </span>
          )}
          {title.is_adult && (
            <span className="mt-1 mr-1 inline-block rounded bg-rose-100 px-2 py-0.5 text-xs text-rose-700">
              성인
            </span>
          )}
          {title.is_finished && (
            <span className="mt-1 inline-block rounded bg-neutral-700 px-2 py-0.5 text-xs text-white">
              완결
            </span>
          )}
          {title.is_on_hiatus && (
            <span className="mt-1 inline-block rounded bg-orange-200 px-2 py-0.5 text-xs text-orange-800">
              휴재중
            </span>
          )}
          {!title.is_active && !title.is_finished && !title.is_on_hiatus && (
            <span className="mt-1 inline-block rounded bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600">
              현재 연재목록에서 제외됨
            </span>
          )}
          <div className="mt-1 flex items-center gap-1 text-sm text-neutral-500">
            제작사:
            <StudioNameEditor titleId={id} studioName={title.studio_name} readOnly={readOnly} />
            {title.studio_name && title.studio_website_url && (
              <a
                href={title.studio_website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline"
              >
                (홈페이지)
              </a>
            )}
          </div>
          {snapshot && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {snapshot.star_score !== null && (
                <span className="rounded bg-amber-100 px-2 py-1 text-amber-800">
                  ★ {snapshot.star_score.toFixed(2)}
                </span>
              )}
              {snapshot.weekday && snapshot.popularity_rank && (
                <span className="rounded bg-blue-100 px-2 py-1 text-blue-800">
                  {snapshot.weekday === "DAILY_PLUS"
                    ? "매일+"
                    : `${WEEKDAY_KO[snapshot.weekday] ?? snapshot.weekday}요일`}{" "}
                  인기 {snapshot.popularity_rank}위
                </span>
              )}
            </div>
          )}
          {title.synopsis && (
            <details className="group mt-3 text-sm leading-relaxed text-neutral-700">
              <summary className="list-none cursor-pointer marker:hidden [&::-webkit-details-marker]:hidden">
                <p className="line-clamp-3 whitespace-pre-line group-open:line-clamp-none">
                  {title.synopsis}
                </p>
                <span className="mt-1 inline-block text-xs text-blue-600 hover:underline">
                  <span className="group-open:hidden">더보기</span>
                  <span className="hidden group-open:inline">접기</span>
                </span>
              </summary>
            </details>
          )}
        </div>
      </div>

      <div className="mb-6">
        <TitleNotesForm titleId={id} initial={titleNotes} readOnly={readOnly} />
      </div>

      <div className="mb-4">
        <a
          href={`/api/export/${id}`}
          className="inline-block rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          엑셀 다운로드
        </a>
      </div>

      {seriesProduct && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-neutral-500">
            네이버 시리즈 누적 다운로드수
            {seriesHistory.length > 0 && (
              <span className="ml-2 text-neutral-800">
                {seriesHistory[seriesHistory.length - 1].download_count.toLocaleString()}
              </span>
            )}
          </h2>
          <SeriesDownloadChart data={seriesHistory} />
        </div>
      )}

      <div className="mb-3 flex gap-1">
        <Link
          href={`/webtoon/${id}`}
          className={`rounded px-3 py-1.5 text-sm ${
            selectedTab === "list"
              ? "bg-neutral-800 text-white"
              : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
          }`}
        >
          회차 목록
        </Link>
        <Link
          href={`/webtoon/${id}?tab=stats`}
          className={`rounded px-3 py-1.5 text-sm ${
            selectedTab === "stats"
              ? "bg-neutral-800 text-white"
              : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
          }`}
        >
          통계
        </Link>
      </div>

      {selectedTab === "list" && (
        <table className="w-full border-collapse overflow-hidden rounded-lg border border-neutral-200 bg-white text-sm">
          <thead className="bg-neutral-100 text-left text-neutral-500">
            <tr>
              <th className="px-3 py-2">회차</th>
              <th className="px-3 py-2">등록일</th>
              <th className="px-3 py-2">구분</th>
              <th className="px-3 py-2 text-right">댓글수</th>
            </tr>
          </thead>
          <tbody>
            {episodes.map((e) => (
              <tr key={e.no} className="border-t border-neutral-100 hover:bg-neutral-50">
                <td className="px-3 py-2">
                  {e.is_free ? (
                    <Link href={`/webtoon/${id}/${e.no}`} className="text-blue-600 hover:underline">
                      {e.subtitle ?? `${e.no}화`}
                    </Link>
                  ) : (
                    <span className="text-neutral-400">{e.subtitle ?? `${e.no}화`}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-neutral-500">{e.service_date ?? "-"}</td>
                <td className="px-3 py-2">
                  {e.is_free ? (
                    <span className="text-emerald-600">무료</span>
                  ) : (
                    <span className="text-neutral-400">유료</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {e.comment_count !== null ? e.comment_count.toLocaleString() : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedTab === "stats" && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-neutral-500">댓글수 TOP10 회차</h2>
          <ol className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
            {topByComments.length === 0 && (
              <li className="p-4 text-sm text-neutral-500">데이터 없음</li>
            )}
            {topByComments.map((e, i) => (
              <li key={e.no}>
                <Link
                  href={`/webtoon/${id}/${e.no}`}
                  className="flex items-center gap-3 p-3 hover:bg-neutral-50"
                >
                  <span className="w-5 shrink-0 text-center text-sm text-neutral-400">{i + 1}</span>
                  <span className="flex-1 truncate text-sm font-medium">
                    {e.subtitle ?? `${e.no}화`}
                  </span>
                  <span className="shrink-0 text-sm text-neutral-600">
                    댓글 {e.comment_count?.toLocaleString()}개
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
