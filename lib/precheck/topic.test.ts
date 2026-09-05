import { describe, expect, it } from 'vitest'
import {
  SUBSTANCE_MIN_WORDS,
  absenceSentence,
  addressesTopic,
  isSubstantive,
  topicSkipReason,
  topicTermsFor,
  wordCount,
} from './topic'

/** A section long enough to clear the substance gate, about nothing in particular. */
const FILLER =
  'This substantial modification updates the protocol to version four following a scientific ' +
  'advice procedure. The changes concern the secondary endpoint definitions and the schedule ' +
  'of assessments. No change is made to the sites participating in the trial.'

describe('topicTermsFor', () => {
  it('takes subject words from the taxonomy, not defect words', () => {
    const terms = topicTermsFor('FEE_PAYMENT_PROOF')
    expect(terms).toContain('fee')
    expect(terms).toContain('payment')
    expect(terms).toContain('proof')
    // "Proof of national fee payment **missing**" — the complaint half would
    // match nothing in a dossier and would make every rule look addressed.
    expect(terms).not.toContain('missing')
  })

  it('keeps short domain terms and drops short noise', () => {
    expect(topicTermsFor('GMP_QP_DECLARATION')).toContain('qp')
    expect(topicTermsFor('ICF_LOCAL_LANGUAGE')).not.toContain('of')
  })

  it('returns nothing for a category outside the taxonomy', () => {
    expect(topicTermsFor('UNCLASSIFIED')).toEqual([])
  })
})

describe('the substance gate', () => {
  it('counts words', () => {
    expect(wordCount('health')).toBe(1)
    expect(wordCount('  two   words  ')).toBe(2)
    expect(wordCount('')).toBe(0)
  })

  it('rejects a stray paste', () => {
    expect(isSubstantive('health')).toBe(false)
    expect(isSubstantive(FILLER)).toBe(true)
  })

  it('holds a rule back on a one-word section, and says how short it was', () => {
    const reason = topicSkipReason('health', 'FEE_PAYMENT_PROOF')
    expect(reason).toContain('1 word —')
    expect(reason).not.toContain('1 words')
    expect(reason).toContain(String(SUBSTANCE_MIN_WORDS))
  })
})

describe('the topic gate', () => {
  it('lets a rule fire when the section says nothing about the theme', () => {
    expect(addressesTopic(FILLER, 'FEE_PAYMENT_PROOF')).toBe(false)
    expect(topicSkipReason(FILLER, 'FEE_PAYMENT_PROOF')).toBeNull()
  })

  it('holds a rule back when the section already covers the theme', () => {
    const text = `${FILLER} Proof of payment of the national fee is enclosed as Annex 4.`
    expect(addressesTopic(text, 'FEE_PAYMENT_PROOF')).toBe(true)
    expect(topicSkipReason(text, 'FEE_PAYMENT_PROOF')).toContain('already refers to')
  })

  it('matches a plural without stemming anything else', () => {
    expect(addressesTopic(`${FILLER} Investigator payments are described.`, 'FEE_PAYMENT_PROOF')).toBe(
      true,
    )
    // "feed" must not satisfy "fee".
    expect(addressesTopic(`${FILLER} The feeder study is separate.`, 'FEE_PAYMENT_PROOF')).toBe(false)
  })

  it('names what was absent, so the flag is about the document', () => {
    const sentence = absenceSentence('FEE_PAYMENT_PROOF')
    expect(sentence).toMatch(/^Nothing in this section mentions /)
    expect(sentence).toContain('fee')
  })

  it('does not gate a category it has no terms for', () => {
    // PROTOCOL_DESIGN has no artefactKey; its label still yields subject words,
    // but a category with none must not be silently treated as addressed.
    expect(addressesTopic(FILLER, 'UNCLASSIFIED')).toBe(false)
  })
})
