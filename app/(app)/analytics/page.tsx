import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/db/server'
import { loadAnalytics } from '@/lib/analytics/query'
import { EffortModel, MemberStateChart, VolumeChart } from './charts'

export const dynamic = 'force-dynamic'

export default async function AnalyticsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in')

  const stats = await loadAnalytics()

  if (stats.empty) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
        <div className="mt-6 rounded-lg border border-dashed border-border bg-surface px-6 py-14 text-center">
          <p className="text-sm font-medium">Nothing to analyse yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Either the repository is empty, or your team cannot yet read any of it. File a
            document, or run <span className="font-mono text-xs">npm run seed</span>.
          </p>
          <Link
            href="/ingest"
            className="mt-5 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            File a document
          </Link>
        </div>
      </div>
    )
  }

  // `turnaround` and `total` are still computed by loadAnalytics — verify:dashboards
  // asserts them and they carry their own unit tests — but nothing on this page
  // renders them since the stat cards were removed.
  const { categories, months, memberStates, preventability } = stats

  // Worst-first by how many *distinct trials* an issue touched: 40 occurrences in
  // one trial is a bad month, 40 across 35 trials is a systemic problem.
  const recurring = [...categories]
    .sort((a, b) => b.distinctTrials - a.distinctTrials || b.occurrences - a.occurrences)
    .slice(0, 10)

  const worst = recurring[0]

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          What the repository knows about its own contents. Every figure below is filtered by
          your team&rsquo;s access, so two people can legitimately see different totals.
        </p>
      </header>

      {/* ------------------------------------------------------- Recurrence */}
      <section className="mt-8">
        <h2 className="text-base font-semibold">What keeps coming back</h2>
        <p className="mt-1 mb-4 max-w-2xl text-sm text-muted">
          Sorted by how many <strong className="font-medium">distinct trials</strong> an issue
          touched, not by raw count.{' '}
          {worst && (
            <>
              {worst.label} has been raised {worst.occurrences} times across{' '}
              {worst.distinctTrials} separate trials in {worst.memberStates} Member States —
              that is the same answer being written from scratch, repeatedly.
            </>
          )}
        </p>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-left text-[11px] tracking-wide text-muted uppercase">
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">Tier</th>
                <th className="px-4 py-2.5 text-right font-medium">Raised</th>
                <th className="px-4 py-2.5 text-right font-medium">Distinct trials</th>
                <th className="px-4 py-2.5 text-right font-medium">Member States</th>
                <th className="px-4 py-2.5 text-right font-medium">Still open</th>
              </tr>
            </thead>
            <tbody>
              {recurring.map((c) => (
                <tr key={c.category} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/search?category=${encodeURIComponent(c.category)}`}
                      className="text-accent hover:underline"
                    >
                      {c.label}
                    </Link>
                    {c.preventable && (
                      <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                        preventable
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{c.tier || '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{c.occurrences}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{c.distinctTrials}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{c.memberStates}</td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {c.openItems > 0 ? c.openItems : <span className="text-muted">0</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ----------------------------------------------------------- Trend */}
      <section className="mt-8">
        <h2 className="text-base font-semibold">Considerations raised per month</h2>
        <p className="mt-1 mb-3 text-sm text-muted">
          By the date the request was issued.
        </p>
        <div className="rounded-lg border border-border bg-surface p-4">
          <VolumeChart months={months} />
        </div>
      </section>

      {/* --------------------------------------------------- Member States */}
      <section className="mt-8">
        <h2 className="text-base font-semibold">Where requests come from</h2>
        <p className="mt-1 mb-3 text-sm text-muted">
          By the Member State recorded against each consideration. A consideration with
          no Member State would be excluded; in this corpus every one carries a code.
        </p>
        <div className="rounded-lg border border-border bg-surface p-4">
          <MemberStateChart states={memberStates} />
        </div>
      </section>

      {/* ------------------------------------------------------ Effort model */}
      <section className="mt-8 mb-4">
        <h2 className="text-base font-semibold">What that is worth</h2>
        <p className="mt-1 mb-3 text-sm text-muted">
          Move the assumptions and watch the range move.
        </p>
        <div className="rounded-lg border border-border bg-surface p-5">
          <EffortModel preventableShare={preventability.share} />
        </div>
      </section>
    </div>
  )
}
