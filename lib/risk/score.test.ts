import { describe, expect, it } from 'vitest'
import { BANDS, SIGMOID, bandFor, blend, fitSigmoid, ruleScore, sigmoid } from './score'
import type { RuleFinding } from './types'

const finding = (severity: number, id = `R${severity}`): RuleFinding => ({
  ruleId: id,
  categoryId: null,
  severity,
  memberState: null,
  message: 'm',
  recommendedAction: 'a',
})

describe('ruleScore', () => {
  it('is 0 with no findings', () => {
    expect(ruleScore([])).toBe(0)
  })

  it('equals the severity of a single finding', () => {
    expect(ruleScore([finding(0.6)])).toBeCloseTo(0.6, 4)
  })

  it('never exceeds 1, however many findings there are', () => {
    const many = Array.from({ length: 20 }, (_, i) => finding(0.9, `R${i}`))
    expect(ruleScore(many)).toBeLessThanOrEqual(1)
  })

  it('increases with each additional finding', () => {
    const one = ruleScore([finding(0.5, 'a')])
    const two = ruleScore([finding(0.5, 'a'), finding(0.5, 'b')])
    expect(two).toBeGreaterThan(one)
  })

  /**
   * Noisy-OR was chosen over a weighted sum for this shape: the second missing
   * artefact does raise risk, but by less than the first did, because the
   * section is already going to attract a request either way.
   */
  it('has diminishing returns', () => {
    const first = ruleScore([finding(0.5, 'a')]) - 0
    const second = ruleScore([finding(0.5, 'a'), finding(0.5, 'b')]) - ruleScore([finding(0.5, 'a')])
    expect(second).toBeLessThan(first)
  })

  it('ignores a severity outside 0–1 rather than producing a nonsense score', () => {
    expect(ruleScore([finding(5)])).toBeLessThanOrEqual(1)
    expect(ruleScore([finding(-2)])).toBeGreaterThanOrEqual(0)
  })
})

describe('sigmoid and banding', () => {
  it('is 0.5 at zero', () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 6)
  })

  it('bands on the documented thresholds', () => {
    expect(bandFor(0)).toBe('LOW')
    expect(bandFor(BANDS.medium - 1)).toBe('LOW')
    expect(bandFor(BANDS.medium)).toBe('MEDIUM')
    expect(bandFor(BANDS.high)).toBe('MEDIUM')
    expect(bandFor(BANDS.high + 1)).toBe('HIGH')
    expect(bandFor(100)).toBe('HIGH')
  })

  it('is documented as unfitted, so nothing claims calibration', () => {
    expect(SIGMOID.fitted).toBe(false)
  })
})

describe('blend', () => {
  it('scores a clean section low and a badly failing one high', () => {
    expect(blend({ rule: 0, similarity: 0, baseRate: 0 }).band).toBe('LOW')
    expect(blend({ rule: 1, similarity: 1, baseRate: 1 }).band).toBe('HIGH')
  })

  it('weights the rule engine most heavily (ADR-004)', () => {
    const ruleOnly = blend({ rule: 1, similarity: 0, baseRate: 0 }).score
    const similarityOnly = blend({ rule: 0, similarity: 1, baseRate: 0 }).score
    const baseOnly = blend({ rule: 0, similarity: 0, baseRate: 1 }).score
    expect(ruleOnly).toBeGreaterThan(similarityOnly)
    expect(similarityOnly).toBeGreaterThan(baseOnly)
  })

  it('reports which signals were used', () => {
    expect(blend({ rule: 0.5 }).signalsUsed).toEqual(['RULE'])
    expect(blend({ rule: 0.5, baseRate: 0.2 }).signalsUsed).toEqual(['RULE', 'BASE_RATE'])
  })

  /**
   * The safety property of the whole feature. With no embeddings the similarity
   * term is unavailable; scoring it as zero would drag every section toward LOW
   * and turn a missing subsystem into false reassurance.
   */
  it('renormalises around a missing signal instead of scoring it zero', () => {
    const withoutSimilarity = blend({ rule: 1, baseRate: 1 })
    const similarityAsZero = blend({ rule: 1, similarity: 0, baseRate: 1 })
    expect(withoutSimilarity.score).toBeGreaterThan(similarityAsZero.score)
  })

  it('gives a fully failing section the same raw score whichever signals are present', () => {
    expect(blend({ rule: 1 }).raw).toBeCloseTo(1, 4)
    expect(blend({ rule: 1, baseRate: 1 }).raw).toBeCloseTo(1, 4)
    expect(blend({ rule: 1, similarity: 1, baseRate: 1 }).raw).toBeCloseTo(1, 4)
  })

  it('contributions sum to the raw score', () => {
    const result = blend({ rule: 0.8, similarity: 0.4, baseRate: 0.2 })
    const sum =
      result.contributions.RULE + result.contributions.SIMILARITY + result.contributions.BASE_RATE
    expect(sum).toBeCloseTo(result.raw, 3)
  })

  it('reports no contribution for a signal that was not supplied', () => {
    const result = blend({ rule: 0.8 })
    expect(result.contributions.SIMILARITY).toBe(0)
    expect(result.contributions.BASE_RATE).toBe(0)
  })

  it('keeps the score inside 0–100', () => {
    for (const rule of [0, 0.25, 0.5, 0.75, 1]) {
      const { score } = blend({ rule, similarity: rule, baseRate: rule })
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(100)
    }
  })

  it('is monotonic in the rule signal', () => {
    const scores = [0, 0.2, 0.4, 0.6, 0.8, 1].map((r) => blend({ rule: r }).score)
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1])
    }
  })

  it('survives a non-finite signal rather than producing NaN', () => {
    const result = blend({ rule: Number.NaN, similarity: Number.POSITIVE_INFINITY })
    expect(Number.isFinite(result.score)).toBe(true)
  })
})

describe('fitSigmoid', () => {
  /**
   * Throwing beats returning the provisional constants: a function named
   * `fitSigmoid` quietly handing back unfitted parameters is exactly how an
   * uncalibrated number ends up on a slide labelled "calibrated".
   */
  it('refuses rather than pretending to fit', () => {
    expect(() => fitSigmoid([{ raw: 0.5, triggeredRfi: true }])).toThrow(/negative class/i)
  })
})
