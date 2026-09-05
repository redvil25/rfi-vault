import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/db/server'
import {
  loadConsideration, loadDrafts, loadHistory, signedSourceUrl,
} from '@/lib/draft/query'
import { CATEGORY_BY_ID, MEMBER_STATE_BY_CODE } from '@/lib/domain/taxonomy'
import { STATUS_LABELS, STATUS_MEANING, availableActions } from '@/lib/workflow/transitions'
import { RfiDetailClient } from './rfi-detail-client'

export const dynamic = 'force-dynamic'

const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'bg-background text-muted',
  IN_REVIEW: 'bg-background text-muted',
  APPROVED: 'bg-ok-soft text-ok',
  SUBMITTED: 'bg-accent-soft text-accent',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default async function RfiDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in')

  const { id } = await params
  const consideration = await loadConsideration(id)

  // A record hidden by RLS and a record that does not exist are the same answer
  // on purpose: telling a user "this exists but is not yours" leaks the fact it
  // exists, which is exactly what read_repository is there to prevent.
  if (!consideration) notFound()

  const [drafts, history, sourceUrl] = await Promise.all([
    loadDrafts(consideration.id),
    loadHistory(consideration.id),
    signedSourceUrl(consideration.sourceFilePath),
  ])

  const taxonomy = CATEGORY_BY_ID.get(consideration.category)
  const memberState = consideration.memberState
    ? MEMBER_STATE_BY_CODE.get(consideration.memberState)
    : null

  const actions = availableActions({
    status: consideration.responseStatus,
    ownerTeam: consideration.ownerTeam,
    actorTeam: user.team,
    hasResponseText: Boolean(consideration.sponsorResponseText?.trim()),
  })

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <nav className="mb-5 text-sm">
        <Link href="/search" className="text-accent hover:underline">
          ← Back to search
        </Link>
      </nav>

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span
            className={`rounded px-2 py-0.5 font-medium ${
              STATUS_STYLE[consideration.responseStatus] ?? 'bg-background text-muted'
            }`}
          >
            {STATUS_LABELS[consideration.responseStatus]}
          </span>
          <span className="font-mono">{consideration.documentRef}</span>
          <span aria-hidden>·</span>
          <span>Consideration {consideration.considerationNumber}</span>
          <span aria-hidden>·</span>
          <span>
            {consideration.sectionPart === 'PART_I' ? 'Part I' : 'Part II'} ·{' '}
            {consideration.section}
          </span>
          {memberState && (
            <>
              <span aria-hidden>·</span>
              <span title={memberState.name}>{memberState.code}</span>
            </>
          )}
        </div>

        <h1 className="mt-2 text-xl font-semibold tracking-tight">
          {taxonomy?.label ?? consideration.category.replaceAll('_', ' ').toLowerCase()}
        </h1>

        <p className="mt-1 text-sm text-muted">
          {consideration.shortTitle} · {consideration.euTrialNumber} · issued{' '}
          {formatDate(consideration.issuedAt)}
          {consideration.dueAt ? ` · due ${formatDate(consideration.dueAt)}` : ''}
        </p>

        <p className="mt-2 text-xs text-muted">
          {STATUS_MEANING[consideration.responseStatus]}
        </p>
      </header>

      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-medium">The consideration, as the regulator wrote it</h2>
        <p className="mt-2.5 text-[13px] leading-relaxed">{consideration.considerationText}</p>

        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-border pt-3 text-xs text-muted">
          <span>
            {consideration.documentName ?? 'no document named'}
            {consideration.sourcePage ? ` · page ${consideration.sourcePage}` : ''}
          </span>
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              Open the source export ↗
            </a>
          ) : (
            <span>Source file not available for this record.</span>
          )}
          {consideration.isSeed && (
            <span className="rounded border border-border px-1.5 py-0.5 text-muted">
              synthetic demonstration record
            </span>
          )}
        </div>
      </section>

      <RfiDetailClient
        consideration={consideration}
        drafts={drafts}
        history={history}
        availableActions={actions}
        canDraft={consideration.responseStatus !== 'SUBMITTED'}
      />
    </div>
  )
}
