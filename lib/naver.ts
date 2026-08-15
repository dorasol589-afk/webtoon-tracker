// 네이버 웹툰 비공식 API 호출 공용 함수 (수집기 스크립트와 대시보드가 공유)

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// dailyPlus(매일+)는 요일별 목록과 거의 겹치지 않는 별도 카테고리라 반드시 함께 조회해야 함
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun", "dailyPlus"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface TitleListItem {
  titleId: number;
  titleName: string;
  author: string;
  thumbnailUrl: string;
  finish: boolean;
  rest: boolean;
  starScore: number;
  adult: boolean;
  new: boolean;
}

export type RankOrder = "user" | "star" | "view";

export interface RankInfo {
  weekday: string;
  rank: number;
}

export interface EpisodeListItem {
  no: number;
  subtitle: string;
  charge: boolean;
  serviceDateDescription: string;
}

export interface CommentStats {
  commentCount: number;
  postCount: number;
}

export type RealtimeRankCategory = "TOTAL" | "MALE" | "FEMALE";

export interface RealtimeRankItem {
  rank: number;
  titleId: number;
}

async function fetchJsonWithRetry<T>(
  url: string,
  init: RequestInit,
  retries = 2,
  timeoutMs = 10000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1) ** 2));
      }
    }
  }
  throw lastError;
}

async function fetchTextWithRetry(
  url: string,
  init: RequestInit,
  retries = 2,
  timeoutMs = 10000
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return await res.text();
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1) ** 2));
      }
    }
  }
  throw lastError;
}

/**
 * "993.8만" -> 9938000, "3.1천" -> 3100, "12345" -> 12345 형태의 네이버 축약 숫자 표기 파싱.
 * 형식이 안 맞으면(예: 로딩 중 빈 텍스트 등 일시적 응답) null을 반환 - 절대 0으로 조용히
 * 대체하면 안 됨(실제 감소로 오인되어 대시보드에 급락으로 표시되는 사고가 실제로 있었음).
 */
function parseKoreanCount(text: string): number | null {
  // 1000만 이상이면 "1,004만"처럼 천단위 콤마가 붙고, 1억 이상이면 "1억 196만"처럼 억+만이 같이 붙어 나옴
  let s = text.trim().replace(/,/g, "");
  if (!s || !/^[\d.\s억만천]+$/.test(s)) return null;

  let total = 0;
  const takeUnit = (unit: string, multiplier: number) => {
    const idx = s.indexOf(unit);
    if (idx === -1) return;
    const numPart = s.slice(0, idx).trim();
    if (numPart) {
      const value = parseFloat(numPart);
      if (!Number.isNaN(value)) total += value * multiplier;
    }
    s = s.slice(idx + 1).trim();
  };
  takeUnit("억", 1e8);
  takeUnit("만", 1e4);
  takeUnit("천", 1e3);
  if (s) {
    const value = parseFloat(s);
    if (Number.isNaN(value)) return null;
    total += value;
  }
  if (total === 0 && !/\d/.test(text)) return null;
  return Math.round(total);
}

