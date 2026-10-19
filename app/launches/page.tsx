import { getTagStats } from "@/lib/queries";
import { getLaunchCohort, getLaunchRangeOptions, resolveLaunchRange } from "@/lib/launchCohort";
import LaunchExplorer from "./LaunchExplorer";

export const dynamic = "force-dynamic";

export default async function LaunchesPage({ searchParams }: { searchParams: Promise<{ range?: string; genre?: string }> }) {
  const { range, genre } = await searchParams;
  const resolved = resolveLaunchRange(range);
  const genreStats = await getTagStats("GENRE", 40, true);
  const genreTag = genre && genreStats.some((g) => g.tag_name === genre) ? genre : null;
  const cohort = await getLaunchCohort(resolved.from, resolved.to, genreTag);
  const options = getLaunchRangeOptions();

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">신작 성과 비교</h1>
      <p className="mb-4 text-sm text-neutral-500">
        런칭 후 1·2·3개월차(30·60·90일째) 성과를 같은 기간에 나온 다른 신작들과 비교합니다.
      </p>

      <form method="get" className="mb-5 flex flex-wrap items-center gap-2">
        <select
          name="range"
          defaultValue={resolved.value}
          className="rounded border border-neutral-300 bg-white px-2.5 py-1.5 text-sm"
          aria-label="런칭 기간"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          name="genre"
          defaultValue={genreTag ?? ""}
          className="rounded border border-neutral-300 bg-white px-2.5 py-1.5 text-sm"
          aria-label="장르"
        >
          <option value="">전체 장르</option>
          {genreStats.map((g) => (
            <option key={g.tag_name} value={g.tag_name}>
              {g.tag_name}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded bg-neutral-800 px-3 py-1.5 text-sm text-white hover:bg-neutral-700">
          적용
        </button>
        <span className="text-xs text-neutral-400">
          {resolved.from} ~ {resolved.to} 런칭
        </span>
      </form>

      <LaunchExplorer
        key={`${resolved.value}|${genreTag ?? ""}`}
        cohort={cohort}
        rangeLabel={`${resolved.label}${genreTag ? ` · ${genreTag}` : ""}`}
      />
    </div>
  );
}
