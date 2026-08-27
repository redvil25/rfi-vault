-- 0014_keyword_baseline_and_rate_limit.sql
--
-- Two independent fixes.
--
-- 1. keyword_search() read from rfi_embedding, so the keyword-only row of the
--    ablation table (docs/05-EVALUATION.md §2) returned nothing until the corpus
--    had been embedded. Keyword retrieval does not depend on vectors and must
--    not appear to: an ablation baseline that silently scores zero because a
--    different subsystem is empty is worse than no baseline. It now reads
--    rfi_consideration.fts, the same weighted document the application searches.
--
-- 2. A shared rate-limit window. The in-memory limiter in lib/rate-limit.ts is
--    per instance, and the host runs several, so the real ceiling was
--    limit x instances (ADR-014). Postgres is already here; this needs no new
--    infrastructure.

-- ---------------------------------------------------------------- keyword

create or replace function keyword_search(
  query_text  text,
  match_count int default 10
)
returns table (consideration_id uuid, kind text, rank numeric)
language sql stable
set search_path = public, extensions
as $$
  select
    c.id,
    'CONSIDERATION'::text,
    ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text))::numeric
  from rfi_consideration c
  where query_text is not null
    and c.fts @@ websearch_to_tsquery('english', query_text)
  order by 3 desc
  limit match_count;
$$;

-- ------------------------------------------------------------- rate limit

create table rate_limit_hit (
  bucket     text        not null,
  occurred_at timestamptz not null default now()
);

-- The only query is "hits for this bucket since T", newest first.
create index rate_limit_hit_bucket on rate_limit_hit (bucket, occurred_at desc);

/**
 * Sliding-window limiter shared across every server instance.
 *
 * SECURITY DEFINER because the table is not readable by application roles —
 * callers may consume a token, never inspect or forge another user's window.
 * The search_path is pinned for the same reason it is pinned everywhere else in
 * this schema: an unqualified name in a definer function is a privilege
 * escalation route.
 */
create or replace function consume_rate_limit(
  p_bucket  text,
  p_limit   int,
  p_window_seconds int
)
returns table (allowed boolean, remaining int, retry_after_seconds int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  window_start timestamptz := now() - make_interval(secs => p_window_seconds);
  used         int;
  oldest       timestamptz;
begin
  if p_limit <= 0 or p_window_seconds <= 0 then
    raise exception 'consume_rate_limit: limit and window must be positive';
  end if;

  -- Opportunistic cleanup keeps the table from growing without bound without
  -- needing a scheduled job, which would be a host-specific dependency.
  delete from rate_limit_hit
   where bucket = p_bucket and occurred_at < window_start;

  select count(*), min(occurred_at)
    into used, oldest
    from rate_limit_hit
   where bucket = p_bucket;

  if used >= p_limit then
    return query
      select false,
             0,
             greatest(
               1,
               ceil(extract(epoch from (oldest + make_interval(secs => p_window_seconds) - now())))::int
             );
    return;
  end if;

  insert into rate_limit_hit (bucket) values (p_bucket);

  return query select true, (p_limit - used - 1), 0;
end;
$$;

alter table rate_limit_hit enable row level security;

-- No policies: the table is reachable only through consume_rate_limit(), which
-- is SECURITY DEFINER. RLS is enabled so the CI check that every public table
-- has it stays true, and so a future direct grant cannot quietly open it.

revoke all on function consume_rate_limit(text, int, int) from public;
grant execute on function consume_rate_limit(text, int, int) to service_role;
