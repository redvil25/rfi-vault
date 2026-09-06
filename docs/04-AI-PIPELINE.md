# 04 — AI Pipeline

## 1. Models and roles

| Purpose | Model | Why |
|---|---|---|
| Embeddings | `gemini-embedding-001`, output dim 768 | Strong multilingual retrieval; 768 dims keeps the HNSW index fast and fits pgvector comfortably |
| Field extraction from PDFs | `gemini-2.5-flash` | Cheap, fast, reliable with structured output |
| Draft response generation | `gemini-2.5-flash` | Latency matters in a live demo; grounding does the heavy lifting, not model size |
| Groundedness verification | `gemini-2.5-pro` | A different, stronger model checking the first model's work is a genuinely defensible design |
| Reranking (optional) | `gemini-2.5-flash` | Listwise rerank of the top 20 |

**Fallback plan:** if Gemini quota is exhausted mid-demo, a local `transformers.js` embedding model (`bge-small-en-v1.5`, 384 dims) behind the same `embed()` interface keeps search alive, and cached draft responses for the scripted demo RFIs keep Feature 3 alive. Build the cache before demo day and mention the fallback in the Q&A — resilience planning scores under Feasibility.

Every call goes through `lib/ai/client.ts`, which logs to `ai_calls`. No direct SDK calls elsewhere in the codebase.

## 2. Feature 1 — Hybrid search

### 2.1 Why hybrid

Pure vector search fails on the strings that matter most in this domain: `CT-2024-519530-24-00-SM06-001`, POL numbers, `Annex 15`, `Article 5(3)`. Pure keyword search fails when an Affiliate in Poland describes in their own words a problem that an Italian colleague described differently eighteen months ago. The whole point of the repository is to connect those two people, so both retrieval modes are mandatory.

### 2.2 Fusion

Reciprocal Rank Fusion over the two ranked lists:

```
RRF(d) = Σ_over_retrievers  1 / (k + rank_r(d)),   k = 60
```

Rank-based, so no score normalisation is needed between cosine distance and `ts_rank_cd`. Implemented in SQL (`0008_hybrid_search.sql`) so filters, RLS, and fusion all execute in one round trip.

### 2.3 Confidence score shown to the user

Do not show a raw RRF score — it is meaningless to a regulatory user. Show a calibrated 0–100 **match confidence** derived from cosine similarity, banded with plain-language labels:

| Cosine similarity | Label | UI treatment |
|---|---|---|
| ≥ 0.82 | Strong precedent | Green, "reusable with minor edits" |
| 0.70 – 0.82 | Related precedent | Amber, "review differences" |
| 0.55 – 0.70 | Weak match | Grey, "background only" |
| < 0.55 | Not shown | — |

Calibrate the thresholds against the gold set rather than guessing, and state in the deck that they were calibrated. Each result also shows **why it matched** — semantic, keyword, or both — with the matched terms highlighted. That single explainability touch is what makes the feature feel trustworthy rather than magical.

### 2.4 Optional listwise rerank

For the top 20 fused results, one `gemini-2.5-flash` call scores relevance to the query and returns a reordering with a one-line justification per result. Adds roughly 600–900 ms. Measure the nDCG@10 gain in `npm run eval`; **keep it only if it wins on the numbers, and report the measured delta either way.** Reporting a rejected optimisation with its number is a stronger technical signal than silently shipping it.

## 3. Feature 2 — Clinical Report Check

A clinical document goes in as a PDF; what comes out is a list of flags, each traceable to a request a regulator actually raised. Renamed from "the pre-submission check" when the input became a document rather than eleven boxes of pasted text (ADR-038).

Retrieval, not prediction. The first version of this feature blended a hand-authored rule engine with a similarity term and a base rate and published a 0-100 score; it was withdrawn (ADR-033). The corpus holds only requests that *were* raised, so there is no negative class to fit against, no AUC to report and no false-positive rate to quote. A number without those is decoration.

What the corpus does support is a count, a date range, and the verbatim text behind both.

### 3.1 Signal (a) — absence and futurity, in the writer's own words

`lib/precheck/lint.ts`. Pure phrase matching, no model, no network.

The strongest deterministic predictor of a request for information is the writer admitting the gap themselves. *"The insurance certificate has not yet been returned and is not attached"* needs no inference — it is a sentence saying the dossier is incomplete, written by the person who knows it is.

