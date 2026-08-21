"use client";

import { useState } from "react";

export default function ExportButton({ baseQuery }: { baseQuery: string }) {
  const [includeThumbnails, setIncludeThumbnails] = useState(false);

  const sp = new URLSearchParams(baseQuery);
  if (includeThumbnails) sp.set("thumbnails", "true");
  const href = `/api/export/all${sp.toString() ? `?${sp.toString()}` : ""}`;

  return (
    <div className="mb-4 flex items-center gap-3">
      <a
        href={href}
        className="inline-block rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
      >
        엑셀 다운로드
      </a>
      <label className="flex items-center gap-1.5 text-sm text-neutral-600">
        <input
          type="checkbox"
          checked={includeThumbnails}
          onChange={(e) => setIncludeThumbnails(e.target.checked)}
        />
        썸네일 포함
      </label>
    </div>
  );
}
