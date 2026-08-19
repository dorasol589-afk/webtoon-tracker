import ExcelJS from "exceljs";
import { getExportTitlesForAllStudios, type ExportTitleRowUnified } from "@/lib/queries";

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
  // /api/export/all과 같은 컬럼 구성(글/그림작가, 연령, 런칭일, 장르, 소재 등 포함)이지만
  // 전체 카탈로그를 훑는 무거운 쿼리 대신 제작사 단위로 가볍게 조합한다(무거운 쪽은 anon 롤
  // statement_timeout을 자주 일으켜서 - 확인함 - getExportTitlesForAllStudios로 교체).
  const rows = (await getExportTitlesForAllStudios()).filter((r) => r.studio_name);

  const countByStudio = new Map<string, number>();
  for (const r of rows) {
    const key = r.studio_name!;
    countByStudio.set(key, (countByStudio.get(key) ?? 0) + 1);
  }
  const sortedRows = [...rows].sort((a, b) => {
    const countDiff = (countByStudio.get(b.studio_name!) ?? 0) - (countByStudio.get(a.studio_name!) ?? 0);
    if (countDiff !== 0) return countDiff;
    const nameDiff = a.studio_name!.localeCompare(b.studio_name!, "ko");
    if (nameDiff !== 0) return nameDiff;
    return (a.popularity_rank ?? Infinity) - (b.popularity_rank ?? Infinity);
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("제작사별 작품");

  const headers = [
    "제작사",
    "연재처",
    "작품명",
    "요일",
    "연령",
    "글작가",
    "그림작가",
    "원작자",
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

  const writeRow = (r: ExportTitleRowUnified, row: number) => {
    sheet.getCell(row, 1).value = r.studio_name ?? "";
    sheet.getCell(row, 2).value = r.platform === "kakao" ? "카카오" : "네이버";
    sheet.getCell(row, 3).value = r.title_name;
    sheet.getCell(row, 4).value = r.weekday ? (WEEKDAY_KO[r.weekday] ?? r.weekday) : "";
    sheet.getCell(row, 5).value = r.age_rating || (r.is_adult ? "성인" : "전체이용가");
    sheet.getCell(row, 6).value = r.writer ?? "";
    sheet.getCell(row, 7).value = r.painter ?? "";
    sheet.getCell(row, 8).value = r.origin_author ?? "";
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
  };

  sortedRows.forEach((r, i) => writeRow(r, i + 2));

  const widths = [20, 8, 24, 6, 10, 16, 16, 16, 12, 8, 12, 12, 14, 12, 12, 16, 24, 30, 20, 24];
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
