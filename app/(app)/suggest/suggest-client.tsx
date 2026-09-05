'use client'

import { useActionState, useState } from 'react'
import type { Precedent } from '@/lib/draft/types'
import {
  STRATEGY_BLURB,
  STRATEGY_LABEL,
  type GradedOption,
  type ParsedRequest,
  type SuggestOutcome,
} from '@/lib/suggest/types'
import { suggestAction, type SuggestState } from './actions'

const TEAM_LABEL: Record<string, string> = {
  RA_CLINICAL: 'RA Clinical',
  AFFILIATE: 'the affiliate',
  CTA_MANAGEMENT: 'CTA Management',
  EU_SUBMISSION_HUB: 'the EU Submission Hub',
  ADMIN: 'an administrator',
}

const EXAMPLE =
  'IT - No payment receipt has been identified for this submission. Please submit the proof ' +
  'of payment together with the reference number used for the transfer.'

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
    setTimeout(() => setState('idle'), 2000)
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent-soft"
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Press Ctrl+C' : label}
    </button>
  )
}

/** What the parser read out of the paste, so a wrong reading is visible before it matters. */
function ReadAs({ parsed }: { parsed: ParsedRequest }) {
  return (
    <p className="mt-3 text-[13px] text-muted">
      Read as:{' '}
      <span className="font-medium text-foreground">
        {parsed.section ??
          (parsed.sectionCandidates.length > 0
            ? parsed.sectionCandidates.join(' or ')
            : 'section not identified')}
      </span>
      {!parsed.section && parsed.sectionCandidates.length > 1 && (
        <span> — searched across both, because this category is filed under either</span>
      )}
      {parsed.memberState && (
        <>
          {' · '}
          <span className="font-medium text-foreground">{parsed.memberState}</span>
        </>
      )}
      {parsed.category !== 'UNCLASSIFIED' && (
        <>
          {' · '}
          {parsed.category.replaceAll('_', ' ').toLowerCase()}{' '}
          <span className="font-mono text-[11px]">
            ({parsed.categoryConfidence.toFixed(2)})
          </span>
        </>
      )}
      {parsed.category === 'UNCLASSIFIED' && ' · category not determined'}
    </p>
  )
}

