"use client";

import { useState, useTransition } from "react";
import { setWatchlistUserAction, clearWatchlistUserAction } from "@/app/watchlistActions";

export default function NicknameSwitcher({ currentUser }: { currentUser: string | null }) {
  const [value, setValue] = useState(currentUser ?? "");
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) return;
        startTransition(async () => {
          await setWatchlistUserAction(trimmed);
        });
      }}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="닉네임 입력"
        className="rounded border border-neutral-300 px-3 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
      />
      <button
        type="submit"
        disabled={isPending || !value.trim()}
        className="rounded bg-neutral-800 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
      >
        {currentUser ? "다른 이름으로 보기" : "시작하기"}
      </button>
      {currentUser && (
        <button
          type="button"
          onClick={() =>
            startTransition(async () => {
              await clearWatchlistUserAction();
              setValue("");
            })
          }
          disabled={isPending}
          className="text-xs text-neutral-400 hover:text-neutral-600 hover:underline"
        >
          닉네임 지우기
        </button>
      )}
    </form>
  );
}
