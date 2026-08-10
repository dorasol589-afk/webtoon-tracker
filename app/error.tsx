"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-center text-sm text-red-800">
      <p className="mb-3">문제가 발생했습니다. Supabase 연결 설정을 확인해주세요.</p>
      <button onClick={reset} className="rounded bg-red-600 px-3 py-1.5 text-white hover:bg-red-700">
        다시 시도
      </button>
    </div>
  );
}
