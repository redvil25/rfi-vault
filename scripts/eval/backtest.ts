/**
 * Backtest of the pre-submission check.
 *
 *   npm run eval:backtest
 *
 * READ THIS BEFORE QUOTING THE NUMBER.
 *
 * The number a buyer wants is "would have caught 61% of Part I regulatory RFIs
 * at an 8% false-positive rate". Half of that sentence is computable here and
 * half is not, and the half that is not cannot be estimated, guessed, or
 * approximated from what this repository holds.
 *
 * `rfi_consideration` contains only requests that *were* raised. The sections
 * that went out and drew no request were never recorded — that is not a gap in
 * our seed script, it is the shape of the source data. So:
 *
 *   RECALL          computable. Of the requests a regulator actually raised,
 *                   what share sits in a theme the check would have surfaced
 *                   for that Member State and section on the day before it was
 *                   raised?
 *   FALSE POSITIVES not computable. There is no negative class. A flag on a
 *                   section that was fine is indistinguishable, in this data,
 *                   from a flag on a section that was not.
 *
 * Quoting recall alone would be dishonest in the other direction — a check that
 * flags everything scores 100% — so this reports recall *and* the flag rate that
 * bought it: how many themes the check would have surfaced per application. A
 * reader can see the trade even though the precision cannot be named.
 *
 * The time-travel matters. Each held-out request is scored against the corpus
 * **as it stood the day before that request was issued**, with the same 12-month
 * staleness window the product applies. Scoring against the whole corpus would
 * let the check learn from the very request it is being tested on, which is the
 * most common way a backtest flatters itself.
 */
import '../load-env'
import { createServiceClient } from '../../lib/db/service'
import { MIN_HITS_FOR_RULE, STALE_AFTER_MONTHS } from '../../lib/precheck/rules'
import { lintSection } from '../../lib/precheck/lint'

/** Requests before this date are corpus only; from here on they are the test set. */
const HOLDOUT_FROM = new Date('2025-09-01T00:00:00Z')

interface Row {
  id: string
  category: string
  section: string
  member_state: string | null
  consideration_text: string
  issued_at: string
  trial_id: string
}

