import { describe, expect, it } from 'vitest'
import {
  STATUS_MEANING, TRANSITIONS, availableActions, blockedBecause, mayTransition,
} from './transitions'

const base = {
  status: 'DRAFT' as const,
  ownerTeam: 'AFFILIATE' as const,
  actorTeam: 'AFFILIATE' as const,
  hasResponseText: true,
}

describe('mayTransition', () => {
  it('lets the owning team act', () => {
    expect(mayTransition('AFFILIATE', 'AFFILIATE')).toBe(true)
  })

  it('lets the two coordinating teams act on anything', () => {
    expect(mayTransition('CTA_MANAGEMENT', 'AFFILIATE')).toBe(true)
    expect(mayTransition('ADMIN', 'RA_CLINICAL')).toBe(true)
  })

  it('refuses another team, and refuses a user with no team', () => {
    expect(mayTransition('RA_CLINICAL', 'AFFILIATE')).toBe(false)
    expect(mayTransition(null, 'AFFILIATE')).toBe(false)
    // An unowned record is not a free-for-all.
    expect(mayTransition('AFFILIATE', null)).toBe(false)
  })
})

describe('the status machine', () => {
  it('walks DRAFT to SUBMITTED one step at a time', () => {
    expect(availableActions(base)).toEqual(['SUBMIT_FOR_REVIEW'])
    expect(availableActions({ ...base, status: 'IN_REVIEW' })).toEqual([
      'REQUEST_CHANGES',
      'APPROVE',
    ])
    expect(availableActions({ ...base, status: 'APPROVED' })).toEqual(['MARK_SUBMITTED'])
  })

  it('makes SUBMITTED terminal', () => {
    expect(availableActions({ ...base, status: 'SUBMITTED' })).toEqual([])
  })

  it('refuses to skip a step', () => {
    // Straight from DRAFT to APPROVED is the transition that would let a response
    // reach the shared corpus without a reviewer ever seeing it.
    expect(blockedBecause('APPROVE', base)).toMatch(/only a response that is in review/i)
    expect(blockedBecause('MARK_SUBMITTED', base)).toMatch(/only a response that is approved/i)
  })

  it('will not send an empty response forward', () => {
    expect(blockedBecause('SUBMIT_FOR_REVIEW', { ...base, hasResponseText: false })).toMatch(
      /no response text/i,
    )
    expect(
      blockedBecause('APPROVE', { ...base, status: 'IN_REVIEW', hasResponseText: false }),
    ).toMatch(/no response text/i)
  })

  it('still lets a reviewer send an empty response back for changes', () => {
    // Requesting changes is exactly what you do when there is nothing usable there.
    expect(
      blockedBecause('REQUEST_CHANGES', {
        ...base,
        status: 'IN_REVIEW',
        hasResponseText: false,
      }),
    ).toBeNull()
  })

  it('refuses another team before it checks anything else', () => {
    expect(blockedBecause('SUBMIT_FOR_REVIEW', { ...base, actorTeam: 'RA_CLINICAL' })).toMatch(
      /another team/i,
    )
  })

  it('requires a reason only when sending work backwards', () => {
    expect(TRANSITIONS.REQUEST_CHANGES.requiresReason).toBe(true)
    expect(TRANSITIONS.SUBMIT_FOR_REVIEW.requiresReason).toBe(false)
    expect(TRANSITIONS.APPROVE.requiresReason).toBe(false)
    expect(TRANSITIONS.MARK_SUBMITTED.requiresReason).toBe(false)
  })

  it('names the audit action for every transition', () => {
    for (const rule of Object.values(TRANSITIONS)) {
      expect(rule.auditAction).toMatch(/^[A-Z_]+$/)
    }
  })
})

describe('what each status means', () => {
  it('tells the reviewer that approving shares the response with every team', () => {
    // The reviewer has to know this at the moment they approve, not afterwards.
    expect(STATUS_MEANING.APPROVED).toMatch(/shared with every team/i)
    expect(STATUS_MEANING.DRAFT).toMatch(/owning team/i)
  })
})
