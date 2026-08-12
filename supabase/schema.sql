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

-- 글/그림/원작 작가 분리 (article/list/info의 communityArtists, 태그 수집과 같이 매일 갱신)
alter table titles add column if not exists writer text;
alter table titles add column if not exists painter text;
alter table titles add column if not exists origin_author text;
-- 실제 연령등급 (article/list/info의 age.description, 예: "15세 이용가" / "전체이용가")
alter table titles add column if not exists age_rating text;

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

create table if not exists comment_snapshots (
  title_id      bigint not null,
  no            integer not null,
  snapshot_date date not null,
  comment_count integer not null,
  post_count    integer,
  primary key (title_id, no, snapshot_date),
  foreign key (title_id, no) references episodes(title_id, no)
);

create index if not exists idx_comment_snapshots_lookup
  on comment_snapshots (title_id, no, snapshot_date desc);

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
alter table episode_notes enable row level security;
alter table title_notes enable row level security;

drop policy if exists "titles are publicly readable" on titles;
create policy "titles are publicly readable"
  on titles for select
  using (true);

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

drop policy if exists "title_tags are publicly readable" on title_tags;
create policy "title_tags are publicly readable"
  on title_tags for select
  using (true);

-- service_role 키는 RLS를 우회하므로 쓰기용 정책은 별도로 필요 없음 (수집기는 service role key 사용)

-- episode_notes는 예외: 대시보드(anon key)에서 사용자가 직접 트리트먼트를 쓰고 저장해야 하므로
-- 이 테이블만 anon에게 읽기/쓰기를 모두 허용함 (로그인 기능이 없는 개인용 대시보드 전제)
drop policy if exists "episode_notes are publicly readable" on episode_notes;
create policy "episode_notes are publicly readable"
  on episode_notes for select
  using (true);

drop policy if exists "episode_notes are publicly writable" on episode_notes;
create policy "episode_notes are publicly writable"
  on episode_notes for insert
  with check (true);

drop policy if exists "episode_notes are publicly updatable" on episode_notes;
create policy "episode_notes are publicly updatable"
  on episode_notes for update
  using (true)
  with check (true);

-- title_notes도 episode_notes와 동일하게 anon 읽기/쓰기 허용 (배포 후 소유자 전용으로 잠글 예정)
drop policy if exists "title_notes are publicly readable" on title_notes;
create policy "title_notes are publicly readable"
  on title_notes for select
  using (true);

drop policy if exists "title_notes are publicly writable" on title_notes;
create policy "title_notes are publicly writable"
  on title_notes for insert
  with check (true);

