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
import { aggregateByCalendarWeek, toDeltaSeries } from "@/lib/seriesTrend";
import { COMPARISON_COLORS } from "@/lib/chartColors";
import { NovelOriginBadge, NaverStatStack } from "@/app/PerfBadges";
import NicknameSwitcher from "@/app/NicknameSwitcher";
import WatchlistRemoveButton from "@/app/WatchlistRemoveButton";
import {
  CommentComparisonChart,
  DownloadComparisonChart,
  GrowthRateComparisonChart,
  RevenueComparisonChart,
} from "@/app/WatchlistComparisonCharts";

const PRICE_PER_DOWNLOAD = 300;

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

  // 댓글수/다운로드수/매출액 세 차트가 각자 필터링한 목록의 인덱스가 아니라 이 고정 색을 써서,
  // 같은 작품은 어느 차트에서든 항상 같은 색으로 보이게 한다.
  const colorOf = (id: number) => COMPARISON_COLORS[titleIds.indexOf(id) % COMPARISON_COLORS.length];

  const commentSeries = titleIds.map((id, i) => ({
    titleId: id,
    titleName: titleBasics.get(id)?.title_name ?? `#${id}`,
    color: colorOf(id),
    points: commentHistories[i].map((p) => ({ snapshot_date: p.snapshot_date, value: p.total_comment_count })),
  }));
  const downloadSeries = titleIds.map((id, i) => ({
    titleId: id,
    titleName: titleBasics.get(id)?.title_name ?? `#${id}`,
    color: colorOf(id),
    points: downloadHistories[i].map((p) => ({ snapshot_date: p.snapshot_date, value: p.download_count })),
  }));
  const revenueSeries = titleIds.map((id, i) => {
    const weekly = aggregateByCalendarWeek(downloadHistories[i]);
    return {
      titleId: id,
      titleName: titleBasics.get(id)?.title_name ?? `#${id}`,
      color: colorOf(id),
      points: toDeltaSeries(weekly).map((p) => ({ snapshot_date: p.snapshot_date, value: p.delta * PRICE_PER_DOWNLOAD })),
    };
  });

  return (
    <div>
      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
        {titleIds.map((id) => {
          const basic = titleBasics.get(id);
          const perf = perfMap.get(id);
          return (
            <li key={id} className="flex items-center gap-2 pr-3 hover:bg-neutral-50">
              <Link href={`/webtoon/${id}`} className="flex min-w-0 flex-1 items-center gap-3 p-3">
                {basic?.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={basic.thumbnail_url}
                    alt=""
                    width={56}
                    height={72}
                    className="h-auto w-14 shrink-0 rounded"
                  />
                )}
                <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1 text-sm font-medium">
                    <span className="truncate">{basic?.title_name ?? `#${id}`}</span>
                    {basic?.is_novel_origin && <NovelOriginBadge />}
                  </span>
                  <NaverStatStack
                    starScore={perf?.star_score ?? null}
                    launchDate={perf?.launch_date ?? null}
                    weekday={perf?.weekday ?? null}
                    popularityRank={perf?.popularity_rank ?? null}
                    downloadCount={perf?.download_count ?? null}
                    totalCommentCount={perf?.total_comment_count ?? null}
                  />
                </span>
              </Link>
              <WatchlistRemoveButton userName={userName} titleId={id} />
            </li>
          );
        })}
      </ul>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-500">댓글수 비교</h2>
        <CommentComparisonChart series={commentSeries} />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-500">
          다운로드수 증감률 비교{" "}
          <span className="text-xs font-normal text-neutral-400">(작품마다 규모 차이가 커서 시작 시점 대비 변화율로 비교)</span>
        </h2>
        <GrowthRateComparisonChart series={downloadSeries} />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-500">다운로드수 비교</h2>
        <DownloadComparisonChart series={downloadSeries} />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-500">
          매출액 비교 <span className="text-xs font-normal text-neutral-400">(주간 다운로드 변동수 × 300원 추정치)</span>
        </h2>
        <RevenueComparisonChart series={revenueSeries} />
      </section>
    </div>
  );
}
