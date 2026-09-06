import 'server-only'

import type { SearchHit, SearchParams, SearchResult } from './manual'
import { searchConsiderations } from './manual'
import { type ConfidenceBand } from './confidence'

// Re-exported so callers have one import for search; defined in a leaf module
// so a React component can render a band without pulling in the db client.
export { bandFor, BAND_LABELS, BAND_GUIDANCE, BAND_STYLE, CONFIDENCE_THRESHOLDS } from './confidence'
export type { ConfidenceBand } from './confidence'

/**
 * Search, over Postgres full text and trigram matching (ADR-039).
 *
 * The vector half is gone. `search_considerations` has always carried the two
 * branches that matter for this corpus — stemmed full text, and an identifier
 * branch for the document references and trial numbers `to_tsvector` mangles —
 * and it is what runs now.
 *
 * What that costs is measured, not waved away: Recall@5 falls from 0.795 to
 * 0.634, and paraphrased queries that share no vocabulary with the record they
 * want fall to 0.000. docs/05 keeps the full table. Identifier queries, which
 * are 25 of the 41 gold queries and the ones a regulatory colleague actually
 * pastes, are unaffected at 1.000.
 *
 * `mode` and the hit shape are kept so callers and the UI need no change, and
 * so the ablation table stays comparable if the vector half ever returns.
 */

export type SearchMode = 'hybrid' | 'keyword'

export interface HybridHit extends SearchHit {
  /** Cosine similarity from the vector leg, 0 when only keyword matched. */
  similarity: number
  /** Calibrated band for display — never show a raw RRF score (docs/04 §2.3). */
  confidence: ConfidenceBand
  rrfScore: number
}

export interface HybridResult extends Omit<SearchResult, 'hits'> {
  hits: HybridHit[]
  mode: SearchMode
  /** Set when hybrid was asked for but could not run. */
  fellBackBecause?: string
}

export function matchedOnFor(row: {
  vector_rank: number | null
  fts_rank: number | null
}): string {
  const vector = row.vector_rank != null
  const keyword = row.fts_rank != null
  if (vector && keyword) return 'semantic + keyword'
  if (vector) return 'semantic'
  return 'keyword'
}

export async function hybridSearch(params: SearchParams): Promise<HybridResult> {
  const result = await searchConsiderations(params)
  return {
    ...result,
    hits: result.hits.map((h) => ({
      ...h,
      // No vector leg, so no cosine and no fused rank. Reporting 0 rather than
      // inventing a plausible number keeps the confidence band honest: NONE
      // means "not scored by meaning", which is exactly the situation.
      similarity: 0,
      confidence: 'NONE' as const,
      rrfScore: 0,
    })),
    mode: 'keyword',
  }
}
