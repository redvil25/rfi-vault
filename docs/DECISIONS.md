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

## ADR-024 — Domain knowledge lives once, in the taxonomy
**2026-08-27 · Accepted**

**Context.** `lib/domain/taxonomy.ts` is the team's own domain contribution and the artefact the mentor reviews: 29 categories, 21 of which name an `artefactKey`, and 15 Member States each carrying `languages` and hand-written `quirks`. Every consumer that needs a category's tier, weight or owning team is tempted to restate that knowledge beside itself. The second copy is the one that drifts, and CLAUDE.md §8 forbids fabricating regulatory facts — a stale copy is exactly how one gets fabricated by accident.

**Decision.** Consumers *derive* from the taxonomy rather than restating it. Analytics applies tier, preventability and owning team in TypeScript from the taxonomy over count-only SQL aggregates (ADR-023); ingestion classifies against the same category list that retrieval filters on. Adding a category changes one file.

**Consequences.**
- No second copy of the domain knowledge to drift, and nothing downstream asserting an article number, deadline or fee amount of its own.
- Domain quality is bounded by taxonomy quality, which is the right place for the mentor's review to land.
- SQL stays aggregation-only, which keeps the interesting logic unit-testable without a database.

---

## ADR-025 — Unknown is not a finding, and a missing signal is not a zero
**2026-08-27 · Accepted**

**Context.** Two ways a derived number can quietly lie, both of which look like working software: treating *absence of evidence* as evidence, and treating *a subsystem that did not run* as a subsystem that returned zero. Either one produces a confident figure with nothing behind it, which is the failure CLAUDE.md §2 rule 2 exists to prevent.

**Decision.** Anything not affirmatively known is UNKNOWN, and UNKNOWN counts against **coverage**, never against the number itself. Every aggregate reports the denominator it was actually able to evaluate. And any blend renormalises across the inputs that ran, rather than scoring an unavailable input as zero.

**Consequences.**
- A figure computed over half the corpus says so, instead of reading as a figure over all of it.
- A missing subsystem cannot read as a clean result — the worst failure mode available here.
- The rule is applied per subsystem, not assumed: analytics counts unclassified volume and excludes it from the shares (ADR-029), and ingestion writes `UNMAPPED` rather than guessing a section.

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

---

## ADR-029 — A document that cannot be filed never reaches the review screen
**2026-08-28 · Accepted**

**Context.** A CTIS export was uploaded whose header parsed perfectly — trial number, document reference, submission type and issue date all read — and whose body yielded zero considerations. It passed analysis, reached the review screen showing "0 considerations across 1 document", and offered a live **Approve and file** button. Pressing it would have failed: `commitIngestion()` refuses a document with no considerations. The user could only discover that after approving.

Two separate defects met there. The parser only accepted field labels alone on their own line, and the fileability rules lived in `commitIngestion()` alone, where nothing earlier in the flow could consult them.

**Decision.**

*One fileability rule, three call sites.* `checkFileable()` in `lib/ingest/constants.ts` returns a discriminated union — the narrowed document, or the reason it cannot be filed. `analyseStored()` refuses the upload with it, `commitIngestion()` re-checks it against its own independent re-parse before writing, and the review screen uses it to decide whether to render an **Approve and file** button at all. A refusal at the analysis step lands beside the file name in the same list as every other unreadable upload, and the batch's good documents carry on (ADR-027).

*Duplicates are also detected at analysis.* The commit step still refuses them — it must, since two uploads can race — but learning a document is already filed before reading twelve considerations is the difference between a warning and wasted work.

*Inline field labels are accepted.* `Consideration number: 1` on one line, as well as the label-then-value form of the reference export. The inline value requires a colon, so the prose line "Consideration of the benefit-risk balance is required." is still read as text rather than as a label — which would have silently truncated the consideration. The one exception is the consideration number itself, whose value may be whitespace-separated because it is always a bare number.

