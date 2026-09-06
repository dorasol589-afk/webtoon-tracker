import { cookies } from "next/headers";
import { getTitlesByStudio, getWatchlist } from "@/lib/queries";
import { WATCHLIST_USER_COOKIE } from "@/lib/watchlistCookie";
import StudioSearch from "./StudioSearch";

export const dynamic = "force-dynamic";

export default async function StudiosPage() {
  let groups: Awaited<ReturnType<typeof getTitlesByStudio>> = [];
  let loadError = false;
  try {
    groups = await getTitlesByStudio();
  } catch {
    loadError = true;
  }

  const cookieStore = await cookies();
  const watchlistUser = cookieStore.get(WATCHLIST_USER_COOKIE)?.value ?? null;
  const watchlistedTitleIds = watchlistUser ? (await getWatchlist(watchlistUser)).map((e) => e.titleId) : [];

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">제작사별 작품</h1>
      <p className="mb-4 text-sm text-neutral-400">
        {!loadError && `제작사 ${groups.length.toLocaleString()}곳`}
      </p>

      {!loadError && (
        <div className="mb-6">
          <a
            href="/api/export/studios"
            className="inline-block rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            엑셀 다운로드
          </a>
        </div>
      )}

      {loadError && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          Supabase 연결 설정이 필요합니다.
        </div>
      )}

      {!loadError && (
        <StudioSearch groups={groups} watchlistUser={watchlistUser} watchlistedTitleIds={watchlistedTitleIds} />
      )}
    </div>
  );
}
