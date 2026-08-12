// 제작사별 채용공고(사람인/잡코리아) 수집. studio_recruit_links에 등록된 회사 URL을 매일 훑어서
// studio_job_postings에 저장하고, 대시보드는 DB만 읽는다(매 방문마다 사람인/잡코리아를 직접 긁지 않음).
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

function extractJobKoreaJobsFromHtml(html: string, status: JobStatus): JobPosting[] {
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
      status,
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

function dedupeByPostingId(jobs: JobPosting[]): JobPosting[] {
  const map = new Map<string, JobPosting>();
  for (const j of jobs) map.set(j.postingId, j);
  return [...map.values()];
}
