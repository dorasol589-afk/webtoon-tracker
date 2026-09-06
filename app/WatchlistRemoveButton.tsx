"use client";

import { useState, useTransition } from "react";
import { removeFromWatchlistAction } from "@/app/watchlistActions";

export default function WatchlistRemoveButton({ userName, titleId }: { userName: string; titleId: number }) {
  const [isPending, startTransition] = useTransition();
  const [removed, setRemoved] = useState(false);

  if (removed) return null;

  return (
    <button
      type="button"
      onClick={() => {
        setRemoved(true);
        startTransition(async () => {
          await removeFromWatchlistAction(userName, titleId);
        });
      }}
      disabled={isPending}
      title="관심작품에서 제거"
      aria-label="관심작품에서 제거"
      className="shrink-0 rounded px-1.5 py-0.5 text-base text-neutral-300 hover:text-rose-500"
    >
      ✕
    </button>
  );
}
