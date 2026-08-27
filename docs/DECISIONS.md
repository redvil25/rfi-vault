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

## ADR-015 — Local OCR with Tesseract, not a vision model
**2026-08-16 · Accepted**

**Context.** The first real export the team was handed is a scan: two JPEG page images inside a PDF wrapper, with zero extractable characters. Refusing scans would refuse a large share of genuine inputs, and teams also circulate plain screenshots of CTIS.

**Decision.** OCR locally with Tesseract (`tesseract.js`), rendering PDF pages via `@napi-rs/canvas`. Accept PDF, PNG, JPEG and WebP uploads, with the format decided by magic bytes rather than by filename or content type. Language data is vendored at `vendor/tessdata/eng.traineddata`. A text layer, when present, is always preferred — OCR is the fallback, never the default.

**Consequences.**
- Ingestion keeps working with AI disabled, which is the whole point of the deterministic path.
- Deterministic: the same scan yields the same text every time, which matters for an audit trail in a way that a sampled model output does not.
- Tesseract cannot invent text that was not on the page. A language model can, and would be doing so at the one point in the pipeline where we have no way to check it.
- Measured 0.92 mean confidence on the sample, ~2.4 s for two pages. Extractions below 0.55 are refused rather than filed badly.
- English only. Non-English scans and handwriting are out of scope and are refused on the confidence threshold.
- OCR provenance and confidence are shown on the review screen and recorded in the audit event, so a reader can tell recognised text from exact text.
- Native and WASM dependencies must be listed in `serverExternalPackages`, and the vendored language data in `outputFileTracingIncludes`, or the build fails and OCR breaks only in production.

**Rejected.** Gemini vision — better on messy input, but needs an API key we deliberately do not depend on, is non-deterministic, and can hallucinate text into a regulatory record. It remains the upgrade path behind the same interface.

---

## ADR-014 — Vercel as the host, pinned to `fra1`
**2026-08-16 · Accepted · Supersedes ADR-011**

**Context.** ADR-011 deferred the hosting choice to Phase 3 and kept the app deliberately host-agnostic. That deadline arrived and the team chose Vercel.

**Decision.** Deploy to Vercel from the private GitHub repository `redvil25/rfi-vault`, with functions pinned to `fra1` (Frankfurt) in `vercel.json`.

**Consequences.**
- EU data residency now holds end to end: Supabase in `eu-central-1`, functions in `fra1`. This is a line in the pitch, not a detail — the audience is a Danish pharma company.
- `vercel.json` is the first host-specific file in the repo. It is deliberately minimal: region and framework only. The host-portability rule in `CLAUDE.md` §3 still applies to application code, so moving hosts remains a matter of deleting one file.
- Vercel caps Serverless Function request bodies at 4.5 MB. This drove the direct-to-Storage upload path, which was the right design regardless of host and would otherwise have surfaced as a demo-day failure.
- The in-memory rate limiter is per instance, and Vercel runs several. Documented as prototype-grade in `docs/08-SECURITY.md`; a shared window is the production fix.
- Environment variables must be configured in the Vercel project. `NEXT_PUBLIC_*` values are inlined at build time, so a build without them produces a broken client bundle rather than a clear error.

---

## ADR-013 — Ingestion writes with elevated privileges behind an application role gate
**2026-08-13 · Accepted**

**Context.** Filing an RFI document creates consideration rows owned by *other* teams — a fee RFI belongs to the Affiliate even when the EU Submission Hub uploads the document. The `insert_own_team` policy from 0012 correctly forbids exactly that, and `trial` / `rfi_document` have no INSERT policies at all. Ingestion is not a user editing their own record; it is a system function filing on behalf of the organisation.

**Decision.** `commitIngestion()` writes through the service client. Authorisation is enforced in application code before any write: only `EU_SUBMISSION_HUB`, `CTA_MANAGEMENT` and `ADMIN` may file. Every commit emits an `INGESTED` audit event naming the actor, their team, the parser confidence, and how many fields the reviewer corrected.

