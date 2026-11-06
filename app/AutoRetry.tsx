"use client";

import { startTransition, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

// 조회 실패 안내가 뜬 페이지를 한두 번 자동으로 다시 불러온다(새로고침하면 열리는 일시적 실패가 대부분).
export default function AutoRetry({ max = 2 }: { max?: number }) {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const key = `autoretry:${pathname}`;
    let n = 0;
    try {
      n = Number(sessionStorage.getItem(key) ?? "0");
    } catch {}
    if (n >= max) {
      try {
        sessionStorage.removeItem(key);
      } catch {}
      return;
    }
    try {
      sessionStorage.setItem(key, String(n + 1));
    } catch {}
    const t = setTimeout(() => startTransition(() => router.refresh()), 1000);
    return () => clearTimeout(t);
  }, [router, pathname, max]);
  return null;
}
