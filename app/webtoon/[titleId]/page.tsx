import Link from "next/link";
import { notFound } from "next/navigation";
import { getTitle, getEpisodesWithLatestCount } from "@/lib/queries";

export const dynamic = "force-dynamic";

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

  const episodes = await getEpisodesWithLatestCount(id);

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        {title.thumbnail_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={title.thumbnail_url} alt="" className="h-20 w-20 rounded-lg object-cover" />
        )}
        <div>
          <h1 className="text-xl font-semibold">{title.title_name}</h1>
          <p className="text-sm text-neutral-500">{title.author}</p>
          {!title.is_active && (
            <span className="mt-1 inline-block rounded bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600">
              현재 연재목록에서 제외됨 (완결 또는 휴재 가능)
            </span>
          )}
        </div>
      </div>

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
