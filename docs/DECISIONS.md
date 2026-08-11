# Architecture Decision Record

One entry per decision. Append only — supersede rather than edit. Keep entries short.

Format:
```
## ADR-NNN — Title
Date · Status: Accepted | Superseded by ADR-XXX
Context · Decision · Consequences · Alternatives rejected
```

---

## ADR-001 — Postgres with pgvector instead of a dedicated vector database
**2026-08-11 · Accepted**

**Context.** Every real query in this product is filtered: by application section, Member State, date, response status, and by the user's access rights. Retrieval is never purely semantic.

**Decision.** Store vectors in Postgres via pgvector with an HNSW index, alongside the structured fields and the full-text `tsvector`, in the same database as the rest of the application.

**Consequences.** Filtered hybrid search, Row Level Security, and rank fusion all execute in one SQL round trip. One system to operate, back up, and reason about. Scaling ceiling is lower than a purpose-built vector store, but far above this corpus size — and the migration path is well understood if it is ever reached.

**Rejected.** Pinecone / Weaviate / Qdrant — would require joining across systems and reimplementing authorisation outside the database, for no benefit at this scale. This trade-off is a prepared Q&A answer (`docs/06-DEMO-AND-DECK.md` §5).

---

## ADR-002 — Hybrid retrieval with Reciprocal Rank Fusion
**2026-08-11 · Accepted**

**Context.** The domain is dense with identifiers that embeddings handle badly (`CT-2024-519530-24-00-SM06-001`, POL numbers, `Annex 15`) and simultaneously requires matching paraphrases across languages and teams.

**Decision.** Run vector search and Postgres full-text search in parallel and fuse with RRF at `k = 60`.

**Consequences.** No score normalisation needed between incomparable scales. Both retrieval modes must be kept behind a flag so the ablation table in `docs/05-EVALUATION.md` can be produced — that table is the primary evidence for Technical Implementation.

**Rejected.** Weighted score blending (requires fragile normalisation); vector-only (fails on identifiers, provably so on our planted keyword-only pairs).

---

## ADR-003 — Two embeddings per consideration
**2026-08-11 · Accepted**

**Context.** Users search both in question-space ("what did Italy ask about fees?") and in answer-space ("which submissions attached proof of payment?").

**Decision.** Embed `consideration_text` and `sponsor_response_text` separately, with a `kind` discriminator; union both at fusion time.

**Consequences.** Roughly doubles embedding count and storage — negligible at this scale. Results must indicate which layer matched, which also improves explainability.

---

## ADR-004 — Deterministic rule engine leads the risk score
**2026-08-11 · Accepted**

**Context.** With a synthetic corpus and no real training data, a purely learned risk model would be neither trustworthy nor defensible.

**Decision.** Blend three signals — a deterministic rule engine (weight 0.5), similarity to historical RFI triggers (0.3), and a smoothed historical base rate (0.2). Fit the sigmoid parameters on a training split and report AUC on a held-out split.

**Consequences.** The feature works with zero historical data, every finding is explainable and testable, and the highest-weight signal is the one that cannot hallucinate. Rules require domain maintenance — mitigated by storing the taxonomy as data rather than code.

**Rejected.** Pure LLM judgement (unexplainable, unstable); pure classifier (no credible training data).

---

## ADR-005 — Refuse to draft below a similarity threshold
**2026-08-11 · Accepted**

**Context.** A regulatory audience will reject a tool that produces confident, unsupported answers. Invented regulatory content is worse than no content.

**Decision.** If the maximum similarity across retrieved precedents falls below τ ≈ 0.62, return a structured refusal with the nearest matches and an escalation route, rather than a draft.

**Consequences.** Some answerable RFIs will be refused; report that false-refusal rate honestly. Calibrate τ on the gold set rather than choosing it by feel. This behaviour is a scripted demo beat — it is the moment that distinguishes the submission.

---

## ADR-006 — Independent verifier pass on generated drafts
**2026-08-11 · Accepted**

**Context.** Grounding through prompting alone is not verifiable, and "trust the prompt" is not an argument that survives a pharma audience.

**Decision.** A second, stronger model (`gemini-2.5-pro`) scores each sentence of the draft for support by the cited precedents. Unsupported sentences are flagged in the UI; corpus-level groundedness is published.

**Consequences.** Adds latency and cost per draft — acceptable, and measured in `ai_calls`. Produces a headline metric and a visible trust affordance.

---

## ADR-007 — Append-only audit trail enforced by database trigger
**2026-08-11 · Accepted**

**Context.** Audit integrity implemented in application code is a policy; implemented in the database it is a guarantee. GxP-adjacent systems need the guarantee.

