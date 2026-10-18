import Link from "next/link";
import { getDownloadDeltaRanking, type DownloadDeltaPeriod } from "@/lib/queries";
import { formatWon } from "@/lib/format";

const PERIODS: { value: DownloadDeltaPeriod; label: string; hint: string }[] = [
  { value: "day", label: "전일 대비", hint: "하루 전" },
  { value: "week", label: "전주 대비", hint: "7일 전" },
  { value: "month", label: "전월 대비", hint: "30일 전" },
];

const PRICE_PER_DOWNLOAD = 300;

export default async function DownloadDeltaRanking({
  period,
  sortBy,
}: {
  period: DownloadDeltaPeriod;
  sortBy: "delta" | "pct";
}) {
  const rows = await getDownloadDeltaRanking(period, 50, sortBy);
  const current = PERIODS.find((p) => p.value === period)!;
  const latest = rows[0]?.latest_date;

  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-500">시리즈 다운로드 증가량 랭킹</h2>
        <div className="flex flex-wrap items-center gap-1">
          {([
            { value: "delta", label: "증가량순" },
            { value: "pct", label: "증가율순" },
          ] as const).map((s) => (
            <Link
              key={s.value}
              href={`/stats?dl=${period}&sort=${s.value}`}
              scroll={false}
              className={`rounded px-2.5 py-1 text-xs ${
                s.value === sortBy ? "bg-blue-600 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
              }`}
            >
              {s.label}
            </Link>
          ))}
          <span className="mx-1 text-neutral-300">|</span>
          {PERIODS.map((p) => (
            <Link
              key={p.value}
              href={`/stats?dl=${p.value}&sort=${sortBy}`}
              scroll={false}
              className={`rounded px-2.5 py-1 text-xs ${
                p.value === period ? "bg-neutral-800 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          비교할 수집 데이터가 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="w-10 px-3 py-2 text-center">순위</th>
                <th className="px-3 py-2">작품</th>
                <th className="px-3 py-2 text-right">현재 다운로드</th>
                <th className="px-3 py-2 text-right">{current.hint} 대비 증가</th>
                <th className="px-3 py-2 text-right">증가율</th>
                <th className="px-3 py-2 text-right">추정 매출</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.title_id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                  <td className="px-3 py-2 text-center text-neutral-400">{i + 1}</td>
                  <td className="px-3 py-2">
                    <Link href={`/webtoon/${r.title_id}`} className="flex items-center gap-2">
                      {r.thumbnail_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.thumbnail_url} alt="" width={28} height={36} loading="lazy" className="h-9 w-7 shrink-0 rounded object-cover" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-medium hover:underline">{r.title_name}</span>
                        <span className="block truncate text-xs text-neutral-400">
                          {r.studio_name ?? "제작사 미상"}
                          {r.is_finished && " · 완결"}
                          {r.is_partial && ` · 수집 시작(${r.base_date.slice(5)}) 이후`}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.download_count.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-rose-600">▲ {r.delta.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                    {r.delta_pct === null ? "-" : `${Number(r.delta_pct).toLocaleString()}%`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{formatWon(r.delta * PRICE_PER_DOWNLOAD)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-neutral-400">
        {latest ? `${latest} 기준. ` : ""}
        {sortBy === "pct" ? "증가율 큰 순(기준 다운로드 1만 미만 작품은 변동폭이 과장돼 제외, 상위 50개). " : "증가량 큰 순(상위 50개). "}기준일에 수집값이 없으면 그 이전의 가장 가까운 값과 비교하고, 수집을 시작한 지 얼마 안 된 작품은 첫 수집값부터
        계산합니다. 추정 매출은 증가량 × 300원입니다.
      </p>
    </section>
  );
}
