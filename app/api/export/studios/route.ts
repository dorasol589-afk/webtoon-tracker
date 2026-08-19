import ExcelJS from "exceljs";
import { getTitlesByStudio } from "@/lib/queries";

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

export async function GET() {
  const groups = await getTitlesByStudio();
  // 페이지 기본 정렬(작품수순)과 맞춤 - 제작사 내에서는 이미 인기순위/별점순으로 정렬되어 있음
  const sortedGroups = [...groups].sort(
    (a, b) => b.titles.length - a.titles.length || b.totalDownloadCount - a.totalDownloadCount
  );

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("제작사별 작품");

  const headers = [
    "제작사",
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

  let row = 2;
  for (const group of sortedGroups) {
    for (const t of group.titles) {
      sheet.getCell(row, 1).value = group.studioName;
      sheet.getCell(row, 2).value = t.platform === "kakao" ? "카카오" : "네이버";
      sheet.getCell(row, 3).value = t.title_name;
      sheet.getCell(row, 4).value = t.weekday ? (WEEKDAY_KO[t.weekday] ?? t.weekday) : "";
      sheet.getCell(row, 5).value = t.popularity_rank ?? "";
      sheet.getCell(row, 6).value = t.star_score ?? "";
      sheet.getCell(row, 7).value = t.download_count ?? "";
      sheet.getCell(row, 8).value = t.view_count ?? "";
      sheet.getCell(row, 9).value = t.like_count ?? "";
      row++;
    }
  }

  const widths = [20, 8, 26, 6, 12, 8, 14, 14, 14];
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  const buffer = await workbook.xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("제작사별_작품.xlsx")}`,
    },
  });
}
