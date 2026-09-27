import { getTagDownloadSeriesBatch, type TagType } from "@/lib/queries";

function isTagType(value: string | null): value is TagType {
  return value === "GENRE" || value === "KEYWORD";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tagType = url.searchParams.get("tagType");
  const tagNamesParam = url.searchParams.get("tagNames");
  if (!isTagType(tagType) || !tagNamesParam) {
    return Response.json({ error: "tagType(GENRE|KEYWORD), tagNames가 필요합니다." }, { status: 400 });
  }
  const tagNames = tagNamesParam
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  try {
    const data = await getTagDownloadSeriesBatch(tagType, tagNames);
    return Response.json({ data });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
    console.error("tag-download-series 조회 실패:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
