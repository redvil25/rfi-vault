import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { Precedent } from '@/lib/draft/types'
import type { SuggestionsPayload } from './types'

/**
 * The generation path, without a model.
 *
 * `npm run verify:suggest` exercises this against a real model and a real
 * database, which is where the interesting failures live — but it costs tokens,
 * needs a key, and cannot be made to produce a specific malformed answer on
 * demand. These are the cases that have to hold no matter what the model
 * returns, so they are pinned here instead: a fabricated citation, an option
 * that loses every citation, a model that ignores the instruction to vary the
 * strategy, a verifier that falls over.
 */

const { retrieveMock, generateMock, verifyMock } = vi.hoisted(() => ({
  retrieveMock: vi.fn(),
  generateMock: vi.fn(),
  verifyMock: vi.fn(),
}))

vi.mock('@/lib/draft/retrieve', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/draft/retrieve')>()
  return { ...actual, retrievePrecedents: retrieveMock }
})
vi.mock('@/lib/ai/suggest', () => ({ generateSuggestions: generateMock }))
vi.mock('@/lib/ai/draft', () => ({ verifyDraft: verifyMock }))

const { suggestResponses } = await import('./run')

const db = {} as SupabaseClient<Database>
const opts = { actorId: '00000000-0000-0000-0000-000000000000' }

const REQUEST =
  'IT - No payment receipt has been identified for this submission. Please submit the proof ' +
  'of payment together with the reference number used for the transfer.'

function precedent(id: string, similarity = 0.9): Precedent {
  return {
    considerationId: id,
    similarity,
    considerationText: 'IT - Proof of payment was not identified.',
    sponsorResponseText: 'The bank transfer receipt referencing POL417283 has been uploaded.',
    memberState: 'IT',
    category: 'FEE_PAYMENT_PROOF',
    section: 'Regulatory',
    documentRef: 'CT-2023-587893-36-00-001',
    euTrialNumber: '2023-587893-36-00',
    responseStatus: 'APPROVED',
    outcome: 'ACCEPTED',
  }
}

type Option = SuggestionsPayload['options'][number]

function option(over: Partial<Option> & { strategy: Option['strategy'] }): Option {
  return {
    headline: 'Attach the receipt.',
    draft: `Draft text for ${over.strategy}. The receipt is enclosed.`,
    whenToUse: 'When the receipt exists.',
    risk: 'The reference may not match.',
    citations: [{ considerationId: 'p1', supportsClaim: 'A past sponsor attached the receipt.' }],
    attachmentsRequired: [],
    confidence: 0.8,
    ...over,
  }
}

function retrievalOk(precedents = [precedent('p1'), precedent('p2', 0.8)]) {
  retrieveMock.mockResolvedValue({ ok: true, precedents, maxSimilarity: 0.9 })
}

