-- 0004_draft_application.sql
-- Feature 2 input: a draft application uploaded BEFORE submission, split into
-- sections, each scored for RFI risk (docs/04-AI-PIPELINE.md §3).

create table draft_application (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  trial_id        uuid references trial(id) on delete set null,
  submission_type submission_type not null,
  member_states   text[] not null default '{}',
  uploaded_by     uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

create table draft_section (
  id           uuid primary key default gen_random_uuid(),
  draft_id     uuid not null references draft_application(id) on delete cascade,
  section_part section_part not null,
  section      text not null,
  content      text not null,
  -- Deterministic checklist inputs for the rule engine, e.g.
  -- {"fee_proof": true, "icf_local_lang": false, "qp_declaration": null}
  artefacts    jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create table risk_assessment (
  id               uuid primary key default gen_random_uuid(),
  draft_section_id uuid not null references draft_section(id) on delete cascade,
  member_state     text,
  score            numeric(5,2) not null check (score >= 0 and score <= 100),
  band             text not null check (band in ('LOW','MEDIUM','HIGH')),
  rule_findings    jsonb not null default '[]',   -- deterministic checklist failures
  similarity_top   jsonb not null default '[]',   -- [{consideration_id, similarity, category}]
  base_rate        numeric(5,4),
  explanation      text,
  recommended_action text,
  created_at       timestamptz not null default now()
);

create index draft_section_draft on draft_section (draft_id);
create index risk_assessment_sec on risk_assessment (draft_section_id, created_at desc);