**Consequences.**
- This is the one place in the codebase where authorisation is not enforced by the database. It is a single function, role-gated on entry, and covered by five checks in `npm run verify:ingest`.
- The parse is redone from the stored file at commit time rather than trusting the client payload. Only explicit per-consideration overrides are accepted, matched by consideration number — so a tampered request can change a category, which the audit trail records, but cannot inject consideration text that was never in the document.
- There is no transaction across PostgREST calls, so failures roll back by hand. A failed audit write deletes the document rather than leaving it unaccounted for: an unaudited record is worse than no record.
- Reads remain entirely RLS-governed. Verified: an Affiliate finds 4 of the 5 filed considerations, because the fifth is an open draft owned by RA Clinical.

**Rejected.** Adding INSERT policies permitting any authenticated user to write arbitrary `owner_team` values — that is strictly weaker, since it grants the same power to every role including Affiliates, and it moves the role check into policy logic that is harder to test.

---

## ADR-012 — AI SDK v7 with the Google provider directly
**2026-08-11 · Accepted**

**Context.** Planning assumed AI SDK v6 behind a gateway. Installed reality is `ai@7` with `@ai-sdk/google@4`, and with Vercel out of scope there is no gateway.

**Decision.** Call Gemini directly through `@ai-sdk/google` with `GOOGLE_GENERATIVE_AI_API_KEY`. All calls go through `lib/ai/client.ts`, which owns model selection, retries, and `ai_calls` telemetry.

**Consequences.** One fewer dependency and no gateway account needed. Losing gateway-level provider failover is handled in our own wrapper: a single choke point makes swapping provider or adding the local embedding fallback (docs/04-AI-PIPELINE.md §1) a one-file change. Verify v7 API shapes against the installed package rather than from memory — `generateObject`, `embedMany`, and provider options have moved between major versions.

---

## ADR-016 — Migrations are the only source of truth, enforced in CI
**2026-08-26 · Accepted**

**Context.** `search_considerations` and `search_facets`, the `rfi_consideration.fts` column and two of its indexes existed only in the linked project. The migration `0013_manual_search` was applied through the API and never committed, so `supabase db reset` produced a database the application could not query, and `lib/db/types.ts` — generated from the live project — encoded functions no migration created. The chain was circular.

**Decision.** `0013_manual_search.sql` is recovered verbatim from the live definitions. CI gains a `database` job that replays every migration into an empty Postgres and asserts that the objects the application calls exist, plus that row level security is on for every public table. No secrets required.

**Consequences.** A fresh clone is provably runnable. Applying SQL through the dashboard or MCP without committing the migration now fails the build rather than silently diverging. The RLS assertion also guards the 0012-class regression, where policies were briefly readable by `anon`.

---

## ADR-017 — Build-output tracing is scoped per route and asserted
**2026-08-26 · Accepted**

**Context.** `outputFileTracingIncludes` used the glob `/**`, copying the 5 MB Tesseract language file into every function. Measured on the deployment: `/sign-in` — a page that queries nothing — carried 7.4 MB and returned its first byte in 2.12 s cold against 0.30 s warm.

**Decision.** Scope the include to `/(app)/ingest/**`, the only path that runs OCR. Move `canIngest` into `lib/ingest/roles.ts` so the ingest *page* no longer imports the OCR stack through `commit.ts`. Add `npm run verify:trace`, run in CI after the build, asserting the language data reaches the ingest route and no other.

**Consequences.** Measured: `/sign-in` 7.4 → 2.4 MB, `/search` 7.5 → 2.5 MB, `/` 6.8 → 1.8 MB. Both failure modes — missing in production, or present everywhere — are invisible locally, which is exactly why the check is mechanical rather than a review item.

---

## ADR-018 — Structured logs, and errors that do not replace the page
**2026-08-26 · Accepted**

**Context.** Production carried three recurring errors, found in the host's error log rather than reported by a user: `JWT issued at future` on `/search`, and a 409 `Too many concurrent token refresh requests` in the proxy. A page navigation fires the document, the RSC payload and prefetches at once; each called `auth.getUser()`, all raced to redeem one refresh token, and the losers threw. With no error boundary anywhere, a throw in a Server Component replaced the whole page with Next's crash screen.

