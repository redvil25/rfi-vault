import { describe, expect, it } from 'vitest'
import { CATEGORIES, TEAM_LABELS, TEAM_ROLES, categoriesOwnedBy } from '@/lib/domain/taxonomy'
import { searchParamsSchema } from './manual'

describe('searchParamsSchema', () => {
  it('accepts a sponsor protocol code', () => {
    const parsed = searchParamsSchema.parse({ protocolCode: 'NN1234-4567' })
    expect(parsed.protocolCode).toBe('NN1234-4567')
  })

  it('trims the protocol code so a pasted value still matches', () => {
    expect(searchParamsSchema.parse({ protocolCode: '  NN1234-4567 ' }).protocolCode).toBe(
      'NN1234-4567',
    )
  })

  it('leaves the protocol code unset when the dropdown is on "Any"', () => {
    expect(searchParamsSchema.parse({}).protocolCode).toBeUndefined()
  })

  it('rejects an over-long protocol code rather than passing it to the RPC', () => {
    const result = searchParamsSchema.safeParse({ protocolCode: 'N'.repeat(61) })
    expect(result.success).toBe(false)
  })

  // The two identifiers are separate columns and separate filters. A regression
  // that folded one into the other would still return rows, just the wrong ones.
  it('keeps the protocol code independent of the IMP filter', () => {
    const parsed = searchParamsSchema.parse({ impName: 'NN-1234', protocolCode: 'NN9876-0001' })
    expect(parsed.impName).toBe('NN-1234')
    expect(parsed.protocolCode).toBe('NN9876-0001')
  })

  it('accepts a team', () => {
    expect(searchParamsSchema.parse({ team: 'AFFILIATE' }).team).toBe('AFFILIATE')
  })

  it('leaves the team unset when the dropdown is on "Any"', () => {
    expect(searchParamsSchema.parse({}).team).toBeUndefined()
  })

  // The value goes into a `team_role` argument. A string the enum does not know
  // would fail in Postgres rather than here, which turns a typo in a URL into a
  // 500 instead of the "Invalid search" the page already renders.
  it('rejects a team that is not a role', () => {
    expect(searchParamsSchema.safeParse({ team: 'MARKETING' }).success).toBe(false)
  })

  it('accepts every role the taxonomy defines', () => {
    for (const team of TEAM_ROLES) {
      expect(searchParamsSchema.safeParse({ team }).success).toBe(true)
    }
  })
})

/**
 * The Team filter runs on `owner_team`, which ingestion and the seed write from
 * the category's owner. These guard the two ways that correspondence can break
 * silently: a category whose owner is not a role the filter accepts, and a role
 * that reaches the dropdown with no label and renders as a raw enum value.
 */
describe('team and category', () => {
  it('gives every category an owner the search filter accepts', () => {
    for (const category of CATEGORIES) {
      expect(TEAM_ROLES).toContain(category.owner)
      expect(searchParamsSchema.safeParse({ team: category.owner }).success).toBe(true)
    }
  })

  it('labels every role, so no dropdown shows a database value', () => {
    for (const team of TEAM_ROLES) {
      expect(TEAM_LABELS[team]).toBeTruthy()
      expect(TEAM_LABELS[team]).not.toBe(team)
    }
  })

  it('partitions the categories across the four named user groups', () => {
    const owned = TEAM_ROLES.flatMap((team) => categoriesOwnedBy(team))
    expect(owned).toHaveLength(CATEGORIES.length)
    // ADMIN is a role for access, not a queue of work — nothing is filed to it.
    expect(categoriesOwnedBy('ADMIN')).toHaveLength(0)
  })
})
