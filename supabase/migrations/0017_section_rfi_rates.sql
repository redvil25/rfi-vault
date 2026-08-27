-- 0017_section_rfi_rates.sql
--
-- Feature 2, signal (c): how much of historical RFI volume attaches to each
-- application section, for a given submission type and set of Member States.
--
-- READ THIS BEFORE QUOTING THE NUMBER.
--
-- docs/04-AI-PIPELINE.md §3.1(c) describes a true base rate — the probability
-- that a section triggers a request for information — computed over a table of
-- historical sections carrying a `triggered_rfi` flag. That table does not
-- exist, and cannot be derived from what we hold: `rfi_consideration` contains
-- only requests that *were* raised. The negative class, sections that were
-- submitted and drew no request, was never recorded.
--
-- So this returns a **share of observed RFI volume**, not a probability:
-- "IMPD Quality accounts for 12% of the requests we have seen for substantial
-- modifications in Italy". That is a real, useful signal and it is what the data
-- supports. Calling it a probability would be a fabricated statistic.
--
-- Laplace smoothing (hits + 1) / (total + 2) keeps thin slices from producing
-- 0.0 or 1.0 off two observations.

create or replace function section_rfi_rates(
  f_submission_type submission_type default null,
  f_member_states   text[]          default null
)
returns table (section text, section_part section_part, hits bigint, share numeric)
language sql stable
set search_path = public, extensions
as $$
with scoped as (
  select c.section, c.section_part
  from rfi_consideration c
  join rfi_document d on d.id = c.document_id
  where (f_submission_type is null or d.submission_type = f_submission_type)
    and (
      f_member_states is null
      or cardinality(f_member_states) = 0
      -- A Part I consideration carries no Member State: it belongs to the whole
      -- application and counts for every state under assessment.
      or c.member_state is null
      or c.member_state = any (f_member_states)
    )
),
total as (select count(*)::numeric as n from scoped)
select
  s.section,
  s.section_part,
  count(*)::bigint as hits,
  -- Laplace-smoothed share of observed volume. See the header.
  ((count(*)::numeric + 1) / ((select n from total) + 2))::numeric as share
from scoped s
group by s.section, s.section_part
order by hits desc;
$$;

-- ---------------------------------------------------------------------------
-- Feature 2, signal (b): similarity to the sections that did trigger requests.
-- ---------------------------------------------------------------------------
--
-- Matches a draft section against the question space — `kind = 'CONSIDERATION'`,
-- the text of what the regulator actually asked (ADR-003). Matching against the
-- response space would compare a draft to answers, which is the wrong end.
--
-- Returns the precedent text alongside the score so one round trip serves both
-- the signal and the "show me why" evidence. SECURITY INVOKER, so a caller only
-- ever sees precedents their team is allowed to read.

create or replace function section_similarity(
  query_embed     vector(768),
  f_section       text   default null,
  f_member_states text[] default null,
  match_count     int    default 5
)
returns table (
  consideration_id      uuid,
  similarity            numeric,
  category              text,
  section               text,
  member_state          text,
  consideration_text    text,
  sponsor_response_text text,
  response_status       response_status
)
language sql stable
set search_path = public, extensions
as $$
  select
    c.id,
    (1 - (e.embedding <=> query_embed))::numeric as similarity,
    c.category,
    c.section,
    c.member_state,
    c.consideration_text,
    c.sponsor_response_text,
    c.response_status
  from rfi_embedding e
  join rfi_consideration c on c.id = e.consideration_id
  where e.kind = 'CONSIDERATION'
    and (f_section is null or c.section = f_section)
    and (
      f_member_states is null
      or cardinality(f_member_states) = 0
      or c.member_state is null
      or c.member_state = any (f_member_states)
    )
  order by e.embedding <=> query_embed
  limit greatest(1, least(match_count, 50));
$$;
