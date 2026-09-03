/**
 * Live check of Features 4 and 5 against a real database.
 *
 *   npm run verify:dashboards
 *
 * These two pages are almost entirely database reads, so a green typecheck says
 * very little about them. This asserts the things that only fail once real rows
 * are involved: that 0019's functions exist and return what the code expects,
 * that the taxonomy join lands on every category, and that the audit trail is
 * genuinely immutable rather than merely documented as such.
 *
 * Uses the service client, so it sees the whole repository. Per-team visibility
 * is verified separately by `npm run verify`.
 */
import '../load-env'
import { createServiceClient } from '../../lib/db/service'
import { loadAnalytics } from '../../lib/analytics/query'
import { auditParamsSchema, loadAuditEvents } from '../../lib/audit/query'

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

  // ------------------------------------------------------------- Analytics
  console.log('Analytics')
  const stats = await loadAnalytics(db)

  check('the snapshot is not empty', !stats.empty, 'run `npm run seed` first')
  check('categories came back', stats.categories.length > 0)
  // A category outside the taxonomy is expected — the classifier returns
  // UNCLASSIFIED rather than guessing, and ingestion files that honestly. What
  // must hold is that such volume is *reported* rather than folded into the
  // shares as though it had been judged. Asserting "every category resolves"
  // would make an honest refusal look like a defect and push the next person
  // to make the classifier guess.
  const unresolved = stats.categories.filter((c) => c.tier === null)
  check(
    'unclassified volume is counted, not silently tiered',
    unresolved.reduce((sum, c) => sum + c.occurrences, 0) === stats.preventability.unclassified,
    unresolved.map((c) => `${c.category} (${c.occurrences})`).join(', ') || undefined,
  )
  check(
    'the shares are taken over classified volume only',
    stats.preventability.classified === stats.total - stats.preventability.unclassified,
  )
  check(
    'every classified category resolved against the taxonomy',
    stats.categories.every((c) => c.tier === null || c.tier > 0),
  )
  check(
    'occurrences are never fewer than distinct trials',
    stats.categories.every((c) => c.occurrences >= c.distinctTrials),
  )
  check('the totals agree with the category sum', stats.preventability.total === stats.total)
  check(
    'the preventable share is a proportion',
    stats.preventability.share >= 0 && stats.preventability.share <= 1,
  )
  check('monthly history came back', stats.months.length > 0)
  check(
    'monthly volume sums to the total',
    stats.months.reduce((sum, m) => sum + m.occurrences, 0) === stats.total,
    `months ${stats.months.reduce((s, m) => s + m.occurrences, 0)} vs total ${stats.total}`,
  )
  check('Member State breakdown came back', stats.memberStates.length > 0)
  check('turnaround statistics came back', stats.turnaround !== null)
  if (stats.turnaround) {
    const t = stats.turnaround
    check('median turnaround is a real number', t.medianDays !== null && t.medianDays > 0)
    check(
      'p90 is at least the median',
      t.p90Days !== null && t.medianDays !== null && t.p90Days >= t.medianDays,
    )
    check('late answers never exceed answered', t.answeredLate <= t.answered)
  }

  const worst = [...stats.categories].sort((a, b) => b.distinctTrials - a.distinctTrials)[0]
  console.log(
    `\n  Recurrence headline: ${worst.label} — ${worst.occurrences} times across ` +
      `${worst.distinctTrials} distinct trials in ${worst.memberStates} Member States`,
  )
  console.log(
    `  Preventable: ${Math.round(stats.preventability.share * 100)}% · ` +
      `Tier 1–2: ${Math.round(stats.preventability.tier12Share * 100)}% · ` +
      `over ${stats.preventability.classified} classified of ${stats.total}` +
      (stats.preventability.unclassified > 0
        ? ` (${stats.preventability.unclassified} unclassified, excluded)`
        : '') +
      '\n',
  )

  // ----------------------------------------------------------------- Audit
  console.log('Audit trail')
  const params = auditParamsSchema.parse({})
  const audit = await loadAuditEvents(params, 'nobody', db)

  check('events came back', audit.total > 0, 'the seed should have written an INGESTED trail')
  check('a page of events was returned', audit.events.length > 0)
  check('actions were collected for the filter', audit.actions.length > 0)
  check(
    'events are newest first',
    audit.events.every(
      (e, i) => i === 0 || audit.events[i - 1].occurredAt >= e.occurredAt,
    ),
  )
  check(
    'every event names what it acted on',
    audit.events.every((e) => e.entityType.length > 0 && e.action.length > 0),
  )

  const filtered = await loadAuditEvents(
    auditParamsSchema.parse({ action: 'INGESTED' }),
    'nobody',
    db,
  )
  check(
    'filtering by action narrows the result',
    filtered.events.every((e) => e.action === 'INGESTED') && filtered.total <= audit.total,
  )

  // The property the whole feature rests on. Documented in three places; here it
  // is actually attempted.
  const target = audit.events[0]
  if (target) {
    const { error: updateError } = await db
      .from('audit_events')
      .update({ reason: 'tampered' })
      .eq('id', target.id)
    check(
      'UPDATE on audit_events is refused by the database',
      Boolean(updateError) && /append-only/i.test(updateError?.message ?? ''),
      updateError ? updateError.message : 'the update SUCCEEDED — immutability is broken',
    )

    const { error: deleteError } = await db.from('audit_events').delete().eq('id', target.id)
    check(
      'DELETE on audit_events is refused by the database',
      Boolean(deleteError) && /append-only/i.test(deleteError?.message ?? ''),
      deleteError ? deleteError.message : 'the delete SUCCEEDED — immutability is broken',
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
