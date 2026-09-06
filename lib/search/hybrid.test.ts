import { describe, expect, it } from 'vitest'
import {
  BAND_LABELS,
  CONFIDENCE_THRESHOLDS,
  bandFor,
  matchedOnFor,
} from './hybrid'

describe('bandFor', () => {
  it('bands at the documented thresholds (docs/04-AI-PIPELINE.md §2.3)', () => {
    expect(bandFor(0.9)).toBe('STRONG')
    expect(bandFor(0.75)).toBe('RELATED')
    expect(bandFor(0.6)).toBe('WEAK')
    expect(bandFor(0.2)).toBe('NONE')
  })

  it('treats each threshold as inclusive of the higher band', () => {
    expect(bandFor(CONFIDENCE_THRESHOLDS.strong)).toBe('STRONG')
    expect(bandFor(CONFIDENCE_THRESHOLDS.related)).toBe('RELATED')
    expect(bandFor(CONFIDENCE_THRESHOLDS.weak)).toBe('WEAK')
  })

  it('bands a keyword-only hit, which carries no similarity, as NONE', () => {
    expect(bandFor(0)).toBe('NONE')
  })

  it('has a plain-language label for every band', () => {
    for (const band of ['STRONG', 'RELATED', 'WEAK', 'NONE'] as const) {
      expect(BAND_LABELS[band]).toBeTruthy()
    }
  })
})

describe('matchedOnFor', () => {
  it('names both legs when the record matched semantically and by keyword', () => {
    expect(matchedOnFor({ vector_rank: 3, fts_rank: 7 })).toBe('semantic + keyword')
  })

  it('names the semantic leg alone', () => {
    expect(matchedOnFor({ vector_rank: 1, fts_rank: null })).toBe('semantic')
  })

  it('names the keyword leg alone', () => {
    expect(matchedOnFor({ vector_rank: null, fts_rank: 2 })).toBe('keyword')
  })

  /** Rank 0 is a real rank. Truthiness checks here would silently mislabel it. */
  it('treats rank 0 as a match, not as absent', () => {
    expect(matchedOnFor({ vector_rank: 0, fts_rank: null })).toBe('semantic')
  })
})
