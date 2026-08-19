// 일회성/수시 실행용: studio_job_postings를 지금 바로 다시 채운다(원래는 collect.ts의 [9/10]
// 단계에서 매일 밤 같이 도는데, dedupeByPostingId 버그 수정을 즉시 반영하려고 이 단계만 따로 뺐다).
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import pLimit from "p-limit";
import { fetchSaraminJobs, fetchJobKoreaJobs, type JobPosting } from "../lib/recruit";
import { getSupabaseAdmin } from "../lib/supabase";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const supabase = getSupabaseAdmin();
  const { data: recruitLinks, error: linksError } = await supabase
    .from("studio_recruit_links")
    .select("studio_name,saramin_url,jobkorea_url");
  if (linksError) throw linksError;
  console.log(`대상 제작사 ${recruitLinks?.length ?? 0}곳`);

  const recruitLimit = pLimit(4);
  let jobFailures = 0;
  const postingRows: {
    studio_name: string;
    source: string;
    posting_id: string;
    title: string;
    url: string;
    status: string;
    dday: string | null;
  }[] = [];

  await Promise.all(
    (recruitLinks ?? []).map((link) =>
      recruitLimit(async () => {
        const toRows = (source: "SARAMIN" | "JOBKOREA", jobs: JobPosting[]) =>
          jobs.map((j) => ({
            studio_name: link.studio_name,
            source,
            posting_id: j.postingId,
            title: j.title,
            url: j.url,
            status: j.status,
            dday: j.dday,
          }));
        try {
          if (link.saramin_url) postingRows.push(...toRows("SARAMIN", await fetchSaraminJobs(link.saramin_url)));
        } catch (err) {
          jobFailures++;
          console.error(`  사람인 조회 실패 (${link.studio_name}):`, err instanceof Error ? err.message : err);
        }
        try {
          if (link.jobkorea_url) {
            const jobs = await fetchJobKoreaJobs(link.jobkorea_url);
            postingRows.push(...toRows("JOBKOREA", jobs));
          }
        } catch (err) {
          jobFailures++;
          console.error(`  잡코리아 조회 실패 (${link.studio_name}):`, err instanceof Error ? err.message : err);
        }
      })
    )
  );

  const processedStudios = [...new Set((recruitLinks ?? []).map((l) => l.studio_name))];
  for (const batch of chunk(processedStudios, 500)) {
    const { error } = await supabase.from("studio_job_postings").delete().in("studio_name", batch);
    if (error) console.error("  studio_job_postings 삭제 실패:", error.message);
  }
  for (const batch of chunk(postingRows, 500)) {
    const { error } = await supabase
      .from("studio_job_postings")
      .upsert(batch, { onConflict: "studio_name,source,posting_id" });
    if (error) console.error("  studio_job_postings upsert 실패:", error.message);
  }
  console.log(`완료: 채용공고 ${postingRows.length}건 저장 (조회 실패 ${jobFailures}건)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("실행 중 오류:", err);
    process.exit(1);
  });
