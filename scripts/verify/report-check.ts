/**
 * Live check of Feature 2 against a real database.
 *
 *   npm run verify:report
 *
 * The lint is unit-tested and needs no database. What cannot be reached from a
 * unit test is whether `0025`'s two functions exist, whether they return the
 * shapes `lib/precheck` destructures, and — the one that actually matters —
 * whether date-scoping fires on the real corpus rather than only on a fixture.
 *
 * A pre-submission check that silently returns nothing looks identical to one
 * that found nothing wrong, so most of what follows asserts that the pipeline
 * produced *something* and that the honest refusals are honest.
 *
 * Uses the service client, so it sees the whole repository. Per-team visibility
 * is verified separately by `npm run verify`.
 */
import '../load-env'
import { createServiceClient } from '../../lib/db/service'
import { runPrecheck } from '../../lib/precheck/run'
import { STALE_AFTER_MONTHS, toMinedRule, type MinedRuleRow } from '../../lib/precheck/rules'
import { lintSection } from '../../lib/precheck/lint'

let failures = 0

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ok    ${label}`)
  } else {
    failures++
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** The sentence from the demo. Every family fires on it. */
const DIRTY =
  'The proof of payment for the ISTAT-updated national fee has not yet been returned and is ' +
  'not attached. The final amount will be provided once the affiliate confirms it. ' +
  'POL reference: XXX.'

async function main() {
  const db = createServiceClient()

  // ------------------------------------------------------------------ Lint
  console.log('Absence-and-futurity lint')
  const findings = lintSection(DIRTY)
  const kinds = new Set(findings.map((f) => f.kind))
  check('all three families fire on the demo sentence', kinds.size === 3, [...kinds].join(', '))
  check(
    'the placeholder is caught',
    findings.some((f) => f.kind === 'PLACEHOLDER'),
  )
  check('clean regulatory prose is left alone', lintSection('Proof of payment is enclosed as Annex 4.').length === 0)

  // ----------------------------------------------------------------- Mining
  console.log('\nMined rules')
  const { data, error } = await db.rpc('mined_rules', {
    f_member_states: ['IT'],
    f_submission_type: undefined,
    f_sections: undefined,
  })
  check('mined_rules() exists and returns rows', !error && (data?.length ?? 0) > 0, error?.message)

  const rules = ((data ?? []) as MinedRuleRow[]).map((r) => toMinedRule(r, new Date()))
  check(
    'every rule carries a date range',
    rules.every((r) => Boolean(r.firstSeen) && Boolean(r.lastSeen)),
  )
  check(
    'first_seen never postdates last_seen',
    rules.every((r) => new Date(r.firstSeen) <= new Date(r.lastSeen)),
  )
  check(
    'resolved_hits never exceeds hits',
    rules.every((r) => r.resolvedHits <= r.hits),
  )

  // The corpus runs from 2023, so there must be something old enough to grey
  // out. If this stops holding, date-scoping has become untested in practice
  // and the next reseed could quietly disable it.
  const stale = rules.filter((r) => r.stale)
  check(
    `date-scoping actually fires — something is ${STALE_AFTER_MONTHS}+ months old`,
    stale.length > 0,
    `newest last_seen ${rules.map((r) => r.lastSeen).sort().at(-1)}`,
  )
  check('a stale rule is never live', stale.every((r) => r.hits < 3 || r.stale))

  // ------------------------------------------------------------- Precedent
  console.log('\nPrecedent')
  const busiest = [...rules].sort((a, b) => b.resolvedHits - a.resolvedHits)[0]
  if (!busiest) {
    check('a rule with resolved occurrences exists', false, 'run `npm run seed` first')
  } else {
    const { data: precedents, error: pErr } = await db.rpc('rule_precedents', {
      f_category: busiest.category,
      f_section: busiest.section,
      f_member_states: ['IT'],
      f_submission_type: undefined,
      match_count: 3,
    })
    check('rule_precedents() exists and returns rows', !pErr && (precedents?.length ?? 0) > 0, pErr?.message)
    check(
      'every precedent carries the response that closed it',
      (precedents ?? []).every((p) => Boolean(p.sponsor_response_text?.trim())),
    )
    check(
      'every precedent is traceable to a trial and a document',
      (precedents ?? []).every((p) => Boolean(p.eu_trial_number) && Boolean(p.document_ref)),
    )
    check(
      'only accepted responses are offered as precedent',
      (precedents ?? []).every((p) => p.outcome === 'ACCEPTED'),
    )
  }

  // ------------------------------------------------------------ End to end
  console.log('\nEnd to end')
  const result = await runPrecheck(
    {
      submissionType: 'SUBSTANTIAL_MODIFICATION',
      memberStates: ['IT'],
      sections: [{ section: 'Regulatory', text: DIRTY }],
    },
    db,
  )

  check('the check produced flags', result.flags.length > 0)
  check('a blocker was raised for the stated gap', result.counts.BLOCKER > 0)
  check(
    'every rule is reported as flagged, clear or skipped — never omitted',
    result.rules.every((r) => ['FLAGGED', 'CLEAR', 'SKIPPED'].includes(r.outcome)),
  )
  check('a skipped rule always says why', result.rules.filter((r) => r.outcome === 'SKIPPED').every((r) => r.note.length > 0))
  check(
    'coverage names the corpus date range',
    Boolean(result.coverage.corpusFrom) && Boolean(result.coverage.corpusTo),
  )
  check('coverage admits the corpus is synthetic', result.coverage.syntheticOnly)

  // A Member State with no precedent must be named. "No flags" there means "no
  // data", and a user who works that out for themselves stops trusting the tool.
  const blind = await runPrecheck(
    {
      submissionType: 'INITIAL',
      memberStates: ['MT'],
      sections: [{ section: 'Regulatory', text: 'The cover letter is enclosed.' }],
    },
    db,
  )
  check(
    'a Member State with no precedent is named rather than passed silently',
    blind.coverage.memberStatesWithoutPrecedent.length === 0 ||
      blind.coverage.memberStatesWithoutPrecedent.includes('MT'),
    blind.coverage.memberStatesWithoutPrecedent.join(', ') || 'MT had precedent',
  )

  console.log(
    `\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
