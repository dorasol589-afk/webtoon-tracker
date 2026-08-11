// 일회성 스크립트: cpnames.json(scripts/matchSeries.ts와 별개로 미리 gather_cpnames.ts로 뽑아둔 파일)을 기반으로
// 제작사 정보를 titles 테이블에 채운다.
// - 언더스코어 없는 cpName -> 개인 작가 ("개인")
// - "다중"으로 시작 -> 협업/특정 불가 ("다중", 홈페이지 없음)
// - 나머지 -> 스튜디오 키 추출, 빈도 상위 STUDIO_LIMIT개만 홈페이지 검색
// 사용법: npx tsx scripts/matchStudios.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import pLimit from "p-limit";
import { getSupabaseAdmin } from "../lib/supabase";
import fs from "fs";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const STUDIO_LIMIT = 100;

const EXCLUDED_DOMAINS = [
  "naver.com",
  "namu.wiki",
  "wikipedia.org",
  "google.com",
  "daum.net",
  "webtoonguide.com",
];

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

async function findStudioWebsite(studioKey: string): Promise<string | null> {
  const q = encodeURIComponent(`${studioKey} 웹툰 제작사 공식 홈페이지`);
  const html = await fetchWithRetry(`https://search.naver.com/search.naver?query=${q}`);
  const urlMatches = [...html.matchAll(/https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[^\s"'<>]*/g)].map((m) => m[0]);
  for (const url of urlMatches) {
    try {
      const host = new URL(url).hostname;
      if (EXCLUDED_DOMAINS.some((d) => host.endsWith(d))) continue;
      if (host.startsWith("ssl.pstatic.net") || host.includes("pstatic.net")) continue;
      return url;
    } catch {
      continue;
    }
  }
  return null;
}

interface CpNameRow {
  titleId: number;
  titleName: string;
  cpName: string;
}

function deriveStudio(cpName: string): { key: string | null; name: string; isCompany: boolean } {
  if (!cpName) return { key: null, name: "", isCompany: false };
  if (cpName.startsWith("다중")) return { key: null, name: "다중", isCompany: false };
  const idx = cpName.indexOf("_");
  if (idx === -1) return { key: null, name: "개인", isCompany: false };
  const key = cpName.slice(0, idx);
  return { key, name: key, isCompany: true };
}

async function main() {
  const rows: CpNameRow[] = JSON.parse(fs.readFileSync("cpnames.json", "utf-8"));
  const supabase = getSupabaseAdmin();

  const studioCounts = new Map<string, number>();
  for (const r of rows) {
    const d = deriveStudio(r.cpName);
    if (d.isCompany && d.key) studioCounts.set(d.key, (studioCounts.get(d.key) ?? 0) + 1);
  }
  const topStudios = [...studioCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, STUDIO_LIMIT)
    .map(([key]) => key);
  console.log(`상위 ${topStudios.length}개 스튜디오 홈페이지 검색...`);

  const limit = pLimit(4);
  const websiteByKey = new Map<string, string | null>();
  let done = 0;
  await Promise.all(
    topStudios.map((key) =>
      limit(async () => {
        try {
          websiteByKey.set(key, await findStudioWebsite(key));
        } catch (err) {
          websiteByKey.set(key, null);
          console.error(`  검색 실패 (${key}):`, err);
        } finally {
          done++;
          if (done % 20 === 0) console.log(`  진행: ${done}/${topStudios.length}`);
        }
      })
    )
  );

  const updateRows = rows.map((r) => {
    const d = deriveStudio(r.cpName);
    return {
      title_id: r.titleId,
      studio_key: d.key,
      studio_name: d.name,
      studio_website_url: d.key ? websiteByKey.get(d.key) ?? null : null,
    };
  });

  // titles.title_name이 NOT NULL이라 upsert(부분 컬럼)는 실패함 -> update로 처리.
  // 같은 값(스튜디오/홈페이지)을 가진 작품끼리 묶어서 배치 update 횟수를 줄임.
  console.log("titles 테이블 업데이트...");
  const groups = new Map<string, { studio_key: string | null; studio_name: string; studio_website_url: string | null; titleIds: number[] }>();
  for (const r of updateRows) {
    const groupKey = JSON.stringify([r.studio_key, r.studio_name, r.studio_website_url]);
    const g = groups.get(groupKey);
    if (g) {
      g.titleIds.push(r.title_id);
    } else {
      groups.set(groupKey, {
        studio_key: r.studio_key,
        studio_name: r.studio_name,
        studio_website_url: r.studio_website_url,
        titleIds: [r.title_id],
      });
    }
  }
  console.log(`  ${groups.size}개 그룹으로 업데이트`);
  const updateLimit = pLimit(10);
  let updateFailures = 0;
  await Promise.all(
    [...groups.values()].map((g) =>
      updateLimit(async () => {
        const { error } = await supabase
          .from("titles")
          .update({
            studio_key: g.studio_key,
            studio_name: g.studio_name,
            studio_website_url: g.studio_website_url,
          })
          .in("title_id", g.titleIds);
        if (error) {
          updateFailures++;
          console.error("업데이트 실패:", error.message);
        }
      })
    )
  );
  console.log(`  업데이트 실패 그룹: ${updateFailures}개`);

  const withWebsite = [...websiteByKey.values()].filter(Boolean).length;
  console.log(
    `완료. 스튜디오 ${topStudios.length}개 중 홈페이지 찾음 ${withWebsite}개, ` +
      `작품 ${updateRows.length}개 업데이트`
  );

  fs.writeFileSync(
    "studio_websites.json",
    JSON.stringify([...websiteByKey.entries()].map(([key, url]) => ({ key, url })), null, 2)
  );
}

main().catch((err) => {
  console.error("실행 중 오류:", err);
  process.exit(1);
});
