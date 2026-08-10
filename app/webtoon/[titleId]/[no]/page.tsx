import Link from "next/link";
import { notFound } from "next/navigation";
import { getTitle, getEpisode, getEpisodeHistory } from "@/lib/queries";
import CommentTrendChart from "./CommentTrendChart";

export const dynamic = "force-dynamic";

export default async function EpisodePage({
  params,
}: {
  params: Promise<{ titleId: string; no: string }>;
}) {
  const { titleId, no } = await params;
  const id = Number(titleId);
  const episodeNo = Number(no);
  if (!Number.isInteger(id) || !Number.isInteger(episodeNo)) notFound();

  const [title, episode, history] = await Promise.all([
    getTitle(id),
    getEpisode(id, episodeNo),
    getEpisodeHistory(id, episodeNo),
  ]);
  if (!title || !episode) notFound();

  const latest = history.at(-1);

  return (
    <div>
      <Link href={`/webtoon/${id}`} className="text-sm text-neutral-500 hover:underline">
        ← {title.title_name}
      </Link>
      <h1 className="mt-2 mb-1 text-xl font-semibold">
        {episode.subtitle ?? `${episode.no}화`}
      </h1>
      <p className="mb-4 text-sm text-neutral-500">
        {episode.service_date} 등록
        {latest && (
          <span className="ml-3 font-medium text-neutral-800">
            현재 댓글 {latest.comment_count.toLocaleString()}개
          </span>
        )}
      </p>

      <CommentTrendChart data={history} />
    </div>
  );
}
