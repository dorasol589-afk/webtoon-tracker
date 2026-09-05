"use client";

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { SeriesSnapshotPoint } from "@/lib/queries";
import { aggregateSeries, getAnchorWeekday, toDeltaSeries } from "./seriesTrendUtils";
import { formatWon } from "@/lib/format";

const PRICE_PER_DOWNLOAD = 300;

export default function RevenueEstimateSection({
  data,
  seriesWeekday,
}: {
  data: SeriesSnapshotPoint[];
  seriesWeekday?: string | null;
}) {
  const anchorWeekday = useMemo(() => getAnchorWeekday(seriesWeekday), [seriesWeekday]);
  const weeklyRevenue = useMemo(() => {
    const weekly = aggregateSeries(data, "week", anchorWeekday);
    return toDeltaSeries(weekly).map((p) => ({ snapshot_date: p.snapshot_date, revenue: p.delta * PRICE_PER_DOWNLOAD }));
  }, [data, anchorWeekday]);

  if (weeklyRevenue.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        매출을 추정할 만큼 데이터가 쌓이지 않았습니다.
      </div>
    );
  }

  const latest = weeklyRevenue[weeklyRevenue.length - 1];

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-2 text-xs text-neutral-400">
        주간 다운로드 변동수 × {PRICE_PER_DOWNLOAD}원 (권당 단가 추정치이며 실제 판매가와 다를 수 있습니다)
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={weeklyRevenue} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
            <XAxis dataKey="snapshot_date" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} width={70} tickFormatter={(v) => formatWon(Number(v))} />
            <Tooltip formatter={(value) => [formatWon(Number(value)), "추정 매출액"]} />
            <Bar dataKey="revenue" fill="#d97706" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 text-right text-xs text-neutral-500">
        최근 주 추정 매출: <span className="font-medium text-neutral-800">{formatWon(latest.revenue)}</span>
      </div>
    </div>
  );
}
