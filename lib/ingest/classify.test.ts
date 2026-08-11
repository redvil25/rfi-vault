import { describe, expect, it } from 'vitest'
import { classifyConsideration } from './classify'

function classify(text: string, section: string | null = null, part: 'PART_I' | 'PART_II' | null = null) {
  return classifyConsideration({ text, section, part, memberState: null })
}

describe('classifyConsideration', () => {
  it('recognises the ISTAT fee revision as a national fee update, not a generic payment proof', () => {
    const r = classify(
      'IT - Please upload the proof of payment of the additional amount required by law for all ' +
        'applications submitted starting from 17 February 2025 due to ISTAT updated fee.',
      'Regulatory',
      'PART_I',
    )
    // Both fee rules fire here; the more specific one must win.
    expect(r.category).toBe('FEE_NATIONAL_UPDATE')
    expect(r.confidence).toBeGreaterThan(0.6)
  })

  it('falls back to the generic fee category when nothing indicates a revision', () => {
    const r = classify(
      'ES - Proof of payment of the applicable national fee is missing. Please provide the receipt.',
      'Regulatory',
      'PART_I',
    )
    expect(r.category).toBe('FEE_PAYMENT_PROOF')
  })

  it('separates a missing ICF translation from an ICF content problem', () => {
    expect(
      classify(
        'ES - The informed consent form is provided in English only. A Spanish version is required.',
        'Informed Consent',
        'PART_II',
      ).category,
    ).toBe('ICF_LOCAL_LANGUAGE')

    expect(
      classify(
        'The informed consent form does not describe the subject\'s right to withdraw without justification.',
        'Informed Consent',
        'PART_II',
      ).category,
    ).toBe('ICF_CONTENT')
  })

  it('does not apply section-scoped rules outside their section', () => {
    // "informed consent" wording inside an IMPD Quality section must not be
    // classified as an ICF issue.
    const r = classify(
      'The stability data provided do not cover the proposed shelf life of 36 months.',
      'IMPD Quality',
      'PART_I',
    )
    expect(r.category).toBe('IMPD_QUALITY')
  })

  it('classifies the QP declaration regardless of section', () => {
    expect(
      classify('The QP declaration submitted does not cover the manufacturing site DE-088.', 'Regulatory', 'PART_I')
        .category,
    ).toBe('GMP_QP_DECLARATION')
  })

  it('returns UNCLASSIFIED rather than guessing when nothing matches', () => {
    const r = classify('Please confirm receipt of this correspondence.', null, null)
    expect(r.category).toBe('UNCLASSIFIED')
    expect(r.confidence).toBeLessThan(0.25)
  })

  it('returns UNCLASSIFIED on empty input', () => {
    expect(classify('').category).toBe('UNCLASSIFIED')
  })

  it('reports the patterns that fired, so a reviewer can audit the decision', () => {
    const r = classify('The insurance certificate does not cover the territory.', null, null)
    expect(r.category).toBe('INSURANCE_COVER')
    expect(r.evidence.length).toBeGreaterThan(0)
  })
})
