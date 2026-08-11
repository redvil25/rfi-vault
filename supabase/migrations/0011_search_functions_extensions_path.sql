-- 0011_search_functions_extensions_path.sql
--
-- 0010 moved pgvector into the `extensions` schema, so every function that pins
-- its search_path must include it to resolve the `vector` type and the `<=>`
-- cosine-distance operator. This file is 0008 recreated with that change; 0008
-- is kept as-is so the migration history stays forward-only and readable.

create or replace function hybrid_search(
  query_text     text,
  query_embed    vector(768),
  match_count    int          default 10,
  f_section      text         default null,
  f_member_state text         default null,
  f_part         section_part default null,
  f_category     text         default null,
  f_from         timestamptz  default null,
  f_approved_only boolean     default false,
  rrf_k          int          default 60
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
  where (f_section       is null or c.section       = f_section)
    and (f_member_state  is null or c.member_state  = f_member_state)
    and (f_part          is null or c.section_part  = f_part)
    and (f_category      is null or c.category      = f_category)
    and (f_from          is null or d.issued_at    >= f_from)
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

-- Ablation support: single-mode variants kept deliberately so the evaluation
-- harness can produce the keyword-only / vector-only rows of the comparison
-- table (docs/05-EVALUATION.md §2). Do not delete these.

create or replace function vector_search(
  query_embed extensions.vector(768),
  match_count int default 10
)
returns table (consideration_id uuid, kind text, similarity numeric)
language sql stable
set search_path = public, extensions
as $$
  select e.consideration_id, e.kind, (1 - (e.embedding <=> query_embed))::numeric
  from rfi_embedding e
  order by e.embedding <=> query_embed
  limit match_count;
$$;

create or replace function keyword_search(
  query_text  text,
  match_count int default 10
)
returns table (consideration_id uuid, kind text, rank numeric)
language sql stable
set search_path = public, extensions
as $$
  select e.consideration_id, e.kind,
         ts_rank_cd(e.fts, websearch_to_tsquery('english', query_text))::numeric
  from rfi_embedding e
  where e.fts @@ websearch_to_tsquery('english', query_text)
  order by 3 desc
  limit match_count;
$$;