*Rate limits are sized against `MAX_BATCH`, not picked round.* Upload and analysis are consumed once per **file**. At 20 per five minutes a user could file two full batches and was then refused the third with "Too many uploads. Try again in 101 seconds" — during a demo, indistinguishable from a broken page. Both are now `MAX_BATCH × 6`. Committing is consumed once per **batch** and needs nothing like that headroom, so it stays at 30. Every limit is now spent *after* input validation rather than before it: a token spent on input that was never going to be accepted lets a malformed client burn a user's whole window without a single PDF being parsed, which is the only thing the limit exists to bound.

*Uploads that are never filed are deleted.* Every abandoned review used to leave its PDFs in the private bucket for ever, with nothing pointing at them. `discardUploads()` removes them on discard, on "don't file this one", on refusal at analysis, and on refusal at commit. It never removes a key an `rfi_document` row points at, whoever asks — storage keys are guessable in shape, and without that check one ingestor could destroy the source file behind another team's filed document.

**Consequences.**
- The failure a user sees is "this file could not be read, and here is what was read instead", at the moment of upload. `checkFileable()` names what it *did* parse, so a wrong file is distinguishable from a parser that failed on the right one.
- The review screen's guard is, in normal operation, unreachable. It stays deliberately: if the server side is ever relaxed, the failure mode is a document shown as unfileable rather than a reviewer approving something that was never going to be written.
- The commit form's state lives in `useActionState`, which does not reset when the rest of the client's state does — a failed filing left its error under the *next* batch's review screen. The review flow is now its own component, remounted on a new review. Its key is a review counter, not the document list: removing one document from a batch must not discard the corrections made to the other nine.

**Also in this pass.**
- The ingest page still advertised "a text PDF, a scan, or a screenshot. Scans and images are read with OCR" — copy that outlived ADR-021 by two commits, on the one screen where the promise is immediately falsifiable.
- `?next=` on sign-in was validated with `startsWith('/')`. `//evil.example` satisfies that and is a protocol-relative URL, so it was an open redirect that fired on a freshly authenticated session. It now requires a path that does not continue with a slash or backslash, and an invalid value falls back to `/search` rather than blocking the sign-in.
- `parseIssuedAt` accepted `45/13/2026 99:99` and rolled it over into a real date in 2027. A wrong issue date is worse than a missing one: it reaches the audit trail and every turnaround figure on the analytics page.
- The similarity driver said "Resembles 3 past sections" even when nothing cleared the precedent floor. It now says so.

---

## ADR-030 — Feature 3: retrieve, then gate, then draft — and record the refusals
**2026-08-28 · Accepted**

**Context.** Drafting was the last unbuilt feature and the one the solution overview leads with. It is also the one that can lose the competition outright: a tool that invents a regulatory fact in front of a Novo Nordisk audience is finished, whatever else it does well.

**Decision.**

*Order is the safety property.* Retrieve, then gate, then draft. Nothing reaches the model until the repository has proved it holds an approved response close enough to answer from. A pipeline that drafts first and checks afterwards has already produced the text it was supposed to refuse to produce, and every subsequent control is cosmetic.

*A refusal is a first-class outcome, and it is stored.* `response_draft` records every generation attempt, refusals included, with the reason, the nearest precedents, and the similarity that fell short. Two consequences. The screen gives a refusal the same room as a draft, because "we looked, here is what we found, it is not close enough" is more use to a reviewer than a shrug. And the corpus-level refusal rate becomes a measurable number rather than a claim — storing only successes would make the deck's central assertion unprovable.

*Without embeddings, the answer is no.* With no model configured there is no similarity to measure, so drafting refuses rather than falling back to keyword retrieval. A keyword hit is evidence that two records share words, not that one answers the other, and dressing it up as precedent would be the exact failure this feature exists to prevent. Verified end to end in that state today: `npm run verify:draft`, 15 of 15.

*Every claim carries an id, and an invented id is dropped.* `citations` is `.min(1)` in the Zod schema, so a draft with no citation fails at the tool-call boundary rather than being talked out of by the prompt. A cited id the model was never given is a fabricated citation; it is filtered out and logged rather than passed through, because a citation that does not resolve is worse than none.

