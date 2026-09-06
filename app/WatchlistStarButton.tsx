"use client";

import { useState, useTransition } from "react";
import { addToWatchlistAction, removeFromWatchlistAction, setWatchlistUserAction } from "@/app/watchlistActions";

/** 목록 카드/행에 쓰는 아이콘형 관심작품 토글. WatchlistToggle(상세페이지용, 닉네임 입력폼 내장)과 달리
 * 목록에서는 행마다 입력폼을 둘 자리가 없어 닉네임이 없으면 prompt()로 한 번만 받는다. */
export default function WatchlistStarButton({
  titleId,
  currentUser,
  initialWatchlisted,
}: {
  titleId: number;
  currentUser: string | null;
  initialWatchlisted: boolean;
}) {
  const [userName, setUserName] = useState(currentUser);
  const [watchlisted, setWatchlisted] = useState(initialWatchlisted);
  const [isPending, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (isPending) return;

    if (!userName) {
      const input = window.prompt("관심작품에 추가할 닉네임을 입력하세요 (같은 닉네임으로 목록을 계속 볼 수 있어요)");
      const trimmed = input?.trim();
      if (!trimmed) return;
      setWatchlisted(true);
      setUserName(trimmed);
      startTransition(async () => {
        await setWatchlistUserAction(trimmed);
        await addToWatchlistAction(trimmed, titleId);
      });
      return;
    }

    const next = !watchlisted;
    setWatchlisted(next);
    startTransition(async () => {
      if (next) await addToWatchlistAction(userName, titleId);
      else await removeFromWatchlistAction(userName, titleId);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      title={watchlisted ? "관심작품에서 제거" : "관심작품에 추가"}
      className={`shrink-0 rounded px-1.5 py-0.5 text-base ${
        watchlisted ? "text-amber-500 hover:text-amber-600" : "text-neutral-300 hover:text-neutral-400"
      }`}
    >
      {watchlisted ? "★" : "☆"}
    </button>
  );
}
