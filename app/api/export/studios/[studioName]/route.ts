import ExcelJS from "exceljs";
import { getExportTitlesForStudio } from "@/lib/queries";

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

  const rows = await getExportTitlesForStudio(studioName);
  if (rows.length === 0) return new Response("제작사를 찾을 수 없습니다.", { status: 404 });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(studioName.slice(0, 31));

  const headers = [
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
  headers.forEach((h, i) => {
    const cell = sheet.getCell(1, i + 1);
    cell.value = h;
    cell.font = { bold: true };
  });

  rows.forEach((r, i) => {
    const row = i + 2;
    sheet.getCell(row, 1).value = r.platform === "kakao" ? "카카오" : "네이버";
    sheet.getCell(row, 2).value = r.title_name;
    sheet.getCell(row, 3).value = r.weekday ? (WEEKDAY_KO[r.weekday] ?? r.weekday) : "";
    sheet.getCell(row, 4).value = r.age_rating || (r.is_adult ? "성인" : "전체이용가");
    sheet.getCell(row, 5).value = r.writer ?? "";
    sheet.getCell(row, 6).value = r.painter ?? "";
    sheet.getCell(row, 7).value = r.origin_author ?? "";
    sheet.getCell(row, 8).value = r.studio_name ?? "";
    sheet.getCell(row, 9).value = r.launch_date ?? "";
    sheet.getCell(row, 10).value = r.star_score ?? "";
    sheet.getCell(row, 11).value = r.popularity_rank ?? "";
    sheet.getCell(row, 12).value = r.total_comment_count ?? "";
    sheet.getCell(row, 13).value = r.download_count ?? "";
    sheet.getCell(row, 14).value = r.view_count ?? "";
    sheet.getCell(row, 15).value = r.like_count ?? "";
    sheet.getCell(row, 16).value = r.genre ?? "";
    sheet.getCell(row, 17).value = r.subject ?? "";
    sheet.getCell(row, 18).value = r.logline ?? "";
    sheet.getCell(row, 19).value = r.target_audience ?? "";
    sheet.getCell(row, 20).value = r.comment ?? "";
  });

  const widths = [8, 24, 6, 10, 16, 16, 16, 16, 12, 8, 12, 12, 14, 12, 12, 16, 24, 30, 20, 24];
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
