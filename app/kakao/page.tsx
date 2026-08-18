import Link from "next/link";
import {
  unifiedSearch,
  getKakaoTopTitles,
  getKakaoTitlesLaunchedThisWeek,
  type UnifiedSearchResult,
  type KakaoTopRow,
  type KakaoNewLaunchRow,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

function detailHref(r: { platform: string; id: number }): string {
  return r.platform === "kakao" ? `/kakao/webtoon/${r.id}` : `/webtoon/${r.id}`;
}

type LoadResult =
  | { type: "error" }
  | { type: "search"; results: UnifiedSearchResult[] }
  | {
      type: "rankings";
      viewRanking: KakaoTopRow[];
      likeRanking: KakaoTopRow[];
      thisWeekLaunches: KakaoNewLaunchRow[];
    };

async function loadData(q: string | undefined): Promise<LoadResult> {
  try {
    if (q) {
      return { type: "search", results: await unifiedSearch(q) };
    }
    const [viewRanking, likeRanking, thisWeekLaunches] = await Promise.all([
      getKakaoTopTitles("views", 10),
      getKakaoTopTitles("likes", 10),
      getKakaoTitlesLaunchedThisWeek(),
    ]);
    return { type: "rankings", viewRanking, likeRanking, thisWeekLaunches };
  } catch {
    return { type: "error" };
  }
}

function RankingList({ title, rows, metricKey }: { title: string; rows: KakaoTopRow[]; metricKey: "view_count" | "like_count" }) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-neutral-500">{title}</h2>
      <ol className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
        {rows.length === 0 && <li className="p-4 text-sm text-neutral-500">데이터 없음</li>}
        {rows.map((t, i) => {
          const metric = t[metricKey];
          return (
            <li key={t.content_id} className="flex items-center gap-3 p-2.5">
              <span className="w-5 shrink-0 text-center text-xs text-neutral-400">{i + 1}</span>
              <Link href={`/kakao/webtoon/${t.content_id}`} className="flex min-w-0 flex-1 items-center gap-3">
                {t.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.thumbnail_url} alt="" width={48} height={62} className="h-auto w-12 shrink-0 rounded" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium hover:underline">{t.title_name}</span>
                  {t.studio_name && <span className="block truncate text-xs text-neutral-500">{t.studio_name}</span>}
                </span>
              </Link>
              <span className="shrink-0 text-xs text-neutral-600">
                {metric !== null ? `${Math.round(metric / 10000).toLocaleString()}만` : "-"}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default async function KakaoHomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const result = await loadData(q);

  return (
    <div>
      <form className="mb-6" action="/kakao">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="작품명으로 검색... (네이버웹툰 결과도 함께 나와요)"
          className="w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:border-neutral-500 focus:outline-none"
        />
      </form>

      {result.type === "error" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          Supabase 연결 설정이 필요합니다.
        </div>
      )}

      {result.type === "search" && (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
          {result.results.length === 0 && (
            <li className="p-4 text-sm text-neutral-500">&quot;{q}&quot;에 대한 검색 결과가 없습니다.</li>
          )}
          {result.results.map((r) => (
            <li key={`${r.platform}-${r.id}`}>
              <Link href={detailHref(r)} className="flex items-center gap-3 p-3 hover:bg-neutral-50">
                {r.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.thumbnailUrl}
                    alt=""
                    width={56}
                    height={72}
                    className="h-auto w-14 shrink-0 rounded"
                  />
                )}
                <div>
                  <div className="flex items-center gap-1.5 font-medium">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        r.platform === "kakao" ? "bg-yellow-100 text-yellow-800" : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {r.platform === "kakao" ? "카카오" : "네이버"}
                    </span>
                    {r.titleName}
                    {r.isAdult && (
                      <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-700">성인</span>
                    )}
                  </div>
                  <div className="text-sm text-neutral-500">{r.author}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {result.type === "rankings" && (
        <div>
          {result.thisWeekLaunches.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 flex items-baseline gap-2 text-sm font-semibold text-neutral-500">
                이번주 신작
                <span className="text-xs text-neutral-400">{result.thisWeekLaunches.length}개</span>
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {result.thisWeekLaunches.map((t) => (
                  <Link
                    key={t.content_id}
                    href={`/kakao/webtoon/${t.content_id}`}
                    className="rounded-lg border border-neutral-200 bg-white p-2"
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
                    <div className="truncate text-sm font-medium hover:underline">{t.title_name}</div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <RankingList title="조회수 랭킹 TOP10" rows={result.viewRanking} metricKey="view_count" />
            <RankingList title="좋아요수 랭킹 TOP10" rows={result.likeRanking} metricKey="like_count" />
          </div>
        </div>
      )}
    </div>
  );
}