function normalizeTitleForMatch(s: string): string {
  return s
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

export interface SeriesMatchResult {
  productNo: number;
  seriesTitle: string;
}

/**
 * comic.naver.com 작품명으로 네이버 시리즈(series.naver.com)에서 동일 작품을 검색해 찾는다.
 * 제목이 정확히 일치하는 경우만 반환하고(괄호/공백 제거 후 비교), 후보가 없거나 제목이
 * 다르면 null - 잘못된 작품에 다운로드수를 연결하는 사고를 막기 위해 애매한 매칭은 버림.
 * search.naver.com(통합검색)은 자동화된 요청을 봇으로 감지해 403으로 막아버리는 걸 확인해서
 * (series.naver.com은 그동안 다운로드수 조회로 매일 두드려도 문제 없었음),
 * 시리즈 사이트 자체의 검색 페이지(series.naver.com/search/search.series)를 대신 쓴다.
 * scripts/matchSeries.ts(전체 백필)와 scripts/collect.ts(신작 자동 매칭)가 공유해서 쓴다.
 */
export async function findMatchingSeriesProduct(titleName: string): Promise<SeriesMatchResult | null> {
  const q = encodeURIComponent(titleName);
  const html = await fetchTextWithRetry(`https://series.naver.com/search/search.series?t=comic&q=${q}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  const matches = [...html.matchAll(/comic\/detail\.series\?productNo=(\d+)/g)];
  if (matches.length === 0) return null;
  const productNo = parseInt(matches[0][1], 10);
  const pageHtml = await fetchTextWithRetry(`https://series.naver.com/comic/detail.series?productNo=${productNo}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  const titleMatch = pageHtml.match(/<title>([^<]*)<\/title>/);
  const seriesTitle = titleMatch ? titleMatch[1].trim() : "";
  if (normalizeTitleForMatch(seriesTitle) !== normalizeTitleForMatch(titleName)) return null;
  return { productNo, seriesTitle };
}

/** 네이버 시리즈 작품의 누적 다운로드수 (productNo는 series.naver.com/comic/detail.series?productNo=X 의 X) */
export async function fetchSeriesDownloadCount(productNo: number): Promise<number> {
  const html = await fetchTextWithRetry(
    `https://series.naver.com/comic/detail.series?productNo=${productNo}`,
    { headers: { "User-Agent": USER_AGENT } }
  );
  const match = html.match(/btn_download"><span>([^<]*)<\/span>/);
  if (!match) throw new Error(`다운로드수를 찾을 수 없음 (productNo=${productNo})`);
  const count = parseKoreanCount(match[1]);
  if (count === null) {
    throw new Error(`다운로드수 형식을 해석할 수 없음 (productNo=${productNo}, raw="${match[1]}")`);
  }
  return count;
}

/** 특정 요일에 연재중인 작품 목록 */
export async function fetchWeekdayTitles(week: Weekday): Promise<TitleListItem[]> {
  const data = await fetchJsonWithRetry<{ titleList: TitleListItem[] }>(
    `https://comic.naver.com/api/webtoon/titlelist/weekday?week=${week}`,
    { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } }
  );
  return data.titleList;
}

/** 월~일 전체를 조회해 titleId 기준 중복제거한 연재중 작품 목록 */
export async function fetchAllOngoingTitles(): Promise<TitleListItem[]> {
  const results = await Promise.all(WEEKDAYS.map((w) => fetchWeekdayTitles(w)));
  const byId = new Map<number, TitleListItem>();
  for (const list of results) {
    for (const title of list) {
      byId.set(title.titleId, title);
    }
  }
  return [...byId.values()];
}

interface FinishedTitleListResponse {
  titleList: TitleListItem[];
  pageInfo: { totalPages: number };
}

/** 완결 작품 목록 (페이지네이션, page당 45개) */
async function fetchFinishedTitlesPage(page: number): Promise<FinishedTitleListResponse> {
  return fetchJsonWithRetry<FinishedTitleListResponse>(
    `https://comic.naver.com/api/webtoon/titlelist/finished?page=${page}`,
    { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } }
  );
}

/** 완결 작품 전체 목록 (전체 페이지 순회, 약 3000여개) */
export async function fetchAllFinishedTitles(): Promise<TitleListItem[]> {
  const first = await fetchFinishedTitlesPage(1);
  const all = [...first.titleList];
  for (let page = 2; page <= first.pageInfo.totalPages; page++) {
    const { titleList } = await fetchFinishedTitlesPage(page);
    all.push(...titleList);
  }
  return all;
}

/**
 * 요일별 랭킹 (order=user: 인기순, order=star: 별점순, order=view: 조회순).
 * 응답이 {weekday: [...]} 형태의 맵으로 오며, 배열 내 순서가 곧 해당 요일 안에서의 순위.
 * 이 맵 API는 매일+(dailyPlus)를 포함하지 않으므로, week=dailyPlus&order=X를 별도로 불러
 * weekday="DAILY_PLUS"로 합쳐준다. 요일(또는 매일+) 그룹 안에서만 유효한 순위이며,
 * 네이버가 플랫폼 전체를 아우르는 단일 랭킹은 제공하지 않음.
 * 화/금처럼 이틀 이상 연재하는 작품은 요일마다 순위가 다르므로 title당 배열로 반환한다
 * (응답의 요일 키 순서가 월~일 순이 아니라서, title당 값 하나만 저장하면 나중 요일에 덮어써져
 * 먼저 처리된 요일의 순위가 사라지는 버그가 있었음).
 */
export async function fetchWeekdayRankMap(order: RankOrder): Promise<Map<number, RankInfo[]>> {
  const [mapData, dailyPlusData] = await Promise.all([
    fetchJsonWithRetry<{ titleListMap: Record<string, TitleListItem[]> }>(
      `https://comic.naver.com/api/webtoon/titlelist/weekday?order=${order}`,
      { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } }
    ),
    fetchJsonWithRetry<{ titleList: TitleListItem[] }>(
      `https://comic.naver.com/api/webtoon/titlelist/weekday?week=dailyPlus&order=${order}`,
      { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } }
    ),
  ]);
  const result = new Map<number, RankInfo[]>();
  const push = (titleId: number, info: RankInfo) => {
    const list = result.get(titleId);
    if (list) list.push(info);
    else result.set(titleId, [info]);
  };
  for (const [weekday, titles] of Object.entries(mapData.titleListMap)) {
    titles.forEach((t, i) => {
      push(t.titleId, { weekday, rank: i + 1 });
    });
  }
  dailyPlusData.titleList.forEach((t, i) => {
    push(t.titleId, { weekday: "DAILY_PLUS", rank: i + 1 });
  });
  return result;
}

