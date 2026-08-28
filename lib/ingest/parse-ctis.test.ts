import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parseCtisRfi, normaliseSection } from './parse-ctis'
import { extractPdfText } from './extract-pdf'

const FIXTURE = 'fixtures/rfi-example-ctis.pdf'

/**
 * Minimal CTIS block, written the way the real export writes it: labels on
 * their own lines, and "Application section parts" WITHOUT a colon while the
 * neighbouring labels have one.
 */
function block(opts: {
  n: string
  parts?: string
  doc?: string
  consideration: string
  response?: string
}) {
  return [
    'Consideration number:',
    opts.n,
    'Application section parts',
    opts.parts ?? 'Part I - Regulatory',
    'Application section and document:',
    opts.doc ?? 'Cover letter',
    'Consideration:',
    opts.consideration,
    'Sponsor response:',
    opts.response ?? '',
  ].join('\n')
}

const HEADER =
  '2024-519530-24-00 SUBSTANTIAL MODIFICATION ' +
  'CT-2024-519530-24-00-SM06-001 - Requests for information05/08/2026 12:53'

describe('parseCtisRfi — document header', () => {
  it('extracts trial number, document reference, submission type and timestamp', () => {
    const doc = parseCtisRfi(
      `${HEADER}\n${block({ n: '1', consideration: 'IT - Please upload the proof of payment.' })}`,
    )

    expect(doc.euTrialNumber).toBe('2024-519530-24-00')
    expect(doc.documentRef).toBe('CT-2024-519530-24-00-SM06-001')
    expect(doc.submissionType).toBe('SUBSTANTIAL_MODIFICATION')
    expect(doc.issuedAt).toBe('2026-08-05T12:53:00.000Z')
  })

  it('reads the timestamp even when it abuts the preceding word', () => {
    // Regression: the header renders as "...information05/08/2026 12:53" with no
    // space, so a \b anchor before the day never matches.
    expect(parseCtisRfi(`x information05/08/2026 12:53\n${block({ n: '1', consideration: 'a' })}`).issuedAt)
      .toBe('2026-08-05T12:53:00.000Z')
  })

  it('falls back to the SM infix when the words are absent', () => {
    const doc = parseCtisRfi(
      `2024-519530-24-00 CT-2024-519530-24-00-SM06-001\n${block({ n: '1', consideration: 'a' })}`,
    )
    expect(doc.submissionType).toBe('SUBSTANTIAL_MODIFICATION')
  })

  it('warns rather than throws on a document that is not a CTIS export', () => {
    const doc = parseCtisRfi('Dear sponsor,\n\nPlease find attached our invoice.\n')
    expect(doc.considerations).toHaveLength(0)
    expect(doc.confidence).toBeLessThan(0.3)
    expect(doc.warnings.join(' ')).toMatch(/may not be a CTIS RFI export/i)
  })
})

