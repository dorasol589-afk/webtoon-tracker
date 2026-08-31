// 나무위키에서 웹툰 연재 시작일을 찾는 공용 함수.
// 성인(19금) 작품은 네이버 회차 목록 API(article/list)가 로그인 없이는 401로 막혀있어
// 런칭일(회차1 서비스 날짜)을 알 방법이 없다 - 그 보완용으로 나무위키를 대신 참고한다.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchNamuPage(title: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`https://namu.wiki/w/${encodeURIComponent(title)}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} for namu.wiki/w/${title}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// 인포박스 "연재 기간" 항목의 시작일("2026. 05. 31. ~ 연재 중" 등)을 뽑는다. 정확한 태그
// 구조(Vue 스코프 클래스 등)에 기대지 않고, 라벨 텍스트 뒤 일정 구간 안에서 날짜 패턴만 찾는다
// - 사이트 개편으로 클래스명이 바뀌어도 라벨 텍스트 자체는 잘 안 바뀌기 때문.
function extractLaunchDate(html: string): string | null {
  const idx = html.indexOf("연재 기간");
  if (idx === -1) return null;
  const window = html.slice(idx, idx + 500);
  const m = window.match(/(\d{4})\.\s*(\d{2})\.\s*(\d{2})\./);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * 작품명으로 나무위키에서 연재 시작일을 찾는다. 원작 웹소설 등과 제목이 겹쳐 그냥
 * "{title}" 문서가 동음이의 안내 페이지인 경우가 많아, 먼저 원제목으로 시도하고
 * 안 되면 나무위키의 흔한 소명 규칙인 "{title}(웹툰)"으로 재시도한다.
 * 정보를 못 찾으면(문서 없음/양식이 다름) null - 절대 추측해서 채우지 않는다.
 */
export async function findAdultTitleLaunchDate(titleName: string): Promise<string | null> {
  const plain = await fetchNamuPage(titleName);
  const plainDate = plain ? extractLaunchDate(plain) : null;
  if (plainDate) return plainDate;

  const disambiguated = await fetchNamuPage(`${titleName}(웹툰)`);
  return disambiguated ? extractLaunchDate(disambiguated) : null;
}
