-- 0019_analytics.sql
--
-- Feature 4. Aggregates for the analytics dashboard (docs/02-ARCHITECTURE.md §4.5).
--
-- These return counts and nothing else. The taxonomy — tier, preventability,
-- owning team — stays in lib/domain/taxonomy.ts and is applied in TypeScript
-- after the query. Encoding it here as well would be a second copy of the
-- domain knowledge, drifting from the first, which is exactly what ADR-024
-- avoided for the rule engine.
--
-- SECURITY INVOKER throughout, so every number a user sees is already filtered
-- by the RLS policies on rfi_consideration. Two teams looking at the same
-- dashboard can legitimately see different totals.

-- ---------------------------------------------------------------------------
-- By category — the recurrence story
-- ---------------------------------------------------------------------------
--
-- `distinct_trials` is the column that matters. "This issue occurred 77 times"
-- is noise if it was one trial having a bad month; "77 times across 54 distinct
-- trials" is a systemic problem worth preventing, and that is the Business
-- Impact argument.

create or replace function rfi_stats_by_category()
returns table (
  category         text,
  occurrences      bigint,
  distinct_trials  bigint,
  member_states    bigint,
  accepted         bigint,
  open_items       bigint
)
language sql stable
set search_path = public, extensions
as $$
  select
    c.category,
    count(*)::bigint                                              as occurrences,
    count(distinct c.trial_id)::bigint                            as distinct_trials,
    count(distinct c.member_state)::bigint                        as member_states,
    count(*) filter (where c.outcome = 'ACCEPTED')::bigint        as accepted,
    count(*) filter (where c.response_status in ('DRAFT','IN_REVIEW'))::bigint as open_items
  from rfi_consideration c
  group by c.category
  order by occurrences desc;
$$;

-- ---------------------------------------------------------------------------
-- Over time — monthly volume, for the trend line and the ISTAT spike
-- ---------------------------------------------------------------------------

create or replace function rfi_stats_by_month(f_member_state text default null)
returns table (month date, occurrences bigint, member_states bigint)
language sql stable
set search_path = public, extensions
as $$
  select
    date_trunc('month', d.issued_at)::date as month,
    count(*)::bigint                        as occurrences,
    count(distinct c.member_state)::bigint  as member_states
  from rfi_consideration c
  join rfi_document d on d.id = c.document_id
  where (f_member_state is null or c.member_state = f_member_state)
  group by 1
  order by 1;
$$;

-- ---------------------------------------------------------------------------
-- By Member State
-- ---------------------------------------------------------------------------

create or replace function rfi_stats_by_member_state()
returns table (member_state text, occurrences bigint, distinct_trials bigint)
language sql stable
set search_path = public, extensions
as $$
  select
    c.member_state,
    count(*)::bigint                   as occurrences,
    count(distinct c.trial_id)::bigint as distinct_trials
  from rfi_consideration c
  where c.member_state is not null
  group by c.member_state
  order by occurrences desc;
$$;

-- ---------------------------------------------------------------------------
-- Clock analytics — issued to responded
-- ---------------------------------------------------------------------------
--
-- Only documents that were actually answered are counted. Including unanswered
-- ones as zero would flatter the average; excluding them and saying so is
-- honest, and `unanswered` is returned alongside so the denominator is visible.

create or replace function rfi_turnaround_stats()
returns table (
  answered     bigint,
  unanswered   bigint,
  median_days  numeric,
  p90_days     numeric,
  mean_days    numeric,
  answered_late bigint
)
language sql stable
set search_path = public, extensions
as $$
  with spans as (
    select
      extract(epoch from (d.responded_at - d.issued_at)) / 86400.0 as days,
      d.responded_at > d.due_at as late
    from rfi_document d
    where d.responded_at is not null
  )
  select
    (select count(*) from spans)::bigint,
    (select count(*) from rfi_document where responded_at is null)::bigint,
    percentile_cont(0.5) within group (order by days)::numeric(6,2),
    percentile_cont(0.9) within group (order by days)::numeric(6,2),
    avg(days)::numeric(6,2),
    count(*) filter (where late)::bigint
  from spans;
$$;
