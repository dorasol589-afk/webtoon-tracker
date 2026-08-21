// 제작사별 채용공고(사람인/잡코리아) 수집. studio_recruit_links에 등록된 회사 URL을 매일 훑어서
// studio_job_postings에 저장하고, 대시보드는 DB만 읽는다(매 방문마다 사람인/잡코리아를 직접 긁지 않음).
import pLimit from "p-limit";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type JobStatus = "ACTIVE" | "CLOSED";

export interface JobPosting {
  postingId: string;
  title: string;
  url: string;
  status: JobStatus;
  /** 사람인은 마감일 텍스트("~08.31(월)", "상시채용" 등), 잡코리아는 D-day/"마감 (~날짜)" 원문 그대로 */
  dday: string | null;
}

async function fetchTextWithRetry(url: string, retries = 2, timeoutMs = 10000): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: controller.signal });
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
 * 사람인 회사 채용공고 페이지(company-info/view-inner-recruit). "진행중" 섹션과
 * "마감된 공고" 섹션이 한 페이지에 같이 내려오며, id="company_info_recruit_info_close" 기준으로 나뉜다.
 * (마감 섹션은 페이지당 일부만 정적 HTML에 포함되고 나머지는 AJAX로 더 불러오는 구조라 전부는 아님)
 */
export async function fetchSaraminJobs(companyUrl: string): Promise<JobPosting[]> {
  const html = await fetchTextWithRetry(companyUrl);
  const closeMarkerIdx = html.indexOf('id="company_info_recruit_info_close"');
  const activeHtml = closeMarkerIdx === -1 ? html : html.slice(0, closeMarkerIdx);
  const closedHtml = closeMarkerIdx === -1 ? "" : html.slice(closeMarkerIdx);

  const parseHalf = (half: string, status: JobStatus): JobPosting[] => {
    const itemRe = /<div id="rec-(\d+)" class="list_item">([\s\S]*?)<div class="similar_recruit">/g;
    const out: JobPosting[] = [];
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(half)) !== null) {
      const [, postingId, body] = m;
      const titleMatch = body.match(/title="([^"]*)"/);
      const hrefMatch = body.match(/href="([^"]*)"/);
      const dateMatch = body.match(/<span class="date">([^<]*)<\/span>/);
      if (!titleMatch || !hrefMatch) continue;
      const href = hrefMatch[1].replace(/&amp;/g, "&");
      out.push({
        postingId,
        title: titleMatch[1],
        url: `https://www.saramin.co.kr${href}`,
        status,
        dday: dateMatch ? dateMatch[1] : null,
      });
    }
    return out;
  };

  const jobs = [...parseHalf(activeHtml, "ACTIVE"), ...parseHalf(closedHtml, "CLOSED")];
  return dedupeByPostingId(jobs);
}

// 회사에 따라 "진행중" URL(ChkDispType 기본값)이 실제로는 마감된 공고까지 섞어서 내려주는
// 경우가 있다(대원씨아이 등에서 실제 확인함 - 82건이 이 문제였음). 어느 섹션에서 가져왔는지보다
// day 텍스트 자체("D-N"/"D-day"는 진행중, "마감 (~날짜)"는 마감)가 더 믿을 만해서, 알아볼 수
// 있으면 그걸 우선하고 애매할 때만 섹션 기준 status로 폴백한다.
function statusFromDday(dday: string, fallback: JobStatus): JobStatus {
  if (dday.startsWith("마감")) return "CLOSED";
  if (dday.startsWith("D-")) return "ACTIVE";
  return fallback;
}

function extractJobKoreaJobsFromHtml(html: string, sectionStatus: JobStatus): JobPosting[] {
  const out: JobPosting[] = [];
  const re =
    /data-gno="(\d+)"[\s\S]{0,600}?href="([^"]*)"[\s\S]{0,600}?<dt class="tit">\s*([\s\S]*?)\s*<\/dt>[\s\S]{0,600}?<span class="day tahoma">([^<]*)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const [, postingId, hrefRaw, titleRaw, dday] = m;
    const href = hrefRaw.replace(/&amp;/g, "&");
    out.push({
      postingId,
      title: titleRaw.trim().replace(/\s+/g, " "),
      url: href.startsWith("http") ? href : `https://www.jobkorea.co.kr${href}`,
      status: statusFromDday(dday, sectionStatus),
      dday,
    });
  }
  return out;
}