*The verifier is a different model, deliberately starved of context.* `gemini-2.5-pro` grades each sentence against the same precedents and nothing else — told explicitly that its own knowledge of EU CTR is not evidence here. A grader allowed outside knowledge cannot detect a draft that used outside knowledge. Groundedness counts PARTIAL as half, and is null rather than 0 or 1 for an empty draft: no sentences is an absent measurement, not a perfect score. If the verifier cannot run, the draft is shown labelled **ungraded** rather than shown clean.

*Sentence splitting is conservative on purpose.* "version 3.0" and "section No. 4" must not split, because a fragment graded alone reads as unsupported and would drag down the very figure the deck publishes.

**The status machine.** `DRAFT → IN_REVIEW → APPROVED → SUBMITTED`, with request-changes as the only way back, and `SUBMITTED` terminal — the correction path for a filed response is a new request for information, which is how the regulation works. The rules are pure and unit-tested; the executor is left with nothing to decide.

Transitions run through the **caller's** client, not the service role. `write_own_team` in 0012 is the authorisation; routing this through the service client would bypass the policy and leave the team check living only in TypeScript. The pure rules run first so a user gets a sentence rather than a policy violation, but the database has the last word. The update is conditioned on the status that was read, so two reviewers on the same consideration produce a "someone else changed this" rather than a silent overwrite. A failed audit write rolls the status back: a state change with no record of who made it is not a state change we keep.

**The feedback loop, and where it stops.** Approving re-embeds the response so it becomes precedent for the next search. Re-embedding never fails the transition: approval is a regulatory act that either happened or did not, and refusing it because an embedding call timed out would be indefensible. The caller is told, and the UI says "approved, not yet searchable by meaning" rather than implying a loop that has not closed.

**Consequences and things deliberately not done.**
- **No `/app/api` routes.** The layout in CLAUDE.md promised `/api/draft`; it is a Server Action beside the screen instead, which keeps the Zod boundary, the RLS-scoped client and the audit emission in one file. CLAUDE.md is corrected rather than the code bent to match it. A REST surface is worth adding when something outside this app needs to call in, and nothing does.
- **No separation of duties.** Nothing stops the author of a draft approving it. That is a real gap for a regulatory workflow and it is stated here rather than left to be discovered: with one demo account per team, enforcing four-eyes would have made the happy path undemonstrable. The seam is `mayTransition()`.
- **Drafting is limited to six per five minutes per user.** It is the only endpoint here that costs money, and the ceiling is on spend, not on politeness.
- **Groundedness has no published corpus-level figure yet.** It cannot have one until the corpus is embedded. `docs/metrics/latest.json` still reports three of four retrieval configurations as `ran: false` for the same reason.

---

## ADR-031 — The protocol code is a filter, not a rename of the EU trial number
**2026-09-03 · Accepted**

**Context.** The team asked for a protocol code dropdown on search. No such field existed. The tempting shortcut was to relabel `trial.eu_trial_number` — the values are already there, already unique per trial, and the dropdown would have taken one line.

**Decision.** `0021` adds `trial.protocol_code` as its own column. The two identifiers are not the same thing: `eu_trial_number` (`2024-519530-24-00`) is the EU CT number CTIS issues and the one a Member State quotes back in a request for information, while the protocol code is the sponsor's own identifier for the study — what is on the protocol cover page and what a study manager says out loud. CLAUDE.md §6 makes exact CTIS vocabulary a scoring signal with this audience, and a dropdown labelled "Protocol code" that filters on the EU CT number is precisely the slip that costs those marks.

The value is synthetic and derived from the IMP the trial already carries (`NN-1234` → `NN1234-4567`), generated once in the seed and used for both, so title, `imp_name` and `protocol_code` on one row can never name two different products — the same rule ADR-026 set for the IMP. Existing corpora are backfilled from `imp_name` with a serial derived from the EU trial number, so the column is populated without a reseed and the value is stable rather than random.

The filter flows through `search_considerations`, `hybrid_search` *and* `search_facets`, for the reason ADR-026 gives: a filter present in one and absent from another produces counts that do not match the results. All three previous signatures are dropped explicitly before being recreated — `create or replace` overloads rather than replaces, which is the bug ADR-026 exists to remember.

