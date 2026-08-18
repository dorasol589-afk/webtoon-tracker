"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { KakaoStatPoint } from "@/lib/queries";

function MiniChart({
  data,
  dataKey,
  label,
  color,
}: {
  data: KakaoStatPoint[];
  dataKey: "view_count" | "like_count";
  label: string;
  color: string;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium text-neutral-500">{label}</h3>
      <div className="h-48 w-full rounded-lg border border-neutral-200 bg-white p-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
            <XAxis dataKey="snapshot_date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={50} tickFormatter={(v) => `${Math.round(v / 10000)}만`} />
            <Tooltip formatter={(value) => [Number(value).toLocaleString(), label]} />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function KakaoStatChart({ data }: { data: KakaoStatPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        아직 수집된 데이터가 없습니다.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <MiniChart data={data} dataKey="view_count" label="조회수 추이" color="#2563eb" />
      <MiniChart data={data} dataKey="like_count" label="좋아요수 추이" color="#db2777" />
    </div>
  );
}
