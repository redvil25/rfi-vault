# MEMORY.md — Working Knowledge Log

> Append here the day something is learned. This is the team's shared brain and the AI agent's context. Facts that turn out to be wrong get struck through, not deleted — knowing what you believed and why it was wrong is useful.

## How to use this file

- **Mentor answers** go in §3 verbatim. They are quotable in the deck.
- **Technical learnings** go in §4 with the number that proved them.
- **Dead ends** go in §5. They stop the team re-trying the same thing.
- **Open questions** go in §6 and get closed with a date and an answer.
- One line per entry, dated. Keep it scannable.

---

## 0. Live infrastructure

| Item | Value |
|---|---|
| Supabase project | `rfi-vault`, ref `dpgiaehimkltizdrbusg`, **eu-central-1 (Frankfurt)**, Postgres 17 |
| API URL | `https://dpgiaehimkltizdrbusg.supabase.co` |
| Migrations applied | 0001–0012 |
| Schema | 10 tables, 6 enums, 14 RLS policies (all `to authenticated`), 31 indexes, 3 search functions |
| Advisors | security 0 lints · performance 0 WARN |
| Still needed | service role key (dashboard → Project Settings → API keys), Gemini API key, GitHub remote |

## 1. Fixed facts about the competition

- Problem statement **#18** — Repository for Validation RFI considerations & responses received for EU CTR submissions.
- Sponsor: **Novo Nordisk GBS**, Hackathon 2026, inter-college, virtual via Microsoft Teams.
- Kickoff **11 August 2026**; runs **one month**; final submission ~**11 September 2026** *(confirm exact date — open question Q1)*.
- Team: exactly **5 participants**. Individual entries or teams of any other size are ineligible.
- Deliverables: **functional prototype**, **presentation**, **project report max 2 pages**.
- Judging: Innovation **25%**, Technical Implementation **25%**, Business Impact **20%**, Feasibility **15%**, Presentation Quality **15%**.
- Theme: **Innovation using AI & Automation**.
- Data: **dummy datasets only**; IP explicitly not applicable; a Confidentiality Agreement exists between the college and Novo Nordisk GBS.
- Mentorship: **weekly virtual connect** with a dedicated Novo Nordisk GBS mentor, plus a nominated college faculty mentor.
- Prizes: three winning teams; certificates for all participants.
- Tooling constraint: at least one participant needs licensed **Office 365** for material exchange. Any other tooling is self-sourced.
- Fair play: all work must be original and produced **within the hackathon period**. No cross-team sharing.

## 2. Fixed facts about the problem domain

- Novo Nordisk submits **~650 Clinical Trial Applications per year** under EU CTR.
- RFIs during **validation** extend timelines and consume cross-functional effort to prepare, review, approve, and submit responses.
- **No central repository** exists for validation RFI considerations and sponsor responses in a structured, reusable format.
- Named user groups: **RA Clinical, Affiliates, CTA Management, EU Submission Hub**. These four are our RBAC roles.
- Part I is assessed **once** by the Reporting Member State; Part II is assessed **separately by every Member State Concerned** — this is the structural source of duplicated effort and it is the core of the pitch.
- The one real example supplied is a **substantial modification** RFI: `CT-2024-519530-24-00-SM06-001`, Italy, ISTAT-updated fee, dated 05/08/2026. It is the style anchor for the entire synthetic corpus.
- Observation from that example: the approved sponsor response was **one sentence**. The value is not in writing the sentence — it is in knowing which sentence and which attachment worked. **The product is a precedent engine, not a text generator.**

## 3. Mentor answers (verbatim — quotable)

*(Fill in after each session. Date, session number, question, exact answer.)*

| Date | Q | Answer (verbatim) | What we changed |
|---|---|---|---|
| | | | |

**Highest-value questions still to ask:** validation RFI rate, considerations per document, hours per consideration, where RFIs are stored today, whether an application has ever lapsed on a missed clock, and what would stop a regulatory colleague trusting an AI-drafted response.

## 4. Technical learnings

*(One line each, with the number that proved it.)*

