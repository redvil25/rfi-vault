import { describe, expect, it } from 'vitest'
import { mean, ndcgAtK, percentile, recallAtK, reciprocalRankAtK, round } from './metrics'

const rel = (...ids: string[]) => new Set(ids)

describe('recallAtK', () => {
  it('is 1 when every relevant record is inside k', () => {
    expect(recallAtK(['a', 'b', 'c'], rel('a', 'b'), 5)).toBe(1)
  })

  it('is 0 when nothing relevant is retrieved', () => {
    expect(recallAtK(['x', 'y'], rel('a'), 5)).toBe(0)
  })

  it('ignores relevant records ranked beyond k', () => {
    expect(recallAtK(['x', 'x2', 'x3', 'x4', 'x5', 'a'], rel('a'), 5)).toBe(0)
  })

  /**
   * The capped denominator is the whole reason this function exists rather than
   * a one-liner. With 30 relevant records and k=5, plain recall tops out at
   * 0.167 no matter how good the retriever is.
   */
  it('caps the denominator at k so large gold sets stay comparable', () => {
    const relevant = rel(...Array.from({ length: 30 }, (_, i) => `r${i}`))
    const ranked = Array.from({ length: 5 }, (_, i) => `r${i}`)
    expect(recallAtK(ranked, relevant, 5)).toBe(1)
  })

  it('is 0 for an empty gold set rather than dividing by zero', () => {
    expect(recallAtK(['a'], rel(), 5)).toBe(0)
  })
})

describe('reciprocalRankAtK', () => {
  it('is 1 when the first result is relevant', () => {
    expect(reciprocalRankAtK(['a', 'b'], rel('a'), 10)).toBe(1)
  })

  it('is 1/rank of the first relevant result', () => {
    expect(reciprocalRankAtK(['x', 'y', 'a'], rel('a'), 10)).toBeCloseTo(1 / 3)
  })

  it('is 0 when the first relevant result falls outside k', () => {
    const ranked = [...Array.from({ length: 10 }, (_, i) => `x${i}`), 'a']
    expect(reciprocalRankAtK(ranked, rel('a'), 10)).toBe(0)
  })

  it('handles a result list shorter than k', () => {
    expect(reciprocalRankAtK(['a'], rel('a'), 10)).toBe(1)
  })
})

describe('ndcgAtK', () => {
  it('is 1 for a perfect ranking', () => {
    expect(ndcgAtK(['a', 'b', 'c'], rel('a', 'b', 'c'), 10)).toBeCloseTo(1)
  })

  it('is 0 when nothing relevant is retrieved', () => {
    expect(ndcgAtK(['x', 'y'], rel('a'), 10)).toBe(0)
  })

  it('rewards ranking the relevant record higher', () => {
    const early = ndcgAtK(['a', 'x', 'y'], rel('a'), 10)
    const late = ndcgAtK(['x', 'y', 'a'], rel('a'), 10)
    expect(early).toBeGreaterThan(late)
  })

  it('does not penalise a gold set larger than k', () => {
    const relevant = rel(...Array.from({ length: 20 }, (_, i) => `r${i}`))
    const ranked = Array.from({ length: 10 }, (_, i) => `r${i}`)
    expect(ndcgAtK(ranked, relevant, 10)).toBeCloseTo(1)
  })

  it('never exceeds 1', () => {
    const relevant = rel('a', 'b')
    expect(ndcgAtK(['a', 'b', 'c'], relevant, 10)).toBeLessThanOrEqual(1)
  })
})

describe('percentile', () => {
  it('returns the single sample for any percentile', () => {
    expect(percentile([42], 50)).toBe(42)
    expect(percentile([42], 95)).toBe(42)
  })

  it('uses nearest-rank', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 100)).toBe(10)
  })

  it('is order independent', () => {
    expect(percentile([9, 1, 5, 3, 7], 50)).toBe(percentile([1, 3, 5, 7, 9], 50))
  })

  it('is 0 for no samples', () => {
    expect(percentile([], 95)).toBe(0)
  })
})

describe('mean and round', () => {
  it('averages', () => {
    expect(mean([1, 2, 3])).toBe(2)
  })

  it('is 0 for no samples', () => {
    expect(mean([])).toBe(0)
  })

  it('rounds to the requested places', () => {
    expect(round(0.123456)).toBe(0.1235)
    expect(round(0.123456, 2)).toBe(0.12)
  })
})
