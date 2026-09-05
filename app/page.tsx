import Link from "next/link";
import { cookies } from "next/headers";
import {
  getWatchlist,
  getTitlesBasic,
  getNaverTitlesPerf,
  getTitleCommentHistory,
  getDownloadHistoryByTitleId,
} from "@/lib/queries";
import { WATCHLIST_USER_COOKIE } from "@/lib/watchlistCookie";
import { NovelOriginBadge, NaverStatStack } from "@/app/PerfBadges";
import NicknameSwitcher from "@/app/NicknameSwitcher";
import WatchlistRemoveButton from "@/app/WatchlistRemoveButton";
import { CommentComparisonChart, DownloadComparisonChart } from "@/app/WatchlistComparisonCharts";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const store = await cookies();
  const userName = store.get(WATCHLIST_USER_COOKIE)?.value ?? null;

  return (
    <div>
      <section className="mb-6">
        <h1 className="text-lg font-semibold">관심작품 비교</h1>
        <p className="mt-1 text-sm text-neutral-500">
          닉네임을 입력하면 그 이름으로 저장된 관심작품 목록을 볼 수 있어요. 같은 닉네임을 쓰면 다른 기기에서도
          동일한 목록이 보입니다. (댓글수/다운로드수 비교는 네이버 작품만 가능해요)
        </p>
        <div className="mt-3">
          <NicknameSwitcher currentUser={userName} />
        </div>
      </section>

      {!userName && (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          닉네임을 입력하면 관심작품 목록이 여기에 나타나요. 각 작품 상세 페이지에서 &quot;관심작품 추가&quot;
          버튼으로 등록할 수 있습니다.
        </div>
      )}

      {userName && <WatchlistBody userName={userName} />}
    </div>
  );
}

async function WatchlistBody({ userName }: { userName: string }) {
  const entries = await getWatchlist(userName);

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        아직 관심작품이 없어요. 작품 상세 페이지에서 &quot;관심작품 추가&quot; 버튼을 눌러보세요.
      </div>
    );
  }

  const titleIds = entries.map((e) => e.titleId);
  const [titleBasics, perfMap, commentHistories, downloadHistories] = await Promise.all([
    getTitlesBasic(titleIds),
    getNaverTitlesPerf(titleIds),
    Promise.all(titleIds.map((id) => getTitleCommentHistory(id))),
    Promise.all(titleIds.map((id) => getDownloadHistoryByTitleId(id))),
  ]);

  const commentSeries = titleIds.map((id, i) => ({
    titleId: id,
    titleName: titleBasics.get(id)?.title_name ?? `#${id}`,
    points: commentHistories[i].map((p) => ({ snapshot_date: p.snapshot_date, value: p.total_comment_count })),
  }));
  const downloadSeries = titleIds.map((id, i) => ({
    titleId: id,
    titleName: titleBasics.get(id)?.title_name ?? `#${id}`,
    points: downloadHistories[i].map((p) => ({ snapshot_date: p.snapshot_date, value: p.download_count })),
  }));

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {titleIds.map((id) => {
          const basic = titleBasics.get(id);
          const perf = perfMap.get(id);
          return (
            <div key={id} className="rounded-lg border border-neutral-200 bg-white p-2">
              <Link href={`/webtoon/${id}`}>
                {basic?.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={basic.thumbnail_url}
                    alt=""
                    width={112}
                    height={145}
                    loading="lazy"
                    className="mb-2 h-auto w-full rounded"
                  />
                )}
                <div className="flex items-center gap-1">
                  <div className="truncate text-sm font-medium hover:underline">
                    {basic?.title_name ?? `#${id}`}
                  </div>
                  {basic?.is_novel_origin && <NovelOriginBadge />}
                </div>
              </Link>
              <NaverStatStack
                starScore={perf?.star_score ?? null}
                launchDate={perf?.launch_date ?? null}
                weekday={perf?.weekday ?? null}
                popularityRank={perf?.popularity_rank ?? null}
                downloadCount={perf?.download_count ?? null}
                totalCommentCount={perf?.total_comment_count ?? null}
              />
              <WatchlistRemoveButton userName={userName} titleId={id} />
            </div>
          );
        })}
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-500">댓글수 비교</h2>
        <CommentComparisonChart series={commentSeries} />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-500">다운로드수 비교</h2>
        <DownloadComparisonChart series={downloadSeries} />
      </section>
    </div>
  );
}
