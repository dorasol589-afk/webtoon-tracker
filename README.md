# 웹툰 댓글수 추적

네이버 웹툰의 **연재중인 작품**의 **무료 회차**마다 댓글수를 매일 수집해서 추이를 보여주는 대시보드.

- 수집기: `scripts/collect.ts` (Node/TypeScript) — GitHub Actions로 매일 자동 실행
- 저장소: Supabase (Postgres)
- 대시보드: Next.js, Vercel 배포

## 로컬 개발

```bash
npm install
npm run dev          # http://localhost:3000
```

`.env.local` 파일에 아래 값을 채워야 대시보드가 실제 데이터를 보여줍니다 (`.env.example` 참고):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

## 수집기 실행

```bash
# 전체 수집 (DB에 씀, SUPABASE_URL/SERVICE_ROLE_KEY 필요)
npm run collect

# 작품 5개만 드라이런 (DB 미설정시 콘솔 출력만)
TITLE_LIMIT=5 npm run collect
```

## 배포 순서

1. **Supabase**: 프로젝트 생성 → SQL Editor에서 `supabase/schema.sql` 실행 → Project Settings > API에서 URL / anon key / service_role key 확보
2. **GitHub**: 이 저장소를 GitHub에 push (public 권장 — Actions 무료 무제한) → Settings > Secrets and variables > Actions에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 등록
3. **GitHub Actions**: `.github/workflows/collect.yml`이 매일 00:00 KST에 자동 실행됨. Actions 탭에서 `workflow_dispatch`로 수동 실행도 가능
4. **Vercel**: 저장소 연결 → 환경변수에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 등록 → 배포
