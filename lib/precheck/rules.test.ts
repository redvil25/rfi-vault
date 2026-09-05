import { describe, expect, it } from 'vitest'
import {
  MIN_HITS_FOR_RULE,
  STALE_AFTER_MONTHS,
  describeRule,
  fixFor,
  isLive,
  monthsBetween,
  severityForLint,
  severityForRule,
  skipReason,
  toMinedRule,
  type MinedRuleRow,
} from './rules'
import type { LintFinding } from './lint'
import type { RulePrecedent } from './types'

const NOW = new Date('2026-09-05T00:00:00Z')

function row(over: Partial<MinedRuleRow> = {}): MinedRuleRow {
  return {
    category: 'FEE_NATIONAL_UPDATE',
    section: 'Regulatory',
    section_part: 'PART_I',
    member_state: 'IT',
    hits: 34,
    distinct_trials: 21,
    resolved_hits: 30,
    first_seen: '2025-02-20T00:00:00Z',
    last_seen: '2026-06-11T00:00:00Z',
    ...over,
  }
}

describe('monthsBetween', () => {
  it('counts whole months only', () => {
    expect(monthsBetween(new Date('2025-01-15T00:00:00Z'), new Date('2025-02-14T00:00:00Z'))).toBe(0)
    expect(monthsBetween(new Date('2025-01-15T00:00:00Z'), new Date('2025-02-15T00:00:00Z'))).toBe(1)
    expect(monthsBetween(new Date('2024-06-01T00:00:00Z'), new Date('2026-09-05T00:00:00Z'))).toBe(27)
  })

  it('never goes negative for a date in the future', () => {
    expect(monthsBetween(new Date('2027-01-01T00:00:00Z'), NOW)).toBe(0)
  })
})

describe('date scoping', () => {
  it('keeps a rule seen inside the window live', () => {
    const rule = toMinedRule(row(), NOW)
    expect(rule.stale).toBe(false)
    expect(isLive(rule)).toBe(true)
  })

  it('marks a rule unseen for 12+ months stale, and stale rules never fire', () => {
    const rule = toMinedRule(row({ last_seen: '2024-01-01T00:00:00Z' }), NOW)
    expect(rule.monthsSinceLastSeen).toBeGreaterThanOrEqual(STALE_AFTER_MONTHS)
    expect(rule.stale).toBe(true)
    expect(isLive(rule)).toBe(false)
  })

  it('is exact at the boundary — 12 months is stale, 11 is not', () => {
    const stale = toMinedRule(row({ last_seen: '2025-09-05T00:00:00Z' }), NOW)
    const live = toMinedRule(row({ last_seen: '2025-10-05T00:00:00Z' }), NOW)
    expect(stale.stale).toBe(true)
    expect(live.stale).toBe(false)
  })

  it('a stale rule says how old it is rather than going quiet', () => {
    const rule = toMinedRule(row({ last_seen: '2024-01-01T00:00:00Z' }), NOW)
    expect(skipReason(rule)).toMatch(/Last seen \d+ months ago/)
    expect(skipReason(rule)).toMatch(/may no longer exist/)
  })
})

describe('recurrence threshold', () => {
  it('needs enough occurrences to count as a pattern', () => {
    expect(isLive(toMinedRule(row({ hits: MIN_HITS_FOR_RULE - 1 }), NOW))).toBe(false)
    expect(isLive(toMinedRule(row({ hits: MIN_HITS_FOR_RULE }), NOW))).toBe(true)
  })

  it('explains a thin rule with its own count', () => {
    const rule = toMinedRule(row({ hits: 2 }), NOW)
    expect(skipReason(rule)).toContain('Only 2 occurrences')
  })
})

describe('describeRule', () => {
  it('produces the sentence a regulatory writer trusts', () => {
    expect(describeRule(toMinedRule(row(), NOW))).toBe(
      'IT raised this 34 times across 21 trials, between Feb 2025 and Jun 2026.',
    )
  })

  it('handles a Part I theme, which belongs to no single Member State', () => {
    expect(describeRule(toMinedRule(row({ member_state: null }), NOW))).toMatch(
      /^Member States raised this 34 times/,
    )
  })

  it('does not say "across 1 trials"', () => {
    expect(describeRule(toMinedRule(row({ hits: 3, distinct_trials: 1 }), NOW))).toContain(
      'raised this 3 times on a single trial',
    )
  })
})

describe('severity', () => {
  const finding = (kind: LintFinding['kind']): LintFinding => ({
    kind,
    phrase: 'x',
    start: 0,
    end: 1,
    excerpt: 'x',
    because: 'x',
  })

  it('grades a stated gap and a placeholder above a promise', () => {
    expect(severityForLint(finding('ABSENCE'))).toBe('BLOCKER')
    expect(severityForLint(finding('PLACEHOLDER'))).toBe('BLOCKER')
    expect(severityForLint(finding('FUTURITY'))).toBe('LIKELY')
  })

  it('grades recurrence by how often it actually recurred', () => {
    expect(severityForRule(toMinedRule(row({ hits: 34 }), NOW))).toBe('LIKELY')
    expect(severityForRule(toMinedRule(row({ hits: 4 }), NOW))).toBe('WATCH')
  })
})

describe('fixFor', () => {
  const precedent = (text: string): RulePrecedent => ({
    considerationId: 'c1',
    considerationText: 'Proof of payment of the ISTAT-updated amount is required.',
    sponsorResponseText: text,
    memberState: 'IT',
    section: 'Regulatory',
    issuedAt: '2026-06-11T00:00:00Z',
    documentRef: 'CT-2026-1-00-SM01-001',
    euTrialNumber: '2026-500001-11-00',
    protocolCode: 'NN-1234-4001',
  })

  it('names the artefact and the team who has to produce it, both from the taxonomy', () => {
    const fix = fixFor('FEE_NATIONAL_UPDATE', [])
    expect(fix.missingArtefact).toBeTruthy()
    expect(fix.owner).toBeTruthy()
  })

  it('lifts wording verbatim from an accepted response and keeps the source', () => {
    const wording = 'Proof of payment of the additional amount required is provided.'
    const fix = fixFor('FEE_NATIONAL_UPDATE', [precedent(wording)])
    expect(fix.suggestedWording).toBe(wording)
    expect(fix.suggestedWordingFrom?.euTrialNumber).toBe('2026-500001-11-00')
  })

  it('offers no wording rather than inventing it when no precedent answered', () => {
    expect(fixFor('FEE_NATIONAL_UPDATE', []).suggestedWording).toBeNull()
    expect(fixFor('FEE_NATIONAL_UPDATE', [precedent('   ')]).suggestedWording).toBeNull()
  })

  it('returns nulls, not guesses, for a category outside the taxonomy', () => {
    const fix = fixFor('UNCLASSIFIED', [])
    expect(fix.missingArtefact).toBeNull()
    expect(fix.owner).toBeNull()
  })
})
