"use client";

import { useState, useTransition } from "react";
import { saveTreatmentAction } from "./actions";

export default function TreatmentCell({
  titleId,
  no,
  initialValue,
  rows = 2,
}: {
  titleId: number;
  no: number;
  initialValue: string | null;
  rows?: number;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [savedValue, setSavedValue] = useState(initialValue ?? "");
  const [isPending, startTransition] = useTransition();
  const [justSaved, setJustSaved] = useState(false);

  const dirty = value !== savedValue;

  function handleSave() {
    startTransition(async () => {
      await saveTreatmentAction(titleId, no, value);
      setSavedValue(value);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    });
  }

  return (
    <div className="flex items-start gap-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="이 회차 내용 메모..."
        rows={rows}
        className="w-full resize-y rounded border border-neutral-200 px-2 py-1 text-xs focus:border-neutral-400 focus:outline-none"
      />
      <button
        onClick={handleSave}
        disabled={!dirty || isPending}
        className={`shrink-0 rounded px-2 py-1 text-xs ${
          !dirty || isPending
            ? "cursor-not-allowed bg-neutral-100 text-neutral-400"
            : "bg-neutral-800 text-white hover:bg-neutral-700"
        }`}
      >
        {isPending ? "저장 중" : justSaved ? "저장됨" : "저장"}
      </button>
    </div>
  );
}
