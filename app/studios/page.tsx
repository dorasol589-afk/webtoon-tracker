import { getTitlesByStudio } from "@/lib/queries";
import StudioSearch from "./StudioSearch";

export const dynamic = "force-dynamic";

export default async function StudiosPage() {
  let groups: Awaited<ReturnType<typeof getTitlesByStudio>> = [];
  let loadError = false;
  try {
    groups = await getTitlesByStudio();
  } catch {
    loadError = true;
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">제작사별 작품</h1>
      <p className="mb-6 text-sm text-neutral-400">
        {!loadError && `제작사 ${groups.length.toLocaleString()}곳`}
      </p>

      {loadError && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          Supabase 연결 설정이 필요합니다.
        </div>
      )}

      {!loadError && <StudioSearch groups={groups} />}
    </div>
  );
}
