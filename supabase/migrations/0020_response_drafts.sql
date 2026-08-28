-- 0020_response_drafts.sql
-- Feature 3. Grounded draft generation (docs/04-AI-PIPELINE.md §4).
--
-- One row per generation ATTEMPT, refusals included. A refusal is not a failure
-- to record — it is the behaviour the product is selling, and the corpus-level
-- refusal rate is a number the deck claims. Storing only successes would make
-- that number unmeasurable and the claim unprovable.
--
-- The draft itself is deliberately NOT written onto rfi_consideration. A
-- generated draft is a proposal; sponsor_response_text is the record. The two
-- meet only when a human approves, which is a status transition with its own
-- audit event.

create table response_draft (
  id                   uuid primary key default gen_random_uuid(),
  consideration_id     uuid not null references rfi_consideration(id) on delete cascade,

  -- Refusal path (§4.2). When true, draft_text is null and refusal_reason says why.
  refused              boolean not null default false,
  refusal_reason       text,

  draft_text           text,
  -- [{considerationId, supportsClaim}] — every factual claim traced to a record.
  citations            jsonb   not null default '[]',
  -- [{dimension, precedentValue, currentValue, reviewerAction}]
  deltas               jsonb   not null default '[]',
  attachments_required text[]  not null default '{}',
  open_questions       text[]  not null default '{}',

  -- What the model said about itself, 0-1.
  model_confidence     numeric(4,3) check (model_confidence between 0 and 1),
  -- Retrieval's own number: the best cosine among the precedents used.
  max_similarity       numeric(4,3) check (max_similarity between 0 and 1),
  -- supported_sentences / total_sentences from the verifier pass (§4.5).
  groundedness         numeric(4,3) check (groundedness between 0 and 1),
  -- [{sentence, verdict, considerationIds}] per sentence.
  verdicts             jsonb   not null default '[]',
  -- The precedent ids retrieved, in rank order, whether cited or not.
  precedent_ids        uuid[]  not null default '{}',

  model                text,
  prompt_hash          text,
  created_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),

  -- A refusal has no draft; a draft has text. Enforced here rather than trusted
  -- from the application, because the refusal path is the safety property.
  constraint draft_or_refusal check (
    (refused and draft_text is null) or (not refused and draft_text is not null)
  )
);

create index response_draft_consideration
  on response_draft (consideration_id, created_at desc);
create index response_draft_author on response_draft (created_by, created_at desc);

alter table response_draft enable row level security;

-- Readable exactly when the consideration it belongs to is readable. Written as
-- an EXISTS against rfi_consideration rather than restating read_repository:
-- one copy of the rule, so the two cannot drift apart.
create policy response_draft_read on response_draft for select to authenticated
  using (
    exists (
      select 1 from rfi_consideration c where c.id = consideration_id
    )
  );

create policy response_draft_insert on response_draft for insert to authenticated
  with check (created_by = (select auth.uid()));

grant select, insert on response_draft to authenticated;
