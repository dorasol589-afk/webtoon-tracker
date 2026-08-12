import ExcelJS from "exceljs";
import {
  getTitle,
  getEpisodesWithLatestCount,
  getAllCommentSnapshots,
  getPopularityRankHistory,
  getSeriesProductForTitle,
  getSeriesHistory,
  getTitleNotes,
  getTitleGenres,
  getLatestTitleSnapshot,
} from "@/lib/queries";

const WEEKDAY_KO: Record<string, string> = {
  MONDAY: "월요일",
  TUESDAY: "화요일",
  WEDNESDAY: "수요일",
  THURSDAY: "목요일",
  FRIDAY: "금요일",
  SATURDAY: "토요일",
  SUNDAY: "일요일",
  DAILY_PLUS: "매일+",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ titleId: string }> }
) {
  const { titleId } = await params;
  const id = Number(titleId);
  if (!Number.isInteger(id)) {
    return new Response("invalid titleId", { status: 400 });
  }

  const title = await getTitle(id);
  if (!title) {
    return new Response("not found", { status: 404 });
  }

  const seriesProduct = await getSeriesProductForTitle(id);
  const [episodes, commentSnapshots, popularityHistory, seriesHistory, genres, titleNotes, snapshot] =
    await Promise.all([
      getEpisodesWithLatestCount(id),
      getAllCommentSnapshots(id),
      getPopularityRankHistory(id),
      seriesProduct ? getSeriesHistory(seriesProduct.productNo) : Promise.resolve([]),
      getTitleGenres(id),
      getTitleNotes(id),
      getLatestTitleSnapshot(id),
    ]);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(title.title_name.slice(0, 31));
  const DATE_COL = 4; // A=회차, B=트리트먼트, C=지표 라벨, D~=날짜

  sheet.getCell(1, 1).value = title.title_name;
  sheet.getCell(1, 1).font = { bold: true };

  const metaRows: [string, string][] = [
    ["글", title.writer || "-"],
    ["그림", title.painter || "-"],
    ["원작", title.origin_author || "-"],
    ["스튜디오", title.studio_name || "-"],
    ["장르", genres.join(", ") || "-"],
    ["연재요일", snapshot?.weekday ? (WEEKDAY_KO[snapshot.weekday] ?? snapshot.weekday) : "-"],
    ["로그라인", titleNotes.logline || "-"],
    ["소재", titleNotes.subject || "-"],
    ["타깃층", titleNotes.target_audience || "-"],
    ["코멘트", titleNotes.comment || "-"],
  ];
  metaRows.forEach(([label, value], i) => {
    const labelCell = sheet.getCell(i + 2, 1);
    labelCell.value = label;
    labelCell.font = { bold: true };
    sheet.getCell(i + 2, 2).value = value;
  });

  // 다운수/인기순위/전체댓글수/회차별댓글수가 전부 공유하는 날짜 축 (셋 중 하나에만 있는 날짜도 포함)
  const allDates = [
    ...new Set([
      ...popularityHistory.map((p) => p.snapshot_date),
      ...seriesHistory.map((s) => s.snapshot_date),
      ...commentSnapshots.map((c) => c.snapshot_date),
    ]),
  ].sort();

  const dateHeaderRow = metaRows.length + 3;
  allDates.forEach((d, i) => {
    const cell = sheet.getCell(dateHeaderRow, DATE_COL + i);
    cell.value = d;
    cell.font = { bold: true };
  });

  const downloadByDate = new Map(seriesHistory.map((s) => [s.snapshot_date, s.download_count]));
  const downloadRow = dateHeaderRow + 1;
  sheet.getCell(downloadRow, 3).value = "다운수";
  sheet.getCell(downloadRow, 3).font = { bold: true };
  allDates.forEach((d, i) => {
    sheet.getCell(downloadRow, DATE_COL + i).value = downloadByDate.get(d) ?? "";
  });

  const rankByDate = new Map(popularityHistory.map((p) => [p.snapshot_date, p.popularity_rank]));
  const rankRow = downloadRow + 1;
  sheet.getCell(rankRow, 3).value = "인기순위";
  sheet.getCell(rankRow, 3).font = { bold: true };
  allDates.forEach((d, i) => {
    sheet.getCell(rankRow, DATE_COL + i).value = rankByDate.get(d) ?? "";
  });

  const totalCommentsByDate = new Map<string, number>();
  for (const c of commentSnapshots) {
    totalCommentsByDate.set(c.snapshot_date, (totalCommentsByDate.get(c.snapshot_date) ?? 0) + c.comment_count);
  }

  const headerRow = rankRow + 1;
  sheet.getCell(headerRow, 1).value = "회차";
  sheet.getCell(headerRow, 2).value = "트리트먼트";
  sheet.getCell(headerRow, 3).value = "전체댓글 수";
  for (let c = 1; c <= 3; c++) sheet.getCell(headerRow, c).font = { bold: true };
  allDates.forEach((d, i) => {
    sheet.getCell(headerRow, DATE_COL + i).value = totalCommentsByDate.get(d) ?? 0;
  });

  const commentByNoAndDate = new Map<string, number>();
  for (const c of commentSnapshots) {
    commentByNoAndDate.set(`${c.no}_${c.snapshot_date}`, c.comment_count);
  }

  const sortedEpisodes = [...episodes].sort((a, b) => a.no - b.no);
  sortedEpisodes.forEach((e, i) => {
    const r = headerRow + 1 + i;
    sheet.getCell(r, 1).value = e.no;
    sheet.getCell(r, 2).value = e.treatment ?? "";
    allDates.forEach((d, j) => {
      const v = commentByNoAndDate.get(`${e.no}_${d}`);
      sheet.getCell(r, DATE_COL + j).value = v ?? "";
    });
  });

  sheet.getColumn(1).width = 8;
  sheet.getColumn(2).width = 40;
  sheet.getColumn(3).width = 12;
  for (let c = DATE_COL; c <= DATE_COL - 1 + allDates.length; c++) {
    sheet.getColumn(c).width = 12;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = encodeURIComponent(`${title.title_name}.xlsx`);

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
