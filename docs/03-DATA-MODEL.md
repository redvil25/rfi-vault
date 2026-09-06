# 03 — Data Model and Synthetic Corpus

## 1. Schema

Written as forward-only migrations in `/supabase/migrations`. This is the reference; keep it in sync when migrations change.

### 0001_extensions.sql

```sql
create extension if not exists vector;
create extension if not exists pg_trgm;
```

### 0002_enums.sql

```sql
create type submission_type as enum ('INITIAL','SUBSTANTIAL_MODIFICATION','ADDITIONAL_MS');
create type rfi_phase       as enum ('VALIDATION','ASSESSMENT_PART_I','ASSESSMENT_PART_II');
create type section_part    as enum ('PART_I','PART_II');
create type response_status as enum ('DRAFT','IN_REVIEW','APPROVED','SUBMITTED');
create type rfi_outcome     as enum ('ACCEPTED','FOLLOW_UP_RFI','UNKNOWN');
create type team_role       as enum ('RA_CLINICAL','AFFILIATE','CTA_MANAGEMENT','EU_SUBMISSION_HUB','ADMIN');
```

### 0003_core.sql

```sql
create table trial (
  id              uuid primary key default gen_random_uuid(),
  eu_trial_number text not null unique,            -- 2024-519530-24-00, the EU CT number
  protocol_code   text,                            -- NN1234-4567, the sponsor's own study id (0021)
  short_title     text not null,
  therapeutic_area text,
  imp_name        text,                            -- NN-1234, investigational medicinal product (0018)
  phase           text,                            -- Phase I..IV
  sponsor         text not null default 'Sponsor A',
  member_states   text[] not null default '{}',
  created_at      timestamptz not null default now()
);

create table rfi_document (
  id               uuid primary key default gen_random_uuid(),
  trial_id         uuid not null references trial(id) on delete cascade,
  document_ref     text not null unique,           -- CT-2024-519530-24-00-SM06-001
  submission_type  submission_type not null,
  phase            rfi_phase not null,
  reporting_ms     text,                           -- ISO-2, RMS for Part I
  issued_at        timestamptz not null,
  due_at           timestamptz,
  responded_at     timestamptz,
  source_file_path text,                           -- Supabase Storage key
  page_count       int,
  created_at       timestamptz not null default now()
);

create table rfi_consideration (
  id                    uuid primary key default gen_random_uuid(),
  document_id           uuid not null references rfi_document(id) on delete cascade,
  trial_id              uuid not null references trial(id) on delete cascade,
  consideration_number  int  not null,
  section_part          section_part not null,
  section               text not null,             -- Regulatory, Protocol, IMPD_QUALITY, ICF...
  document_name         text,
  member_state          text,                      -- ISO-2, parsed from the "IT - " prefix
  category              text not null,             -- taxonomy from docs/01-DOMAIN.md §5
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

create index rfi_cons_section   on rfi_consideration (section_part, section);
create index rfi_cons_ms        on rfi_consideration (member_state);
create index rfi_cons_category  on rfi_consideration (category);
create index rfi_cons_trgm      on rfi_consideration using gin (consideration_text gin_trgm_ops);
```

0003 also created `rfi_embedding` — two `vector(768)` rows per consideration,
question-space and answer-space, behind an HNSW index. **`0028` dropped that
table** along with `hybrid_search` and `vector_search` (ADR-039). Retrieval is
lexical now, and `rfi_cons_trgm` in the list above — which has been there since
0003 for a different purpose — is what the confidence gate scores on.

`pgvector` stays installed. It costs nothing unused, and restoring the vector
arm should be a migration against our own schema rather than against the
extension.

### 0029_team_filter.sql — the owning team as a filter

No new columns. `owner_team` has been on `rfi_consideration` since 0003 and is
written from `category.owner` in the taxonomy by both the seed and the ingestion
classifier, so the column already *is* the team-per-category mapping. `0029`
adds `f_owner_team` to `search_considerations` and `search_facets`, an
`owner_team` facet, and an index to keep a team-only browse off a sequential
scan.

Filtering the column beats expanding a team into its category list: one
predicate, and it cannot drift from the ownership the row was filed under
(ADR-024). It is also the column the RLS policies key work-in-progress
visibility on, so "this team's considerations" is a notion the database already
has rather than a second one invented for search.

### 0025_precheck_mining.sql — the pre-submission check

No new tables. The check reads the corpus that already exists and writes nothing but an
audit event, because a run is an observation about a dossier we do not store, not a
record in its own right.