**Consequences.**
- The dropdown is facet-scoped like every other filter, so the list narrows as the other filters are set. With 130 trials in the corpus it still opens at 130 entries.
- Those entries are sorted **alphabetically**, not by count. A protocol code is unique to one trial, so every count is near-identical and frequency order is effectively random; in a list this long, alphabetical is the only way to find a code you already know.
- **The free-text box does not search protocol codes.** Typing a code finds nothing — `search_considerations` matches identifiers on `document_ref` and `eu_trial_number` only. That is a deliberate scope limit, not an oversight, and it is the obvious next thing to add: the identifier a study manager knows best being the one thing the search box cannot find is a demo question waiting to be asked.

**What applying it caught.** The 0021 backfill built the code as `'NN' || replace(imp_name, '-', '')`, but `imp_name` already starts with NN — every backfilled row came out `NNNN1065-9412`, a shape the seed would never produce. All 130 rows were wrong and nothing in the build could have said so: the column is text, the filter still worked, and the dropdown still populated. It was found by counting the column after applying the migration rather than by trusting it. `0022` recomputes from `imp_name` (forward-only; 0021 was already applied). Verified after: 130 codes, 130 distinct, zero malformed against `^NN[0-9]{4}-[0-9]{4}$`, and every code agrees with its row's `imp_name`. Filtering by one code returns 11 considerations across exactly 1 trial.

**Twelve trials have no protocol code, deliberately.** They are the rows the ingestion path creates when a filed document references an EU trial number the repository has not seen: no IMP, a placeholder title, and no protocol code stated anywhere in the document. Minting one would be inventing a regulatory identifier, which is the behaviour CLAUDE.md §2.2 exists to forbid. They are absent from the dropdown and from any protocol-code-filtered search, and the facet counts show it — `protocol_code` totals 940 rows where `category` totals 952, the same 12-row gap `imp_name` already had.

---

## ADR-032 — Unknown is not a finding, applied to analytics and ingestion
**2026-09-03 · Accepted**

**Context.** `npm run verify:dashboards` failed on one check: *every category resolved against the taxonomy — UNCLASSIFIED*. Six considerations from ingestion runs sat outside the taxonomy. Chasing it found two places where a refusal had been quietly converted into a plausible-looking answer, and the check itself was the third.

**The analytics half.** `lib/analytics/query.ts` read `tier: taxonomy?.tier ?? 0`. That makes "this category is not in the taxonomy" indistinguishable from a real tier, and the volume then lands in the denominator of the preventable share — scoring an unclassifiable record as *not preventable*, a verdict nobody reached. The headline percentage in the deck was computed over it.

`Preventability` now carries `classified` and `unclassified`, and both shares divide by `classified`. `total` still counts everything read, so the volume headline is unchanged. The analytics page states the denominator when anything is unclassified, and the preventability bar says how many records it excluded and why, rather than folding them into "judgement-based". Measured after: 75% preventable over 946 classified of 952, against 74% over 952 before — the number moved because the old one was slightly wrong, not because the definition was tuned.

This is ADR-025's rule — *unknown is not a finding, and a missing signal is not a zero* — applied one subsystem over. It was stated in the abstract and not carried into analytics.

**The ingestion half, which is where the bad data came from.** `lib/ingest/commit.ts` read `section: c.section ?? c.sectionRaw ?? 'Regulatory'`. `normaliseSection()` returns null for anything it cannot map and raises a warning; the commit path wrote the rejected raw string anyway. Member State names reached the column and appeared in the search **Document type** dropdown beside real application section parts:

```
Spain (2) · France (2) · Germany (2)
```

A pharma audience reading that sees a tool that does not know a Member State from an application section part — the exact vocabulary signal CLAUDE.md §6 says this audience scores on. The `'Regulatory'` fallback was worse than the raw string: it is the highest-volume section, so a misfiled row disappears into the largest bucket and skews every per-section share the analytics dashboard reports.

