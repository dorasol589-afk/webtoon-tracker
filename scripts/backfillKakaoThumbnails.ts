// 일회성 백필: kakao_titles 전체(연재중+완결)의 썸네일을 titleImageB 배너 플레이스홀더에서
// 실제 표지 이미지(c1)로 교체한다. fetchViewsAndLikes가 어차피 상세페이지 HTML을 받아오면서
// coverImageUrl도 함께 추출하므로 그 값으로 thumbnail_url만 갱신한다.
// 사용법: npx tsx scripts/backfillKakaoThumbnails.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import pLimit from "p-limit";
import { fetchViewsAndLikes } from "../lib/kakao";
import { getSupabaseAdmin } from "../lib/supabase";

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
  const supabase = getSupabaseAdmin();
  const allTitles = await fetchAllActiveTitles(supabase);
  // 이미 진짜 표지(c1)로 교정된 건 재조회하지 않는다 - 재시도 시 이미 성공한 것까지
  // 다시 훑느라 시간을 낭비하고 IP 차단 위험만 키우게 됨
  const titles = allTitles.filter((t) => !t.thumbnail_url || !t.thumbnail_url.includes("/c1/"));
  console.log(
    `전체 ${allTitles.length}개 중 대상 ${titles.length}개 (이미 교정됨 ${allTitles.length - titles.length}개 제외, 2초 간격 직렬 처리라 예상 소요: 약 ${Math.round((titles.length * 2) / 60)}분)`
  );

  let done = 0;
  let updated = 0;
  let failed = 0;
  const limit = pLimit(8); // fetchViewsAndLikes 내부에서 실제 요청은 전역 2초 간격으로 직렬화됨
  await Promise.all(
    titles.map((t) =>
      limit(async () => {
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
            } else {
              updated++;
            }
          } else {
            failed++;
          }
        } catch (err) {
          failed++;
          console.error(`  조회 실패 (${t.title_name}):`, err instanceof Error ? err.message : err);
        }
        done++;
        if (done % 100 === 0) console.log(`  진행: ${done}/${titles.length} (성공 ${updated}, 실패 ${failed})`);
      })
    )
  );
  console.log(`\n완료: ${titles.length}개 중 성공 ${updated}개, 실패 ${failed}개`);
}

main().catch((err) => {
  console.error("백필 실행 중 오류:", err);
  process.exit(1);
});
