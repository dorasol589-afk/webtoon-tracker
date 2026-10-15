"use client";

import { useCallback, useState } from "react";

/** 네이버 작품 소개처럼 3줄까지만 보여주고, 넘치는 경우에만 "더보기/접기" 토글을 노출 */
export default function ExpandableSynopsis({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  // 접힌 상태(line-clamp)에서만 넘침 여부를 잰다 - 펼친 뒤에는 이미 알고 있는 값을 유지
  const measureRef = useCallback((el: HTMLParagraphElement | null) => {
    if (el && el.scrollHeight > el.clientHeight + 1) setOverflowing(true);
  }, []);

  return (
    <div className="mt-3 text-sm leading-relaxed text-neutral-700">
      <p ref={measureRef} className={`whitespace-pre-line ${expanded ? "" : "line-clamp-3"}`}>
        {text}
      </p>
      {(overflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-blue-600 hover:underline"
        >
          {expanded ? "접기" : "더보기"}
        </button>
      )}
    </div>
  );
}
