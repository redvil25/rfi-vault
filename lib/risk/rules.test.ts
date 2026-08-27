import { describe, expect, it } from 'vitest'
import { CATEGORIES } from '@/lib/domain/taxonomy'
import { RULES, applicableRules, evaluateRules, readArtefact, versionsMentioned } from './rules'
import type { DraftSectionInput } from './types'

function section(overrides: Partial<DraftSectionInput> = {}): DraftSectionInput {
  return {
    section: 'Regulatory',
    sectionPart: 'PART_I',
    content: '',
    artefacts: {},
    memberStates: [],
    submissionType: 'INITIAL',
    ...overrides,
  }
}

describe('readArtefact', () => {
  it('treats only an explicit true as present', () => {
    expect(readArtefact(true)).toBe('PRESENT')
  })

  it('treats only an explicit false as missing', () => {
    expect(readArtefact(false)).toBe('MISSING')
  })

  /**
   * The property that keeps the whole feature honest: an undeclared artefact is
   * a gap in coverage, never a finding. Reporting "we were not told" as "it is
   * absent" would manufacture risk out of missing metadata.
   */
  it('treats absent, null and non-boolean values as unknown', () => {
    expect(readArtefact(undefined)).toBe('UNKNOWN')
    expect(readArtefact(null)).toBe('UNKNOWN')
    expect(readArtefact('yes')).toBe('UNKNOWN')
    expect(readArtefact(0)).toBe('UNKNOWN')
  })
})

