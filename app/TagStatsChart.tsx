"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TagStatRow } from "@/lib/queries";

export default function TagStatsChart({ data, color }: { data: TagStatRow[]; color: string }) {
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        데이터 없음
      </div>
    );
  }

  const chartData = [...data].reverse();

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4" style={{ height: chartData.length * 32 + 20 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
          <YAxis type="category" dataKey="tag_name" tick={{ fontSize: 12 }} width={80} />
          <Tooltip formatter={(value) => [Number(value).toLocaleString(), "작품 수"]} />
          <Bar dataKey="title_count" fill={color} radius={[0, 4, 4, 0]} barSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