`sectionForRow()` now takes only the mapped value and falls back to `UNMAPPED`, mirroring `UNCLASSIFIED` for category — `section` is NOT NULL, so something must be written, and the only honest something is a value that says so. `0023` repairs the rows already filed, expressed as "any section not in the taxonomy" rather than as a list of the three observed values.

**The check was wrong too.** Asserting that *every* category resolves against the taxonomy makes an honest refusal look like a defect, and the cheapest way to make it pass is to stop the classifier refusing. It now asserts what should actually hold: unclassified volume is counted and excluded from the shares, and every *classified* category resolves. The verification line prints the denominator alongside the percentage.

**Consequences.**
- The deck's preventable share needs restating as "of classified considerations". The figure is 75%.
- `section_part` is still guessed: `c.sectionPart ?? 'PART_I'` files a consideration under Part I when the parser could not tell. It is the same defect as the two fixed here and the field matters more than either — the Part I / Part II split is the business case. Fixing it needs an enum value or a refusal path, so it is recorded here rather than done quietly.
- Six considerations remain `UNCLASSIFIED` and now six read `UNMAPPED`. They are the same six ingestion rows, they are visible in both dropdowns, and that is the intended end state: the system says what it could not determine instead of hiding it.

---

## ADR-033 — The pre-submission check is retrieval with dates, not a risk score
**2026-09-05 · Accepted · Replaces the feature withdrawn in 0024**

**Context.** The first pre-submission check blended a hand-authored rule engine, a similarity term and a smoothed base rate into a 0-100 score with LOW/MEDIUM/HIGH bands. It was removed entirely in `0024`. Three things were wrong with it, and only the third was obvious at the time.

The score had no calibration behind it. Fitting the blend needs draft sections labelled with whether a request followed, and this repository holds only requests that *were* raised — the sections that went out clean were never recorded. So there was no negative class, no AUC, no false-positive rate, and "risk: 0.71" was a decimal with nothing under it.

The rules asserted national requirements. A hand-authored country matrix states, in this team's voice, what Italy or Spain requires. Nobody here has that authority, CLAUDE.md §8 forbids it, and it rots: it was right for four countries and stale within a quarter.

And a score is not what the user needs. A regulatory writer cannot act on a number. They act on "which document is missing, and who do I chase for it".

**Decision.** Rebuild it as three deterministic passes over evidence that already exists, and publish flags rather than a score.

1. **Lint the writer's own text.** Absence, futurity and placeholder phrases, matched literally. `not attached`, `will be provided`, `TBC`, `XXX`, a surviving tracked change. This is the strongest deterministic predictor available because it is the writer admitting the gap. It states nothing about regulation — only about the writing — so it claims no authority it does not have.
2. **Mine the rules from the corpus.** `mined_rules()` groups past considerations by (Member State × section × submission type). A recurring theme becomes a rule carrying hits, distinct trials, a date range and a resolved count. The rule *is* its evidence, so it is explainable by construction, and every Member State in the repository gets the same treatment rather than the four somebody had time for.
3. **Date-scope everything.** Each rule carries `first_seen` and `last_seen`; one unseen for 12 months is greyed and never fires, reported as SKIPPED with its age. Italy's fee rule applies from 17 February 2025 — a theme mined from 2023 may describe a requirement that no longer exists, and firing it anyway is how a tool stops being opened.

Each flag then carries the past request verbatim, the accepted sponsor response that closed it behind a copy button, the artefact to produce (`artefactKey`) and the team to chase (`owner`) — both read from the taxonomy, so this feature states no regulatory fact of its own (ADR-024). Nothing is generated: no model writes regulatory prose, because nobody pastes unverified text into a CTIS dossier and an untraceable suggestion is worth less than none.