Three families:

| Family | Examples | Severity |
|---|---|---|
| ABSENCE | not attached, missing, pending, awaiting, under negotiation, in preparation | Blocker |
| FUTURITY | will be provided, to be submitted, TBC, in due course, once available | Likely trigger |
| PLACEHOLDER | `XXX`, `[insert …]`, `{{field}}`, `______`, unresolved tracked changes, leftover review comments | Blocker |

Negation reaches its participle through a variable middle — "not attached", "not yet available", "will not be provided", "has not yet been returned" — so the absence family compiles through one shared prefix rather than an enumerated list. Overlapping matches resolve longest-first and report once: three findings for one clause is how a linter gets switched off.

Every pattern here describes the *writing*. None asserts a regulatory requirement, which is what keeps this file inside CLAUDE.md §8.

### 3.2 Signal (b) — rules mined from the corpus, never hand-authored

`mined_rules()` in `0025`, shaped in `lib/precheck/rules.ts`.

Group past considerations by (Member State × application section × submission type). A recurring theme becomes a rule carrying a count, a distinct-trial count, a date range, and the number of occurrences that were actually resolved.

A hand-written national-requirements matrix for fifteen Member States loses on three fronts, and mining wins each one:

- **Explainable by construction.** The rule *is* its evidence. "IT raised this 33 times across 26 trials, between Mar 2023 and Apr 2025" is a sentence a regulatory writer can check.
- **No authority claimed.** Nothing here states a national requirement this team has no standing to state.
- **It scales.** Every Member State in the corpus gets the same treatment, rather than the four that got the most attention.

Threshold is 3 occurrences. Deliberately low — the cost of a spurious flag is one glance, the cost of a missed one is a request for information with a hard clock on it — and the count travels with the flag so a reader can discount a thin rule themselves.

### 3.3 Date-scoping — the difference between a tool that gets opened and one that does not

Italy's fee rule applies to submissions from 17 February 2025. A rule mined from 2023 may describe a requirement that no longer exists.

So every rule carries `first_seen` and `last_seen`, and one unseen for **12 months** is greyed and never fires. It stays in the result as SKIPPED, with its age stated, because a writer who cannot see what did not run has to guess at coverage.

This is not hypothetical on our own corpus: `FEE_NATIONAL_UPDATE` for Italy is the largest cluster in the repository at 33 occurrences, and its last sighting is April 2025. The check refuses to fire the biggest rule it has, and says why. That is the demo.

### 3.4 Gating a mined rule on the document in front of the writer

`lib/precheck/topic.ts`.

A mined rule describes what a Member State asks about a section. On its own that says nothing about *this* document, and firing it unconditionally returned Italy's fee themes for any text at all — the word "health" included. The flag looked like a finding about the dossier and was not one.

Two gates stand between a mined rule and a flag. **Substance**: a section under 25 words is too thin to assess, and its rules are reported skipped with the word count rather than passed. **Topic**: a rule fires only when the text does not already address the theme, with the subject terms derived from the category's own label and `artefactKey`, so this adds no domain assertion of its own.

A fired flag then leads with what is absent — *"Nothing in this section mentions fee, proof, national, payment"* — which is a claim about the document. A held-back rule says which gate stopped it: **clear** when the text covers the theme, **skipped** when the text was too thin to judge. The two are different and a reader has to be able to tell them apart.

### 3.5 Scope, and saying how wide it went

The narrow scope — this Member State, this submission type — is the honest one, and on a corpus of any realistic size it is frequently empty. The backtest below puts a number on it: at the exact scope only 13 of 242 held-out requests had any live rule at all.

So the scope widens until it has something to say — dropping submission type, then Member State — and **the screen always states which scope produced the answer**. Widening in silence would be worse than not widening: "Italy asks this" and "somebody, somewhere, asks this" are different claims, and the reader has to be able to tell them apart.

### 3.6 Signal (c) — cross-section consistency

`lib/precheck/consistency.ts`. No corpus needed at all.

Values that appear twice in a dossier have to agree: protocol version and date, planned subject numbers, IMP name and strength, EU trial number. A mismatch between the cover letter and the protocol is a routine request for information and is deterministic to detect.

