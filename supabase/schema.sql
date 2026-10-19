-- 네이버 웹툰 무료회차 댓글수 추적 스키마
-- Supabase 프로젝트의 SQL Editor에서 그대로 실행하면 됩니다.

create table if not exists titles (
  title_id      bigint primary key,
  title_name    text not null,
  author        text,
  thumbnail_url text,
  is_active     boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

-- 이미 배포된 테이블에 새 컬럼을 안전하게 추가 (완결/휴재 여부)
alter table titles add column if not exists is_finished boolean not null default false;
alter table titles add column if not exists is_on_hiatus boolean not null default false;

-- 제작사 정보. cpName(예: "대원_회귀한용병은다계획이있다")에서 첫 "_" 앞부분을 studio_key로 씀.
-- "다중"은 여러 제작사 협업이라 스튜디오를 특정할 신뢰할 만한 공개 정보가 없어 그대로 표기.
-- 언더스코어가 없으면 개인 작가(제작사 없음)로 간주해 "개인"으로 표기.
alter table titles add column if not exists studio_key text;
alter table titles add column if not exists studio_name text;
alter table titles add column if not exists studio_website_url text;

-- 작품 소개 (네이버 article/list/info의 synopsis)
alter table titles add column if not exists synopsis text;

-- 성인/신작 여부 (네이버 titlelist/weekday API의 adult, new 필드 그대로)
alter table titles add column if not exists is_adult boolean not null default false;
alter table titles add column if not exists is_new boolean not null default false;

-- 완결 웹툰은 회차가 더 늘지 않으므로 회차목록+댓글수를 최초 1회만 수집한다.
-- null이면 아직 백필 전 (수집기가 새벽 3:10~8:10 예산 안에서 이어서 처리).
alter table titles add column if not exists finished_backfilled_at timestamptz;

-- 완결 시점(날짜). 수집기가 연재중->완결로 바뀐 걸 처음 본 날, 또는 과거 완결작은 마지막 회차 서비스일로 채움.
-- 완결 후 90일 동안만 일일 수집(댓글수/시리즈 다운로드수)을 이어가고 이후엔 종료한다.
alter table titles add column if not exists finished_at date;

-- 일일 수집이 끝난(완결 후 90일 경과/과거 완결작) 작품의 마지막 총댓글수. comment_snapshots는 매일 최신 날짜
-- 기준으로만 합산하는데 완결작은 더 이상 매일 쌓이지 않으므로, 목록/상세에선 이 값으로 대체해 보여준다.
alter table titles add column if not exists final_comment_total bigint;

-- 네이버 시리즈(series.naver.com) 다운로드수 자동 매칭 시도 여부. null이면 아직 시도 안 함 -
-- 수집기가 매일 밤 이 값이 null인 작품만 새로 매칭 시도해서, 신작이 올라오면 자동으로
-- 시리즈에 연결되고(매칭 성공시 series_products에 저장) 매일 똑같이 실패하는 작품을 계속
-- 재시도하지도 않는다(성공/실패 상관없이 시도했으면 찍음).
alter table titles add column if not exists series_match_checked_at timestamptz;

-- 글/그림/원작 작가 분리 (article/list/info의 communityArtists, 태그 수집과 같이 매일 갱신)
alter table titles add column if not exists writer text;
alter table titles add column if not exists painter text;
alter table titles add column if not exists origin_author text;
-- 실제 연령등급 (article/list/info의 age.description, 예: "15세 이용가" / "전체이용가")
alter table titles add column if not exists age_rating text;

-- 소설 원작 여부 (communityArtists의 ARTIST_NOVEL_ORIGIN 크레딧 또는 curationTagList의
-- NOVEL_ORIGIN 태그로 판별 - 다른 원작 타입(게임/웹툰 등)과 섞이지 않도록 이 값만 콕 집어서 확인)
alter table titles add column if not exists is_novel_origin boolean not null default false;

create table if not exists episodes (
  title_id         bigint not null references titles(title_id),
  no               integer not null,
  subtitle         text,
  service_date     date,
  is_free          boolean not null,
  first_tracked_at timestamptz not null default now(),
  primary key (title_id, no)
);

-- 회차별로 직접 입력하는 트리트먼트(내용 메모). 수집기가 아니라 대시보드에서 사용자가 직접 쓰고 저장함.
create table if not exists episode_notes (
  title_id   bigint not null references titles(title_id),
  no         integer not null,
  treatment  text,
  updated_at timestamptz not null default now(),
  primary key (title_id, no)
);

-- 작품 단위로 직접 입력하는 메모(로그라인/소재/타깃층). episode_notes와 같은 성격.
create table if not exists title_notes (
  title_id        bigint not null primary key references titles(title_id),
  logline         text,
  subject         text,
  target_audience text,
  comment         text,
  updated_at      timestamptz not null default now()
);

alter table title_notes add column if not exists comment text;

-- 노션 등에서 정리한 개인 분석 메모 - 절대 공유 배포(Vercel)에 노출되면 안 되는 내용이라
-- title_notes(공개 읽기 허용)와 분리된 테이블로 둔다. RLS는 켜두되 select/insert/update
-- 정책을 아예 만들지 않아서 anon/authenticated 롤은 기본적으로 아무것도 못 보고 못 쓴다 -
-- service_role만 RLS를 우회해 접근 가능하므로, SUPABASE_SERVICE_ROLE_KEY가 있는 로컬
-- 환경에서만 읽고 쓸 수 있고 공유 URL에서는 이 테이블 존재 자체가 보이지 않는다.
create table if not exists title_private_notes (
  title_id   bigint not null primary key references titles(title_id),
  content    text,
  updated_at timestamptz not null default now()
);
alter table title_private_notes enable row level security;

-- 채용공고 지원 여부 표시(개인용 체크). studio_job_postings는 매일 삭제 후 재삽입되므로
-- 거기에 컬럼을 두면 지원 표시가 매일 사라짐 - source+posting_id로 별도 테이블에 독립 보관.
create table if not exists job_posting_applications (
  source      text not null,
  posting_id  text not null,
  applied_at  timestamptz not null default now(),
  primary key (source, posting_id)
);

-- 채용공고 별표 표시(개인용, 관심 공고 마킹). title_private_notes와 동일하게 RLS만 켜고
-- select/insert/update 정책을 아예 안 만들어서 service_role(로컬)만 접근 가능하게 하고,
-- 공유 URL에서는 존재 자체가 안 보이게 한다(지원 여부처럼 공개 읽기로 두지 않음).
create table if not exists job_posting_stars (
  source      text not null,
  posting_id  text not null,
  starred_at  timestamptz not null default now(),
  primary key (source, posting_id)
);
alter table job_posting_stars enable row level security;

-- 사람인/잡코리아 자동 수집 대상이 아닌 곳(회사 자체 홈페이지, 다른 채용 사이트 등)에 올라온
-- 공고를 직접 등록해서 한 곳에서 관리하기 위한 테이블. 공개 읽기(공유 URL 포함), 쓰기는
-- 다른 관리자 전용 기능과 달리 이건 공유 URL에서도 보여야 하는 기능이라 select는 공개.
create table if not exists manual_job_postings (
  id            bigserial primary key,
  title         text not null,
  company_name  text,
  url           text not null,
  deadline_date date,
  is_closed     boolean not null default false,
  created_at    timestamptz not null default now()
);
alter table manual_job_postings enable row level security;

drop policy if exists "manual_job_postings are publicly readable" on manual_job_postings;
create policy "manual_job_postings are publicly readable"
  on manual_job_postings for select
  using (true);

create table if not exists comment_snapshots (
  title_id      bigint not null,
  no            integer not null,
  snapshot_date date not null,
  comment_count integer not null,
  post_count    integer,
  primary key (title_id, no, snapshot_date),
  foreign key (title_id, no) references episodes(title_id, no)
);

-- (idx_comment_snapshots_lookup(title_id, no, snapshot_date desc)은 기본키와 같은 용도라 267MB만 차지해서 삭제함 -
--  기본키 인덱스가 같은 조회를 역방향 스캔으로 처리한다)
drop index if exists idx_comment_snapshots_lookup;

create index if not exists idx_comment_snapshots_date
  on comment_snapshots (snapshot_date);

-- 작품 단위 일일 지표: 평점, 요일별 랭킹(인기순/별점순/조회순).
-- 랭킹은 네이버가 해당 요일 안에서만 제공하므로(플랫폼 전체 단일 랭킹 없음) weekday별 순위로 저장.
-- 매일+(dailyPlus) 작품은 이 랭킹 API 자체에 포함되지 않아 rank 값들이 NULL일 수 있음.
create table if not exists title_snapshots (
  title_id         bigint not null references titles(title_id),
  snapshot_date    date not null,
  star_score       numeric,
  weekday          text,
  popularity_rank  integer,
  rating_rank      integer,
  view_rank        integer,
  primary key (title_id, snapshot_date)
);

create index if not exists idx_title_snapshots_date
  on title_snapshots (snapshot_date);

-- 요일별 정확한 순위 저장용: title_snapshots는 작품당 하루 1행이라 화/금처럼 여러 요일
-- 연재하는 작품은 요일 하나의 순위만 남고 나머지가 사라지는 문제가 있었음(연재 요일마다
-- 네이버가 순위를 따로 매기므로 값 자체가 다름). 그래서 (작품, 날짜, 요일) 단위로 별도 저장.
create table if not exists title_weekday_ranks (
  title_id         bigint not null references titles(title_id),
  snapshot_date    date not null,
  weekday          text not null,
  popularity_rank  integer,
  rating_rank      integer,
  view_rank        integer,
  primary key (title_id, snapshot_date, weekday)
);

create index if not exists idx_title_weekday_ranks_date
  on title_weekday_ranks (snapshot_date, weekday);

-- comic.naver.com 작품과 네이버 시리즈(series.naver.com) 작품의 매칭 결과.
-- lib/seriesWatchlist.ts의 5개는 사용자가 직접 확인한 것이고, 나머지는 검색으로 자동 매칭됨
-- (scripts/matchSeries.ts). 확신 낮은 건 저장하지 않고 별도 검토용 엑셀로 뽑음.
create table if not exists series_products (
  product_no        bigint primary key,
  title_id          bigint not null references titles(title_id),
  series_title_name text not null,
  matched_at        timestamptz not null default now()
);

create index if not exists idx_series_products_title on series_products (title_id);

-- 과거 완결작의 다운로드수를 "현재 시점 1회"만 채운 경우 true. 하루짜리 스냅샷이라 장르별 누적 추이(genre_download_series)에
-- 넣으면 그날 갑자기 폭증한 것처럼 보이므로 거기선 제외한다.
alter table series_products add column if not exists one_time boolean not null default false;

-- 시리즈 작품의 누적 다운로드수 일일 스냅샷 (product_no는 series_products에 먼저 등록되어 있어야 함,
-- 이미 생성된 테이블이라 FK는 걸지 않고 애플리케이션 레벨에서 순서를 보장)
create table if not exists series_snapshots (
  product_no    bigint not null,
  title_id      bigint references titles(title_id),
  snapshot_date date not null,
  download_count bigint not null,
  primary key (product_no, snapshot_date)
);

create index if not exists idx_series_snapshots_date
  on series_snapshots (snapshot_date);

create index if not exists idx_series_snapshots_title_date
  on series_snapshots (title_id, snapshot_date desc);

-- 작품의 장르/키워드 태그 (comic.naver.com article/list/info의 curationTagList).
-- tag_type: GENRE(장르, curationType이 GENRE_로 시작) | KEYWORD(태그, curationType=CUSTOM_TAG).
-- 매일 최신 상태로 덮어써서(전체 삭제 후 재삽입) 더 이상 안 붙는 태그는 자동으로 빠짐.
create table if not exists title_tags (
  title_id bigint not null references titles(title_id),
  tag_name text not null,
  tag_type text not null,
  primary key (title_id, tag_name)
);

create index if not exists idx_title_tags_tag on title_tags (tag_type, tag_name);

-- 네이버에 다르게 표기된 같은 제작사를 하나로 묶기 위한 별칭 매핑 (titles.studio_name 원문 -> 대표 표기).
-- 제작사 탭/엑셀 다운로드에서 이 테이블을 거쳐 studio_name을 통일해서 보여줌.
create table if not exists studio_aliases (
  raw_name text not null primary key,
  canonical_name text not null
);

insert into studio_aliases (raw_name, canonical_name) values
  ('대원', '대원씨아이'),
  ('더그림', '더그림엔터테인먼트'),
  ('서미코', '서울미디어코믹스'),
  ('서울미디어', '서울미디어코믹스'),
  ('만화가족지점', '만화가족'),
  ('작가컴', '작가컴퍼니'),
  ('재담', '재담미디어'),
  ('재담미디어부천', '재담미디어'),
  ('크릭', '크릭앤리버'),
  ('학산', '학산문화사')
on conflict (raw_name) do update set canonical_name = excluded.canonical_name;

-- 제작사(studio_aliases 반영 후 대표 표기 기준) 채용정보 페이지 URL. 수집기가 매일 이 주소들을 훑어
-- studio_job_postings를 채운다. 주소가 없으면 상세페이지에서 "현재 채용공고가 없습니다"로 표시.
create table if not exists studio_recruit_links (
  studio_name  text not null primary key,
  saramin_url  text,
  jobkorea_url text
);

insert into studio_recruit_links (studio_name, saramin_url, jobkorea_url) values
  ('더그림엔터테인먼트', 'https://www.saramin.co.kr/zf_user/company-info/view-inner-recruit?csn=SVRYMGlVSzBkc0l5QmhXcjBsbHdRQT09', 'https://www.jobkorea.co.kr/Recruit/Co_Read/Recruit/C/41352751?GI_Part_Code=0&Search_Order=1&ChkDispType=1&Part_Btn_Stat=0'),
  ('재담미디어', null, 'https://www.jobkorea.co.kr/Super/jaedam/GiHistoryList?Page=1'),
  ('대원씨아이', 'https://www.saramin.co.kr/zf_user/company-info/view-inner-recruit?csn=TEVIN0pmQmo0NVlCYXNSaEJmQ2pJZz09', 'https://www.jobkorea.co.kr/Recruit/Co_Read/Recruit/C/10907'),
  ('레드아이스', 'https://www.saramin.co.kr/zf_user/company-info/view-inner-recruit?csn=RzJqQlF4NndsTWY4TDlta2EzekNWZz09', 'https://www.jobkorea.co.kr/Recruit/Co_Read/Recruit/C/31484718'),
  ('크랙', 'https://www.saramin.co.kr/zf_user/company-info/view-inner-recruit?csn=eWVyeitoS0kycEhiaU91YTJOZUlldz09', 'https://www.jobkorea.co.kr/Recruit/Co_Read/Recruit/C/40921856'),
  ('와이랩', 'https://www.saramin.co.kr/zf_user/company-info/view-inner-recruit?csn=ald3Z1R6ZnAxVmh3Z0FBdDZTNVp5Zz09', 'https://www.jobkorea.co.kr/Recruit/Co_Read/Recruit/C/13004401'),
  ('서울미디어코믹스', 'https://www.saramin.co.kr/zf_user/company-info/view-inner-recruit?csn=UlI0b2ZsblZtTjdFVUlSanNGZ0xXQT09', null),
  ('작가컴퍼니', 'https://www.saramin.co.kr/zf_user/company-info/view-inner-recruit?csn=MlhzWWxHbCtQRWUwUXZNQXZnZEdzdz09', 'https://www.jobkorea.co.kr/Recruit/Co_Read/Recruit/C/24070038'),
  ('문피아', 'https://www.saramin.co.kr/zf_user/company-info/view-inner-recruit?csn=RTJtTkNVOWZxQjRsb1cvNnB5WG9wUT09', 'https://www.jobkorea.co.kr/company/46130932/Recruit'),
  ('씨엔씨', 'https://www.saramin.co.kr/zf_user/company-info/view-inner-recruit?csn=VW9FODNXOUxHeVh3T0M4RmhoUjRBdz09', 'https://www.jobkorea.co.kr/Super/cncrevolution/GiHistoryList?Page=1'),
  ('스튜디오JHS', 'https://www.saramin.co.kr/zf_user/company-info/view-inner-recruit?csn=MFNOZVNaeHNxdThpdFNxdVhza1V0Zz09', null),
  ('스튜디오389', 'https://www.saramin.co.kr/zf_user/company-info/view-inner-recruit?csn=Z2JkRlFSRFp4S3VUT0NFRDlXa3ZtZz09', 'https://www.jobkorea.co.kr/Recruit/Co_Read/Recruit/C/34976770'),
  ('정선율스튜디오', 'https://www.saramin.co.kr/zf_user/company-info/view-inner-recruit?csn=dE8wL3JaOEhuZ0RobUhUeWVFV0s4UT09', 'https://www.jobkorea.co.kr/Recruit/Co_Read/Recruit/C/38651782'),
  ('학산문화사', 'https://www.saramin.co.kr/zf_user/company-info/view-inner-recruit?csn=KzJuakR4MG85N1I5cUM3RzEyK25RUT09', 'https://www.jobkorea.co.kr/Recruit/Co_Read/Recruit/C/224264'),
  ('엠스토리허브', 'https://www.saramin.co.kr/zf_user/company-info/view-inner-recruit?csn=Qnk5MmVsOGc3REJqRXpGUWtxU3BMdz09', 'https://www.jobkorea.co.kr/Recruit/Co_Read/Recruit/C/16965876'),
  ('리코', 'https://www.saramin.co.kr/zf_user/company-info/view-inner-recruit?csn=MVRmZExvMVR1dld3UFlXWURvdUxDUT09', 'https://www.jobkorea.co.kr/company/16152412/Recruit'),
  ('위즈덤하우스', 'https://www.saramin.co.kr/zf_user/company-info/view-inner-recruit?csn=clo4S0NYbUNQK1JPNGNHeDJNaUc4Zz09', 'https://www.jobkorea.co.kr/Recruit/Co_Read/Recruit/C/163181?GI_Part_Code=0&Search_Order=1&ChkDispType=0&Part_Btn_Stat=0'),
  ('제이큐', 'https://www.saramin.co.kr/zf_user/company-info/view-inner-recruit?csn=VFJHck9MVSthU0JRWGJzMHNHbC9jQT09', null),
  ('블루픽', 'https://www.saramin.co.kr/zf_user/company-info/view-inner-recruit?csn=WVA1b0E4SzRxcXk0S0t3UThoSnlMQT09', 'https://www.jobkorea.co.kr/Recruit/Co_Read/Recruit/C/33807023'),
  ('투니드', 'https://www.saramin.co.kr/zf_user/company-info/view-inner-recruit?csn=NzNaVi83TFBDRkRxRkxmbFVreWxZZz09', 'https://www.jobkorea.co.kr/Recruit/Co_Read/Recruit/C/22311686')
on conflict (studio_name) do update set
  saramin_url = excluded.saramin_url,
  jobkorea_url = excluded.jobkorea_url;

-- 수집기가 studio_recruit_links를 훑어서 채운 채용공고 스냅샷. 매번 전체 삭제 후 재삽입해서
-- 최신 상태(진행중/마감)를 그대로 반영한다.
create table if not exists studio_job_postings (
  id            bigserial primary key,
  studio_name   text not null,
  source        text not null, -- 'SARAMIN' | 'JOBKOREA'
  posting_id    text not null,
  title         text not null,
  url           text not null,
  status        text not null, -- 'ACTIVE' | 'CLOSED'
  dday          text, -- 사람인: 마감일 텍스트, 잡코리아: D-N/"마감 (~날짜)" 원문
  last_seen_at  timestamptz not null default now(),
  unique (studio_name, source, posting_id)
);

alter table studio_job_postings add column if not exists dday text;

create index if not exists idx_studio_job_postings_studio on studio_job_postings (studio_name);
create index if not exists idx_studio_job_postings_status on studio_job_postings (status);

-- 특정 제작사에 묶이지 않는 키워드 검색 채용공고("웹툰PD" 등 - 지정 제작사 외에도 올라오는
-- 공고까지 훑기 위함). 사람인/잡코리아 키워드 검색 결과 자체가 관련도 기반이라 무관한 공고도
-- 섞여 오므로, 저장 전에 제목에 실제로 키워드 핵심어가 포함된 것만 걸러서 넣는다.
create table if not exists keyword_job_postings (
  id            bigserial primary key,
  keyword       text not null,
  source        text not null, -- 'SARAMIN' | 'JOBKOREA'
  posting_id    text not null,
  title         text not null,
  company_name  text,
  url           text not null,
  status        text not null, -- 'ACTIVE' | 'CLOSED'
  dday          text,
  last_seen_at  timestamptz not null default now(),
  unique (keyword, source, posting_id)
);

create index if not exists idx_keyword_job_postings_keyword on keyword_job_postings (keyword);

-- 네이버 실시간 랭킹(/api/realtime/ranking/list) - 요일 구분 없는 진짜 플랫폼 전체 순위.
-- rank_tab_type: DEFAULT(실시간 인기랭킹) | NEW(실시간 신작랭킹).
-- 다만 위젯 특성상 TOTAL/MALE/FEMALE 각각 TOP 5까지만 제공됨.
create table if not exists realtime_ranking_snapshots (
  rank_tab_type text not null default 'DEFAULT', -- DEFAULT | NEW
  category      text not null, -- TOTAL | MALE | FEMALE
  rank          integer not null,
  title_id      bigint not null references titles(title_id),
  snapshot_date date not null
);

alter table realtime_ranking_snapshots add column if not exists rank_tab_type text not null default 'DEFAULT';
alter table realtime_ranking_snapshots drop constraint if exists realtime_ranking_snapshots_pkey;
alter table realtime_ranking_snapshots add primary key (rank_tab_type, category, rank, snapshot_date);

create index if not exists idx_realtime_ranking_date
  on realtime_ranking_snapshots (snapshot_date);

-- Row Level Security: 읽기는 누구나(anon), 쓰기는 service role만 가능
alter table titles enable row level security;
alter table episodes enable row level security;
alter table comment_snapshots enable row level security;
alter table title_snapshots enable row level security;
alter table series_snapshots enable row level security;
alter table series_products enable row level security;
alter table realtime_ranking_snapshots enable row level security;
alter table title_tags enable row level security;
alter table studio_aliases enable row level security;
alter table studio_recruit_links enable row level security;
alter table studio_job_postings enable row level security;
alter table keyword_job_postings enable row level security;
alter table episode_notes enable row level security;
alter table title_notes enable row level security;
alter table job_posting_applications enable row level security;

drop policy if exists "titles are publicly readable" on titles;
create policy "titles are publicly readable"
  on titles for select
  using (true);

-- 제작사명 등 수정은 앱이 service role(관리자 전용, 로컬에서만 키가 있음)로만 하도록
-- anon 쓰기 정책을 없앰 - 공유 배포 주소에서는 API를 직접 두드려도 수정이 안 되게 하기 위함.
drop policy if exists "titles studio_name is publicly updatable" on titles;

drop policy if exists "episodes are publicly readable" on episodes;
create policy "episodes are publicly readable"
  on episodes for select
  using (true);

drop policy if exists "comment_snapshots are publicly readable" on comment_snapshots;
create policy "comment_snapshots are publicly readable"
  on comment_snapshots for select
  using (true);

drop policy if exists "title_snapshots are publicly readable" on title_snapshots;
create policy "title_snapshots are publicly readable"
  on title_snapshots for select
  using (true);

alter table title_weekday_ranks enable row level security;
drop policy if exists "title_weekday_ranks are publicly readable" on title_weekday_ranks;
create policy "title_weekday_ranks are publicly readable"
  on title_weekday_ranks for select
  using (true);

drop policy if exists "series_snapshots are publicly readable" on series_snapshots;
create policy "series_snapshots are publicly readable"
  on series_snapshots for select
  using (true);

drop policy if exists "series_products are publicly readable" on series_products;
create policy "series_products are publicly readable"
  on series_products for select
  using (true);

drop policy if exists "realtime_ranking_snapshots are publicly readable" on realtime_ranking_snapshots;
create policy "realtime_ranking_snapshots are publicly readable"
  on realtime_ranking_snapshots for select
  using (true);

drop policy if exists "studio_aliases are publicly readable" on studio_aliases;
create policy "studio_aliases are publicly readable"
  on studio_aliases for select
  using (true);

drop policy if exists "studio_recruit_links are publicly readable" on studio_recruit_links;
create policy "studio_recruit_links are publicly readable"
  on studio_recruit_links for select
  using (true);

drop policy if exists "studio_job_postings are publicly readable" on studio_job_postings;
create policy "studio_job_postings are publicly readable"
  on studio_job_postings for select
  using (true);

drop policy if exists "keyword_job_postings are publicly readable" on keyword_job_postings;
create policy "keyword_job_postings are publicly readable"
  on keyword_job_postings for select
  using (true);

drop policy if exists "title_tags are publicly readable" on title_tags;
create policy "title_tags are publicly readable"
  on title_tags for select
  using (true);

-- service_role 키는 RLS를 우회하므로 쓰기용 정책은 별도로 필요 없음 (수집기는 service role key 사용)

-- episode_notes/title_notes/job_posting_applications: anon에게는 읽기만 허용.
-- 쓰기는 대시보드가 service role(로컬 전용 키)로만 하도록 앱 코드에서 강제함 - 공유 배포
-- 주소에는 이 키를 넣지 않아서 API를 직접 두드려도 수정이 안 됨.
drop policy if exists "episode_notes are publicly readable" on episode_notes;
create policy "episode_notes are publicly readable"
  on episode_notes for select
  using (true);

-- 쓰기(insert/update/delete)는 이제 anon 정책을 두지 않음: 앱은 service role(로컬 전용 키)로만
-- 쓰고, 공유 배포 주소에서는 이 테이블들에 읽기만 되고 API를 직접 두드려도 수정이 안 됨.
drop policy if exists "episode_notes are publicly writable" on episode_notes;
drop policy if exists "episode_notes are publicly updatable" on episode_notes;

drop policy if exists "title_notes are publicly readable" on title_notes;
create policy "title_notes are publicly readable"
  on title_notes for select
  using (true);
drop policy if exists "title_notes are publicly writable" on title_notes;
drop policy if exists "title_notes are publicly updatable" on title_notes;

drop policy if exists "job_posting_applications are publicly readable" on job_posting_applications;
create policy "job_posting_applications are publicly readable"
  on job_posting_applications for select
  using (true);
drop policy if exists "job_posting_applications are publicly writable" on job_posting_applications;
drop policy if exists "job_posting_applications are publicly deletable" on job_posting_applications;

-- 대시보드용 헬퍼 함수 (anon 키로 호출, RPC)

create or replace function latest_snapshot_date()
returns date
language sql
stable
as $$
  select max(snapshot_date) from comment_snapshots;
$$;

create or replace function top_movers(result_limit int default 20)
returns table (
  title_id bigint,
  no integer,
  title_name text,
  subtitle text,
  thumbnail_url text,
  comment_count integer,
  delta integer
)
language sql
stable
as $$
  with dates as (
    select distinct snapshot_date
    from comment_snapshots
    order by snapshot_date desc
    limit 2
  ),
  latest as (
    select snapshot_date from dates order by snapshot_date desc limit 1
  ),
  previous as (
    select snapshot_date from dates order by snapshot_date desc offset 1 limit 1
  ),
  today as (
    select cs.title_id, cs.no, cs.comment_count
    from comment_snapshots cs, latest
    where cs.snapshot_date = latest.snapshot_date
  ),
  yesterday as (
    select cs.title_id, cs.no, cs.comment_count
    from comment_snapshots cs, previous
    where cs.snapshot_date = previous.snapshot_date
  )
  select
    t.title_id,
    t.no,
    ti.title_name,
    e.subtitle,
    ti.thumbnail_url,
    t.comment_count,
    (t.comment_count - coalesce(y.comment_count, 0)) as delta
  from today t
  join episodes e on e.title_id = t.title_id and e.no = t.no
  join titles ti on ti.title_id = t.title_id
  left join yesterday y on y.title_id = t.title_id and y.no = t.no
  order by delta desc
  limit result_limit;
$$;

drop function if exists overall_star_ranking(int);

-- 요일별 인기순위 (네이버 order=user 기준, 해당 요일 안에서의 순위)
drop function if exists weekday_popularity_ranking(text, int);
create or replace function weekday_popularity_ranking(target_weekday text, result_limit int default 30)
returns table (
  title_id bigint,
  title_name text,
  thumbnail_url text,
  popularity_rank integer,
  is_novel_origin boolean,
  launch_date date,
  download_count bigint,
  total_comment_count bigint,
  star_score numeric
)
language sql
stable
as $$
  with latest as (
    select snapshot_date from title_weekday_ranks order by snapshot_date desc limit 1
  ),
  naver_launch as (
    select title_id, min(service_date) as launch_date from episodes group by title_id
  ),
  latest_series_date as (
    select title_id, max(snapshot_date) as snapshot_date from series_snapshots group by title_id
  ),
  series_latest as (
    select ss.title_id, ss.download_count
    from series_snapshots ss
    join latest_series_date lsd on lsd.title_id = ss.title_id and lsd.snapshot_date = ss.snapshot_date
  ),
  latest_comment_date as (
    select max(snapshot_date) as snapshot_date from comment_snapshots
  ),
  comment_totals as (
    select cs.title_id, sum(cs.comment_count) as total_comment_count
    from comment_snapshots cs, latest_comment_date lcd
    where cs.snapshot_date = lcd.snapshot_date
    group by cs.title_id
  ),
  star_latest as (
    select snapshot_date from title_snapshots order by snapshot_date desc limit 1
  )
  select
    twr.title_id, ti.title_name, ti.thumbnail_url, twr.popularity_rank, ti.is_novel_origin,
    coalesce(nl.launch_date, ti.first_seen_at::date) as launch_date,
    sl.download_count,
    coalesce(ct.total_comment_count, ti.final_comment_total)::bigint as total_comment_count,
    ts.star_score
  from title_weekday_ranks twr
  join latest on twr.snapshot_date = latest.snapshot_date
  join titles ti on ti.title_id = twr.title_id
  left join naver_launch nl on nl.title_id = twr.title_id
  left join series_latest sl on sl.title_id = twr.title_id
  left join comment_totals ct on ct.title_id = twr.title_id
  left join title_snapshots ts on ts.title_id = twr.title_id and ts.snapshot_date = (select snapshot_date from star_latest)
  where twr.weekday = target_weekday and twr.popularity_rank is not null and ti.is_active = true
  order by twr.popularity_rank asc
  limit result_limit;
$$;

-- 신작 인기순위는 네이버 실시간 신작랭킹(realtime_ranking_snapshots, rank_tab_type='NEW')으로 대체되어 더 이상 사용하지 않음.
drop function if exists new_release_popularity_ranking(int, int);

-- 전체 작품 리스트(연재구분/상태/런칭일 필터 + 정렬 + 페이지네이션). total_count는 윈도우 함수라 limit/offset 이전 전체 건수를 반환.
-- filter_type: null/'all' | 'weekday'(요일웹툰) | 'daily_plus'(매일+)
-- filter_status: null/'all' | 'ongoing'(연재중) | 'new'(신작) | 'finished'(완결) | 'hiatus'(휴재)
-- filter_launch_from/to: 1화 등록일(launch_date) 범위 필터, null이면 미적용
-- sort_by: 'name' | 'popularity' | 'star' | 'launch'(런칭일순)
drop function if exists list_titles(text, text, text, int, int);
drop function if exists list_titles(text, text, text, int, int, boolean);
drop function if exists list_titles(text, text, text, int, int, boolean, date, date);
create or replace function list_titles(
  filter_type text default null,
  filter_status text default null,
  sort_by text default 'name',
  page_num int default 1,
  page_size int default 50,
  filter_adult_only boolean default false,
  filter_launch_from date default null,
  filter_launch_to date default null
)
returns table (
  title_id bigint,
  title_name text,
  thumbnail_url text,
  author text,
  studio_name text,
  is_finished boolean,
  is_on_hiatus boolean,
  is_adult boolean,
  is_new boolean,
  weekday text,
  star_score numeric,
  popularity_rank integer,
  launch_date date,
  total_comment_count bigint,
  is_novel_origin boolean,
  download_count bigint,
  total_count bigint
)
language sql
stable
as $$
  with latest as (
    select snapshot_date from title_snapshots order by snapshot_date desc limit 1
  ),
  latest_comment_date as (
    select max(snapshot_date) as snapshot_date from comment_snapshots
  ),
  comment_totals as (
    select cs.title_id, sum(cs.comment_count) as total_comment_count
    from comment_snapshots cs, latest_comment_date lcd
    where cs.snapshot_date = lcd.snapshot_date
    group by cs.title_id
  ),
  latest_series_date as (
    select title_id, max(snapshot_date) as snapshot_date from series_snapshots group by title_id
  ),
  series_latest as (
    select ss.title_id, ss.download_count
    from series_snapshots ss
    join latest_series_date lsd on lsd.title_id = ss.title_id and lsd.snapshot_date = ss.snapshot_date
  ),
  base as (
    select
      ti.title_id, ti.title_name, ti.thumbnail_url, ti.author, ti.studio_name,
      ti.is_finished, ti.is_on_hiatus, ti.is_adult, ti.is_new,
      ts.weekday, ts.star_score, ts.popularity_rank,
      -- 성인 작품은 회차 목록 API가 막혀있어 episodes.service_date를 알 수 없음(항상 null) -
      -- 이 경우 우리 수집기가 처음 그 작품을 발견한 날짜(first_seen_at)를 런칭일 대용으로 사용
      coalesce(
        (select min(e.service_date) from episodes e where e.title_id = ti.title_id),
        ti.first_seen_at::date
      ) as launch_date,
      coalesce(ct.total_comment_count, ti.final_comment_total)::bigint as total_comment_count,
      ti.is_novel_origin,
      sl.download_count
    from titles ti
    left join title_snapshots ts
      on ts.title_id = ti.title_id and ts.snapshot_date = (select snapshot_date from latest)
    left join comment_totals ct on ct.title_id = ti.title_id
    left join series_latest sl on sl.title_id = ti.title_id
    where ti.is_active = true
      and (filter_adult_only = false or ti.is_adult = true)
      and (
        filter_type is null or filter_type = 'all'
        or (filter_type = 'weekday' and ts.weekday is not null and ts.weekday <> 'DAILY_PLUS')
        or (filter_type = 'daily_plus' and ts.weekday = 'DAILY_PLUS')
      )
      and (
        filter_status is null or filter_status = 'all'
        or (filter_status = 'finished' and ti.is_finished = true)
        or (filter_status = 'hiatus' and ti.is_on_hiatus = true)
        or (filter_status = 'new' and ti.is_new = true)
        or (filter_status = 'ongoing' and ti.is_finished = false and ti.is_on_hiatus = false)
      )
  ),
  filtered as (
    select *
    from base
    where (filter_launch_from is null or launch_date >= filter_launch_from)
      and (filter_launch_to is null or launch_date <= filter_launch_to)
  )
  select f.*, count(*) over() as total_count
  from filtered f
  order by
    case when sort_by = 'star' then f.star_score end desc nulls last,
    case when sort_by = 'popularity' then f.popularity_rank end asc nulls last,
    case when sort_by = 'launch' then f.launch_date end desc nulls last,
    case when sort_by = 'comments' then f.total_comment_count end desc nulls last,
    f.title_name asc
  limit page_size offset (page_num - 1) * page_size;
$$;

-- 전체 작품 리스트를 네이버+카카오 통합해서 보여주는 버전. list_titles는 그대로 두고(홈 화면
-- "이번주 신작" 등 네이버 전용 용도에서 계속 씀) 이 함수는 /titles 페이지 전용.
-- filter_platform: 'all' | 'naver' | 'kakao'
-- filter_type(요일웹툰/매일+)은 네이버에만 있는 개념이라, 'all'이 아니면 카카오 작품은 결과에서 빠짐.
-- sort_by 중 popularity/star/comments는 네이버 행에만, views/likes는 카카오 행에만 값이 있고
-- 나머지 플랫폼 행은 해당 정렬에서 nulls last로 뒤로 밀림(정렬 기준이 없는 게 맞으므로 정상 동작).
drop function if exists list_titles_unified(text, text, text, text, int, int, boolean, date, date);
drop function if exists list_titles_unified(text, text, text, text, int, int, boolean, date, date, text);
create or replace function list_titles_unified(
  filter_platform text default 'all',
  filter_type text default 'all',
  filter_status text default 'all',
  sort_by text default 'name',
  page_num int default 1,
  page_size int default 50,
  filter_adult_only boolean default false,
  filter_launch_from date default null,
  filter_launch_to date default null,
  filter_genre text default 'all'
)
returns table (
  id bigint,
  platform text,
  title_name text,
  thumbnail_url text,
  author text,
  studio_name text,
  is_finished boolean,
  is_on_hiatus boolean,
  is_adult boolean,
  is_new boolean,
  weekday text,
  launch_date date,
  popularity_rank integer,
  star_score numeric,
  comment_count bigint,
  view_count bigint,
  like_count bigint,
  download_count bigint,
  total_count bigint
)
language sql
stable
as $$
  with naver_latest as (
    select snapshot_date from title_snapshots order by snapshot_date desc limit 1
  ),
  naver_comment_date as (
    select max(snapshot_date) as snapshot_date from comment_snapshots
  ),
  naver_comment_totals as (
    select cs.title_id, sum(cs.comment_count) as total_comment_count
    from comment_snapshots cs, naver_comment_date d
    where cs.snapshot_date = d.snapshot_date
    group by cs.title_id
  ),
  -- 작품마다 correlated subquery로 launch_date를 구하면(list_titles의 원래 방식) 작품 수가
  -- 많아질수록 느려져서 여기(카카오까지 합쳐 두 배로 도는 통합 함수)선 실제로 statement timeout이
  -- 났음 - episodes/kakao_episodes를 미리 한 번만 집계해서 join하는 방식으로 바꿔서 해결.
  naver_launch as (
    select title_id, min(service_date) as launch_date from episodes group by title_id
  ),
  -- download_count: idx_series_snapshots_title_date(title_id, snapshot_date desc) 인덱스로
  -- LATERAL에서 title당 최신 1건만 인덱스로 바로 찾게 해서(전체 집계 대신) 비용을 최소화함
  naver_rows as (
    select
      ti.title_id as id,
      'naver'::text as platform,
      ti.title_name,
      ti.thumbnail_url,
      ti.author,
      coalesce(sa.canonical_name, ti.studio_name) as studio_name,
      ti.is_finished,
      ti.is_on_hiatus,
      ti.is_adult,
      ti.is_new,
      ts.weekday,
      coalesce(nl.launch_date, ti.first_seen_at::date) as launch_date,
      ts.popularity_rank,
      ts.star_score,
      coalesce(ct.total_comment_count, ti.final_comment_total)::bigint as comment_count,
      null::bigint as view_count,
      null::bigint as like_count,
      sl.download_count
    from titles ti
    left join title_snapshots ts
      on ts.title_id = ti.title_id and ts.snapshot_date = (select snapshot_date from naver_latest)
    left join naver_comment_totals ct on ct.title_id = ti.title_id
    left join studio_aliases sa on sa.raw_name = ti.studio_name
    left join naver_launch nl on nl.title_id = ti.title_id
    left join lateral (
      select ss.download_count
      from series_snapshots ss
      where ss.title_id = ti.title_id
      order by ss.snapshot_date desc
      limit 1
    ) sl on true
    where ti.is_active = true
      and (filter_platform = 'all' or filter_platform = 'naver')
      and (filter_adult_only = false or ti.is_adult = true)
      and (
        filter_type = 'all'
        or (filter_type = 'weekday' and ts.weekday is not null and ts.weekday <> 'DAILY_PLUS')
        or (filter_type = 'daily_plus' and ts.weekday = 'DAILY_PLUS')
      )
      and (
        filter_status = 'all'
        or (filter_status = 'finished' and ti.is_finished = true)
        or (filter_status = 'hiatus' and ti.is_on_hiatus = true)
        or (filter_status = 'new' and ti.is_new = true)
        or (filter_status = 'ongoing' and ti.is_finished = false and ti.is_on_hiatus = false)
      )
      and (
        filter_genre = 'all'
        or exists (
          select 1 from title_tags tg
          where tg.title_id = ti.title_id
            and tg.tag_type = 'GENRE'
            and tg.tag_name = filter_genre
        )
      )
  ),
  kakao_latest as (
    select snapshot_date from kakao_stat_snapshots order by snapshot_date desc limit 1
  ),
  kakao_launch as (
    select content_id, min(service_date) as launch_date from kakao_episodes group by content_id
  ),
  kakao_rows as (
    select
      kt.content_id as id,
      'kakao'::text as platform,
      kt.title_name,
      kt.thumbnail_url,
      nullif(trim(both ', ' from concat_ws(', ', kt.writer, kt.painter)), '') as author,
      kt.studio_name,
      kt.is_finished,
      kt.is_on_hiatus,
      kt.is_adult,
      false as is_new,
      null::text as weekday,
      coalesce(kl.launch_date, kt.first_seen_at::date) as launch_date,
      null::integer as popularity_rank,
      null::numeric as star_score,
      null::bigint as comment_count,
      kss.view_count,
      kss.like_count,
      null::bigint as download_count
    from kakao_titles kt
    left join kakao_stat_snapshots kss
      on kss.content_id = kt.content_id and kss.snapshot_date = (select snapshot_date from kakao_latest)
    left join kakao_launch kl on kl.content_id = kt.content_id
    where kt.is_active = true
      and (filter_platform = 'all' or filter_platform = 'kakao')
      and filter_type = 'all'
      and (filter_adult_only = false or kt.is_adult = true)
      and (
        filter_status = 'all'
        or (filter_status = 'finished' and kt.is_finished = true)
        or (filter_status = 'hiatus' and kt.is_on_hiatus = true)
        or (filter_status = 'ongoing' and kt.is_finished = false and kt.is_on_hiatus = false)
        -- 'new'(신작)는 네이버 전용 개념이라 카카오 쪽은 이 필터에서 항상 제외됨
      )
      and (filter_genre = 'all' or filter_genre = any(kt.genres))
  ),
  combined as (
    select * from naver_rows
    union all
    select * from kakao_rows
  ),
  filtered as (
    select *
    from combined
    where (filter_launch_from is null or launch_date >= filter_launch_from)
      and (filter_launch_to is null or launch_date <= filter_launch_to)
  )
  select f.*, count(*) over() as total_count
  from filtered f
  order by
    case when sort_by = 'star' then f.star_score end desc nulls last,
    case when sort_by = 'popularity' then f.popularity_rank end asc nulls last,
    case when sort_by = 'launch' then f.launch_date end desc nulls last,
    case when sort_by = 'comments' then f.comment_count end desc nulls last,
    case when sort_by = 'views' then f.view_count end desc nulls last,
    case when sort_by = 'likes' then f.like_count end desc nulls last,
    case when sort_by = 'downloads' then f.download_count end desc nulls last,
    f.title_name asc
  limit page_size offset (page_num - 1) * page_size;
$$;

grant execute on function list_titles_unified(text, text, text, text, int, int, boolean, date, date, text) to anon;

-- 제작사 탭용: 활성 작품 전체를 제작사 정보와 함께 반환 (제작사별 그룹핑은 애플리케이션 레벨에서 처리)
drop function if exists titles_by_studio();
create or replace function titles_by_studio()
returns table (
  title_id bigint,
  title_name text,
  thumbnail_url text,
  studio_name text,
  studio_website_url text,
  weekday text,
  popularity_rank integer,
  star_score numeric,
  download_count bigint,
  launch_date date,
  total_comment_count bigint
)
language sql
stable
as $$
  with latest as (
    select snapshot_date from title_snapshots order by snapshot_date desc limit 1
  ),
  latest_series_date as (
    select title_id, max(snapshot_date) as snapshot_date
    from series_snapshots
    group by title_id
  ),
  series_latest as (
    select ss.title_id, ss.download_count
    from series_snapshots ss
    join latest_series_date lsd
      on lsd.title_id = ss.title_id and lsd.snapshot_date = ss.snapshot_date
  ),
  naver_launch as (
    select title_id, min(service_date) as launch_date from episodes group by title_id
  ),
  latest_comment_date as (
    select max(snapshot_date) as snapshot_date from comment_snapshots
  ),
  comment_totals as (
    select cs.title_id, sum(cs.comment_count) as total_comment_count
    from comment_snapshots cs, latest_comment_date lcd
    where cs.snapshot_date = lcd.snapshot_date
    group by cs.title_id
  )
  select
    ti.title_id, ti.title_name, ti.thumbnail_url,
    coalesce(sa.canonical_name, ti.studio_name) as studio_name,
    ti.studio_website_url,
    ts.weekday, ts.popularity_rank, ts.star_score,
    sl.download_count,
    coalesce(nl.launch_date, ti.first_seen_at::date) as launch_date,
    coalesce(ct.total_comment_count, ti.final_comment_total)::bigint as total_comment_count
  from titles ti
  left join title_snapshots ts
    on ts.title_id = ti.title_id and ts.snapshot_date = (select snapshot_date from latest)
  left join studio_aliases sa on sa.raw_name = ti.studio_name
  left join series_latest sl on sl.title_id = ti.title_id
  left join naver_launch nl on nl.title_id = ti.title_id
  left join comment_totals ct on ct.title_id = ti.title_id
  where ti.is_active = true and ti.studio_name is not null;
$$;

-- 제작사 탭용 카카오 버전: 스튜디오명(kakao_titles.studio_name, 프로필의 PUBLISHER 작가 표기)이
-- 있는 활성 작품 전체 반환. 네이버 titles_by_studio()와 이름이 같은 제작사는 애플리케이션 레벨에서
-- studio_name 문자열 기준으로 같은 그룹에 합쳐짐(별도 별칭 매핑은 하지 않음).
drop function if exists kakao_titles_by_studio();
create or replace function kakao_titles_by_studio()
returns table (
  content_id bigint,
  title_name text,
  thumbnail_url text,
  studio_name text,
  view_count bigint,
  like_count bigint,
  launch_date date
)
language sql
stable
as $$
  with latest as (
    select snapshot_date from kakao_stat_snapshots order by snapshot_date desc limit 1
  ),
  kakao_launch as (
    select content_id, min(service_date) as launch_date from kakao_episodes group by content_id
  )
  select
    kt.content_id, kt.title_name, kt.thumbnail_url, kt.studio_name,
    kss.view_count, kss.like_count,
    coalesce(kl.launch_date, kt.first_seen_at::date) as launch_date
  from kakao_titles kt
  left join kakao_stat_snapshots kss
    on kss.content_id = kt.content_id and kss.snapshot_date = (select snapshot_date from latest)
  left join kakao_launch kl on kl.content_id = kt.content_id
  where kt.is_active = true and kt.studio_name is not null;
$$;

grant execute on function kakao_titles_by_studio() to anon;

-- 다운로드수 상위 작품 랭킹(제작사 포함) - 홈 화면용
drop function if exists top_titles_by_download(int);
create or replace function top_titles_by_download(result_limit int default 10)
returns table (
  title_id bigint,
  title_name text,
  thumbnail_url text,
  studio_name text,
  download_count bigint,
  is_novel_origin boolean,
  weekday text,
  launch_date date,
  total_comment_count bigint,
  star_score numeric
)
language sql
stable
as $$
  with latest_series_date as (
    select title_id, max(snapshot_date) as snapshot_date
    from series_snapshots
    group by title_id
  ),
  series_latest as (
    select ss.title_id, ss.download_count
    from series_snapshots ss
    join latest_series_date lsd
      on lsd.title_id = ss.title_id and lsd.snapshot_date = ss.snapshot_date
  ),
  naver_latest as (
    select snapshot_date from title_snapshots order by snapshot_date desc limit 1
  ),
  naver_launch as (
    select title_id, min(service_date) as launch_date from episodes group by title_id
  ),
  latest_comment_date as (
    select max(snapshot_date) as snapshot_date from comment_snapshots
  ),
  comment_totals as (
    select cs.title_id, sum(cs.comment_count) as total_comment_count
    from comment_snapshots cs, latest_comment_date lcd
    where cs.snapshot_date = lcd.snapshot_date
    group by cs.title_id
  )
  select
    ti.title_id, ti.title_name, ti.thumbnail_url,
    coalesce(sa.canonical_name, ti.studio_name) as studio_name,
    sl.download_count, ti.is_novel_origin,
    ts.weekday,
    coalesce(nl.launch_date, ti.first_seen_at::date) as launch_date,
    coalesce(ct.total_comment_count, ti.final_comment_total)::bigint as total_comment_count,
    ts.star_score
  from titles ti
  join series_latest sl on sl.title_id = ti.title_id
  left join studio_aliases sa on sa.raw_name = ti.studio_name
  left join title_snapshots ts on ts.title_id = ti.title_id and ts.snapshot_date = (select snapshot_date from naver_latest)
  left join naver_launch nl on nl.title_id = ti.title_id
  left join comment_totals ct on ct.title_id = ti.title_id
  where ti.is_active = true
  order by sl.download_count desc
  limit result_limit;
$$;

-- 장르/키워드 통계: 진짜 연재중인(완결/휴재 제외) 작품 중 해당 태그가 붙은 작품 수 상위 N개.
-- tag_type_filter: 'GENRE' | 'KEYWORD'
-- 통계 탭용: tag_stats와 같지만 완결/휴재 작품까지 포함해서 센다(네이버 태그 검색 결과 개수와 같은 기준).
-- 런칭 추이 그래프가 완결작까지 포함해 그리므로 태그 선택창의 개수도 같은 기준이어야 맞는다.
create or replace function tag_stats_all(tag_type_filter text, result_limit int default 15)
returns table (tag_name text, title_count bigint)
language sql
stable
as $
  select tt.tag_name, count(*) as title_count
  from title_tags tt
  join titles ti on ti.title_id = tt.title_id
  where ti.is_active = true
    and tt.tag_type = tag_type_filter
  group by tt.tag_name
  order by title_count desc, tt.tag_name asc
  limit result_limit;
$;
grant execute on function tag_stats_all(text, int) to anon;

create or replace function tag_stats(tag_type_filter text, result_limit int default 15)
returns table (tag_name text, title_count bigint)
language sql
stable
as $$
  select tt.tag_name, count(*) as title_count
  from title_tags tt
  join titles ti on ti.title_id = tt.title_id
  where ti.is_active = true
    and ti.is_finished = false
    and ti.is_on_hiatus = false
    and tt.tag_type = tag_type_filter
  group by tt.tag_name
  order by title_count desc, tt.tag_name asc
  limit result_limit;
$$;

-- 전체 작품 엑셀 내보내기용(네이버+카카오 통합). 예전 네이버 전용 export_titles_data는
-- 이 함수로 완전히 대체돼서 삭제함(이미 실행해뒀다면: drop function if exists
-- export_titles_data(text, text, boolean, date, date, text);).
-- 카카오는 댓글수 API 차단, 인기순위 API 신뢰불가로 두 값 다 null - 대신 조회수/좋아요수를 넣는다.
drop function if exists export_titles_data(text);
drop function if exists export_titles_data(text, text, boolean, date, date);
drop function if exists export_titles_data(text, text, boolean, date, date, text);
-- genre는 kakao_titles.genres 배열을 그대로 join(', ')한 값
-- (네이버처럼 정식 장르 태그가 아니라 해시태그 키워드임).
drop function if exists export_titles_data_unified(text, text, text, boolean, date, date, text);
drop function if exists export_titles_data_unified(text, text, text, boolean, date, date, text, text);
create or replace function export_titles_data_unified(
  filter_platform text default 'all',
  filter_status text default 'all',
  filter_type text default 'all',
  filter_adult_only boolean default false,
  filter_launch_from date default null,
  filter_launch_to date default null,
  sort_by text default 'name',
  filter_genre text default 'all'
)
returns table (
  id bigint,
  platform text,
  title_name text,
  thumbnail_url text,
  weekday text,
  is_adult boolean,
  age_rating text,
  writer text,
  painter text,
  origin_author text,
  studio_name text,
  is_finished boolean,
  is_on_hiatus boolean,
  star_score numeric,
  popularity_rank integer,
  launch_date date,
  total_comment_count bigint,
  download_count bigint,
  view_count bigint,
  like_count bigint,
  genre text,
  subject text,
  logline text,
  target_audience text,
  comment text
)
language sql
stable
as $$
  with naver_latest as (
    select snapshot_date from title_snapshots order by snapshot_date desc limit 1
  ),
  naver_genre_agg as (
    select title_id, string_agg(tag_name, ', ' order by tag_name) as genre
    from title_tags
    where tag_type = 'GENRE'
    group by title_id
  ),
  naver_comment_date as (
    select max(snapshot_date) as snapshot_date from comment_snapshots
  ),
  naver_comment_totals as (
    select cs.title_id, sum(cs.comment_count) as total_comment_count
    from comment_snapshots cs, naver_comment_date lcd
    where cs.snapshot_date = lcd.snapshot_date
    group by cs.title_id
  ),
  naver_series_date as (
    select title_id, max(snapshot_date) as snapshot_date
    from series_snapshots
    group by title_id
  ),
  naver_series_latest as (
    select ss.title_id, ss.download_count
    from series_snapshots ss
    join naver_series_date lsd
      on lsd.title_id = ss.title_id and lsd.snapshot_date = ss.snapshot_date
  ),
  -- correlated subquery로 작품마다 따로 launch_date를 구하면(export_titles_data의 원래 방식)
  -- 카카오까지 합쳐 두 배로 도는 이 통합 함수에서는 느려서(list_titles_unified와 같은 문제),
  -- episodes를 미리 한 번만 집계해서 join하는 방식으로 함
  naver_launch as (
    select title_id, min(service_date) as launch_date from episodes group by title_id
  ),
  naver_rows as (
    select
      ti.title_id as id,
      'naver'::text as platform,
      ti.title_name, ti.thumbnail_url, ts.weekday, ti.is_adult, ti.age_rating,
      ti.writer, ti.painter, ti.origin_author,
      coalesce(sa.canonical_name, ti.studio_name) as studio_name,
      ti.is_finished, ti.is_on_hiatus, ts.star_score, ts.popularity_rank,
      coalesce(nl.launch_date, ti.first_seen_at::date) as launch_date,
      coalesce(ct.total_comment_count, ti.final_comment_total)::bigint as total_comment_count,
      sl.download_count,
      null::bigint as view_count,
      null::bigint as like_count,
      ga.genre,
      tn.subject, tn.logline, tn.target_audience, tn.comment
    from titles ti
    left join title_snapshots ts
      on ts.title_id = ti.title_id and ts.snapshot_date = (select snapshot_date from naver_latest)
    left join naver_comment_totals ct on ct.title_id = ti.title_id
    left join naver_series_latest sl on sl.title_id = ti.title_id
    left join naver_genre_agg ga on ga.title_id = ti.title_id
    left join title_notes tn on tn.title_id = ti.title_id
    left join studio_aliases sa on sa.raw_name = ti.studio_name
    left join naver_launch nl on nl.title_id = ti.title_id
    where ti.is_active = true
      and (filter_platform = 'all' or filter_platform = 'naver')
      and (filter_adult_only = false or ti.is_adult = true)
      and (
        filter_type = 'all'
        or (filter_type = 'weekday' and ts.weekday is not null and ts.weekday <> 'DAILY_PLUS')
        or (filter_type = 'daily_plus' and ts.weekday = 'DAILY_PLUS')
      )
      and (
        filter_status = 'all'
        or (filter_status = 'finished' and ti.is_finished = true)
        or (filter_status = 'hiatus' and ti.is_on_hiatus = true)
        or (filter_status = 'new' and ti.is_new = true)
        or (filter_status = 'ongoing' and ti.is_finished = false and ti.is_on_hiatus = false)
      )
      and (
        filter_genre = 'all'
        or exists (
          select 1 from title_tags tg
          where tg.title_id = ti.title_id
            and tg.tag_type = 'GENRE'
            and tg.tag_name = filter_genre
        )
      )
  ),
  kakao_latest as (
    select snapshot_date from kakao_stat_snapshots order by snapshot_date desc limit 1
  ),
  kakao_launch as (
    select content_id, min(service_date) as launch_date from kakao_episodes group by content_id
  ),
  kakao_rows as (
    select
      kt.content_id as id,
      'kakao'::text as platform,
      kt.title_name,
      kt.thumbnail_url,
      null::text as weekday,
      kt.is_adult,
      kt.age_rating,
      kt.writer, kt.painter, kt.origin_author,
      kt.studio_name,
      kt.is_finished, kt.is_on_hiatus,
      null::numeric as star_score,
      null::integer as popularity_rank,
      coalesce(kl.launch_date, kt.first_seen_at::date) as launch_date,
      null::bigint as total_comment_count,
      null::bigint as download_count,
      kss.view_count,
      kss.like_count,
      nullif(array_to_string(kt.genres, ', '), '') as genre,
      null::text as subject, null::text as logline, null::text as target_audience, null::text as comment
    from kakao_titles kt
    left join kakao_stat_snapshots kss
      on kss.content_id = kt.content_id and kss.snapshot_date = (select snapshot_date from kakao_latest)
    left join kakao_launch kl on kl.content_id = kt.content_id
    where kt.is_active = true
      and (filter_platform = 'all' or filter_platform = 'kakao')
      and filter_type = 'all'
      and (filter_adult_only = false or kt.is_adult = true)
      and (
        filter_status = 'all'
        or (filter_status = 'finished' and kt.is_finished = true)
        or (filter_status = 'hiatus' and kt.is_on_hiatus = true)
        or (filter_status = 'ongoing' and kt.is_finished = false and kt.is_on_hiatus = false)
      )
      and (filter_genre = 'all' or filter_genre = any(kt.genres))
  ),
  combined as (
    select * from naver_rows
    union all
    select * from kakao_rows
  ),
  filtered as (
    select *
    from combined
    where (filter_launch_from is null or launch_date >= filter_launch_from)
      and (filter_launch_to is null or launch_date <= filter_launch_to)
  )
  select *
  from filtered
  order by
    case when sort_by = 'star' then star_score end desc nulls last,
    case when sort_by = 'popularity' then popularity_rank end asc nulls last,
    case when sort_by = 'launch' then launch_date end desc nulls last,
    case when sort_by = 'comments' then total_comment_count end desc nulls last,
    case when sort_by = 'views' then view_count end desc nulls last,
    case when sort_by = 'likes' then like_count end desc nulls last,
    title_name asc;
$$;

grant execute on function latest_snapshot_date() to anon;
grant execute on function top_movers(int) to anon;
grant execute on function weekday_popularity_ranking(text, int) to anon;
grant execute on function list_titles(text, text, text, int, int, boolean, date, date) to anon;
grant execute on function titles_by_studio() to anon;
grant execute on function top_titles_by_download(int) to anon;
grant execute on function tag_stats(text, int) to anon;
grant execute on function export_titles_data_unified(text, text, text, boolean, date, date, text, text) to anon;

-- ===================== 카카오웹툰 =====================
-- 네이버와는 완전히 별개 플랫폼이라 title_id 네임스페이스가 겹치지 않도록 독립된 테이블 세트로 관리.
-- 카카오는 댓글수 API가 일반 서버 요청을 차단해(브라우저 핑거프린팅으로 추정) 댓글수 추적은
-- 제외하고, 대신 사용자가 원한 "조회수"를 네이버의 다운로드수 대응 지표로 추적한다.

create table if not exists kakao_titles (
  content_id     bigint primary key,
  seo_id         text not null,
  title_name     text not null,
  thumbnail_url  text,
  writer         text,
  painter        text,
  origin_author  text, -- 카카오 프로필 API의 ORIGINAL_STORY 작가 표기 (원작)
  studio_name    text, -- 카카오 프로필 API의 PUBLISHER 작가 표기 (제작사/스튜디오)
  synopsis       text,
  genres         text[] not null default '{}',
  is_adult       boolean not null default false,
  is_finished    boolean not null default false,
  is_on_hiatus   boolean not null default false, -- 요일별 목록(timetables)의 rest 필드
  -- 사이트의 "신작" 카테고리(timetable_new)에 포함되는지 여부. 네이버 titles.is_new에 대응.
  is_new         boolean not null default false,
  is_active      boolean not null default true,
  age_rating     text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  -- 완결작은 회차/조회수가 더 늘지 않으므로 상세정보+조회수+회차목록을 최초 1회만 수집한다.
  -- null이면 아직 백필 전 (수집기가 새벽 예산 안에서 이어서 처리).
  finished_backfilled_at timestamptz
);

-- 이미 배포된 테이블에 새 컬럼을 안전하게 추가
alter table kakao_titles add column if not exists origin_author text;
alter table kakao_titles add column if not exists is_new boolean not null default false;

-- 회차 목록. 댓글수는 추적하지 않지만 회차 수/무료구분 표시를 위해 유지.
create table if not exists kakao_episodes (
  content_id   bigint not null references kakao_titles(content_id),
  no           integer not null,
  episode_id   bigint not null,
  title        text,
  service_date date,
  use_type     text not null, -- FREE | WAIT_FOR_FREE | EARLY_ACCESS 등
  primary key (content_id, no)
);

-- 작품 단위 일일 조회수/좋아요수 스냅샷 (네이버 series_snapshots의 다운로드수에 대응)
create table if not exists kakao_stat_snapshots (
  content_id    bigint not null references kakao_titles(content_id),
  snapshot_date date not null,
  view_count    bigint,
  like_count    bigint,
  primary key (content_id, snapshot_date)
);

create index if not exists idx_kakao_stat_snapshots_date on kakao_stat_snapshots (snapshot_date);

-- 작품 전체 총 댓글수(회차 구분 없음, relationType=CONTENT). 댓글 API는 Accept-Language: ko
-- 헤더가 정확히 있어야만 통과되는(다른 값은 LANGUAGE_MISMATCH로 막힘) 걸 확인해서 수집 대상에
-- 추가함 - lib/kakao.ts의 fetchTotalCommentCount 참고.
alter table kakao_stat_snapshots add column if not exists total_comment_count bigint;

-- 요일별 인기순위(timetables 응답의 sorting 필드)는 시도해봤으나 세션 상태에 따라 값이 들쭉날쭉
-- 빠지는 걸 확인해(실제 브라우저에서도 재현됨) 신뢰할 수 없다고 판단, kakao_weekday_ranks 테이블 및
-- 관련 함수는 만들지 않기로 함 - 이미 실행했다면 아래로 정리:
--   drop function if exists kakao_weekday_popularity_ranking(text, int);
--   drop table if exists kakao_weekday_ranks;

alter table kakao_titles enable row level security;
alter table kakao_episodes enable row level security;
alter table kakao_stat_snapshots enable row level security;

-- 네이버 테이블과 동일하게 읽기는 누구나(anon), 쓰기는 service role만
drop policy if exists "kakao_titles are publicly readable" on kakao_titles;
create policy "kakao_titles are publicly readable"
  on kakao_titles for select
  using (true);

drop policy if exists "kakao_episodes are publicly readable" on kakao_episodes;
create policy "kakao_episodes are publicly readable"
  on kakao_episodes for select
  using (true);

drop policy if exists "kakao_stat_snapshots are publicly readable" on kakao_stat_snapshots;
create policy "kakao_stat_snapshots are publicly readable"
  on kakao_stat_snapshots for select
  using (true);

create or replace function kakao_latest_snapshot_date()
returns date
language sql
stable
as $$
  select max(snapshot_date) from kakao_stat_snapshots;
$$;

-- 조회수/좋아요수 상위 작품 랭킹 - 카카오 홈 화면용. sort_by: 'views' | 'likes'
drop function if exists kakao_top_titles(text, int);
create or replace function kakao_top_titles(sort_by text default 'views', result_limit int default 10)
returns table (
  content_id bigint,
  title_name text,
  thumbnail_url text,
  studio_name text,
  view_count bigint,
  like_count bigint,
  launch_date date
)
language sql
stable
as $$
  with latest as (
    select snapshot_date from kakao_stat_snapshots order by snapshot_date desc limit 1
  ),
  kakao_launch as (
    select content_id, min(service_date) as launch_date from kakao_episodes group by content_id
  )
  select
    kt.content_id, kt.title_name, kt.thumbnail_url, kt.studio_name, kss.view_count, kss.like_count,
    coalesce(kl.launch_date, kt.first_seen_at::date) as launch_date
  from kakao_stat_snapshots kss
  join latest on kss.snapshot_date = latest.snapshot_date
  join kakao_titles kt on kt.content_id = kss.content_id
  left join kakao_launch kl on kl.content_id = kt.content_id
  where kt.is_active = true
  order by
    case when sort_by = 'likes' then kss.like_count else kss.view_count end desc nulls last
  limit result_limit;
$$;

-- 카카오 사이트의 "신작" 카테고리(kakao_titles.is_new, timetable_new 기준)에 속하면서
-- 최근 days_back일 안에 1화가 등록된 작품 - 홈 화면 "최근 신작"용.
drop function if exists kakao_titles_launched_this_week(date);
drop function if exists kakao_titles_launched_recently(int);
create or replace function kakao_titles_launched_recently(days_back int default 7)
returns table (
  content_id bigint,
  title_name text,
  thumbnail_url text,
  launch_date date,
  view_count bigint
)
language sql
stable
as $$
  with latest as (
    select snapshot_date from kakao_stat_snapshots order by snapshot_date desc limit 1
  )
  select kt.content_id, kt.title_name, kt.thumbnail_url, e.launch_date, kss.view_count
  from kakao_titles kt
  join (
    select content_id, min(service_date) as launch_date
    from kakao_episodes
    group by content_id
  ) e on e.content_id = kt.content_id
  left join kakao_stat_snapshots kss
    on kss.content_id = kt.content_id and kss.snapshot_date = (select snapshot_date from latest)
  where kt.is_active = true and kt.is_new = true and e.launch_date >= current_date - days_back
  order by e.launch_date desc;
$$;

-- 제작사(PUBLISHER 작가 표기)가 비어있는 연재중 작품 - 홈 화면 "제작사 정보 필요"용.
-- 네이버의 titles.studio_name과 달리 "다중"류 특수값은 없고 null/빈 문자열만 있으면 됨.
drop function if exists kakao_titles_needing_studio_fix();
create or replace function kakao_titles_needing_studio_fix()
returns table (
  content_id bigint,
  title_name text,
  thumbnail_url text,
  launch_date date,
  view_count bigint
)
language sql
stable
as $$
  with latest as (
    select snapshot_date from kakao_stat_snapshots order by snapshot_date desc limit 1
  ),
  kakao_launch as (
    select content_id, min(service_date) as launch_date from kakao_episodes group by content_id
  )
  select
    kt.content_id, kt.title_name, kt.thumbnail_url,
    coalesce(kl.launch_date, kt.first_seen_at::date) as launch_date,
    kss.view_count
  from kakao_titles kt
  left join kakao_launch kl on kl.content_id = kt.content_id
  left join kakao_stat_snapshots kss
    on kss.content_id = kt.content_id and kss.snapshot_date = (select snapshot_date from latest)
  where kt.is_active = true and kt.is_finished = false
    and (kt.studio_name is null or kt.studio_name = '')
  order by kt.title_name asc;
$$;

grant execute on function kakao_latest_snapshot_date() to anon;
grant execute on function kakao_top_titles(text, int) to anon;
grant execute on function kakao_titles_launched_recently(int) to anon;
grant execute on function kakao_titles_needing_studio_fix() to anon;

-- title_id 목록을 외부(라이브 실시간 랭킹 API, ilike 검색)에서 받아와 DB 랭킹 쿼리로는
-- 성과 지표를 못 얻는 경우 공용으로 쓰는 일괄 조회 함수 (검색결과/실시간 랭킹 카드용)
drop function if exists naver_titles_perf(bigint[]);
create or replace function naver_titles_perf(target_ids bigint[])
returns table (
  title_id bigint,
  weekday text,
  popularity_rank integer,
  launch_date date,
  download_count bigint,
  total_comment_count bigint,
  star_score numeric
)
language sql
stable
as $$
  with naver_latest as (
    select snapshot_date from title_snapshots order by snapshot_date desc limit 1
  ),
  naver_comment_date as (
    select max(snapshot_date) as snapshot_date from comment_snapshots
  ),
  naver_comment_totals as (
    select cs.title_id, sum(cs.comment_count) as total_comment_count
    from comment_snapshots cs, naver_comment_date d
    where cs.snapshot_date = d.snapshot_date and cs.title_id = any(target_ids)
    group by cs.title_id
  ),
  naver_launch as (
    select title_id, min(service_date) as launch_date
    from episodes where title_id = any(target_ids)
    group by title_id
  ),
  latest_series_date as (
    select title_id, max(snapshot_date) as snapshot_date
    from series_snapshots where title_id = any(target_ids)
    group by title_id
  ),
  series_latest as (
    select ss.title_id, ss.download_count
    from series_snapshots ss
    join latest_series_date lsd on lsd.title_id = ss.title_id and lsd.snapshot_date = ss.snapshot_date
  )
  select
    ti.title_id,
    ts.weekday, ts.popularity_rank,
    coalesce(nl.launch_date, ti.first_seen_at::date) as launch_date,
    sl.download_count,
    coalesce(ct.total_comment_count, ti.final_comment_total)::bigint as total_comment_count,
    ts.star_score
  from titles ti
  left join title_snapshots ts on ts.title_id = ti.title_id and ts.snapshot_date = (select snapshot_date from naver_latest)
  left join naver_comment_totals ct on ct.title_id = ti.title_id
  left join naver_launch nl on nl.title_id = ti.title_id
  left join series_latest sl on sl.title_id = ti.title_id
  where ti.title_id = any(target_ids);
$$;

grant execute on function naver_titles_perf(bigint[]) to anon;

-- naver_titles_perf는 댓글수/다운로드수/인기순위까지 같이 구하느라 comment_snapshots,
-- series_snapshots, title_snapshots까지 조인한다 - 장르/키워드별 런칭 추이 그래프처럼
-- 태그 하나에 수백~수천 개 작품의 런칭일만 필요한 경우 이 무거운 조인이 그대로 병목이 되어
-- 실제로 statement timeout이 났다. episodes/titles만 보는 가벼운 버전을 따로 둔다.
drop function if exists naver_launch_dates(bigint[]);
create or replace function naver_launch_dates(target_ids bigint[])
returns table (
  title_id bigint,
  launch_date date
)
language sql
stable
as $$
  with naver_launch as (
    select title_id, min(service_date) as launch_date
    from episodes where title_id = any(target_ids)
    group by title_id
  )
  select
    ti.title_id,
    coalesce(nl.launch_date, ti.first_seen_at::date) as launch_date
  from titles ti
  left join naver_launch nl on nl.title_id = ti.title_id
  where ti.title_id = any(target_ids);
$$;

grant execute on function naver_launch_dates(bigint[]) to anon;

-- 장르별 다운로드/매출액 추정 추이 그래프용: 태그 하나에 속한 작품 여러 개의 시리즈 누적
-- 다운로드수를 날짜별로 합산해서 반환한다(작품별로 series_snapshots를 통째로 내려받지 않도록).
-- 장르 안 작품 수가 너무 많으면(로맨스 1190개 등) 매일 밤 전부 다시 확인하지 못하고 일부만
-- 갱신되는데, 그날그날 갱신되는 작품 구성이 달라서 단순 합산은 "그날 마침 갱신 안 된 큰 작품"
-- 때문에 실제로는 줄지 않았는데도 합계가 순간적으로 뚝 떨어지는 문제가 있었다(실측: 로맨스
-- 9/21→9/22에 "이섭의 연애" 1,399만 다운로드작이 그날 갱신 대상에서 빠져 총합이 감소해보임).
-- 작품별로 마지막으로 확인된 값을 다음 갱신일까지 이어붙인(forward-fill) 뒤에 합산해서 해결.
drop function if exists genre_download_series(bigint[]);
create or replace function genre_download_series(target_ids bigint[])
returns table (
  snapshot_date date,
  total_download bigint
)
language sql
stable
as $$
  with dates as (
    select distinct snapshot_date from series_snapshots
    where title_id = any(target_ids)
      and title_id not in (select title_id from series_products where one_time)
  ),
  tds as (
    select distinct title_id from series_snapshots
    where title_id = any(target_ids)
      and title_id not in (select title_id from series_products where one_time)
  ),
  grid as (
    select tds.title_id, dates.snapshot_date
    from tds cross join dates
  ),
  joined as (
    select g.title_id, g.snapshot_date, ss.download_count
    from grid g
    left join series_snapshots ss on ss.title_id = g.title_id and ss.snapshot_date = g.snapshot_date
  ),
  grouped as (
    select *,
      count(download_count) over (partition by title_id order by snapshot_date) as grp
    from joined
  ),
  filled as (
    select title_id, snapshot_date, max(download_count) over (partition by title_id, grp) as download_count
    from grouped
  )
  select snapshot_date, sum(download_count) as total_download
  from filled
  where download_count is not null
  group by snapshot_date
  order by snapshot_date;
$$;

grant execute on function genre_download_series(bigint[]) to anon;

-- 장르/키워드별 "주별" 다운로드 추이용: 작품마다 자기 체크포인트(연재요일 하루 전 = 다음 회차 올라오기 직전) 값을 골라
-- 달력 주(월요일 시작)별로 합산한다. 작품마다 체크포인트 요일이 달라도 월~일 한 주에 정확히 하루씩 있어서 같은 주끼리 합산된다.
-- 체크포인트 당일 수집이 없으면 그 이전 가장 가까운 값(forward-fill), 수집을 시작하기 전 주는 그 작품의 첫 수집값으로 채운다
-- (개별 작품 그래프와 같은 방식 - 늦게 수집이 시작된 작품이 한꺼번에 더해지는 가짜 급등이 생기지 않도록).
-- 체크포인트가 아직 안 지난 작품이 있는 마지막 주(일요일이 최근 수집일 이후인 주)는 합계가 줄어 보이므로 내보내지 않는다.
create or replace function genre_download_series_weekly(target_ids bigint[])
returns table (
  week_start date,
  total_download bigint
)
language sql
stable
as $$
  with latest as (
    select max(snapshot_date) as d from series_snapshots
  ),
  tds as (
    select ss.title_id, min(ss.snapshot_date) as first_date
    from series_snapshots ss
    where ss.title_id = any(target_ids)
      and ss.title_id not in (select title_id from series_products where one_time)
    group by ss.title_id
  ),
  wd as (
    select tds.title_id,
      -- 월요일 기준 오프셋(월=0 ... 일=6) = 연재요일 하루 전; 요일 정보가 없거나 매일+ 면 월요일(0)
      coalesce(((case (
          select ts.weekday from title_snapshots ts
          where ts.title_id = tds.title_id and ts.weekday is not null
          order by ts.snapshot_date desc limit 1
        )
        when 'SUNDAY' then 0 when 'MONDAY' then 1 when 'TUESDAY' then 2 when 'WEDNESDAY' then 3
        when 'THURSDAY' then 4 when 'FRIDAY' then 5 when 'SATURDAY' then 6 end) + 5) % 7, 0) as cp_offset
    from tds
  ),
  weeks as (
    select gs::date as week_start
    from generate_series(
      date_trunc('week', (select min(first_date) from tds))::date,
      date_trunc('week', (select d from latest))::date,
      interval '7 days'
    ) gs
  )
  select w.week_start, sum(v.download_count)::bigint as total_download
  from weeks w
  cross join wd
  cross join lateral (
    select coalesce(
      (select ss.download_count from series_snapshots ss
        where ss.title_id = wd.title_id and ss.snapshot_date <= w.week_start + wd.cp_offset
        order by ss.snapshot_date desc limit 1),
      (select ss.download_count from series_snapshots ss
        where ss.title_id = wd.title_id
        order by ss.snapshot_date asc limit 1)
    ) as download_count
  ) v
  where w.week_start + 6 <= (select d from latest)
  group by w.week_start
  order by w.week_start;
$$;

grant execute on function genre_download_series_weekly(bigint[]) to anon;

drop function if exists kakao_titles_perf(bigint[]);
create or replace function kakao_titles_perf(target_ids bigint[])
returns table (
  content_id bigint,
  launch_date date,
  view_count bigint
)
language sql
stable
as $$
  with latest as (
    select snapshot_date from kakao_stat_snapshots order by snapshot_date desc limit 1
  ),
  kakao_launch as (
    select content_id, min(service_date) as launch_date
    from kakao_episodes where content_id = any(target_ids)
    group by content_id
  )
  select
    kt.content_id,
    coalesce(kl.launch_date, kt.first_seen_at::date) as launch_date,
    kss.view_count
  from kakao_titles kt
  left join kakao_stat_snapshots kss
    on kss.content_id = kt.content_id and kss.snapshot_date = (select snapshot_date from latest)
  left join kakao_launch kl on kl.content_id = kt.content_id
  where kt.content_id = any(target_ids);
$$;

-- 이용자별 관심작품 목록. 로그인 없이 닉네임만으로 구분(같은 닉네임을 쓰면 기기와 무관하게
-- 같은 목록이 보임 - 다른 사람이 이름만 알면 볼 수도 있다는 트레이드오프를 감수한 선택).
-- 댓글수/다운로드수 비교는 네이버 데이터에서만 가능해서(카카오는 댓글수 자체가 없음) 네이버
-- title_id만 대상으로 함. 이 사이트에서 유일하게 공유 배포(Vercel)에서도 anon 키로 쓰기(추가/삭제)를
-- 허용하는 테이블 - 일반 이용자가 직접 쓰는 공개 기능이라 "쓰기는 service role만" 규칙의 예외로 둠.
create table if not exists user_watchlist (
  user_name  text not null,
  title_id   bigint not null references titles(title_id),
  created_at timestamptz not null default now(),
  primary key (user_name, title_id)
);

create index if not exists idx_user_watchlist_user on user_watchlist (user_name);

alter table user_watchlist enable row level security;

drop policy if exists "user_watchlist are publicly readable" on user_watchlist;
create policy "user_watchlist are publicly readable"
  on user_watchlist for select
  using (true);

drop policy if exists "user_watchlist are publicly writable" on user_watchlist;
create policy "user_watchlist are publicly writable"
  on user_watchlist for insert
  with check (true);

drop policy if exists "user_watchlist are publicly deletable" on user_watchlist;
create policy "user_watchlist are publicly deletable"
  on user_watchlist for delete
  using (true);

-- 작품 하나의 날짜별 총 댓글수 추이(회차별 누적 댓글수를 날짜별로 합산). 관심작품 비교 탭에서 사용.
create or replace function title_comment_history(p_title_id bigint)
returns table (snapshot_date date, total_comment_count bigint)
language sql
stable
as $$
  select snapshot_date, sum(comment_count)::bigint as total_comment_count
  from comment_snapshots
  where title_id = p_title_id
  group by snapshot_date
  order by snapshot_date;
$$;

grant execute on function title_comment_history(bigint) to anon;

grant execute on function kakao_titles_perf(bigint[]) to anon;
-- 다운로드수 증가량 랭킹. period_days=1(전일)은 가장 최근 수집일 대비 하루 전, 7 이상(전주=7, 전월=28)은 작품별 "주차 체크포인트"
-- (연재요일 하루 전 = 다음 회차 올라오기 직전, 회차 댓글수/다운로드 그래프의 주별 보기와 같은 기준)를 따른다 - 작품마다 가장
-- 최근 체크포인트 값과 period_days일 전 체크포인트 값을 비교한다. 기준일에 수집이 없는 작품은 그 이전 가장 가까운 수집값을 기준으로 삼는다(이월). 수집을 시작한 지
-- 얼마 안 돼 기준일 이전 값이 아예 없는 작품(신작 등)은 첫 수집값을 기준으로 하고 is_partial=true로 표시한다.
-- 최근 3일 안에 수집되지 않은 작품(추적 종료된 완결작 등)과 증가량이 0 이하인 작품은 제외한다.
-- sort_by: 'delta'(증가량 큰 순, 기본) | 'pct'(증가율 큰 순 - 기준 다운로드가 1만 미만이면 변동폭이 과장돼 제외)
create or replace function download_delta_ranking(period_days int, result_limit int default 50, sort_by text default 'delta')
returns table (
  title_id bigint,
  title_name text,
  thumbnail_url text,
  studio_name text,
  is_finished boolean,
  is_adult boolean,
  download_count bigint,
  prev_count bigint,
  delta bigint,
  delta_pct numeric,
  base_date date,
  latest_date date,
  is_partial boolean
)
language sql
stable
as $$
  with latest as (
    select max(snapshot_date) as d from series_snapshots
  ),
  per_title as (
    select
      ti.title_id, ti.title_name, ti.thumbnail_url,
      coalesce(sa.canonical_name, ti.studio_name) as studio_name,
      ti.is_finished, ti.is_adult,
      tg.cur_target,
      cur.download_count as cur_count, cur.snapshot_date as cur_date,
      base.download_count as base_count, base.snapshot_date as base_date,
      first_s.download_count as first_count, first_s.snapshot_date as first_date,
      (select max(s2.snapshot_date) from series_snapshots s2 where s2.title_id = ti.title_id) as last_date
    from titles ti
    left join lateral (
      select ts.weekday from title_snapshots ts
      where ts.title_id = ti.title_id and ts.weekday is not null
      order by ts.snapshot_date desc limit 1
    ) wd on true
    cross join lateral (
      select case
        when period_days >= 7 then (select d from latest) - (((extract(dow from (select d from latest))::int
          - coalesce(((case wd.weekday
              when 'SUNDAY' then 0 when 'MONDAY' then 1 when 'TUESDAY' then 2 when 'WEDNESDAY' then 3
              when 'THURSDAY' then 4 when 'FRIDAY' then 5 when 'SATURDAY' then 6 end) + 6) % 7, 1)) + 7) % 7)
        else (select d from latest)
      end as cur_target
    ) tg
    join lateral (
      select ss.download_count, ss.snapshot_date
      from series_snapshots ss
      where ss.title_id = ti.title_id and ss.snapshot_date <= tg.cur_target
      order by ss.snapshot_date desc limit 1
    ) cur on true
    left join lateral (
      select ss.download_count, ss.snapshot_date
      from series_snapshots ss
      where ss.title_id = ti.title_id and ss.snapshot_date <= tg.cur_target - period_days
      order by ss.snapshot_date desc limit 1
    ) base on true
    left join lateral (
      select ss.download_count, ss.snapshot_date
      from series_snapshots ss
      where ss.title_id = ti.title_id
      order by ss.snapshot_date asc limit 1
    ) first_s on true
    left join studio_aliases sa on sa.raw_name = ti.studio_name
    where ti.is_active = true
  )
  select
    pt.title_id, pt.title_name, pt.thumbnail_url, pt.studio_name, pt.is_finished, pt.is_adult,
    pt.cur_count as download_count,
    coalesce(pt.base_count, pt.first_count) as prev_count,
    (pt.cur_count - coalesce(pt.base_count, pt.first_count)) as delta,
    case when coalesce(pt.base_count, pt.first_count) > 0
      then round((pt.cur_count - coalesce(pt.base_count, pt.first_count)) * 100.0 / coalesce(pt.base_count, pt.first_count), 2)
    end as delta_pct,
    coalesce(pt.base_date, pt.first_date) as base_date,
    pt.cur_date as latest_date,
    (pt.base_count is null) as is_partial
  from per_title pt
  where pt.last_date >= (select d from latest) - 3
    and (pt.cur_count - coalesce(pt.base_count, pt.first_count)) > 0
    and (sort_by <> 'pct' or coalesce(pt.base_count, pt.first_count) >= 10000)
  order by
    case when sort_by = 'pct' then (pt.cur_count - coalesce(pt.base_count, pt.first_count))::numeric / nullif(coalesce(pt.base_count, pt.first_count), 0) end desc nulls last,
    delta desc
  limit result_limit;
$$;
grant execute on function download_delta_ranking(int, int, text) to anon;

-- 댓글수 일일 스냅샷 정리(DB 용량 관리): 최근 keep_days일은 매일 기록을 그대로 두고, 그보다 오래된 날짜는 작품별
-- "주차 체크포인트 요일"의 기록만 남기고 지운다. 체크포인트는 연재 요일 하루 전(월요웹툰이면 일요일, 연재요일을 모르는
-- 매일+는 월요일) 기록이다 - 새 회차가 요일 전날 밤 10~11시에 올라오므로 그날 저녁 수집값이 다음 회차가 올라오기 직전
-- (이전 회차가 올라온 지 거의 7일, 최종 댓글수의 약 98%가 쌓인 값)이라 회차/주끼리 비교가 안정적이다. 회차 댓글수·다운로드
-- 그래프의 주별 보기 기준과 같다. legacy_before 이전 날짜는 예전 기준으로 이미 정리돼 있어서 건드리지 않는다. 작품별로 마지막 기록은 항상 남긴다(추적이 끝난 완결작 보호).
-- from_date/to_date를 주면 그 날짜 범위만 처리한다(처음 정리할 때 수백만 행을 한 번에 지우다 시간 초과가 나지 않게
-- 나눠서 호출하는 용도). 수집기는 인자 없이 매일 밤 호출한다. 삭제한 행 수를 반환.
drop function if exists prune_comment_snapshots(int, date, date, date);
create or replace function prune_comment_snapshots(
  keep_days int default 14,
  from_date date default null,
  to_date date default null,
  legacy_before date default '2026-10-05'
)
returns bigint
language plpgsql
as $$
declare
  cutoff date;
  d date;
  c bigint;
  n bigint := 0;
begin
  select max(snapshot_date) - keep_days into cutoff from comment_snapshots;
  if cutoff is null then return 0; end if;

  create temp table _prune_anchor on commit drop as
    select ti.title_id,
      coalesce(((case wd.weekday
        when 'SUNDAY' then 0 when 'MONDAY' then 1 when 'TUESDAY' then 2 when 'WEDNESDAY' then 3
        when 'THURSDAY' then 4 when 'FRIDAY' then 5 when 'SATURDAY' then 6 end) + 6) % 7, 1) as dow
    from titles ti
    left join lateral (
      select ts.weekday from title_snapshots ts
      where ts.title_id = ti.title_id and ts.weekday is not null
      order by ts.snapshot_date desc limit 1
    ) wd on true;
  create unique index on _prune_anchor (title_id);

  create temp table _prune_last on commit drop as
    select title_id, max(snapshot_date) as last_date from comment_snapshots group by title_id;
  create unique index on _prune_last (title_id);

  for d in
    select distinct snapshot_date from comment_snapshots
    where snapshot_date < cutoff
      and snapshot_date >= legacy_before
      and (from_date is null or snapshot_date >= from_date)
      and (to_date is null or snapshot_date <= to_date)
    order by 1
  loop
    delete from comment_snapshots cs
    using _prune_anchor a, _prune_last l
    where cs.snapshot_date = d
      and a.title_id = cs.title_id
      and l.title_id = cs.title_id
      and extract(dow from cs.snapshot_date)::int <> a.dow
      and cs.snapshot_date <> l.last_date;
    get diagnostics c = row_count;
    n := n + c;
  end loop;
  return n;
end;
$$;

-- 신작 월차 성과 비교(/launches)용. 런칭일(1화 등록일, 성인작은 수집기가 처음 발견한 날) 범위에 들어오는 작품들의
-- 런칭 후 30/60/90일째("1/2/3개월차") 시점과 현재(mark=0)의 성과를 작품 x 시점 단위의 long 형태로 돌려준다.
-- 각 시점 값은 목표일 +-3일 안에서 가장 가까운 수집값(다운로드=series_snapshots, 댓글=그날 회차 댓글 합계, 별점=title_snapshots).
-- 목표일이 아직 안 지났거나 그 무렵 수집 기록이 없으면(수집 시작 2026-08-11 이전 구간 등) 값은 null.
-- genre_tag: 장르 태그 하나로 한정(null이면 전체).
create or replace function launch_cohort_metrics(from_date date, to_date date, genre_tag text default null)
returns table (
  title_id bigint,
  title_name text,
  thumbnail_url text,
  studio_name text,
  is_adult boolean,
  is_finished boolean,
  launch_date date,
  mark int,
  dl_date date,
  download_count bigint,
  cm_date date,
  comment_total bigint,
  star_score numeric
)
language sql
stable
as $$
  with latest as (
    select max(snapshot_date) as d from series_snapshots
  ),
  cohort as (
    select ti.title_id, ti.title_name, ti.thumbnail_url,
      coalesce(sa.canonical_name, ti.studio_name) as studio_name,
      ti.is_adult, ti.is_finished,
      coalesce((select min(e.service_date) from episodes e where e.title_id = ti.title_id), ti.first_seen_at::date) as launch_date
    from titles ti
    left join studio_aliases sa on sa.raw_name = ti.studio_name
    where ti.is_active = true
      and (genre_tag is null or exists (
        select 1 from title_tags tg
        where tg.title_id = ti.title_id and tg.tag_type = 'GENRE' and tg.tag_name = genre_tag
      ))
  ),
  cohort_f as materialized (
    select * from cohort where launch_date between from_date and to_date
  ),
  -- 시점(mark)별 목표일 t와 허용 구간 [lo, hi]: 현재(0)는 가장 최근 값(최근 수집일 이전 전체), 나머지는 목표일 +-3일. 아직 안 지난 목표일은 제외
  targets as materialized (
    select c.title_id, m.mark, c.launch_date,
      case when m.mark = 0 then l.d else c.launch_date + m.mark end as t,
      case when m.mark = 0 then l.d - 3650 else c.launch_date + m.mark - 3 end as lo,
      case when m.mark = 0 then l.d else c.launch_date + m.mark + 3 end as hi
    from cohort_f c
    cross join latest l
    cross join (values (0), (30), (60), (90)) as m(mark)
    where m.mark = 0 or c.launch_date + m.mark <= l.d
  ),
  ss as materialized (
    select s.title_id, s.snapshot_date, max(s.download_count) as download_count
    from series_snapshots s
    where s.title_id = any((select array_agg(c.title_id) from cohort_f c)::bigint[])
    group by s.title_id, s.snapshot_date
  ),
  cs as materialized (
    select c.title_id, c.snapshot_date, sum(c.comment_count) as comment_total
    from comment_snapshots c
    where c.title_id = any((select array_agg(f.title_id) from cohort_f f)::bigint[])
    group by c.title_id, c.snapshot_date
  ),
  st as materialized (
    select t.title_id, t.snapshot_date, t.star_score
    from title_snapshots t
    where t.title_id = any((select array_agg(c.title_id) from cohort_f c)::bigint[]) and t.star_score is not null
  ),
  dl as (
    select distinct on (tg.title_id, tg.mark) tg.title_id, tg.mark, s.snapshot_date, s.download_count
    from targets tg
    join ss s on s.title_id = tg.title_id and s.snapshot_date between tg.lo and tg.hi
    order by tg.title_id, tg.mark, abs(s.snapshot_date - tg.t), s.snapshot_date
  ),
  cm as (
    select distinct on (tg.title_id, tg.mark) tg.title_id, tg.mark, c.snapshot_date, c.comment_total
    from targets tg
    join cs c on c.title_id = tg.title_id and c.snapshot_date between tg.lo and tg.hi
    order by tg.title_id, tg.mark, abs(c.snapshot_date - tg.t), c.snapshot_date
  ),
  sr as (
    select distinct on (tg.title_id, tg.mark) tg.title_id, tg.mark, x.star_score
    from targets tg
    join st x on x.title_id = tg.title_id and x.snapshot_date between tg.lo and tg.hi
    order by tg.title_id, tg.mark, abs(x.snapshot_date - tg.t), x.snapshot_date
  )
  select c.title_id, c.title_name, c.thumbnail_url, c.studio_name, c.is_adult, c.is_finished, c.launch_date, m.mark,
    dl.snapshot_date as dl_date, dl.download_count,
    cm.snapshot_date as cm_date, cm.comment_total::bigint as comment_total,
    sr.star_score
  from cohort_f c
  cross join (values (0), (30), (60), (90)) as m(mark)
  left join dl on dl.title_id = c.title_id and dl.mark = m.mark
  left join cm on cm.title_id = c.title_id and cm.mark = m.mark
  left join sr on sr.title_id = c.title_id and sr.mark = m.mark
  order by c.title_id, m.mark;
$$;

grant execute on function launch_cohort_metrics(date, date, text) to anon;

-- 같은 범위 작품들의 "런칭 후 경과일(0~90) -> 누적 다운로드" 곡선. 작품마다 한 행: start_offset부터 하루 간격 배열(수집 안 된 날은 null).
-- 수집 시작(2026-08-11) 이전에 런칭한 작품은 start_offset이 0보다 크다(그 시점부터의 값만 있음).
create or replace function launch_download_curves(from_date date, to_date date, genre_tag text default null)
returns table (
  title_id bigint,
  start_offset int,
  vals bigint[]
)
language sql
stable
as $$
  with cohort as (
    select ti.title_id,
      coalesce((select min(e.service_date) from episodes e where e.title_id = ti.title_id), ti.first_seen_at::date) as launch_date
    from titles ti
    where ti.is_active = true
      and (genre_tag is null or exists (
        select 1 from title_tags tg
        where tg.title_id = ti.title_id and tg.tag_type = 'GENRE' and tg.tag_name = genre_tag
      ))
  ),
  cohort_f as materialized (
    select * from cohort where launch_date between from_date and to_date
  ),
  ss as materialized (
    select s.title_id, s.snapshot_date, max(s.download_count) as download_count
    from series_snapshots s
    where s.title_id = any((select array_agg(c.title_id) from cohort_f c)::bigint[])
    group by s.title_id, s.snapshot_date
  ),
  ranges as (
    select c.title_id, c.launch_date,
      min(s.snapshot_date - c.launch_date) as mn,
      max(s.snapshot_date - c.launch_date) as mx
    from cohort_f c
    join ss s on s.title_id = c.title_id and s.snapshot_date - c.launch_date between 0 and 90
    group by c.title_id, c.launch_date
  )
  select r.title_id, r.mn as start_offset,
    array_agg(s.download_count order by g.g) as vals
  from ranges r
  cross join lateral generate_series(r.mn, r.mx) as g(g)
  left join ss s on s.title_id = r.title_id and s.snapshot_date = r.launch_date + g.g
  group by r.title_id, r.mn
  order by r.title_id;
$$;

grant execute on function launch_download_curves(date, date, text) to anon;
