"use client";

import { useState, useTransition } from "react";
import { updateTitleStudioNameAction } from "./actions";

const NEEDS_FIX = new Set(["다중", "", null, undefined]);

export default function StudioNameEditor({
  titleId,
  studioName,
}: {
  titleId: number;
  studioName: string | null;
}) {
  const needsFix = NEEDS_FIX.has(studioName ?? "");
  const [editing, setEditing] = useState(needsFix);
  const [value, setValue] = useState(needsFix ? "" : studioName ?? "");
  const [saved, setSaved] = useState(studioName);
  const [isPending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="truncate text-left text-xs text-neutral-400 hover:text-neutral-600 hover:underline"
        title="제작사명 수정"
      >
        {saved}
      </button>
    );
  }

  function handleSave() {
    startTransition(async () => {
      await updateTitleStudioNameAction(titleId, value.trim());
      setSaved(value.trim());
      setEditing(false);
    });
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="제작사명 입력"
        className="w-full min-w-0 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs focus:border-amber-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={isPending || !value.trim()}
        className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-white disabled:cursor-not-allowed disabled:bg-neutral-300"
      >
        저장
      </button>
    </div>
  );
}
