# 05 — Evaluation: How We Prove It Works

> This document is worth more hackathon points per hour invested than any other. Almost every student team demos a feature. Very few show an **ablation table with numbers on a held-out set**. Technical Implementation is 25% of the score, and this is the cheapest way to win it.

## 1. The harness

```
scripts/eval/
  gold-retrieval.json    50 queries × human-marked relevant consideration IDs
  gold-groundedness.json 30 RFIs for draft evaluation with precedent sets
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

## 3. Suite B — Draft groundedness and usefulness

**Automatic:**
- **Groundedness** — share of generated sentences supported by a cited precedent, per the verifier pass. Target ≥ 0.90.
- **Citation validity** — every `considerationId` returned must exist and must have been in the retrieved set. Target 100%; anything less is a bug, not a metric.
- **Refusal correctness** — on the deliberately-planted no-precedent RFIs, does the system refuse? Target 100%. Also report the false-refusal rate on RFIs that *do* have precedent.

**Human (30 samples, two independent team raters, report inter-rater agreement):**
- Usefulness, 1–5: could a reviewer submit this after light editing?
- Edit distance proxy: share of the draft retained after the rater's edit.
- Time-to-response: rater writes a response from scratch versus edits the draft. **Report the measured minutes.** This is the number that converts directly into the Business Impact slide, and it is measured on your own team rather than assumed.

## 4. Suite C — System quality

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

## 5. The metrics slide

One slide, three blocks, all numbers from `docs/metrics/latest.json`:

```
RETRIEVAL          Recall@5  0.xx   (vector-only 0.xx, keyword-only 0.xx)
                   nDCG@10   0.xx      p95 latency  xxx ms

GENERATION         Groundedness  0.xx  Refusal accuracy  xx/xx
                   Median drafting time  x min  →  x min   (n = 30)
```

Add one line underneath, and say it out loud:

> *Measured on a held-out split of a 1,100-consideration synthetic corpus. Reproducible with `npm run eval`.*

That sentence signals scientific honesty, states your scope limitation before a judge can raise it, and turns a potential weakness into evidence of rigour.
