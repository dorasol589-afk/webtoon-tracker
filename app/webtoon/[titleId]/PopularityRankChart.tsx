"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { PopularityHistoryPoint } from "@/lib/queries";

export default function PopularityRankChart({ data }: { data: PopularityHistoryPoint[] }) {
  const withRank = data.filter((d) => d.popularity_rank !== null);
  if (withRank.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        아직 수집된 순위 데이터가 없습니다.
      </div>
    );
  }

  const ranks = withRank.map((d) => d.popularity_rank!);
  const best = Math.min(...ranks); // 화면에서 가장 위쪽(1위에 가까움)
  const worst = Math.max(...ranks);

  return (
    <div className="h-80 w-full rounded-lg border border-neutral-200 bg-white p-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
          <XAxis dataKey="snapshot_date" tick={{ fontSize: 12 }} />
          {/* 순위는 숫자가 작을수록 좋은 순위라, 축을 반전해서 위로 갈수록 좋은 순위가 되게 함 */}
          <YAxis
            dataKey="popularity_rank"
            reversed
            allowDecimals={false}
            domain={[best, worst]}
            tick={{ fontSize: 12 }}
            width={40}
            tickFormatter={(v) => `${v}위`}
          />
          <Tooltip
            formatter={(value) => [value == null ? "-" : `${value}위`, "인기순위"]}
            labelFormatter={(label) => label}
          />
          <Line
            type="monotone"
            dataKey="popularity_rank"
            stroke="#2563eb"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
