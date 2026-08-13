/** 다운로드수 등 큰 숫자를 "1,234만" 형태로 표기. 0/null은 데이터 없음으로 간주해 "-" 표시 */
export function formatManwon(count: number): string {
  if (!count) return "-";
  return `${Math.round(count / 10000).toLocaleString()}만`;
}

/**
 * 채용공고 dday 텍스트("D-18", "~08.31(월)", "상시채용" 등)를 오늘부터 남은 일수로 환산.
 * 마감일순 정렬용 - 형식을 못 알아보면(상시채용/채용시 등) 맨 뒤로 가도록 Infinity 반환.
 */
export function ddayToDays(dday: string | null): number {
  if (!dday) return Infinity;

  const dMatch = dday.match(/^D-(\d+)/);
  if (dMatch) return parseInt(dMatch[1], 10);

  const dateMatch = dday.match(/(\d{2})\.(\d{2})/);
  if (dateMatch) {
    const [, mm, dd] = dateMatch;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const year = todayStart.getFullYear();
    let target = new Date(year, parseInt(mm, 10) - 1, parseInt(dd, 10));
    if (target.getTime() < todayStart.getTime()) {
      target = new Date(year + 1, parseInt(mm, 10) - 1, parseInt(dd, 10));
    }
    return Math.round((target.getTime() - todayStart.getTime()) / 86400000);
  }

  return Infinity;
}
