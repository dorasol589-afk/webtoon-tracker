import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getTitle,
  getEpisodesWithLatestCount,
  getLatestTitleSnapshot,
  getSeriesProductForTitle,
  getSeriesHistory,
} from "@/lib/queries";
import SeriesDownloadChart from "./SeriesDownloadChart";

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
}: {
  params: Promise<{ titleId: string }>;
}) {
  const { titleId } = await params;
  const id = Number(titleId);
  if (!Number.isInteger(id)) notFound();

  const title = await getTitle(id);
  if (!title) notFound();

  const seriesProduct = await getSeriesProductForTitle(id);

  const [episodes, snapshot, seriesHistory] = await Promise.all([
    getEpisodesWithLatestCount(id),
    getLatestTitleSnapshot(id),
    seriesProduct ? getSeriesHistory(seriesProduct.productNo) : Promise.resolve([]),
  ]);

  return (
    <div>
      <div className="mb-6 flex items-start gap-4">
        {title.thumbnail_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={title.thumbnail_url} alt="" className="w-28 shrink-0 rounded-lg" />
        )}
        <div>
          <h1 className="text-xl font-semibold">{title.title_name}</h1>
          <p className="text-sm text-neutral-500">{title.author}</p>
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
          {title.studio_name && (
            <p className="mt-1 text-sm text-neutral-500">
              제작사:{" "}
              {title.studio_website_url ? (
                <a
                  href={title.studio_website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  {title.studio_name}
                </a>
              ) : (
                title.studio_name
              )}
            </p>
          )}
          {snapshot && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {snapshot.star_score !== null && (
                <span className="rounded bg-amber-100 px-2 py-1 text-amber-800">
                  ★ {snapshot.star_score.toFixed(2)}
                </span>
              )}
              {snapshot.weekday && snapshot.popularity_rank && (
                <span className="rounded bg-blue-100 px-2 py-1 text-blue-800">
                  {WEEKDAY_KO[snapshot.weekday] ?? snapshot.weekday}요일 인기 {snapshot.popularity_rank}위
                </span>
              )}
              {snapshot.weekday && snapshot.rating_rank && (
                <span className="rounded bg-purple-100 px-2 py-1 text-purple-800">
                  별점 {snapshot.rating_rank}위
                </span>
              )}
              {snapshot.weekday && snapshot.view_rank && (
                <span className="rounded bg-teal-100 px-2 py-1 text-teal-800">
                  조회 {snapshot.view_rank}위
                </span>
              )}
            </div>
          )}
          {title.synopsis && (
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-neutral-700">
              {title.synopsis}
            </p>
          )}
        </div>
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
    </div>
  );
}
