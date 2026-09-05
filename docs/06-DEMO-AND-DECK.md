# 06 — Demo, Deck, and Report

## 1. The story — decide this before making a single slide

Everything in the pitch serves one sentence:

> **Novo Nordisk answers the same regulatory question over and over, in different countries, by different teams, from scratch every time — because nobody wrote down what worked. We built the memory. Then we made it answer in its own words, with a citation for every claim — and stay silent when it has nothing to stand on.**

Two beats. **Memory** is the ask in the problem statement. **Refusal** is the part nobody else will build. Open with the first and land on the second.

## 2. Slide structure (12–14 slides, ~10 minutes)

Confirm the actual time limit and adapt; the ordering holds either way.

**1 — Title.** Product name, team, college, problem statement #18. Clean.

**2 — The moment.** One real RFI on screen: the ISTAT fee consideration from the supplied example. Read the sponsor response out loud: *"Proof of payment of the additional amount required is provided."* Then say: **"One sentence. It took four people and eleven days to arrive at it. And an Affiliate in Spain solved the same class of problem last March — nobody knew."** This is the hook. Do not open with architecture.

**3 — The scale.** 650 applications a year. Part I assessed once, Part II assessed separately by *every* Member State. The same class of issue arrives in ten countries in ten formats. Nothing is stored in a reusable way. Show the duplication visually — one issue, ten arrows.

**4 — The stake.** A validation RFI has a hard clock. Miss it and the application lapses **in every Member State Concerned** and restarts. This is not a filing inconvenience; it is a trial-timeline risk. *(Verify the exact mechanism with the mentor before saying it.)*

**5 — What we built.** One diagram, four features, ten seconds each. Do not linger — the demo does the explaining.

**6–9 — Live demo.** See §3 below. This is the centre of gravity; give it half your time.

**10 — Why it is trustworthy.** The refusal path, the citations, the verifier pass, the append-only audit trail, EU data residency, RBAC by the four named teams. Frame it as **"validation-ready, not validated"** — architecture supports a GxP deployment; formal computerised-system validation is the next step in a real rollout. Saying that honestly is more persuasive than claiming compliance.

**11 — The numbers.** The metrics slide from `docs/05-EVALUATION.md` §5, including the ablation table. This is where Technical Implementation is won.

**12 — The business case.** The model from `docs/01-DOMAIN.md` §8, presented as a range with visible assumptions. Then the second-order value: lapse avoidance, first-time-right rate, onboarding, organisational learning. **Show the assumptions.** A judge who can see your assumptions trusts your conclusion; one who cannot, does not.

**13 — Feasibility and adoption.** What exists today (deployed, tested, measured). What a real rollout needs: SSO, Veeva Vault RIM or SharePoint connector, CTIS-structured export, human validation of the taxonomy, formal CSV. A 90-day rollout sketch. Naming what is *not* done is a feasibility argument, not a weakness.

**14 — Close.** Return to the one sentence. End on the refusal beat: *"Every other tool answers faster. This one knows when it must not answer at all."*

## 3. The demo script — 5 minutes, rehearsed word for word

Order matters. Each beat sets up the next.

**Beat 1 — The recurrence (60 s).** Sign in as an Affiliate. Search *"payment evidence for updated national tariff Italy"*. Results return the ISTAT cluster. Point at the confidence bands and at "matched semantically — your words, not theirs." Then open the recurrence panel: **"This same issue has come back eleven times across nine trials. Every one of those was solved from scratch."**

**Beat 2 — The keyword case (30 s).** Search `CT-2024-519530-24-00-SM06-001`. Exact document found instantly. **"Embeddings alone cannot do this. That is why our search is hybrid — and we measured the difference."** Forward-reference the metrics slide.

**Beat 3 — Grounded drafting (90 s) — the centrepiece.** An RFI arrives. Generate. The draft streams in with inline citations. Open the deltas panel: *"Precedent was Italy 2025 at €X; this is Italy 2026 — verify the current amount."* Point at the groundedness badge.

**Beat 4 — The refusal (60 s) — the moment that wins the room.** Paste the planted no-precedent RFI. The system declines: *"No sufficiently similar precedent. Escalating to RA Clinical."* Say: **"Every demo you will see today shows an AI confidently answering. This one shows it refusing. In regulatory affairs, that is the feature."**

**Beat 5 — The loop (30 s).** Approve a response. Show the audit event with actor, role, timestamp. Search again — the approved response is now precedent. **"Every answer makes the next one faster. That is the compounding value of the repository."**

