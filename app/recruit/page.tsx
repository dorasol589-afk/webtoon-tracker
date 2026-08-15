import { getActiveJobPostingsByStudio, getTrackedRecruitStudioNames } from "@/lib/queries";
import { hasAdminAccess } from "@/lib/supabase";
import RecruitSearch from "./RecruitSearch";

export const dynamic = "force-dynamic";

export default async function RecruitPage() {
  let groups: Awaited<ReturnType<typeof getActiveJobPostingsByStudio>> = [];
  let trackedStudios: string[] = [];
  let loadError = false;
  try {
    [groups, trackedStudios] = await Promise.all([getActiveJobPostingsByStudio(), getTrackedRecruitStudioNames()]);
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

      {!loadError && (
        <RecruitSearch groups={groups} trackedStudios={trackedStudios} readOnly={!hasAdminAccess()} />
      )}
    </div>
  );
}
