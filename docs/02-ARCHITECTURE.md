# 02 — System Architecture

## 1. Design principles

1. **Precedent engine, not a chatbot.** The retrieval layer is the product. The LLM is a presentation layer on top of retrieved precedent. If the LLM were removed, the system would still be useful — that is the test of a sound architecture here, and it is what makes the solution credible to a regulatory audience.
2. **Everything is explainable.** No score, ranking, or draft is shown without the evidence that produced it. A regulatory user must be able to answer "why did it say that?" in one click.
3. **Deterministic where possible, probabilistic only where necessary.** Rule checks (is the fee proof attached? is the ICF in the local language?) are deterministic code. Similarity and drafting are probabilistic. Keep them in separate modules so the deterministic layer keeps working when the model is unavailable — and so you can *say* that on stage.
4. **Boring, provable infrastructure.** Postgres does the search. No separate vector database, no orchestration framework. Fewer moving parts means the demo does not break, and "we did it in Postgres" is a stronger feasibility story than "we wired up five services".

## 2. High-level diagram

```
                         ┌──────────────────────────────────────┐
   Browser (Next.js)     │  Search  ·  Report  ·  RFI Detail     │
   RSC + shadcn/ui       │  Analytics  ·  Audit                  │
                         └──────────────┬───────────────────────┘
                                        │  typed server actions
                         ┌──────────────▼───────────────────────┐
                         │   Application layer (Next.js, Node 24)│
                         │   host-agnostic — see ADR-011         │
                         │                                       │
   ┌─────────────────────┤  server actions, one per screen       │
   │                     │  no route handlers — see ADR-030      │
   │                     └───┬───────────────┬──────────────┬────┘
   │                         │               │              │
   │  lib/ai                 │ lib/search    │ lib/precheck │ lib/audit
   │  ├ extract()            │ ├ ftsTopK     │ ├ lint()     │ └ emit()
   │  ├ draftResponse()      │ ├ identTopK   │ ├ mine()     │
   │  ├ suggest()            │ └ lexical()   │ └ precedent()│
   │  └ verifyGrounding()    │               │              │
   │                         │               │              │
   ▼                         ▼               ▼              ▼
┌────────────────┐   ┌──────────────────────────────────────────┐
│ Groq / Gemini  │   │  Supabase (eu-central-1)                 │
│ gpt-oss-120b   │   │  Postgres 15 + tsvector + pg_trgm        │
│ qwen3.8-27b    │   │  Auth · RLS · Storage (private bucket)   │
│ (no embedder)  │   │  SQL fn: search, lexical_precedents      │
└────────────────┘   └──────────────────────────────────────────┘
```

## 3. The three-layer storage model (Feature 1's foundation)

The solution overview promises that every RFI is stored in three layers. This is the implementation:

| Layer | Where | Purpose | UI affordance |
|---|---|---|---|
| **Original document** | Supabase Storage, private bucket, signed URLs | Provenance, auditability, "show me the source" | Open original PDF at the exact page |
| **Structured fields** | Postgres columns on `rfi_consideration` | Filtering, faceting, analytics, RLS | Filter by section / country / category / date |
| **Meaning** | `vector(768)` column with an HNSW index | Semantic recall | Search by intent, not keywords |

All three are queryable together in a single SQL statement. That is the reason for choosing Postgres: a filtered hybrid search ("semantic match, but only Part II, only Italy, only approved responses, only last 18 months") is one query — not an application-layer join across a vector store and a relational store. **Make this point when a judge asks why not Pinecone.**

## 4. Request flows

### 4.1 Ingestion

```
Upload PDF/DOCX
  → parse text (unpdf) + keep page offsets
  → LLM structured extraction (generateObject + Zod) → considerations[]
  → deterministic post-validation (IDs match regex, dates parse, MS code valid)
  → human-in-the-loop review screen for low-confidence extractions
  → insert rfi_document + rfi_consideration rows
  → embed consideration_text and sponsor_response_text separately
  → generate tsvector
  → emit audit event INGESTED
```

Two details worth defending in the demo:
- **The extraction step has a review screen.** Auto-extraction with a confidence gate and a human approval step is exactly how a regulated organisation would deploy this. Showing that screen is worth more than showing a higher extraction accuracy.

### 4.2 Search (Feature 1)

```
query
  ├─ websearch_to_tsquery ──► GIN tsvector          (stemmed words)
  └─ ILIKE on document_ref / eu_trial_number        (the strings FTS mangles)
                                     │
                            filters applied in SQL (section, MS, date, status, RLS)
                                     │
                            results + matched-on explanation
```

Identifier matching is not decoration. Regulation codes, POL numbers, trial IDs and document references (`CT-2024-519530-24-00-SM06-001`) are exactly the strings full text handles worst, and they are 25 of the 41 gold queries.

There is no vector arm. It was removed in ADR-039 and the ablation table in `docs/05-EVALUATION.md` keeps what that cost: Recall@5 0.795 → 0.634 overall, paraphrase 0.680 → 0.000, identifiers 0.944 → 1.000.

### 4.3 Clinical Report Check (Feature 2)### 4.3 Clinical Report Check (Feature 2)

