import { getActiveJobPostingsByStudio, getTrackedRecruitStudioNames, getKeywordJobPostings } from "@/lib/queries";
import { hasAdminAccess } from "@/lib/supabase";
import RecruitSearch from "./RecruitSearch";
import KeywordJobList from "./KeywordJobList";

export const dynamic = "force-dynamic";

const RECRUIT_KEYWORDS = ["웹툰PD"];

export default async function RecruitPage() {
  let groups: Awaited<ReturnType<typeof getActiveJobPostingsByStudio>> = [];
  let trackedStudios: string[] = [];
  let keywordResults: { keyword: string; postings: Awaited<ReturnType<typeof getKeywordJobPostings>> }[] = [];
  let loadError = false;
  try {
    const [groupsResult, trackedStudiosResult, ...keywordPostingsResults] = await Promise.all([
      getActiveJobPostingsByStudio(),
      getTrackedRecruitStudioNames(),
      ...RECRUIT_KEYWORDS.map((k) => getKeywordJobPostings(k)),
    ]);
    groups = groupsResult;
    trackedStudios = trackedStudiosResult;
    keywordResults = RECRUIT_KEYWORDS.map((keyword, i) => ({ keyword, postings: keywordPostingsResults[i] }));
  } catch {
    loadError = true;
  }

  const totalCount = groups.reduce((sum, g) => sum + g.postings.length, 0);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">채용공고</h1>
      <p className="mb-6 text-sm text-neutral-400">
        {!loadError && `현재 진행중인 공고 ${totalCount.toLocaleString()}건 · 수집 중인 제작사 ${trackedStudios.length}곳`}
      </p>

      {loadError && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          Supabase 연결 설정이 필요합니다.
        </div>
      )}

      {!loadError &&
        keywordResults.map(({ keyword, postings }) => (
          <KeywordJobList key={keyword} keyword={keyword} postings={postings} readOnly={!hasAdminAccess()} />
        ))}

      {!loadError && (
        <>
          <h2 className="mb-3 text-base font-semibold">지정 제작사 공고</h2>
          <RecruitSearch groups={groups} trackedStudios={trackedStudios} readOnly={!hasAdminAccess()} />
        </>
      )}
    </div>
  );
}
