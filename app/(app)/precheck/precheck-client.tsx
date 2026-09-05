'use client'

import { useActionState, useMemo, useState } from 'react'
import { SEVERITY_LABEL, type Flag, type PrecheckResult, type RulePrecedent } from '@/lib/precheck/types'
import { MIN_HITS_FOR_RULE, STALE_AFTER_MONTHS } from '@/lib/precheck/rules'
import { LINT_PATTERN_COUNT } from '@/lib/precheck/lint'
import { splitDossier } from '@/lib/precheck/split'
import { precheckAction, type PrecheckState } from './actions'

const SUBMISSION_TYPES: [string, string][] = [
  ['INITIAL', 'Initial application'],
  ['SUBSTANTIAL_MODIFICATION', 'Substantial modification'],
  ['ADDITIONAL_MS', 'Additional Member State'],
]

/**
 * Severity is carried by weight and a word, never by colour alone.
 *
 * A regulatory reader is as likely to be colour-blind as anyone else, and this
 * screen is the one where missing a blocker costs a submission. The label is
 * always present; the border is a second, redundant channel.
 */
const SEVERITY_STYLE: Record<string, string> = {
  BLOCKER: 'border-l-4 border-l-risk',
  LIKELY: 'border-l-4 border-l-foreground/40',
  WATCH: 'border-l-4 border-l-border',
}

