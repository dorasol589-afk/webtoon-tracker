import { getTagStats } from "@/lib/queries";
import TagLaunchTrendChart from "@/app/TagLaunchTrendChart";
import TagMetricTrendChart from "@/app/TagMetricTrendChart";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const [genreStats, keywordStats] = await Promise.all([
    getTagStats("GENRE", 40),
    getTagStats("KEYWORD", 500),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">통계</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-neutral-500">장르별 런칭 추이</h2>
          <TagLaunchTrendChart tagType="GENRE" options={genreStats} />
        </section>
        <section>
          <h2 className="mb-3 text-sm font-semibold text-neutral-500">키워드별 런칭 추이</h2>
          <TagLaunchTrendChart tagType="KEYWORD" options={keywordStats} />
        </section>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-neutral-500">장르별 다운로드 추이</h2>
          <TagMetricTrendChart tagType="GENRE" options={genreStats} mode="download" />
        </section>
        <section>
          <h2 className="mb-3 text-sm font-semibold text-neutral-500">장르별 매출액 추정 추이</h2>
          <TagMetricTrendChart tagType="GENRE" options={genreStats} mode="revenue" />
        </section>
      </div>
    </div>
  );
}
