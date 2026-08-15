"use client";

import { useState, useTransition } from "react";
import { saveTitleNotesAction } from "./actions";
import type { TitleNotes } from "@/lib/queries";

const FIELDS: { key: keyof TitleNotes; label: string; placeholder: string }[] = [
  { key: "logline", label: "로그라인", placeholder: "한 줄로 요약한 이야기..." },
  { key: "subject", label: "소재", placeholder: "핵심 소재/설정..." },
  { key: "target_audience", label: "타깃층", placeholder: "주 독자층..." },
  { key: "comment", label: "코멘트", placeholder: "자유 메모..." },
];

export default function TitleNotesForm({
  titleId,
  initial,
  readOnly = false,
}: {
  titleId: number;
  initial: TitleNotes;
  readOnly?: boolean;
}) {
  const [values, setValues] = useState<TitleNotes>(initial);
  const [saved, setSaved] = useState<TitleNotes>(initial);
  const [isPending, startTransition] = useTransition();
  const [justSaved, setJustSaved] = useState(false);

  const dirty = JSON.stringify(values) !== JSON.stringify(saved);

  function handleSave() {
    startTransition(async () => {
      await saveTitleNotesAction(titleId, values);
      setSaved(values);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    });
  }

  if (readOnly) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="mb-1 block text-xs font-medium text-neutral-500">{f.label}</label>
              <p className="min-h-[4.5rem] whitespace-pre-wrap rounded border border-neutral-100 bg-neutral-50 px-2 py-1.5 text-sm text-neutral-600">
                {initial[f.key] || <span className="text-neutral-300">-</span>}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="mb-1 block text-xs font-medium text-neutral-500">{f.label}</label>
            <textarea
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              rows={3}
              className="w-full resize-y rounded border border-neutral-200 px-2 py-1.5 text-sm focus:border-neutral-400 focus:outline-none"
            />
          </div>
        ))}
      </div>
      <button
        onClick={handleSave}
        disabled={!dirty || isPending}
        className={`mt-3 rounded px-3 py-1.5 text-sm ${
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
