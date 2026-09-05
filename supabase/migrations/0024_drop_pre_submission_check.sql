-- 0024_drop_pre_submission_check.sql
--
-- Removes the pre-submission check (formerly "Feature 2") in full.
--
-- The screen, its rule engine and its scoring model are gone from the
-- application, so the tables that only it wrote to and the functions that only
-- it called are dead weight. Dropping them keeps `supabase db reset` honest
-- about what the product actually is.
--
-- Dropped here, and nothing else depends on them:
--   * draft_application / draft_section / risk_assessment (0004), with the RLS
--     policies (0007, 0012), indexes (0004, 0012) and grants (0015) that hang
--     off them. `drop table ... cascade` takes those with it.
--   * section_rfi_rates and section_similarity (0017). Both were called only
--     from lib/risk. Hybrid search uses hybrid_search (0008, 0016); drafting
--     uses its own precedent retrieval. Neither touches these.
--
-- audit_events rows that reference entity_type = 'draft_application' are left
-- exactly as they are. The trail is append-only (0009) and records what
-- happened, not what the schema currently holds.

-- pgvector lives in `extensions` since 0010, so the `vector` type in
-- section_similarity's signature only resolves with that schema on the path.
set search_path = public, extensions;

drop function if exists section_rfi_rates(submission_type, text[]);
drop function if exists section_similarity(vector(768), text, text[], int);

drop table if exists risk_assessment cascade;
drop table if exists draft_section cascade;
drop table if exists draft_application cascade;
