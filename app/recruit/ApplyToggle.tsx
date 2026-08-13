"use client";

import { useState, useTransition } from "react";
import { setJobAppliedAction } from "./actions";

export default function ApplyToggle({
  source,
  postingId,
  initialApplied,
}: {
  source: string;
  postingId: string;
  initialApplied: boolean;
}) {
  const [applied, setApplied] = useState(initialApplied);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = !applied;
    setApplied(next);
    startTransition(async () => {
      await setJobAppliedAction(source, postingId, next);
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      className={`shrink-0 rounded px-2 py-0.5 text-xs ${
        applied
          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
          : "bg-neutral-100 text-neutral-400 hover:bg-neutral-200"
      }`}
    >
      {applied ? "✓ 지원함" : "지원 표시"}
    </button>
  );
}
