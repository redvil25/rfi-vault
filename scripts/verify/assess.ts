/**
 * Live check of Feature 2 against a real database.
 *
 *   npm run verify:assess
 *
 * Unit tests prove the rule engine and the blend in isolation. This proves the
 * parts that only exist once a database is involved: that 0017's functions are
 * present and return what the code expects, that the base-rate signal reflects
 * the actual corpus, and that a missing similarity signal degrades instead of
 * failing.
 *
 * Uses the service client, so it reads the whole repository. RLS is verified
 * separately by `npm run verify`.
 */
import '../load-env'
import { createServiceClient } from '../../lib/db/service'
import { assessDraft } from '../../lib/risk/assess'
import { STARTER_SECTIONS } from '../../app/(app)/assess/starter'
import { aiEnabled } from '../../lib/env'
import type { DraftSectionInput } from '../../lib/risk/types'
import { PART_II_SECTIONS } from '../../lib/domain/taxonomy'

const PART_II = new Set<string>(PART_II_SECTIONS)
const MEMBER_STATES = ['IT', 'ES']

let failures = 0

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ok    ${label}`)
  } else {
    failures++
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function main() {
  const db = createServiceClient()

  const { count } = await db
    .from('rfi_consideration')
    .select('id', { count: 'exact', head: true })
  if (!count) throw new Error('The corpus is empty. Run `npm run seed` first.')
  console.log(`Corpus: ${count} considerations\n`)

  const sections: DraftSectionInput[] = STARTER_SECTIONS.map((s) => ({
    section: s.section,
    sectionPart: PART_II.has(s.section) ? 'PART_II' : 'PART_I',
    content: s.content,
    artefacts: s.artefacts,
    memberStates: MEMBER_STATES,
    submissionType: 'INITIAL',
  }))

  const started = Date.now()
  const result = await assessDraft(sections, 'INITIAL', MEMBER_STATES, db)
  const elapsed = Date.now() - started

  console.log(`Assessed ${result.sections.length} sections in ${elapsed} ms\n`)

  for (const s of result.sections) {
    console.log(
      `  ${s.band.padEnd(6)} ${String(s.score).padStart(3)}  ${s.section}` +
        `   [${s.signalsUsed.join('+')}] coverage ${Math.round(s.coverage * 100)}%`,
    )
    console.log(`         → ${s.recommendedAction}`)
  }
  console.log('')

  const bySection = new Map(result.sections.map((s) => [s.section, s]))

  // --- The worked example must exercise every path -------------------------
  console.log('Assertions:')

  check('every section produced a score', result.sections.length === sections.length)
  check(
    'scores are inside 0–100',
    result.sections.every((s) => s.score >= 0 && s.score <= 100),
  )
  check(
    'sections are returned worst-first',
    result.sections.every(
      (s, i) => i === 0 || result.sections[i - 1].score >= s.score,
    ),
  )

  const regulatory = bySection.get('Regulatory')
  check(
    'a declared-absent fee proof is a finding',
    regulatory?.findings.some((f) => f.ruleId === 'ARTEFACT_FEE_PAYMENT_PROOF') ?? false,
  )
  check(
    'an undeclared artefact is unchecked, not a finding',
    (regulatory?.unchecked.length ?? 0) > 0 &&
      !regulatory?.findings.some((f) => f.ruleId === 'QUIRK_IT_FEE_NATIONAL_UPDATE'),
  )

  const icf = bySection.get('Informed Consent')
  const localFindings = icf?.findings.filter((f) => f.ruleId.startsWith('LOCAL_LANGUAGE_')) ?? []
  check(
    'the national language rule fires for ES only, not IT',
    localFindings.length === 1 && localFindings[0].memberState === 'ES',
    `got ${localFindings.map((f) => f.memberState).join(',') || 'none'}`,
  )

  const protocol = bySection.get('Protocol')
  check(
    'two conflicting versions in the text are caught',
    protocol?.findings.some((f) => f.ruleId === 'CONTENT_VERSION_CONSISTENCY') ?? false,
  )

  const qp = bySection.get('GMP and QP Declaration')
  check(
    'a fully declared section has no checklist finding',
    (qp?.findings.length ?? 1) === 0,
    `findings: ${qp?.findings.map((f) => f.ruleId).join(',')}`,
  )
  check('a clean section still gets an action line', (qp?.recommendedAction.length ?? 0) > 0)

  // --- Signals -------------------------------------------------------------
  check(
    'the base-rate signal came from the database',
    result.sections.every((s) => s.signalsUsed.includes('BASE_RATE')),
    'section_rfi_rates returned nothing — is 0017 applied?',
  )

  if (aiEnabled()) {
    check(
      'the similarity signal ran',
      result.sections.some((s) => s.signalsUsed.includes('SIMILARITY')),
      'embeddings may not be written yet — run `npm run embed`',
    )
  } else {
    check(
      'similarity is omitted, not scored zero, with no model configured',
      result.sections.every((s) => !s.signalsUsed.includes('SIMILARITY')),
    )
    check(
      'the assessment still completed without a model',
      result.sections.every((s) => s.signalsUsed.includes('RULE')),
    )
  }

  console.log('')
  if (failures > 0) {
    console.error(`${failures} check(s) failed.`)
    process.exit(1)
  }
  console.log('All checks passed.')
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
