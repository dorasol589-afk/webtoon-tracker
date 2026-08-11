// 일회성 스크립트: comic.naver.com의 연재작들을 네이버 시리즈(series.naver.com) 작품과
// 이름으로 검색해 매칭한다. 확신 있는 매칭만 series_products 테이블에 저장하고,
// 애매한 건 검토용 엑셀로 뽑는다.
// 사용법: npx tsx scripts/matchSeries.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import pLimit from "p-limit";
import { getSupabaseAdmin } from "../lib/supabase";
import { fetchSeriesDownloadCount } from "../lib/naver";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function normalize(s: string): string {
  return s
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

async function fetchWithRetry(url: string, retries = 3): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 800 * (attempt + 1) ** 2));
    }
  }
  throw lastError;
}

async function findProductNo(titleName: string): Promise<number | null> {
  const q = encodeURIComponent(`${titleName} 네이버시리즈`);
  const html = await fetchWithRetry(`https://search.naver.com/search.naver?query=${q}`);
  const matches = [...html.matchAll(/series\.naver\.com\/comic\/detail\.series\?productNo=(\d+)/g)];
  if (matches.length === 0) return null;
  return parseInt(matches[0][1], 10);
}

interface MatchResult {
  titleId: number;
  titleName: string;
  status: "matched" | "no_candidate" | "title_mismatch" | "error";
  productNo?: number;
  seriesTitle?: string;
  error?: string;
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
  console.log(`대상 작품: ${titles.length}개`);

  const { data: existing } = await supabase.from("series_products").select("title_id");
  const alreadyMatched = new Set((existing ?? []).map((r) => r.title_id));
  const targets = titles.filter((t) => !alreadyMatched.has(t.title_id));
  console.log(`이미 매칭된 것 제외: ${targets.length}개 처리`);

  const limit = pLimit(4);
  const results: MatchResult[] = [];
  let done = 0;

  await Promise.all(
    targets.map((t) =>
      limit(async () => {
        try {
          const productNo = await findProductNo(t.title_name);
          if (!productNo) {
            results.push({ titleId: t.title_id, titleName: t.title_name, status: "no_candidate" });
            return;
          }
          const pageHtml = await fetchWithRetry(
            `https://series.naver.com/comic/detail.series?productNo=${productNo}`
          );
          const titleMatch = pageHtml.match(/<title>([^<]*)<\/title>/);
          const seriesTitle = titleMatch ? titleMatch[1].trim() : "";
          if (normalize(seriesTitle) === normalize(t.title_name)) {
            results.push({
              titleId: t.title_id,
              titleName: t.title_name,
              status: "matched",
              productNo,
              seriesTitle,
            });
          } else {
            results.push({
              titleId: t.title_id,
              titleName: t.title_name,
              status: "title_mismatch",
              productNo,
              seriesTitle,
            });
          }
        } catch (err) {
          results.push({
            titleId: t.title_id,
            titleName: t.title_name,
            status: "error",
            error: String(err),
          });
        } finally {
          done++;
          if (done % 50 === 0) console.log(`  진행: ${done}/${targets.length}`);
        }
      })
    )
  );

  const matched = results.filter((r) => r.status === "matched");
  const uncertain = results.filter((r) => r.status !== "matched");
  console.log(`매칭 성공: ${matched.length}개, 검토 필요: ${uncertain.length}개`);

  if (matched.length > 0) {
    const productRows = matched.map((m) => ({
      product_no: m.productNo!,
      title_id: m.titleId,
      series_title_name: m.seriesTitle!,
    }));
    const { error: insertError } = await supabase.from("series_products").upsert(productRows, {
      onConflict: "product_no",
    });
    if (insertError) console.error("series_products 저장 실패:", insertError.message);

    console.log("매칭된 작품들의 초기 다운로드수 수집...");
    const dlLimit = pLimit(10);
    const now = new Date();
    const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const snapshotDate = `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, "0")}-${String(
      kst.getDate()
    ).padStart(2, "0")}`;
    const snapshotRows: { product_no: number; title_id: number; snapshot_date: string; download_count: number }[] =
      [];
    await Promise.all(
      matched.map((m) =>
        dlLimit(async () => {
          try {
            const count = await fetchSeriesDownloadCount(m.productNo!);
            snapshotRows.push({
              product_no: m.productNo!,
              title_id: m.titleId,
              snapshot_date: snapshotDate,
              download_count: count,
            });
          } catch (err) {
            console.error(`  다운로드수 조회 실패 (${m.titleName}):`, err);
          }
        })
      )
    );
    for (let i = 0; i < snapshotRows.length; i += 500) {
      const batch = snapshotRows.slice(i, i + 500);
      const { error } = await supabase
        .from("series_snapshots")
        .upsert(batch, { onConflict: "product_no,snapshot_date" });
      if (error) console.error("series_snapshots 저장 실패:", error.message);
    }
    console.log(`다운로드수 ${snapshotRows.length}건 저장 완료`);
  }

  const fs = await import("fs");
  fs.writeFileSync("series_match_uncertain.json", JSON.stringify(uncertain, null, 2));
  fs.writeFileSync("series_match_matched.json", JSON.stringify(matched, null, 2));
  console.log("완료. uncertain 목록: series_match_uncertain.json");
}

main().catch((err) => {
  console.error("매칭 실행 중 오류:", err);
  process.exit(1);
});
