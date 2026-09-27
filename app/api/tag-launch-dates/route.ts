import { getTagLaunchDates, type TagType } from "@/lib/queries";

function isTagType(value: string | null): value is TagType {
  return value === "GENRE" || value === "KEYWORD";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tagType = url.searchParams.get("tagType");
  const tagName = url.searchParams.get("tagName");
  if (!isTagType(tagType) || !tagName) {
    return Response.json({ error: "tagType(GENRE|KEYWORD), tagName이 필요합니다." }, { status: 400 });
  }

  try {
    const launchDates = await getTagLaunchDates(tagType, tagName);
    return Response.json({ launchDates });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
    console.error("tag-launch-dates 조회 실패:", err);
    return Response.json({ error: message }, { status: 500 });
  }
}