function PrecedentList({ precedents, title }: { precedents: Precedent[]; title: string }) {
  if (precedents.length === 0) return null
  return (
    <div className="mt-4">
      <h3 className="text-[11px] font-medium tracking-wide text-muted uppercase">{title}</h3>
      <ul className="mt-2 space-y-2.5">
        {precedents.map((p) => (
          <li key={p.considerationId} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
              <span className="font-mono">{p.euTrialNumber}</span>
              <span>·</span>
              <span>similarity {p.similarity.toFixed(2)}</span>
              {p.memberState && (
                <>
                  <span>·</span>
                  <span>{p.memberState}</span>
                </>
              )}
              <span>·</span>
              <span>{p.section}</span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed">
              <span className="text-muted">Regulator asked:</span> {p.considerationText}
            </p>
            <div className="mt-2 border-l-2 border-ok/50 pl-3">
              <p className="text-[11px] font-medium tracking-wide text-ok uppercase">
                Approved sponsor response — {p.outcome.replaceAll('_', ' ').toLowerCase()}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed">{p.sponsorResponseText}</p>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <CopyButton text={p.sponsorResponseText} label="Copy this response" />
              <span className="font-mono text-[10px] text-muted">{p.documentRef}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function OptionCard({
  option,
  index,
  precedents,
  verifierUnavailable,
}: {
  option: GradedOption
  index: number
  precedents: Precedent[]
  verifierUnavailable: string | null
}) {
  const byId = new Map(precedents.map((p) => [p.considerationId, p]))

  return (
    <li className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Option {index + 1} — {STRATEGY_LABEL[option.strategy]}
        </h3>
        <span className="text-[11px] text-muted">
          {/* An ungraded option must never look graded. */}
          {verifierUnavailable || option.groundedness === null
            ? 'not graded'
            : `${Math.round(option.groundedness * 100)}% of sentences supported`}
          {' · '}
          model confidence {option.confidence.toFixed(2)}
        </span>
      </div>

      <p className="mt-0.5 text-[12px] text-muted">{STRATEGY_BLURB[option.strategy]}</p>
      <p className="mt-2 text-[13px] font-medium">{option.headline}</p>

      <p className="mt-2.5 rounded-md border border-border px-3 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap">
        {option.draft}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <CopyButton text={option.draft} label="Copy to box" />
      </div>

      <dl className="mt-3 space-y-1.5 text-[13px]">
        <div>
          <dt className="inline text-muted">Use this when: </dt>
          <dd className="inline">{option.whenToUse}</dd>
        </div>
        <div>
          <dt className="inline text-muted">Risk: </dt>
          <dd className="inline">{option.risk}</dd>
        </div>
        {option.attachmentsRequired.length > 0 && (
          <div>
            <dt className="inline text-muted">Attach: </dt>
            <dd className="inline">{option.attachmentsRequired.join(', ')}</dd>
          </div>
        )}
      </dl>

      <details className="mt-3">
        <summary className="cursor-pointer text-[12px] text-accent hover:underline">
          {option.citations.length} citation{option.citations.length === 1 ? '' : 's'}
        </summary>
        <ul className="mt-2 space-y-1.5">
          {option.citations.map((c) => {
            const p = byId.get(c.considerationId)
            return (
              <li key={c.considerationId} className="text-[12px]">
                <span className="font-mono text-[11px] text-muted">
                  {p?.euTrialNumber ?? c.considerationId}
                </span>
                {p && <span className="text-muted"> · {p.section}</span>}
                <br />
                {c.supportsClaim}
              </li>
            )
          })}
        </ul>
      </details>
    </li>
  )
}

function Outcome({ outcome }: { outcome: SuggestOutcome }) {
  if (outcome.refused) {
    const owner = outcome.escalateTo ? (TEAM_LABEL[outcome.escalateTo] ?? outcome.escalateTo) : null
    return (
      <section className="mt-6">
        <div className="rounded-lg border border-border p-4">
          <h2 className="text-base font-semibold">No options were drafted</h2>
          <p className="mt-2 text-[13px] leading-relaxed">{outcome.reason}</p>
          {owner && (
            <p className="mt-2 text-[13px]">
              <span className="text-muted">Escalate to:</span>{' '}
              <span className="font-medium">{owner}</span>
            </p>
          )}
          {outcome.maxSimilarity !== null && (
            <p className="mt-2 text-[12px] text-muted">
              Closest precedent scored {outcome.maxSimilarity.toFixed(2)}.
            </p>
          )}
          <ReadAs parsed={outcome.parsed} />
        </div>
        <PrecedentList
          precedents={outcome.nearest}
          title="Closest records found — not close enough to answer from, but worth reading"
        />
      </section>
    )
  }

  return (
    <section className="mt-6">
      <div className="rounded-lg border border-border bg-surface p-4">
        <h2 className="text-base font-semibold">
          {outcome.options.length} option{outcome.options.length === 1 ? '' : 's'}, grounded in{' '}
          {outcome.precedents.length} precedent
          {outcome.precedents.length === 1 ? '' : 's'}
        </h2>
        <p className="mt-1 text-[13px] text-muted">
          Closest precedent {outcome.maxSimilarity.toFixed(2)} · {outcome.model}
          {outcome.options.length < 3 &&
            ' · fewer than three, because the precedent did not support the others. Padding them would have meant inventing one.'}
        </p>
        {outcome.verifierUnavailable && (
          <p className="mt-2 rounded-md border border-border px-3 py-2 text-[13px]">
            These options are <strong className="font-medium">ungraded</strong> —{' '}
            {outcome.verifierUnavailable}. Read every sentence against the citations yourself.
          </p>
        )}
        <ReadAs parsed={outcome.parsed} />
      </div>

      {outcome.parsed.siblings.length > 0 && (
        <p className="mt-3 rounded-md border border-border px-3.5 py-2.5 text-[13px]">
          <strong className="font-medium">
            {outcome.parsed.siblings.length + 1} considerations were pasted.
          </strong>{' '}
          Only the first was answered — a request that blends several questions retrieves
          precedent for none of them. Paste the others one at a time.
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {outcome.options.map((o, i) => (
          <OptionCard
            key={o.strategy}
            option={o}
            index={i}
            precedents={outcome.precedents}
            verifierUnavailable={outcome.verifierUnavailable}
          />
        ))}
      </ul>

      {outcome.openQuestions.length > 0 && (
        <div className="mt-4 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold">The precedent does not settle these</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px]">
            {outcome.openQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      <PrecedentList precedents={outcome.precedents} title="Precedent these were built from" />
    </section>
  )
}

export function SuggestClient({ sections }: { sections: string[] }) {
  const [state, formAction, pending] = useActionState<SuggestState, FormData>(suggestAction, {})
  const [text, setText] = useState('')

  return (
    <>
      <form action={formAction} className="mt-6">
        <label
          htmlFor="text"
          className="mb-1 block text-[11px] font-medium tracking-wide text-muted uppercase"
        >
          The request for information
        </label>
        <textarea
          id="text"
          name="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="Paste the consideration exactly as the regulator wrote it…"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 font-sans text-sm"
        />

        <div className="mt-3 flex flex-wrap items-end gap-4">
          <div>
            <label
              htmlFor="section"
              className="mb-1 block text-[11px] font-medium tracking-wide text-muted uppercase"
            >
              Application section
            </label>
            <select
              id="section"
              name="section"
              className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm"
            >
              <option value="">Detect from the text</option>
              {sections.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? 'Searching precedent…' : 'Suggest responses'}
          </button>

          <button
            type="button"
            onClick={() => setText(EXAMPLE)}
            className="text-xs text-accent hover:underline"
          >
            Use an example
          </button>
        </div>

        <p className="mt-2 text-[12px] text-muted">
          Precedent is retrieved per application section. Leaving this on “detect” works when the
          text is clearly about one section; where it is not, the run refuses rather than guessing.
        </p>

        {state.error && (
          <p role="alert" className="mt-4 rounded-md bg-risk-soft px-3.5 py-2.5 text-sm text-risk">
            {state.error}
          </p>
        )}
      </form>

      {state.outcome && <Outcome outcome={state.outcome} />}
    </>
  )
}
