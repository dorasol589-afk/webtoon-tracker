import { notFound } from "next/navigation";
import { getKakaoTitle, getKakaoEpisodes, getKakaoStatHistory } from "@/lib/queries";
import KakaoStatChart from "./KakaoStatChart";

export const dynamic = "force-dynamic";

const USE_TYPE_KO: Record<string, string> = {
  FREE: "무료",
  WAIT_FOR_FREE: "기다리면 무료",
  EARLY_ACCESS: "선공개",
};

export default async function KakaoTitlePage({
  params,
}: {
  params: Promise<{ contentId: string }>;
}) {
  const { contentId } = await params;
  const id = Number(contentId);
  if (!Number.isInteger(id)) notFound();

  const title = await getKakaoTitle(id);
  if (!title) notFound();

  const [episodes, statHistory] = await Promise.all([getKakaoEpisodes(id), getKakaoStatHistory(id)]);
  const latestStat = statHistory.at(-1);

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
          <h1 className="text-xl font-semibold">
            <a
              href={`https://webtoon.kakao.com/content/${encodeURIComponent(title.seo_id)}/${id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {title.title_name}
            </a>
          </h1>
          <p className="text-sm text-neutral-500">
            {[title.writer, title.painter].filter((v, i, arr) => v && arr.indexOf(v) === i).join(" / ")}
          </p>
          {title.studio_name && <p className="text-xs text-neutral-400">{title.studio_name}</p>}
          {title.is_adult && (
            <span className="mt-1 mr-1 inline-block rounded bg-rose-100 px-2 py-0.5 text-xs text-rose-700">
              성인
            </span>
          )}
          {title.is_finished && (
            <span className="mt-1 mr-1 inline-block rounded bg-neutral-700 px-2 py-0.5 text-xs text-white">
              완결
            </span>
          )}
          {title.is_on_hiatus && (
            <span className="mt-1 inline-block rounded bg-orange-200 px-2 py-0.5 text-xs text-orange-800">
              휴재중
            </span>
          )}
          {title.genres.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {title.genres.map((g) => (
                <span key={g} className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
                  {g}
                </span>
              ))}
            </div>
          )}
          {latestStat && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {latestStat.view_count !== null && (
                <span className="rounded bg-neutral-100 px-2 py-1 text-neutral-700">
                  조회수 {latestStat.view_count.toLocaleString()}
                </span>
              )}
              {latestStat.like_count !== null && (
                <span className="rounded bg-neutral-100 px-2 py-1 text-neutral-700">
                  좋아요 {latestStat.like_count.toLocaleString()}
                </span>
              )}
            </div>
          )}
          {title.synopsis && (
            <details className="group mt-3 text-sm leading-relaxed text-neutral-700">
              <summary className="list-none cursor-pointer marker:hidden [&::-webkit-details-marker]:hidden">
                <p className="line-clamp-3 whitespace-pre-line group-open:line-clamp-none">{title.synopsis}</p>
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
        <h2 className="mb-2 text-sm font-semibold text-neutral-500">조회수/좋아요수 추이</h2>
        <KakaoStatChart data={statHistory} />
      </div>

      <h2 className="mb-2 text-sm font-semibold text-neutral-500">
        회차 목록 <span className="text-neutral-400">({episodes.length}개)</span>
      </h2>
      <table className="w-full border-collapse overflow-hidden rounded-lg border border-neutral-200 bg-white text-sm">
        <thead className="bg-neutral-100 text-left text-neutral-500">
          <tr>
            <th className="px-3 py-2">회차</th>
            <th className="px-3 py-2">등록일</th>
            <th className="px-3 py-2">구분</th>
          </tr>
        </thead>
        <tbody>
          {episodes.map((e) => (
            <tr key={e.no} className="border-t border-neutral-100">
              <td className="px-3 py-2">{e.title ?? `${e.no}화`}</td>
              <td className="px-3 py-2 text-neutral-500">{e.service_date ?? "-"}</td>
              <td className="px-3 py-2">
                {e.use_type === "FREE" ? (
                  <span className="text-emerald-600">무료</span>
                ) : (
                  <span className="text-neutral-400">{USE_TYPE_KO[e.use_type] ?? e.use_type}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