async function main() {
  const db = createServiceClient()

  const { data, error } = await db
    .from('rfi_consideration')
    .select('id, category, section, member_state, consideration_text, trial_id, rfi_document!inner(issued_at)')
    .neq('category', 'UNCLASSIFIED')
    .neq('section', 'UNMAPPED')
    .limit(5000)

  if (error) throw new Error(error.message)

  const rows: Row[] = (data ?? []).map((r) => {
    const doc = r.rfi_document as unknown as { issued_at: string }
    return {
      id: r.id,
      category: r.category,
      section: r.section,
      member_state: r.member_state,
      consideration_text: r.consideration_text,
      trial_id: r.trial_id,
      issued_at: doc.issued_at,
    }
  })

  const holdout = rows.filter((r) => new Date(r.issued_at) >= HOLDOUT_FROM)
  const history = rows.filter((r) => new Date(r.issued_at) < HOLDOUT_FROM)

  console.log(`Corpus        ${rows.length} classified considerations`)
  console.log(`History       ${history.length} issued before ${HOLDOUT_FROM.toISOString().slice(0, 10)}`)
  console.log(`Held out      ${holdout.length} issued on or after that date\n`)

  if (holdout.length === 0 || history.length === 0) {
    console.log('Not enough data on either side of the split to backtest. Run `npm run seed`.')
    process.exit(1)
  }

  // --- Recall of the mined-rule signal, with time travel -------------------
  //
  // The scope ladder is the product's, not a flattering variant of it. Narrow
  // first — this Member State, this section — widening to any Member State only
  // when the narrow scope has nothing live to say, exactly as runPrecheck does.
  // Measuring the narrow scope alone would understate the shipped behaviour;
  // measuring the wide scope alone would overstate it.
  const stats = {
    EXACT: { caught: 0, used: 0 },
    WIDENED: { caught: 0, used: 0 },
    NONE: { used: 0 },
  }
  let caught = 0
  const flagsPerCheck: number[] = []

  for (const target of holdout) {
    const asOf = new Date(target.issued_at)
    const staleBefore = new Date(asOf)
    staleBefore.setUTCMonth(staleBefore.getUTCMonth() - STALE_AFTER_MONTHS)

    // Everything the repository knew the day before this request landed.
    const known = history.filter(
      (h) => new Date(h.issued_at) < asOf && new Date(h.issued_at) >= staleBefore,
    )

    const themesAt = (sameMemberState: boolean) => {
      const counts = new Map<string, number>()
      for (const h of known) {
        if (h.section !== target.section) continue
        if (
          sameMemberState &&
          h.member_state !== null &&
          target.member_state !== null &&
          h.member_state !== target.member_state
        ) {
          continue
        }
        counts.set(h.category, (counts.get(h.category) ?? 0) + 1)
      }
      return [...counts.entries()].filter(([, n]) => n >= MIN_HITS_FOR_RULE).map(([c]) => c)
    }

    let fired = themesAt(true)
    let scope: 'EXACT' | 'WIDENED' | 'NONE' = fired.length > 0 ? 'EXACT' : 'NONE'
    if (fired.length === 0) {
      fired = themesAt(false)
      scope = fired.length > 0 ? 'WIDENED' : 'NONE'
    }

    flagsPerCheck.push(fired.length)
    const hit = fired.includes(target.category)
    if (hit) caught++
    if (scope === 'NONE') stats.NONE.used++
    else {
      stats[scope].used++
      if (hit) stats[scope].caught++
    }
  }

  // --- What the lint alone would have caught -------------------------------
  //
  // Independent of the corpus: it reads the regulator's own wording. A request
  // that quotes the sponsor admitting a gap is one the lint would have seen in
  // the sponsor's draft.
  const lintHits = holdout.filter((r) => lintSection(r.consideration_text).length > 0).length

  const recall = caught / holdout.length
  const meanFlags = flagsPerCheck.reduce((a, b) => a + b, 0) / flagsPerCheck.length

  console.log('MINED RULES (time-travelled, 12-month staleness, product scope ladder)')
  console.log('  NOTE: an upper bound. The shipped check also gates each rule on the dossier')
  console.log('        text — substance, then topic — and history holds no dossier text to')
  console.log('        replay that against. Gating can only lower recall, never raise it.')
  console.log(`  Recall overall         ${(recall * 100).toFixed(1)}%  (${caught}/${holdout.length})`)
  console.log(
    `    at exact scope       ${stats.EXACT.used > 0 ? ((stats.EXACT.caught / stats.EXACT.used) * 100).toFixed(1) : '—'}%  (${stats.EXACT.caught}/${stats.EXACT.used} checks)`,
  )
  console.log(
    `    after widening       ${stats.WIDENED.used > 0 ? ((stats.WIDENED.caught / stats.WIDENED.used) * 100).toFixed(1) : '—'}%  (${stats.WIDENED.caught}/${stats.WIDENED.used} checks)`,
  )
  console.log(`    no live rule at all  ${stats.NONE.used} checks — the check says so rather than passing`)
  console.log(`  Themes surfaced        ${meanFlags.toFixed(1)} per section checked`)
  console.log('\nABSENCE/FUTURITY LINT (independent of the corpus)')
  console.log(
    `  Requests whose own text contains an absence or futurity phrase\n` +
      `                         ${((lintHits / holdout.length) * 100).toFixed(1)}%  (${lintHits}/${holdout.length})`,
  )
  console.log(`
FALSE-POSITIVE RATE: NOT COMPUTABLE.

  This repository holds only requests that were raised. The sections that were
  submitted and drew no request were never recorded, so there is no negative
  class, and any precision, specificity or false-positive figure would be
  invented rather than measured.

  Do not quote the recall figure above on its own. A check that flagged every
  theme would score 100% recall; the "themes surfaced" line is what that recall
  cost, and the two belong in the same sentence.

  To make the missing half computable, a real deployment would record every
  section it checked and whether a request followed. That is a data-collection
  change, not a modelling one.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