**Decision.** `lib/log.ts` emits one JSON object per event, reducing errors to name, message and a trimmed stack rather than spreading them — a Supabase error carries connection details on non-standard properties. `getCurrentUser` is wrapped in React `cache()` so the layout and page share one call. The proxy short-circuits when no session cookie is present and treats a failed refresh as "signed out". `error.tsx`, `global-error.tsx` and `not-found.tsx` exist, and `search/loading.tsx` streams the shell.

**Consequences.** Roughly half the auth round trips per navigation disappear, the concurrent-refresh race is far less likely to be reached, and the remaining failures degrade to a recoverable screen showing the digest that ties it to the log line.

---

## ADR-019 — The rate-limit window lives in Postgres
**2026-08-26 · Accepted · Closes the caveat in ADR-014**

**Decision.** `consume_rate_limit(bucket, limit, window)` in `0014`, `SECURITY DEFINER` over a table with no policies, so a caller may spend a token but never inspect or forge another user's window. `lib/rate-limit.ts` calls it and falls back to the per-process limiter — warning once — if the function is absent.

**Consequences.** The limit is now shared across instances instead of being `limit x instances`. No new infrastructure: Redis would have been a second datastore for a problem Postgres already solves, and there is no measured hot path to justify a cache.

**Rejected.** Redis — see above. Revisit only with a measurement that names it.

---

## ADR-020 — The gold set is derived from the generator, and says so
**2026-08-26 · Accepted**

**Context.** `npm run eval` pointed at a file that did not exist while the docs quoted metrics. Writing 50 human-marked queries was the specified answer and the team has not had the hour.

**Decision.** `scripts/eval/gold.ts` derives relevance from the corpus generator's own ground truth: identifier queries where the relevant set is every consideration under that document reference, and authored natural-language probes where the relevant set is category membership. Two rules are enforced in the file — never use a category id or label as a query, since the category is weighted into the `fts` document and the result would be circular; and never phrase a probe across a category boundary, since relevance is exact membership. `keyword_search` was also fixed in `0014` to read `rfi_consideration`, not `rfi_embedding`, so the keyword baseline does not silently score zero when the vector table is empty.

**Consequences.** Real, reproducible numbers today. First run, 941 considerations, 41 queries, keyword only: **Recall@5 1.000 on identifier queries, 0.000 on the ten paraphrased queries, 0.167 mixed.** That zero is the measured argument for hybrid retrieval on our own corpus, and it is worth more on a slide than a favourable average.

**Limits, to be stated wherever the numbers are quoted.** Relevance is structural, so a genuinely relevant record outside the structure counts as a miss and absolute scores are pessimistic. The overall average across query types is not meaningful — report the per-type breakdown. Human-marked queries remain the better artefact and the harness reads whichever is present.

---

## ADR-021 — Ingestion reads text-layer PDFs only; OCR removed
**2026-08-27 · Accepted · Supersedes ADR-015**

**Context.** ADR-015 added local OCR so scans and screenshots could be filed, and it worked — 0.92 mean confidence, ~2.4 s for two pages, with four parser fixes for the ways Tesseract predictably errs. It was also, by a wide margin, the most expensive thing in the deployment. Measured from the build traces: `/ingest` carried **36.3 MB** against 1.8–2.8 MB for every other route, all of it `tesseract.js` WASM, the `@napi-rs/canvas` native binary, and 5 MB of vendored language data. It bought a code path that runs once per upload, behind a human review screen, where a few seconds is not a felt delay.

**Decision.** `extractDocument()` reads the text layer of a PDF and nothing else. Images and text-layer-less PDFs are refused with an explanation naming the fix — export from CTIS rather than scanning a printout — and nothing is written. `tesseract.js`, `@napi-rs/canvas`, `vendor/tessdata`, `lib/ingest/ocr.ts`, `npm run verify:ocr` and `npm run verify:trace` are gone, along with `outputFileTracingIncludes` and two thirds of `serverExternalPackages`, all of which existed solely to carry OCR.

