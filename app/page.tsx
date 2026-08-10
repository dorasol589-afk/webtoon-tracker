import Link from "next/link";
import { getTopMovers, searchTitles, type TitleRow, type TopMoverRow } from "@/lib/queries";

export const dynamic = "force-dynamic";

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
  | { type: "movers"; movers: TopMoverRow[] };

async function loadData(q: string | undefined): Promise<LoadResult> {
  try {
    if (q) {
      return { type: "search", titles: await searchTitles(q) };
    }
    return { type: "movers", movers: await getTopMovers(30) };
  } catch {
    return { type: "error" };
  }
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const result = await loadData(q);

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
        <>
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
        </>
      )}
    </div>
  );
}
