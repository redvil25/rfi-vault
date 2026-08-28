'use client'

import Link from 'next/link'
import { useActionState, useState, useTransition } from 'react'
import type { ConsiderationDetail, HistoryEvent, StoredDraft } from '@/lib/draft/query'
import type { DraftOutcome, SentenceVerdict, Verdict } from '@/lib/draft/types'
import { TRANSITIONS, type WorkflowAction } from '@/lib/workflow/transitions'
import { draftAction, transitionAction, type TransitionState } from './actions'

const VERDICT_STYLE: Record<Verdict, string> = {
  SUPPORTED: '',
  PARTIAL: 'underline decoration-warn decoration-wavy decoration-2 underline-offset-4',
  UNSUPPORTED: 'underline decoration-risk decoration-wavy decoration-2 underline-offset-4',
}

const VERDICT_TITLE: Record<Verdict, string> = {
  SUPPORTED: 'Supported by the cited precedent.',
  PARTIAL: 'Partially supported — this goes slightly beyond what the precedent establishes.',
  UNSUPPORTED: 'No precedent supports this. Rewrite it or delete it.',
}

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-24">
      <p className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-0.5 font-mono text-sm">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  )
}

/**
 * Renders the draft with the verifier's grading applied in place.
 *
 * The amber and red underlines are the point of the screen. A reviewer should be
 * able to see, without reading the citations, which sentences the model could
 * not support — and if the verifier did not run, they should see that too rather
 * than a clean-looking draft that was never checked.
 */
function GradedDraft({ draft, verdicts }: { draft: string; verdicts: SentenceVerdict[] }) {
  if (verdicts.length === 0) {
    return <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{draft}</p>
  }

  return (
    <p className="text-[13px] leading-relaxed">
      {verdicts.map((v, i) => (
        <span key={`${i}-${v.sentence.slice(0, 24)}`} className={VERDICT_STYLE[v.verdict]} title={VERDICT_TITLE[v.verdict]}>
          {v.sentence}{' '}
        </span>
      ))}
    </p>
  )
}