```
Paste one or more application sections, with the Member States and submission type
  → LINT the text for absence, futurity and placeholders (deterministic, no model)
  → MINE the corpus by (Member State × section × submission type)
       each recurring theme carries hits, distinct trials, first_seen, last_seen
  → DATE-SCOPE: a theme unseen for 12 months is greyed, reported SKIPPED, never fired
  → ATTACH the verbatim past request and the accepted response that closed it
  → render flags, sorted by severity, each with artefact + owner + copyable wording
```

The output is **a list of flags, never a score**. "2 blockers, 3 likely triggers" is actionable; a 0-100 number implies a calibration this corpus cannot support (ADR-033). Every rule that ran — and every rule that did not — is listed with its reason, so a writer reads coverage instead of assuming it.

### 4.4 Draft response generation (Feature 3)

```
RFI arrives (ingested or pasted)
  → hybrid retrieve top-k precedent (same section, prefer same MS, prefer APPROVED + ACCEPTED)
  → confidence gate:  max_similarity < τ  →  REFUSE, escalate, explain why
  → generateObject(gemini-2.5-flash) with strict grounding prompt
       returns { draft, citations[], deltas[], confidence, open_questions[] }
  → delta detection: what differs between this RFI and each precedent
       (member state, fee amount, document version, date, trial phase)
  → verifier pass (gemini-2.5-pro): every factual claim must map to a cited chunk
       → groundedness score; unsupported sentences highlighted in the UI
  → present as a DRAFT requiring human approval — never auto-submit
  → on approval: response is written back into the repository and re-embedded
```

The refusal path and the verifier pass are the features that win the room. Demo the refusal deliberately: type an RFI with no precedent and show the system decline to answer. **Every other team will demo a confident answer. Demoing a confident "I don't know" is the differentiator.**

### 4.5 Analytics (Feature 4) and Audit (Feature 5)

Analytics is a set of SQL aggregate views over `rfi_consideration` and `audit_events`, rendered with Recharts:
- RFI volume by section, by category, by Member State, over time
- Recurrence: which categories repeat, and how many *distinct trials* each has affected
- Clock analytics: issued → responded turnaround, distance to deadline
- Preventability view: share of RFIs in Tier 1 + Tier 2 categories
- Estimated effort avoided, driven by the assumption model in `docs/01-DOMAIN.md` §8, with the assumptions exposed as adjustable inputs in the UI

Audit is an append-only `audit_events` table with an `UPDATE`/`DELETE`-blocking trigger, plus a workflow state machine:

```
DRAFT ──submit for review──► IN_REVIEW ──approve──► APPROVED ──submit to CTIS──► SUBMITTED
   ▲                              │
   └──────── request changes ─────┘
```

Every transition records actor, role, timestamp, and reason. The viewer filters by section and by team, matching the RBAC model in `docs/01-DOMAIN.md` §7.

## 5. Security and access control

- **Authentication:** Supabase Auth. Demo accounts, one per role.
- **Authorisation:** Postgres Row Level Security, not application-layer checks. Policies keyed on `auth.uid()` → `user_profile.team` and `user_profile.member_state`.
- **Visibility model:** approved, submitted responses are shared organisation-wide (that is the entire point of the repository); drafts and in-review items are visible only to the owning team. Affiliates additionally see their own Member State's national context.
- **Storage:** private bucket, time-limited signed URLs, never public paths.
- **Audit immutability:** enforced by trigger.
- **Secrets:** environment variables only; GitHub repository secrets for CI; `.env.example` committed, `.env.local` never.
- **Input validation:** Zod at every route boundary; file type and size checks on upload; rate limiting on the AI endpoints.

State this in the deck as **"validation-ready, not validated"** — the architecture supports GxP deployment (ALCOA+ data integrity, EU Annex 11 style audit trail and e-signature workflow), and formal computerised-system validation would be the next step in a real rollout. Naming that distinction honestly is more impressive than claiming compliance.

## 6. Performance and cost targets

| Metric | Target |
|---|---|
| Search p50 / p95 | < 400 ms / < 900 ms |
| Draft generation p95 | < 8 s, streamed so first token appears < 1.5 s |
| Cost per search | < $0.001 |
| Cost per draft | < $0.01 |
| Corpus size at demo | 800–1,200 considerations |

Log every AI call into the `ai_calls` table and put the real measured cost on a slide. "This runs at roughly X cents per RFI answered" is a Business Impact and Feasibility point that almost no student team will have.

## 7. Deliberate non-goals

Say these out loud in the Q&A. Naming your scope boundaries reads as engineering maturity, not as a gap.

- No direct CTIS integration — no public write API exists; we export in a CTIS-compatible structure instead.
- Ingestion reads the text layer of a CTIS PDF export. Scans, photographs and screenshots are refused with an explanation rather than guessed at (ADR-021). OCR or a vision model is the upgrade, behind the same `extractDocument()` interface.
- No multi-language UI — the corpus contains local-language artefacts, but the interface is English.
- No formal computerised-system validation — architecture is validation-ready; qualification is a real-deployment activity.
- No production SSO — Supabase Auth stands in for what would be Entra ID / SAML in the enterprise.
