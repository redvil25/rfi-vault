import { describe, expect, it } from 'vitest'
import {
  DRAFT_SYSTEM_PROMPT, buildDraftUserMessage, draftPromptFingerprint, type DraftRequest,
} from './draft'
import {
  VERIFY_SYSTEM_PROMPT, buildVerifyUserMessage, groundednessOf, splitSentences,
} from './verify'
import type { Precedent } from '@/lib/draft/types'

const precedents: Precedent[] = [
  {
    considerationId: '11111111-1111-4111-8111-111111111111',
    similarity: 0.883,
    considerationText: 'IT - Please upload the proof of payment of the additional amount.',
    sponsorResponseText: 'Proof of payment of the additional amount required is provided.',
    memberState: 'IT',
    category: 'FEE_NATIONAL_UPDATE',
    section: 'Regulatory',
    documentRef: 'CT-2024-519530-24-00-SM06-001',
    euTrialNumber: '2024-519530-24-00',
    responseStatus: 'APPROVED',
    outcome: 'ACCEPTED',
  },
]

const request: DraftRequest = {
  considerationText: 'ES - The proof of payment for the national fee has not been provided.',
  section: 'Regulatory',
  sectionPart: 'PART_I',
  memberState: 'ES',
  category: 'FEE_NATIONAL_UPDATE',
  euTrialNumber: '2026-511111-11-00',
  documentRef: 'CT-2026-511111-11-00-SM01-001',
  submissionType: 'SUBSTANTIAL_MODIFICATION',
  precedents,
}

describe('the drafting prompt', () => {
  it('states the grounding rule before anything else', () => {
    // Rule ordering is not decoration: it is what the model attends to first.
    expect(DRAFT_SYSTEM_PROMPT.indexOf('Use ONLY the provided precedent records')).toBeLessThan(
      DRAFT_SYSTEM_PROMPT.indexOf('Match the register'),
    )
  })

  it('fixes the CTIS vocabulary and forbids the wrong word', () => {
    // Using "amendment" instead of "substantial modification" tells a regulatory
    // judge you did not do the reading (docs/00-PLAN.md).
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/substantial modification/)
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/Never write "amendment"/)
  })

  it('never phrases the output as final', () => {
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/DRAFT for human review/)
  })

  it('passes every precedent with its id, so a citation is checkable', () => {
    const message = buildDraftUserMessage(request)
    for (const p of precedents) {
      expect(message).toContain(p.considerationId)
      expect(message).toContain(p.sponsorResponseText)
    }
  })

  it('gives the model the current request and its Member State', () => {
    const message = buildDraftUserMessage(request)
    expect(message).toContain(request.considerationText)
    expect(message).toContain('member_state: ES')
    expect(message).toContain('2026-511111-11-00')
  })

  it('says "none" rather than omitting an absent Member State', () => {
    // A missing line reads to the model as an unknown; "none (Part I / all)"
    // reads as the fact it is.
    const message = buildDraftUserMessage({ ...request, memberState: null })
    expect(message).toContain('member_state: none (Part I / all)')
  })

  it('changes its fingerprint when the precedents change', () => {
    // The hash lands in ai_calls.prompt_hash: "which prompt produced this text"
    // has to stay answerable.
    const a = draftPromptFingerprint(request)
    const b = draftPromptFingerprint({ ...request, precedents: [] })
    expect(a).not.toBe(b)
    expect(a).toContain('draft/v1')
  })
})

describe('the verifier prompt', () => {
  it('forbids the verifier from using its own knowledge', () => {
    // A grader allowed outside knowledge cannot detect a draft that used it.
    expect(VERIFY_SYSTEM_PROMPT).toMatch(/Judge only against the precedents given/)
    expect(VERIFY_SYSTEM_PROMPT).toMatch(/is not evidence here/)
  })

  it('refuses SUPPORTED without a supporting id', () => {
    expect(VERIFY_SYSTEM_PROMPT).toMatch(/no supporting\s+id cannot be SUPPORTED/)
  })

  it('carries the draft and every precedent', () => {
    const message = buildVerifyUserMessage('The proof of payment is provided.', precedents)
    expect(message).toContain('The proof of payment is provided.')
    expect(message).toContain(precedents[0].considerationId)
  })
})

describe('splitSentences', () => {
  it('splits on sentence boundaries', () => {
    expect(splitSentences('One thing. Two things. Three things.')).toEqual([
      'One thing.',
      'Two things.',
      'Three things.',
    ])
  })

  it('does not split a version number', () => {
    // "version 3.0" split at the full stop leaves "0 is provided" as a fragment,
    // which grades as unsupported and drags the published figure down.
    expect(
      splitSentences('The Spanish informed consent form version 3.0 is provided.'),
    ).toEqual(['The Spanish informed consent form version 3.0 is provided.'])
  })

  it('does not split on a domain abbreviation', () => {
    expect(splitSentences('See section No. 4 of the protocol.')).toEqual([
      'See section No. 4 of the protocol.',
    ])
  })

  it('returns nothing for an empty draft rather than one empty sentence', () => {
    expect(splitSentences('')).toEqual([])
    expect(splitSentences('   ')).toEqual([])
  })

  it('keeps a trailing fragment with no terminator', () => {
    expect(splitSentences('A complete one. And one without')).toEqual([
      'A complete one.',
      'And one without',
    ])
  })
})

describe('groundednessOf', () => {
  it('counts PARTIAL as half', () => {
    expect(
      groundednessOf([
        { verdict: 'SUPPORTED' },
        { verdict: 'PARTIAL' },
        { verdict: 'UNSUPPORTED' },
        { verdict: 'SUPPORTED' },
      ]),
    ).toBe(0.625)
  })

  it('is 1 when everything is supported and 0 when nothing is', () => {
    expect(groundednessOf([{ verdict: 'SUPPORTED' }, { verdict: 'SUPPORTED' }])).toBe(1)
    expect(groundednessOf([{ verdict: 'UNSUPPORTED' }])).toBe(0)
  })

  it('returns null for no sentences rather than a number that means nothing', () => {
    // Zero sentences is an absent measurement, not a perfect or a failing score.
    expect(groundednessOf([])).toBeNull()
  })
})
