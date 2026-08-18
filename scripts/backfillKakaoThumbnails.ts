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

async function main() {
  const supabase = getSupabaseAdmin();
  const { data: titles, error } = await supabase
    .from("kakao_titles")
    .select("content_id, seo_id, title_name")
    .eq("is_active", true)
    .order("content_id", { ascending: true });
  if (error) throw error;
  console.log(`대상 ${titles.length}개 (2초 간격 직렬 처리라 예상 소요: 약 ${Math.round((titles.length * 2) / 60)}분)`);

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
