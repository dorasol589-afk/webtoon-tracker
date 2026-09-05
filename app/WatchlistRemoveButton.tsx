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
      className="mt-1 w-full rounded bg-neutral-100 px-1.5 py-1 text-[11px] text-neutral-500 hover:bg-rose-100 hover:text-rose-600"
    >
      관심작품에서 제거
    </button>
  );
}
