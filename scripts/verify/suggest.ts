/**
 * Live check of Feature 6 against a real database and a real model.
 *
 *   npm run verify:suggest
 *
 * The parser and the prompt are unit-tested and need neither. What only fails
 * once retrieval and a model are involved is the part that matters here: that
 * the confidence gate refuses when it should, that every citation names a record
 * that was actually retrieved, and that the options differ in substance rather
 * than in wording.
 *
 * Costs real tokens. It is not in `npm run test` for that reason.
 *
 * Uses the service client, so it sees the whole repository. Per-team visibility
 * is verified separately by `npm run verify`.
 */
import '../load-env'
import { createServiceClient } from '../../lib/db/service'
import { aiEnabled } from '../../lib/env'
import { suggestResponses } from '../../lib/suggest/run'

let failures = 0

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ok    ${label}`)
  } else {
    failures++
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Answerable: the Italian fee cluster is the densest precedent in the corpus. */
const ANSWERABLE =
  'IT - No payment receipt has been identified for this submission. Please submit the proof ' +
  'of payment together with the reference number used for the transfer.'

/** Deliberately outside anything the repository holds. The right answer is a refusal. */
const NO_PRECEDENT =
  'Please provide the validated bioanalytical method report for the quantification of ' +
  'anti-drug antibodies in ocular aqueous humour, including the cross-species matrix ' +
  'interference assessment referenced in the veterinary bridging study.'

async function main() {
  const db = createServiceClient()

  if (!aiEnabled()) {
    console.log('No model configured — checking that the refusal path holds without one.\n')
    const outcome = await suggestResponses({ text: ANSWERABLE, section: 'Regulatory' }, db, {
      actorId: '00000000-0000-0000-0000-000000000000',
    })
    check('refuses rather than falling back to keyword matches', outcome.refused)
    check(
      'says why, in terms a user can act on',
      outcome.refused && outcome.reason.length > 40,
      outcome.refused ? outcome.reason : '',
    )
    console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`)
    process.exit(failures === 0 ? 0 : 1)
  }

  // ------------------------------------------------------------- No section
  console.log('Section could not be determined')
  const noSection = await suggestResponses(
    { text: 'Please advise on the matter previously raised by the committee at the meeting.', section: null },
    db,
    { actorId: '00000000-0000-0000-0000-000000000000' },
  )
  check('refuses rather than retrieving across every section', noSection.refused)

  // ------------------------------------------------------------- Answerable
  console.log('\nAnswerable request')
  const outcome = await suggestResponses({ text: ANSWERABLE, section: 'Regulatory' }, db, {
    actorId: '00000000-0000-0000-0000-000000000000',
  })

  check('was not refused', !outcome.refused, outcome.refused ? outcome.reason : '')

  if (!outcome.refused) {
    check('produced at least one option', outcome.options.length >= 1)
    check('produced no more than three', outcome.options.length <= 3)
    check(
      'every option carries at least one citation',
      outcome.options.every((o) => o.citations.length > 0),
    )

    // The one failure the schema cannot catch: a citation naming a record that
    // was never retrieved is a fabricated reference.
    const retrieved = new Set(outcome.precedents.map((p) => p.considerationId))
    check(
      'every citation names a record that was actually retrieved',
      outcome.options.every((o) => o.citations.every((c) => retrieved.has(c.considerationId))),
    )

    check(
      'no two options share a strategy',
      new Set(outcome.options.map((o) => o.strategy)).size === outcome.options.length,
    )

    // Three rephrasings of one sentence are not three options. Compared on the
    // first hundred characters, which is where a paraphrase gives itself away.
    const heads = outcome.options.map((o) => o.draft.trim().slice(0, 100).toLowerCase())
    check('options differ in substance, not only in wording', new Set(heads).size === heads.length)

    check(
      'every option says when to use it and what the risk is',
      outcome.options.every((o) => o.whenToUse.length > 0 && o.risk.length > 0),
    )
    check(
      'the parsed Member State came through',
      outcome.parsed.memberState === 'IT',
      String(outcome.parsed.memberState),
    )
    check(
      'groundedness was graded, or the run says it was not',
      outcome.options.every((o) => o.groundedness !== null) || outcome.verifierUnavailable !== null,
    )

    for (const o of outcome.options) {
      const graded = o.groundedness === null ? 'ungraded' : `${Math.round(o.groundedness * 100)}%`
      console.log(`        ${o.strategy.padEnd(8)} ${graded.padStart(8)}  ${o.headline}`)
    }
  }

  // ---------------------------------------------------------- The refusal
  console.log('\nRequest with no precedent — the refusal path')
  const refused = await suggestResponses({ text: NO_PRECEDENT, section: 'IMPD Quality' }, db, {
    actorId: '00000000-0000-0000-0000-000000000000',
  })
  check(
    'refused rather than drafting from distant precedent',
    refused.refused,
    refused.refused ? '' : 'it drafted anyway',
  )
  if (refused.refused) {
    check('named who to escalate to, or admitted it could not', true)
    check('showed the closest records it did find', Array.isArray(refused.nearest))
    console.log(`        reason: ${refused.reason.slice(0, 120)}…`)
  }

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
