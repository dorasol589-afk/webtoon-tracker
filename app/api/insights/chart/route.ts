import { interpretChartRequest, buildChartData } from "@/lib/insights";

export async function POST(req: Request) {
  let query: string;
  try {
    const body = await req.json();
    query = String(body.query ?? "").trim();
  } catch {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  if (!query) return Response.json({ error: "요청 내용을 입력해주세요." }, { status: 400 });

  try {
    const spec = await interpretChartRequest(query);
    const result = await buildChartData(spec);
    return Response.json(result);
  } catch (err) {
    console.error("인사이트 그래프 생성 실패:", err);
    // Supabase 에러는 Error 인스턴스가 아니라 {code, message, ...} 평범한 객체라
    // String(err)로는 "[object Object]"가 나옴 - message/code 필드를 직접 찾아야 함
    const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : null;
    if (code === "57014") {
      return Response.json(
        { error: "요청 범위가 너무 넓어서 처리 시간이 초과됐어요. 기간(예: 2026.05.01.~2026.07.31.)을 좁혀서 다시 시도해주세요." },
        { status: 500 }
      );
    }
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "그래프를 만드는 중 오류가 발생했습니다.";
    return Response.json({ error: message }, { status: 500 });
  }
}
