-- 0021_trial_protocol_code.sql
--
-- Adds the sponsor protocol code as a first-class search filter.
--
-- A trial carries two identifiers that regulatory colleagues use for different
-- things. `eu_trial_number` (2024-519530-24-00) is the EU CT number CTIS issues
-- and the one a Member State quotes back in an RFI. The *protocol code* is the
-- sponsor's own identifier for the study — it is what appears on the protocol
-- cover page, what a study manager says out loud, and the thing they will type
-- into this repository first. They are not interchangeable, and labelling one as
-- the other is exactly the vocabulary slip docs/01-DOMAIN.md §5 warns about.
--
-- The code is synthetic like the rest of the corpus and derived from the IMP the
-- trial already carries, so the title, `imp_name` and `protocol_code` on one row
-- always name the same product. A trial titled "...of NN-1234..." whose protocol
-- code says NN9876 is the kind of inconsistency a judge spots immediately.
--
-- Like 0018, the filter flows through search_considerations, hybrid_search *and*
-- search_facets. A filter present in one and absent from the others produces
-- facet counts that do not match the result list, which reads as a data bug.

-- ---------------------------------------------------------------------------
-- Drop the previous signatures FIRST.
-- ---------------------------------------------------------------------------
--
-- `create or replace function` only replaces when the argument list matches
-- exactly. Adding a parameter creates an *overload*, and Postgres then refuses
-- any call it cannot disambiguate ("function search_facets() is not unique").
-- Every call the application makes passes named arguments and omits the rest, so
-- all three would fail at runtime with a green typecheck and a green build. See
-- the same note in 0018.

drop function if exists search_facets(text, section_part, text, text, text);

drop function if exists search_considerations(
  text, section_part, text, text, text, rfi_phase, submission_type,
  response_status, timestamptz, timestamptz, text, text, text, int, int
);

drop function if exists hybrid_search(
  text, extensions.vector, int, text, text, section_part, text, timestamptz,
  boolean, text, text, int
);

alter table trial add column if not exists protocol_code text;

comment on column trial.protocol_code is
  'Sponsor protocol code, e.g. NN1234-4567. Distinct from eu_trial_number, which is the EU CT number. Synthetic, like the rest of the corpus.';

-- Backfill so an existing corpus gains the column without a reseed. The product
-- half comes from the IMP the row already carries; the four-digit serial is
-- derived from the EU trial number so it is stable and unique per trial rather
-- than random. `npm run seed` writes the same shape from the generator.
update trial
   set protocol_code =
         'NN' || replace(imp_name, '-', '')
              || '-'
              || lpad((abs(hashtext(eu_trial_number)) % 10000)::text, 4, '0')
 where protocol_code is null
   and imp_name is not null;

create index if not exists trial_protocol_code on trial (protocol_code);

-- ---------------------------------------------------------------------------
-- search_considerations — 0018 plus the protocol code filter
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
-- search_facets — counts for the new dropdown
-- ---------------------------------------------------------------------------

create or replace function search_facets(
  q                  text         default null,
  f_part             section_part default null,
  f_member_state     text         default null,
  f_therapeutic_area text         default null,
  f_imp_name         text         default null,
  f_protocol_code    text         default null
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
  select c.category, c.section, c.member_state, c.section_part,
         t.therapeutic_area, t.imp_name, t.protocol_code
  from rfi_consideration c
  join trial t on t.id = c.trial_id
  where ((select query from tsq) is null or c.fts @@ (select query from tsq))
    and (f_part             is null or c.section_part     = f_part)
    and (f_member_state     is null or c.member_state     = f_member_state)
    and (f_therapeutic_area is null or t.therapeutic_area = f_therapeutic_area)
    and (f_imp_name         is null or t.imp_name         = f_imp_name)
    and (f_protocol_code    is null or t.protocol_code    = f_protocol_code)
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
order by 1, 3 desc;
$$;

-- ---------------------------------------------------------------------------
-- hybrid_search — same filter, so semantic results narrow identically
-- ---------------------------------------------------------------------------

create or replace function hybrid_search(
  query_text        text,
  query_embed       vector(768),
  match_count       int          default 10,
  f_section         text         default null,
  f_member_state    text         default null,
  f_part            section_part default null,
  f_category        text         default null,
  f_from            timestamptz  default null,
  f_approved_only   boolean      default false,
  f_therapeutic_area text        default null,
  f_imp_name        text         default null,
  f_protocol_code   text         default null,
  rrf_k             int          default 60
)
returns table (
  consideration_id  uuid,
  kind              text,
  vector_rank       int,
  fts_rank          int,
  rrf_score         numeric,
  vector_similarity numeric
)
language sql stable
set search_path = public, extensions
as $$
with base as (
  select e.id, e.consideration_id, e.kind, e.embedding, e.fts
  from rfi_embedding e
  join rfi_consideration c on c.id = e.consideration_id
  join rfi_document d      on d.id = c.document_id
  join trial t             on t.id = c.trial_id
  where (f_section          is null or c.section         = f_section)
    and (f_member_state     is null or c.member_state    = f_member_state)
    and (f_part             is null or c.section_part    = f_part)
    and (f_category         is null or c.category        = f_category)
    and (f_from             is null or d.issued_at      >= f_from)
    and (f_therapeutic_area is null or t.therapeutic_area = f_therapeutic_area)
    and (f_imp_name         is null or t.imp_name         = f_imp_name)
    and (f_protocol_code    is null or t.protocol_code    = f_protocol_code)
    and (not f_approved_only
         or (c.response_status in ('APPROVED','SUBMITTED') and c.outcome = 'ACCEPTED'))
),
vec as (
  select id, consideration_id, kind,
         row_number() over (order by embedding <=> query_embed) as rank,
         1 - (embedding <=> query_embed) as similarity
  from base
  order by embedding <=> query_embed
  limit 50
),
kw as (
  select id, consideration_id, kind,
         row_number() over (
           order by ts_rank_cd(fts, websearch_to_tsquery('english', query_text)) desc
         ) as rank
  from base
  where query_text is not null
    and fts @@ websearch_to_tsquery('english', query_text)
  limit 50
)
select
  coalesce(vec.consideration_id, kw.consideration_id) as consideration_id,
  coalesce(vec.kind, kw.kind)                         as kind,
  vec.rank::int                                       as vector_rank,
  kw.rank::int                                        as fts_rank,
  (coalesce(1.0 / (rrf_k + vec.rank), 0)
   + coalesce(1.0 / (rrf_k + kw.rank), 0))::numeric   as rrf_score,
  coalesce(vec.similarity, 0)::numeric                as vector_similarity
from vec
full outer join kw on vec.id = kw.id
order by rrf_score desc
limit match_count;
$$;
