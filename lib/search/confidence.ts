/**
 * Match confidence, in a leaf module with no server-only imports so a component
 * can render a band without pulling the database client in with it.
 *
 * A raw RRF score is meaningless to a regulatory user — it is an artefact of
 * fusion arithmetic, not a statement about the record. What that user needs to
 * decide is whether a precedent is close enough to reuse, so that is what gets
 * shown (docs/04-AI-PIPELINE.md §2.3).
 */

export type ConfidenceBand = 'STRONG' | 'RELATED' | 'WEAK' | 'NONE'

/**
 * Stated in docs/04 as values to calibrate against the gold set, not as final
 * numbers. `npm run eval` reports similarity distribution per band so these can
 * be moved on evidence. Until they have been, say "provisional" rather than
 * "calibrated" in the deck.
 */
export const CONFIDENCE_THRESHOLDS = { strong: 0.82, related: 0.7, weak: 0.55 } as const

export function bandFor(similarity: number): ConfidenceBand {
  if (similarity >= CONFIDENCE_THRESHOLDS.strong) return 'STRONG'
  if (similarity >= CONFIDENCE_THRESHOLDS.related) return 'RELATED'
  if (similarity >= CONFIDENCE_THRESHOLDS.weak) return 'WEAK'
  return 'NONE'
}

export const BAND_LABELS: Record<ConfidenceBand, string> = {
  STRONG: 'Strong precedent',
  RELATED: 'Related precedent',
  WEAK: 'Weak match',
  NONE: 'Background only',
}

/** What the reader should do with a match at this band. */
export const BAND_GUIDANCE: Record<ConfidenceBand, string> = {
  STRONG: 'reusable with minor edits',
  RELATED: 'review the differences',
  WEAK: 'background only',
  NONE: 'no semantic score',
}

export const BAND_STYLE: Record<ConfidenceBand, string> = {
  STRONG: 'bg-ok-soft text-ok',
  RELATED: 'bg-background text-muted',
  WEAK: 'bg-background text-muted',
  NONE: 'bg-background text-muted',
}
