-- 0028_drop_embeddings.sql
--
-- Removes the vector half of retrieval (ADR-039).
--
-- Nothing reads any of this any more. `search_considerations` serves the search
-- page, `lexical_precedents` (0027) serves the confidence gate, and
-- `mined_rules` / `rule_precedents` serve the Clinical Report Check — all four
-- over `rfi_consideration` directly.
--
-- Dropped here:
--   * rfi_embedding (0003), with its HNSW index and RLS policy.
--   * hybrid_search (0008, 0011, 0018, 0021, 0026) — the RRF fusion.
--   * vector_search (0008) — the ablation's vector-only row.
--
-- The pgvector extension is deliberately left installed. It costs nothing
-- while unused, and dropping it would make restoring the vector arm a
-- migration against the extension rather than against our own schema.
--
-- WHAT THIS COSTS, measured before the removal and kept in docs/05:
--
--   Recall@5   hybrid 0.795 -> keyword 0.634
--   identifier 0.944 -> 1.000   (keyword is better here; the vector arm only
--                                ever diluted an exact reference match)
--   semantic   0.680 -> 0.000   (this is the whole loss, and it is total)
--
-- A paraphrased request that shares no vocabulary with the precedent that
-- answers it is now unfindable, and the confidence gate will refuse it. That is
-- a real regression against a real class of query, and it is written here so
-- that reinstating the vector arm is a decision someone can cost rather than
-- rediscover.

drop function if exists hybrid_search(
  text, vector(768), int, text, text, section_part, text, timestamptz, boolean,
  text, text, text, int
);

drop function if exists vector_search(vector(768), int);

drop table if exists rfi_embedding cascade;
