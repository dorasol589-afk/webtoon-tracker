// 자연어 요청("2026.05~07 런칭된 판타지 신작을 다운로드수대로 그래프로")을 그래프 사양으로
// 해석하는 레이어. Claude API로 자연어를 구조화하고, 실제 데이터는 export_titles_data_unified를
// 재사용해 조회한다(엑셀 내보내기와 같은 데이터 소스 - 필드가 이미 검증돼 있음).
import { getExportTitlesDataUnified, getTagStats, getTitlesByStudio, type ExportTitleRowUnified } from "./queries";

export interface ChartSpec {
  chartType: "bar" | "pie";
  // bar 전용: horizontal(막대가 옆으로, 라벨 긴 경우 기본값) / vertical(막대가 위로 서는 일반적인 세로 막대)
  barOrientation: "horizontal" | "vertical";
  title: string;
  platform: "all" | "naver" | "kakao";
  dateFrom: string | null;
  dateTo: string | null;
  genre: string | null;
  status: "all" | "ongoing" | "finished" | "hiatus" | "new";
  metric: "download_count" | "total_comment_count" | "view_count" | "like_count" | "star_score" | "count";
  metricLabel: string;
  sortDirection: "desc" | "asc";
  limit: number;
  groupBy: "title" | "genre" | "studio" | "weekday" | "launch_month" | null;
  exclude: string[] | null;
}

export interface ChartDataPoint {
  name: string;
  value: number;
}

export interface ChartResult {
  spec: ChartSpec;
  data: ChartDataPoint[];
  matchedCount: number;
}

const TOOL_NAME = "render_chart";

const SYSTEM_PROMPT = `당신은 웹툰(네이버웹툰/카카오웹툰) 통계 대시보드의 자연어 요청을 그래프 사양으로 변환하는 도우미입니다.
사용자가 한국어로 "~기간에 런칭된 ~장르를 ~기준으로 그래프 그려줘" 같은 요청을 하면, render_chart 도구를 호출해 정확한 사양을 반환하세요.

데이터 필드 설명:
- platform: naver(네이버웹툰) / kakao(카카오웹툰) / all(둘 다). 언급 없으면 all.
- genre: 장르 필터. 네이버 장르는 로맨스/판타지/액션/드라마/무협·사극/스릴러/개그/감성/스포츠/일상 중 하나. 카카오는 자유 텍스트 장르. 언급 없으면 null.
- dateFrom/dateTo: 런칭일 범위. "YYYY-MM-DD" 형식. 사용자가 "2026.05.01.~2026.07.31." 같은 식으로 쓰면 그대로 변환. 기간 언급 없으면 둘 다 null.
- status: ongoing(연재중) / finished(완결) / hiatus(휴재) / new(신작) / all. 언급 없으면 all.
- metric: download_count(다운로드수, 네이버 전용) / total_comment_count(누적 댓글수, 네이버 전용) / view_count(조회수, 카카오 전용) / like_count(좋아요수, 카카오 전용) / star_score(별점, 둘 다) / count(작품 개수 - "작품 수", "몇 개" 처럼 수치가 아니라 개수를 물을 때). 요청에서 가장 가까운 지표를 고르세요. platform이 kakao인데 다운로드수/댓글수를 요청하면 카카오에 없는 지표이니 조회수(view_count)로 대체하세요.
- sortDirection: desc(내림차순, "많은 순") / asc(오름차순, "적은 순"). 보통 desc.
- limit: 표시할 항목 수. 명시 없으면 개별 작품 랭킹은 15, 그룹별 집계는 10.
- groupBy: null(개별 작품별 랭킹, 예: "다운로드수 많은 순으로") / genre(장르별 합계) / studio(제작사별 합계) / weekday(요일별 합계, 네이버 전용) / launch_month(월별 합계). "장르별 합계/비율/분포"처럼 카테고리로 묶어달라는 요청일 때만 null이 아닌 값을 쓰세요.
- chartType: bar(막대, 기본값 - 랭킹/비교에 적합) / pie(파이, 전체 대비 비율/구성비를 물을 때만 - 예: "장르별 비율", "구성비"). 랭킹이면 무조건 bar.
- barOrientation: chartType이 bar일 때만 의미 있음. horizontal(막대가 옆으로 눕는 형태, 기본값) / vertical(막대가 위로 서는 일반적인 세로 막대그래프 - "세로 막대", "세로로" 라고 명시했을 때만 이 값을 씀). "가로로"라고 하면 horizontal.
- exclude: 결과에서 빼고 싶은 이름 목록 (예: "'개인' 빼고" → ["개인"], "무료 연재 제외" → ["무료 연재"]). 없으면 빈 배열.
- title: 그래프 제목 (한국어, 간결하게).

애매하면 사용자의 표현에 가장 가까운 값을 고르고, 절대 데이터에 없는 필드를 지어내지 마세요.`;

