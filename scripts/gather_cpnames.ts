import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { getSupabaseAdmin } from "../lib/supabase";
import pLimit from "p-limit";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchCpName(titleId: number): Promise<string> {
  const res = await fetch(`https://comic.naver.com/api/article/list/info?titleId=${titleId}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  const data = await res.json();
  return data?.gfpAdCustomParam?.cpName ?? "";
}

async function main() {
  const supabase = getSupabaseAdmin();
  const titles: { title_id: number; title_name: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("titles")
      .select("title_id,title_name")
      .eq("is_active", true)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    titles.push(...data);
    if (data.length < 1000) break;
  }
  console.log("대상:", titles.length);

  const limit = pLimit(15);
  const results: { titleId: number; titleName: string; cpName: string }[] = [];
  let done = 0;
  await Promise.all(
    (titles ?? []).map((t) =>
      limit(async () => {
        try {
          const cpName = await fetchCpName(t.title_id);
          results.push({ titleId: t.title_id, titleName: t.title_name, cpName });
        } catch {
          results.push({ titleId: t.title_id, titleName: t.title_name, cpName: "" });
        } finally {
          done++;
          if (done % 100 === 0) console.log("진행:", done);
        }
      })
    )
  );

  const fs = await import("fs");
  fs.writeFileSync("cpnames.json", JSON.stringify(results, null, 2));

  // 스튜디오 접두어(첫 "_" 앞부분) 분석
  const studioKeys = new Map<string, number>();
  let noUnderscore = 0;
  let daJung = 0;
  for (const r of results) {
    if (!r.cpName) continue;
    if (r.cpName.startsWith("다중")) { daJung++; continue; }
    const idx = r.cpName.indexOf("_");
    if (idx === -1) { noUnderscore++; continue; }
    const key = r.cpName.slice(0, idx);
    studioKeys.set(key, (studioKeys.get(key) ?? 0) + 1);
  }
  console.log("고유 스튜디오 수:", studioKeys.size);
  console.log("다중(개별 검토 필요):", daJung);
  console.log("언더스코어 없음(개인 추정):", noUnderscore);
  console.log("상위 20개 스튜디오:", [...studioKeys.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20));
}
main();
