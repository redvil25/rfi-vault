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

## 3. Feature 2 — Proactive risk scoring

The highest-value feature and the biggest differentiator. Every other team will build retrieval; this one predicts.

### 3.1 Three independent signals

**(a) Rule engine — deterministic, `lib/risk/rules.ts`**

A checklist per `(section × member_state × submission_type)`, derived from the taxonomy in `docs/01-DOMAIN.md`. Examples:

```ts
{ id: 'IT_FEE_PROOF',        applies: { ms: 'IT' },
  check: s => s.artefacts.fee_proof === true,
  weight: 0.9,
  message: 'Italy requires proof of payment including the ISTAT-updated amount for submissions from 17 Feb 2025.' },

{ id: 'ICF_LOCAL_LANGUAGE',  applies: { section: 'ICF' },
  check: s => s.artefacts.local_language_versions?.length > 0,
  weight: 0.85,
  message: 'No local-language ICF detected for the selected Member States.' },

{ id: 'PROTOCOL_VERSION_CONSISTENCY', applies: { part: 'PART_I' },
  check: s => versionsAgree(s.content),
  weight: 0.7,
  message: 'Protocol version referenced in the cover letter does not match the uploaded protocol.' },
```

Deterministic, explainable, testable, and functional with zero historical data. This is what makes the feature *feasible* — it does not depend on the model being right.

**(b) Similarity to historical RFI triggers**

Embed the draft section, retrieve the nearest historical sections that *did* trigger an RFI, filtered to the same section type and Member State. Use `mean(top 3 cosine)` rather than `max` — max is noisy on a corpus this size.

**(c) Historical base rate**

```sql
select count(*) filter (where triggered_rfi) :: numeric / nullif(count(*),0)
from historical_sections
where section = $1 and member_state = $2 and submission_type = $3;
```

Apply Laplace smoothing for thin slices: `(hits + 1) / (total + 2)`.

### 3.2 Blending

```
raw   = w_r · ruleScore + w_s · similarityScore + w_b · baseRate
score = 100 · sigmoid(a · (raw − b))
```

Start at `w_r = 0.5, w_s = 0.3, w_b = 0.2` — the rule engine leads deliberately, because a deterministic finding is more trustworthy and more actionable than a similarity number. Then fit `a` and `b` on the training split and **report the fitted values and the AUC**. Bands: `< 33 LOW`, `33–66 MEDIUM`, `> 66 HIGH`, with thresholds chosen from the precision/recall curve rather than picked round.

### 3.3 Output contract

Per section, never one global score:

```json
{
  "section": "IMPD Quality",
  "score": 78,
  "band": "HIGH",
  "topDrivers": [
    { "type": "RULE",       "id": "GMP_QP_DECLARATION", "contribution": 0.42,
      "message": "No QP declaration detected covering the stated manufacturing site." },
    { "type": "SIMILARITY", "contribution": 0.24,
      "message": "Closely resembles 3 past sections that received IMPD Quality RFIs." },
    { "type": "BASE_RATE",  "contribution": 0.12,
      "message": "IMPD Quality triggers an RFI in 22% of substantial modifications." }
  ],
  "precedents": [
    { "considerationId": "…", "similarity": 0.86,
      "consideration": "…", "approvedResponse": "…", "memberState": "DE" }
  ],
  "recommendedAction": "Attach the QP declaration for site X before submission."
}
```

**`recommendedAction` is the field that converts a score into work.** A regulatory user does not want a number; they want to know what to do before lunch.

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

## 5. Feature 4 — Analytics

Aggregate SQL views, no AI required. The one AI touch worth adding: an LLM-generated **"insight of the week"** summarising the largest movement in the data, grounded strictly in the aggregate rows passed to it. Small, safe, and it makes the dashboard feel alive.

## 6. Prompt engineering practices to follow

- Every prompt lives in `lib/ai/prompts/`, is versioned, and is unit-tested against fixtures.
- Temperature 0.2 for drafting, 0 for extraction and verification.
- Precedents are passed with explicit IDs; the model is told to cite them.
- No chain-of-thought in the output — return structured fields.
- Log the prompt hash in `ai_calls` so you can prove which version produced which output. That is an audit-trail argument, and it lands well with this audience.
