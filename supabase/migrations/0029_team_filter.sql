-- 0029_team_filter.sql
--
-- Adds the owning team as a first-class search filter.
--
-- `owner_team` has been on `rfi_consideration` since 0003 and every row carries
-- it: both the seed generator and the ingestion classifier write it from the
-- category's `owner` in lib/domain/taxonomy.ts, so the column is already the
-- taxonomy's team-per-category mapping, materialised. Filtering on it directly
-- is therefore the same answer as expanding a team into its category list,
-- minus the chance of the two drifting apart (ADR-024).
--
-- It is also the column the RLS policies key work-in-progress visibility on
-- (0012), which makes "show me this team's considerations" the same predicate
-- the database already reasons about rather than a second, parallel notion of
-- team.
--
-- Like 0018 and 0021, the filter flows through search_considerations *and*
-- search_facets. A filter present in one and absent from the other produces
-- facet counts that do not match the result list, which reads as a data bug.

-- ---------------------------------------------------------------------------
-- Drop the previous signatures FIRST.
-- ---------------------------------------------------------------------------
--
-- `create or replace function` only replaces when the argument list matches
-- exactly. Adding a parameter creates an *overload*, and Postgres then refuses
-- any call it cannot disambiguate. Every call the application makes passes
-- named arguments and omits the rest, so both would fail at runtime with a
-- green typecheck and a green build. CI fails on any duplicate signature
-- (ADR-026); this is the hazard 0018 and 0021 document.

drop function if exists search_facets(text, section_part, text, text, text, text);

drop function if exists search_considerations(
  text, section_part, text, text, text, rfi_phase, submission_type,
  response_status, timestamptz, timestamptz, text, text, text, text, int, int
);

-- Equality on a low-cardinality column that is usually combined with others, so
-- this supports rather than drives. It earns its place on the team-only browse
-- — no query, no other filter — which would otherwise scan the whole corpus.
create index if not exists rfi_cons_owner_team on rfi_consideration (owner_team);

-- ---------------------------------------------------------------------------
-- search_considerations — 0021 plus the owning-team filter
-- ---------------------------------------------------------------------------

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
  f_therapeutic_area text           default null,
  f_imp_name        text            default null,
  f_protocol_code   text            default null,
  f_owner_team      team_role       default null,
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
  short_title text, therapeutic_area text, imp_name text,
  rank real, matched_on text, total_count bigint
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
  -- Full-text branch. The InitPlan keeps this an index condition (ADR-023).
  select c.id,
         false                                             as id_hit,
         true                                              as text_hit,
         ts_rank_cd(c.fts, (select query from tsq))        as text_rank
  from rfi_consideration c
  where (select query from tsq) is not null
    and c.fts @@ (select query from tsq)

  union all

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
  select id, bool_or(id_hit) as id_hit, bool_or(text_hit) as text_hit, max(text_rank) as text_rank
  from hit group by id
),
candidate as (
  select c.id, false as id_hit, false as text_hit, 0::real as text_rank
  from rfi_consideration c
  where (select term from tsq) is null
  union all
  select id, id_hit, text_hit, text_rank from merged
),
matched as (
  select
    c.id, c.consideration_number, c.section_part, c.section, c.document_name,
    c.member_state, c.category, c.consideration_text, c.sponsor_response_text,
    c.response_status, c.outcome, c.owner_team,
    d.document_ref, d.submission_type, d.phase, d.issued_at, d.due_at,
    t.eu_trial_number, t.short_title, t.therapeutic_area, t.imp_name,
    case
      when (select term from tsq) is null then 0::real
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
  where (f_part             is null or c.section_part    = f_part)
    and (f_section          is null or c.section         = f_section)
    and (f_member_state     is null or c.member_state    = f_member_state)
    and (f_category         is null or c.category        = f_category)
    and (f_phase            is null or d.phase           = f_phase)
    and (f_submission_type  is null or d.submission_type = f_submission_type)
    and (f_status           is null or c.response_status = f_status)
    and (f_from             is null or d.issued_at      >= f_from)
    and (f_to               is null or d.issued_at      <= f_to)
    and (f_therapeutic_area is null or t.therapeutic_area = f_therapeutic_area)
    and (f_imp_name         is null or t.imp_name         = f_imp_name)
    and (f_protocol_code    is null or t.protocol_code    = f_protocol_code)
    and (f_owner_team       is null or c.owner_team       = f_owner_team)
)
select
  id, consideration_number, section_part, section, document_name, member_state,
  category, consideration_text, sponsor_response_text, response_status, outcome,
  owner_team, document_ref, submission_type, phase, issued_at, due_at,
  eu_trial_number, short_title, therapeutic_area, imp_name, rank, matched_on,
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

