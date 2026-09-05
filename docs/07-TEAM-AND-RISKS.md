# 07 — Team, Ownership, and Risk Register

## 1. Roles — five people, five clear lanes

Five is the mandated team size. Overlapping ownership is the main cause of stalled hackathon teams, so each lane below has one accountable owner. Help across lanes freely; decide within your own.

### Lead / Integrator
Owns the repository, CI, deployment, and the final integration. Runs standup. Owns the demo on the day. Has the final call on scope cuts. **Writes less code than everyone else and reviews more of it.**
Deliverables: green `main` at all times, a fresh clone that runs in under ninety seconds from Day 3, a hosted URL from Phase 3 (ADR-011), the demo script, the click path.

### Retrieval Engineer
Owns embeddings, the `hybrid_search` function, RRF tuning, confidence calibration, and the **entire evaluation harness**. This person's output is the metrics slide.
Deliverables: `lib/search/*`, `0008_hybrid_search.sql`, `scripts/eval/*`, `docs/metrics/*.json`.

### AI Engineer
Owns the RAG pipeline, prompts, the confidence gate, the verifier pass, and the `ai_calls` telemetry.
Deliverables: `lib/draft/*`, `lib/ai/*`, the refusal path, groundedness numbers.

### Frontend / UX
Owns all four screens, charts, the workflow UI, states, and accessibility. In a judged demo, the interface *is* the product — this is not a support role.
Deliverables: search, ingest, RFI detail, analytics, audit screens; Lighthouse ≥ 90 / ≥ 95.

### Domain Lead / PM
Owns EU CTR research, the taxonomy, the synthetic corpus design, the mentor relationship, the deck, and the report. **Highest-leverage role on the team** — domain accuracy and narrative are worth more points than any single feature.
Deliverables: `docs/01-DOMAIN.md` with zero unresolved `[VERIFY]` tags, `scripts/seed/taxonomy.ts`, mentor summaries, deck, 2-page report.

## 2. Working agreements

- Standup 20 minutes daily, same time. Shipped / blocked / today.
- All work through PRs. One reviewer minimum. No direct pushes to `main`.
- Blocked for two hours → escalate to the team. Nobody sits stuck alone.
- Friday is demo day, internally, every week, on the deployed URL.
- Decisions go in `docs/DECISIONS.md` the day they are made.
- Insights, mentor answers, and dead ends go in `MEMORY.md` the day they happen.
- Anyone may call a **scope-cut conversation** at any time. The Lead decides.

## 3. Risk register

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | **Team builds a generic chatbot** and loses differentiation | Medium | Critical | Feature 3 (grounded drafting with refusal) is scheduled in Phase 2 and is non-cuttable. Re-read the differentiator section every Friday. | Lead |
| R2 | **Weak synthetic corpus** makes every feature look weak | High | Critical | Two full days budgeted; skeletons hand-written; team reads 30 samples aloud; distributions specified in advance. | Domain Lead |
| R3 | **Gemini quota or outage during the demo** | Medium | Critical | Local embedding fallback; cached responses for the scripted demo RFIs; keyword search works with no model; recorded backup video. | AI Engineer |
| R4 | **Live demo fails on the day** (network, Teams, laptop) | Medium | High | Recorded video ready to play; PDF deck local; pre-signed-in browser windows; full rehearsal on the actual setup. | Lead |
| R5 | **Scope creep** — four features half-built | High | Critical | Phase exit criteria are hard gates. Feature freeze Sat 5 Sep, no exceptions. | Lead |
| R6 | **Domain inaccuracy** noticed by a regulatory judge | Medium | High | `[VERIFY]` tag discipline; mentor validates the taxonomy in session 2; vocabulary rules in `docs/01-DOMAIN.md` §9. | Domain Lead |
| R7 | **No numbers in the deck** | Medium | High | Eval harness is built in Phase 1, not at the end. It runs in CI. | Retrieval Engineer |
| R8 | **Academic conflicts** — exams, classes, other deadlines | High | Medium | Map each member's unavailable days in Week 1; front-load their critical work; no single point of failure on any deliverable. | Lead |
| R9 | **Mentor sessions wasted** on status updates | Medium | High | Written agenda 24 h ahead; prepared questions; written summary within two hours. | Domain Lead |
| R10 | **Integration hell in the final week** | Medium | High | Deploy from Day 3; merge daily; `main` always demoable. | Lead |
| R11 | **Report exceeds 2 pages / deliverable rules broken** | Low | Critical | Check the rules again in Week 4. Wrong-format submissions get disqualified, and eligibility rules here are explicitly strict. | Domain Lead |
| R12 | **Confidentiality breach** — real data or NN material in a public repo | Low | Critical | Private repository; synthetic data only; no NN documents committed; a Confidentiality Agreement is in force. | Lead |
| R13 | **AI cost overrun** during corpus generation | Low | Medium | Cache aggressively; commit generated JSON; monitor `ai_calls`; use flash tier. | AI Engineer |
| R14 | **Frontend left to the last week** and the demo looks like a prototype | Medium | High | UI work runs in parallel from Phase 1; Friday demos expose ugliness early. | Frontend |

## 4. Scope-cut order

If time runs short, cut in exactly this order. **Never cut upward.**

1. LLM reranking (keep only if it wins on measured nDCG)
2. Analytics "insight of the week" LLM summary
3. OCR for scanned documents (already a stated non-goal)
4. Analytics dashboard depth — reduce to three charts
5. Multi-Member-State comparison view

**Never cut, under any argument:** hybrid search, the confidence gate and refusal path, citations, the audit trail, the eval harness, the demo video, the rehearsals.

## 5. What "production ready" means for this submission

You are not shipping into a validated GxP environment in one month. Be precise about what you *are* claiming, and say it exactly this way:

**Delivered:**
- Deployed, authenticated, multi-tenant-aware application on a stable URL
- Row-level authorisation enforced in the database, not in application code
- Append-only audit trail enforced by a database trigger
- Automated tests in CI: unit, E2E, and evaluation regression
- Reproducible data pipeline and reproducible metrics
- Error handling, rate limiting, input validation, observability, cost telemetry
- EU data residency
- Documented architecture and a ninety-second setup path

**Explicitly out of scope, with a named path:**
- Formal computerised-system validation (CSV) and qualification
- Enterprise SSO — Supabase Auth stands in for Entra ID / SAML
- Veeva Vault RIM / SharePoint connectors
- OCR for scanned documents
- Production data migration and taxonomy sign-off by regulatory governance

Presenting this as a table titled **"Production-ready: what that means and what it does not"** is a Feasibility slide that most teams will not think to build. It converts your honest limitations into evidence that you understand how software actually reaches production in a pharmaceutical company.
