// 카카오웹툰 일일 수집기: 연재중인 작품의 조회수/좋아요수를 수집해 Supabase에 저장한다.
// 댓글수는 카카오 API가 일반 서버 요청을 차단해(브라우저 핑거프린팅으로 추정, LANGUAGE_MISMATCH 오류)
// 수집 대상에서 제외했다 - lib/kakao.ts 작성 당시 curl/Node fetch/HTTP2 모두 시도했지만 막힘을 확인함.
// 요일별 인기순위(timetables 응답의 sorting 필드)도 세션 상태에 따라 값이 들쭉날쭉하게 빠지는 걸
// 확인해서(실제 브라우저에서도 재현됨, Node만의 문제가 아님) 신뢰할 수 없다고 판단해 제외했다.
// 사용법:
//   npx tsx scripts/collectKakao.ts                 # 전체 수집
//   TITLE_LIMIT=5 npx tsx scripts/collectKakao.ts    # 작품 5개만 수집 (드라이런)
import { config as loadEnv } from "dotenv";
import pLimit from "p-limit";

loadEnv({ path: ".env.local" });
loadEnv();
import {
  fetchAllOngoingTitles,
  fetchFinishedTitles,
  fetchNewTitles,
  fetchTitleProfile,
  fetchViewsAndLikes,
  fetchAllEpisodes,
  type KakaoCardContent,
} from "../lib/kakao";

function getKstDateString(): string {
  const now = new Date();
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, "0");
  const d = String(kst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// 오늘 KST 기준 hour:minute 시각을 실제 epoch ms로 환산 (완결작 백필 시간 예산 마감 계산용)
function getKstDeadlineTimestamp(hour: number, minute: number): number {
  const now = new Date();
  const kstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const deadlineKst = new Date(kstNow);
  deadlineKst.setHours(hour, minute, 0, 0);
  const diffMs = deadlineKst.getTime() - kstNow.getTime();
  return now.getTime() + diffMs;
}

function toDateOnly(iso: string | null): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function dedupeBy<T>(arr: T[], keyFn: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of arr) map.set(keyFn(item), item);
  return [...map.values()];
}

function titleRowFromCard(card: KakaoCardContent, isFinished: boolean, isNew: boolean, nowIso: string) {
  return {
    content_id: card.id,
    seo_id: card.seoId,
    title_name: card.title,
    // 목록 API(card.titleImageB)는 제목 텍스트만 박힌 배너 플레이스홀더라 썸네일로 못 쓴다
    // (lib/kakao.ts의 fetchViewsAndLikes 주석 참고) - 진짜 표지는 [2/4] 상세수집 단계에서
    // coverImageUrl로 별도 upsert된다. 여기선 최초 삽입 시 null로 둬서 깨진 이미지가 안 뜨게 한다.
    is_adult: card.adult ?? false,
    is_finished: isFinished,
    is_on_hiatus: card.rest ?? false,
    is_new: isNew,
    is_active: true,
    last_seen_at: nowIso,
  };
}

/**
 * 작품 하나의 상세정보(작가/시놉시스/장르)+조회수/좋아요수+회차목록을 수집해 upsert.
 * 세 요청을 Promise.allSettled로 각각 독립 처리한다 - webtoon.kakao.com 조회수/좋아요수 페이지는
 * IP 차단이 걸리기 쉬운데(fetchViewsAndLikes 주석 참고), Promise.all로 묶으면 그 실패 하나 때문에
 * 이미 성공한 gateway-kw API(프로필/회차) 결과까지 통째로 버려지는 문제가 있어 분리함.
 * 셋 다 실패해야 false를 반환한다.
 */
