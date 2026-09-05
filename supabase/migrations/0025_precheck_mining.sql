-- 0025_precheck_mining.sql
--
-- The pre-submission check, rebuilt as retrieval rather than as a score.
--
-- The version removed in 0024 blended a hand-authored rule engine with a
-- similarity term and a base rate, and published a 0-100 number. Two things were
-- wrong with it. The rules asserted national requirements this team has no
-- authority to state, and the number was falsely precise: it had no labelled
-- negative class behind it, because the corpus holds only requests that *were*
-- raised (ADR-025).
--
-- What the corpus can honestly support is a count with a date range and the
-- verbatim text behind it: "Italy raised this on 34 applications between
-- Feb 2025 and Jun 2026 — here are three, with the responses that closed them."
-- That is what these two functions return. No weights, no blending, no score.
--
-- SECURITY INVOKER throughout, so a caller only ever mines rules out of the
-- precedent their own RLS policies let them read. Two teams can legitimately see
-- different counts.
--
-- Taxonomy knowledge — tier, owning team, the artefact a category is about —
-- stays in lib/domain/taxonomy.ts and is applied in TypeScript afterwards.
-- Restating it here would be the second copy ADR-024 exists to prevent.

-- ---------------------------------------------------------------------------
-- Mined rules — recurrence by (Member State x section x submission type)
-- ---------------------------------------------------------------------------
--
-- One row per recurring theme, carrying the three things that make a rule
-- explainable without a model: how often it happened, when it started, and when
-- it was last seen.
--
-- `first_seen` and `last_seen` are the whole point of returning dates rather
-- than a bare count. A theme mined from 2023 that has not recurred since is not
-- a live requirement, and firing it at a writer in 2026 is how a tool loses
-- their trust. The caller decides what to do with a stale rule; this function's
-- job is to make staleness visible instead of averaging it away.
--
-- Part I considerations carry no Member State — they belong to the whole
-- application — so they count for every state under assessment.

create or replace function mined_rules(
  f_member_states   text[]          default null,
  f_submission_type submission_type default null,
  f_sections        text[]          default null
)
returns table (
  category        text,
  section         text,
  section_part    section_part,
  member_state    text,
  hits            bigint,
  distinct_trials bigint,
  resolved_hits   bigint,
  first_seen      timestamptz,
  last_seen       timestamptz
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    c.category,
    c.section,
    c.section_part,
    c.member_state,
    count(*)::bigint                                   as hits,
    count(distinct c.trial_id)::bigint                 as distinct_trials,
    -- A theme is only actionable if somebody has answered it before. This is the
    -- count of occurrences carrying an approved response the regulator accepted
    -- — the rows `rule_precedents` can actually offer as suggested wording.
    count(*) filter (
      where c.sponsor_response_text is not null
        and c.response_status in ('APPROVED', 'SUBMITTED')
        and c.outcome = 'ACCEPTED'
    )::bigint                                          as resolved_hits,
    min(d.issued_at)                                   as first_seen,
    max(d.issued_at)                                   as last_seen
  from rfi_consideration c
  join rfi_document d on d.id = c.document_id
  where
    -- Rows the classifier or the parser refused to place cannot become a rule.
    -- Mining them would invent a requirement out of an admission of ignorance.
    c.category <> 'UNCLASSIFIED'
    and c.section <> 'UNMAPPED'
    and (f_submission_type is null or d.submission_type = f_submission_type)
    and (
      f_sections is null
      or cardinality(f_sections) = 0
      or c.section = any (f_sections)
    )
    and (
      f_member_states is null
      or cardinality(f_member_states) = 0
      or c.member_state is null
      or c.member_state = any (f_member_states)
    )
  group by c.category, c.section, c.section_part, c.member_state
  order by count(*) desc;
$$;

-- ---------------------------------------------------------------------------
-- Rule precedents — the verbatim evidence behind one mined rule
-- ---------------------------------------------------------------------------
--
-- Returns the request as the regulator wrote it, when it was raised, which trial
-- it was raised against, and the sponsor response that closed it.
--
-- The response is the column that earns the screen. A writer does not want to be
-- told a section is risky; they want the sentence that worked last time, with
-- enough provenance to check it themselves. Ordering puts the same Member State
-- first, then the most recent, because national requirements change and the
-- newest accepted answer is the one most likely to still be correct.
--
-- No embeddings here on purpose. Matching is by (category, section, Member
-- State), which is exact, needs no model configured, and is explainable to a
-- regulatory reviewer in one sentence.

create or replace function rule_precedents(
  f_category        text,
  f_section         text            default null,
  f_member_states   text[]          default null,
  f_submission_type submission_type default null,
  match_count       int             default 3
)
returns table (
  consideration_id      uuid,
  consideration_text    text,
  sponsor_response_text text,
  member_state          text,
  section               text,
  issued_at             timestamptz,
  document_ref          text,
  eu_trial_number       text,
  protocol_code         text,
  response_status       response_status,
  outcome               rfi_outcome
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    c.id,
    c.consideration_text,
    c.sponsor_response_text,
    c.member_state,
    c.section,
    d.issued_at,
    d.document_ref,
    t.eu_trial_number,
    t.protocol_code,
    c.response_status,
    c.outcome
  from rfi_consideration c
  join rfi_document d on d.id = c.document_id
  join trial t        on t.id = c.trial_id
  where c.category = f_category
    and (f_section is null or c.section = f_section)
    and (f_submission_type is null or d.submission_type = f_submission_type)
    and (
      f_member_states is null
      or cardinality(f_member_states) = 0
      or c.member_state is null
      or c.member_state = any (f_member_states)
    )
    -- Only answers that were approved and accepted. An unanswered request is not
    -- precedent, and neither is one the regulator came back on.
    and c.sponsor_response_text is not null
    and c.response_status in ('APPROVED', 'SUBMITTED')
    and c.outcome = 'ACCEPTED'
  order by
    case
      when f_member_states is null or cardinality(f_member_states) = 0 then 1
      when c.member_state = any (f_member_states) then 0
      else 1
    end,
    d.issued_at desc
  limit greatest(1, least(match_count, 20));
$$;