The discipline is in the negative case. A value found in only one section of the document is reported as **not checked**, never as consistent. A green tick for a comparison that never happened is the failure this whole feature exists to avoid (ADR-025) — and the same rule governs the mined rules and the lint, so every row in the rule list is flagged, clear or skipped, with a reason.

### 3.7 Signal (d) — what the document never mentions

`lib/ai/completeness.ts`, and the only pass here that calls a model.

The other three read the document for what it *says*: gaps the writer admitted, values it states twice, themes it mentions. None of them can see what a document simply never brings up, because absence has no phrase to match on.

That makes this the pass most able to invent, so it is bounded hardest. The model is given the document's sections and the past requests already retrieved for them, and may report something missing **only** when one of those requests asked for it. It is told plainly that it is not judging whether this is a good clinical report and has no standing to say what one must contain — it is deciding which of *these specific past questions* the document would not answer. Every finding cites the record ids that asked, and a finding whose citations do not resolve to a retrieved record is dropped, exactly as in Features 3 and 6.

`openQuestions` is deliberately narrow: material the document *points at* but did not supply, or an extraction that visibly broke. It is for evidence you cannot see, not for evidence that is not there. Left broader, the model routed every finding into it, and a report containing nothing would have read as merely unclear.

This pass needs a generation key. Without one it does not run, and the screen says so rather than letting three passes read as four.

### 3.8 Reading the PDF, and not keeping it

`lib/docs/analyse-upload.ts`.

The browser uploads to Storage on a one-shot signed URL, so the bytes never cross the application server — hosts cap request bodies at 4.5 MB and a real clinical report exceeds that. The server then reads the object's text and **deletes it in a `finally`**, whether the read succeeded or not.

Ingestion keeps what it uploads, because a filed RFI export is a record and the stored PDF is its source. This is the opposite: a document handed over to be checked, which this repository has no business keeping a copy of. What survives a run is the audit event saying a check happened.

Format is decided by magic bytes, never by the content type sent with the upload, which is client-supplied. A PDF with no text layer is refused rather than checked — there is no OCR here, and an empty extraction would produce a confident report that the document contains nothing.

### 3.9 Sectioning on the document's own headings

`lib/precheck/split.ts`. A writer has a document, not eleven boxes, and eleven boxes is the reason a screen like this goes unused.

Split on the headings the document already carries, normalising numbering and common aliases (`ICF`, `IB`, `QP declaration`). A heading that maps onto nothing in the taxonomy — and any preamble before the first heading — is **listed to the user and left out of the check**, never filed under the nearest-looking section. Guessing there would check the cover letter against the protocol's rules, which is worse than checking nothing.

### 3.10 The snapshot

Every run writes one `PRECHECK_RUN` audit event carrying the shape of the check and its verdict, and the screen offers a timestamped JSON snapshot: scope used, rule versions (lint pattern count, staleness window, recurrence threshold), every rule with its outcome, every flag with its precedent record IDs, and the audit event id so the claim can be checked against the append-only trail rather than taken on the file's own word.

Neither the event nor the snapshot contains the document text. It is the sponsor's, and it has no business in an append-only table the whole team can read.

### 3.11 Precedent, and turning a flag into a fix

`rule_precedents()` returns the request as the regulator wrote it, the date, the trial, and the sponsor response that closed it — filtered to APPROVED/SUBMITTED and ACCEPTED, because a rejected answer is not precedent. Matching is exact on (category, section, Member State): no embeddings, so it works with no model configured and is explainable in one sentence.

Each flag then carries three things, and none of them is generated text:

1. **The missing artefact** — `artefactKey` from the taxonomy. "POL payment receipt, ISTAT-updated amount".
2. **Suggested wording** — lifted verbatim from an accepted past response, with the record it came from, behind a copy-to-clipboard button. Nobody pastes unverified generated text into a CTIS dossier; a suggestion that cannot be traced is worth less than no suggestion at all.
3. **The owner** — `owner` from the taxonomy. Writers rarely control the missing document. They control who they chase for it.

### 3.12 What the screen shows

Flags are the hero. The headline is **"2 blockers, 3 likely triggers"**, never a score. Underneath, every mined rule is listed as flagged / clear / skipped with its reason, so coverage is visible rather than assumed — and the coverage panel states the corpus date range, that every record is synthetic, and which requested Member States have no precedent at all. For those, a clean result means *no data*, which is a different thing from *no risk* and the more dangerous of the two.

