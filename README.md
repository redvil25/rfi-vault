# RFI Vault

**A searchable, auditable repository of EU CTR Request-For-Information considerations and approved sponsor responses — that also predicts which sections of a draft application will trigger an RFI before it is submitted.**

Built for the **Novo Nordisk GBS Hackathon 2026**, Problem Statement #18.

---

## The problem

Novo Nordisk submits roughly **650 Clinical Trial Applications per year** under EU CTR. During validation, regulators raise Requests for Information (RFIs). Part I is assessed once by the Reporting Member State; Part II is assessed **separately by every Member State Concerned**. The same class of issue therefore arrives repeatedly, in different countries, to different teams — and because nothing is stored in a structured, reusable form, each one is solved from scratch.

Validation RFIs run on a hard clock. Missing it can invalidate the application across every Member State.

## What we built

| # | Feature | What it does |
|---|---|---|
| 1 | **Search** | Postgres full text plus an identifier branch for document references and trial numbers — the strings full text handles worst and the ones people actually paste. Returns precedent considerations and their approved responses. The vector arm was removed in ADR-039; docs/05 keeps what that cost. |
| 2 | **Clinical Report Check** | Upload a clinical document as a PDF before you file it. It sections itself on its own headings. A deterministic lint reads the wording for gaps the writer already admitted (*not attached*, *will be provided*, `XXX`); rules mined from the corpus by (Member State × section × submission type) say what this country actually asks; and cross-section checks catch a protocol version or subject count that disagrees between documents. Every flag carries the past request verbatim, the response that closed it, the artefact to produce and who to chase. Rules unseen for 12 months are greyed, not fired. No score — **62.4% recall at 1.8 themes surfaced per section**, time-travelled, with the uncomputable half named. |
| 3 | **Grounded draft generation** | RAG over approved, accepted precedent. Cites every claim, flags differences from precedent, and **refuses to draft when no sufficient precedent exists**. An independent verifier model scores every sentence for support. |
| 6 | **Suggestions** | Upload a request for information that just arrived, as a PDF. Precedent is retrieved from the same application section, and up to three options are proposed — *supply the document*, *justify what was filed*, *commit to a date* — each cited to the records it was built from, each with the reason not to pick it. Below the similarity threshold it refuses and escalates. Citations that name records outside the retrieved set are dropped, and an option left with none is discarded. |
| 4 | **Analytics** | Which sections and countries generate the most RFIs, recurrence patterns, clock analytics, and the preventable share. |
| 5 | **Audit trail** | Append-only, enforced by database trigger. Draft → review → approve → submit, scoped by team and by section. Approved responses feed back into the repository. |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 + shadcn/ui · Supabase Postgres + tsvector + pg_trgm + RLS (EU region) · Groq via AI SDK v7 · GitHub Actions CI

Deliberately host-agnostic — a plain Next.js application with no platform-specific runtime dependencies.

## Getting started

```bash
git clone <repo> && cd rfi-vault
npm install
cp .env.example .env.local        # fill in Supabase + Gemini keys
npm run db:migrate                # apply supabase/migrations
npm run seed                      # deterministic synthetic corpus (seed = 42)
npm run dev
```

Other commands:

```bash
npm run typecheck
npm run test        # vitest
npm run test:e2e    # playwright
npm run eval        # retrieval + groundedness metrics -> docs/metrics/latest.json
npm run eval:backtest  # pre-submission check recall, time-travelled
npm run build
```

## Data

**All data in this repository is synthetic.** It is generated deterministically from hand-written skeleton considerations grounded in the public structure of EU CTR / CTIS documents. No Novo Nordisk data, no patient data, no confidential material. `npm run seed` reproduces the exact corpus on any machine.

## Documentation

| Document | Contents |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Project operating manual, conventions, definition of done |
| [MEMORY.md](MEMORY.md) | Working knowledge log, mentor answers, open questions |
| [docs/00-PLAN.md](docs/00-PLAN.md) | Phase-by-phase delivery plan |
| [docs/01-DOMAIN.md](docs/01-DOMAIN.md) | EU CTR, CTIS, and the RFI category taxonomy |
| [docs/02-ARCHITECTURE.md](docs/02-ARCHITECTURE.md) | System design and request flows |
| [docs/03-DATA-MODEL.md](docs/03-DATA-MODEL.md) | Schema, SQL, and synthetic corpus design |
| [docs/04-AI-PIPELINE.md](docs/04-AI-PIPELINE.md) | Retrieval, the pre-submission check, RAG, verification |
| [docs/05-EVALUATION.md](docs/05-EVALUATION.md) | Metrics, ablations, and how we prove it works |
| [docs/06-DEMO-AND-DECK.md](docs/06-DEMO-AND-DECK.md) | Demo script, slide structure, report, Q&A |
| [docs/07-TEAM-AND-RISKS.md](docs/07-TEAM-AND-RISKS.md) | Roles, risk register, scope-cut order |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture decision record |

## Scope

**Delivered:** deployed authenticated application, database-enforced row-level authorisation, append-only audit trail, automated tests in CI, reproducible data and metrics, EU data residency, cost telemetry.

**Explicitly out of scope:** formal computerised-system validation, enterprise SSO, Veeva Vault RIM / SharePoint connectors, OCR for scanned documents, CTIS write integration (no public API exists).
