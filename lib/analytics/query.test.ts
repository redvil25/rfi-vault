import { describe, expect, it } from 'vitest'
import { summarisePreventability, type CategoryStat } from './query'

function stat(over: Partial<CategoryStat> & { occurrences: number }): CategoryStat {
  return {
    category: 'X',
    label: 'x',
    tier: 1,
    preventable: false,
    owner: null,
    distinctTrials: 1,
    memberStates: 1,
    accepted: 0,
    openItems: 0,
    repeatRate: 1,
    ...over,
  }
}

describe('summarisePreventability', () => {
  it('divides by classified volume, not by everything read', () => {
    const p = summarisePreventability([
      stat({ occurrences: 60, tier: 1, preventable: true }),
      stat({ occurrences: 40, tier: 3, preventable: false }),
      stat({ category: 'UNCLASSIFIED', occurrences: 100, tier: null }),
    ])

    expect(p.total).toBe(200)
    expect(p.classified).toBe(100)
    expect(p.unclassified).toBe(100)
    // 60/100, not 60/200. The unclassified half is not evidence of anything.
    expect(p.share).toBe(0.6)
  })

  it('counts an unknown category as unclassified rather than tier 0', () => {
    const p = summarisePreventability([
      stat({ occurrences: 10, tier: 1, preventable: true }),
      stat({ category: 'RENAMED_LAST_YEAR', occurrences: 5, tier: null }),
    ])

    expect(p.unclassified).toBe(5)
    expect(p.tier12).toBe(10)
    expect(p.tier12Share).toBe(1)
  })

  it('keeps total as everything read, so the volume headline stays honest', () => {
    const p = summarisePreventability([
      stat({ occurrences: 3, tier: 2, preventable: true }),
      stat({ category: 'UNCLASSIFIED', occurrences: 7, tier: null }),
    ])

    expect(p.total).toBe(10)
    expect(p.classified).toBe(3)
  })

  it('reports zero rather than dividing by zero when nothing is classified', () => {
    const p = summarisePreventability([
      stat({ category: 'UNCLASSIFIED', occurrences: 12, tier: null }),
    ])

    expect(p.classified).toBe(0)
    expect(p.share).toBe(0)
    expect(p.tier12Share).toBe(0)
  })

  it('handles an empty corpus', () => {
    const p = summarisePreventability([])
    expect(p).toMatchObject({ total: 0, classified: 0, unclassified: 0, share: 0 })
  })

  it('only tiers 1 and 2 count toward the administrative share', () => {
    const p = summarisePreventability([
      stat({ occurrences: 1, tier: 1 }),
      stat({ occurrences: 1, tier: 2 }),
      stat({ occurrences: 1, tier: 3 }),
      stat({ occurrences: 1, tier: 4 }),
    ])

    expect(p.tier12).toBe(2)
    expect(p.tier12Share).toBe(0.5)
  })
})
