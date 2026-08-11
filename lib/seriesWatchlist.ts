// 사용자가 우선적으로 지정한, 네이버 시리즈 다운로드수를 매일 추적할 작품 목록.
// titleId는 comic.naver.com 기준 (댓글수는 이미 일반 파이프라인에서 titles 테이블로 추적됨).
// productNo는 series.naver.com/comic/detail.series?productNo=X 의 X.
export interface SeriesWatchlistItem {
  titleId: number;
  productNo: number;
  name: string;
}

export const SERIES_WATCHLIST: SeriesWatchlistItem[] = [
  { titleId: 849510, productNo: 13977185, name: "변경백의 10클래스 망나니" },
  { titleId: 832703, productNo: 11659054, name: "시한부 천재가 살아남는 법" },
  { titleId: 850266, productNo: 14083007, name: "어느 날 해츨링이 되었다" },
  { titleId: 832557, productNo: 11634583, name: "회귀한 용병은 다 계획이 있다" },
  { titleId: 849451, productNo: 13936024, name: "공작님의 아이만 필요합니다" },
];