async function collectTitleDetail(
  supabase: ReturnType<typeof import("../lib/supabase").getSupabaseAdmin>,
  card: KakaoCardContent,
  snapshotDate: string
): Promise<boolean> {
  const [profileResult, statsResult, episodesResult] = await Promise.allSettled([
    fetchTitleProfile(card.id),
    fetchViewsAndLikes(card.seoId, card.id),
    fetchAllEpisodes(card.id),
  ]);

  if (profileResult.status === "fulfilled") {
    const profile = profileResult.value;
    const { error } = await supabase.from("kakao_titles").upsert(
      {
        content_id: card.id,
        seo_id: card.seoId,
        title_name: card.title,
        writer: profile.writers.join(", ") || null,
        painter: profile.painters.join(", ") || null,
        origin_author: profile.originAuthors.join(", ") || null,
        studio_name: profile.publishers.join(", ") || null,
        synopsis: profile.synopsis || null,
        // 요일별 목록(card.genreFilters)은 세션 상태에 따라 빠지는 경우가 있어(README 상단 참고)
        // 항상 안정적으로 오는 프로필 API의 seoKeywords(해시태그 형태 키워드)를 대신 사용
        genres: profile.seoKeywords,
        is_finished: profile.isFinished,
        age_rating: profile.ageRating,
      },
      { onConflict: "content_id" }
    );
    if (error) console.error(`  kakao_titles(상세) upsert 실패 (${card.title}):`, error.message);
  } else {
    console.error(`  프로필 조회 실패 (contentId=${card.id}, ${card.title}):`, profileResult.reason);
  }

  if (statsResult.status === "fulfilled") {
    const stats = statsResult.value;
    if (stats.viewCount !== null || stats.likeCount !== null) {
      const { error } = await supabase.from("kakao_stat_snapshots").upsert(
        {
          content_id: card.id,
          snapshot_date: snapshotDate,
          view_count: stats.viewCount,
          like_count: stats.likeCount,
        },
        { onConflict: "content_id,snapshot_date" }
      );
      if (error) console.error(`  kakao_stat_snapshots upsert 실패 (${card.title}):`, error.message);
    }
    if (stats.coverImageUrl) {
      const { error } = await supabase
        .from("kakao_titles")
        .update({ thumbnail_url: stats.coverImageUrl })
        .eq("content_id", card.id);
      if (error) console.error(`  kakao_titles(썸네일) upsert 실패 (${card.title}):`, error.message);
    }
  } else {
    console.error(`  조회수/좋아요수 조회 실패 (contentId=${card.id}, ${card.title}):`, statsResult.reason);
  }

  if (episodesResult.status === "fulfilled") {
    const episodeRows = dedupeBy(
      episodesResult.value.map((e) => ({
        content_id: card.id,
        no: e.no,
        episode_id: e.episodeId,
        title: e.title,
        service_date: toDateOnly(e.serialStartDateTime),
        use_type: e.useType,
      })),
      (e) => String(e.no)
    );
    for (const batch of chunk(episodeRows, 500)) {
      const { error } = await supabase.from("kakao_episodes").upsert(batch, { onConflict: "content_id,no" });
      if (error) console.error(`  kakao_episodes upsert 실패 (${card.title}):`, error.message);
    }
  } else {
    console.error(`  회차목록 조회 실패 (contentId=${card.id}, ${card.title}):`, episodesResult.reason);
  }

  return profileResult.status === "fulfilled" || statsResult.status === "fulfilled" || episodesResult.status === "fulfilled";
}