/**
 * 잡코리아 회사 채용공고 페이지. 기본 URL은 "진행중"만 보여주고, 마감 공고는 같은 URL에
 * ChkDispType=2를 추가해야 별도로 내려온다(둘 다 최근 항목 위주 첫 페이지만 가져옴).
 * day 텍스트가 진행중이면 "D-N", 마감이면 "마감 (~날짜)"로 내려오는데, 혹시 이 패턴에서
 * 벗어나는 항목이 있으면 status를 "UNKNOWN"으로 표시해 호출측이 걸러낼 수 있게 한다.
 */
export async function fetchJobKoreaJobs(companyUrl: string): Promise<JobPosting[]> {
  const activeHtml = await fetchTextWithRetry(companyUrl);
  const activeJobs = extractJobKoreaJobsFromHtml(activeHtml, "ACTIVE");

  const closedUrl = new URL(companyUrl);
  closedUrl.searchParams.set("ChkDispType", "2");
  let closedJobs: JobPosting[] = [];
  try {
    const closedHtml = await fetchTextWithRetry(closedUrl.toString());
    closedJobs = extractJobKoreaJobsFromHtml(closedHtml, "CLOSED");
  } catch {
    // 마감 탭 조회 실패는 무시(진행중 공고는 이미 확보됨)
  }

  return dedupeByPostingId([...activeJobs, ...closedJobs]);
}

export interface KeywordJobPosting extends JobPosting {
  companyName: string;
}

/**
 * 사람인 키워드 검색 결과(company-info 페이지가 아니라 zf_user/search/recruit).
 * 회사 채용페이지와 마크업이 달라 별도 파서가 필요함. 검색 결과 자체가 마감 공고를 섞어
 * 보여주지 않는 걸 확인해서(모든 date가 "~ 날짜" 또는 "상시채용"/"채용시" 형태) status는 항상 ACTIVE로 둔다.
 * 사람인 검색은 키워드가 제목에 없어도 관련도로 걸리는 결과를 많이 섞어 보내는 걸 확인해서
 * (예: "수학 코칭 선생님"도 "웹툰PD" 검색에 나옴), 제목에 "웹툰"이 실제로 포함된 것만 호출측에서 걸러야 한다.
 */
export async function fetchSaraminKeywordJobs(keyword: string): Promise<KeywordJobPosting[]> {
  const url = `https://www.saramin.co.kr/zf_user/search/recruit?searchword=${encodeURIComponent(keyword)}`;
  const html = await fetchTextWithRetry(url);

  const starts = [...html.matchAll(/<div class="item_recruit" value="(\d+)"/g)];
  const out: KeywordJobPosting[] = [];
  for (let i = 0; i < starts.length; i++) {
    const postingId = starts[i][1];
    const start = starts[i].index!;
    const end = i + 1 < starts.length ? starts[i + 1].index! : html.length;
    const body = html.slice(start, end);
    const titleMatch = body.match(/<h2 class="job_tit">\s*<a[^>]*title="([^"]*)"/);
    const hrefMatch = body.match(/<h2 class="job_tit">\s*<a[^>]*href="([^"]*)"/);
    const dateMatch = body.match(/<span class="date">([^<]*)<\/span>/);
    const corpMatch = body.match(/<strong class="corp_name">\s*<a[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch || !hrefMatch) continue;
    const href = hrefMatch[1].replace(/&amp;/g, "&");
    out.push({
      postingId,
      title: titleMatch[1],
      url: href.startsWith("http") ? href : `https://www.saramin.co.kr${href}`,
      status: "ACTIVE",
      dday: dateMatch ? dateMatch[1].trim() : null,
      companyName: corpMatch ? corpMatch[1].trim() : "",
    });
  }
  return dedupeByPostingId(out) as KeywordJobPosting[];
}

/**
 * 잡코리아 공고 상세페이지(GI_Read/{id})에 SEO용으로 박혀있는
 * <script type="application/ld+json" data-sentry-component="JobPostingSchema">의 validThrough를
 * 읽어서 마감일을 구한다. 목록/카드 뷰에는 마감일이 안 나오지만 상세페이지에는 항상 있는 걸 확인함.
 * 이미 지난 날짜면(수집 텀 사이 마감된 경우) status를 CLOSED로 내려서 호출측이 걸러낼 수 있게 한다.
 */
async function fetchJobKoreaDeadline(postingId: string): Promise<{ dday: string; status: JobStatus } | null> {
  const html = await fetchTextWithRetry(`https://www.jobkorea.co.kr/Recruit/GI_Read/${postingId}`);
  const match = html.match(/"validThrough"\s*:\s*"([^"]+)"/);
  if (!match) return null;
  const target = new Date(match[1]);
  if (isNaN(target.getTime())) return null;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const targetStart = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const days = Math.round((targetStart.getTime() - todayStart.getTime()) / 86400000);
  if (days < 0) return { dday: "마감", status: "CLOSED" };
  return { dday: `D-${days}`, status: "ACTIVE" };
}

