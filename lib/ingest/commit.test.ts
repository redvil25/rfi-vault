import { describe, expect, it } from 'vitest'
import { sectionForRow } from './commit'
import { ALL_SECTIONS, UNMAPPED_SECTION } from '@/lib/domain/taxonomy'

describe('sectionForRow', () => {
  it('keeps a section the parser mapped onto the taxonomy', () => {
    expect(sectionForRow('Informed Consent')).toBe('Informed Consent')
  })

  it('admits it does not know rather than inventing a section', () => {
    expect(sectionForRow(null)).toBe(UNMAPPED_SECTION)
  })

  // The regression this exists for: the commit path used to fall back to the
  // raw printed string, so "Spain" — a Member State, not an application
  // section part — was filed as a section and reached the search dropdown.
  it('never yields a value outside the taxonomy other than the sentinel', () => {
    for (const mapped of [null, 'Protocol', 'Data Protection']) {
      const filed = sectionForRow(mapped)
      expect(filed === UNMAPPED_SECTION || ALL_SECTIONS.includes(filed as never)).toBe(true)
    }
  })

  it('does not fall back to Regulatory, which would hide the row in the largest bucket', () => {
    expect(sectionForRow(null)).not.toBe('Regulatory')
  })
})
