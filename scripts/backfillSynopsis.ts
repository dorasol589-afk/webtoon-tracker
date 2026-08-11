// 일회성 스크립트: 작품 소개(synopsis)를 채운다. 자주 안 바뀌는 정보라 매일 수집기에는 안 넣음.
// 사용법: npx tsx scripts/backfillSynopsis.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import pLimit from "p-limit";
import { getSupabaseAdmin } from "../lib/supabase";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchSynopsis(titleId: number): Promise<string | null> {
  const res = await fetch(`https://comic.naver.com/api/article/list/info?titleId=${titleId}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data?.synopsis ?? null;
}

async function main() {
  const supabase = getSupabaseAdmin();
  const titles: { title_id: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from("titles").select("title_id").eq("is_active", true).range(from, from + 999);
    if (!data || data.length === 0) break;
    titles.push(...data);
    if (data.length < 1000) break;
  }
  console.log("대상:", titles.length);

  const limit = pLimit(10);
  let success = 0;
  let failures = 0;
  let done = 0;
  await Promise.all(
    titles.map((t) =>
      limit(async () => {
        try {
          const synopsis = await fetchSynopsis(t.title_id);
          const { error } = await supabase.from("titles").update({ synopsis }).eq("title_id", t.title_id);
          if (error) throw error;
          success++;
        } catch (err) {
          failures++;
          console.error(`실패 (titleId=${t.title_id}):`, err);
        } finally {
          done++;
          if (done % 100 === 0) console.log("진행:", done, "/", titles.length);
        }
      })
    )
  );
  console.log(`완료. 성공 ${success}개, 실패 ${failures}개`);
}

main().catch((err) => {
  console.error("실행 중 오류:", err);
  process.exit(1);
});