describe('parseCtisRfi — considerations', () => {
  it('splits multiple blocks and keeps their numbering', () => {
    const doc = parseCtisRfi(
      [
        HEADER,
        block({ n: '1', consideration: 'IT - Please upload the proof of payment.' }),
        block({ n: '2', parts: 'Part II - Informed consent', consideration: 'ES - Translation missing.' }),
        block({ n: '3', consideration: 'The QP declaration is not signed.' }),
      ].join('\n'),
    )

    expect(doc.considerations.map((c) => c.considerationNumber)).toEqual([1, 2, 3])
  })

  it('reads the Member State from the prefix, and only when it is a real code', () => {
    const doc = parseCtisRfi(
      [
        HEADER,
        block({ n: '1', consideration: 'IT - Proof of payment missing.' }),
        block({ n: '2', consideration: 'The QP declaration is not signed.' }),
        block({ n: '3', consideration: 'ZZ - Something from nowhere.' }),
      ].join('\n'),
    )

    expect(doc.considerations[0].memberState).toBe('IT')
    expect(doc.considerations[1].memberState).toBeNull()
    expect(doc.considerations[2].memberState).toBeNull()
    expect(doc.considerations[2].warnings.join(' ')).toMatch(/not a known Member State/i)
  })

  it('treats an empty sponsor response as unanswered rather than empty string', () => {
    const doc = parseCtisRfi(
      `${HEADER}\n${block({ n: '1', consideration: 'Stability data do not cover the shelf life.', response: '' })}`,
    )
    expect(doc.considerations[0].sponsorResponseText).toBeNull()
  })

  it('joins lines wrapped by the PDF renderer back into one field', () => {
    const doc = parseCtisRfi(
      [
        HEADER,
        'Consideration number:',
        '1',
        'Application section parts',
        'Part I - Regulatory',
        'Application section and document:',
        'Cover letter',
        'Consideration:',
        'IT - Please upload the proof of payment of the additional amount',
        'required by law for all applications submitted starting from',
        '17 February 2025 due to ISTAT updated fee.',
        'Sponsor response:',
        'Proof of payment of the additional amount required is provided.',
      ].join('\n'),
    )

    expect(doc.considerations[0].considerationText).toBe(
      'IT - Please upload the proof of payment of the additional amount required by law ' +
        'for all applications submitted starting from 17 February 2025 due to ISTAT updated fee.',
    )
  })

  it('ignores a repeated page header landing inside a block', () => {
    const doc = parseCtisRfi(
      [
        HEADER,
        'Consideration number:',
        '1',
        'Application section parts',
        'Part I - Regulatory',
        'Application section and document:',
        'Cover letter',
        'Consideration:',
        'The stability data do not cover the proposed shelf life.',
        HEADER, // page break
        'Please provide supporting data.',
        'Sponsor response:',
        'Additional stability data are provided.',
      ].join('\n'),
    )

    expect(doc.considerations[0].considerationText).not.toMatch(/Requests for information/)
    expect(doc.considerations[0].considerationText).toBe(
      'The stability data do not cover the proposed shelf life. Please provide supporting data.',
    )
  })
})

describe('parseCtisRfi — inline field labels', () => {
  /**
   * Regression. An export whose fields render as "label: value" on one line
   * parsed its header perfectly and produced zero considerations, so the review
   * screen offered to file a document with nothing in it.
   */
  const INLINE = [
    HEADER,
    'Consideration number: 1',
    'Application section parts: Part I - Regulatory',
    'Application section and document: Cover letter',
    'Consideration: IT - Please upload the proof of payment of the additional amount.',
    'Sponsor response: Proof of payment is provided.',
    'Consideration number: 2',
    'Application section parts: Part II - Informed consent',
    'Application section and document: Informed consent form',
    'Consideration: ES - The informed consent form is provided in English only.',
    'Sponsor response: The Spanish version is provided.',
  ].join('\n')

  it('reads a block whose values sit on the same line as their labels', () => {
    const doc = parseCtisRfi(INLINE)

    expect(doc.considerations).toHaveLength(2)
    expect(doc.considerations[0].considerationNumber).toBe(1)
    expect(doc.considerations[0].sectionPart).toBe('PART_I')
    expect(doc.considerations[0].section).toBe('Regulatory')
    expect(doc.considerations[0].memberState).toBe('IT')
    expect(doc.considerations[0].considerationText).toBe(
      'IT - Please upload the proof of payment of the additional amount.',
    )
    expect(doc.considerations[0].sponsorResponseText).toBe('Proof of payment is provided.')
    expect(doc.considerations[1].sectionPart).toBe('PART_II')
    expect(doc.considerations[1].memberState).toBe('ES')
  })

  it('continues an inline field onto the wrapped lines that follow it', () => {
    const doc = parseCtisRfi(
      [
        HEADER,
        'Consideration number: 1',
        'Consideration: The stability data provided do not cover the proposed',
        'shelf life of 36 months.',
        'Sponsor response: Additional data are provided.',
      ].join('\n'),
    )

    expect(doc.considerations[0].considerationText).toBe(
      'The stability data provided do not cover the proposed shelf life of 36 months.',
    )
  })

  it('does not mistake consideration prose for a label', () => {
    // "Consideration of ..." has no colon, so it is text and not a field label.
    // Without that rule the sentence below is truncated at "Consideration".
    const doc = parseCtisRfi(
      [
        HEADER,
        'Consideration number:',
        '1',
        'Consideration:',
        'Consideration of the benefit-risk balance is required before approval.',
        'Sponsor response:',
        'An updated assessment is provided.',
      ].join('\n'),
    )

    expect(doc.considerations).toHaveLength(1)
    expect(doc.considerations[0].considerationText).toBe(
      'Consideration of the benefit-risk balance is required before approval.',
    )
  })

  it('accepts the spellings a different exporter produces', () => {
    const doc = parseCtisRfi(
      [
        HEADER,
        'Consideration No. 1',
        "Sponsor's response: Provided.",
      ].join('\n'),
    )

    expect(doc.considerations).toHaveLength(1)
    expect(doc.considerations[0].considerationNumber).toBe(1)
    expect(doc.considerations[0].sponsorResponseText).toBe('Provided.')
  })
})

