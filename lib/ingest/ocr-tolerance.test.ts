import { describe, expect, it } from 'vitest'
import { parseCtisRfi } from './parse-ctis'
import { detectFormat } from './extract'
import { classifyConsideration } from './classify'

/**
 * Every string here is real Tesseract output from the scanned sample, not
 * invented. OCR errs in specific, repeatable ways and the parser has to absorb
 * them without losing fields.
 */
describe('parser tolerance of OCR output', () => {
  it('reads Part I when OCR renders the numeral as a pipe', () => {
    const doc = parseCtisRfi(
      [
        'Consideration number:', '1',
        'Application section parts', 'Part | - Regulatory',
        'Consideration:', 'IT - Proof of payment missing.',
      ].join('\n'),
    )
    expect(doc.considerations[0].sectionPart).toBe('PART_I')
    expect(doc.considerations[0].section).toBe('Regulatory')
  })

  it('reads Part II when OCR renders the second numeral as a lowercase L', () => {
    const doc = parseCtisRfi(
      [
        'Consideration number:', '2',
        'Application section parts', 'Part Il - Informed consent',
        'Consideration:', 'ES - Translation missing.',
      ].join('\n'),
    )
    expect(doc.considerations[0].sectionPart).toBe('PART_II')
  })

  it('accepts arabic numerals without reading "Part 2" as a run of ones', () => {
    const one = parseCtisRfi('Consideration number:\n1\nApplication section parts\nPart 1 - Regulatory\nConsideration:\na')
    const two = parseCtisRfi('Consideration number:\n1\nApplication section parts\nPart 2 - Informed consent\nConsideration:\na')
    expect(one.considerations[0].sectionPart).toBe('PART_I')
    expect(two.considerations[0].sectionPart).toBe('PART_II')
  })

  it('recovers a document reference split across a column boundary', () => {
    // The header is laid out in columns; OCR reads it row by row, so the
    // reference stem and its sequence number end up separated by a date.
    const text = [
      '2024-519530-24-00 SUBSTANTIAL CT-2024-519530-24-00-SM06- 05/08/2026 12:50',
      'MODIFICATION 001 - Requests for information',
      'Consideration number:', '1',
      'Application section parts', 'Part | - Regulatory',
      'Consideration:', 'IT - Proof of payment missing.',
    ].join('\n')

    const doc = parseCtisRfi(text)
    expect(doc.documentRef).toBe('CT-2024-519530-24-00-SM06-001')
    expect(doc.euTrialNumber).toBe('2024-519530-24-00')
    expect(doc.submissionType).toBe('SUBSTANTIAL_MODIFICATION')
  })

  it('finds a usable timestamp on a later page when the first is mangled', () => {
    // Page 1 loses the colon ("126"); page 2 keeps it. Restricting the search to
    // the start of the document would lose a perfectly readable field.
    const doc = parseCtisRfi(
      [
        'CT-2024-519530-24-00-SM06-001 - Requests for information 05/08/2026 126',
        'Consideration number:', '1',
        'Application section parts', 'Part | - Regulatory',
        'Consideration:', 'IT - Proof of payment missing.',
        'CT-2024-519530-24-00-SM06-001 - Requests for information 05/08/2026 12:50',
      ].join('\n'),
    )
    expect(doc.issuedAt).toBe('2026-08-05T12:50:00.000Z')
  })

  it('does not treat a non-Member-State prefix as a country code', () => {
    // The scanned sample prefixes a consideration with "Quality - ".
    const doc = parseCtisRfi(
      [
        'Consideration number:', '2',
        'Application section parts', 'Part Il - Quality',
        'Consideration:', 'Quality - Please provide a detailed description of the changes.',
      ].join('\n'),
    )
    expect(doc.considerations[0].memberState).toBeNull()
  })
})

describe('classifier with an unmapped section', () => {
  it('still classifies from wording when the section does not map', () => {
    // "Part II - Quality" is not in the taxonomy, but the wording is plainly an
    // IMPD Quality question. An unknown section must not mean UNCLASSIFIED.
    const r = classifyConsideration({
      text:
        'Quality - Please provide a detailed description and justification of the changes ' +
        'made to the manufacturing process for the drug substance, including updated ' +
        'process validation data.',
      section: null,
      part: 'PART_II',
      memberState: null,
    })
    expect(r.category).toBe('IMPD_QUALITY')
  })

  it('still refuses to guess when the wording carries no signal', () => {
    const r = classifyConsideration({
      text: 'Please confirm receipt of this correspondence.',
      section: null,
      part: null,
      memberState: null,
    })
    expect(r.category).toBe('UNCLASSIFIED')
  })
})

describe('detectFormat', () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
  const webp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  ])

  it('identifies formats from magic bytes, not from a file name', () => {
    expect(detectFormat(pdf)).toBe('pdf')
    expect(detectFormat(png)).toBe('image')
    expect(detectFormat(jpeg)).toBe('image')
    expect(detectFormat(webp)).toBe('image')
  })

  it('rejects anything else', () => {
    expect(detectFormat(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull() // .exe
    expect(detectFormat(new TextEncoder().encode('<html>'))).toBeNull()
    expect(detectFormat(new Uint8Array([]))).toBeNull()
  })
})
