import { formatManwon } from "@/lib/format";

const WEEKDAY_KO: Record<string, string> = {
  MONDAY: "월",
  TUESDAY: "화",
  WEDNESDAY: "수",
  THURSDAY: "목",
  FRIDAY: "금",
  SATURDAY: "토",
  SUNDAY: "일",
};

/** 소설 원작 여부 배지 (article/list/info의 ARTIST_NOVEL_ORIGIN 크레딧으로 판별, titles.is_novel_origin) */
export function NovelOriginBadge() {
  return (
    <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
      소설
    </span>
  );
}

/** 네이버 작품 성과 요약 한 줄 (런칭일 + 연재요일/인기순위 + 다운로드수 + 총 댓글수) */
export function NaverPerfLine({
  launchDate,
  weekday,
  popularityRank,
  downloadCount,
  totalCommentCount,
}: {
  launchDate: string | null;
  weekday: string | null;
  popularityRank: number | null;
  downloadCount: number | null;
  totalCommentCount: number | null;
}) {
  const parts: string[] = [];
  if (launchDate) parts.push(`런칭 ${launchDate}`);
  if (weekday) {
    const dayLabel = `${WEEKDAY_KO[weekday] ?? weekday}${weekday === "DAILY_PLUS" ? "" : "요일"}`;
    parts.push(popularityRank !== null ? `${dayLabel} 인기 ${popularityRank}위` : dayLabel);
  }
  if (downloadCount !== null) parts.push(`다운 ${formatManwon(downloadCount)}`);
  if (totalCommentCount !== null) parts.push(`댓글 ${totalCommentCount.toLocaleString()}`);
  if (parts.length === 0) return null;
  return <div className="truncate text-xs text-neutral-400">{parts.join(" · ")}</div>;
}

/** 카카오 작품 성과 요약 한 줄 (런칭일 + 조회수만 - 인기순위/댓글수는 미제공) */
export function KakaoPerfLine({ launchDate, viewCount }: { launchDate: string | null; viewCount: number | null }) {
  const parts: string[] = [];
  if (launchDate) parts.push(`런칭 ${launchDate}`);
  if (viewCount !== null) parts.push(`조회 ${formatManwon(viewCount)}`);
  if (parts.length === 0) return null;
  return <div className="truncate text-xs text-neutral-400">{parts.join(" · ")}</div>;
}

/** 네이버 작품 성과 지표 - 랭킹 목록 행 오른쪽에 세로로 쌓아 보여주는 버전 (/titles 페이지와 동일한 스타일) */
export function NaverStatStack({
  starScore,
  weekday,
  popularityRank,
  downloadCount,
  totalCommentCount,
  launchDate,
}: {
  starScore: number | null;
  weekday: string | null;
  popularityRank: number | null;
  downloadCount: number | null;
  totalCommentCount: number | null;
  launchDate: string | null;
}) {
  return (
    <div className="shrink-0 text-right text-xs text-neutral-500">
      {starScore !== null && <div>★ {starScore.toFixed(2)}</div>}
      {weekday && (
        <div>
          {WEEKDAY_KO[weekday] ?? weekday}
          {weekday === "DAILY_PLUS" ? "" : "요일"}
          {popularityRank !== null ? ` ${popularityRank}위` : ""}
        </div>
      )}
      {downloadCount !== null && <div>다운 {formatManwon(downloadCount)}</div>}
      {totalCommentCount !== null && <div>댓글 {totalCommentCount.toLocaleString()}개</div>}
      {launchDate && <div className="text-neutral-400">런칭 {launchDate}</div>}
    </div>
  );
}

/** 카카오 버전 - 조회수 + 런칭일만 */
export function KakaoStatStack({ viewCount, launchDate }: { viewCount: number | null; launchDate: string | null }) {
  return (
    <div className="shrink-0 text-right text-xs text-neutral-500">
      {viewCount !== null && <div>조회 {formatManwon(viewCount)}</div>}
      {launchDate && <div className="text-neutral-400">런칭 {launchDate}</div>}
    </div>
  );
}