const TOOL_SCHEMA = {
  name: TOOL_NAME,
  description: "자연어 요청을 웹툰 통계 그래프 사양으로 변환한다",
  input_schema: {
    type: "object" as const,
    properties: {
      chartType: { type: "string", enum: ["bar", "pie"] },
      barOrientation: { type: "string", enum: ["horizontal", "vertical"] },
      title: { type: "string" },
      platform: { type: "string", enum: ["all", "naver", "kakao"] },
      dateFrom: { type: ["string", "null"] },
      dateTo: { type: ["string", "null"] },
      genre: { type: ["string", "null"] },
      status: { type: "string", enum: ["all", "ongoing", "finished", "hiatus", "new"] },
      metric: {
        type: "string",
        enum: ["download_count", "total_comment_count", "view_count", "like_count", "star_score", "count"],
      },
      metricLabel: { type: "string", description: "지표를 사람이 읽기 좋은 한국어 라벨로 (예: '다운로드수')" },
      sortDirection: { type: "string", enum: ["desc", "asc"] },
      limit: { type: "number" },
      groupBy: { type: ["string", "null"], enum: ["title", "genre", "studio", "weekday", "launch_month", null] },
      exclude: { type: "array", items: { type: "string" } },
    },
    required: [
      "chartType",
      "barOrientation",
      "title",
      "platform",
      "dateFrom",
      "dateTo",
      "genre",
      "status",
      "metric",
      "metricLabel",
      "sortDirection",
      "limit",
      "groupBy",
      "exclude",
    ],
  },
};

async function interpretChartRequestAI(query: string): Promise<ChartSpec> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: query }],
      tools: [TOOL_SCHEMA],
      tool_choice: { type: "tool", name: TOOL_NAME },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API 호출 실패 (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  const toolUse = (json.content ?? []).find((b: { type: string }) => b.type === "tool_use");
  if (!toolUse) throw new Error("Claude가 그래프 사양을 반환하지 않았습니다.");

  const input = toolUse.input as ChartSpec;
  return {
    ...input,
    limit: Math.min(Math.max(Number(input.limit) || 15, 1), 30),
    exclude: Array.isArray(input.exclude) && input.exclude.length > 0 ? input.exclude : null,
    barOrientation: input.barOrientation === "vertical" ? "vertical" : "horizontal",
  };
}

const GENRE_VOCAB = ["로맨스", "판타지", "액션", "드라마", "무협/사극", "무협", "사극", "스릴러", "개그", "감성", "스포츠", "일상"];

// 날짜 하나를 뽑는다: "2026.05.01.", "2026-05-01", "2026년 5월 1일" 전부 대응
const DATE_RE = /(\d{4})[.\-년]\s?(\d{1,2})[.\-월]\s?(\d{1,2})[.일]?/g;