| Date | Learning | Evidence |
|---|---|---|
| 2026-08-11 | **A row-level `BEFORE DELETE` trigger does not make a table append-only.** `TRUNCATE` bypasses row-level triggers entirely, so the audit trail could be wiped by one statement. Needs a separate statement-level `BEFORE TRUNCATE` trigger. | Verified live: `truncate audit_events` succeeded before migration 0009, raises after. Both states tested. |
| 2026-08-11 | **A Postgres RLS policy with no `TO` clause applies to `anon` as well.** `read_shared_knowledge` had no `auth.uid()` test, so an unauthenticated caller could read every approved consideration over the REST API. The Supabase security linter does **not** flag this. | Found by inspecting `pg_policies.roles`; all 14 policies now scoped `to authenticated` (migration 0012). |
| 2026-08-11 | Moving pgvector out of `public` (advisor lint 0014) breaks any function that pins `search_path = public`, because the `vector` type and `<=>` operator stop resolving. Fix is `search_path = public, extensions`. | Migrations 0010 → 0011; all three search functions re-verified after the move. |
| 2026-08-11 | Wrapping `auth.uid()` / `current_team()` in a scalar subquery in RLS policies turns per-row evaluation into a per-statement InitPlan. | Cleared 7 `auth_rls_initplan` warnings (0012). |
| 2026-08-11 | Supabase security advisors: **0 lints**. Performance advisors: 0 WARN, only INFO `unused_index` — expected on an empty corpus, recheck after seeding. | `get_advisors` after migration 0012. |

Things we expect to learn and should record when we do:
- Where vector-only search fails on identifier queries (the ablation table)
- The RRF `k` value that maximises nDCG@10 on our corpus
- Whether LLM reranking earns its latency
- Calibrated similarity thresholds for the confidence bands and for the refusal gate
- Fitted risk-blend weights and the held-out AUC
- Measured cost per search and per draft from `ai_calls`

## 5. Dead ends

*(What we tried, why it failed, so nobody retries it.)*

| Date | Tried | Why it failed |
|---|---|---|

## 6. Open questions

| # | Question | Owner | Status |
|---|---|---|---|
| Q1 | Exact final submission date and presentation time limit | Domain Lead | Open — ask in mentor session 1 |
| Q2 | Validation RFI rate across the 650 applications | Domain Lead | Open |
| Q3 | Average considerations per RFI document | Domain Lead | Open |
| Q4 | Cross-functional hours per consideration | Domain Lead | Open |
| Q5 | Where are RFIs stored today — SharePoint, Veeva Vault RIM, email? | Domain Lead | Open |
| Q6 | Has an application ever lapsed on a missed validation clock? | Domain Lead | Open |
| Q7 | All `[VERIFY]` timelines in `docs/01-DOMAIN.md` §3 | Domain Lead | Open |
| Q8 | Gemini API processing region — does it affect the EU residency claim? | AI Engineer | Open |
| Q9 | Is a demo video allowed/expected alongside the live demo? | Lead | Open |
| Q10 | Report format — PDF, template, font/margin constraints? | Domain Lead | Open |
| Q11 | **Hosting platform** — deferred by ADR-011, must be decided Mon 31 Aug | Lead | Open |

## 7. Decisions already made (see `docs/DECISIONS.md` for full rationale)

- Postgres + pgvector, not a dedicated vector database (ADR-001)
- Hybrid retrieval with RRF, k=60 (ADR-002)
- Two embeddings per consideration: question-space and answer-space (ADR-003)
- Deterministic rule engine leads the risk score at weight 0.5 (ADR-004)
- The system refuses to draft below a similarity threshold (ADR-005)
- An independent, stronger model verifies groundedness (ADR-006)
- Audit trail is append-only, enforced by database trigger (ADR-007)
- EU data residency: Supabase `eu-central-1`; host must also be EU-pinned (ADR-008)
- Synthetic corpus from hand-written skeletons, fixed seed (ADR-009)
- Next.js + Supabase, TypeScript end to end (ADR-010)
- GitHub only; **no hosting platform adopted yet**, decision deferred to Mon 31 Aug. Keep the app host-agnostic (ADR-011)
- AI SDK **v7** with `@ai-sdk/google` called directly, no gateway (ADR-012)

## 8. Standing reminders

- The corpus is the demo. A weak corpus makes strong code look weak.
- Every claim on a slide needs a number from `npm run eval`.
- Use CTIS vocabulary exactly: *consideration*, *request for information*, *sponsor response*, *substantial modification*, *Member State Concerned*. Never say "amendment".
- The refusal path is the demo beat that wins the room. Protect it.
- Feature freeze **Saturday 5 September**. No exceptions, no arguments.