### 3.13 What it measures — and the half that cannot be measured

`npm run eval:backtest`. Each held-out request is scored against the corpus **as it stood the day before that request was issued**, with the same staleness window the product applies, through the same scope ladder. Scoring against the whole corpus would let the check learn from the request it is being tested on.

```
Held out               242 requests issued on or after 2025-09-01

Recall overall         62.4%  (151/242)
  at exact scope       15.4%  (2/13 checks)
  after widening       77.2%  (149/193 checks)
  no live rule at all  36 checks — the check says so rather than passing
Themes surfaced        1.8 per section checked
```

**This is an upper bound.** The shipped check also gates each mined rule on the dossier text — see §3.4 — and history holds no dossier text to replay that against. Gating only lowers recall.

**Never quote the recall on its own.** A check that flagged every theme would score 100%; "themes surfaced" is what that recall cost, and the two belong in the same sentence.

**The false-positive rate is not computable and must not be estimated.** The repository holds only requests that *were* raised; sections submitted that drew no request were never recorded, so there is no negative class. Making that half computable is a data-collection change in a real deployment — record every section checked and whether a request followed — not a modelling one.

## 4. Feature 3 — Grounded draft generation

### 4.1 Retrieval

Top-k (k = 6) via hybrid search, filtered to the same section, preferring the same Member State, and preferring `response_status = APPROVED` with `outcome = ACCEPTED`. Only responses that actually satisfied a regulator are used as precedent — a rejected answer is not precedent, and saying so demonstrates you thought about it.

### 4.2 The confidence gate — demo this

```ts
if (maxSimilarity < 0.62) {
  return {
    refused: true,
    reason: 'No sufficiently similar precedent found in the repository.',
    nearest: top3,
    escalateTo: routeBySection(section),
  };
}
```

The system declines rather than inventing. In a pharma context this is not a limitation, it is the feature. Script it into the demo.

### 4.3 Prompt structure

System prompt, held in `lib/ai/prompts/draft.ts`:

```
You draft sponsor responses to EU CTR requests for information.

Rules, in order of priority:
1. Use ONLY the provided precedent records. Never introduce a regulatory fact,
   article number, fee amount, date, or document name that is not in them.
2. Cite the consideration_id supporting each factual claim.
3. If the current RFI differs from a precedent in any material way — Member State,
   fee amount, document version, submission type, date — record it in `deltas`
   rather than silently generalising.
4. Match the register of the approved responses: short, factual, declarative.
   Do not add explanation the regulator did not ask for.
5. If the precedents do not support a complete answer, say so in `open_questions`
   and lower your confidence. An incomplete honest draft beats a complete invented one.
6. Output is a DRAFT for human review. Never phrase it as final or approved.
```

User message contains the current RFI, the retrieved precedents with IDs, similarity scores, Member State, outcome, and the trial metadata.

### 4.4 Structured output

```ts
const DraftSchema = z.object({
  draft: z.string(),
  citations: z.array(z.object({
    considerationId: z.string(),
    supportsClaim: z.string(),
  })).min(1),
  deltas: z.array(z.object({
    dimension: z.enum(['MEMBER_STATE','FEE_AMOUNT','DOCUMENT_VERSION','DATE','SUBMISSION_TYPE','SCOPE','OTHER']),
    precedentValue: z.string(),
    currentValue: z.string(),
    reviewerAction: z.string(),
  })),
  attachmentsRequired: z.array(z.string()),
  openQuestions: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
```

`generateObject` from the AI SDK, never free-text JSON parsing. `attachmentsRequired` reflects a real insight from the source example: the answer is usually "we attached the proof" — knowing *which attachment* is the actual work product.

### 4.5 Verifier pass

A second call to `gemini-2.5-pro` receives the draft plus the retrieved precedents and returns, per sentence, whether it is supported, partially supported, or unsupported.

```
groundedness = supported_sentences / total_sentences
```

Render unsupported sentences with an amber underline and a "no precedent supports this" tooltip. Publish the corpus-level average groundedness on a slide. **A model that grades its own output and surfaces its failures is the single most credible thing you can show a pharma audience.**

### 4.6 Feedback loop

