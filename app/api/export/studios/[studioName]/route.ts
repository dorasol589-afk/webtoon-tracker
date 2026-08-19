import ExcelJS from "exceljs";
import { getStudioTitles } from "@/lib/queries";

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

export async function GET(_req: Request, { params }: { params: Promise<{ studioName: string }> }) {
  const { studioName: rawName } = await params;
  const studioName = decodeURIComponent(rawName);

  const studio = await getStudioTitles(studioName);
  if (!studio) return new Response("제작사를 찾을 수 없습니다.", { status: 404 });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(studioName.slice(0, 31));

  const headers = [
    "연재처",
    "작품명",
    "요일",
    "현재 인기순위",
    "총별점",
    "현재 다운로드 수",
    "현재 조회수",
    "현재 좋아요수",
  ];
  headers.forEach((h, i) => {
    const cell = sheet.getCell(1, i + 1);
    cell.value = h;
    cell.font = { bold: true };
  });

  studio.titles.forEach((t, i) => {
    const row = i + 2;
    sheet.getCell(row, 1).value = t.platform === "kakao" ? "카카오" : "네이버";
    sheet.getCell(row, 2).value = t.title_name;
    sheet.getCell(row, 3).value = t.weekday ? (WEEKDAY_KO[t.weekday] ?? t.weekday) : "";
    sheet.getCell(row, 4).value = t.popularity_rank ?? "";
    sheet.getCell(row, 5).value = t.star_score ?? "";
    sheet.getCell(row, 6).value = t.download_count ?? "";
    sheet.getCell(row, 7).value = t.view_count ?? "";
    sheet.getCell(row, 8).value = t.like_count ?? "";
  });

  const widths = [8, 26, 6, 12, 8, 14, 14, 14];
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = encodeURIComponent(`${studioName}_작품.xlsx`);

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