describe('parseCtisRfi — issue date', () => {
  it('refuses an out-of-range timestamp rather than rolling it over', () => {
    // Date.UTC turns 45/13/2026 into a real date in 2027. A wrong issue date is
    // worse than a missing one: it reaches the audit trail and the analytics.
    expect(parseCtisRfi(`x 45/13/2026 99:99\n${block({ n: '1', consideration: 'a' })}`).issuedAt)
      .toBeNull()
  })

  it('refuses a day that does not exist in that month', () => {
    expect(parseCtisRfi(`x 31/02/2026 10:00\n${block({ n: '1', consideration: 'a' })}`).issuedAt)
      .toBeNull()
  })

  it('accepts a real leap day', () => {
    expect(parseCtisRfi(`x 29/02/2024 10:00\n${block({ n: '1', consideration: 'a' })}`).issuedAt)
      .toBe('2024-02-29T10:00:00.000Z')
  })
})

describe('normaliseSection', () => {
  it('maps the export wording onto the canonical taxonomy', () => {
    expect(normaliseSection('Informed consent', 'PART_II')).toBe('Informed Consent')
    expect(normaliseSection('Recruitment arrangements', 'PART_II')).toBe(
      'Subject Recruitment Arrangements',
    )
    expect(normaliseSection('IMPD Quality', 'PART_I')).toBe('IMPD Quality')
    expect(normaliseSection('Regulatory', 'PART_I')).toBe('Regulatory')
  })

  it('returns null for wording it cannot place, rather than guessing', () => {
    expect(normaliseSection('Something entirely unrelated', 'PART_I')).toBeNull()
    expect(normaliseSection(null, 'PART_I')).toBeNull()
  })
})

describe('integration — the real fixture PDF', () => {
  it('parses every field of the five-consideration export with no warnings', async () => {
    const bytes = new Uint8Array(await readFile(FIXTURE))
    const extracted = await extractPdfText(bytes)

    expect(extracted.pageCount).toBe(2)
    expect(extracted.looksScanned).toBe(false)

    const doc = parseCtisRfi(extracted.text)

    expect(doc.euTrialNumber).toBe('2024-519530-24-00')
    expect(doc.documentRef).toBe('CT-2024-519530-24-00-SM06-001')
    expect(doc.submissionType).toBe('SUBSTANTIAL_MODIFICATION')
    expect(doc.issuedAt).toBe('2026-08-05T12:53:00.000Z')
    expect(doc.warnings).toEqual([])
    expect(doc.confidence).toBe(1)

    expect(
      doc.considerations.map((c) => ({
        n: c.considerationNumber,
        part: c.sectionPart,
        section: c.section,
        ms: c.memberState,
        category: c.category,
        answered: c.sponsorResponseText !== null,
      })),
    ).toEqual([
      { n: 1, part: 'PART_I',  section: 'Regulatory',                       ms: 'IT', category: 'FEE_NATIONAL_UPDATE',  answered: true },
      { n: 2, part: 'PART_II', section: 'Informed Consent',                 ms: 'ES', category: 'ICF_LOCAL_LANGUAGE',   answered: true },
      { n: 3, part: 'PART_I',  section: 'IMPD Quality',                     ms: null, category: 'IMPD_QUALITY',         answered: false },
      { n: 4, part: 'PART_II', section: 'Subject Recruitment Arrangements', ms: 'PL', category: 'RECRUITMENT_MATERIAL', answered: true },
      { n: 5, part: 'PART_I',  section: 'Regulatory',                       ms: null, category: 'GMP_QP_DECLARATION',   answered: true },
    ])

    // The ISTAT consideration must survive intact, URL and all — it is the
    // anchor example for the whole project.
    expect(doc.considerations[0].considerationText).toContain('ISTAT updated fee')
    expect(doc.considerations[0].considerationText).toContain('aifa.gov.it')
    expect(doc.considerations[0].sponsorResponseText).toBe(
      'Proof of payment of the additional amount required is provided.',
    )

    expect(doc.considerations.flatMap((c) => c.warnings)).toEqual([])
  })
})
