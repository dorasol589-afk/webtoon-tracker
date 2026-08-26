import { NextRequest, NextResponse } from "next/server";
import { verifyTempLinkToken } from "@/lib/tempLink";

// 기존 공유용 URL(그냥 도메인 그대로)은 이 미들웨어의 영향을 전혀 받지 않는다 - matcher가
// "/t/*" 경로만 가로채므로, 그 외 모든 경로는 지금까지와 동일하게 항상 열려있다.
// "/t/{token}"으로 들어오면 토큰에 담긴 공개 시작/종료 시각을 그 자리에서 검증해 그 사이일
// 때만 실제 페이지로 rewrite한다(주소창은 /t/{token}으로 유지). 아직 열리지 않았거나 만료됐거나
// 위조된 토큰이면 안내 화면만 보여주고 실제 콘텐츠는 내려주지 않는다.
export const config = {
  matcher: "/t/:path*",
};

function formatKst(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

function messageHtml(title: string, body: string) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, "Malgun Gothic", sans-serif; background: #171717; color: #e5e5e5; }
  main { text-align: center; padding: 2rem; }
  h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
  p { color: #a3a3a3; font-size: 0.9rem; }
</style>
</head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
}

function messageResponse(status: number, title: string, body: string) {
  return new NextResponse(messageHtml(title, body), { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function middleware(req: NextRequest) {
  const match = req.nextUrl.pathname.match(/^\/t\/([^/]+)(\/.*)?$/);
  if (!match) return NextResponse.next();

  const secret = process.env.TEMP_LINK_SECRET;
  if (!secret) return messageResponse(503, "링크를 열 수 없습니다", "서버 설정이 완료되지 않았습니다.");

  const [, token, rest] = match;
  const result = await verifyTempLinkToken(token, secret);

  if (result.state === "not_yet") {
    return messageResponse(403, "아직 열리지 않은 링크입니다", `${formatKst(result.notBefore!)}부터 열립니다.`);
  }
  if (result.state === "expired") {
    return messageResponse(410, "링크가 만료되었습니다", `이 임시 조회 링크는 ${formatKst(result.expiresAt!)}에 닫혔습니다.`);
  }
  if (!result.valid) {
    return messageResponse(410, "유효하지 않은 링크입니다", "링크 주소를 다시 확인해주세요.");
  }

  const url = req.nextUrl.clone();
  url.pathname = rest || "/";
  return NextResponse.rewrite(url);
}
