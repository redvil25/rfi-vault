import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/db/server'
import { auditParamsSchema, loadAuditEvents } from '@/lib/audit/query'
import { AuditFilters } from './audit-filters'

export const dynamic = 'force-dynamic'

type RawParams = Record<string, string | string[] | undefined>

const ACTION_STYLE: Record<string, string> = {
  INGESTED: 'bg-ok-soft text-ok',
  CORPUS_RESET: 'bg-background text-muted',
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function buildHref(raw: RawParams, page: number) {
  const next = new URLSearchParams()
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && v) next.set(k, v)
  }
  next.set('page', String(page))
  return `/audit?${next.toString()}`
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in')

  const raw = await searchParams
  const parsed = auditParamsSchema.safeParse(raw)

  if (!parsed.success) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-lg font-semibold">Invalid filter</h1>
        <p className="mt-2 text-sm text-muted">
          {parsed.error.issues[0].path.join('.')}: {parsed.error.issues[0].message}
        </p>
        <Link href="/audit" className="mt-4 inline-block text-sm text-accent hover:underline">
          Start over
        </Link>
      </div>
    )
  }

  const result = await loadAuditEvents(parsed.data, user.id)

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Audit trail</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Every state-changing action, in the order it happened. You see your team&rsquo;s
          actions; CTA Management and administrators see all of them.
        </p>
      </header>

      {/*
        The claim worth making out loud to this audience: immutability is a
        database guarantee, not an application promise.
      */}
      <p className="mb-6 rounded-md border border-border bg-surface px-3.5 py-3 text-sm">
        <strong className="font-medium">This table cannot be edited or deleted.</strong>{' '}
        <span className="text-muted">
          <code className="font-mono text-xs">audit_events</code> carries UPDATE, DELETE and
          TRUNCATE triggers that raise an exception — enforced by Postgres, not by this
          application. Corrections are made by appending a compensating event, never by
          changing one. Try it in the SQL console.
        </span>
      </p>

      <div className="border-y border-border py-4">
        <AuditFilters actions={result.actions} active={parsed.data} />
      </div>

      <div className="mt-5 mb-4 flex items-baseline justify-between text-sm">
        <p className="text-muted">
          {result.total === 0 ? (
            'No events'
          ) : (
            <>
              <span className="font-medium text-foreground">
                {result.total.toLocaleString('en-GB')}
              </span>{' '}
              event{result.total === 1 ? '' : 's'}
            </>
          )}
        </p>
      </div>

      {result.total === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-14 text-center">
          <p className="text-sm font-medium">Nothing recorded yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Events appear here as documents are filed and records change. Either nothing has
            happened yet, or none of it was done by your team.
          </p>
          <Link
            href="/ingest"
            className="mt-5 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            File a document
          </Link>
        </div>
      ) : (
        <>
          <ol className="space-y-2">
            {result.events.map((event) => {
              const seeded = event.metadata.seeded === true
              return (
                <li
                  key={event.id}
                  className="rounded-lg border border-border bg-surface px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
                    <span
                      className={`rounded px-1.5 py-0.5 font-medium ${
                        ACTION_STYLE[event.action] ?? 'bg-accent-soft text-accent'
                      }`}
                    >
                      {event.action.replaceAll('_', ' ').toLowerCase()}
                    </span>
                    <span>{event.entityType.replaceAll('_', ' ')}</span>
                    <span aria-hidden>·</span>
                    <span>
                      {event.actorTeam
                        ? event.actorTeam.replaceAll('_', ' ').toLowerCase()
                        : 'system'}
                    </span>
                    {event.isYou && (
                      <span className="rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent">
                        you
                      </span>
                    )}
                    {seeded && (
                      <span className="rounded bg-background px-1.5 py-0.5">
                        corpus generator
                      </span>
                    )}
                    <time dateTime={event.occurredAt} className="ml-auto font-mono">
                      {formatWhen(event.occurredAt)}
                    </time>
                  </div>

                  {event.reason && <p className="mt-2 text-[13px]">{event.reason}</p>}

                  {(event.fromStatus || event.toStatus) && (
                    <p className="mt-1.5 font-mono text-xs text-muted">
                      {event.fromStatus ?? '—'} → {event.toStatus ?? '—'}
                    </p>
                  )}

                  {Object.keys(event.metadata).length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-accent">Detail</summary>
                      <pre className="mt-1.5 overflow-x-auto rounded bg-background p-2.5 text-[11px] leading-relaxed">
                        {JSON.stringify(event.metadata, null, 2)}
                      </pre>
                    </details>
                  )}
                </li>
              )
            })}
          </ol>

          {result.totalPages > 1 && (
            <nav
              aria-label="Pagination"
              className="mt-6 flex items-center justify-between border-t border-border pt-4 text-sm"
            >
              {result.page > 1 ? (
                <Link href={buildHref(raw, result.page - 1)} className="text-accent hover:underline">
                  ← Newer
                </Link>
              ) : (
                <span className="text-muted">← Newer</span>
              )}

              <span className="text-muted">
                Page {result.page} of {result.totalPages}
              </span>

              {result.page < result.totalPages ? (
                <Link href={buildHref(raw, result.page + 1)} className="text-accent hover:underline">
                  Older →
                </Link>
              ) : (
                <span className="text-muted">Older →</span>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  )
}
