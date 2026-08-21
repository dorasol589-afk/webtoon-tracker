import ExcelJS from "exceljs";
import pLimit from "p-limit";
import { getExportTitlesDataUnified, type TitlePlatformFilter } from "@/lib/queries";

const IMAGE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** 썸네일 다운로드 - 네이버 CDN은 Referer 없으면 403 (실제 확인됨) */
async function fetchThumbnail(
  url: string,
  platform: "naver" | "kakao"
): Promise<{ buffer: Buffer; extension: "jpeg" | "png" | "gif" } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": IMAGE_UA,
        ...(platform === "naver" ? { Referer: "https://comic.naver.com/" } : {}),
      },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    const extension: "jpeg" | "png" | "gif" = contentType.includes("png")
      ? "png"
      : contentType.includes("gif")
        ? "gif"
        : "jpeg";
    const arrayBuffer = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), extension };
  } catch {
    return null;
  }
}

const WEEKDAY_KO: Record<string, string> = {
  MONDAY: "월",
  TUESDAY: "화",
  WEDNESDAY: "수",
  THURSDAY: "목",
  FRIDAY: "금",
  SATURDAY: "토",
  SUNDAY: "일",
  DAILY_PLUS: "매일+",
};

const PLATFORM_VALUES = ["all", "naver", "kakao"] as const;

function platformLabel(platform: TitlePlatformFilter): string {
  if (platform === "naver") return "네이버";
  if (platform === "kakao") return "카카오";
  return "전체";
}

const STATUS_VALUES = ["all", "ongoing", "new", "finished", "hiatus"] as const;
type StatusParam = (typeof STATUS_VALUES)[number];

function statusLabel(status: StatusParam): string {
  if (status === "ongoing") return "연재중";
  if (status === "new") return "신작";
  if (status === "finished") return "완결";
  if (status === "hiatus") return "휴재";
  return "전체";
}

const TYPE_VALUES = ["all", "weekday", "daily_plus"] as const;
type TypeParam = (typeof TYPE_VALUES)[number];

const SORT_VALUES = ["name", "popularity", "star", "launch", "comments", "views", "likes"] as const;
type SortParam = (typeof SORT_VALUES)[number];

