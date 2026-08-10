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

-- Row Level Security: 읽기는 누구나(anon), 쓰기는 service role만 가능
alter table titles enable row level security;
alter table episodes enable row level security;
alter table comment_snapshots enable row level security;

create policy "titles are publicly readable"
  on titles for select
  using (true);

create policy "episodes are publicly readable"
  on episodes for select
  using (true);

create policy "comment_snapshots are publicly readable"
  on comment_snapshots for select
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

grant execute on function latest_snapshot_date() to anon;
grant execute on function top_movers(int) to anon;
