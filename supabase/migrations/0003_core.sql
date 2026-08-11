-- 0003_core.sql
-- Core repository: trials, RFI documents, considerations, and the embedding layer.
-- Three-layer storage model (docs/02-ARCHITECTURE.md §3):
--   original document -> Supabase Storage (source_file_path)
--   structured fields -> columns on rfi_consideration
--   meaning           -> rfi_embedding.embedding

create table trial (
  id               uuid primary key default gen_random_uuid(),
  eu_trial_number  text not null unique,              -- e.g. 2024-519530-24-00
  short_title      text not null,
  therapeutic_area text,
  phase            text,                              -- Phase I..IV
  sponsor          text not null default 'Sponsor A',
  member_states    text[] not null default '{}',
  created_at       timestamptz not null default now()
);

create table rfi_document (
  id               uuid primary key default gen_random_uuid(),
  trial_id         uuid not null references trial(id) on delete cascade,
  document_ref     text not null unique,              -- e.g. CT-2024-519530-24-00-SM06-001
  submission_type  submission_type not null,
  phase            rfi_phase not null,
  reporting_ms     text,                              -- ISO-2; RMS for Part I
  issued_at        timestamptz not null,
  due_at           timestamptz,
  responded_at     timestamptz,
  source_file_path text,                              -- Supabase Storage object key
  page_count       int,
  created_at       timestamptz not null default now()
);

create table rfi_consideration (
  id                    uuid primary key default gen_random_uuid(),
  document_id           uuid not null references rfi_document(id) on delete cascade,
  trial_id              uuid not null references trial(id) on delete cascade,
  consideration_number  int  not null,
  section_part          section_part not null,
  section               text not null,               -- Regulatory, Protocol, IMPD_QUALITY, ICF...
  document_name         text,
  member_state          text,                        -- ISO-2, parsed from the "IT - " prefix
  category              text not null,               -- taxonomy: docs/01-DOMAIN.md §5
  consideration_text    text not null,
  sponsor_response_text text,
  response_status       response_status not null default 'DRAFT',
  outcome               rfi_outcome not null default 'UNKNOWN',
  owner_team            team_role,
  source_page           int,
  is_seed               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (document_id, consideration_number)
);

-- Two embeddings per consideration: question-space and answer-space (ADR-003).
create table rfi_embedding (
  id               uuid primary key default gen_random_uuid(),
  consideration_id uuid not null references rfi_consideration(id) on delete cascade,
  kind             text not null check (kind in ('CONSIDERATION','RESPONSE')),
  content          text not null,
  embedding        vector(768) not null,
  fts              tsvector generated always as (to_tsvector('english', content)) stored,
  unique (consideration_id, kind)
);

create index rfi_embedding_hnsw on rfi_embedding
  using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);
create index rfi_embedding_fts  on rfi_embedding using gin (fts);

create index rfi_cons_section  on rfi_consideration (section_part, section);
create index rfi_cons_ms       on rfi_consideration (member_state);
create index rfi_cons_category on rfi_consideration (category);
create index rfi_cons_trgm     on rfi_consideration using gin (consideration_text gin_trgm_ops);
create index rfi_doc_issued    on rfi_document (issued_at desc);

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger rfi_consideration_touch before update on rfi_consideration
  for each row execute function touch_updated_at();