**Consequences.**
- Measured: `/ingest` **36.3 MB → 4.6 MB**, an 87% cut, and the last route with an unusual cold start is now ordinary. Fifteen npm packages removed.
- `npm run verify:trace` is deleted rather than kept: it policed an asset that no longer exists, and a guard for a removed problem is noise.
- The interface is the seam. `extractDocument()` keeps its signature, so OCR or a vision model returns as one module with no caller changes. The scanned fixture stays in `fixtures/` and is now asserted on for the *refusal* path, in both a unit test and a browser test.
- **The real cost, stated plainly:** the one genuine export the team was handed is a scan, so the application can no longer read the only real sample document it has. Everything demoed uses `fixtures/rfi-example-ctis.pdf` and the synthetic corpus. If a judge hands over a scan on the day, the honest answer is that it is a named non-goal and the upgrade path is one module — which is also what `README.md`, `docs/06` and `docs/07` already claimed before ADR-015 briefly widened the scope.

**Rejected.** A separate Python or Node OCR service — native Tesseract would be faster than WASM and would move the weight out of the function, but it adds a deploy target and a second runtime to a project with two weeks left, for a path that is not latency-sensitive. Revisit after the hackathon, with a measurement.

---

## ADR-022 — Table privileges live in a migration
**2026-08-27 · Accepted**

**Context.** Found by building a database from `supabase/migrations/` alone and running the seed against it: every write failed with `permission denied for table trial`, and `has_table_privilege('authenticated','rfi_consideration','SELECT')` returned false. The application roles held `Dxtm` — TRUNCATE, REFERENCES, TRIGGER, MAINTAIN — and none of SELECT, INSERT, UPDATE or DELETE. The linked project works only because its objects were created by `supabase_admin` through the dashboard, whose default privileges include the data verbs. Nothing in the repository reproduced that.

**Decision.** `0015_grants.sql` grants explicitly: `authenticated` reads everything and writes only where a policy governs it; `service_role` gets everything, since it bypasses RLS by design; `anon` is revoked entirely, matching the intent of 0012. `alter default privileges` covers tables added later.

**Consequences.** `supabase db reset && npm run seed` now produces a working system — verified: 130 trials, 348 documents, 940 considerations. A GRANT is not the access-control decision here, RLS still is; a missing GRANT simply meant the policies were never consulted. Note that CI's existing checks would *not* have caught this — object existence and RLS were both fine. A privilege assertion belongs alongside them.

---

## ADR-023 — search_considerations made sargable
**2026-08-27 · Accepted**

**Context.** `rfi_cons_fts` had never been used — `idx_scan = 0` after a full seed and repeated searches, corroborated by Supabase's advisor. The 0013 body computed match flags over a `cross join`, then filtered on `term is null or id_hit or text_hit`. The tsquery was not evaluable before the scan, so it could never be an index condition, and an OR across three CTE-derived expressions has no sargable form.

**Decision.** `0016_sargable_search.sql`. The tsquery becomes a scalar subquery, so it is an InitPlan evaluated once per statement — the same trick 0012 used to stop `auth.uid()` re-evaluating per row. The OR becomes a UNION of branches, each able to pick its own index. Trigram indexes added for identifier matching.

**Consequences, measured rather than asserted.**
- Output is identical. Ten cases covering browse, identifier, text, filters, both sort orders, pagination and a no-match query: 564 rows each side, zero rows in one and not the other, and zero positional order mismatches.
- At the demo corpus of 940 rows: 19.5 ms → 10.1 ms, and the planner still picks a sequential scan — correctly, because at that size it is cheaper. Sargability was confirmed separately by disabling `enable_seqscan`, which moved `rfi_cons_fts` from 0 scans to 1.
- At 38,540 rows, where it matters: 361 → 142 ms, 208 → 143 ms, 334 → 101 ms, with the planner now choosing the GIN index unprompted.
- The trigram indexes are not yet used: `rfi_document` holds 348 rows and a sequential scan beats an index on it. They earn their place as the document table grows; keeping them is cheap and removing them would need re-adding.

**Honest scope.** This changes nothing a judge will see at 940 rows. It was worth doing because the index had never once been used, which made "hybrid search in Postgres" a claim with no supporting behaviour behind it.

---

## ADR-024 — The risk rule engine is generated from the taxonomy
**2026-08-27 · Accepted · Implements ADR-004**

