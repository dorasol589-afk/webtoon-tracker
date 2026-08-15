import { createClient, SupabaseClient } from "@supabase/supabase-js";

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

/** anon key를 쓰는 읽기 전용 클라이언트 (대시보드용) */
export function getSupabaseAnon(): SupabaseClient {
  if (anonClient) return anonClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 환경변수가 필요합니다.");
  }
  anonClient = createClient(url, key, { auth: { persistSession: false } });
  return anonClient;
}
