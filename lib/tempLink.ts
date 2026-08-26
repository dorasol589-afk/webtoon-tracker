// 특정 시간대에만 열리는 임시 조회 링크(/t/{token}) 발급/검증.
// Edge 미들웨어와 일반 Node 스크립트 양쪽에서 그대로 쓸 수 있도록 Node의 crypto 모듈 대신
// 두 환경 모두 지원하는 Web Crypto(crypto.subtle)로 서명한다(별도 저장소 없이 토큰 자체에
// 공개 시작/종료 시각 + HMAC 서명을 담아 매 요청마다 그 자리에서 검증하는 방식).
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** notBefore 이전에는 안 열리고, expiresAt 이후에는 닫히는 토큰 발급 (둘 다 epoch seconds) */
export async function generateTempLinkToken(notBefore: number, expiresAt: number, secret: string): Promise<string> {
  const payloadBytes = encoder.encode(`${Math.floor(notBefore)}:${Math.floor(expiresAt)}`);
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, payloadBytes);
  return `${toBase64Url(payloadBytes)}.${toBase64Url(new Uint8Array(sig))}`;
}

export type TempLinkState = "open" | "not_yet" | "expired" | "invalid";

export interface TempLinkVerifyResult {
  valid: boolean;
  state: TempLinkState;
  notBefore: number | null;
  expiresAt: number | null;
}

export async function verifyTempLinkToken(token: string, secret: string): Promise<TempLinkVerifyResult> {
  const invalid: TempLinkVerifyResult = { valid: false, state: "invalid", notBefore: null, expiresAt: null };
  const parts = token.split(".");
  if (parts.length !== 2) return invalid;
  try {
    const payloadBytes = fromBase64Url(parts[0]);
    const sigBytes = fromBase64Url(parts[1]);
    const key = await getKey(secret);
    const ok = await crypto.subtle.verify("HMAC", key, sigBytes as BufferSource, payloadBytes as BufferSource);
    if (!ok) return invalid;

    const [nbfStr, expStr] = new TextDecoder().decode(payloadBytes).split(":");
    const nbf = Number(nbfStr);
    const exp = Number(expStr);
    if (!Number.isFinite(nbf) || !Number.isFinite(exp)) return invalid;

    const now = Math.floor(Date.now() / 1000);
    if (now < nbf) return { valid: false, state: "not_yet", notBefore: nbf, expiresAt: exp };
    if (now >= exp) return { valid: false, state: "expired", notBefore: nbf, expiresAt: exp };
    return { valid: true, state: "open", notBefore: nbf, expiresAt: exp };
  } catch {
    return invalid;
  }
}
