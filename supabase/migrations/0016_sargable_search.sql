-- 0016_sargable_search.sql
--
-- Makes search_considerations() able to use its indexes.
--
-- The 0013 body computed `id_hit` and `text_hit` as expressions over a
-- `cross join tsq`, then filtered on `term is null or id_hit or text_hit`. Two
-- consequences, both confirmed by measurement rather than inferred:
--
--   * the tsquery was not something the planner could evaluate ahead of the
--     scan, so `c.fts @@ tsq.query` could never be an index condition;
--   * an OR across three CTE-derived expressions has no sargable form at all,
--     so every search read the whole joined set.
--
-- Evidence: `rfi_cons_fts` showed idx_scan = 0 in pg_stat_user_indexes after a
-- full seed and repeated searches, and Supabase's advisor reported it as an
-- index that had never been used. 2,577 shared buffers to answer one query over
-- 940 rows.
--
-- Two changes fix it, and neither alters a single result:
--
--   1. `(select query from tsq)` as a scalar subquery becomes an InitPlan —
--      evaluated once per statement, before the scan, so it can drive the GIN
--      index. Exactly the trick 0012 used to stop auth.uid() re-evaluating per
--      row, applied to the query text instead.
--   2. The OR becomes a UNION of branches, each of which can pick its own index:
--      full-text through rfi_cons_fts, identifiers through the trigram indexes
--      created below.
--
-- Output is intended to be byte-identical to 0013 for every input. The rank
-- arithmetic, the matched_on vocabulary, the sort order, the total_count window
-- and the limit clamping are all carried over unchanged.

-- Identifier matching is `ilike '%term%'`, which only a trigram index can serve.
create extension if not exists pg_trgm with schema extensions;

create index if not exists rfi_document_ref_trgm
  on rfi_document using gin (document_ref extensions.gin_trgm_ops);

create index if not exists trial_number_trgm
  on trial using gin (eu_trial_number extensions.gin_trgm_ops);

create or replace function search_considerations(
  q                 text            default null,
  f_part            section_part    default null,
  f_section         text            default null,
  f_member_state    text            default null,
  f_category        text            default null,
  f_phase           rfi_phase       default null,
  f_submission_type submission_type default null,
  f_status          response_status default null,
  f_from            timestamptz     default null,
  f_to              timestamptz     default null,
  sort              text            default 'relevance',
  lim               int             default 20,
  off               int             default 0
)
returns table (
  id uuid, consideration_number int, section_part section_part, section text,
  document_name text, member_state text, category text, consideration_text text,
  sponsor_response_text text, response_status response_status, outcome rfi_outcome,
  owner_team team_role, document_ref text, submission_type submission_type,
  phase rfi_phase, issued_at timestamptz, due_at timestamptz, eu_trial_number text,
  short_title text, rank real, matched_on text, total_count bigint
)
language sql stable
set search_path = public, extensions
as $$
with tsq as materialized (
  select
    nullif(btrim(coalesce(q, '')), '')                          as term,
    case when nullif(btrim(coalesce(q, '')), '') is null then null
         else websearch_to_tsquery('english', q) end            as query
),
hit as (
  -- Full-text branch. `(select query from tsq)` is an InitPlan, so this is an
  -- index condition on rfi_cons_fts rather than a filter over every row.
  select c.id,
         false                                             as id_hit,
         true                                              as text_hit,
         ts_rank_cd(c.fts, (select query from tsq))        as text_rank
  from rfi_consideration c
  where (select query from tsq) is not null
    and c.fts @@ (select query from tsq)

  union all

  -- Identifier branch. Users paste document references and trial numbers
  -- verbatim; these are exactly the strings full-text handles worst.
  select c.id, true, false, 0::real
  from rfi_consideration c
  join rfi_document d on d.id = c.document_id
  join trial t        on t.id = c.trial_id
  where (select term from tsq) is not null
    and (
         d.document_ref    ilike '%' || (select term from tsq) || '%'
      or t.eu_trial_number ilike '%' || (select term from tsq) || '%'
    )
),
merged as (
  select id,
         bool_or(id_hit)   as id_hit,
         bool_or(text_hit) as text_hit,
         max(text_rank)    as text_rank
  from hit
  group by id
),
candidate as (
  -- Browsing with filters and no query term: every row is a candidate. Mutually
  -- exclusive with the branch below, so `union all` is safe.
  select c.id, false as id_hit, false as text_hit, 0::real as text_rank
  from rfi_consideration c
  where (select term from tsq) is null

  union all

  select id, id_hit, text_hit, text_rank
  from merged
),
matched as (
  select
    c.id, c.consideration_number, c.section_part, c.section, c.document_name,
    c.member_state, c.category, c.consideration_text, c.sponsor_response_text,
    c.response_status, c.outcome, c.owner_team,
    d.document_ref, d.submission_type, d.phase, d.issued_at, d.due_at,
    t.eu_trial_number, t.short_title,
    case
      when (select term from tsq) is null then 0::real
      -- An exact identifier match always outranks a text match.
      when k.id_hit then 10::real + coalesce(k.text_rank, 0)
      else k.text_rank
    end as rank,
    case
      when (select term from tsq) is null    then 'browse'
      when k.id_hit and k.text_hit           then 'identifier + text'
      when k.id_hit                          then 'identifier'
      else 'text'
    end as matched_on
  from candidate k
  join rfi_consideration c on c.id = k.id
  join rfi_document d      on d.id = c.document_id
  join trial t             on t.id = c.trial_id
  where (f_part            is null or c.section_part    = f_part)
    and (f_section         is null or c.section         = f_section)
    and (f_member_state    is null or c.member_state    = f_member_state)
    and (f_category        is null or c.category        = f_category)
    and (f_phase           is null or d.phase           = f_phase)
    and (f_submission_type is null or d.submission_type = f_submission_type)
    and (f_status          is null or c.response_status = f_status)
    and (f_from            is null or d.issued_at      >= f_from)
    and (f_to              is null or d.issued_at      <= f_to)
)
select
  id, consideration_number, section_part, section, document_name, member_state,
  category, consideration_text, sponsor_response_text, response_status, outcome,
  owner_team, document_ref, submission_type, phase, issued_at, due_at,
  eu_trial_number, short_title, rank, matched_on,
  count(*) over () as total_count
from matched
order by
  case when sort = 'newest' then issued_at end desc nulls last,
  case when sort = 'oldest' then issued_at end asc  nulls last,
  case when sort = 'relevance' then rank end desc nulls last,
  issued_at desc
limit  greatest(1, least(lim, 100))
offset greatest(0, off);
$$;