function extractDateRange(query: string): { from: string | null; to: string | null } {
  const matches = [...query.matchAll(DATE_RE)];
  if (matches.length === 0) return { from: null, to: null };
  const toDate = (m: RegExpMatchArray) =>
    `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  if (matches.length === 1) return { from: toDate(matches[0]), to: null };
  return { from: toDate(matches[0]), to: toDate(matches[matches.length - 1]) };
}

/**
 * 무료 키워드 규칙 기반 파서. AI(Claude API) 없이 정규식/키워드 매칭만으로 자연어 요청을
 * 그래프 사양으로 바꾼다. 정해둔 패턴(장르명, 날짜, "다운로드순" 등) 안에서는 잘 동작하지만
 * 그 밖의 자유로운 표현은 놓칠 수 있음 - interpretChartRequestAI보다 정확도는 낮은 트레이드오프.
 */
function interpretChartRequestRuleBased(query: string): ChartSpec {
  const q = query.trim();

  const platform: ChartSpec["platform"] = q.includes("카카오") ? "kakao" : q.includes("네이버") ? "naver" : "all";

  const { from: dateFrom, to: dateTo } = extractDateRange(q);

  const genre = GENRE_VOCAB.find((g) => q.includes(g)) ?? null;

  const status: ChartSpec["status"] = q.includes("완결")
    ? "finished"
    : q.includes("휴재")
      ? "hiatus"
      : q.includes("신작")
        ? "new"
        : q.includes("연재중") || q.includes("연재")
          ? "ongoing"
          : "all";

  let metric: ChartSpec["metric"];
  let metricLabel: string;
  if (q.includes("작품 수") || q.includes("작품수") || q.includes("개수") || q.includes("타이틀 수")) {
    metric = "count";
    metricLabel = "작품 수";
  } else if (q.includes("좋아요")) {
    metric = "like_count";
    metricLabel = "좋아요수";
  } else if (q.includes("조회수") || q.includes("조회 수")) {
    metric = "view_count";
    metricLabel = "조회수";
  } else if (q.includes("댓글")) {
    metric = "total_comment_count";
    metricLabel = "누적 댓글수";
  } else if (q.includes("별점") || q.includes("평점")) {
    metric = "star_score";
    metricLabel = "별점";
  } else if (platform === "kakao") {
    metric = "view_count";
    metricLabel = "조회수";
  } else {
    metric = "download_count";
    metricLabel = "다운로드수";
  }

  const sortDirection: ChartSpec["sortDirection"] =
    q.includes("적은") || q.includes("낮은") || q.includes("오름차순") ? "asc" : "desc";

  const groupBy: ChartSpec["groupBy"] = q.includes("장르별")
    ? "genre"
    : q.includes("제작사별") || q.includes("스튜디오별")
      ? "studio"
      : q.includes("요일별")
        ? "weekday"
        : q.includes("월별")
          ? "launch_month"
          : null;

  const chartType: ChartSpec["chartType"] =
    q.includes("비율") || q.includes("비중") || q.includes("구성비") || q.includes("파이") ? "pie" : "bar";

  const barOrientation: ChartSpec["barOrientation"] = q.includes("세로") ? "vertical" : "horizontal";

  const limitMatch = q.match(/상위\s?(\d+)|top\s?(\d+)|(\d+)\s?개/i);
  const limit = limitMatch ? Number(limitMatch[1] ?? limitMatch[2] ?? limitMatch[3]) : groupBy ? 10 : 15;

  // "'개인' 빼고", "개인 제외하고" 처럼 결과에서 뺄 이름을 찾는다. 따옴표로 감싼 표현을 우선 보고,
  // 없으면 제외 동사 바로 앞 단어를 후보로 삼는다.
  const exclude: string[] = [];
  const quotedExcludeRe = /['"“”‘’]([^'"“”‘’]+)['"“”‘’]\s*(?:은|는|을|를)?\s*(?:빼고|제외|제외하고|빼줘|빼주세요)/g;
  for (const m of q.matchAll(quotedExcludeRe)) exclude.push(m[1]);
  if (exclude.length === 0) {
    const plainExcludeRe = /([가-힣A-Za-z0-9]+)\s*(?:은|는|을|를)?\s*(?:빼고|제외하고|제외|빼줘|빼주세요)/g;
    for (const m of q.matchAll(plainExcludeRe)) exclude.push(m[1]);
  }

  const titleParts = [
    dateFrom || dateTo ? `${dateFrom ?? ""}~${dateTo ?? ""}` : null,
    genre,
    platform !== "all" ? (platform === "kakao" ? "카카오웹툰" : "네이버웹툰") : null,
    groupBy ? "그룹별" : null,
    metricLabel,
    sortDirection === "asc" ? "낮은 순" : "높은 순",
    exclude.length > 0 ? `(${exclude.join(", ")} 제외)` : null,
  ].filter(Boolean);

  return {
    chartType,
    barOrientation,
    title: titleParts.join(" "),
    platform,
    dateFrom,
    dateTo,
    genre,
    status,
    metric,
    metricLabel,
    sortDirection,
    limit: Math.min(Math.max(limit, 1), 30),
    exclude: exclude.length > 0 ? exclude : null,
    groupBy,
  };
}

/** ANTHROPIC_API_KEY가 있으면 AI로, 없으면 무료 키워드 규칙 기반으로 자동 전환 */
export async function interpretChartRequest(query: string): Promise<ChartSpec> {
  if (process.env.ANTHROPIC_API_KEY) return interpretChartRequestAI(query);
  return interpretChartRequestRuleBased(query);
}

function normalizeForMatch(s: string): string {
  return s.replace(/[\s/·]/g, "").toLowerCase();
}

function metricValue(row: ExportTitleRowUnified, metric: ChartSpec["metric"]): number | null {
  if (metric === "count") return 1; // 작품 하나당 1로 세서, groupBy로 합산하면 개수가 됨
  const v = row[metric];
  return typeof v === "number" ? v : null;
}

function groupKey(row: ExportTitleRowUnified, groupBy: ChartSpec["groupBy"]): string | null {
  switch (groupBy) {
    case "genre":
      return row.genre || null;
    case "studio":
      return row.studio_name || null;
    case "weekday":
      return row.weekday || null;
    case "launch_month":
      return row.launch_date ? row.launch_date.slice(0, 7) : null;
    default:
      return row.title_name;
  }
}

// "네이버 장르별 작품 수" 같은 요청은 export_titles_data_unified(댓글/다운로드까지 다 조인하는
// 무거운 쿼리)를 쓸 필요가 없다 - 기존 홈페이지 장르 통계에 쓰던 가벼운 tag_stats RPC로 충분하고,
// 실제로 무거운 쪽은 날짜 범위 없이 전체를 훑을 때 anon 롤 statement_timeout에 자주 걸렸다(확인함).
function canUseFastGenreCount(spec: ChartSpec): boolean {
  return (
    spec.metric === "count" &&
    spec.groupBy === "genre" &&
    spec.platform !== "kakao" &&
    !spec.genre &&
    !spec.dateFrom &&
    !spec.dateTo &&
    (spec.status === "all" || spec.status === "ongoing")
  );
}

// "제작사별 다운로드수/조회수" 요청도 마찬가지 이유로 무겁다 - 제작사 탭에서 이미 쓰던
// getTitlesByStudio()(현재 누적 기준, 작품당 최신 스냅샷만 조인)로 충분히 빠르게 계산된다.
// 날짜범위/장르 필터나 완결·연재중 구분이 걸린 요청은 이 함수가 지원 못 해서 무거운 경로로 내려간다.
function canUseFastStudioTotal(spec: ChartSpec): boolean {
  return (
    spec.groupBy === "studio" &&
    (spec.metric === "download_count" || spec.metric === "view_count") &&
    !spec.genre &&
    !spec.dateFrom &&
    !spec.dateTo &&
    spec.status === "all"
  );
}

function applyExclude(points: ChartDataPoint[], exclude: string[] | null): ChartDataPoint[] {
  if (!exclude || exclude.length === 0) return points;
  const excludeNormalized = exclude.map(normalizeForMatch);
  return points.filter((p) => !excludeNormalized.some((ex) => normalizeForMatch(p.name).includes(ex)));
}

export async function buildChartData(spec: ChartSpec): Promise<ChartResult> {
  if (canUseFastGenreCount(spec)) {
    const stats = await getTagStats("GENRE", 30);
    let points = applyExclude(
      stats.map((s) => ({ name: s.tag_name, value: s.title_count })),
      spec.exclude
    );
    points.sort((a, b) => (spec.sortDirection === "asc" ? a.value - b.value : b.value - a.value));
    const matchedCount = points.reduce((sum, p) => sum + p.value, 0);
    points = points.slice(0, spec.limit);
    return { spec, data: points, matchedCount };
  }

  if (canUseFastStudioTotal(spec)) {
    const groups = await getTitlesByStudio();
    let points = applyExclude(
      groups
        .map((g) => ({
          name: g.studioName,
          value: spec.metric === "download_count" ? g.totalDownloadCount : g.totalViewCount,
        }))
        .filter((p) => p.value > 0),
      spec.exclude
    );
    points.sort((a, b) => (spec.sortDirection === "asc" ? a.value - b.value : b.value - a.value));
    const matchedCount = points.length;
    points = points.slice(0, spec.limit);
    return { spec, data: points, matchedCount };
  }

  const rows = await getExportTitlesDataUnified({
    platform: spec.platform,
    status: spec.status,
    launchFrom: spec.dateFrom ?? undefined,
    launchTo: spec.dateTo ?? undefined,
    sortBy: "name",
  });

  const genreQuery = spec.genre ? normalizeForMatch(spec.genre) : null;
  const filtered = rows.filter((r) => {
    if (genreQuery && !normalizeForMatch(r.genre ?? "").includes(genreQuery)) return false;
    return metricValue(r, spec.metric) !== null;
  });

  let points: ChartDataPoint[];
  if (!spec.groupBy || spec.groupBy === "title") {
    points = filtered.map((r) => ({ name: r.title_name, value: metricValue(r, spec.metric)! }));
  } else {
    const sums = new Map<string, number>();
    for (const r of filtered) {
      const key = groupKey(r, spec.groupBy);
      if (!key) continue;
      sums.set(key, (sums.get(key) ?? 0) + metricValue(r, spec.metric)!);
    }
    points = [...sums.entries()].map(([name, value]) => ({ name, value }));
  }

  points = applyExclude(points, spec.exclude);
  points.sort((a, b) => (spec.sortDirection === "asc" ? a.value - b.value : b.value - a.value));
  points = points.slice(0, spec.limit);

  return { spec, data: points, matchedCount: filtered.length };
}