**Decision.** `audit_events` has `UPDATE` and `DELETE` triggers that raise. All state transitions emit events with actor, role, timestamp, and reason.

**Consequences.** Corrections are made by appending compensating events, never by editing. Demonstrable in ten seconds by attempting an update in the SQL console — do this live if a judge asks.

---

## ADR-008 — EU data residency by default
**2026-08-11 · Accepted**

**Context.** The customer is a Danish pharmaceutical company handling EU regulatory data.

**Decision.** Supabase project in `eu-central-1` (Frankfurt). Whatever application host is chosen under ADR-011 must be pinned to an EU region as an acceptance criterion.

**Consequences.** Marginal latency benefit from India-based development is irrelevant; the compliance signal is not. Note that the Gemini API endpoint's processing region is a separate question — check it and state the answer honestly rather than glossing over it (MEMORY.md Q8).

---

## ADR-009 — Synthetic corpus generated from hand-written skeletons
**2026-08-11 · Accepted**

**Context.** Fully LLM-generated corpora are uniformly bland and read as fake. The corpus is the demo.

**Decision.** Hand-write ~40 skeleton considerations grounded in the taxonomy and in the one supplied real example, then use the LLM to paraphrase and vary them into 900–1,200 considerations with specified distributions and planted evaluation structure. Fixed seed, committed output.

**Consequences.** Costs two days. Produces realistic text, reproducible metrics, and a demo with built-in narrative beats (the ISTAT spike, the recurrence cluster, the no-precedent RFI).

---

## ADR-010 — Next.js with Supabase, over a Python stack
**2026-08-11 · Accepted (hosting clause superseded by ADR-011)**

**Context.** One month, five students, a demo that must not break, and a hard requirement for a polished UI.

**Decision.** TypeScript end to end — Next.js 16 App Router, Supabase for Postgres, Auth, and Storage.

**Consequences.** One language across the team, no separate API service to deploy or keep alive, auth and RLS provided rather than built. Loses the Python ML ecosystem — irrelevant here, since the "model" is a blended score plus SQL, and heavy training was never in scope.

**Rejected.** FastAPI + React (two deploy targets, more integration risk); Streamlit (fast to build, but looks like a prototype, and Presentation Quality is 15%).

---

## ADR-011 — GitHub only; hosting decision deferred to Phase 3
**2026-08-11 · Accepted · Supersedes the hosting clause of ADR-010**

**Context.** Team decision to use GitHub and not adopt Vercel. A host is still needed eventually, because the demo is far stronger from a live URL than from `localhost`, and because the deliverable is described as a functional prototype.

**Decision.** GitHub for source control and CI now. **No hosting platform is adopted at this stage.** The application stays a plain Next.js app with no platform-specific runtime dependencies, so any Node host will accept it later. The choice is made at the start of Phase 3 (w/c 31 August).

**Consequences.**
- Nothing in the codebase may depend on a specific platform: no proprietary runtime APIs, no vendor queue or cron products, no host-specific config files. Background work goes in route handlers or `tsx` scripts.
- Day 3's "a URL exists" milestone becomes "the app runs cleanly from a fresh clone in under ninety seconds" — verified by a teammate on a different machine. The deploy-risk mitigation moves to Phase 3 and the demo video becomes correspondingly more important.
- Candidates when the decision is made: Render, Netlify, Cloudflare, Railway, a self-hosted `next start` container, or reconsidering Vercel. Selection criteria: EU region available (ADR-008), free tier sufficient, deploy from GitHub, Node 24, under thirty minutes to set up.
- **Risk if never decided:** the demo runs on `localhost` on the day. Acceptable only with a recorded video, but it weakens the Feasibility story. Tracked as MEMORY.md Q11.

**Rejected.** GitHub Pages — static only, cannot run Server Components, route handlers, or server-side Supabase calls.

---

## ADR-012 — AI SDK v7 with the Google provider directly
**2026-08-11 · Accepted**

**Context.** Planning assumed AI SDK v6 behind a gateway. Installed reality is `ai@7` with `@ai-sdk/google@4`, and with Vercel out of scope there is no gateway.

**Decision.** Call Gemini directly through `@ai-sdk/google` with `GOOGLE_GENERATIVE_AI_API_KEY`. All calls go through `lib/ai/client.ts`, which owns model selection, retries, and `ai_calls` telemetry.

**Consequences.** One fewer dependency and no gateway account needed. Losing gateway-level provider failover is handled in our own wrapper: a single choke point makes swapping provider or adding the local embedding fallback (docs/04-AI-PIPELINE.md §1) a one-file change. Verify v7 API shapes against the installed package rather than from memory — `generateObject`, `embedMany`, and provider options have moved between major versions.