**Context.** ADR-004 fixed the three-signal design and gave the deterministic rule engine the leading weight. The open question was where twenty to thirty rules come from without fabricating regulatory facts, which CLAUDE.md §8 forbids. `lib/domain/taxonomy.ts` already held the answer: 29 categories, 21 of which name an `artefactKey`, and 15 Member States each carrying `languages` and hand-written `quirks`. That is the team's own domain contribution, destined for mentor review.

**Decision.** `lib/risk/rules.ts` *generates* rules from that data rather than restating it beside it. One rule per category with an artefact key; one local-language rule per Member State, from its declared `languages`; a small set of quirk rules quoting the team's `quirks` strings verbatim; and one content rule that reads version numbers out of the text. Severity is the category's own frequency weight normalised to 0–1, not a number chosen by hand. Adding a category adds a rule.

**Consequences.**
- 41 rules — 21 artefact, 15 local-language, 4 national quirk, 1 content — with no second copy of the domain knowledge to drift, and nothing in the file asserting an article number, deadline or fee amount.
- `artefactPromptsFor()` drives the assessment form from `applicableRules()`, the same function the engine evaluates — so the form cannot ask for an artefact the engine ignores, or omit one it will mark unchecked.
- Rule quality is now bounded by taxonomy quality, which is the right place for the mentor's review to land.

---

## ADR-025 — Unknown is not a finding, and a missing signal is not a zero
**2026-08-27 · Accepted**

**Context.** Two ways this feature could quietly lie, both of which look like working software.

**Decision.** Artefacts are tri-state. `true` passes, `false` is a finding, and anything else — absent, null, non-boolean — is UNKNOWN, which counts against *coverage* and never against the score. Separately, `blend()` renormalises across the signals that actually ran instead of scoring an unavailable one as zero.

**Consequences.**
- An application nobody filled in reports as low-confidence rather than high-risk, and every assessment carries the share of applicable checks it was able to evaluate.
- With no model configured the similarity term is omitted and the remaining weights renormalise, so a missing subsystem cannot read as "this section is fine" — the worst failure mode available here. Both properties are unit-tested, and the live check asserts the second against a real database.
- `fitSigmoid()` throws rather than returning the provisional constants, and reports how many labelled examples it received. Nothing in the codebase can hand back unfitted parameters from a function with that name.

**Honest scope.** The sigmoid shape and the band thresholds are the documented starting points from docs/04 §3.2 and docs/05 §3, **not fitted**, because fitting needs draft sections labelled with whether they went on to attract a request — and the corpus holds only requests that were raised, so the negative class does not exist. Say "provisional" in the deck. `section_rfi_rates()` has the same limit and states it: it returns a share of observed RFI volume, never a probability of triggering one.

---

## ADR-026 — Therapeutic area and IMP filters; `create or replace` is not a replace
**2026-08-27 · Accepted**

**Context.** The team asked for therapeutic area and investigational medicinal product filters on search. `therapeutic_area` already existed on `trial` and was populated — it simply was not reachable. The IMP existed too, but only inside `short_title`: the generator writes "A Phase II Trial of NN-1234 in Obesity".

**Decision.** `0018` promotes the IMP to `trial.imp_name` and backfills it from the titles already written, rather than inventing product names. The seed now generates the code once and uses it in both the title and the column, so the two cannot disagree. Both filters flow through `search_considerations`, `hybrid_search` *and* `search_facets`, because a filter present in one and absent from another produces counts that do not match the results.

**The bug this uncovered, which is the more valuable half of this entry.** `create or replace function` replaces only when the argument list matches exactly. Adding a parameter creates an **overload**. All three functions ended up with two signatures each, and Postgres then refuses any call it cannot disambiguate:

```
ERROR: function search_facets() is not unique
```

Every call the application makes passes named arguments and omits the rest, so search would have broken at runtime the moment this migration was applied — with a green migration, a green typecheck and a green build. It was found only by running the search against a database built from these migrations.

