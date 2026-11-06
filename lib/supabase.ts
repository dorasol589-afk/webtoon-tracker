import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

let adminClient: SupabaseClient | null = null;

/** service role key를 쓰는 서버 전용 클라이언트 (수집기용, 쓰기 가능) */
export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.");
  }
  adminClient = createClient(url, key, { auth: { persistSession: false } });
  return adminClient;
}

/** service role key가 설정된 환경(로컬 등)에서만 true. 공유 배포(Vercel)는 이 키를 일부러 안 넣어서
 * 쓰기 기능이 자동으로 막히게 한다 - RLS에서도 anon 쓰기 권한을 없애서 앱을 거치지 않은 직접 API
 * 호출도 막혀있으므로, 이 값은 "쓰기 가능한 관리자 환경인지"의 단일 판단 기준이 된다. */
export function hasAdminAccess(): boolean {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

let anonClient: SupabaseClient | null = null;

// 공유 배포(Vercel) 전용 읽기 보강: 메뉴를 누를 때마다 무거운 집계 쿼리를 처음부터 다시 돌리면 2~3초씩 걸리고,
// 익명 키의 statement timeout(약 3초)을 넘으면 "연결 설정" 오류 화면이 떴다가 새로고침하면 DB 캐시가 데워져 열렸다.
// 데이터는 하루 한 번 수집되므로 (1) 5xx/네트워크 오류는 짧게 재시도하고 (2) 성공한 응답은 10분간 서버 캐시에 둔다.
// 오류 응답은 캐시하지 않는다. service role 키가 있는 로컬(관리자) 환경은 방금 쓴 값이 바로 보여야 해서 캐시를 끈다.
const READ_CACHE_SECONDS = 600;
const RETRY_DELAYS_MS = [300, 900];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type SerializedResponse = { status: number; headers: [string, string][]; body: string };
class UpstreamError extends Error {
  constructor(public payload: SerializedResponse) {
    super(`Supabase HTTP ${payload.status}`);
  }
}

async function fetchWithRetry(url: string, init: { method: string; headers: [string, string][]; body: string | null }): Promise<SerializedResponse> {
  let last: SerializedResponse | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body ?? undefined, cache: "no-store" });
      const headers: [string, string][] = [];
      res.headers.forEach((v, k) => {
        if (k !== "content-encoding" && k !== "content-length" && k !== "transfer-encoding") headers.push([k, v]);
      });
      const body = res.status === 204 || res.status === 304 ? "" : await res.text();
      const out = { status: res.status, headers, body };
      if (res.status < 500 && res.status !== 429 && res.status !== 408) return out;
      last = out;
    } catch (e) {
      lastErr = e;
    }
    if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
  }
  if (last) return last;
  throw lastErr instanceof Error ? lastErr : new Error("Supabase 요청 실패");
}

const cachedUpstream = unstable_cache(
  async (url: string, method: string, headers: [string, string][], body: string | null) => {
    const out = await fetchWithRetry(url, { method, headers, body });
    if (out.status >= 400) throw new UpstreamError(out); // 오류는 캐시에 저장되지 않음
    return out;
  },
  ["supabase-anon-read"],
  { revalidate: READ_CACHE_SECONDS }
);

function toResponse(o: SerializedResponse): Response {
  return new Response(o.status === 204 || o.status === 304 ? null : o.body, { status: o.status, headers: o.headers });
}

const resilientFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  const headers: [string, string][] = [];
  new Headers(init?.headers).forEach((v, k) => headers.push([k, v]));
  const body = typeof init?.body === "string" ? init.body : null;
  if (init?.body && body === null) return fetch(input, init); // 문자열이 아닌 본문은 그대로 통과
  try {
    if (hasAdminAccess()) return toResponse(await fetchWithRetry(url, { method, headers, body }));
    return toResponse(await cachedUpstream(url, method, headers, body));
  } catch (e) {
    if (e instanceof UpstreamError) return toResponse(e.payload); // supabase-js가 평소처럼 오류로 처리
    throw e;
  }
};

/** anon key를 쓰는 읽기 전용 클라이언트 (대시보드용) */
export function getSupabaseAnon(): SupabaseClient {
  if (anonClient) return anonClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 환경변수가 필요합니다.");
  }
  anonClient = createClient(url, key, { auth: { persistSession: false }, global: { fetch: resilientFetch } });
  return anonClient;
}
