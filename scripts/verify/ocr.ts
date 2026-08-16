/**
 * OCR verification against the real scanned fixture.
 *
 *   npm run verify:ocr
 *
 * Kept out of the unit suite deliberately: it runs Tesseract over two rendered
 * pages and takes ~10 seconds. The OCR-tolerance behaviour it depends on is
 * covered by fast string-level tests in lib/ingest/ocr-tolerance.test.ts, which
 * are what CI runs.
 */

import '../load-env'
import { readFile } from 'node:fs/promises'
import { extractDocument } from '../../lib/ingest/extract'
import { parseCtisRfi } from '../../lib/ingest/parse-ctis'

const SCANNED = 'fixtures/rfi-example-scanned.pdf'
const CLEAN = 'fixtures/rfi-example-ctis.pdf'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures++
}

async function main() {
  // --- Scanned PDF: no text layer at all ---------------------------------
  const started = Date.now()
  const scanned = await extractDocument(new Uint8Array(await readFile(SCANNED)))
  if (!scanned.ok) throw new Error(`scanned extraction failed: ${scanned.error}`)
  const took = Date.now() - started

  check('a scanned PDF is read by OCR', scanned.extraction.source === 'OCR_PDF',
    `confidence ${scanned.extraction.ocrConfidence?.toFixed(2)}, ${took} ms`)
  check('OCR confidence is high on a clean scan',
    (scanned.extraction.ocrConfidence ?? 0) > 0.85)

  const doc = parseCtisRfi(scanned.extraction.text)
  check('trial number recovered', doc.euTrialNumber === '2024-519530-24-00', String(doc.euTrialNumber))
  check('document reference recovered despite the column split',
    doc.documentRef === 'CT-2024-519530-24-00-SM06-001', String(doc.documentRef))
  check('submission type recovered', doc.submissionType === 'SUBSTANTIAL_MODIFICATION')
  check('timestamp recovered from the readable page',
    doc.issuedAt === '2026-08-05T12:50:00.000Z', String(doc.issuedAt))
  check('both considerations found', doc.considerations.length === 2, `${doc.considerations.length}`)
  check('Part I / Part II split survived OCR numerals',
    doc.considerations[0]?.sectionPart === 'PART_I' &&
    doc.considerations[1]?.sectionPart === 'PART_II',
    `${doc.considerations[0]?.sectionPart} / ${doc.considerations[1]?.sectionPart}`)
  check('Member State read from the prefix', doc.considerations[0]?.memberState === 'IT')
  check('categories classified',
    doc.considerations[0]?.category === 'FEE_NATIONAL_UPDATE' &&
    doc.considerations[1]?.category === 'IMPD_QUALITY',
    `${doc.considerations[0]?.category} / ${doc.considerations[1]?.category}`)
  check('the repeated page header did not bleed into a field',
    !doc.considerations.some((c) =>
      /Requests for information|SUBSTANTIAL/i.test(c.considerationText + (c.sponsorResponseText ?? ''))))

  // --- Clean PDF: OCR must NOT be used -----------------------------------
  const clean = await extractDocument(new Uint8Array(await readFile(CLEAN)))
  if (!clean.ok) throw new Error(`clean extraction failed: ${clean.error}`)
  check('a text-layer PDF is read exactly, not by OCR',
    clean.extraction.source === 'TEXT_LAYER' && clean.extraction.ocrConfidence === null)
  check('the clean fixture still parses perfectly',
    parseCtisRfi(clean.extraction.text).confidence === 1)

  // --- Rejections ---------------------------------------------------------
  const notADocument = await extractDocument(new TextEncoder().encode('just some text'))
  check('a non-PDF, non-image file is refused', !notADocument.ok)

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