interface RealtimeRankingResponse {
  totalRankingTitleList: { rank: number; titleId: number }[];
  maleRankingTitleList: { rank: number; titleId: number }[];
  femaleRankingTitleList: { rank: number; titleId: number }[];
}

export type RealtimeRankTabType = "DEFAULT" | "NEW";

/**
 * 네이버 실시간 랭킹 - 요일 구분 없는 진짜 플랫폼 전체 순위 (전체/남성/여성).
 * rankTabType=DEFAULT는 실시간 인기랭킹, NEW는 실시간 신작랭킹.
 * 다만 위젯 특성상 각 카테고리 TOP 5까지만 제공됨 (페이지네이션 파라미터 없음, 확인 완료).
 */
export async function fetchRealtimeRanking(
  rankTabType: RealtimeRankTabType = "DEFAULT"
): Promise<Record<RealtimeRankCategory, RealtimeRankItem[]>> {
  const data = await fetchJsonWithRetry<RealtimeRankingResponse>(
    `https://comic.naver.com/api/realtime/ranking/list?rankTabType=${rankTabType}`,
    { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } }
  );
  return {
    TOTAL: data.totalRankingTitleList.map((t) => ({ rank: t.rank, titleId: t.titleId })),
    MALE: data.maleRankingTitleList.map((t) => ({ rank: t.rank, titleId: t.titleId })),
    FEMALE: data.femaleRankingTitleList.map((t) => ({ rank: t.rank, titleId: t.titleId })),
  };
}

interface ArticleListResponse {
  totalCount: number;
  articleList: EpisodeListItem[];
}

/** 특정 작품의 회차 목록 전체 (페이지네이션 처리, 최신순으로 반환됨) */
export async function fetchAllEpisodes(titleId: number): Promise<EpisodeListItem[]> {
  const first = await fetchJsonWithRetry<ArticleListResponse>(
    `https://comic.naver.com/api/article/list?titleId=${titleId}&page=1`,
    { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } }
  );
  const episodes = [...first.articleList];
  const pageSize = first.articleList.length || 20;
  const totalPages = Math.ceil(first.totalCount / pageSize);

  for (let page = 2; page <= totalPages; page++) {
    const data = await fetchJsonWithRetry<ArticleListResponse>(
      `https://comic.naver.com/api/article/list?titleId=${titleId}&page=${page}`,
      { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } }
    );
    episodes.push(...data.articleList);
  }
  return episodes;
}

interface CommentApiResponse {
  status: string;
  result?: {
    page?: {
      postCount?: number;
      activePostCount?: number;
    };
  };
}

