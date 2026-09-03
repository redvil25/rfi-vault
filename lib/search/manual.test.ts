import { describe, expect, it } from 'vitest'
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
})