describe('rule derivation from the taxonomy', () => {
  it('generates one artefact rule per category that names an artefact', () => {
    const expected = CATEGORIES.filter((c) => c.artefactKey !== null).length
    const artefactRules = RULES.filter((r) => r.id.startsWith('ARTEFACT_'))
    expect(artefactRules).toHaveLength(expected)
  })

  it('gives every rule a severity inside 0–1', () => {
    for (const rule of RULES) {
      expect(rule.severity).toBeGreaterThan(0)
      expect(rule.severity).toBeLessThanOrEqual(1)
    }
  })

  it('ranks a high-frequency category above a low-frequency one', () => {
    const feeProof = RULES.find((r) => r.id === 'ARTEFACT_FEE_PAYMENT_PROOF')!
    const legibility = RULES.find((r) => r.id === 'ARTEFACT_DOC_LEGIBILITY')!
    expect(feeProof.severity).toBeGreaterThan(legibility.severity)
  })

  it('gives every rule a message and an action', () => {
    for (const rule of RULES) {
      expect(rule.message.length).toBeGreaterThan(0)
      expect(rule.recommendedAction.length).toBeGreaterThan(0)
    }
  })

  it('has no duplicate rule ids', () => {
    const ids = RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('covers the 20–30 rules the plan calls for', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(20)
  })
})

describe('applicableRules', () => {
  it('only applies rules attached to this section', () => {
    const applicable = applicableRules(section({ section: 'Insurance and Indemnification' }))
    const ids = applicable.map((a) => a.rule.id)
    expect(ids).toContain('ARTEFACT_INSURANCE_COVER')
    expect(ids).not.toContain('ARTEFACT_GMP_QP_DECLARATION')
  })

  /** A national rule for a country the application is not going to is noise. */
  it('skips national rules for Member States not in the application', () => {
    const withoutItaly = applicableRules(section({ memberStates: ['DE'] }))
    expect(withoutItaly.map((a) => a.rule.id)).not.toContain('QUIRK_IT_FEE_NATIONAL_UPDATE')

    const withItaly = applicableRules(section({ memberStates: ['IT'] }))
    expect(withItaly.map((a) => a.rule.id)).toContain('QUIRK_IT_FEE_NATIONAL_UPDATE')
  })

  it('applies a national rule once per matching Member State', () => {
    const applicable = applicableRules(
      section({ section: 'Informed Consent', sectionPart: 'PART_II', memberStates: ['IT', 'ES'] }),
    )
    const local = applicable.filter((a) => a.rule.id.startsWith('LOCAL_LANGUAGE_'))
    expect(local.map((a) => a.memberState).sort()).toEqual(['ES', 'IT'])
  })
})

describe('evaluateRules', () => {
  it('reports a declared-absent artefact as a finding', () => {
    const result = evaluateRules(section({ artefacts: { fee_proof: false } }))
    expect(result.findings.map((f) => f.ruleId)).toContain('ARTEFACT_FEE_PAYMENT_PROOF')
  })

  it('reports a present artefact as neither a finding nor unchecked', () => {
    const result = evaluateRules(section({ artefacts: { fee_proof: true } }))
    expect(result.findings.map((f) => f.ruleId)).not.toContain('ARTEFACT_FEE_PAYMENT_PROOF')
    expect(result.unchecked.map((u) => u.ruleId)).not.toContain('ARTEFACT_FEE_PAYMENT_PROOF')
  })

  it('reports an undeclared artefact as unchecked, not as a finding', () => {
    const result = evaluateRules(section())
    expect(result.findings).toHaveLength(0)
    expect(result.unchecked.length).toBeGreaterThan(0)
  })

  it('orders findings most severe first', () => {
    const result = evaluateRules(
      section({ artefacts: { fee_proof: false, legibility: false, naming_convention: false } }),
    )
    const severities = result.findings.map((f) => f.severity)
    expect([...severities].sort((a, b) => b - a)).toEqual(severities)
  })

  it('counts coverage as evaluated over applicable', () => {
    const result = evaluateRules(section({ artefacts: { fee_proof: true } }))
    expect(result.applicable).toBeGreaterThan(0)
    expect(result.evaluated).toBe(result.applicable - result.unchecked.length)
  })

  it('attaches the Member State to a national finding', () => {
    const result = evaluateRules(
      section({ memberStates: ['IT'], artefacts: { fee_proof_current_tariff: false } }),
    )
    const quirk = result.findings.find((f) => f.ruleId === 'QUIRK_IT_FEE_NATIONAL_UPDATE')
    expect(quirk?.memberState).toBe('IT')
  })
})

describe('local-language rule', () => {
  const icf = (versions: string[] | boolean | null | undefined, memberStates: string[]) =>
    evaluateRules(
      section({
        section: 'Informed Consent',
        sectionPart: 'PART_II',
        memberStates,
        artefacts: { local_language_versions: versions },
      }),
    )

  it('passes when every required language is attached', () => {
    const result = icf(['it', 'es'], ['IT', 'ES'])
    expect(result.findings.filter((f) => f.ruleId.startsWith('LOCAL_LANGUAGE_'))).toHaveLength(0)
  })

  it('flags the Member State whose language is missing', () => {
    const result = icf(['it'], ['IT', 'ES'])
    const flagged = result.findings.filter((f) => f.ruleId.startsWith('LOCAL_LANGUAGE_'))
    expect(flagged).toHaveLength(1)
    expect(flagged[0].memberState).toBe('ES')
  })

  /** Belgium expects two languages; one is not enough. */
  it('requires every language a Member State lists', () => {
    const result = icf(['nl'], ['BE'])
    expect(result.findings.map((f) => f.ruleId)).toContain('LOCAL_LANGUAGE_BE')
  })

  it('is unchecked, not failed, when no version list was declared', () => {
    const result = icf(undefined, ['IT'])
    expect(result.findings.map((f) => f.ruleId)).not.toContain('LOCAL_LANGUAGE_IT')
    expect(result.unchecked.map((u) => u.ruleId)).toContain('LOCAL_LANGUAGE_IT')
  })
})

describe('versionsMentioned', () => {
  it('finds the common CTIS version forms', () => {
    expect(versionsMentioned('Protocol version 3.0 dated 14/03/2026').sort()).toEqual(['3.0'])
    expect(versionsMentioned('see v2.1 and Version 10').sort()).toEqual(['10', '2.1'])
  })

  it('deduplicates repeats of the same version', () => {
    expect(versionsMentioned('version 3.0 ... v3.0 ... Version 3.0')).toEqual(['3.0'])
  })

  it('finds nothing when no version is cited', () => {
    expect(versionsMentioned('The cover letter is attached.')).toEqual([])
  })
})

describe('version consistency rule', () => {
  const check = (content: string) =>
    evaluateRules(section({ section: 'Protocol', content }))

  it('flags a section citing two different versions', () => {
    const result = check('Cover letter references protocol version 2.0; the uploaded file is v3.0.')
    expect(result.findings.map((f) => f.ruleId)).toContain('CONTENT_VERSION_CONSISTENCY')
  })

  it('passes a section citing one version consistently', () => {
    const result = check('Protocol version 3.0 is uploaded and version 3.0 is referenced.')
    expect(result.findings.map((f) => f.ruleId)).not.toContain('CONTENT_VERSION_CONSISTENCY')
  })

  /** No version cited is nothing to check, not a contradiction. */
  it('is unchecked when no version is cited at all', () => {
    const result = check('The protocol is attached.')
    expect(result.unchecked.map((u) => u.ruleId)).toContain('CONTENT_VERSION_CONSISTENCY')
  })
})
