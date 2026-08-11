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

/** "993.8만" -> 9938000, "3.1천" -> 3100, "12345" -> 12345 형태의 네이버 축약 숫자 표기 파싱 */
function parseKoreanCount(text: string): number {
  const match = text.trim().match(/^([\d.]+)\s*(억|만|천)?$/);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2];
  const multiplier = unit === "억" ? 1e8 : unit === "만" ? 1e4 : unit === "천" ? 1e3 : 1;
  return Math.round(value * multiplier);
}

/** 네이버 시리즈 작품의 누적 다운로드수 (productNo는 series.naver.com/comic/detail.series?productNo=X 의 X) */
export async function fetchSeriesDownloadCount(productNo: number): Promise<number> {
  const html = await fetchTextWithRetry(
    `https://series.naver.com/comic/detail.series?productNo=${productNo}`,
    { headers: { "User-Agent": USER_AGENT } }
  );
  const match = html.match(/btn_download"><span>([^<]*)<\/span>/);
  if (!match) throw new Error(`다운로드수를 찾을 수 없음 (productNo=${productNo})`);
  return parseKoreanCount(match[1]);
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

/**
 * 요일별 랭킹 (order=user: 인기순, order=star: 별점순, order=view: 조회순).
 * 응답이 {weekday: [...]} 형태의 맵으로 오며, 배열 내 순서가 곧 해당 요일 안에서의 순위.
 * 요일 그룹 안에서만 유효한 순위이며, 네이버가 플랫폼 전체를 아우르는 단일 랭킹은 제공하지 않음.
 */
export async function fetchWeekdayRankMap(order: RankOrder): Promise<Map<number, RankInfo>> {
  const data = await fetchJsonWithRetry<{ titleListMap: Record<string, TitleListItem[]> }>(
    `https://comic.naver.com/api/webtoon/titlelist/weekday?order=${order}`,
    { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } }
  );
  const result = new Map<number, RankInfo>();
  for (const [weekday, titles] of Object.entries(data.titleListMap)) {
    titles.forEach((t, i) => {
      result.set(t.titleId, { weekday, rank: i + 1 });
    });
  }
  return result;
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
