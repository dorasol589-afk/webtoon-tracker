import ExcelJS from "exceljs";
import { getExportTitlesData, type ExportTitleRow } from "@/lib/queries";

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

const SORT_VALUES = ["name", "popularity", "star", "launch", "comments"] as const;
type SortParam = (typeof SORT_VALUES)[number];

function isValidDate(v: string | null): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
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

  const rows = await getExportTitlesData({ status, type, adultOnly, launchFrom, launchTo, sortBy: sort });

  const sheetNameParts = [statusLabel(status)];
  if (launchFrom || launchTo) sheetNameParts.push(`${launchFrom ?? ""}~${launchTo ?? ""}`);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetNameParts.join(" ").slice(0, 31));

  const headers = [
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
    "장르",
    "소재",
    "로그라인",
    "타깃독자층",
    "코멘트",
  ];
  headers.forEach((h, i) => {
    const cell = sheet.getCell(1, i + 1);
    cell.value = h;
    cell.font = { bold: true };
  });

  rows.forEach((r, i) => {
    const row = i + 2;
    sheet.getCell(row, 1).value = r.title_name;
    sheet.getCell(row, 2).value = r.weekday ? (WEEKDAY_KO[r.weekday] ?? r.weekday) : "";
    sheet.getCell(row, 3).value = r.age_rating || (r.is_adult ? "성인" : "전체이용가");
    sheet.getCell(row, 4).value = r.writer ?? "";
    sheet.getCell(row, 5).value = r.painter ?? "";
    sheet.getCell(row, 6).value = r.origin_author ?? "";
    sheet.getCell(row, 7).value = r.studio_name ?? "";
    sheet.getCell(row, 8).value = r.launch_date ?? "";
    sheet.getCell(row, 9).value = r.star_score ?? "";
    sheet.getCell(row, 10).value = r.popularity_rank ?? "";
    sheet.getCell(row, 11).value = r.total_comment_count ?? "";
    sheet.getCell(row, 12).value = r.download_count ?? "";
    sheet.getCell(row, 13).value = r.genre ?? "";
    sheet.getCell(row, 14).value = r.subject ?? "";
    sheet.getCell(row, 15).value = r.logline ?? "";
    sheet.getCell(row, 16).value = r.target_audience ?? "";
    sheet.getCell(row, 17).value = r.comment ?? "";
  });

  const widths = [24, 6, 10, 16, 16, 16, 16, 12, 8, 12, 12, 14, 16, 24, 30, 20, 24];
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = encodeURIComponent(`전체작품_${sheetNameParts.join("_")}.xlsx`);

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