**Consequences.**
- **The headline is "2 blockers, 3 likely triggers".** No score, anywhere in the product. Severity comes from evidence, not from a fitted weight: a stated gap or a placeholder is a blocker because it is a fact about *this* dossier, recurrence is softer because it is a fact about other people's.
- **The largest rule in the corpus does not fire.** `FEE_NATIONAL_UPDATE` for Italy is 33 occurrences across 26 trials, last seen April 2025 — 16 months stale. The check greys it and says why. Demonstrating the refusal is worth more than the flag would have been.
- **Coverage is on the screen, not in a document.** Corpus date range, the fact that every record is synthetic, and any requested Member State with no precedent at all — because there a clean result means *no data*, not *no risk*, and a user who discovers that themselves stops trusting everything else.
- Two SQL functions, no new tables. A run writes one `PRECHECK_RUN` audit event carrying the shape of the check and its verdict — never the pasted dossier text, which is the sponsor's and does not belong in an append-only table the whole team can read.

**Two defects found by using it, and what they changed.**

*Flags arrived with nothing attached.* The first version matched a lint finding to "the section's most recurrent **live** rule". On a section whose rules are all stale that is no rule at all, so on the flagship path — Italy, fee proof, substantial modification — every flag came back with no artefact, no owner, no wording and no precedent. The three things the writer wanted were the three things missing, and the unit tests passed throughout because they tested the pieces rather than the path. A finding is now categorised by **classifying its own text** with the same deterministic classifier ingestion uses (ADR-024), and precedent is fetched for any theme with a resolved occurrence whether or not the rule is live. Staleness governs whether a rule *fires*; it does not make the history untrue, and the accepted answer from 2025 is still the best wording anyone has. The card says how old it is.

*The narrow scope is usually empty.* Measured: at (this Member State × this section) only **13 of 242** held-out requests had any live rule. So the scope widens — dropping submission type, then Member State — and the result **always states which scope produced it**. "Italy asks this" and "somebody, somewhere, asks this" are different claims; widening in silence would let the second be read as the first.

**The number, and the half of it that does not exist.** `npm run eval:backtest` scores each held-out request against the corpus as it stood the day before it was issued, through the same scope ladder and staleness window the product uses:

```
Recall overall         62.4%  (151/242)
  at exact scope       15.4%  (2/13 checks)
  after widening       77.2%  (149/193 checks)
  no live rule at all  36 checks — reported as such, not passed
Themes surfaced        1.8 per section checked
```

That recall is an **upper bound**: the shipped check also gates each rule on the dossier text, and history holds no dossier text to replay that gate against. Gating can only lower it. Report both lines or neither — a check that flagged everything scores 100% recall. **The false-positive rate is not computable and must not be estimated** — the corpus holds only requests that were raised, so there is no negative class. Making it computable is a data-collection change in a real deployment, not a modelling one.

*A mined rule never looked at the dossier.* The worst of the three, and the one a user found by typing `health` into the Regulatory box and getting Italy's fee-payment flags back. A mined rule describes what a Member State asks about a section; on its own it says nothing about the document in front of the writer, and firing it unconditionally produced the same flags for any text at all. The screen presented a fact about the corpus as a finding about the dossier.

Two gates now stand between a mined rule and a flag. **Substance**: a section under 25 words is too thin to assess, and its rules are reported SKIPPED with the word count rather than passed. **Topic**: a rule only fires when the text does not already address the theme, with the subject terms derived from the category's own label and `artefactKey` (ADR-024), so this adds no domain assertion of its own. A fired flag now leads with what is missing — *"Nothing in this section mentions fee, proof, national, payment"* — which is a claim about the document, and a held-back rule says which of the two gates stopped it.

The headline changed with it. "Nothing found" and "nothing looked at" rendered identically before; a one-word paste headlined as a clean pass, which is the most dangerous sentence this screen could produce. It now reads **"Nothing was checked"** and names the sections that were too short.

**Also built, having been listed as missing.** Cross-section consistency (protocol version and date, subject count, IMP name and strength, EU trial number) — with the rule that a value found in only one pasted section is reported *not checked*, never consistent. Whole-dossier auto-sectioning, where an unrecognised heading is listed and excluded rather than filed under the nearest-looking section. And a timestamped JSON snapshot carrying scope, rule versions, every outcome and the audit event id, so a regulated team can show what it checked months later.

---

## ADR-034 — Suggestions are options with a downside, not a better draft
**2026-09-05 · Accepted · Builds on ADR-005**

