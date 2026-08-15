import Link from "next/link";
import { notFound } from "next/navigation";
import { getTitle, getEpisode, getEpisodeHistory, getEpisodeTreatment } from "@/lib/queries";
import { hasAdminAccess } from "@/lib/supabase";
import CommentTrendChart from "./CommentTrendChart";
import TreatmentCell from "../TreatmentCell";

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

  const [title, episode, history, treatment] = await Promise.all([
    getTitle(id),
    getEpisode(id, episodeNo),
    getEpisodeHistory(id, episodeNo),
    getEpisodeTreatment(id, episodeNo),
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

      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-neutral-500">트리트먼트</h2>
        <TreatmentCell titleId={id} no={episodeNo} initialValue={treatment} rows={6} readOnly={!hasAdminAccess()} />
      </div>
    </div>
  );
}