/**
 * 잡코리아 키워드 검색 결과(www.jobkorea.co.kr/Search/?stext=). 회사 채용페이지(GI_Read 목록이
 * 정적 HTML로 오는 구조)와 달리 검색 결과는 React로 렌더링된 카드 목록이라 마크업이 완전히 다르다.
 * 카드마다 data-sentry-component="CardJob"이 앞에 붙는 걸 확인해서 그 마커로 카드를 나누고,
 * 카드 안에서 첫 GI_Read 링크(공고 id)/Title 컴포넌트(제목)/회사명 스팬만 뽑는다.
 * 목록/카드 뷰 자체에는 마감일이 안 나오므로(회사 페이지와 달리 D-day 배지가 없음), 공고별로
 * 상세페이지를 한 번씩 더 불러서 fetchJobKoreaDeadline으로 마감일을 채운다(개별 요청 실패 시 그
 * 공고만 dday: null로 남기고 넘어감 - 검색 결과 자체를 버리지 않음).
 * 여기도 사람인과 마찬가지로 검색 자체가 관련도 기반이라 무관한 결과가 섞여 나오므로
 * 제목에 "웹툰"이 실제로 포함된 것만 호출측에서 걸러야 한다.
 */
export async function fetchJobKoreaKeywordJobs(keyword: string): Promise<KeywordJobPosting[]> {
  const url = `https://www.jobkorea.co.kr/Search/?stext=${encodeURIComponent(keyword)}`;
  const html = await fetchTextWithRetry(url);

  const cards = html.split('data-sentry-component="CardJob"').slice(1);
  const out: KeywordJobPosting[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    const idMatch = card.match(/GI_Read\/(\d+)/);
    const titleMatch = card.match(/data-sentry-component="Title"[^>]*><span[^>]*>([^<]*)<\/span>/);
    const companyMatch = card.match(/text-typo-b2-16">([^<]*)<\/span>/);
    if (!idMatch || !titleMatch) continue;
    const postingId = idMatch[1];
    if (seen.has(postingId)) continue;
    seen.add(postingId);
    out.push({
      postingId,
      title: titleMatch[1].trim(),
      url: `https://www.jobkorea.co.kr/Recruit/GI_Read/${postingId}`,
      status: "ACTIVE",
      dday: null,
      companyName: companyMatch ? companyMatch[1].trim() : "",
    });
  }

  const deadlineLimit = pLimit(5);
  await Promise.all(
    out.map((job) =>
      deadlineLimit(async () => {
        try {
          const deadline = await fetchJobKoreaDeadline(job.postingId);
          if (deadline) {
            job.dday = deadline.dday;
            job.status = deadline.status;
          }
        } catch {
          // 상세페이지 조회 실패는 그 공고만 dday: null로 남기고 무시(검색 결과 전체는 유지)
        }
      })
    )
  );

  return out;
}

/** dday 텍스트가 status와 어긋나는 잡코리아 공고를 골라낸다(수동 점검용) */
export function findAmbiguousJobKoreaPostings(
  jobs: (JobPosting & { studioName: string })[]
): (JobPosting & { studioName: string })[] {
  return jobs.filter((j) => {
    if (j.dday === null) return true;
    if (j.status === "ACTIVE") return !j.dday.startsWith("D-");
    return !j.dday.startsWith("마감");
  });
}

// 사람인/잡코리아 둘 다 마감일을 연장한 공고를 "진행중" 섹션과 "마감된 공고" 아카이브 섹션에
// 같은 posting_id로 중복 노출하는 경우가 있다(실제 확인함 - 문피아 "웹툰 PD" 공고가 마감일을
// 08.16→08.30으로 연장했는데도 마감 섹션에 옛날 dday로 된 사본이 남아있었음). 배열 순서만
// 믿고 마지막 값으로 덮어쓰면 마감 사본이 이겨서 멀쩡히 진행중인 공고가 마감으로 잘못 저장되니,
// 같은 posting_id가 양쪽에 다 있으면 ACTIVE가 항상 이기게 명시적으로 고른다.
function dedupeByPostingId(jobs: JobPosting[]): JobPosting[] {
  const map = new Map<string, JobPosting>();
  for (const j of jobs) {
    const existing = map.get(j.postingId);
    if (!existing || existing.status !== "ACTIVE") map.set(j.postingId, j);
  }
  return [...map.values()];
}
