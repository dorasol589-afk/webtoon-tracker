"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { SnapshotPoint } from "@/lib/queries";

export default function CommentTrendChart({ data }: { data: SnapshotPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        아직 수집된 데이터가 없습니다.
      </div>
    );
  }

  return (
    <div className="h-80 w-full rounded-lg border border-neutral-200 bg-white p-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
          <XAxis dataKey="snapshot_date" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} width={50} />
          <Tooltip formatter={(value) => [Number(value).toLocaleString(), "댓글수"]} />
          <Line type="monotone" dataKey="comment_count" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
