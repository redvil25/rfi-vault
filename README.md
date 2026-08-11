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
| 1 | **Hybrid search** | Semantic search for meaning plus keyword search for identifiers and regulation codes, fused with Reciprocal Rank Fusion. Returns precedent considerations, their approved responses, and a calibrated confidence score. |
| 2 | **Proactive risk scoring** | Upload a draft application before submitting. Each section is scored against a deterministic rule engine, similarity to historical RFI triggers, and historical base rates. Per-section bands, with the precedent and the response that resolved it. |
| 3 | **Grounded draft generation** | RAG over approved, accepted precedent. Cites every claim, flags differences from precedent, and **refuses to draft when no sufficient precedent exists**. An independent verifier model scores every sentence for support. |
| 4 | **Analytics** | Which sections and countries generate the most RFIs, recurrence patterns, clock analytics, and the preventable share. |
| 5 | **Audit trail** | Append-only, enforced by database trigger. Draft → review → approve → submit, scoped by team and by section. Approved responses feed back into the repository. |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 + shadcn/ui · Supabase Postgres + pgvector + RLS (EU region) · Google Gemini via AI SDK v7 · GitHub Actions CI

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
npm run eval        # retrieval + risk + groundedness metrics -> docs/metrics/latest.json
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
| [docs/04-AI-PIPELINE.md](docs/04-AI-PIPELINE.md) | Retrieval, risk scoring, RAG, verification |
| [docs/05-EVALUATION.md](docs/05-EVALUATION.md) | Metrics, ablations, and how we prove it works |
| [docs/06-DEMO-AND-DECK.md](docs/06-DEMO-AND-DECK.md) | Demo script, slide structure, report, Q&A |
| [docs/07-TEAM-AND-RISKS.md](docs/07-TEAM-AND-RISKS.md) | Roles, risk register, scope-cut order |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture decision record |

## Scope

**Delivered:** deployed authenticated application, database-enforced row-level authorisation, append-only audit trail, automated tests in CI, reproducible data and metrics, EU data residency, cost telemetry.

**Explicitly out of scope:** formal computerised-system validation, enterprise SSO, Veeva Vault RIM / SharePoint connectors, OCR for scanned documents, CTIS write integration (no public API exists).
