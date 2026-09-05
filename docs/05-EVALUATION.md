# 05 — Evaluation: How We Prove It Works

> This document is worth more hackathon points per hour invested than any other. Almost every student team demos a feature. Very few show an **ablation table with numbers on a held-out set**. Technical Implementation is 25% of the score, and this is the cheapest way to win it.

## 1. The harness

```
scripts/eval/
  gold-retrieval.json    50 queries × human-marked relevant consideration IDs
  gold-groundedness.json 30 RFIs for draft evaluation with precedent sets
  backtest.ts            pre-submission check recall, time-travelled at the issue date
  run.ts                 executes all suites → docs/metrics/latest.json + markdown table
```

`npm run eval` runs everything, writes `docs/metrics/latest.json`, and prints a markdown table you paste straight into the deck. Run it in CI on every push so a regression is caught the same day. Commit each run's output so you have a trend line — **showing improvement over four weeks is itself a slide.**

## 2. Suite A — Retrieval quality (the headline table)

**Metrics:** Recall@5, MRR@10, nDCG@10, p50/p95 latency.

**Ablations to run — this is the table that goes on the slide:**

| Configuration | Recall@5 | MRR@10 | nDCG@10 | p95 latency |
|---|---|---|---|---|
| Keyword only (BM25 / `ts_rank_cd`) | | | | |
| Vector only (pgvector cosine) | | | | |
| **Hybrid (RRF, k=60)** | | | | |
| Hybrid + LLM rerank | | | | |

Then break the same table down by **query type**, using the planted pairs from `docs/03-DATA-MODEL.md` §2.2:

| Query type | Keyword only | Vector only | Hybrid |
|---|---|---|---|
| Identifier / code queries (`CT-2024-…`, POL, Annex) | high | **low** | high |
| Paraphrased semantic queries | **low** | high | high |
| Mixed natural queries | medium | medium | **high** |

This second table is the argument. It shows *why* hybrid exists rather than asserting that it is better. When a judge asks "why not just use embeddings?", point at row one. Anticipating the judge's question with a pre-computed answer is the strongest possible response.

**Also tune and report:**
- RRF `k` sweep: 10, 20, 40, 60, 100 → nDCG@10 curve. Report the chosen value and why.
- Embedding dimension: 768 vs 1536 → quality gain against index size and latency. If 768 is within noise of 1536, say you chose the cheaper one deliberately.

## 3. Suite B — The pre-submission check, backtested

`npm run eval:backtest`. Held-out split at 2025-09-01: 700 requests as history, 242 as the test set.

Each held-out request is scored against the corpus **as it stood the day before it was issued**, through the same scope ladder and the same 12-month staleness window the product applies. Scoring against the whole corpus would let the check learn from the request it is being tested on, which is the most common way a backtest flatters itself.

| Measure | Value |
|---|---|
| Recall overall (upper bound — see below) | **62.4%** (151/242) |
| — at the exact scope (this MS, this section) | 15.4% (2/13 checks) |
| — after widening to any Member State | 77.2% (149/193 checks) |
| — no live rule at any scope | 36 checks, reported as such rather than passed |
| Themes surfaced per section checked | 1.8 |
| Requests whose own text contains an absence or futurity phrase | 15.3% |

**Report the two numbers together.** A check that flagged every theme scores 100% recall; 1.8 themes per section is what this recall cost. Recall on its own is not a result.

**The false-positive rate is not computable, and the deck must not carry one.** The corpus holds only requests that *were* raised — sections submitted that drew no request were never recorded — so there is no negative class against which precision, specificity or a false-positive rate could be measured. Naming that limit is the honest version of this slide, and it converts into a concrete ask for a real deployment: record every section checked and whether a request followed.

**This is an upper bound, not the shipped number.** The product gates every mined rule on the dossier text in front of the writer — a section must be substantial enough to assess, and must not already address the theme — and the corpus holds no dossier text to replay that gate against. Only the requests themselves survive, not the drafts they were raised on. Gating can only lower recall, never raise it, so the shipped figure sits at or below 62.4%. Making it exactly measurable needs the same data-collection change as the false-positive rate.

The exact-scope figure is the interesting one for a buyer. It says the narrow claim — "this is what Italy asks about this section" — is supportable on only 13 of 242 checks at this corpus size, and that the recall comes from the wider scope. The product states which scope it used on every result, so the user is never shown the wide answer as if it were the narrow one.

## 4. Suite C — Draft groundedness and usefulness

**Automatic:**
- **Groundedness** — share of generated sentences supported by a cited precedent, per the verifier pass. Target ≥ 0.90.
- **Citation validity** — every `considerationId` returned must exist and must have been in the retrieved set. Target 100%; anything less is a bug, not a metric.
- **Refusal correctness** — on the deliberately-planted no-precedent RFIs, does the system refuse? Target 100%. Also report the false-refusal rate on RFIs that *do* have precedent.

**Human (30 samples, two independent team raters, report inter-rater agreement):**
- Usefulness, 1–5: could a reviewer submit this after light editing?
- Edit distance proxy: share of the draft retained after the rater's edit.
- Time-to-response: rater writes a response from scratch versus edits the draft. **Report the measured minutes.** This is the number that converts directly into the Business Impact slide, and it is measured on your own team rather than assumed.

## 5. Suite D — System quality

| Check | Target |
|---|---|
| Unit test coverage on `lib/` | ≥ 70% |
| E2E specs passing | 100%, covering every shipped feature |
| RLS isolation test | Affiliate cannot read RA Clinical drafts |
| Audit immutability test | `UPDATE`/`DELETE` on `audit_events` raises |
| Build | `npm run build` clean, zero TypeScript errors |
| Lighthouse on the main pages | ≥ 90 performance, ≥ 95 accessibility |
| Cost per search / per draft | measured from `ai_calls`, on a slide |

Accessibility is worth a real check, not a token one: keyboard navigation, focus states, contrast, screen-reader labels on charts. A large regulated employer cares about this, and it costs an hour with shadcn/ui.

## 6. The metrics slide

One slide, three blocks, all numbers from `docs/metrics/latest.json`:

```
RETRIEVAL          Recall@5  0.xx   (vector-only 0.xx, keyword-only 0.xx)
                   nDCG@10   0.xx      p95 latency  xxx ms

PRE-SUBMISSION     Recall  62.4%     at 1.8 themes surfaced per section
                   No false-positive rate: no negative class exists

GENERATION         Groundedness  0.xx  Refusal accuracy  xx/xx
                   Median drafting time  x min  →  x min   (n = 30)
```

Add one line underneath, and say it out loud:

> *Measured on a held-out split of a 1,100-consideration synthetic corpus. Reproducible with `npm run eval`.*

That sentence signals scientific honesty, states your scope limitation before a judge can raise it, and turns a potential weakness into evidence of rigour.