**Consequences.** `0018` drops the previous signatures explicitly before creating the new ones. CI gains a check that no function in `public` has more than one signature; overloads are always a mistake in this schema, so any duplicate fails the build. Verified after the fix: zero duplicate names, `search_facets()` resolves, six facet types including 129 IMP codes and 10 therapeutic areas.

**Also in this pass.** The "Section" filter is labelled **"Document type"** at the team's request. Noted honestly: the underlying field holds CTIS application section parts — Protocol, IMPD Quality, Informed Consent — and `document_name` is the column that actually holds document types. CLAUDE.md §6 treats exact CTIS vocabulary as a scoring signal with this audience, so this is a deliberate departure recorded here rather than a silent one.

---

## ADR-027 — Filing is a batch, and a partial batch still files
**2026-08-27 · Accepted**

**Context.** Teams receive several requests for information at once; uploading them one at a time is the kind of friction that decides whether a tool gets used.

**Decision.** Up to `MAX_BATCH` (10) documents per filing. Files upload and are read one at a time — the bytes go straight to Storage, but each read is a server round trip that parses a PDF, and firing ten at once is the quickest way to trip the rate limit the ingest actions deliberately impose. Each document is committed and reported independently.

**Consequences.**
- A batch of four where the second is a duplicate files the other three and says which one failed and why. Refusing all four would be worse for the user and no safer: each document is already independently atomic inside `commitIngestion()`, and there is no transaction spanning them — they are separate records that happened to arrive together.
- A file that cannot be read is reported beside the ones that worked, at both the review step and the outcome step, rather than blocking them.
- `MAX_BATCH` lives in `lib/ingest/constants.ts`, not beside the action that enforces it: a `'use server'` module may only export async functions, and a plain constant there is a build error that typecheck does not catch.

---

## ADR-028 — Analytics reports what the data supports, and the seed audits itself
**2026-08-27 · Accepted**

**Context.** Features 4 and 5 were the last two "coming soon" items. Before building, the data was checked rather than assumed: 324 of 348 documents carry `responded_at`, every document carries `due_at`, and the recurrence story is genuinely present — the top category has been raised 73 times across **57 distinct trials** in 14 Member States. Analytics was well supported. Audit was not: 10 rows and two action types, all from ingest testing.

**Decision.** `0019` adds four aggregate functions returning counts only; tier, preventability and owning team are applied in TypeScript from the taxonomy, one copy of the domain knowledge (ADR-024). Separately, `npm run seed` now emits an `INGESTED` event per document it files and a `CORPUS_RESET` event per wipe.

**On the seeded audit events — why this is not fabrication.** The Definition of Done says every state-changing action emits an audit event, and seeding is the single largest write in the system. It was not emitting any, which both left the viewer empty and quietly broke the rule where it mattered most. These events record something that genuinely happened: the generator really did file those documents. `seeded: true` in the metadata says who did it, and the events are timestamped with each document's own issue date so the trail reads as a history rather than 348 rows at one instant.

**Consequences.**
- `audit_events` has no foreign key to the corpus, so reseeding leaves the previous events in place and a visible history of resets. That is exactly what an append-only trail is for, and it makes the property demonstrable in the viewer instead of merely stated.
- The audit page cannot show actor *names*. `profile_self_read` lets a user read only their own profile, so the trail shows the acting team and marks the reader's own events. Surfacing that limit honestly beat widening a policy to make a UI nicer.
- `npm run verify:dashboards` proves what matters rather than asserting it: 21 checks, ending with an actual `UPDATE` and an actual `DELETE` against `audit_events`, both of which must be refused by the database.

**Two things the data would not support, reported rather than dressed up.**
- The effort model is assumptions, not measurement. Every input is `[VERIFY]` in docs/01 §8, so it ships as sliders producing a *range*, with the one measured input — the preventable share — labelled as measured. docs/01 §8: "judges respect an honest assumption far more than a fabricated statistic."
- **The corpus contains no late responses.** The generator answers in 2–9 days against a 10-day window, so `answered_late` is always 0 and the clock-breach story cannot be demonstrated. The stat tile now reports open items instead. If the "a missed validation clock invalidates the application" beat is wanted in the demo, the seed needs to produce some overruns — a corpus design decision for the team, not one to make silently.
