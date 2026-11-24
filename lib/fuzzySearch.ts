// 작품명 검색에서 정확히 일치하는 결과가 없을 때 쓰는 오타 허용 검색.
// 한글을 자모로 풀어서 비교하므로 "환/회", "ㅔ/ㅐ" 같은 한 글자 오타나 띄어쓰기 차이도 찾는다.

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

/** 공백·기호를 버리고 한글은 초/중/종성 자모로 푼다 (영문·숫자는 소문자) */
export function toJamo(s: string): string[] {
  const out: string[] = [];
  for (const ch of s) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code >= 0 && code <= 11171) {
      out.push(CHO[Math.floor(code / 588)], JUNG[Math.floor((code % 588) / 28)]);
      const jong = JONG[code % 28];
      if (jong) out.push(jong);
    } else if (/[\p{L}\p{N}]/u.test(ch)) {
      out.push(ch.toLowerCase());
    }
  }
  return out;
}

/** 질의(q)와 가장 비슷한 text의 부분 문자열 사이의 편집 거리 (Sellers 알고리즘) */
function approxSubstringDistance(q: string[], text: string[]): number {
  const m = q.length;
  let prev = Array.from({ length: m + 1 }, (_, i) => i);
  let best = prev[m];
  for (let j = 1; j <= text.length; j++) {
    const cur = new Array<number>(m + 1);
    cur[0] = 0;
    for (let i = 1; i <= m; i++) {
      const cost = q[i - 1] === text[j - 1] ? 0 : 1;
      cur[i] = Math.min(prev[i - 1] + cost, prev[i] + 1, cur[i - 1] + 1);
    }
    if (cur[m] < best) best = cur[m];
    prev = cur;
  }
  return best;
}

/** 오타 허용 범위(자모 기준): 질의가 짧으면 엄격하게, 길수록 조금 더 느슨하게 */
export function allowedErrors(queryJamoLength: number): number {
  if (queryJamoLength < 4) return 0;
  return Math.min(6, Math.max(1, Math.floor(queryJamoLength * 0.2)));
}

export interface NameItem {
  id: number;
  name: string;
}

/** 이름이 비슷한 항목을 가까운 순으로 최대 limit개 반환 */
export function fuzzyMatch(query: string, items: NameItem[], limit = 20): NameItem[] {
  const q = toJamo(query);
  if (q.length === 0) return [];
  // 자음/모음만 입력한 경우(예: ㅁㄴㅇㄹ)는 아무 작품에나 걸리므로 오타 검색을 하지 않는다
  if (!/[가-힣a-zA-Z0-9]/.test(query)) return [];
  const maxErr = allowedErrors(q.length);
  const scored: { item: NameItem; dist: number; lenGap: number }[] = [];
  for (const item of items) {
    const t = toJamo(item.name);
    if (t.length === 0) continue;
    const dist = approxSubstringDistance(q, t);
    if (dist <= maxErr) scored.push({ item, dist, lenGap: Math.abs(t.length - q.length) });
  }
  scored.sort((a, b) => a.dist - b.dist || a.lenGap - b.lenGap || a.item.name.localeCompare(b.item.name, "ko"));
  return scored.slice(0, limit).map((s) => s.item);
}
