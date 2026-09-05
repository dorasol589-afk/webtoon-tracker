"use client";

import { useState, useTransition } from "react";
import { addToWatchlistAction, removeFromWatchlistAction, setWatchlistUserAction } from "@/app/watchlistActions";

export default function WatchlistToggle({
  titleId,
  currentUser,
  initialWatchlisted,
}: {
  titleId: number;
  currentUser: string | null;
  initialWatchlisted: boolean;
}) {
  const [userName, setUserName] = useState(currentUser);
  const [nameInput, setNameInput] = useState("");
  const [watchlisted, setWatchlisted] = useState(initialWatchlisted);
  const [isPending, startTransition] = useTransition();

  if (!userName) {
    return (
      <form
        className="mt-2 flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = nameInput.trim();
          if (!trimmed) return;
          startTransition(async () => {
            await setWatchlistUserAction(trimmed);
            await addToWatchlistAction(trimmed, titleId);
            setUserName(trimmed);
            setWatchlisted(true);
          });
        }}
      >
        <input
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          placeholder="닉네임 입력 후 관심작품 추가"
          className="rounded border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={isPending || !nameInput.trim()}
          className="shrink-0 rounded bg-neutral-800 px-2 py-1 text-xs text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
        >
          ☆ 관심작품 추가
        </button>
      </form>
    );
  }

  function toggle() {
    const next = !watchlisted;
    setWatchlisted(next);
    startTransition(async () => {
      if (next) await addToWatchlistAction(userName as string, titleId);
      else await removeFromWatchlistAction(userName as string, titleId);
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      className={`mt-2 rounded px-2 py-1 text-xs ${
        watchlisted ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
      }`}
    >
      {watchlisted ? `★ 관심작품 (${userName})` : `☆ 관심작품 추가 (${userName})`}
    </button>
  );
}