function Citations({
  citations,
}: {
  citations: { considerationId: string; supportsClaim: string }[]
}) {
  if (citations.length === 0) return null
  return (
    <div className="mt-4">
      <h4 className="text-[11px] font-medium tracking-wide text-muted uppercase">
        Citations — every claim traced to a record
      </h4>
      <ul className="mt-2 space-y-2">
        {citations.map((c) => (
          <li key={`${c.considerationId}-${c.supportsClaim.slice(0, 20)}`} className="text-[13px]">
            <Link
              href={`/rfi/${c.considerationId}`}
              className="font-mono text-xs text-accent hover:underline"
            >
              {c.considerationId.slice(0, 8)}
            </Link>{' '}
            <span className="text-muted">supports</span> {c.supportsClaim}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Deltas({ deltas }: { deltas: StoredDraft['deltas'] }) {
  if (deltas.length === 0) {
    return (
      <p className="mt-4 text-[13px] text-muted">
        No material differences from the precedents were found.
      </p>
    )
  }

  return (
    <div className="mt-4">
      <h4 className="text-[11px] font-medium tracking-wide text-muted uppercase">
        Differences from precedent — check each before sending
      </h4>
      <ul className="mt-2 space-y-2">
        {deltas.map((d, i) => (
          <li key={`${d.dimension}-${i}`} className="rounded-md bg-warn-soft/40 px-3 py-2 text-[13px]">
            <span className="text-[11px] font-medium tracking-wide text-warn uppercase">
              {d.dimension.replaceAll('_', ' ').toLowerCase()}
            </span>
            <p className="mt-1">
              <span className="text-muted">precedent:</span> {d.precedentValue}
            </p>
            <p>
              <span className="text-muted">this request:</span> {d.currentValue}
            </p>
            <p className="mt-1 font-medium">{d.reviewerAction}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DraftPanel({
  outcome,
  onUse,
}: {
  outcome: Extract<DraftOutcome, { refused: false }>
  onUse: (text: string) => void
}) {
  return (
    <div className="mt-4 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap gap-6 border-b border-border pb-3">
        <Stat
          label="Groundedness"
          value={percent(outcome.groundedness)}
          hint={outcome.verifierUnavailable ? 'not graded' : 'verified sentence by sentence'}
        />
        <Stat label="Closest precedent" value={outcome.maxSimilarity.toFixed(2)} hint="cosine" />
        <Stat label="Model confidence" value={percent(outcome.confidence)} hint="self-reported" />
        <Stat
          label="Precedents used"
          value={String(outcome.precedents.length)}
          hint={`${outcome.citations.length} cited`}
        />
      </div>

      {outcome.verifierUnavailable && (
        <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          This draft is <strong className="font-medium">ungraded</strong> —{' '}
          {outcome.verifierUnavailable}. Read every sentence against the citations yourself.
        </p>
      )}

      <div className="mt-4">
        <GradedDraft draft={outcome.draft} verdicts={outcome.verdicts} />
      </div>

      {outcome.verdicts.some((v) => v.verdict !== 'SUPPORTED') && (
        <p className="mt-2 text-[11px] text-muted">
          Wavy amber: goes beyond the precedent. Wavy red: no precedent supports it.
        </p>
      )}

      <Citations citations={outcome.citations} />
      <Deltas deltas={outcome.deltas} />

      {outcome.attachmentsRequired.length > 0 && (
        <div className="mt-4">
          <h4 className="text-[11px] font-medium tracking-wide text-muted uppercase">
            Attachments this response needs
          </h4>
          <ul className="mt-2 list-inside list-disc space-y-1 text-[13px]">
            {outcome.attachmentsRequired.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {outcome.openQuestions.length > 0 && (
        <div className="mt-4">
          <h4 className="text-[11px] font-medium tracking-wide text-muted uppercase">
            The precedents do not settle these
          </h4>
          <ul className="mt-2 list-inside list-disc space-y-1 text-[13px]">
            {outcome.openQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 border-t border-border pt-4">
        <button
          type="button"
          onClick={() => onUse(outcome.draft)}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          Use this as the response
        </button>
        <p className="mt-2 text-xs text-muted">
          Copies the text into the response below, where you edit it. Nothing is sent anywhere
          until a reviewer approves it.
        </p>
      </div>
    </div>
  )
}

/**
 * The refusal (docs/04-AI-PIPELINE.md §4.2).
 *
 * Given as much room as a successful draft, deliberately. "The system declined
 * because nothing in the repository is close enough" is the behaviour that makes
 * the rest of it trustworthy, and hiding it in a toast would waste it.
 */
function RefusalPanel({ outcome }: { outcome: Extract<DraftOutcome, { refused: true }> }) {
  return (
    <div className="mt-4 rounded-lg border border-warn/40 bg-warn-soft/40 p-4">
      <h3 className="text-sm font-semibold">No draft was written</h3>
      <p className="mt-2 text-[13px] leading-relaxed">{outcome.reason}</p>

      {outcome.escalateTo && (
        <p className="mt-3 text-[13px]">
          <span className="text-muted">Escalate to:</span>{' '}
          <span className="font-medium">
            {outcome.escalateTo.replaceAll('_', ' ').toLowerCase()}
          </span>
        </p>
      )}

      {outcome.nearest.length > 0 && (
        <div className="mt-4">
          <h4 className="text-[11px] font-medium tracking-wide text-muted uppercase">
            What was looked at, and rejected as too distant
          </h4>
          <ul className="mt-2 space-y-2">
            {outcome.nearest.map((p) => (
              <li key={p.considerationId} className="rounded-md bg-background px-3 py-2 text-[13px]">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="font-mono">{p.similarity.toFixed(2)}</span>
                  <span aria-hidden>·</span>
                  <span>{p.memberState ?? 'all'}</span>
                  <span aria-hidden>·</span>
                  <span>{p.category.replaceAll('_', ' ').toLowerCase()}</span>
                  <Link
                    href={`/rfi/${p.considerationId}`}
                    className="ml-auto text-accent hover:underline"
                  >
                    Open
                  </Link>
                </div>
                <p className="mt-1.5 line-clamp-3">{p.considerationText}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function RfiDetailClient({
  consideration,
  drafts,
  history,
  availableActions,
  canDraft,
}: {
  consideration: ConsiderationDetail
  drafts: StoredDraft[]
  history: HistoryEvent[]
  availableActions: WorkflowAction[]
  canDraft: boolean
}) {
  const [responseText, setResponseText] = useState(consideration.sponsorResponseText ?? '')
  const [outcome, setOutcome] = useState<DraftOutcome | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [drafting, startDrafting] = useTransition()
  const [pendingAction, setPendingAction] = useState<WorkflowAction | null>(null)
  const [transition, transitionFormAction] = useActionState<TransitionState, FormData>(
    transitionAction,
    {},
  )

  const editable = consideration.responseStatus === 'DRAFT'
  const priorRefusals = drafts.filter((d) => d.refused).length

  function generate() {
    setDraftError(null)
    setOutcome(null)
    startDrafting(async () => {
      const result = await draftAction(consideration.id)
      if (result.error) setDraftError(result.error)
      else if (result.outcome) setOutcome(result.outcome)
    })
  }

  return (
    <>
      {/* ------------------------------------------------------------ Draft */}
      <section className="mt-5 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">Draft a response from precedent</h2>
            <p className="mt-1 max-w-xl text-sm text-muted">
              Retrieves approved responses to similar considerations in the same application
              section, then drafts only from those. If nothing in the repository is close
              enough, it declines rather than inventing an answer.
            </p>
          </div>

          {canDraft && (
            <button
              type="button"
              onClick={generate}
              disabled={drafting}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {drafting ? 'Retrieving and drafting…' : 'Draft from precedent'}
            </button>
          )}
        </div>

        {drafting && (
          <p role="status" className="mt-4 text-sm text-muted">
            Searching the repository, checking the confidence gate, then drafting and
            verifying. This takes a few seconds.
          </p>
        )}

        {draftError && (
          <p role="alert" className="mt-4 rounded-md bg-risk-soft px-3.5 py-2.5 text-sm text-risk">
            {draftError}
          </p>
        )}

        {outcome?.refused === true && <RefusalPanel outcome={outcome} />}
        {outcome?.refused === false && (
          <DraftPanel outcome={outcome} onUse={(text) => setResponseText(text)} />
        )}

        {!outcome && !drafting && drafts.length > 0 && (
          <p className="mt-4 text-xs text-muted">
            {drafts.length} previous generation{drafts.length === 1 ? '' : 's'} recorded
            {priorRefusals > 0
              ? `, ${priorRefusals} of which the system refused`
              : ''}
            . The most recent was {formatWhen(drafts[0].createdAt)}.
          </p>
        )}
      </section>

      {/* --------------------------------------------------------- Response */}
      <section className="mt-5 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-medium">Sponsor response</h2>

        {editable ? (
          <>
            <label htmlFor="responseText" className="sr-only">
              Sponsor response
            </label>
            <textarea
              id="responseText"
              value={responseText}
              onChange={(e) => setResponseText(e.target.value)}
              rows={6}
              placeholder="Write the response, or draft one from precedent above and edit it here…"
              className="mt-2.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] leading-relaxed"
            />
          </>
        ) : (
          <p className="mt-2.5 text-[13px] leading-relaxed whitespace-pre-wrap">
            {responseText || <span className="text-muted italic">No response recorded.</span>}
          </p>
        )}

        {transition.error && (
          <p role="alert" className="mt-3 rounded-md bg-risk-soft px-3.5 py-2.5 text-sm text-risk">
            {transition.error}
          </p>
        )}
        {transition.moved && (
          <p className="mt-3 rounded-md bg-ok-soft px-3.5 py-2.5 text-sm text-ok">
            Moved from {transition.moved.from.replaceAll('_', ' ').toLowerCase()} to{' '}
            {transition.moved.to.replaceAll('_', ' ').toLowerCase()}.{' '}
            {transition.note ?? ''}
          </p>
        )}

        {availableActions.length > 0 ? (
          <form action={transitionFormAction} className="mt-4 border-t border-border pt-4">
            <input type="hidden" name="considerationId" value={consideration.id} />
            <input type="hidden" name="action" value={pendingAction ?? availableActions[0]} />
            {editable && <input type="hidden" name="responseText" value={responseText} />}

            {pendingAction && TRANSITIONS[pendingAction].requiresReason && (
              <div className="mb-3">
                <label htmlFor="reason" className="mb-1 block text-[11px] font-medium tracking-wide text-muted uppercase">
                  What needs to change? Recorded in the audit trail.
                </label>
                <textarea
                  id="reason"
                  name="reason"
                  rows={2}
                  required
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px]"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {availableActions.map((action) => (
                <button
                  key={action}
                  type={action === pendingAction ? 'submit' : 'button'}
                  onClick={() => setPendingAction(action)}
                  className={
                    action === pendingAction
                      ? 'rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90'
                      : 'rounded-md border border-border px-4 py-2 text-sm transition hover:bg-accent-soft'
                  }
                >
                  {action === pendingAction
                    ? `Confirm: ${TRANSITIONS[action].label.toLowerCase()}`
                    : TRANSITIONS[action].label}
                </button>
              ))}
              {pendingAction && (
                <button
                  type="button"
                  onClick={() => setPendingAction(null)}
                  className="text-sm text-muted hover:underline"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        ) : (
          <p className="mt-4 border-t border-border pt-4 text-sm text-muted">
            {consideration.responseStatus === 'SUBMITTED'
              ? 'This response has gone to the regulator. It is final.'
              : 'No action is available to you on this response.'}
          </p>
        )}
      </section>

      {/* ---------------------------------------------------------- History */}
      <section className="mt-5 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-medium">History</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            Nothing recorded against this consideration yet, or none of it by your team.
          </p>
        ) : (
          <ol className="mt-3 space-y-2.5">
            {history.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline gap-x-2.5 text-[13px]">
                <time dateTime={event.occurredAt} className="font-mono text-xs text-muted">
                  {formatWhen(event.occurredAt)}
                </time>
                <span className="font-medium">
                  {event.action.replaceAll('_', ' ').toLowerCase()}
                </span>
                {(event.fromStatus || event.toStatus) && (
                  <span className="font-mono text-xs text-muted">
                    {event.fromStatus ?? '—'} → {event.toStatus ?? '—'}
                  </span>
                )}
                <span className="text-xs text-muted">
                  {event.actorTeam?.replaceAll('_', ' ').toLowerCase() ?? 'system'}
                </span>
                {event.reason && <span className="w-full text-muted">{event.reason}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  )
}
