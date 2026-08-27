-- 0013_manual_search.sql
--
-- Manual (non-AI) search: a weighted full-text column on rfi_consideration,
-- plus the two functions the /search page calls.
--
-- RECOVERED FILE. These objects were applied straight to the linked project and
-- the migration was never committed, so `supabase db reset` produced a database
-- without search_considerations() and the app failed on a fresh clone. The
-- definitions below are dumped verbatim from the live project. Do not edit them
-- to "improve" them — write a new numbered migration instead (CLAUDE.md §8).

-- Weighted document: the consideration itself outranks the response, which
-- outranks the metadata. ts_rank_cd reads these weights.
alter table rfi_consideration
  add column if not exists fts tsvector generated always as (
    setweight(to_tsvector('english', coalesce(consideration_text,    '')), 'A')
    || setweight(to_tsvector('english', coalesce(sponsor_response_text, '')), 'B')
    || setweight(to_tsvector('english', coalesce(document_name,      '')), 'C')
    || setweight(to_tsvector('english', coalesce(category,           '')), 'D')
    || setweight(to_tsvector('english', coalesce(section,            '')), 'D')
  ) stored;

create index if not exists rfi_cons_fts on rfi_consideration using gin (fts);

create index if not exists rfi_cons_resp_trgm on rfi_consideration
  using gin ((coalesce(sponsor_response_text, '')) gin_trgm_ops);

create or replace function search_considerations(
  q                text          default null,
  f_part           section_part  default null,
  f_section        text          default null,
  f_member_state   text          default null,
  f_category       text          default null,
  f_phase          rfi_phase     default null,
  f_submission_type submission_type default null,
  f_status         response_status default null,
  f_from           timestamptz   default null,
  f_to             timestamptz   default null,
  sort             text          default 'relevance',
  lim              int           default 20,
  off              int           default 0
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
with q_norm as (
  select nullif(btrim(coalesce(q, '')), '') as term
),
tsq as (
  select case when term is null then null
              else websearch_to_tsquery('english', term) end as query,
         term
  from q_norm
),
filtered as (
  select
    c.*, d.document_ref, d.submission_type, d.phase, d.issued_at, d.due_at,
    t.eu_trial_number, t.short_title,
    tsq.query, tsq.term,
    -- Identifier hit: users paste document references and trial numbers verbatim.
    (tsq.term is not null and (
        d.document_ref    ilike '%' || tsq.term || '%'
     or t.eu_trial_number ilike '%' || tsq.term || '%'
    )) as id_hit,
    (tsq.query is not null and c.fts @@ tsq.query) as text_hit
  from rfi_consideration c
  join rfi_document d on d.id = c.document_id
  join trial t        on t.id = c.trial_id
  cross join tsq
  where (f_part            is null or c.section_part    = f_part)
    and (f_section         is null or c.section         = f_section)
    and (f_member_state    is null or c.member_state    = f_member_state)
    and (f_category        is null or c.category        = f_category)
    and (f_phase           is null or d.phase           = f_phase)
    and (f_submission_type is null or d.submission_type = f_submission_type)
    and (f_status          is null or c.response_status = f_status)
    and (f_from            is null or d.issued_at      >= f_from)
    and (f_to              is null or d.issued_at      <= f_to)
),
matched as (
  select *,
    case
      when term is null then 0::real
      -- An exact identifier match always outranks a text match.
      when id_hit then 10::real + coalesce(ts_rank_cd(fts, query), 0)
      else ts_rank_cd(fts, query)
    end as rank,
    case
      when term is null      then 'browse'
      when id_hit and text_hit then 'identifier + text'
      when id_hit            then 'identifier'
      else 'text'
    end as matched_on
  from filtered
  where term is null or id_hit or text_hit
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

create or replace function search_facets(
  q              text         default null,
  f_part         section_part default null,
  f_member_state text         default null
)
returns table (facet text, value text, count bigint)
language sql stable
set search_path = public, extensions
as $$
with tsq as (
  select case when nullif(btrim(coalesce(q,'')),'') is null then null
              else websearch_to_tsquery('english', q) end as query
),
base as (
  select c.*
  from rfi_consideration c
  cross join tsq
  where (tsq.query is null or c.fts @@ tsq.query)
    and (f_part         is null or c.section_part = f_part)
    and (f_member_state is null or c.member_state = f_member_state)
)
select 'category', category, count(*) from base group by category
union all
select 'section', section, count(*) from base group by section
union all
select 'member_state', member_state, count(*) from base
  where member_state is not null group by member_state
union all
select 'section_part', section_part::text, count(*) from base group by section_part
order by 1, 3 desc;
$$;
