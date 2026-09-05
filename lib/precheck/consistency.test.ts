import { describe, expect, it } from 'vitest'
import { checkConsistency } from './consistency'
import { splitDossier } from './split'

const find = (
  sections: { section: string; text: string }[],
  id: string,
) => checkConsistency(sections).find((f) => f.id === id)!

describe('checkConsistency', () => {
  const COVER =
    'This substantial modification concerns Protocol version 4.0 dated 2026-01-15 for NN-1234. ' +
    'Approximately 320 subjects will be enrolled across 40 sites.'
  const PROTOCOL =
    'Protocol v3.0, dated 2025-11-02. A total of 280 patients will be randomised. ' +
    'NN-1234 5 mg once weekly.'

  it('catches a protocol version that disagrees between sections', () => {
    const f = find(
      [
        { section: 'Cover Letter', text: COVER },
        { section: 'Protocol', text: PROTOCOL },
      ],
      'protocol-version',
    )
    expect(f.checked).toBe(true)
    expect(f.disagrees).toBe(true)
    expect(f.note).toContain('Cover Letter says 4.0')
    expect(f.note).toContain('Protocol says 3.0')
  })

  it('catches a subject count that disagrees', () => {
    const f = find(
      [
        { section: 'Cover Letter', text: COVER },
        { section: 'Protocol', text: PROTOCOL },
      ],
      'subject-count',
    )
    expect(f.disagrees).toBe(true)
    expect(f.values.map((v) => v.value)).toEqual(['320', '280'])
  })

  it('catches a protocol date that disagrees, across the dot in a version number', () => {
    // "Protocol version 4.0 dated …" — the gap between the noun and the date
    // contains a full stop, which an earlier pattern excluded, silently
    // disabling this extractor entirely.
    const f = find(
      [
        { section: 'Cover Letter', text: COVER },
        { section: 'Protocol', text: PROTOCOL },
      ],
      'protocol-date',
    )
    expect(f.checked).toBe(true)
    expect(f.disagrees).toBe(true)
  })

  it('passes when the values agree, normalising formatting', () => {
    const f = find(
      [
        { section: 'Cover Letter', text: 'Protocol version 3.0 applies.' },
        { section: 'Protocol', text: 'Protocol v3 is current.' },
      ],
      'protocol-version',
    )
    expect(f.checked).toBe(true)
    expect(f.disagrees).toBe(false)
  })

  it('treats the same IMP written differently as agreement', () => {
    const f = find(
      [
        { section: 'Cover Letter', text: 'The IMP is NN-1234.' },
        { section: 'IMPD Quality', text: 'NN 1234 drug product.' },
      ],
      'imp-name',
    )
    expect(f.disagrees).toBe(false)
  })

  it('reports "not checked", never a pass, when it saw fewer than two values', () => {
    const one = find(
      [
        { section: 'Cover Letter', text: 'Protocol version 3.0 applies.' },
        { section: 'Protocol', text: 'No version is stated here.' },
      ],
      'protocol-version',
    )
    expect(one.checked).toBe(false)
    expect(one.disagrees).toBe(false)
    expect(one.note).toContain('one section only')

    const none = find([{ section: 'Protocol', text: 'Nothing useful.' }], 'subject-count')
    expect(none.checked).toBe(false)
    expect(none.note).toContain('Not checked')
  })

  it('never reports a disagreement it cannot show', () => {
    for (const f of checkConsistency([
      { section: 'Cover Letter', text: COVER },
      { section: 'Protocol', text: PROTOCOL },
    ])) {
      if (f.disagrees) expect(f.values.length).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('splitDossier', () => {
  const DOSSIER = `Cover Letter
This substantial modification concerns Protocol version 4.0.

1. Protocol
A total of 280 patients will be randomised.

3.2 IMPD Quality
The drug product specification is attached.

Annexe Z — Local Appendix
Something we do not recognise.`

  it('splits on headings and maps them onto the taxonomy', () => {
    const r = splitDossier(DOSSIER)
    expect(r.recognised.map((b) => b.section)).toEqual([
      'Cover Letter',
      'Protocol',
      'IMPD Quality',
    ])
  })

  it('strips numbering from a heading', () => {
    const r = splitDossier('3.2 IMPD Quality\nSpecification attached.')
    expect(r.recognised[0].section).toBe('IMPD Quality')
  })

  it('resolves common aliases', () => {
    expect(splitDossier("Investigator's Brochure\nEdition 7.").recognised[0].section).toBe(
      'Investigator Brochure',
    )
    expect(splitDossier('ICF\nLocal language version attached.').recognised[0].section).toBe(
      'Informed Consent',
    )
  })

  it('leaves an unrecognised heading out of the check rather than guessing', () => {
    const r = splitDossier(DOSSIER)
    expect(r.recognised.some((b) => b.text.includes('do not recognise'))).toBe(false)
    expect(r.unrecognised.join(' ')).toContain('Annexe Z')
  })

  it('reports preamble before the first heading as unrecognised', () => {
    const r = splitDossier('Some loose text with no heading.\n\nProtocol\nBody text.')
    expect(r.unrecognised).toContain('(text before the first heading)')
    expect(r.recognised).toHaveLength(1)
  })

  it('merges a section that appears twice, so it is not compared against itself', () => {
    const r = splitDossier('Protocol\nFirst part.\n\nProtocol\nSecond part.')
    expect(r.recognised).toHaveLength(1)
    expect(r.recognised[0].text).toContain('First part.')
    expect(r.recognised[0].text).toContain('Second part.')
  })

  it('does not shred prose into headings', () => {
    const r = splitDossier('Protocol\nShort line here.\nAnother short line.\nAnd a third.')
    expect(r.recognised).toHaveLength(1)
  })

  it('returns nothing recognised for text with no headings at all', () => {
    expect(splitDossier('Just a paragraph of text.').recognised).toEqual([])
  })
})
