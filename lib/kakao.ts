// 카카오웹툰 비공식 API 호출 공용 함수 (수집기 스크립트와 대시보드가 공유)

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const COMMON_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "application/json",
  Referer: "https://webtoon.kakao.com/",
  Origin: "https://webtoon.kakao.com",
};

export const KAKAO_WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type KakaoWeekday = (typeof KAKAO_WEEKDAYS)[number];

async function fetchJsonWithRetry<T>(url: string, retries = 2, timeoutMs = 10000): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: COMMON_HEADERS, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * (attempt + 1) ** 2));
    }
  }
  throw lastError;
}

async function fetchTextWithRetry(url: string, retries = 2, timeoutMs = 10000): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html", Referer: "https://webtoon.kakao.com/" },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * (attempt + 1) ** 2));
    }
  }
  throw lastError;
}

/**
 * "2,650.8만" -> 26508000, "3.1천" -> 3100 형태의 카카오 축약 숫자 표기 파싱.
 * lib/naver.ts의 parseKoreanCount와 동일 로직 - 형식이 안 맞으면 null 반환(0으로 조용히
 * 대체하면 실제 감소로 오인되어 대시보드에 급락으로 표시되는 사고가 날 수 있음).
 */
function parseKoreanCount(text: string): number | null {
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

export interface KakaoAuthor {
  name: string;
  type: string; // AUTHOR(글) | ILLUSTRATOR(그림) | PUBLISHER(제작사) 등
}

export interface KakaoCardContent {
  id: number;
  seoId: string;
  title: string;
  authors?: KakaoAuthor[];
  adult?: boolean;
  rest?: boolean; // 휴재중
  titleImageB?: string;
}

interface TimetableResponse {
  data: { cardGroups: { cards: { content: KakaoCardContent }[] }[] }[];
}

/** placement=timetable_{day} (요일 전체) 또는 timetable_completed (완결) 목록 조회 */
async function fetchTimetable(placement: string): Promise<KakaoCardContent[]> {
  const data = await fetchJsonWithRetry<TimetableResponse>(
    `https://gateway-kw.kakao.com/section/v2/timetables/days?placement=${placement}`
  );
  const section = data.data[0];
  if (!section) return [];
  return section.cardGroups.flatMap((g) => g.cards.map((c) => c.content));
}

/** 특정 요일에 연재중인 작품 전체 목록 (월~일) */
export async function fetchWeekdayTitles(day: KakaoWeekday): Promise<KakaoCardContent[]> {
  return fetchTimetable(`timetable_${day}`);
}

/** 월~일 전체를 조회해 id 기준 중복제거한 연재중 작품 목록 */
export async function fetchAllOngoingTitles(): Promise<KakaoCardContent[]> {
  const results = await Promise.all(KAKAO_WEEKDAYS.map((d) => fetchWeekdayTitles(d)));
  const byId = new Map<number, KakaoCardContent>();
  for (const list of results) {
    for (const title of list) byId.set(title.id, title);
  }
  return [...byId.values()];
}

/** 완결 작품 전체 목록 (한 번의 응답에 전부 포함됨, 페이지네이션 없음 - 확인 완료) */
export async function fetchFinishedTitles(): Promise<KakaoCardContent[]> {
  return fetchTimetable("timetable_completed");
}

/** 신작으로 분류된 작품 전체 목록 (사이트의 "신작" 탭과 동일한 카테고리, 페이지네이션 없음) */
export async function fetchNewTitles(): Promise<KakaoCardContent[]> {
  return fetchTimetable("timetable_new");
}

export interface KakaoTitleProfile {
  synopsis: string;
  writers: string[];
  painters: string[];
  originAuthors: string[]; // 원작 (ORIGINAL_STORY 타입)
  publishers: string[]; // 제작사/스튜디오 표기 (PUBLISHER 타입)
  seoKeywords: string[];
  isFinished: boolean;
  ageRating: string | null;
}

interface ProfileResponse {
  data: {
    synopsis?: string;
    authors?: KakaoAuthor[];
    seoKeywords?: string[];
    badges?: { title: string; type: string }[];
  };
}

/** 작품 상세(시놉시스, 글/그림/원작/제작사 작가, 키워드, 완결여부, 연령등급) */
export async function fetchTitleProfile(contentId: number): Promise<KakaoTitleProfile> {
  const res = await fetchJsonWithRetry<ProfileResponse>(
    `https://gateway-kw.kakao.com/decorator/v2/decorator/contents/${contentId}/profile`
  );
  const d = res.data;
  const writers: string[] = [];
  const painters: string[] = [];
  const originAuthors: string[] = [];
  const publishers: string[] = [];
  for (const a of d.authors ?? []) {
    if (a.type === "AUTHOR") writers.push(a.name);
    if (a.type === "ILLUSTRATOR") painters.push(a.name);
    if (a.type === "ORIGINAL_STORY") originAuthors.push(a.name);
    if (a.type === "PUBLISHER") publishers.push(a.name);
  }
  const badges = d.badges ?? [];
  const isFinished = badges.some((b) => b.type === "STATUS" && b.title === "COMPLETED");
  const ageBadge = badges.find((b) => b.type === "AGE_LIMIT");
  return {
    synopsis: d.synopsis ?? "",
    writers,
    painters,
    originAuthors,
    publishers,
    seoKeywords: d.seoKeywords ?? [],
    isFinished,
    ageRating: ageBadge ? (ageBadge.title === "0" ? "전체이용가" : `${ageBadge.title}세 이용가`) : null,
  };
}

export interface KakaoStats {
  viewCount: number | null;
  likeCount: number | null;
}

// webtoon.kakao.com 작품 홈 페이지는 gateway-kw API와 달리 요청이 몰리면 403(IP 차단)을 걸어버리는 걸
// 실제로 확인함(동시 8개 정도로만 돌려도 100건 안쪽에서 차단, 이후 몇 분간 단건 요청도 계속 403).
// 그래서 이 페이지에 대한 요청만 전역으로 직렬화 + 최소 간격을 둬서, 수집기가 몇 개 동시성으로
// 돌든 실제 웹 요청은 항상 느리게 하나씩만 나가게 강제한다.
const CONTENT_PAGE_MIN_INTERVAL_MS = 2000;
let contentPageLastFetchAt = 0;
let contentPageQueue: Promise<unknown> = Promise.resolve();

function scheduleContentPageFetch<T>(run: () => Promise<T>): Promise<T> {
  const scheduled = contentPageQueue.then(async () => {
    const wait = contentPageLastFetchAt + CONTENT_PAGE_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    contentPageLastFetchAt = Date.now();
    return run();
  });
  // 이번 요청이 실패해도 큐 자체는 계속 이어져야 하므로 에러를 삼킨 프라미스를 큐에 남김
  contentPageQueue = scheduled.catch(() => undefined);
  return scheduled;
}

/**
 * 작품 조회수/좋아요수는 별도 JSON API가 없고 작품 홈 페이지(SSR HTML)에 직접 렌더링되어 있어
 * 서버 렌더링된 HTML을 그대로 파싱해서 가져온다(lib/naver.ts의 시리즈 다운로드수 스크래핑과 동일 패턴).
 * 헤더 영역에 장르 -> 조회수(눈 아이콘) -> 좋아요수(따봉 아이콘) 순서로 <p> 3개가 연달아 나온다.
 * 형식이 안 맞으면(작품 정보가 없거나 페이지 구조가 바뀐 경우) null로 반환 - 0으로 조용히
 * 대체하지 않아야 급락 오인 사고를 막을 수 있음.
 */
export async function fetchViewsAndLikes(seoId: string, contentId: number): Promise<KakaoStats> {
  const url = `https://webtoon.kakao.com/content/${encodeURIComponent(seoId)}/${contentId}`;
  const html = await scheduleContentPageFetch(() => fetchTextWithRetry(url));
  const re =
    /<p class="whitespace-pre-wrap break-all break-words support-break-word s12-regular-white ml-2 opacity-75">([^<]+)<\/p>/g;
  const matches = [...html.matchAll(re)].map((m) => m[1]);
  // matches[0] = 장르, matches[1] = 조회수, matches[2] = 좋아요수
  if (matches.length < 3) return { viewCount: null, likeCount: null };
  return {
    viewCount: parseKoreanCount(matches[1]),
    likeCount: parseKoreanCount(matches[2]),
  };
}

export type KakaoUseType = "FREE" | "WAIT_FOR_FREE" | string;

export interface KakaoEpisodeListItem {
  episodeId: number;
  no: number;
  title: string;
  serialStartDateTime: string | null;
  useType: KakaoUseType;
}

interface EpisodeListResponse {
  data: {
    episodes: {
      id: number;
      no: number;
      title: string;
      serialStartDateTime?: string;
      useType: string;
    }[];
  };
}

/** 특정 작품의 회차 목록 전체 (페이지네이션, 최신순으로 반환됨) */
export async function fetchAllEpisodes(contentId: number): Promise<KakaoEpisodeListItem[]> {
  const pageSize = 50;
  const all: KakaoEpisodeListItem[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const res = await fetchJsonWithRetry<EpisodeListResponse>(
      `https://gateway-kw.kakao.com/episode/v2/views/content-home/contents/${contentId}/episodes?sort=-NO&offset=${offset}&limit=${pageSize}`
    );
    const episodes = res.data.episodes ?? [];
    all.push(
      ...episodes.map((e) => ({
        episodeId: e.id,
        no: e.no,
        title: e.title,
        serialStartDateTime: e.serialStartDateTime ?? null,
        useType: e.useType,
      }))
    );
    if (episodes.length < pageSize) break;
  }
  return all;
}

