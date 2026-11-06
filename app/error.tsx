"use client";

import { startTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// 일시적인 조회 실패(DB 응답 지연 등)는 새로고침하면 바로 열리는 경우가 대부분이라, 한 번은 자동으로 다시 불러온다.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const retried = useRef(false);

  useEffect(() => {
    if (retried.current) return;
    retried.current = true;
    const t = setTimeout(() => {
      startTransition(() => {
        router.refresh();
        reset();
      });
    }, 800);
    return () => clearTimeout(t);
  }, [router, reset]);

  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-center text-sm text-red-800">
      <p className="mb-3">데이터를 불러오지 못했습니다. 자동으로 다시 시도하는 중입니다…</p>
      <button onClick={() => startTransition(() => { router.refresh(); reset(); })} className="rounded bg-red-600 px-3 py-1.5 text-white hover:bg-red-700">
        지금 다시 시도
      </button>
    </div>
  );
}