**Context.** Feature 3 answers a consideration that is already filed: one draft, inside the status machine, to be reviewed and approved. The request that has *just arrived* is a different situation. It is not in the repository, there is no record to move through a workflow, and the writer's question is not "what is the answer" but "what are my options".

The obvious build — retrieve precedent, ask for three responses — produces three paraphrases of one sentence. A writer choosing between them is choosing nothing, and the feature is then a slower version of Feature 3.

**Decision.** Three **strategies**, not three drafts. `SUPPLY` (the artefact exists, attach it), `JUSTIFY` (the dossier already answers this, point at where), `COMMIT` (it does not exist, say so and give a date). These are the three moves actually available when a regulator asks for something, and they are distinguishable enough that picking one is a decision.

Each option carries `whenToUse` and — the field that earns the screen — **`risk`**, the reason *not* to choose it. An option presented with no downside has not been thought about, and a regulatory reviewer will not trust one that pretends otherwise.

The schema is `.min(1).max(3)`. If the precedent supports two honest strategies, two is the answer; padding to three would invent the third, which is the failure this product exists to prevent.

**Consequences.**
- **Retrieve, gate, generate — unchanged from ADR-005.** Below the similarity threshold nothing is drafted, the taxonomy names the team to escalate to, and the closest records are still shown: not close enough to answer from, but worth reading.
- **The section is never guessed.** Retrieval is filtered per application section, so a wrong section returns precedent from the wrong part of the dossier and the writer cannot see it happened. When the user leaves it blank and the classifier cannot resolve it to exactly one section, the run refuses and asks.
- **Citations are re-checked against the retrieved set.** A `consideration_id` that was never retrieved is a fabricated reference and `generateObject` validates it happily — it is a well-formed string. Invalid citations are dropped, an option left with none is discarded, and if that empties the list the run refuses. An uncheckable suggestion is worse than none.
- **Each option is graded separately** by the stronger model. A verdict on "the third sentence" means nothing if the grader cannot tell which option it belongs to. A verifier failure degrades to *ungraded* and says so rather than implying a grade (ADR-025).
- **The paste is untrusted input reaching a model.** It is fenced, and the system prompt states that anything inside reading like an instruction is part of the quoted document. The output schema is the second constraint: there is no free-text field a redirected model could answer into.
- **Nothing is persisted but an audit event.** `SUGGESTED` or `SUGGEST_REFUSED`, carrying the section, Member State, category, similarity and which strategies came back — never the pasted request, which is the sponsor's.
- **Deliberately not built:** no way to file the chosen option as a consideration from this screen. That is Feature 3's job and it has the status machine, the approval step and the audit trail to do it properly. A second, lighter path into the repository would be a second set of rules about who may write to it.

**Found while shipping this.** `GOOGLE_GENERATIVE_AI_API_KEY` is set to an empty string in the production environment, so `aiEnabled()` is false there. Semantic retrieval, drafting and suggestions all refuse on the deployed site and say why — which is the designed behaviour and is exactly what the search page's "keyword search only" notice has been reporting. It is a configuration gap, not a code defect, and no amount of code will make the feature demonstrable until a real key is set.

---

## ADR-035 — Generation and embedding are separate capabilities, from separate providers
**2026-09-05 · Accepted · Supersedes part of ADR-013**

**Context.** The project could not obtain a Google Gemini key; the key available was Groq's. Swapping the generation provider is what ADR-012's single choke point was built for, so that half was a one-file change.

The other half was not. **Groq serves no embedding model at all.** And `aiEnabled()` was a single flag standing for "AI works", read by both the generation paths and the retrieval paths. A Groq key would have set it true while semantic retrieval remained impossible — every draft and every suggestion would have proceeded to a confidence gate computed from nothing.

That is worse than the old failure. Refusing because there is no key is honest; refusing because similarity is undefined, while reporting that a model is configured, is not.

**Decision.** Split the capability in two.

`generationProvider()` returns `'groq' | 'google' | null` — Groq wins when both are present, because the Gemini variables ship with defaults and are easy to leave lying around, while a Groq key is something somebody deliberately added. `aiEnabled()` now means only "text generation is available". `embeddingsEnabled()` is the separate question retrieval asks, and every retrieval path was moved onto it.