const TEAM_LABEL: Record<string, string> = {
  RA_CLINICAL: 'RA Clinical',
  AFFILIATE: 'the affiliate',
  CTA_MANAGEMENT: 'CTA Management',
  EU_SUBMISSION_HUB: 'the EU Submission Hub',
  ADMIN: 'an administrator',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * Copy-to-clipboard on the suggested sentence.
 *
 * The single most-used control on this screen, because the writer's job after
 * reading a flag is to put wording in a box. It copies the precedent verbatim —
 * nothing here rewrites it — so what lands in the dossier is traceable to a
 * record ID the reviewer can open.
 */
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

function PrecedentPanel({ precedents }: { precedents: RulePrecedent[] }) {
  if (precedents.length === 0) {
    return (
      <p className="mt-3 text-[13px] text-muted italic">
        No accepted response in the repository for this theme yet, so there is no wording to
        offer. The flag stands on the recurrence alone.
      </p>
    )
  }

  return (
    <div className="mt-3 space-y-2.5">
      <h5 className="text-[11px] font-medium tracking-wide text-muted uppercase">
        Precedent — {precedents.length} past request{precedents.length === 1 ? '' : 's'}, verbatim
      </h5>
      {precedents.map((p) => (
        <div key={p.considerationId} className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            <span className="font-mono">{p.euTrialNumber}</span>
            <span>·</span>
            <span>{formatDate(p.issuedAt)}</span>
            {p.memberState && (
              <>
                <span>·</span>
                <span>{p.memberState}</span>
              </>
            )}
            {p.protocolCode && (
              <>
                <span>·</span>
                <span className="font-mono">{p.protocolCode}</span>
              </>
            )}
          </div>

          <p className="mt-2 text-[13px] leading-relaxed">
            <span className="text-muted">Regulator asked:</span> {p.considerationText}
          </p>

          <div className="mt-2 border-l-2 border-ok/50 pl-3">
            <p className="text-[11px] font-medium tracking-wide text-ok uppercase">
              Approved sponsor response — accepted
            </p>
            <p className="mt-1 text-[13px] leading-relaxed">{p.sponsorResponseText}</p>
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <CopyButton text={p.sponsorResponseText} label="Copy this response" />
            <span className="font-mono text-[10px] text-muted">{p.documentRef}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function FlagCard({ flag }: { flag: Flag }) {
  const owner = flag.fix.owner ? (TEAM_LABEL[flag.fix.owner] ?? flag.fix.owner) : null

  return (
    <li className={`rounded-lg border border-border bg-surface p-4 ${SEVERITY_STYLE[flag.severity]}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">{flag.title}</h4>
        <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
          {SEVERITY_LABEL[flag.severity]} · {flag.section}
        </span>
      </div>

      <p className="mt-1.5 text-[13px] leading-relaxed">{flag.detail}</p>

      {flag.disagreement && (
        <ul className="mt-2 space-y-1 rounded-md border border-border px-3 py-2 text-[13px]">
          {flag.disagreement.map((d) => (
            <li key={d.section}>
              <span className="text-muted">{d.section}:</span>{' '}
              <span className="font-mono font-medium">{d.value}</span>
            </li>
          ))}
        </ul>
      )}

      {flag.rule?.stale && (
        <p className="mt-2 text-[12px] text-muted">
          History only — this theme was last raised {flag.rule.monthsSinceLastSeen} months ago, so
          it is not applied as a rule. The precedent below is still real, and still the best
          wording anyone has.
        </p>
      )}

      {flag.lint && (
        <p className="mt-2 rounded-md border border-border px-3 py-2 text-[13px] leading-relaxed">
          <span className="text-[11px] tracking-wide text-muted uppercase">Your text</span>
          <br />
          {flag.lint.excerpt}
        </p>
      )}

      {/* ---- What to do, and who has to do it ---- */}
      {(flag.fix.missingArtefact || owner || flag.fix.suggestedWording) && (
        <div className="mt-3 rounded-md border border-border p-3">
          <h5 className="text-[11px] font-medium tracking-wide text-muted uppercase">The fix</h5>

          {flag.fix.missingArtefact && (
            <p className="mt-1.5 text-[13px]">
              <span className="text-muted">Produce:</span>{' '}
              <span className="font-medium">{flag.fix.missingArtefact}</span>
            </p>
          )}

          {owner && (
            <p className="mt-1 text-[13px]">
              <span className="text-muted">Chase:</span> <span className="font-medium">{owner}</span>
            </p>
          )}

          {flag.fix.suggestedWording && flag.fix.suggestedWordingFrom && (
            <div className="mt-2.5">
              <p className="text-[11px] tracking-wide text-muted uppercase">
                Wording that was accepted before — copy into the box
              </p>
              <p className="mt-1 rounded border border-border px-3 py-2 text-[13px] leading-relaxed">
                {flag.fix.suggestedWording}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <CopyButton text={flag.fix.suggestedWording} label="Copy to box" />
                <span className="text-[11px] text-muted">
                  from {flag.fix.suggestedWordingFrom.euTrialNumber},{' '}
                  {formatDate(flag.fix.suggestedWordingFrom.issuedAt)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      <PrecedentPanel precedents={flag.precedents} />
    </li>
  )
}

/**
 * Timestamped snapshot of the run.
 *
 * A regulated team has to be able to show what they checked, when, and under
 * which rule versions — months later, to somebody who was not there. It carries
 * the audit event id so the claim can be checked against the append-only trail
 * rather than taken on the file's own word, and it deliberately omits the
 * pasted dossier text, which is the sponsor's.
 */
function snapshotOf(
  result: PrecheckResult,
  runId: string | undefined,
  ranFor: PrecheckState['ranFor'],
) {
  return {
    snapshot_version: 1,
    audit_event_id: runId ?? null,
    checked_at: result.ranAt,
    submission_type: ranFor?.submissionType ?? null,
    member_states: ranFor?.memberStates ?? [],
    scope_used: { id: result.scope.id, label: result.scope.label },
    rule_versions: {
      lint_patterns: LINT_PATTERN_COUNT,
      stale_after_months: STALE_AFTER_MONTHS,
      min_hits_for_rule: MIN_HITS_FOR_RULE,
    },
    coverage: result.coverage,
    counts: result.counts,
    rules: result.rules.map((r) => ({
      rule: r.key,
      label: r.label,
      section: r.section,
      outcome: r.outcome,
      note: r.note,
    })),
    flags: result.flags.map((f) => ({
      severity: f.severity,
      section: f.section,
      title: f.title,
      detail: f.detail,
      matched_phrase: f.lint?.phrase ?? null,
      disagreement: f.disagreement ?? null,
      missing_artefact: f.fix.missingArtefact,
      owner: f.fix.owner,
      // Record IDs, not the text: the snapshot points at the repository rather
      // than duplicating it, so a reader always sees the current record.
      precedent_ids: f.precedents.map((p) => p.considerationId),
    })),
    note:
      'No score is reported. This repository holds only requests that were raised, so there ' +
      'is no negative class against which a probability or a false-positive rate could be ' +
      'calibrated.',
  }
}

function DownloadSnapshot({
  result,
  runId,
  ranFor,
}: {
  result: PrecheckResult
  runId?: string
  ranFor: PrecheckState['ranFor']
}) {
  const href = useMemo(() => {
    const json = JSON.stringify(snapshotOf(result, runId, ranFor), null, 2)
    return `data:application/json;charset=utf-8,${encodeURIComponent(json)}`
  }, [result, runId, ranFor])

  return (
    <a
      href={href}
      download={`precheck-${result.ranAt.slice(0, 10)}-${(runId ?? 'run').slice(0, 8)}.json`}
      className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent-soft"
    >
      Download snapshot
    </a>
  )
}

function Results({
  result,
  runId,
  ranFor,
}: {
  result: PrecheckResult
  runId?: string
  ranFor?: PrecheckState['ranFor']
}) {
  const [showCoverage, setShowCoverage] = useState(false)
  const skipped = result.rules.filter((r) => r.outcome === 'SKIPPED')
  const { coverage } = result

  return (
    <section className="mt-8">
      {/* ---- The headline is a count of flags, never a score ---- */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
          <DownloadSnapshot result={result} runId={runId} ranFor={ranFor} />
        </div>
        <h2 className="text-base font-semibold">
          {result.counts.BLOCKER === 0 && result.counts.LIKELY === 0
            ? 'No blockers and no likely triggers'
            : `${result.counts.BLOCKER} blocker${result.counts.BLOCKER === 1 ? '' : 's'}, ${
                result.counts.LIKELY
              } likely trigger${result.counts.LIKELY === 1 ? '' : 's'}`}
          {result.counts.WATCH > 0 && `, ${result.counts.WATCH} worth a look`}
        </h2>
        <p className="mt-1 text-[13px] text-muted">
          {ranFor && (
            <>
              {SUBMISSION_TYPES.find(([v]) => v === ranFor.submissionType)?.[1]}
              {ranFor.memberStates.length > 0 && ` · ${ranFor.memberStates.join(', ')}`} ·{' '}
            </>
          )}
          {result.rules.length} rule{result.rules.length === 1 ? '' : 's'} evaluated,{' '}
          {skipped.length} not applied. Checked {formatDate(result.ranAt)}.
        </p>
        {/*
          Which scope produced these rules, always. "Italy asks this" and
          "somebody, somewhere, asks this" are different claims, and widening in
          silence would let the second be read as the first.
        */}
        <p className="mt-1 text-[13px] text-muted">
          Precedent scope: <span className="font-medium text-foreground">{result.scope.label}</span>
          {result.scope.id !== 'EXACT' &&
            ' — widened because the exact scope had no rule recurrent and recent enough to apply.'}
        </p>
        <p className="mt-2 text-[13px] text-muted">
          There is no score here on purpose. This repository holds only requests that
          <em> were </em>raised, so there is no record of the sections that went out clean — and
          without that, any percentage would be a number with nothing behind it.
        </p>
      </div>

      {/* ---- Coverage: what this answer rests on ---- */}
      <div className="mt-3 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">What this check could see</h3>
          <button
            type="button"
            onClick={() => setShowCoverage((v) => !v)}
            className="text-xs text-accent hover:underline"
          >
            {showCoverage ? 'Hide the rule list' : `Show all ${result.rules.length} rules`}
          </button>
        </div>

        <ul className="mt-2 space-y-1 text-[13px] text-muted">
          <li>
            {coverage.consideredRows.toLocaleString('en-GB')} past considerations, in the records
            your team is allowed to read.
          </li>
          {coverage.corpusFrom && coverage.corpusTo && (
            <li>
              Precedent runs {formatDate(coverage.corpusFrom)} to {formatDate(coverage.corpusTo)}.
              Nothing after that date has been seen.
            </li>
          )}
          {coverage.syntheticOnly && (
            <li>
              Every record behind this result is a synthetic demonstration record. No real trial,
              sponsor or patient data is in this repository.
            </li>
          )}
          {coverage.memberStatesWithoutPrecedent.length > 0 && (
            <li className="font-medium text-foreground">
              No precedent at all for {coverage.memberStatesWithoutPrecedent.join(', ')}. For those
              Member States a clean result means no data, not no risk.
            </li>
          )}
        </ul>

        {showCoverage && (
          <ul className="mt-3 space-y-1 border-t border-border pt-3">
            {result.rules.map((r) => (
              <li key={r.key} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                <span className="w-16 shrink-0 text-[11px] font-medium tracking-wide text-muted uppercase">
                  {r.outcome === 'FLAGGED' ? 'flagged' : r.outcome === 'CLEAR' ? 'clear' : 'skipped'}
                </span>
                <span className={r.outcome === 'SKIPPED' ? 'text-muted' : ''}>
                  <span className="font-medium">{r.label}</span>{' '}
                  <span className="text-muted">— {r.note}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---- The flags themselves ---- */}
      {result.flags.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {result.flags.map((f) => (
            <FlagCard key={f.id} flag={f} />
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-lg border border-border p-4 text-sm text-muted">
          Nothing flagged. The wording admits no gaps, and no theme recurrent enough to be a rule
          has been raised against these sections in the last {STALE_AFTER_MONTHS} months. That is
          not a guarantee — read the coverage above for what was actually looked at.
        </p>
      )}
    </section>
  )
}

export function PrecheckClient({
  sections,
  memberStates,
  defaultMemberState,
}: {
  sections: string[]
  memberStates: { code: string; name: string }[]
  defaultMemberState: string | null
}) {
  const [state, formAction, pending] = useActionState<PrecheckState, FormData>(precheckAction, {})

  const [submissionType, setSubmissionType] = useState('SUBSTANTIAL_MODIFICATION')
  const [selectedStates, setSelectedStates] = useState<string[]>(
    defaultMemberState ? [defaultMemberState] : ['IT'],
  )
  const [rows, setRows] = useState<{ section: string; text: string }[]>([
    { section: 'Regulatory', text: '' },
  ])

  // Whole-dossier paste. A writer has a document, not eleven boxes, and typing
  // into eleven boxes is the single biggest reason this screen would go unused.
  const [dossier, setDossier] = useState('')
  const [split, setSplit] = useState<ReturnType<typeof splitDossier> | null>(null)

  function applyDossier() {
    const result = splitDossier(dossier)
    setSplit(result)
    if (result.recognised.length > 0) setRows(result.recognised)
  }

  const payload = useMemo(
    () => JSON.stringify({ submissionType, memberStates: selectedStates, sections: rows }),
    [submissionType, selectedStates, rows],
  )

  const unused = sections.filter((s) => !rows.some((r) => r.section === s))

  function toggleState(code: string) {
    setSelectedStates((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    )
  }

  return (
    <>
      <form action={formAction} className="mt-6">
        <input type="hidden" name="payload" value={payload} />

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label
              htmlFor="submissionType"
              className="mb-1 block text-[11px] font-medium tracking-wide text-muted uppercase"
            >
              Submission type
            </label>
            <select
              id="submissionType"
              value={submissionType}
              onChange={(e) => setSubmissionType(e.target.value)}
              className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm"
            >
              {SUBMISSION_TYPES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className="mt-4">
          <legend className="mb-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">
            Member States under assessment
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {memberStates.map((ms) => {
              const on = selectedStates.includes(ms.code)
              return (
                <button
                  key={ms.code}
                  type="button"
                  onClick={() => toggleState(ms.code)}
                  aria-pressed={on}
                  className={`rounded-md border px-2.5 py-1 text-xs ${
                    on
                      ? 'border-accent bg-accent-soft font-medium text-accent'
                      : 'border-border text-muted hover:bg-accent-soft'
                  }`}
                >
                  {ms.code}
                  <span className="sr-only"> {ms.name}</span>
                </button>
              )
            })}
          </div>
        </fieldset>

        {/* ---- Paste the whole dossier and let it section itself ---- */}
        <details className="mt-5 rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Paste a whole dossier instead
          </summary>
          <p className="mt-2 text-[13px] text-muted">
            Split on the headings the document already carries. A heading that does not map onto
            the taxonomy is listed below and left out of the check rather than filed under the
            nearest-looking section.
          </p>
          <textarea
            aria-label="Whole dossier text"
            value={dossier}
            onChange={(e) => setDossier(e.target.value)}
            rows={8}
            placeholder={`Cover Letter\nThis substantial modification concerns…\n\n1. Protocol\n…`}
            className="mt-2.5 w-full rounded-md border border-border bg-surface px-3 py-2 font-sans text-sm"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={applyDossier}
              disabled={!dossier.trim()}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent-soft disabled:opacity-50"
            >
              Split into sections
            </button>
            {split && (
              <span className="text-[13px] text-muted">
                {split.recognised.length} section{split.recognised.length === 1 ? '' : 's'}{' '}
                recognised
                {split.unrecognised.length > 0 &&
                  `, ${split.unrecognised.length} block${
                    split.unrecognised.length === 1 ? '' : 's'
                  } left out`}
                .
              </span>
            )}
          </div>
          {split && split.unrecognised.length > 0 && (
            <ul className="mt-2 space-y-0.5 rounded border border-border px-3 py-2 text-[12px] text-muted">
              <li className="font-medium text-foreground">Not checked — heading not recognised:</li>
              {split.unrecognised.map((h) => (
                <li key={h} className="font-mono">
                  {h}
                </li>
              ))}
            </ul>
          )}
          {split && split.recognised.length === 0 && (
            <p className="mt-2 text-[13px] text-muted">
              No heading in that text maps onto an application section, so nothing was filled in.
              Use the boxes below instead.
            </p>
          )}
        </details>

        <div className="mt-5 space-y-4">
          {rows.map((row, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <select
                  aria-label="Application section"
                  value={row.section}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r, j) => (j === i ? { ...r, section: e.target.value } : r)),
                    )
                  }
                  className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm"
                >
                  {sections.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                    className="text-xs text-muted hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>

              <textarea
                aria-label={`Text of the ${row.section} section`}
                value={row.text}
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((r, j) => (j === i ? { ...r, text: e.target.value } : r)),
                  )
                }
                rows={5}
                placeholder="Paste the section text as it will be filed…"
                className="mt-2.5 w-full rounded-md border border-border bg-surface px-3 py-2 font-sans text-sm"
              />
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          {unused.length > 0 && (
            <button
              type="button"
              onClick={() => setRows((prev) => [...prev, { section: unused[0], text: '' }])}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent-soft"
            >
              Add a section
            </button>
          )}
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? 'Checking…' : 'Run the check'}
          </button>
        </div>

        {state.error && (
          <p role="alert" className="mt-4 rounded-md bg-risk-soft px-3.5 py-2.5 text-sm text-risk">
            {state.error}
          </p>
        )}
      </form>

      {state.result && (
        <Results result={state.result} runId={state.runId} ranFor={state.ranFor} />
      )}
    </>
  )
}