**Beat 6 — Analytics (30 s).** The dashboard. Point at the ISTAT spike: *"A national fee changed in February 2025. It cost us N RFIs across M trials over eight weeks. After the first one, the answer was already in here."* Then the preventability split: what share of RFIs are Tier 1 and Tier 2 administrative and therefore avoidable.

### Demo rules
- **Two accounts, pre-signed-in, in two browser windows.** Never log in live.
- **Pristine seeded database.** Reseed the morning of.
- **Recorded backup video ready to play** if anything fails. Do not debug on stage — switch to the video and keep talking.
- **Rehearse the exact click path five times.** Muscle memory, not improvisation.
- **Zoom the browser to 125%.** Judges are watching a compressed Teams screen share.
- **Narrate the user, not the software.** "Maria in the Spanish affiliate opens this and…" — never "here we call the hybrid search endpoint".

## 4. The 2-page report

Two pages is a hard limit. Structure:

**Page 1**
- *Problem* (3–4 sentences) — duplicated effort across 650 applications, no reusable store, the clock risk.
- *Approach* (1 paragraph + the architecture diagram) — three-layer storage, hybrid retrieval, grounded generation with a refusal path, append-only audit.
- *Technologies* (compact table) — with one-line justifications, not just names.

**Page 2**
- *Results* — the metrics table. Numbers, held-out split, reproducible.
- *Impact* — the business model with visible assumptions and second-order benefits.
- *Feasibility and next steps* — what exists, what a real rollout needs, the 90-day sketch.
- *Limitations* — synthetic corpus, no OCR, no CTIS write API, not formally validated. **Include this section.** Judges trust a team that names its own limitations; it also inoculates you against those exact questions.
- *References* — Regulation (EU) No 536/2014, EMA CTIS Sponsor Handbook, EMA CTIS training materials.

Write it in plain professional English. No marketing adjectives. This audience writes regulatory documents for a living and will find inflated language grating.

## 5. Q&A — prepare these answers in writing

| Question | Answer |
|---|---|
| *How do you stop hallucination?* | Three layers: retrieval only from approved, accepted responses; a similarity gate that refuses below threshold; a separate verifier model that scores every sentence for support and flags the unsupported ones in the UI. Measured groundedness is on the metrics slide. |
| *Why not just use SharePoint search?* | Keyword search cannot connect a Polish colleague's phrasing to an Italian colleague's document, and it returns files rather than the approved sentence that resolved the question. Our ablation table shows keyword-only Recall@5 on paraphrased queries. |
| *Why not a dedicated vector database?* | Every real query is filtered — by section, Member State, date, status, and access rights. In Postgres that is one statement with RLS applied. A separate vector store means joining across systems and reimplementing authorisation. pgvector with HNSW meets our latency target on this corpus, and the migration path if it stops meeting it is well understood. |
| *This is synthetic data — would it work on real data?* | The architecture is data-agnostic; the corpus reproduces the distributions the mentor described. Real deployment starts by ingesting the historical CTIS RFI archive, which already exists in exportable form. We would re-run the same eval harness on real data before trusting any threshold. |
| *Who maintains the taxonomy?* | It is a database table, editable by CTA Management, not code. New categories can also be proposed by clustering unclassified considerations. We would recommend a quarterly review owned by the EU Submission Hub. |
| *What about GxP validation?* | The architecture is validation-ready — append-only audit trail, e-signature-style approval workflow, full traceability of which prompt version produced which output, EU data residency. Formal computerised-system validation is a deployment activity, and we scoped it out deliberately rather than claiming it. |
| *What if the model is unavailable?* | Keyword search keeps working with no model at all, and semantic search degrades to a local embedding model. Drafting refuses rather than degrading — which is the same behaviour as low precedent. We built the fallback and can show it. |
| *How much does it cost to run?* | Measured, from our `ai_calls` telemetry: roughly $X per search and $Y per generated draft. Extrapolated to 650 applications a year, that is $Z. |
| *What is the hardest part of adoption?* | Not the technology — trust and workflow fit. That is why the system refuses rather than guesses, why every answer is cited, and why nothing is ever auto-submitted. We asked our mentor exactly this question in week three; their answer is on slide 13. |

## 6. Presentation mechanics

- One person owns the narrative; one owns the demo. Two voices maximum in the main pitch — more fragments the story.
- Every team member should be able to answer questions on their own area. Judges often ask the quiet ones.
- Dress as if presenting to a client.
- Test screen share, audio, and the actual laptop in the actual Teams meeting the day before.
- Have the deck as PDF locally, not only in the cloud.
- If you run over time, cut the analytics beat — never the refusal beat.