function generated(options: Option[], openQuestions: string[] = []) {
  generateMock.mockResolvedValue({
    payload: { options, openQuestions },
    model: 'gemini-2.5-flash',
    promptHash: 'hash',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyMock.mockResolvedValue({
    sentences: [{ sentence: 'A sentence.', verdict: 'SUPPORTED', considerationIds: ['p1'] }],
  })
})

describe('before anything reaches the model', () => {
  it('refuses when the application section cannot be determined', async () => {
    const outcome = await suggestResponses(
      { text: 'Please advise on the matter raised previously by the committee.', section: null },
      db,
      opts,
    )
    expect(outcome.refused).toBe(true)
    expect(generateMock).not.toHaveBeenCalled()
    expect(retrieveMock).not.toHaveBeenCalled()
  })

  it('passes a retrieval failure through, with somewhere to send it', async () => {
    retrieveMock.mockResolvedValue({
      ok: false,
      reason: 'No approved precedent exists in this application section yet.',
      precedents: [],
      maxSimilarity: null,
    })
    const outcome = await suggestResponses({ text: REQUEST, section: 'Regulatory' }, db, opts)
    expect(outcome.refused).toBe(true)
    if (!outcome.refused) return
    expect(outcome.reason).toContain('No approved precedent')
    expect(outcome.escalateTo).toBeTruthy()
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('refuses below the confidence gate and still shows the closest records', async () => {
    retrieveMock.mockResolvedValue({
      ok: true,
      precedents: [precedent('p1', 0.2), precedent('p2', 0.1)],
      maxSimilarity: 0.2,
    })
    const outcome = await suggestResponses({ text: REQUEST, section: 'Regulatory' }, db, opts)
    expect(outcome.refused).toBe(true)
    if (!outcome.refused) return
    expect(outcome.nearest.length).toBeGreaterThan(0)
    expect(generateMock).not.toHaveBeenCalled()
  })

  it('does not tell retrieval to exclude a record, because a paste is not a record', async () => {
    retrievalOk()
    generated([option({ strategy: 'SUPPLY' })])
    await suggestResponses({ text: REQUEST, section: 'Regulatory' }, db, opts)
    expect(retrieveMock.mock.calls[0][0].considerationId).toBe('')
  })
})

describe('citations the schema cannot check', () => {
  it('drops a citation naming a record that was never retrieved', async () => {
    retrievalOk()
    generated([
      option({
        strategy: 'SUPPLY',
        citations: [
          { considerationId: 'p1', supportsClaim: 'real' },
          { considerationId: 'invented-id', supportsClaim: 'fabricated' },
        ],
      }),
    ])
    const outcome = await suggestResponses({ text: REQUEST, section: 'Regulatory' }, db, opts)
    expect(outcome.refused).toBe(false)
    if (outcome.refused) return
    expect(outcome.options[0].citations.map((c) => c.considerationId)).toEqual(['p1'])
  })

  it('discards an option that loses every citation, keeping the ones that survive', async () => {
    retrievalOk()
    generated([
      option({ strategy: 'SUPPLY' }),
      option({
        strategy: 'JUSTIFY',
        citations: [{ considerationId: 'not-retrieved', supportsClaim: 'fabricated' }],
      }),
    ])
    const outcome = await suggestResponses({ text: REQUEST, section: 'Regulatory' }, db, opts)
    expect(outcome.refused).toBe(false)
    if (outcome.refused) return
    expect(outcome.options.map((o) => o.strategy)).toEqual(['SUPPLY'])
  })

  it('refuses outright when no option is left traceable to precedent', async () => {
    retrievalOk()
    generated([
      option({
        strategy: 'SUPPLY',
        citations: [{ considerationId: 'nope', supportsClaim: 'fabricated' }],
      }),
      option({
        strategy: 'COMMIT',
        citations: [{ considerationId: 'also-nope', supportsClaim: 'fabricated' }],
      }),
    ])
    const outcome = await suggestResponses({ text: REQUEST, section: 'Regulatory' }, db, opts)
    expect(outcome.refused).toBe(true)
    if (!outcome.refused) return
    expect(outcome.reason).toMatch(/none of them can be traced to precedent/i)
    expect(verifyMock).not.toHaveBeenCalled()
  })
})

describe('the options themselves', () => {
  it('orders by strategy, not by the order the model happened to emit', async () => {
    retrievalOk()
    generated([
      option({ strategy: 'COMMIT' }),
      option({ strategy: 'SUPPLY' }),
      option({ strategy: 'JUSTIFY' }),
    ])
    const outcome = await suggestResponses({ text: REQUEST, section: 'Regulatory' }, db, opts)
    expect(outcome.refused).toBe(false)
    if (outcome.refused) return
    expect(outcome.options.map((o) => o.strategy)).toEqual(['SUPPLY', 'JUSTIFY', 'COMMIT'])
  })

  it('drops a repeated strategy rather than showing the same move twice', async () => {
    retrievalOk()
    generated([
      option({ strategy: 'SUPPLY', draft: 'The receipt is enclosed as Annex 4.' }),
      option({ strategy: 'SUPPLY', draft: 'The receipt is enclosed as Annex 4.' }),
      option({ strategy: 'COMMIT' }),
    ])
    const outcome = await suggestResponses({ text: REQUEST, section: 'Regulatory' }, db, opts)
    expect(outcome.refused).toBe(false)
    if (outcome.refused) return
    expect(outcome.options.map((o) => o.strategy)).toEqual(['SUPPLY', 'COMMIT'])
  })

  it('accepts fewer than three rather than expecting a padded set', async () => {
    retrievalOk()
    generated([option({ strategy: 'SUPPLY' })])
    const outcome = await suggestResponses({ text: REQUEST, section: 'Regulatory' }, db, opts)
    expect(outcome.refused).toBe(false)
    if (outcome.refused) return
    expect(outcome.options).toHaveLength(1)
  })

  it('carries the parsed Member State and the open questions through', async () => {
    retrievalOk()
    generated([option({ strategy: 'SUPPLY' })], ['Which tariff applied on the submission date?'])
    const outcome = await suggestResponses({ text: REQUEST, section: 'Regulatory' }, db, opts)
    expect(outcome.refused).toBe(false)
    if (outcome.refused) return
    expect(outcome.parsed.memberState).toBe('IT')
    expect(outcome.openQuestions).toHaveLength(1)
  })

  it('refuses, rather than throwing, when the model call fails', async () => {
    retrievalOk()
    generateMock.mockRejectedValue(new Error('quota exhausted'))
    const outcome = await suggestResponses({ text: REQUEST, section: 'Regulatory' }, db, opts)
    expect(outcome.refused).toBe(true)
    if (!outcome.refused) return
    expect(outcome.nearest.length).toBeGreaterThan(0)
  })
})

describe('grading', () => {
  it('grades each option separately against the same precedents', async () => {
    retrievalOk()
    generated([option({ strategy: 'SUPPLY' }), option({ strategy: 'COMMIT' })])
    const outcome = await suggestResponses({ text: REQUEST, section: 'Regulatory' }, db, opts)
    expect(verifyMock).toHaveBeenCalledTimes(2)
    expect(outcome.refused).toBe(false)
    if (outcome.refused) return
    expect(outcome.options.every((o) => o.groundedness === 1)).toBe(true)
    expect(outcome.verifierUnavailable).toBeNull()
  })

  it('keeps the options ungraded rather than dropping them when the verifier fails', async () => {
    retrievalOk()
    generated([option({ strategy: 'SUPPLY' })])
    verifyMock.mockRejectedValue(new Error('verifier unreachable'))
    const outcome = await suggestResponses({ text: REQUEST, section: 'Regulatory' }, db, opts)
    expect(outcome.refused).toBe(false)
    if (outcome.refused) return
    expect(outcome.options).toHaveLength(1)
    // Never null groundedness *and* a silent screen: the UI has to be told.
    expect(outcome.options[0].groundedness).toBeNull()
    expect(outcome.verifierUnavailable).toBeTruthy()
  })

  it('says so when verification was skipped, rather than implying a grade', async () => {
    retrievalOk()
    generated([option({ strategy: 'SUPPLY' })])
    const outcome = await suggestResponses({ text: REQUEST, section: 'Regulatory' }, db, {
      ...opts,
      skipVerification: true,
    })
    expect(verifyMock).not.toHaveBeenCalled()
    expect(outcome.refused).toBe(false)
    if (outcome.refused) return
    expect(outcome.options[0].groundedness).toBeNull()
    expect(outcome.verifierUnavailable).toContain('skipped')
  })
})