```sql
-- Recurrence by (Member State x section x submission type), with the dates that
-- make a rule explainable and the staleness that stops a dead one firing.
mined_rules(f_member_states text[], f_submission_type submission_type, f_sections text[])
  -> category, section, section_part, member_state,
     hits, distinct_trials, resolved_hits, first_seen, last_seen

-- The verbatim evidence behind one mined rule: what was asked, when, against which
-- trial, and the sponsor response that closed it. APPROVED/SUBMITTED + ACCEPTED only.
rule_precedents(f_category text, f_section text, f_member_states text[],
                f_submission_type submission_type, match_count int)
  -> consideration_id, consideration_text, sponsor_response_text, member_state,
     section, issued_at, document_ref, eu_trial_number, protocol_code, ...
```

Both are SECURITY INVOKER, so a user mines rules only out of the precedent their own RLS
policies let them read. Two teams can legitimately get different counts.

The pasted dossier text is never persisted. The audit event records the shape of the run
— submission type, Member States, sections, flag counts, rules skipped — and not the
sponsor's words, which have no business in an append-only table the whole team can read.

### 0005_workflow_audit.sql

```sql
create table user_profile (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text not null,
  team         team_role not null,
  member_state text
);

create table audit_events (
  id            bigserial primary key,
  occurred_at   timestamptz not null default now(),
  actor_id      uuid references auth.users(id),
  actor_team    team_role,
  entity_type   text not null,      -- 'rfi_document' | 'rfi_consideration' | ...
  entity_id     uuid not null,
  action        text not null,      -- INGESTED | DRAFTED | SUBMITTED_FOR_REVIEW | APPROVED | ...
  from_status   text,
  to_status     text,
  reason        text,
  metadata      jsonb not null default '{}'
);

create index audit_entity on audit_events (entity_type, entity_id, occurred_at desc);

-- Append-only: enforced by the database, not by application code.
create or replace function block_audit_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_events is append-only';
end $$;

create trigger audit_no_update before update on audit_events
  for each row execute function block_audit_mutation();
create trigger audit_no_delete before delete on audit_events
  for each row execute function block_audit_mutation();
```

### 0006_ai_calls.sql — cost and latency telemetry

```sql
create table ai_calls (
  id            bigserial primary key,
  occurred_at   timestamptz not null default now(),
  purpose       text not null,        -- EMBED | EXTRACT | DRAFT | VERIFY | RERANK
  model         text not null,
  input_tokens  int,
  output_tokens int,
  latency_ms    int,
  cost_usd      numeric(10,6),
  success       boolean not null default true,
  error         text
);
```

### 0007_rls.sql

```sql
alter table rfi_consideration enable row level security;
alter table audit_events      enable row level security;

-- Approved and submitted knowledge is shared organisation-wide: that is the product.
create policy read_shared_knowledge on rfi_consideration for select
  using (response_status in ('APPROVED','SUBMITTED'));

-- Work in progress stays with the owning team.
create policy read_own_team_wip on rfi_consideration for select
  using (
    response_status in ('DRAFT','IN_REVIEW')
    and owner_team = (select team from user_profile where id = auth.uid())
  );

create policy write_own_team on rfi_consideration for update
  using (owner_team = (select team from user_profile where id = auth.uid()));

create policy audit_read_own_team on audit_events for select
  using (
    actor_team = (select team from user_profile where id = auth.uid())
    or (select team from user_profile where id = auth.uid()) in ('ADMIN','CTA_MANAGEMENT')
  );
```

**Test these policies.** A Playwright test that signs in as an Affiliate and confirms an RA Clinical draft is invisible is a thirty-second demo moment worth real Technical Implementation points.

### 0016 → 0029 `search_considerations` — the search function

```sql
search_considerations(
  q text, f_part section_part, f_section text, f_member_state text,
  f_category text, f_phase rfi_phase, f_submission_type submission_type,
  f_status response_status, f_from timestamptz, f_to timestamptz,
  f_therapeutic_area text, f_imp_name text, f_protocol_code text,
  f_owner_team team_role, sort text, lim int, off int
) -> ( ...every column the result card renders..., rank real, matched_on text,
       total_count bigint )
```

Two branches, fused in one round trip with the filters, the sort, the page and
RLS:

- **full text** — `websearch_to_tsquery` against the stored `fts` column, ranked
  by `ts_rank_cd`;
- **identifiers** — `document_ref` and `eu_trial_number` matched with ILIKE,
  scored `10 + text_rank` so an exact reference always outranks a text hit.

`matched_on` comes back with every row — `identifier`, `text`,
`identifier + text`, or `browse` — because a result the user cannot explain is a
result they cannot trust.

### 0027_lexical_precedents.sql — the function the confidence gate refuses on

```sql
lexical_precedents(
  query_text text, f_section text, f_part section_part,
  f_approved_only boolean, match_count int
) -> ( consideration_id uuid, lexical_score numeric, matched_on text )
```

Features 3 and 6 do not call the search function. They call this one, which
filters to APPROVED/SUBMITTED with outcome ACCEPTED — a rejected answer is not
precedent — and returns a **true 0..1** score: `similarity()` from pg_trgm over
shared wording, backed by the `rfi_cons_trgm` GIN index, with an exact document
reference scoring 1.