drop policy if exists "title_notes are publicly updatable" on title_notes;
create policy "title_notes are publicly updatable"
  on title_notes for update
  using (true)
  with check (true);

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
create or replace function weekday_popularity_ranking(target_weekday text, result_limit int default 30)
returns table (
  title_id bigint,
  title_name text,
  thumbnail_url text,
  popularity_rank integer
)
language sql
stable
as $$
  with latest as (
    select snapshot_date from title_snapshots order by snapshot_date desc limit 1
  )
  select ts.title_id, ti.title_name, ti.thumbnail_url, ts.popularity_rank
  from title_snapshots ts
  join latest on ts.snapshot_date = latest.snapshot_date
  join titles ti on ti.title_id = ts.title_id
  where ts.weekday = target_weekday and ts.popularity_rank is not null and ti.is_active = true
  order by ts.popularity_rank asc
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
  base as (
    select
      ti.title_id, ti.title_name, ti.thumbnail_url, ti.author, ti.studio_name,
      ti.is_finished, ti.is_on_hiatus, ti.is_adult, ti.is_new,
      ts.weekday, ts.star_score, ts.popularity_rank,
      (select min(e.service_date) from episodes e where e.title_id = ti.title_id) as launch_date,
      ct.total_comment_count
    from titles ti
    left join title_snapshots ts
      on ts.title_id = ti.title_id and ts.snapshot_date = (select snapshot_date from latest)
    left join comment_totals ct on ct.title_id = ti.title_id
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

-- 제작사 탭용: 활성 작품 전체를 제작사 정보와 함께 반환 (제작사별 그룹핑은 애플리케이션 레벨에서 처리)
create or replace function titles_by_studio()
returns table (
  title_id bigint,
  title_name text,
  thumbnail_url text,
  studio_name text,
  studio_website_url text,
  weekday text,
  popularity_rank integer,
  star_score numeric
)
language sql
stable
as $$
  with latest as (
    select snapshot_date from title_snapshots order by snapshot_date desc limit 1
  )
  select
    ti.title_id, ti.title_name, ti.thumbnail_url,
    coalesce(sa.canonical_name, ti.studio_name) as studio_name,
    ti.studio_website_url,
    ts.weekday, ts.popularity_rank, ts.star_score
  from titles ti
  left join title_snapshots ts
    on ts.title_id = ti.title_id and ts.snapshot_date = (select snapshot_date from latest)
  left join studio_aliases sa on sa.raw_name = ti.studio_name
  where ti.is_active = true and ti.studio_name is not null;
$$;

-- 장르/키워드 통계: 연재중인(is_active) 작품 중 해당 태그가 붙은 작품 수 상위 N개.
-- tag_type_filter: 'GENRE' | 'KEYWORD'
create or replace function tag_stats(tag_type_filter text, result_limit int default 15)
returns table (tag_name text, title_count bigint)
language sql
stable
as $$
  select tt.tag_name, count(*) as title_count
  from title_tags tt
  join titles ti on ti.title_id = tt.title_id
  where ti.is_active = true and tt.tag_type = tag_type_filter
  group by tt.tag_name
  order by title_count desc, tt.tag_name asc
  limit result_limit;
$$;

-- 전체 작품 엑셀 내보내기용: 페이지네이션 없이 상태/연재구분/성인/런칭일 필터 + 정렬을 적용해 전체 반환.
-- filter_status: null/'all' | 'ongoing' | 'new' | 'finished' | 'hiatus' (list_titles와 동일 의미)
-- filter_type: null/'all' | 'weekday' | 'daily_plus'
-- filter_launch_from/to: 1화 등록일(launch_date) 범위 필터, null이면 미적용
-- sort_by: 'name' | 'popularity' | 'star' | 'launch' | 'comments' (list_titles와 동일 의미)
drop function if exists export_titles_data(text);
drop function if exists export_titles_data(text, text, boolean, date, date);
drop function if exists export_titles_data(text, text, boolean, date, date, text);
create or replace function export_titles_data(
  filter_status text default 'all',
  filter_type text default null,
  filter_adult_only boolean default false,
  filter_launch_from date default null,
  filter_launch_to date default null,
  sort_by text default 'name'
)
returns table (
  title_id bigint,
  title_name text,
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
  genre text,
  subject text,
  logline text,
  target_audience text,
  comment text
)
language sql
stable
as $$
  with latest as (
    select snapshot_date from title_snapshots order by snapshot_date desc limit 1
  ),
  genre_agg as (
    select title_id, string_agg(tag_name, ', ' order by tag_name) as genre
    from title_tags
    where tag_type = 'GENRE'
    group by title_id
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
  base as (
    select
      ti.title_id, ti.title_name, ts.weekday, ti.is_adult, ti.age_rating,
      ti.writer, ti.painter, ti.origin_author,
      coalesce(sa.canonical_name, ti.studio_name) as studio_name,
      ti.is_finished, ti.is_on_hiatus, ts.star_score, ts.popularity_rank,
      (select min(e.service_date) from episodes e where e.title_id = ti.title_id) as launch_date,
      ct.total_comment_count,
      sl.download_count,
      ga.genre,
      tn.subject, tn.logline, tn.target_audience, tn.comment
    from titles ti
    left join title_snapshots ts
      on ts.title_id = ti.title_id and ts.snapshot_date = (select snapshot_date from latest)
    left join comment_totals ct on ct.title_id = ti.title_id
    left join series_latest sl on sl.title_id = ti.title_id
    left join genre_agg ga on ga.title_id = ti.title_id
    left join title_notes tn on tn.title_id = ti.title_id
    left join studio_aliases sa on sa.raw_name = ti.studio_name
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
  select *
  from filtered
  order by
    case when sort_by = 'star' then star_score end desc nulls last,
    case when sort_by = 'popularity' then popularity_rank end asc nulls last,
    case when sort_by = 'launch' then launch_date end desc nulls last,
    case when sort_by = 'comments' then total_comment_count end desc nulls last,
    title_name asc;
$$;

grant execute on function latest_snapshot_date() to anon;
grant execute on function top_movers(int) to anon;
grant execute on function weekday_popularity_ranking(text, int) to anon;
grant execute on function list_titles(text, text, text, int, int, boolean, date, date) to anon;
grant execute on function titles_by_studio() to anon;
grant execute on function tag_stats(text, int) to anon;
grant execute on function export_titles_data(text, text, boolean, date, date, text) to anon;
