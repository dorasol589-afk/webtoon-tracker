import Link from "next/link";
import {
  unifiedSearch,
  getWeekdayPopularityRanking,
  getRealtimeRankingLive,
  getTagStats,
  getTitlesLaunchedThisWeek,
  getTitlesNeedingStudioFix,
  getTopTitlesByDownload,
  type UnifiedSearchResult,
  type PopularityRankRow,
  type Weekday,
  type RealtimeRankRow,
  type RealtimeRankCategory,
  type TagStatRow,
  type TitleListRow,
  type StudioFixRow,
  type DownloadRankRow,
} from "@/lib/queries";
import TagStatsChart from "@/app/TagStatsChart";
import StudioNameEditor from "@/app/StudioNameEditor";
import { NovelOriginBadge, NaverPerfLine, KakaoPerfLine, NaverStatStack, KakaoStatStack } from "@/app/PerfBadges";
import { hasAdminAccess } from "@/lib/supabase";

const GENDER_TABS: { value: RealtimeRankCategory; label: string }[] = [
  { value: "TOTAL", label: "전체" },
  { value: "MALE", label: "남성" },
  { value: "FEMALE", label: "여성" },
];

function isGenderCategory(value: string): value is RealtimeRankCategory {
  return GENDER_TABS.some((g) => g.value === value);
}

export const dynamic = "force-dynamic";

const WEEKDAYS: { value: Weekday; label: string }[] = [
  { value: "MONDAY", label: "월" },
  { value: "TUESDAY", label: "화" },
  { value: "WEDNESDAY", label: "수" },
  { value: "THURSDAY", label: "목" },
  { value: "FRIDAY", label: "금" },
  { value: "SATURDAY", label: "토" },
  { value: "SUNDAY", label: "일" },
  { value: "DAILY_PLUS", label: "매일+" },
];

function getTodayWeekdayKST(): Weekday {
  const now = new Date();
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const map: Weekday[] = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ];
  return map[kst.getDay()];
}

function isWeekday(value: string): value is Weekday {
  return WEEKDAYS.some((w) => w.value === value);
}

type LoadResult =
  | { type: "error" }
  | { type: "search"; results: UnifiedSearchResult[] }
  | {
      type: "rankings";
      realtimeRanking: RealtimeRankRow[];
      selectedGender: RealtimeRankCategory;
      weekdayRanking: PopularityRankRow[];
      selectedWeekday: Weekday;
      newReleaseRanking: RealtimeRankRow[];
      genreStats: TagStatRow[];
      keywordStats: TagStatRow[];
      thisWeekLaunches: TitleListRow[];
      studioFixNeeded: StudioFixRow[];
      downloadRanking: DownloadRankRow[];
    };