**The column is `lexical_score`, never `similarity`.** It measures shared
wording, not shared meaning, and a reader who confuses the two will set
`DRAFT_LEXICAL_THRESHOLD` wrong. On this corpus answerable requests score
0.36–1.00 and requests with no precedent score 0.00; the threshold is 0.25,
sitting in that gap.

### What used to be here

This section described `hybrid_search`: Reciprocal Rank Fusion at `k = 60` over
cosine distance and `ts_rank_cd`, with an identifier arm added in `0026` after
the ablation table found it missing (ADR-036). `0028` dropped the function
(ADR-039).

RRF was the right tool while there were two incomparable scales to fuse. With
one lexical scale there is nothing to fuse, and the cost of that simplification
is on the table in `docs/05-EVALUATION.md` §2 rather than left out of it:
Recall@5 0.795 → 0.634, paraphrase 0.680 → 0.000, identifiers 0.944 → 1.000.

## 2. Synthetic corpus design

The corpus is the demo. A weak corpus makes every feature look weak, no matter how good the code is. Budget real time for this — it is not a chore, it is a deliverable.

**Target size:** 120–150 trials, 350–450 RFI documents, **900–1,200 considerations**. Large enough that search is non-trivial, small enough to generate, embed, and eyeball within budget.

### 2.1 Distributions to reproduce

| Dimension | Shape |
|---|---|
| Phase | ~65% VALIDATION, ~20% ASSESSMENT_PART_I, ~15% ASSESSMENT_PART_II |
| Submission type | ~55% INITIAL, ~40% SUBSTANTIAL_MODIFICATION, ~5% ADDITIONAL_MS |
| Category | Pareto — top 6 categories carry ~65% of volume, led by `FEE_PAYMENT_PROOF`, `DOC_VERSION_MISMATCH`, `DOC_TRANSLATION_MISSING`, `ICF_CONTENT`, `INSURANCE_COVER`, `INVESTIGATOR_SUITABILITY` |
| Member State | 12–15 states; IT, ES, DE, FR, PL over-represented, matching where national requirements bite |
| Dates | Spread across 2023-01 → 2026-08, with a visible spike after the Italian ISTAT fee change of Feb 2025 |
| Outcome | ~80% ACCEPTED, ~12% FOLLOW_UP_RFI, ~8% UNKNOWN |
| Response length | Mostly 1–3 sentences; a minority long and technical (IMPD, protocol) |

**The ISTAT spike is deliberate.** It gives the analytics dashboard a real story to tell: "this national fee change generated N RFIs across M trials in eight weeks; the repository would have caught the second one." A time-series with a story beats a time-series with noise.

### 2.2 Planted structure — build the demo into the data

Generate these on purpose, and record the ground truth in `scripts/seed/ground-truth.json`:

1. **Near-duplicate clusters.** 6–10 groups of 5–15 considerations that are the same underlying issue in different words, trials, and Member States. This is what makes the "we solved this eleven times already" moment land.
2. **Semantic-only pairs.** ~50 query/document pairs that share meaning but almost no vocabulary ("payment evidence for the updated national tariff" ↔ "proof of payment of the additional ISTAT amount"). These prove vector search earns its place.
3. **Keyword-only pairs.** ~50 pairs where the discriminating token is an identifier or code (`CT-2024-519530-24-00-SM06-001`, a POL number, `Annex 15`). These prove keyword search earns its place — embeddings reliably fail here.
4. **A no-precedent RFI.** At least one genuinely novel RFI with no close match, used to demo the refusal path in Feature 3.
5. **A gold retrieval set.** 50 queries with human-marked relevant considerations, used for Recall@5, MRR@10, nDCG@10.

### 2.3 Generation method

```
scripts/seed/
  taxonomy.ts        categories, sections, member states, national quirks
  templates.ts       ~40 hand-written skeleton considerations per Tier
  generate.ts        Gemini expands templates into varied, realistic text
  ground-truth.json  planted clusters, gold queries
  run.ts             deterministic driver (seed = 42) → writes JSON + inserts
```

Rules:
- **Hand-write the skeletons.** Pure LLM generation produces uniformly bland text and gives away the game. Human-authored skeletons plus LLM paraphrasing yields realistic variation.
- **Anchor on the one real example.** The supplied ISTAT RFI is the style reference for tone, length, and structure.
- **Deterministic.** Fixed seed, ordered iteration, committed output JSON. `npm run seed` reproduces the exact corpus on any machine. Say this on stage.
- **Label the data as synthetic in the UI.** A small "Synthetic demo corpus" badge. Honesty here reads as professionalism, and it pre-empts the obvious question.
- **Cost control.** ~1,000 generations on `gemini-2.5-flash` is cheap, but cache aggressively and commit the generated JSON so re-seeding does not re-call the API.
