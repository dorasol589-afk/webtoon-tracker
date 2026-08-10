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
