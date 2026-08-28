import { describe, expect, it } from 'vitest'
import { escalateTo, passesConfidenceGate, rankPrecedents, refusalReason } from './retrieve'
import type { Precedent } from './types'

function precedent(overrides: Partial<Precedent> & { considerationId: string }): Precedent {
  return {
    similarity: 0.7,
    considerationText: 'A consideration.',
    sponsorResponseText: 'A response.',
    memberState: null,
    category: 'FEE_NATIONAL_UPDATE',
    section: 'Regulatory',
    documentRef: 'CT-2024-519530-24-00-SM06-001',
    euTrialNumber: '2024-519530-24-00',
    responseStatus: 'APPROVED',
    outcome: 'ACCEPTED',
    ...overrides,
  }
}

describe('the confidence gate', () => {
  it('passes at the threshold and refuses below it', () => {
    expect(passesConfidenceGate(0.62, 0.62)).toBe(true)
    expect(passesConfidenceGate(0.63, 0.62)).toBe(true)
    expect(passesConfidenceGate(0.61, 0.62)).toBe(false)
    expect(passesConfidenceGate(0, 0.62)).toBe(false)
  })

  it('says the number and the threshold, not just "no"', () => {
    // A refusal a reviewer cannot interrogate is indistinguishable from a bug.
    const reason = refusalReason(0.41, 0.62)
    expect(reason).toContain('0.41')
    expect(reason).toContain('0.62')
    expect(reason).toMatch(/no sufficiently similar precedent/i)
  })
})

describe('rankPrecedents', () => {
  it('orders by similarity when no Member State is in play', () => {
    const ranked = rankPrecedents(
      [
        precedent({ considerationId: 'a', similarity: 0.7 }),
        precedent({ considerationId: 'b', similarity: 0.9 }),
        precedent({ considerationId: 'c', similarity: 0.8 }),
      ],
      null,
    )
    expect(ranked.map((p) => p.considerationId)).toEqual(['b', 'c', 'a'])
  })

  it('puts a same-Member-State precedent ahead of a slightly closer foreign one', () => {
    // National requirements are why Part II differs by country: a Spanish
    // informed-consent precedent is worth more to a Spanish request than an
    // Italian one scoring 0.03 higher.
    const ranked = rankPrecedents(
      [
        precedent({ considerationId: 'it', similarity: 0.91, memberState: 'IT' }),
        precedent({ considerationId: 'es', similarity: 0.88, memberState: 'ES' }),
      ],
      'ES',
    )
    expect(ranked[0].considerationId).toBe('es')
  })

  it('still ranks by similarity within the same Member State', () => {
    const ranked = rankPrecedents(
      [
        precedent({ considerationId: 'es-low', similarity: 0.7, memberState: 'ES' }),
        precedent({ considerationId: 'es-high', similarity: 0.85, memberState: 'ES' }),
        precedent({ considerationId: 'de', similarity: 0.95, memberState: 'DE' }),
      ],
      'ES',
    )
    expect(ranked.map((p) => p.considerationId)).toEqual(['es-high', 'es-low', 'de'])
  })

  it('does not mutate its input', () => {
    const input = [
      precedent({ considerationId: 'a', similarity: 0.5 }),
      precedent({ considerationId: 'b', similarity: 0.9 }),
    ]
    rankPrecedents(input, null)
    expect(input.map((p) => p.considerationId)).toEqual(['a', 'b'])
  })
})

describe('escalateTo', () => {
  it('routes a refusal to the team that owns the category', () => {
    // Read from the taxonomy, so it cannot disagree with the ownership the
    // ingestion path already assigned to the same category.
    expect(escalateTo('FEE_NATIONAL_UPDATE')).toBe('AFFILIATE')
    expect(escalateTo('IMPD_QUALITY')).toBe('RA_CLINICAL')
  })

  it('returns null rather than guessing for an unknown category', () => {
    expect(escalateTo('NOT_A_CATEGORY')).toBeNull()
  })
})
