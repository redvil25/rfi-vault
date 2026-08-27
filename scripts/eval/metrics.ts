/**
 * Retrieval metrics, with binary relevance.
 *
 * Definitions are written out rather than left implicit, because the numbers go
 * on a slide and "Recall@5" means at least two different things in the wild.
 * Pure functions, unit-tested in metrics.test.ts — a metric nobody has tested is
 * a number nobody should quote.
 */

/**
 * Recall@k = |relevant ∩ top-k| / min(|relevant|, k).
 *
 * The min() denominator is the choice worth stating: with the plain |relevant|
 * denominator, a query with 30 relevant records can never exceed 0.17 at k=5,
 * which says more about the gold set than about the retriever. Capping asks the
 * answerable question — "of the up-to-k relevant records that could have been
 * returned, how many were?" — and keeps queries comparable to one another.
 */
export function recallAtK(ranked: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0
  const hits = ranked.slice(0, k).filter((id) => relevant.has(id)).length
  return hits / Math.min(relevant.size, k)
}

/** Reciprocal rank of the first relevant result within k, else 0. */
export function reciprocalRankAtK(ranked: string[], relevant: Set<string>, k: number): number {
  const limit = Math.min(k, ranked.length)
  for (let i = 0; i < limit; i++) {
    if (relevant.has(ranked[i])) return 1 / (i + 1)
  }
  return 0
}

/**
 * nDCG@k with binary gain and log2(i+2) discount.
 *
 * The ideal ranking places min(|relevant|, k) relevant records first, so a
 * retriever is not penalised for a gold set larger than k.
 */
export function ndcgAtK(ranked: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0

  let dcg = 0
  const limit = Math.min(k, ranked.length)
  for (let i = 0; i < limit; i++) {
    if (relevant.has(ranked[i])) dcg += 1 / Math.log2(i + 2)
  }

  let idcg = 0
  for (let i = 0; i < Math.min(relevant.size, k); i++) {
    idcg += 1 / Math.log2(i + 2)
  }

  return idcg === 0 ? 0 : dcg / idcg
}

/** Nearest-rank percentile. p(50) of one sample is that sample. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1]
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Rounded for display; metrics files keep 4 decimals so trends stay visible. */
export function round(value: number, places = 4): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}
