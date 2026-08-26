// 특정 시간대에만 열리는 임시 조회 링크(/t/{token}) 발급.
// 사용법:
//   npx tsx scripts/generateTempLink.ts [유효시간(시간, 기본 24)]              - 지금부터 N시간 동안 열림
//   npx tsx scripts/generateTempLink.ts "2026-08-26 20:30" "2026-08-26 23:30" - 지정한 시간대(KST)에만 열림
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { generateTempLinkToken } from "../lib/tempLink";

function parseKst(input: string): Date {
  // 이 스크립트를 돌리는 서버/PC가 이미 KST(Asia/Seoul)라는 전제 하에 로컬 시각으로 그대로 해석한다.
  const date = new Date(input.replace(" ", "T"));
  if (isNaN(date.getTime())) {
    console.error(`날짜를 해석할 수 없습니다: "${input}" (예: "2026-08-26 20:30")`);
    process.exit(1);
  }
  return date;
}

async function main() {
  const secret = process.env.TEMP_LINK_SECRET;
  if (!secret) {
    console.error(
      "TEMP_LINK_SECRET 환경변수가 없습니다. .env.local과(배포본에서 쓰려면) Vercel 프로젝트 환경변수에도 설정해주세요."
    );
    process.exit(1);
  }

  let notBefore: Date;
  let expiresAt: Date;
  if (process.argv[2] && process.argv[3]) {
    notBefore = parseKst(process.argv[2]);
    expiresAt = parseKst(process.argv[3]);
    if (expiresAt.getTime() <= notBefore.getTime()) {
      console.error("종료 시각이 시작 시각보다 뒤여야 합니다.");
      process.exit(1);
    }
  } else {
    const hours = Number(process.argv[2]) || 24;
    notBefore = new Date();
    expiresAt = new Date(Date.now() + hours * 3600 * 1000);
  }

  const token = await generateTempLinkToken(
    Math.floor(notBefore.getTime() / 1000),
    Math.floor(expiresAt.getTime() / 1000),
    secret
  );
  const fmt = (d: Date) => d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  console.log(`공개 기간: ${fmt(notBefore)} ~ ${fmt(expiresAt)} KST`);
  console.log(`경로: /t/${token}`);
  console.log(`전체 링크: https://<배포 도메인>/t/${token}`);
}

main();
