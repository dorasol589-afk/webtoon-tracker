import Link from "next/link";
import {
  getTopMovers,
  searchTitles,
  getSeriesWatchlistLatest,
  getWeekdayPopularityRanking,
  getNewReleasePopularityRanking,
  getRealtimeRanking,
  type TitleRow,
  type TopMoverRow,
  type SeriesWatchRow,
  type PopularityRankRow,
  type NewReleaseRankRow,
  type Weekday,
  type RealtimeRankRow,
  type RealtimeRankCategory,
} from "@/lib/queries";

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

function DeltaBadge({ delta }: { delta: number }) {
  if (delta <= 0) return null;
  return (
    <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
      +{delta.toLocaleString()}
    </span>
  );
}

type LoadResult =
  | { type: "error" }
  | { type: "search"; titles: TitleRow[] }
  | {
      type: "movers";
      movers: TopMoverRow[];
      realtimeRanking: RealtimeRankRow[];
      selectedGender: RealtimeRankCategory;
      weekdayRanking: PopularityRankRow[];
      selectedWeekday: Weekday;
      newReleaseRanking: NewReleaseRankRow[];
      seriesWatch: SeriesWatchRow[];
    };

async function loadData(
  q: string | undefined,
  weekdayParam: string | undefined,
  genderParam: string | undefined
): Promise<LoadResult> {
  try {
    if (q) {
      return { type: "search", titles: await searchTitles(q) };
    }
    const selectedWeekday = weekdayParam && isWeekday(weekdayParam) ? weekdayParam : getTodayWeekdayKST();
    const selectedGender = genderParam && isGenderCategory(genderParam) ? genderParam : "TOTAL";
    const [movers, realtimeRanking, weekdayRanking, newReleaseRanking, seriesWatch] = await Promise.all([
      getTopMovers(30),
      getRealtimeRanking(selectedGender),
      getWeekdayPopularityRanking(selectedWeekday, 15),
      getNewReleasePopularityRanking(90, 15),
      getSeriesWatchlistLatest(),
    ]);
    return {
      type: "movers",
      movers,
      realtimeRanking,
      selectedGender,
      weekdayRanking,
      selectedWeekday,
      newReleaseRanking,
      seriesWatch,
    };
  } catch {
    return { type: "error" };
  }
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; weekday?: string; gender?: string }>;
}) {
  const { q, weekday, gender } = await searchParams;
  const result = await loadData(q, weekday, gender);

  return (
    <div>
      <form className="mb-6" action="/">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="작품명으로 검색..."
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
          {result.titles.length === 0 && (
            <li className="p-4 text-sm text-neutral-500">&quot;{q}&quot;에 대한 검색 결과가 없습니다.</li>
          )}
          {result.titles.map((t) => (
            <li key={t.title_id}>
              <Link
                href={`/webtoon/${t.title_id}`}
                className="flex items-center gap-3 p-3 hover:bg-neutral-50"
              >
                {t.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.thumbnail_url} alt="" className="h-14 w-14 rounded object-cover" />
                )}
                <div>
                  <div className="font-medium">{t.title_name}</div>
                  <div className="text-sm text-neutral-500">{t.author}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {result.type === "movers" && (
        <div className="grid gap-8 md:grid-cols-[2fr_1fr]">
          <div>
            <h2 className="mb-3 text-sm font-semibold text-neutral-500">
              오늘 댓글수가 가장 많이 늘어난 회차
            </h2>
            <ol className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
              {result.movers.length === 0 && (
                <li className="p-4 text-sm text-neutral-500">
                  아직 수집된 데이터가 없습니다. 수집기가 최소 2회 이상 실행되면 순위가 표시됩니다.
                </li>
              )}
              {result.movers.map((m, i) => (
                <li key={`${m.title_id}-${m.no}`}>
                  <Link
                    href={`/webtoon/${m.title_id}/${m.no}`}
                    className="flex items-center gap-3 p-3 hover:bg-neutral-50"
                  >
                    <span className="w-6 shrink-0 text-center text-sm text-neutral-400">{i + 1}</span>
                    {m.thumbnail_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.thumbnail_url} alt="" className="h-14 w-14 rounded object-cover" />
                    )}
                    <div className="flex-1">
                      <div className="font-medium">
                        {m.title_name} <span className="text-neutral-400">· {m.subtitle}</span>
                      </div>
                      <div className="text-sm text-neutral-500">
                        댓글 {m.comment_count.toLocaleString()}개
                        <DeltaBadge delta={m.delta} />
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-500">
                실시간 전체 랭킹 TOP5
              </h2>
              <div className="flex gap-1">
                {GENDER_TABS.map((g) => (
                  <Link
                    key={g.value}
                    href={`/?gender=${g.value}&weekday=${result.selectedWeekday}`}
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      g.value === result.selectedGender
                        ? "bg-neutral-800 text-white"
                        : "text-neutral-500 hover:bg-neutral-100"
                    }`}
                  >
                    {g.label}
                  </Link>
                ))}
              </div>
            </div>
            <ol className="mb-8 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
              {result.realtimeRanking.length === 0 && (
                <li className="p-4 text-sm text-neutral-500">데이터 없음</li>
              )}
              {result.realtimeRanking.map((r) => (
                <li key={r.title_id}>
                  <Link
                    href={`/webtoon/${r.title_id}`}
                    className="flex items-center gap-2 p-2.5 hover:bg-neutral-50"
                  >
                    <span className="w-5 shrink-0 text-center text-xs text-neutral-400">{r.rank}</span>
                    <span className="flex-1 truncate text-sm font-medium">{r.title_name}</span>
                  </Link>
                </li>
              ))}
            </ol>

            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-500">요일별 인기순위</h2>
              <div className="flex gap-1">
                {WEEKDAYS.map((w) => (
                  <Link
                    key={w.value}
                    href={`/?weekday=${w.value}&gender=${result.selectedGender}`}
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      w.value === result.selectedWeekday
                        ? "bg-neutral-800 text-white"
                        : "text-neutral-500 hover:bg-neutral-100"
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
                    className="flex items-center gap-2 p-2.5 hover:bg-neutral-50"
                  >
                    <span className="w-5 shrink-0 text-center text-xs text-neutral-400">
                      {r.popularity_rank}
                    </span>
                    <span className="flex-1 truncate text-sm font-medium">{r.title_name}</span>
                  </Link>
                </li>
              ))}
            </ol>

            <h2 className="mb-3 mt-8 text-sm font-semibold text-neutral-500">
              신작 인기순위 (최근 90일 이내 1화)
            </h2>
            <ol className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
              {result.newReleaseRanking.length === 0 && (
                <li className="p-4 text-sm text-neutral-500">데이터 없음</li>
              )}
              {result.newReleaseRanking.map((r, i) => (
                <li key={r.title_id}>
                  <Link
                    href={`/webtoon/${r.title_id}`}
                    className="flex items-center gap-2 p-2.5 hover:bg-neutral-50"
                  >
                    <span className="w-5 shrink-0 text-center text-xs text-neutral-400">{i + 1}</span>
                    <span className="flex-1 truncate text-sm font-medium">{r.title_name}</span>
                    <span className="shrink-0 text-xs text-neutral-400">{r.launch_date}</span>
                  </Link>
                </li>
              ))}
            </ol>

            <h2 className="mb-3 mt-8 text-sm font-semibold text-neutral-500">
              네이버 시리즈 다운로드수 (우선 추적)
            </h2>
            <ol className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
              {result.seriesWatch.length === 0 && (
                <li className="p-4 text-sm text-neutral-500">데이터 없음</li>
              )}
              {result.seriesWatch.map((s) => (
                <li key={s.product_no}>
                  <Link
                    href={`/webtoon/${s.title_id}`}
                    className="flex items-center justify-between gap-2 p-2.5 hover:bg-neutral-50"
                  >
                    <span className="flex-1 truncate text-sm font-medium">{s.title_name}</span>
                    <span className="shrink-0 text-xs text-neutral-600">
                      {s.download_count.toLocaleString()}
                      <DeltaBadge delta={s.delta} />
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