On approval, the response is written back with `response_status = APPROVED`, re-embedded, and becomes precedent for the next query. Show this live: approve a draft, then run a search that returns it. That closes the loop the solution overview promises and makes "the system gets smarter over time" a demonstrated claim rather than a bullet point.

## 5. Feature 6 — Suggestions: three grounded options for a request that just arrived

Feature 3 answers a consideration that is **already filed**, inside the status machine, and produces one draft to be reviewed and approved. This answers one that just landed in somebody's inbox and is not in the repository yet, and produces **options** rather than an answer. Nothing is written to `rfi_consideration`: the request is a paste, not a record, so there is no status to move and nothing to approve.

### 5.1 Reading the paste

`lib/suggest/parse.ts`, all deterministic, and everything it cannot determine comes back null.

- **Member State** from the CTIS prefix (`IT - …`) or an exact country name in the text. An unknown two-letter prefix is not a Member State.
- **Category** from `classifyConsideration` — the same classifier ingestion uses, so a suggestion and a filed consideration cannot disagree about what a request is about (ADR-024).
- **Section** from the user's choice, always. It only falls back to the taxonomy when the user left it blank *and* the category maps to exactly one section. Retrieval is filtered by section, so a wrong section returns precedent from the wrong part of the dossier and the writer has no way to see it happened — **the run refuses rather than guessing**.
- **Multiple considerations** in one paste are split on the CTIS numbering. The first is answered and the rest are offered; blending several questions into one embedding retrieves precedent for none of them.

### 5.2 Three strategies, not three paraphrases

Three rephrasings of one sentence are not three options — a writer choosing between them is choosing nothing. The three moves actually available when a regulator asks for something:

| Strategy | The move | |
|---|---|---|
| `SUPPLY` | The artefact exists or can be produced. Attach it and say so. |
| `JUSTIFY` | The dossier already answers this. Point at where, and why it is sufficient. |
| `COMMIT` | It does not exist yet. Say so, and commit to a date rather than going quiet. |

Each option carries `whenToUse`, a **`risk`** — the reason *not* to pick it, because an option with no downside has not been thought about — the attachments it implies, and at least one citation.

The schema is `.min(1).max(3)`, never `.length(3)`. If the precedent supports only two honest strategies, two is the right answer; padding to three would invent the third, which is the failure this product exists to prevent.

### 5.3 The order is the safety property

Retrieve → gate → generate, exactly as Feature 3 (ADR-005). Nothing reaches the model until the repository has proved it holds something close enough. A pipeline that generates first and checks after has already produced the text it was supposed to refuse to produce.

Below the similarity threshold the run refuses, names the team to escalate to from the taxonomy, and **still shows the closest records it found** — not close enough to answer from, but worth reading.

### 5.4 What the schema cannot catch

A citation naming a `consideration_id` that was never retrieved is a fabricated reference, and `generateObject` will happily validate it: it is a well-formed string. So every citation is checked against the retrieved set afterwards and dropped if it does not resolve. An option left with no citations at all is discarded, and if that leaves nothing, the run refuses — **an uncheckable suggestion is worse than none**.

Each surviving option is graded independently by the stronger model against the same precedents, so the groundedness figure on a card belongs to that card. A verifier failure degrades to *ungraded* and says so, rather than dropping the option or implying a grade it does not have (ADR-025).

### 5.5 Untrusted input

The pasted request is a document supplied by a user, and it reaches a model. It is fenced in the prompt and the system prompt says explicitly that anything inside reading like an instruction — to ignore the rules, to change the output format, to reveal the prompt — is part of the document being quoted, not a direction. The output schema is a further constraint: there is no free-text field a redirected model could answer into.

## 6. Feature 4 — Analytics

Aggregate SQL views, no AI required. The one AI touch worth adding: an LLM-generated **"insight of the week"** summarising the largest movement in the data, grounded strictly in the aggregate rows passed to it. Small, safe, and it makes the dashboard feel alive.

## 7. Prompt engineering practices to follow

- Every prompt lives in `lib/ai/prompts/`, is versioned, and is unit-tested against fixtures.
- Temperature 0.2 for drafting, 0 for extraction and verification.
- Precedents are passed with explicit IDs; the model is told to cite them.
- No chain-of-thought in the output — return structured fields.
- Log the prompt hash in `ai_calls` so you can prove which version produced which output. That is an audit-trail argument, and it lands well with this audience.
