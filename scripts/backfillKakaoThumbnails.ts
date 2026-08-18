// 일회성 백필: kakao_titles 전체(연재중+완결)의 썸네일을 titleImageB 배너 플레이스홀더에서
// 실제 표지 이미지(c1)로 교체한다. fetchViewsAndLikes가 어차피 상세페이지 HTML을 받아오면서
// coverImageUrl도 함께 추출하므로 그 값으로 thumbnail_url만 갱신한다.
//
// webtoon.kakao.com 상세페이지는 짧은 시간에 많이 두드리면 IP 차단(403)이 걸린다. 순차 처리 +
// 요청 간격(기본 4초, KAKAO_CONTENT_PAGE_INTERVAL_MS로 조절)만으로는 부족해서, 연속 실패가
// 쌓이면(=차단 시작 신호) 한동안 완전히 멈췄다가 재개하는 서킷브레이커를 추가로 둔다.
//
// 사용법: npx tsx scripts/backfillKakaoThumbnails.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { fetchViewsAndLikes } from "../lib/kakao";
import { getSupabaseAdmin } from "../lib/supabase";

const CONSECUTIVE_FAILURE_THRESHOLD = 8; // 이 횟수만큼 연달아 실패하면 차단으로 간주하고 쉼
const COOLDOWN_MS = 10 * 60 * 1000; // 쉬는 시간 (10분)

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// PostgREST 기본 응답 상한이 1000행이라 단일 select로는 일부만 돌아온다(export_titles_data_unified와
// 동일하게 겪었던 문제) - range로 페이지네이션해서 전량을 가져온다.
async function fetchAllActiveTitles(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const pageSize = 1000;
  const all: { content_id: number; seo_id: string; title_name: string; thumbnail_url: string | null }[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("kakao_titles")
      .select("content_id, seo_id, title_name, thumbnail_url")
      .eq("is_active", true)
      .order("content_id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

async function main() {
  const startDelayMs = Number(process.env.KAKAO_BACKFILL_START_DELAY_MS) || 0;
  if (startDelayMs > 0) {
    console.log(`시작 전 ${Math.round(startDelayMs / 60000)}분 대기 (기존 차단이 풀릴 시간을 줌)...`);
    await sleep(startDelayMs);
  }

  const supabase = getSupabaseAdmin();
  const allTitles = await fetchAllActiveTitles(supabase);
  // 이미 진짜 표지(c1)로 교정된 건 재조회하지 않는다 - 재시도 시 이미 성공한 것까지
  // 다시 훑느라 시간을 낭비하고 IP 차단 위험만 키우게 됨
  const titles = allTitles.filter((t) => !t.thumbnail_url || !t.thumbnail_url.includes("/c1/"));
  const intervalMs = Number(process.env.KAKAO_CONTENT_PAGE_INTERVAL_MS) || 2000;
  console.log(
    `전체 ${allTitles.length}개 중 대상 ${titles.length}개 (이미 교정됨 ${allTitles.length - titles.length}개 제외), 요청 간격 ${intervalMs}ms, 연속 실패 ${CONSECUTIVE_FAILURE_THRESHOLD}회 시 ${
      COOLDOWN_MS / 60000
    }분 휴식`
  );

  let updated = 0;
  let failed = 0;
  let consecutiveFailures = 0;

  for (let i = 0; i < titles.length; i++) {
    const t = titles[i];
    try {
      const stats = await fetchViewsAndLikes(t.seo_id, t.content_id);
      if (stats.coverImageUrl) {
        const { error: updateError } = await supabase
          .from("kakao_titles")
          .update({ thumbnail_url: stats.coverImageUrl })
          .eq("content_id", t.content_id);
        if (updateError) {
          console.error(`  upsert 실패 (${t.title_name}):`, updateError.message);
          failed++;
          consecutiveFailures++;
        } else {
          updated++;
          consecutiveFailures = 0;
        }
      } else {
        failed++;
        consecutiveFailures++;
      }
    } catch (err) {
      failed++;
      consecutiveFailures++;
      console.error(`  조회 실패 (${t.title_name}):`, err instanceof Error ? err.message : err);
    }

    if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
      console.log(
        `  연속 실패 ${consecutiveFailures}회 감지 - 차단으로 판단, ${COOLDOWN_MS / 60000}분 대기 후 재개 (진행 ${i + 1}/${titles.length})`
      );
      await sleep(COOLDOWN_MS);
      consecutiveFailures = 0;
    }

    if ((i + 1) % 50 === 0) console.log(`  진행: ${i + 1}/${titles.length} (성공 ${updated}, 실패 ${failed})`);
  }

  console.log(`\n완료: ${titles.length}개 중 성공 ${updated}개, 실패 ${failed}개`);
}

main().catch((err) => {
  console.error("백필 실행 중 오류:", err);
  process.exit(1);
});
