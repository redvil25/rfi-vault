import { describe, expect, it } from 'vitest'
import { lintSection } from './lint'

const kinds = (text: string) => lintSection(text).map((f) => f.kind)
const phrases = (text: string) => lintSection(text).map((f) => f.phrase)

describe('lintSection — absence', () => {
  it('catches the demo sentence', () => {
    const found = lintSection(
      'The insurance certificate has not yet been returned and is not attached.',
    )
    expect(found.map((f) => f.kind)).toEqual(['ABSENCE', 'ABSENCE'])
    expect(found.map((f) => f.phrase)).toEqual(['not yet been returned', 'not attached'])
  })

  it('reads across a line wrap, because PDF text arrives wrapped', () => {
    expect(phrases('The signed contract is not\nyet available for this site.')).toEqual([
      'not yet available',
    ])
  })

  it.each([
    'The document is missing.',
    'Proof of payment is pending.',
    'The site agreement is under negotiation.',
    'A translation is in preparation.',
    'We are awaiting the ethics opinion.',
  ])('flags %j', (text) => {
    expect(kinds(text)).toEqual(['ABSENCE'])
  })
})

describe('lintSection — futurity', () => {
  it.each([
    'The certificate will be provided once available.',
    'Final insurance values to be confirmed.',
    'The QP declaration will follow.',
    'Site list TBC.',
    'Details to follow in due course.',
  ])('flags %j', (text) => {
    expect(lintSection(text).some((f) => f.kind === 'FUTURITY')).toBe(true)
  })

  it('grades futurity below absence, because a promise is softer than a gap', () => {
    const absence = lintSection('The certificate is not attached.')
    const futurity = lintSection('The certificate will be provided.')
    expect(absence[0].kind).toBe('ABSENCE')
    expect(futurity[0].kind).toBe('FUTURITY')
  })
})

describe('lintSection — placeholders', () => {
  it.each([
    ['Fee paid: XXX euro.', 'xxx'],
    ['Sponsor: [insert legal entity name].', '[insert legal entity name]'],
    ['Contact: {{investigator_name}}.', '{{investigator_name}}'],
    ['Amount ......... paid.', '.........'],
    ['Signed by ________ on behalf of the sponsor.', '________'],
  ])('flags %j', (text, phrase) => {
    const found = lintSection(text)
    expect(found[0].kind).toBe('PLACEHOLDER')
    expect(found[0].phrase).toBe(phrase)
  })

  it('catches an unresolved tracked change and a leftover review note', () => {
    expect(kinds('The amount was updated Commented [AB1] check this against the decree.')).toEqual([
      'PLACEHOLDER',
    ])
    expect(kinds('Reviewer: please confirm the ISTAT figure.')).toEqual(['PLACEHOLDER'])
  })
})

describe('lintSection — precision', () => {
  it('does not fire inside a longer word', () => {
    expect(lintSection('Appending the annex to the cover letter.')).toEqual([])
    expect(lintSection('The expenditure was approved.')).toEqual([])
  })

  it('reports one finding per clause, not one per overlapping pattern', () => {
    // "will not be provided" contains "not be provided" and "provided".
    expect(lintSection('The certificate will not be provided.')).toHaveLength(1)
  })

  it('leaves clean regulatory prose alone', () => {
    const clean =
      'Proof of payment of the additional amount required under the ISTAT-updated tariff is ' +
      'enclosed as Annex 4. The POL reference matches the submission exactly.'
    expect(lintSection(clean)).toEqual([])
  })

  it('returns nothing for empty or whitespace input', () => {
    expect(lintSection('')).toEqual([])
    expect(lintSection('   \n  ')).toEqual([])
  })
})

describe('lintSection — output shape', () => {
  it('orders findings by position and carries a readable excerpt', () => {
    const text =
      'Section A is complete. The fee receipt is not attached. ' +
      'The insurance value is TBC.'
    const found = lintSection(text)
    expect(found.map((f) => f.start)).toEqual([...found.map((f) => f.start)].sort((a, b) => a - b))
    expect(found[0].excerpt).toBe('The fee receipt is not attached.')
    expect(found[0].because).toMatch(/not in the package/i)
  })

  it('offsets point at the matched text', () => {
    const text = 'The fee receipt is not attached.'
    const [finding] = lintSection(text)
    expect(text.slice(finding.start, finding.end).toLowerCase()).toBe(finding.phrase)
  })
})
