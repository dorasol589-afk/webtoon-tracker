import Link from "next/link";
import {
  listTitles,
  type TitleSortBy,
  type TitleStatusFilter,
  type TitleTypeFilter,
} from "@/lib/queries";
import FilterControls from "./FilterControls";

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

const TYPE_VALUES: TitleTypeFilter[] = ["all", "weekday", "daily_plus"];
const STATUS_VALUES: TitleStatusFilter[] = ["all", "ongoing", "new", "finished", "hiatus"];
const SORT_VALUES: TitleSortBy[] = ["name", "popularity", "star", "launch", "comments"];

const PAGE_SIZE = 50;

function isType(value: string): value is TitleTypeFilter {
  return (TYPE_VALUES as string[]).includes(value);
}

function isStatus(value: string): value is TitleStatusFilter {
  return (STATUS_VALUES as string[]).includes(value);
}

function isSort(value: string): value is TitleSortBy {
  return (SORT_VALUES as string[]).includes(value);
}

function isDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function buildHref(params: {
  type: TitleTypeFilter;
  status: TitleStatusFilter;
  sort: TitleSortBy;
  page: number;
  adultOnly: boolean;
  launchFrom: string;
  launchTo: string;
}) {
  const sp = new URLSearchParams();
  if (params.type !== "all") sp.set("type", params.type);
  if (params.status !== "all") sp.set("status", params.status);
  if (params.sort !== "name") sp.set("sort", params.sort);
  if (params.adultOnly) sp.set("adult", "true");
  if (params.launchFrom) sp.set("launchFrom", params.launchFrom);
  if (params.launchTo) sp.set("launchTo", params.launchTo);
  if (params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return `/titles${qs ? `?${qs}` : ""}`;
}

export default async function TitlesPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    status?: string;
    sort?: string;
    page?: string;
    adult?: string;
    launchFrom?: string;
    launchTo?: string;
  }>;
}) {
  const { type, status, sort, page, adult, launchFrom, launchTo } = await searchParams;
  const selectedType: TitleTypeFilter = type && isType(type) ? type : "all";
  const selectedStatus: TitleStatusFilter = status && isStatus(status) ? status : "all";
  const selectedSort: TitleSortBy = sort && isSort(sort) ? sort : "name";
  const adultOnly = adult === "true";
  const selectedLaunchFrom = launchFrom && isDateString(launchFrom) ? launchFrom : "";
  const selectedLaunchTo = launchTo && isDateString(launchTo) ? launchTo : "";
  const pageNum = Math.max(1, Number(page) || 1);

  let rows: Awaited<ReturnType<typeof listTitles>>["rows"] = [];
  let totalCount = 0;
  let loadError = false;
  try {
    const result = await listTitles({
      type: selectedType,
      status: selectedStatus,
      sortBy: selectedSort,
      page: pageNum,
      pageSize: PAGE_SIZE,
      adultOnly,
      launchFrom: selectedLaunchFrom || undefined,
      launchTo: selectedLaunchTo || undefined,
    });
    rows = result.rows;
    totalCount = result.totalCount;
  } catch {
    loadError = true;
  }
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const exportQuery = new URLSearchParams();
  if (selectedType !== "all") exportQuery.set("type", selectedType);
  if (selectedStatus !== "all") exportQuery.set("status", selectedStatus);
  if (selectedSort !== "name") exportQuery.set("sort", selectedSort);
  if (adultOnly) exportQuery.set("adult", "true");
  if (selectedLaunchFrom) exportQuery.set("launchFrom", selectedLaunchFrom);
  if (selectedLaunchTo) exportQuery.set("launchTo", selectedLaunchTo);
  const exportHref = `/api/export/all${exportQuery.toString() ? `?${exportQuery.toString()}` : ""}`;

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">
        전체 작품 리스트 {!loadError && <span className="text-neutral-400">({totalCount.toLocaleString()}개)</span>}
      </h1>

      {loadError && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          Supabase 연결 설정이 필요합니다.
        </div>
      )}

      <FilterControls
        type={selectedType}
        status={selectedStatus}
        sort={selectedSort}
        adultOnly={adultOnly}
        launchFrom={selectedLaunchFrom}
        launchTo={selectedLaunchTo}
      />

      <div className="mb-4">
        <a
          href={exportHref}
          className="inline-block rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          엑셀 다운로드
        </a>
      </div>

      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
        {!loadError && rows.length === 0 && (
          <li className="p-4 text-sm text-neutral-500">조건에 맞는 작품이 없습니다.</li>
        )}
        {rows.map((t) => (
          <li key={t.title_id}>
            <Link
              href={`/webtoon/${t.title_id}`}
              className="flex items-center gap-3 p-3 hover:bg-neutral-50"
            >
              {t.thumbnail_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={t.thumbnail_url}
                  alt=""
                  width={56}
                  height={72}
                  className="h-auto w-14 shrink-0 rounded"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate font-medium">
                  <span className="truncate">{t.title_name}</span>
                  {t.is_new && (
                    <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">
                      신작
                    </span>
                  )}
                  {t.is_adult && (
                    <span className="shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-700">
                      성인
                    </span>
                  )}
                  {t.is_finished && (
                    <span className="shrink-0 rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] text-white">
                      완결
                    </span>
                  )}
                  {t.is_on_hiatus && (
                    <span className="shrink-0 rounded bg-orange-200 px-1.5 py-0.5 text-[10px] text-orange-800">
                      휴재
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-neutral-500">
                  {t.author}
                  {t.studio_name ? ` · ${t.studio_name}` : ""}
                </div>
              </div>
              <div className="shrink-0 text-right text-xs text-neutral-500">
                {t.star_score !== null && <div>★ {t.star_score.toFixed(2)}</div>}
                {t.weekday && t.popularity_rank !== null && (
                  <div>
                    {WEEKDAY_KO[t.weekday] ?? t.weekday}
                    {t.weekday === "DAILY_PLUS" ? "" : "요일"} {t.popularity_rank}위
                  </div>
                )}
                {t.total_comment_count !== null && <div>댓글 {t.total_comment_count.toLocaleString()}개</div>}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {totalCount > 0 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <Link
            href={buildHref({
              type: selectedType,
              status: selectedStatus,
              sort: selectedSort,
              adultOnly,
              launchFrom: selectedLaunchFrom,
              launchTo: selectedLaunchTo,
              page: Math.max(1, pageNum - 1),
            })}
            className={
              pageNum <= 1
                ? "pointer-events-none text-neutral-300"
                : "text-blue-600 hover:underline"
            }
          >
            이전
          </Link>
          <span className="text-neutral-500">
            {pageNum} / {totalPages}
          </span>
          <Link
            href={buildHref({
              type: selectedType,
              status: selectedStatus,
              sort: selectedSort,
              adultOnly,
              launchFrom: selectedLaunchFrom,
              launchTo: selectedLaunchTo,
              page: Math.min(totalPages, pageNum + 1),
            })}
            className={
              pageNum >= totalPages
                ? "pointer-events-none text-neutral-300"
                : "text-blue-600 hover:underline"
            }
          >
            다음
          </Link>
        </div>
      )}
    </div>
  );
}
