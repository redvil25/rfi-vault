-- 0026_hybrid_identifier_arm.sql
--
-- `hybrid_search` had no identifier branch, and the ablation table caught it.
--
-- READ THIS BEFORE QUOTING THE OLD NUMBERS.
--
-- The first evaluation run with a populated `rfi_embedding` produced a table
-- that argued against the product's central technical claim:
--
--   | Configuration      | Recall@5 | identifier | semantic |
--   | Keyword only       |    0.634 |      1.000 |    0.000 |
--   | Vector only        |    0.195 |      0.000 |    0.580 |
--   | Hybrid (RRF, k=60) |    0.220 |      0.000 |    0.680 |
--
-- Hybrid was *worse overall than keyword alone*, because it scored zero on the
-- identifier queries keyword answers perfectly — 25 of the 41 gold queries.
--
-- The cause was not fusion, tuning, or `rrf_k`. `search_considerations` (0016)
-- has two branches: full text, and an identifier branch matching a pasted
-- `document_ref` or `eu_trial_number` with ILIKE, because those strings are
-- exactly what `to_tsvector` mangles. `hybrid_search` only ever had the
-- full-text arm. A pasted document reference matched nothing in its keyword arm,
-- the vector arm cannot match an identifier either, and the fusion of two empty
-- results is an empty result.
--
-- ADR-002 claims hybrid retrieval exists so identifiers and meaning both work.
-- That was true of `search_considerations` and false of `hybrid_search` — which
-- is the function drafting, suggestions and the search page actually call.
--
-- Identifier hits enter the fusion at rank 1. An exact reference match is not a
-- fuzzy signal to be blended; it is the row the user asked for by name.

-- ---------------------------------------------------------------------------
-- Drop the previous signatures FIRST — for the reason 0021 documents.
-- ---------------------------------------------------------------------------
--
-- `create or replace function` only replaces when the argument list matches
-- exactly, so a stale 10-argument signature left beside the current
-- 13-argument one makes every named-argument call ambiguous and Postgres
-- refuses it. That is precisely what happened on the first attempt at this
-- migration, and it is why 0021 says this in capitals.

drop function if exists hybrid_search(
  text, vector(768), int, text, text, section_part, text, timestamptz, boolean, int
);

drop function if exists hybrid_search(
  text, vector(768), int, text, text, section_part, text, timestamptz, boolean,
  text, text, text, int
);

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
with term as materialized (
  select nullif(btrim(coalesce(query_text, '')), '') as t
),
base as (
  select e.id, e.consideration_id, e.kind, e.embedding, e.fts,
         d.document_ref, t.eu_trial_number
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
),
-- The arm that was missing. Mirrors the identifier branch of
-- `search_considerations` (0016), so the two functions agree about what counts
-- as an identifier match.
ident as (
  select id, consideration_id, kind, 1 as rank
  from base
  where (select t from term) is not null
    and (
         document_ref    ilike '%' || (select t from term) || '%'
      or eu_trial_number ilike '%' || (select t from term) || '%'
    )
  limit 50
)
select
  coalesce(vec.consideration_id, kw.consideration_id, ident.consideration_id) as consideration_id,
  coalesce(vec.kind, kw.kind, ident.kind)                                     as kind,
  vec.rank::int                                                               as vector_rank,
  -- An identifier hit reports as a keyword hit at rank 1 when full text found
  -- nothing, so the caller's "matched on" explanation stays truthful without a
  -- new column: it is a match in keyword space, not in vector space.
  coalesce(kw.rank, ident.rank)::int                                          as fts_rank,
  (coalesce(1.0 / (rrf_k + vec.rank), 0)
   + coalesce(1.0 / (rrf_k + kw.rank), 0)
   + coalesce(1.0 / (rrf_k + ident.rank), 0))::numeric                        as rrf_score,
  coalesce(vec.similarity, 0)::numeric                                        as vector_similarity
from vec
full outer join kw    on kw.id = vec.id
full outer join ident on ident.id = coalesce(vec.id, kw.id)
order by rrf_score desc
limit greatest(1, least(match_count, 50));
$$;
