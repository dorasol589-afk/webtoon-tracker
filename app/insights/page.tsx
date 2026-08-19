"use client";

import { useState } from "react";
import InsightsChart from "./InsightsChart";
import type { ChartResult } from "@/lib/insights";

const EXAMPLES = [
  "2026.05.01.~2026.07.31.간 런칭된 신작 중 판타지 장르의 다운로드 수대로 그래프를 그려줘",
  "카카오웹툰 조회수 상위 10개 작품",
  "네이버웹툰 장르별 작품 수 비율",
];

export default function InsightsPage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChartResult | null>(null);

  async function runQuery(q: string) {
    if (!q.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/insights/chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "그래프를 만들지 못했습니다.");
      setResult(json as ChartResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">AI 그래프</h1>
      <p className="mb-4 text-sm text-neutral-500">
        원하는 조건을 문장으로 입력하면 가장 적절한 형태의 그래프로 만들어드려요.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          runQuery(query);
        }}
        className="mb-3 flex gap-2"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="예: 2026.05.01.~2026.07.31.간 런칭된 신작 중 판타지 장르의 다운로드 수대로 그래프를 그려줘"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "만드는 중..." : "그래프 그리기"}
        </button>
      </form>

      <div className="mb-6 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => {
              setQuery(ex);
              runQuery(ex);
            }}
            className="rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-500 hover:bg-neutral-50"
          >
            {ex}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
      )}

      {result && (
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-base font-semibold">{result.spec.title}</h2>
            <span className="text-xs text-neutral-400">조건에 맞는 작품 {result.matchedCount}개 중 표시</span>
          </div>
          <InsightsChart result={result} />
        </div>
      )}
    </div>
  );
}