/** 회차별 댓글수 조회 */
export async function fetchCommentStats(titleId: number, no: number): Promise<CommentStats> {
  const url = `https://comic.naver.com/comment/api/community/v1/page/webtoon_${titleId}_${no}/top-recent-posts?topCount=0&recentTopCount=0&pinRepresentation=distinct`;
  const data = await fetchJsonWithRetry<CommentApiResponse>(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "*/*",
      Referer: `https://comic.naver.com/webtoon/detail?titleId=${titleId}&no=${no}`,
      "service-ticket-id": "comic_webtoon",
      "service-type": "KW",
      language: "KOREAN",
    },
  });
  return {
    commentCount: data.result?.page?.activePostCount ?? 0,
    postCount: data.result?.page?.postCount ?? 0,
  };
}

/** 회차 no의 댓글 페이지가 존재하는지(=해당 화가 실제로 있는지) 확인. 404는 명확히 "없음"으로 취급하고, 그 외 오류는 재시도 후에도 실패하면 던짐 */
async function commentPageExists(titleId: number, no: number, retries = 2): Promise<boolean> {
  const url = `https://comic.naver.com/comment/api/community/v1/page/webtoon_${titleId}_${no}/top-recent-posts?topCount=0&recentTopCount=0&pinRepresentation=distinct`;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "*/*",
          Referer: `https://comic.naver.com/webtoon/detail?titleId=${titleId}&no=${no}`,
          "service-ticket-id": "comic_webtoon",
          "service-type": "KW",
          language: "KOREAN",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 404) return false;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return true;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * (attempt + 1) ** 2));
    }
  }
  throw lastError;
}

export interface TitleInfo {
  writers: string[];
  painters: string[];
  originAuthors: string[];
  weekdays: string[];
  genres: string[];
  keywords: string[];
  ageRating: string;
}

interface ArticleListInfoFullResponse {
  communityArtists?: { name: string; artistTypeList: string[] }[];
  publishDayOfWeekList?: string[];
  curationTagList?: { tagName: string; curationType: string }[];
  age?: { type: string; description?: string };
}

/** 작품 상세(글/그림/원작 작가, 연재요일, 장르/키워드 태그) - 매일 수집기와 단건 엑셀 내보내기가 공유 */
export async function fetchTitleInfo(titleId: number): Promise<TitleInfo> {
  const data = await fetchJsonWithRetry<ArticleListInfoFullResponse>(
    `https://comic.naver.com/api/article/list/info?titleId=${titleId}`,
    { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } }
  );
  const writers: string[] = [];
  const painters: string[] = [];
  const originAuthors: string[] = [];
  for (const a of data.communityArtists ?? []) {
    if (a.artistTypeList.includes("ARTIST_WRITER")) writers.push(a.name);
    if (a.artistTypeList.includes("ARTIST_PAINTER")) painters.push(a.name);
    if (a.artistTypeList.some((t) => t.includes("ORIGIN"))) originAuthors.push(a.name);
  }
  const genres: string[] = [];
  const keywords: string[] = [];
  for (const tag of data.curationTagList ?? []) {
    if (tag.curationType.startsWith("GENRE_")) genres.push(tag.tagName);
    else if (tag.curationType === "CUSTOM_TAG") keywords.push(tag.tagName);
  }
  const ageRating = data.age?.description || "전체이용가";
  return {
    writers,
    painters,
    originAuthors,
    weekdays: data.publishDayOfWeekList ?? [],
    genres,
    keywords,
    ageRating,
  };
}

/**
 * 성인 작품은 회차 목록 API(article/list)가 로그인 없이는 401(LOGIN)로 막혀있다 (확인 완료).
 * 다만 댓글 API는 로그인 없이도 열려있고, 존재하지 않는 화는 404를 반환하므로
 * 이를 이용해 이진탐색으로 마지막 화 번호를 찾아 회차 목록을 대체한다.
 */
export async function findLastEpisodeNoViaComments(titleId: number): Promise<number> {
  const MAX_PROBE = 3000;
  if (!(await commentPageExists(titleId, 1))) return 0;

  let lo = 1;
  let hi = 2;
  while (hi <= MAX_PROBE && (await commentPageExists(titleId, hi))) {
    lo = hi;
    hi *= 2;
  }
  if (hi > MAX_PROBE) hi = MAX_PROBE;

  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (await commentPageExists(titleId, mid)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}