async function loadData(
  q: string | undefined,
  weekdayParam: string | undefined,
  genderParam: string | undefined
): Promise<LoadResult> {
  try {
    if (q) {
      return { type: "search", results: await unifiedSearch(q) };
    }
    const selectedWeekday = weekdayParam && isWeekday(weekdayParam) ? weekdayParam : getTodayWeekdayKST();
    const selectedGender = genderParam && isGenderCategory(genderParam) ? genderParam : "TOTAL";
    const [
      realtimeRanking,
      weekdayRanking,
      newReleaseRanking,
      genreStats,
      keywordStats,
      thisWeekLaunches,
      studioFixNeeded,
      downloadRanking,
    ] = await Promise.all([
      getRealtimeRankingLive(selectedGender),
      getWeekdayPopularityRanking(selectedWeekday, 5),
      getRealtimeRankingLive("TOTAL", "NEW"),
      getTagStats("GENRE", 15),
      getTagStats("KEYWORD", 15),
      getTitlesLaunchedThisWeek(),
      getTitlesNeedingStudioFix(),
      getTopTitlesByDownload(10),
    ]);
    return {
      type: "rankings",
      realtimeRanking,
      selectedGender,
      weekdayRanking,
      selectedWeekday,
      newReleaseRanking,
      genreStats,
      keywordStats,
      thisWeekLaunches,
      studioFixNeeded,
      downloadRanking,
    };
  } catch {
    return { type: "error" };
  }
}

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; weekday?: string; gender?: string }>;
}) {
  const { q, weekday, gender } = await searchParams;
  const result = await loadData(q, weekday, gender);
  const readOnly = !hasAdminAccess();

  return (
    <div>
      <form className="mb-6" action="/rankings">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="작품명으로 검색... (카카오웹툰 결과도 함께 나와요)"
          className="w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm focus:border-neutral-500 focus:outline-none"
        />
      </form>

      {result.type === "error" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          Supabase 연결 설정이 필요합니다. <code>.env.local</code>에 <code>NEXT_PUBLIC_SUPABASE_URL</code>과{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>를 설정해주세요.
        </div>
      )}

      {result.type === "search" && (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
          {result.results.length === 0 && (
            <li className="p-4 text-sm text-neutral-500">&quot;{q}&quot;에 대한 검색 결과가 없습니다.</li>
          )}
          {result.results.map((r) => (
            <li key={`${r.platform}-${r.id}`}>
              <Link
                href={r.platform === "kakao" ? `/kakao/webtoon/${r.id}` : `/webtoon/${r.id}`}
                className="flex items-center gap-3 p-3 hover:bg-neutral-50"
              >
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
                <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                  <div className="min-w-0">
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
                        <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-700">
                          성인
                        </span>
                      )}
                      {r.isNovelOrigin && <NovelOriginBadge />}
                    </div>
                    <div className="text-sm text-neutral-500">{r.author}</div>
                  </div>
                  {r.platform === "kakao" ? (
                    <KakaoStatStack viewCount={r.viewCount} launchDate={r.launchDate} />
                  ) : (
                    <NaverStatStack
                      starScore={r.starScore}
                      launchDate={r.launchDate}
                      weekday={r.weekday}
                      popularityRank={r.popularityRank}
                      downloadCount={r.downloadCount}
                      totalCommentCount={r.totalCommentCount}
                    />
                  )}
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
                  <div key={t.title_id} className="rounded-lg border border-neutral-200 bg-white p-2">
                    <Link href={`/webtoon/${t.title_id}`}>
                      {t.thumbnail_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.thumbnail_url}
                          alt=""
                          width={112}
                          height={145}
                          loading="lazy"
                          className="mb-2 h-auto w-full rounded"
                        />
                      )}
                      <div className="flex items-center gap-1">
                        <div className="truncate text-sm font-medium hover:underline">{t.title_name}</div>
                        {t.is_novel_origin && <NovelOriginBadge />}
                      </div>
                      <NaverPerfLine
                        launchDate={t.launch_date}
                        weekday={t.weekday}
                        popularityRank={t.popularity_rank}
                        downloadCount={t.download_count}
                        totalCommentCount={t.total_comment_count}
                      />
                    </Link>
                    <StudioNameEditor titleId={t.title_id} studioName={t.studio_name} readOnly={readOnly} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {result.studioFixNeeded.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 flex items-baseline gap-2 text-sm font-semibold text-neutral-500">
                제작사 수정 필요
                <span className="text-xs text-neutral-400">{result.studioFixNeeded.length}개</span>
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {result.studioFixNeeded.map((t) => (
                  <div key={t.title_id} className="rounded-lg border border-neutral-200 bg-white p-2">
                    <Link href={`/webtoon/${t.title_id}`}>
                      {t.thumbnail_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.thumbnail_url}
                          alt=""
                          width={112}
                          height={145}
                          loading="lazy"
                          className="mb-2 h-auto w-full rounded"
                        />
                      )}
                      <div className="flex items-center gap-1">
                        <div className="truncate text-sm font-medium hover:underline">{t.title_name}</div>
                        {t.is_novel_origin && <NovelOriginBadge />}
                      </div>
                      <NaverPerfLine
                        launchDate={t.launch_date}
                        weekday={t.weekday}
                        popularityRank={t.popularity_rank}
                        downloadCount={t.download_count}
                        totalCommentCount={t.total_comment_count}
                      />
                    </Link>
                    <StudioNameEditor titleId={t.title_id} studioName={t.studio_name} readOnly={readOnly} />
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-start">
            <div>
              <div className="mb-3">
                <h2 className="mb-2 text-sm font-semibold text-neutral-500">실시간 전체 랭킹 TOP5</h2>
                <div className="flex flex-wrap gap-1">
                  {GENDER_TABS.map((g) => (
                    <Link
                      key={g.value}
                      href={`/rankings?gender=${g.value}&weekday=${result.selectedWeekday}`}
                      className={`rounded px-2 py-1 text-xs ${
                        g.value === result.selectedGender
                          ? "bg-neutral-800 text-white"
                          : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                      }`}
                    >
                      {g.label}
                    </Link>
                  ))}
                </div>
              </div>
              <ol className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
                {result.realtimeRanking.length === 0 && (
                  <li className="p-4 text-sm text-neutral-500">데이터 없음</li>
                )}
                {result.realtimeRanking.map((r) => (
                  <li key={r.title_id}>
                    <Link
                      href={`/webtoon/${r.title_id}`}
                      className="flex items-center gap-3 p-2.5 hover:bg-neutral-50"
                    >
                      <span className="w-5 shrink-0 text-center text-xs text-neutral-400">{r.rank}</span>
                      {r.thumbnail_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.thumbnail_url}
                          alt=""
                          width={48}
                          height={62}
                          className="h-auto w-12 shrink-0 rounded"
                        />
                      )}
                      <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1 text-sm font-medium">
                          <span className="truncate">{r.title_name}</span>
                          {r.is_novel_origin && <NovelOriginBadge />}
                        </span>
                        <NaverStatStack
                          starScore={r.star_score}
                          launchDate={r.launch_date}
                          weekday={r.weekday}
                          popularityRank={r.popularity_rank}
                          downloadCount={r.download_count}
                          totalCommentCount={r.total_comment_count}
                        />
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </div>

            <div>
              <div className="mb-3">
                <h2 className="mb-2 text-sm font-semibold text-neutral-500">요일별 인기순위 TOP5</h2>
                <div className="flex flex-wrap gap-1">
                  {WEEKDAYS.map((w) => (
                    <Link
                      key={w.value}
                      href={`/rankings?weekday=${w.value}&gender=${result.selectedGender}`}
                      className={`rounded px-2 py-1 text-xs ${
                        w.value === result.selectedWeekday
                          ? "bg-neutral-800 text-white"
                          : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                      }`}
                    >
                      {w.label}
                    </Link>
                  ))}
                </div>
              </div>
              <ol className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
                {result.weekdayRanking.length === 0 && (
                  <li className="p-4 text-sm text-neutral-500">데이터 없음</li>
                )}
                {result.weekdayRanking.map((r) => (
                  <li key={r.title_id}>
                    <Link
                      href={`/webtoon/${r.title_id}`}
                      className="flex items-center gap-3 p-2.5 hover:bg-neutral-50"
                    >
                      <span className="w-5 shrink-0 text-center text-xs text-neutral-400">
                        {r.popularity_rank}
                      </span>
                      {r.thumbnail_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.thumbnail_url}
                          alt=""
                          width={48}
                          height={62}
                          className="h-auto w-12 shrink-0 rounded"
                        />
                      )}
                      <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1 text-sm font-medium">
                          <span className="truncate">{r.title_name}</span>
                          {r.is_novel_origin && <NovelOriginBadge />}
                        </span>
                        <NaverStatStack
                          starScore={r.star_score}
                          launchDate={r.launch_date}
                          weekday={result.selectedWeekday}
                          popularityRank={r.popularity_rank}
                          downloadCount={r.download_count}
                          totalCommentCount={r.total_comment_count}
                        />
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </div>

            <div>
              <h2 className="mb-3 text-sm font-semibold text-neutral-500">실시간 신작랭킹 TOP5</h2>
              <ol className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
                {result.newReleaseRanking.length === 0 && (
                  <li className="p-4 text-sm text-neutral-500">데이터 없음</li>
                )}
                {result.newReleaseRanking.map((r) => (
                  <li key={r.title_id}>
                    <Link
                      href={`/webtoon/${r.title_id}`}
                      className="flex items-center gap-3 p-2.5 hover:bg-neutral-50"
                    >
                      <span className="w-5 shrink-0 text-center text-xs text-neutral-400">{r.rank}</span>
                      {r.thumbnail_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.thumbnail_url}
                          alt=""
                          width={48}
                          height={62}
                          className="h-auto w-12 shrink-0 rounded"
                        />
                      )}
                      <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1 text-sm font-medium">
                          <span className="truncate">{r.title_name}</span>
                          {r.is_novel_origin && <NovelOriginBadge />}
                        </span>
                        <NaverStatStack
                          starScore={r.star_score}
                          launchDate={r.launch_date}
                          weekday={r.weekday}
                          popularityRank={r.popularity_rank}
                          downloadCount={r.download_count}
                          totalCommentCount={r.total_comment_count}
                        />
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold text-neutral-500">다운로드 수 랭킹 TOP10</h2>
            <ol className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
              {result.downloadRanking.length === 0 && (
                <li className="p-4 text-sm text-neutral-500">데이터 없음</li>
              )}
              {result.downloadRanking.map((t, i) => (
                <li key={t.title_id} className="flex items-center gap-3 p-2.5">
                  <span className="w-5 shrink-0 text-center text-xs text-neutral-400">{i + 1}</span>
                  <Link href={`/webtoon/${t.title_id}`} className="flex flex-1 items-center gap-3 min-w-0">
                    {t.thumbnail_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.thumbnail_url}
                        alt=""
                        width={48}
                        height={62}
                        className="h-auto w-12 shrink-0 rounded"
                      />
                    )}
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="flex items-center gap-1">
                          <span className="block truncate text-sm font-medium hover:underline">
                            {t.title_name}
                          </span>
                          {t.is_novel_origin && <NovelOriginBadge />}
                        </span>
                        {t.studio_name && (
                          <span className="block truncate text-xs text-neutral-500">{t.studio_name}</span>
                        )}
                      </span>
                      <NaverStatStack
                        starScore={t.star_score}
                        launchDate={t.launch_date}
                        weekday={t.weekday}
                        popularityRank={null}
                        downloadCount={t.download_count}
                        totalCommentCount={t.total_comment_count}
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>

          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section>
              <h2 className="mb-3 text-sm font-semibold text-neutral-500">
                장르별 통계 (연재중 작품 수 기준)
              </h2>
              <TagStatsChart data={result.genreStats} color="#2563eb" />
            </section>
            <section>
              <h2 className="mb-3 text-sm font-semibold text-neutral-500">
                키워드별 통계 (연재중 작품 수 기준)
              </h2>
              <TagStatsChart data={result.keywordStats} color="#059669" />
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
