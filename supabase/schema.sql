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

create table if not exists episodes (
  title_id         bigint not null references titles(title_id),
  no               integer not null,
  subtitle         text,
  service_date     date,
  is_free          boolean not null,
  first_tracked_at timestamptz not null default now(),
  primary key (title_id, no)
);

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

-- Row Level Security: 읽기는 누구나(anon), 쓰기는 service role만 가능
alter table titles enable row level security;
alter table episodes enable row level security;
alter table comment_snapshots enable row level security;
alter table title_snapshots enable row level security;
alter table series_snapshots enable row level security;
alter table series_products enable row level security;

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

-- service_role 키는 RLS를 우회하므로 쓰기용 정책은 별도로 필요 없음 (수집기는 service role key 사용)

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

-- 최근 launch_date(1화 등록일)가 days_back일 이내인 작품들을 인기순위(요일 내 순위)로 정렬.
-- 요일이 다르면 순위 숫자가 완전히 동일 기준은 아니지만(요일별로 리셋됨), 신작 풀이 작아 참고용으로는 충분함.
create or replace function new_release_popularity_ranking(days_back int default 90, result_limit int default 30)
returns table (
  title_id bigint,
  title_name text,
  thumbnail_url text,
  launch_date date,
  popularity_rank integer,
  weekday text
)
language sql
stable
as $$
  with latest as (
    select snapshot_date from title_snapshots order by snapshot_date desc limit 1
  ),
  launch as (
    select title_id, min(service_date) as launch_date
    from episodes
    group by title_id
  )
  select ti.title_id, ti.title_name, ti.thumbnail_url, l.launch_date, ts.popularity_rank, ts.weekday
  from launch l
  join titles ti on ti.title_id = l.title_id
  left join title_snapshots ts on ts.title_id = l.title_id and ts.snapshot_date = (select snapshot_date from latest)
  where l.launch_date >= (current_date - days_back) and ti.is_active = true
  order by ts.popularity_rank asc nulls last, l.launch_date desc
  limit result_limit;
$$;

grant execute on function latest_snapshot_date() to anon;
grant execute on function top_movers(int) to anon;
grant execute on function weekday_popularity_ranking(text, int) to anon;
grant execute on function new_release_popularity_ranking(int, int) to anon;
