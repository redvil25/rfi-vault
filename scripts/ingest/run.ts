/**
 * Parse a CTIS RFI PDF and print what the ingestion pipeline extracted.
 *
 *   npm run ingest -- fixtures/rfi-example-ctis.pdf
 *   npm run ingest -- <file.pdf> --json
 *
 * Read-only. Nothing is written to the database — committing is the job of the
 * review screen, where a human approves the extraction first.
 */

import '../load-env'
import { readFile } from 'node:fs/promises'
import { extractPdfText } from '../../lib/ingest/extract-pdf'
import { parseCtisRfi } from '../../lib/ingest/parse-ctis'

function truncate(s: string, n: number) {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

async function main() {
  const file = process.argv[2]
  const asJson = process.argv.includes('--json')

  if (!file) {
    console.error('usage: npm run ingest -- <file.pdf> [--json]')
    process.exit(1)
  }

  const bytes = new Uint8Array(await readFile(file))
  const extracted = await extractPdfText(bytes)

  if (extracted.looksScanned) {
    console.error(
      'This PDF appears to be scanned (little or no extractable text). ' +
        'OCR is a known gap — see docs/02-ARCHITECTURE.md §7.',
    )
    process.exit(2)
  }

  const doc = parseCtisRfi(extracted.text)

  if (asJson) {
    console.log(JSON.stringify(doc, null, 2))
    return
  }

  console.log(`\nFile           ${file}`)
  console.log(`Pages          ${extracted.pageCount}`)
  console.log(`Characters     ${extracted.text.length}`)
  console.log('\n--- Document header ---')
  console.log(`Trial number   ${doc.euTrialNumber ?? '(not found)'}`)
  console.log(`Document ref   ${doc.documentRef ?? '(not found)'}`)
  console.log(`Submission     ${doc.submissionType ?? '(not found)'}`)
  console.log(`Issued at      ${doc.issuedAt ?? '(not found)'}`)
  console.log(`Confidence     ${doc.confidence}`)

  if (doc.warnings.length) {
    console.log('\nDocument warnings:')
    for (const w of doc.warnings) console.log(`  ! ${w}`)
  }

  console.log(`\n--- ${doc.considerations.length} considerations ---`)
  for (const c of doc.considerations) {
    console.log(`\n[${c.considerationNumber}] ${c.sectionPart ?? '?'} · ${c.section ?? c.sectionRaw ?? '?'}`)
    console.log(`    member state  ${c.memberState ?? '—'}`)
    console.log(`    document      ${c.documentName ?? '—'}`)
    console.log(`    category      ${c.category} (${c.categoryConfidence})`)
    console.log(`    consideration ${truncate(c.considerationText, 110)}`)
    console.log(`    response      ${c.sponsorResponseText ? truncate(c.sponsorResponseText, 110) : '— none recorded'}`)
    for (const w of c.warnings) console.log(`    ! ${w}`)
  }
  console.log()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
