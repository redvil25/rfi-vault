-- 0027_lexical_precedents.sql
--
-- Precedent retrieval without embeddings, and a confidence gate that still
-- refuses (ADR-039).
--
-- Features 3 and 6 gate on "is any precedent close enough to answer from". That
-- gate was cosine distance over `rfi_embedding`, which meant every draft and
-- every suggestion depended on an embedding model being available wherever the
-- app runs. Dropping embeddings therefore cannot mean dropping the gate: the
-- refusal is the product's central claim (CLAUDE.md §2 rule 2), and a version
-- that always answers is not a cheaper version of this product, it is a
-- different and worse one.
--
-- So the gate moves to lexical evidence, and says so.
--
-- `similarity()` from pg_trgm is a true 0..1 score over trigram overlap, backed
-- by the `rfi_cons_trgm` GIN index that has existed since 0003. Full text finds
-- candidates that share stemmed words; trigram scores how much of the actual
-- wording is shared. Neither knows what a sentence means, and the caller is
-- expected to label the number honestly — it is `lexical_score`, not
-- `similarity`, because a reader who thinks it measures meaning will set the
-- threshold wrong.
--
-- What this loses is real and is written down rather than glossed: a paraphrase
-- with no shared vocabulary scores near zero here and scored 0.58 under vector
-- retrieval. The gate will refuse on requests it used to answer. Refusing on a
-- request that had a good precedent is a worse failure than the old one, and it
-- is the price of the constraint.

create or replace function lexical_precedents(
  query_text      text,
  f_section       text         default null,
  f_part          section_part default null,
  f_approved_only boolean      default true,
  match_count     int          default 10
)
returns table (
  consideration_id  uuid,
  lexical_score     numeric,
  matched_on        text
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
with term as materialized (
  select
    nullif(btrim(coalesce(query_text, '')), '')                     as t,
    case when nullif(btrim(coalesce(query_text, '')), '') is null then null
         else websearch_to_tsquery('english', query_text) end       as q
),
base as (
  select c.id, c.consideration_text, c.fts, d.document_ref, t.eu_trial_number
  from rfi_consideration c
  join rfi_document d on d.id = c.document_id
  join trial t        on t.id = c.trial_id
  where (f_section is null or c.section     = f_section)
    and (f_part    is null or c.section_part = f_part)
    -- A rejected answer is not precedent, and an unanswered request is not one
    -- either. Same filter the vector path applied.
    and (not f_approved_only
         or (c.response_status in ('APPROVED','SUBMITTED')
             and c.outcome = 'ACCEPTED'
             and c.sponsor_response_text is not null))
),
-- Candidates from full text: shared stemmed words, index-backed.
fts_hit as (
  select id from base
  where (select q from term) is not null and fts @@ (select q from term)
  limit 200
),
-- Candidates from trigram overlap, which catches wording full text stems away
-- and identifiers full text mangles. `%` uses the GIN index from 0003.
trgm_hit as (
  select id from base
  where (select t from term) is not null
    and consideration_text % (select t from term)
  limit 200
),
-- An exact reference pasted into the box is the row asked for by name, and
-- scores 1: it is not a fuzzy match to be ranked against paraphrases.
ident_hit as (
  select id from base
  where (select t from term) is not null
    and (
         document_ref    ilike '%' || (select t from term) || '%'
      or eu_trial_number ilike '%' || (select t from term) || '%'
    )
  limit 50
),
candidate as (
  select id from fts_hit
  union select id from trgm_hit
  union select id from ident_hit
)
select
  b.id,
  case
    when b.id in (select id from ident_hit) then 1.0
    else similarity(b.consideration_text, (select t from term))
  end::numeric as lexical_score,
  case
    when b.id in (select id from ident_hit) then 'identifier'
    when b.id in (select id from fts_hit)   then 'text'
    else 'wording'
  end as matched_on
from base b
join candidate on candidate.id = b.id
order by lexical_score desc
limit greatest(1, least(match_count, 50));
$$;