async function main() {
  const startedAt = Date.now();
  const titleLimit = process.env.TITLE_LIMIT ? parseInt(process.env.TITLE_LIMIT, 10) : undefined;
  const hasDb = !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const snapshotDate = getKstDateString();

  console.log(`[1/4] 연재중 작품 목록 + 완결 작품 목록 + 신작 목록 조회...`);
  const ongoingTitles = await fetchAllOngoingTitles();
  const finishedTitlesRaw = await fetchFinishedTitles();
  const newTitlesRaw = await fetchNewTitles();
  const newIds = new Set(newTitlesRaw.map((t) => t.id));
  const ongoingIds = new Set(ongoingTitles.map((t) => t.id));
  const finishedTitles = finishedTitlesRaw.filter((t) => !ongoingIds.has(t.id));
  const titles = titleLimit ? ongoingTitles.slice(0, titleLimit) : ongoingTitles;
  console.log(
    `  연재중 ${ongoingTitles.length}개 + 완결 ${finishedTitles.length}개 + 신작 ${newIds.size}개 중 연재중 ${titles.length}개 처리 대상${
      titleLimit ? " (TITLE_LIMIT 적용)" : ""
    }`
  );

  let supabase: ReturnType<typeof import("../lib/supabase").getSupabaseAdmin> | null = null;
  if (hasDb) {
    const { getSupabaseAdmin } = await import("../lib/supabase");
    supabase = getSupabaseAdmin();

    const nowIso = new Date().toISOString();
    const titleRows = titles.map((t) => titleRowFromCard(t, false, newIds.has(t.id), nowIso));
    for (const batch of chunk(titleRows, 500)) {
      const { error } = await supabase.from("kakao_titles").upsert(batch, { onConflict: "content_id" });
      if (error) console.error("  kakao_titles upsert 실패:", error.message);
    }

    if (!titleLimit) {
      const currentIds = titles.map((t) => t.id);
      const { error: deactivateError } = await supabase
        .from("kakao_titles")
        .update({ is_active: false })
        .eq("is_active", true)
        .eq("is_finished", false)
        .not("content_id", "in", `(${currentIds.join(",") || 0})`);
      if (deactivateError) console.error("  kakao_titles 비활성화 실패:", deactivateError.message);
    }
  } else {
    console.log("  (SUPABASE_URL/SERVICE_ROLE_KEY 미설정 - 드라이런 모드, DB에 쓰지 않음)");
  }

  console.log(`[2/4] 작품별 상세정보 + 조회수/좋아요수 + 회차목록 수집...`);
  let detailFailures = 0;
  if (supabase) {
    const detailLimit = pLimit(8);
    const results = await Promise.all(
      titles.map((card) => detailLimit(() => collectTitleDetail(supabase!, card, snapshotDate)))
    );
    detailFailures = results.filter((ok) => !ok).length;
    console.log(`  성공 ${titles.length - detailFailures}건 / 실패 ${detailFailures}건`);
  } else {
    console.log("  (드라이런 모드 - 상세정보 수집 생략, 샘플 5건만 조회)");
    const sampleLimit = pLimit(5);
    await Promise.all(
      titles.slice(0, 5).map((card) =>
        sampleLimit(async () => {
          try {
            const stats = await fetchViewsAndLikes(card.seoId, card.id);
            console.log(`    ${card.title} - 조회수 ${stats.viewCount}, 좋아요 ${stats.likeCount}`);
          } catch (err) {
            console.error(`    조회 실패 (${card.title}):`, err);
          }
        })
      )
    );
  }

  console.log(`[3/4] 완결 작품 초기 백필 (작품당 최초 1회, 08:10 KST까지)...`);
  let finishedBackfilledCount = 0;
  let finishedStoppedForTime = false;
  if (titleLimit) {
    console.log("  (TITLE_LIMIT 테스트 실행이라 완결작 백필은 건너뜀)");
  } else if (supabase) {
    const deadline = getKstDeadlineTimestamp(8, 10);
    console.log(`  마감 시각(KST 08:10): ${new Date(deadline).toISOString()}`);

    const nowIso = new Date().toISOString();
    const finishedRows = finishedTitles.map((t) => titleRowFromCard(t, true, newIds.has(t.id), nowIso));
    for (const batch of chunk(finishedRows, 500)) {
      const { error } = await supabase.from("kakao_titles").upsert(batch, { onConflict: "content_id" });
      if (error) console.error("  완결작 kakao_titles upsert 실패:", error.message);
    }

    const finishedById = new Map(finishedTitles.map((t) => [t.id, t]));
    const backfillLimit = pLimit(6);

    while (Date.now() < deadline) {
      const { data: pending, error: pendingError } = await supabase
        .from("kakao_titles")
        .select("content_id")
        .eq("is_finished", true)
        .is("finished_backfilled_at", null)
        .order("content_id", { ascending: true })
        .limit(50);
      if (pendingError) {
        console.error("  백필 대상 조회 실패:", pendingError.message);
        break;
      }
      if (!pending || pending.length === 0) {
        console.log("  완결작 백필 대상 없음 (전부 완료됨)");
        break;
      }
      if (Date.now() >= deadline) {
        finishedStoppedForTime = true;
        break;
      }

      const results = await Promise.all(
        pending.map((row) =>
          backfillLimit(async () => {
            const card = finishedById.get(row.content_id);
            if (!card) return false;
            return collectTitleDetail(supabase!, card, snapshotDate);
          })
        )
      );
      const doneIds = pending.map((r) => r.content_id);
      const { error: markError } = await supabase
        .from("kakao_titles")
        .update({ finished_backfilled_at: new Date().toISOString() })
        .in("content_id", doneIds);
      if (markError) console.error("  백필 완료 표시 실패:", markError.message);
      finishedBackfilledCount += results.filter(Boolean).length;
      console.log(`  진행: ${finishedBackfilledCount}개 백필 완료...`);
    }

    console.log(
      `  완결작 백필 ${finishedBackfilledCount}개 처리${
        finishedStoppedForTime ? " (시간 마감으로 중단 - 내일 이어서 진행)" : ""
      }`
    );
  } else {
    console.log("  (드라이런 모드 - 완결작 백필 생략)");
  }

  console.log(`[4/4] 완료`);
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `\n완료: 연재중 ${titles.length}개(실패 ${detailFailures}건), 완결작 백필 ${finishedBackfilledCount}개, 소요시간 ${elapsedSec}초`
  );
}

main().catch((err) => {
  console.error("카카오 수집기 실행 중 오류:", err);
  process.exit(1);
});