Embeddings come from a **local sentence-transformer**: `@huggingface/transformers` running `Xenova/all-mpnet-base-v2`, 768 dimensions to match `vector(768)` in 0003. This was already the documented fallback in docs/04 §1; it is now the default path.

**Consequences.**
- **The corpus embedded for the first time.** 1,861 vectors in 98 seconds on a laptop, no key, no account. `rfi_embedding` had been empty since the project started, which is why search had been reporting "keyword only" and why every draft and suggestion refused.
- **Nothing leaves the machine to be embedded.** For a company that pins its database to Frankfurt, embedding a sponsor's draft text locally is the more defensible arrangement, not merely the cheaper one. Say it in the demo.
- **`npm run seed && npm run embed` now reproduces the whole corpus with no account anywhere.** That is a stronger reproducibility claim than the one CLAUDE.md §2 rule 5 makes.
- **Model choice mirrors the flash/pro split** ADR-006 depends on: `openai/gpt-oss-20b` drafts, `openai/gpt-oss-120b` verifies. The grader must be the stronger of the two or it is not a grader. `llama-3.3-70b-versatile` was the first choice and is not available on this account — the model list is read from the account, not assumed.
- **Local embeddings cost a cold start.** The weights load once per process. On a laptop and in CI that is a second; in a serverless function it is paid again on every cold instance, and that is an unresolved deployment question rather than a solved one.
- `ai_calls` records local embedding runs at zero cost with a `local:` model prefix, so the cost-per-RFI figure stays honest about what actually ran and a run's retrieval numbers can be attributed to the model that produced them.

---

## ADR-036 — The ablation table found a missing arm in hybrid search
**2026-09-05 · Accepted**

**Context.** With embeddings finally populated, `npm run eval` ran for the first time and produced a table that argued against the product's central technical claim:

```
| Configuration      | Recall@5 | identifier | semantic |
| Keyword only       |    0.634 |      1.000 |    0.000 |
| Vector only        |    0.195 |      0.000 |    0.580 |
| Hybrid (RRF, k=60) |    0.220 |      0.000 |    0.680 |
```

Hybrid was **worse overall than keyword alone**, and scored zero on the identifier queries keyword answers perfectly — 25 of the 41 gold queries.

**The cause was not fusion, tuning or `rrf_k`.** `search_considerations` (0016) has two branches: full text, and an identifier branch matching a pasted `document_ref` or `eu_trial_number` with ILIKE, because those strings are exactly what `to_tsvector` mangles. `hybrid_search` only ever had the full-text arm. A pasted document reference matched nothing in its keyword arm, the vector arm cannot match an identifier either, and the fusion of two empty results is an empty result.

ADR-002 claims hybrid retrieval exists so that identifiers *and* meaning both work. That was true of `search_considerations` — which the search page calls — and false of `hybrid_search`, which drafting and suggestions call. The two functions disagreed for eighteen migrations and nothing caught it, because nothing had ever been able to run the comparison.

**Decision.** `0026` adds the identifier arm to `hybrid_search` and folds it into the RRF sum at rank 1. An exact reference match is not a fuzzy signal to be blended; it is the row the user asked for by name.

**Consequences.**
- Recall@5 went from 0.220 to **0.795**, against 0.634 for keyword alone and 0.195 for vector alone. Identifier queries recovered from 0.000 to 0.944.
- The by-type table now makes the argument it was always supposed to: keyword scores 0.000 on paraphrase, vector scores 0.000 on identifiers, and hybrid is the only column never zero.
- **The first attempt at this migration broke search**, by using `create or replace` on the older ten-argument signature and leaving it beside the current thirteen-argument one — every named-argument call then failed as ambiguous. 0021 documents that exact hazard in capitals, three migrations earlier. `0026` drops both signatures before creating.
- The lesson is the one docs/05 opens with, and it earned itself here: an ablation table is not a slide, it is a test. This defect was invisible to the typecheck, the unit tests, the live smoke test and the eye.