-- ---------------------------------------------------------------------------
-- search_facets — counts for the new dropdown, and counts that respect it
-- ---------------------------------------------------------------------------
--
-- `owner_team` narrows the base the way `member_state` does, so choosing a team
-- recomputes every other dropdown's counts against that team's considerations.
-- The team facet is emitted from the same base, which is why the list collapses
-- to the chosen team once one is picked — the behaviour the Member State filter
-- has had since 0013, and "Any" is always there to widen again.

create or replace function search_facets(
  q                  text         default null,
  f_part             section_part default null,
  f_member_state     text         default null,
  f_therapeutic_area text         default null,
  f_imp_name         text         default null,
  f_protocol_code    text         default null,
  f_owner_team       team_role    default null
)
returns table (facet text, value text, count bigint)
language sql stable
set search_path = public, extensions
as $$
with tsq as materialized (
  select case when nullif(btrim(coalesce(q,'')),'') is null then null
              else websearch_to_tsquery('english', q) end as query
),
base as (
  select c.category, c.section, c.member_state, c.section_part, c.owner_team,
         t.therapeutic_area, t.imp_name, t.protocol_code
  from rfi_consideration c
  join trial t on t.id = c.trial_id
  where ((select query from tsq) is null or c.fts @@ (select query from tsq))
    and (f_part             is null or c.section_part     = f_part)
    and (f_member_state     is null or c.member_state     = f_member_state)
    and (f_therapeutic_area is null or t.therapeutic_area = f_therapeutic_area)
    and (f_imp_name         is null or t.imp_name         = f_imp_name)
    and (f_protocol_code    is null or t.protocol_code    = f_protocol_code)
    and (f_owner_team       is null or c.owner_team       = f_owner_team)
)
select 'category', category, count(*) from base group by category
union all
select 'section', section, count(*) from base group by section
union all
select 'member_state', member_state, count(*) from base
  where member_state is not null group by member_state
union all
select 'section_part', section_part::text, count(*) from base group by section_part
union all
select 'therapeutic_area', therapeutic_area, count(*) from base
  where therapeutic_area is not null group by therapeutic_area
union all
select 'imp_name', imp_name, count(*) from base
  where imp_name is not null group by imp_name
union all
select 'protocol_code', protocol_code, count(*) from base
  where protocol_code is not null group by protocol_code
union all
select 'owner_team', owner_team::text, count(*) from base
  where owner_team is not null group by owner_team
order by 1, 3 desc;
$$;

-- A dropped function takes its privileges with it, and a created one comes back
-- with Postgres's default EXECUTE to PUBLIC — which includes `anon`. 0015
-- revoked exactly that and said why: a future policy written without a role
-- clause must not be able to re-open the hole 0012 closed. State the privilege
-- here rather than inherit it, so the migration describes it (ADR-022).
revoke all on function search_considerations(
  text, section_part, text, text, text, rfi_phase, submission_type,
  response_status, timestamptz, timestamptz, text, text, text, team_role,
  text, int, int
) from anon;

revoke all on function search_facets(
  text, section_part, text, text, text, text, team_role
) from anon;

grant execute on function search_considerations(
  text, section_part, text, text, text, rfi_phase, submission_type,
  response_status, timestamptz, timestamptz, text, text, text, team_role,
  text, int, int
) to authenticated, service_role;

grant execute on function search_facets(
  text, section_part, text, text, text, text, team_role
) to authenticated, service_role;