function isValidDate(v: string | null): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const platformParam = url.searchParams.get("platform");
  const platform: TitlePlatformFilter = (PLATFORM_VALUES as readonly string[]).includes(platformParam ?? "")
    ? (platformParam as TitlePlatformFilter)
    : "all";
  const statusParam = url.searchParams.get("status");
  const status: StatusParam = (STATUS_VALUES as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as StatusParam)
    : "all";
  const typeParam = url.searchParams.get("type");
  const type: TypeParam = (TYPE_VALUES as readonly string[]).includes(typeParam ?? "")
    ? (typeParam as TypeParam)
    : "all";
  const sortParam = url.searchParams.get("sort");
  const sort: SortParam = (SORT_VALUES as readonly string[]).includes(sortParam ?? "")
    ? (sortParam as SortParam)
    : "name";
  const adultOnly = url.searchParams.get("adult") === "true";
  const launchFromParam = url.searchParams.get("launchFrom");
  const launchToParam = url.searchParams.get("launchTo");
  const launchFrom = isValidDate(launchFromParam) ? launchFromParam : undefined;
  const launchTo = isValidDate(launchToParam) ? launchToParam : undefined;
  const genreParam = url.searchParams.get("genre");
  const genre = genreParam && genreParam.trim() ? genreParam : "all";
  const includeThumbnails = url.searchParams.get("thumbnails") === "true";

  const rows = await getExportTitlesDataUnified({
    platform,
    status,
    type,
    adultOnly,
    launchFrom,
    launchTo,
    sortBy: sort,
    genre,
  });

  const sheetNameParts = [platformLabel(platform), statusLabel(status)];
  if (launchFrom || launchTo) sheetNameParts.push(`${launchFrom ?? ""}~${launchTo ?? ""}`);
  if (genre !== "all") sheetNameParts.push(genre);

  const workbook = new ExcelJS.Workbook();
  // 워크시트 이름에 못 쓰는 문자(* ? : \ / [ ])는 장르명("무협/사극" 등)에 실제로 나와서 치환 필요
  const safeSheetName = sheetNameParts.join(" ").replace(/[*?:\\/[\]]/g, "-").slice(0, 31);
  const sheet = workbook.addWorksheet(safeSheetName);

  const baseHeaders = [
    "연재처",
    "작품명",
    "요일",
    "연령",
    "글작가",
    "그림작가",
    "원작자",
    "스튜디오",
    "런칭일",
    "총별점",
    "현재 인기순위",
    "현재 총 댓글수",
    "현재 다운로드 수",
    "현재 조회수",
    "현재 좋아요수",
    "장르",
    "소재",
    "로그라인",
    "타깃독자층",
    "코멘트",
  ];
  const headers = includeThumbnails ? ["썸네일", ...baseHeaders] : baseHeaders;
  const colOffset = includeThumbnails ? 1 : 0;
  headers.forEach((h, i) => {
    const cell = sheet.getCell(1, i + 1);
    cell.value = h;
    cell.font = { bold: true };
  });

  rows.forEach((r, i) => {
    const row = i + 2;
    sheet.getCell(row, 1 + colOffset).value = r.platform === "kakao" ? "카카오" : "네이버";
    sheet.getCell(row, 2 + colOffset).value = r.title_name;
    sheet.getCell(row, 3 + colOffset).value = r.weekday ? (WEEKDAY_KO[r.weekday] ?? r.weekday) : "";
    sheet.getCell(row, 4 + colOffset).value = r.age_rating || (r.is_adult ? "성인" : "전체이용가");
    sheet.getCell(row, 5 + colOffset).value = r.writer ?? "";
    sheet.getCell(row, 6 + colOffset).value = r.painter ?? "";
    sheet.getCell(row, 7 + colOffset).value = r.origin_author ?? "";
    sheet.getCell(row, 8 + colOffset).value = r.studio_name ?? "";
    sheet.getCell(row, 9 + colOffset).value = r.launch_date ?? "";
    sheet.getCell(row, 10 + colOffset).value = r.star_score ?? "";
    sheet.getCell(row, 11 + colOffset).value = r.popularity_rank ?? "";
    sheet.getCell(row, 12 + colOffset).value = r.total_comment_count ?? "";
    sheet.getCell(row, 13 + colOffset).value = r.download_count ?? "";
    sheet.getCell(row, 14 + colOffset).value = r.view_count ?? "";
    sheet.getCell(row, 15 + colOffset).value = r.like_count ?? "";
    sheet.getCell(row, 16 + colOffset).value = r.genre ?? "";
    sheet.getCell(row, 17 + colOffset).value = r.subject ?? "";
    sheet.getCell(row, 18 + colOffset).value = r.logline ?? "";
    sheet.getCell(row, 19 + colOffset).value = r.target_audience ?? "";
    sheet.getCell(row, 20 + colOffset).value = r.comment ?? "";
  });

  const baseWidths = [8, 24, 6, 10, 16, 16, 16, 16, 12, 8, 12, 12, 14, 12, 12, 16, 24, 30, 20, 24];
  const widths = includeThumbnails ? [10, ...baseWidths] : baseWidths;
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  if (includeThumbnails) {
    sheet.getColumn(1).width = 10;
    const ROW_HEIGHT = 62;
    sheet.getRow(1).height = 20;
    const imageLimit = pLimit(10);
    await Promise.all(
      rows.map((r, i) =>
        imageLimit(async () => {
          if (!r.thumbnail_url) return;
          const img = await fetchThumbnail(r.thumbnail_url, r.platform);
          if (!img) return;
          const row = i + 2;
          sheet.getRow(row).height = ROW_HEIGHT;
          const imageId = workbook.addImage({
            buffer: img.buffer as unknown as ExcelJS.Buffer,
            extension: img.extension,
          });
          sheet.addImage(imageId, {
            tl: { col: 0, row: row - 1 },
            ext: { width: 52, height: 76 },
            editAs: "oneCell",
          });
        })
      )
    );
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = encodeURIComponent(`전체작품_${sheetNameParts.join("_")}.xlsx`);

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
