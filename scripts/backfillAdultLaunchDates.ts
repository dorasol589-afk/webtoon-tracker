// 일회성 백필: 성인(19금) 작품은 네이버 회차 목록 API가 로그인 없이 막혀있어 1화 service_date가
// 전부 null이었다. 나무위키 "연재 기간"으로 런칭일을 찾아 1화 service_date만 채운다
// (2화 이후는 나무위키에도 없어서 여전히 null로 남음 - 런칭일 판단에는 1화 날짜면 충분).
// 사용법: npx tsx scripts/backfillAdultLaunchDates.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import pLimit from "p-limit";
import { getSupabaseAdmin } from "../lib/supabase";
import { findAdultTitleLaunchDate } from "../lib/namu";

async function main() {
  const supabase = getSupabaseAdmin();

  const { data: titles, error } = await supabase
    .from("titles")
    .select("title_id,title_name")
    .eq("is_adult", true);
  if (error) throw error;
  console.log(`성인 작품 ${titles?.length ?? 0}개 확인`);

  const { data: firstEpisodes, error: epError } = await supabase
    .from("episodes")
    .select("title_id,service_date")
    .eq("no", 1)
    .in("title_id", (titles ?? []).map((t) => t.title_id));
  if (epError) throw epError;
  const missingDateIds = new Set(
    (firstEpisodes ?? []).filter((e) => !e.service_date).map((e) => e.title_id)
  );
  const targets = (titles ?? []).filter((t) => missingDateIds.has(t.title_id));
  console.log(`1화 런칭일이 비어있는 작품 ${targets.length}개 대상으로 나무위키 조회 시작`);

  const limit = pLimit(4);
  let found = 0;
  let missed = 0;
  let updateFailures = 0;
  let done = 0;

  await Promise.all(
    targets.map((t) =>
      limit(async () => {
        try {
          const launchDate = await findAdultTitleLaunchDate(t.title_name);
          if (launchDate) {
            const { error: updateError } = await supabase
              .from("episodes")
              .update({ service_date: launchDate })
              .eq("title_id", t.title_id)
              .eq("no", 1);
            if (updateError) {
              updateFailures++;
              console.error(`  업데이트 실패 (${t.title_name}):`, updateError.message);
            } else {
              found++;
            }
          } else {
            missed++;
            console.log(`  못 찾음: ${t.title_name} (title_id=${t.title_id})`);
          }
        } catch (err) {
          missed++;
          console.error(`  조회 실패 (${t.title_name}):`, err instanceof Error ? err.message : err);
        } finally {
          done++;
          if (done % 20 === 0) console.log(`  진행: ${done}/${targets.length}`);
        }
      })
    )
  );

  console.log(`완료: 찾음 ${found}건, 못 찾음 ${missed}건, DB 업데이트 실패 ${updateFailures}건`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("실행 중 오류:", err);
    process.exit(1);
  });
