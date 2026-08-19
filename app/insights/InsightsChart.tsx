"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartResult } from "@/lib/insights";

// 앱 전역에서 이미 쓰던 blue-600/emerald-600 축을 시작점으로, 카테고리 색은 고정 순서로만
// 배정한다(dataviz 스킬 validate_palette.js 통과 확인함 - CVD 인접쌍 하나가 6~8 경계라
// 범례+값 라벨을 항상 같이 노출해 보완).
const CATEGORICAL_PALETTE = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#e11d48",
  "#7c3aed",
  "#0891b2",
  "#ea580c",
  "#4f46e5",
];

function formatNumber(n: number): string {
  return n.toLocaleString("ko-KR");
}

export default function InsightsChart({ result }: { result: ChartResult }) {
  const { spec, data } = result;

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        조건에 맞는 데이터가 없습니다.
      </div>
    );
  }

  if (spec.chartType === "pie") {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div style={{ height: Math.max(360, data.length * 28) }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="45%"
                outerRadius="70%"
                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => [formatNumber(Number(value)), spec.metricLabel]} />
              <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  if (spec.barOrientation === "vertical") {
    // 일반적인 세로 막대(막대가 위로 서는 형태) - 라벨이 길면 겹치니 45도로 기울여서 표시
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-4" style={{ height: 420 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 20, bottom: 70, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12 }}
              angle={-40}
              textAnchor="end"
              interval={0}
              height={70}
            />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={formatNumber} width={60} />
            <Tooltip formatter={(value) => [formatNumber(Number(value)), spec.metricLabel]} />
            <Bar dataKey="value" fill={CATEGORICAL_PALETTE[0]} radius={[4, 4, 0, 0]} barSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // 기본값: 가로 막대(막대가 옆으로 눕는 형태) - 작품명처럼 긴 라벨이 많을 때 더 읽기 좋음
  const chartData = [...data].reverse();

  return (
    <div
      className="rounded-lg border border-neutral-200 bg-white p-4"
      style={{ height: chartData.length * 32 + 40 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 32, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={formatNumber} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={160} />
          <Tooltip formatter={(value) => [formatNumber(Number(value)), spec.metricLabel]} />
          <Bar dataKey="value" fill={CATEGORICAL_PALETTE[0]} radius={[0, 4, 4, 0]} barSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
