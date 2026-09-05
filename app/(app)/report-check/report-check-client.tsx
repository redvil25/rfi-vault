'use client'

import { useActionState, useMemo, useState } from 'react'
import { SEVERITY_LABEL, type Flag, type PrecheckResult, type RulePrecedent } from '@/lib/precheck/types'
import { MIN_HITS_FOR_RULE, STALE_AFTER_MONTHS } from '@/lib/precheck/rules'
import { SUBSTANCE_MIN_WORDS } from '@/lib/precheck/topic'
import { LINT_PATTERN_COUNT } from '@/lib/precheck/lint'
import { MAX_UPLOAD_BYTES, RFI_BUCKET } from '@/lib/ingest/constants'
import { createClient as createBrowserClient } from '@/lib/db/browser'
import {
  checkReportAction,
  createReportUploadAction,
  type ReportCheckState,
} from './actions'

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
  ranFor: ReportCheckState['ranFor'],
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
  ranFor: ReportCheckState['ranFor']
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
  fileName,
  unrecognised,
}: {
  result: PrecheckResult
  runId?: string
  ranFor?: ReportCheckState['ranFor']
  fileName?: string
  unrecognised: string[]
}) {
  const [showCoverage, setShowCoverage] = useState(false)
  const skipped = result.rules.filter((r) => r.outcome === 'SKIPPED')
  const { coverage } = result
  const allTooShort = result.tooShort.length > 0 && result.flags.length === 0

  return (
    <section className="mt-8">
      {/* ---- The headline is a count of flags, never a score ---- */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
          <DownloadSnapshot result={result} runId={runId} ranFor={ranFor} />
        </div>
        <h2 className="text-base font-semibold">
          {allTooShort
            ? 'Nothing was checked'
            : result.counts.BLOCKER === 0 && result.counts.LIKELY === 0
              ? 'No blockers and no likely triggers'
              : `${result.counts.BLOCKER} blocker${result.counts.BLOCKER === 1 ? '' : 's'}, ${
                  result.counts.LIKELY
                } likely trigger${result.counts.LIKELY === 1 ? '' : 's'}`}
          {!allTooShort && result.counts.WATCH > 0 && `, ${result.counts.WATCH} worth a look`}
        </h2>

        {/*
          "Nothing found" and "nothing looked at" are different results and must
          never render the same. A one-word paste used to headline as a clean
          pass, which is the most dangerous thing this screen could say.
        */}
        {result.tooShort.length > 0 && (
          <p className="mt-1.5 rounded-md border border-border px-3 py-2 text-[13px]">
            <span className="font-medium">
              {allTooShort ? 'Too short to assess.' : 'Some sections were too short to assess.'}
            </span>{' '}
            {result.tooShort
              .map((t) => `${t.section} (${t.words} word${t.words === 1 ? '' : 's'})`)
              .join(', ')}
            . Mined rules need at least {SUBSTANCE_MIN_WORDS} words of section text.
            {allTooShort && ' A clean result here means nothing was looked at, not that nothing is wrong.'}
          </p>
        )}
        {fileName && (
          <p className="mt-1 text-[13px] text-muted">
            {fileName}
            {result.pageCount !== null && ` · ${result.pageCount} page${result.pageCount === 1 ? '' : 's'} read`}
            {result.completeness && ` · ${result.completeness.model}`}
          </p>
        )}
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

      {unrecognised.length > 0 && (
        <p className="mt-3 rounded-md border border-border px-3.5 py-2.5 text-[13px]">
          <span className="font-medium">
            {unrecognised.length} part{unrecognised.length === 1 ? '' : 's'} of the document
            {unrecognised.length === 1 ? ' was' : ' were'} not checked
          </span>{' '}
          — the heading does not map onto an application section, and filing it under the nearest
          one would check it against the wrong rules: {unrecognised.slice(0, 6).join(', ')}
          {unrecognised.length > 6 && `, and ${unrecognised.length - 6} more`}.
        </p>
      )}

      {/* ---- What the model found the document does not say ---- */}
      {result.completeness && result.completeness.missing.length > 0 && (
        <div className="mt-3 rounded-lg border border-border bg-surface p-4">
          <h3 className="text-sm font-semibold">
            {result.completeness.missing.length} thing
            {result.completeness.missing.length === 1 ? '' : 's'} the report does not appear to
            address
          </h3>
          <p className="mt-1 text-[13px] text-muted">
            Each one was asked for in a past request against this section. Nothing here is a
            judgement about what a clinical report ought to contain — only which of those
            specific questions this document would not answer.
          </p>
          <ul className="mt-3 space-y-2.5">
            {result.completeness.missing.map((m) => (
              <li key={m.item} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px] font-medium">{m.item}</span>
                  <span className="text-[11px] text-muted">
                    {m.section} · {m.citations.length} past request
                    {m.citations.length === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed">{m.why}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.completeness && result.completeness.addressed.length > 0 && (
        <details className="mt-3 rounded-lg border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            {result.completeness.addressed.length} past request
            {result.completeness.addressed.length === 1 ? '' : 's'} the report already answers
          </summary>
          <ul className="mt-2 space-y-1.5 text-[13px]">
            {result.completeness.addressed.map((a) => (
              <li key={a.item}>
                <span className="font-medium">{a.item}</span>{' '}
                <span className="text-muted">— {a.whereFound}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {result.completenessUnavailable && (
        <p className="mt-3 rounded-md border border-border px-3.5 py-2.5 text-[13px]">
          <span className="font-medium">The report was not read for unmentioned gaps.</span>{' '}
          {result.completenessUnavailable}. The deterministic findings above stand on their own.
        </p>
      )}

      {result.completeness && result.completeness.openQuestions.length > 0 && (
        <div className="mt-3 rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold">The extraction could not settle these</h3>
          <p className="mt-1 text-[13px] text-muted">
            An extraction gap is not a dossier gap — a table that did not survive the PDF, or an
            annex that was not supplied. Check them by eye.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px]">
            {result.completeness.openQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}

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

export function ReportCheckClient({
  memberStates,
  defaultMemberState,
}: {
  memberStates: { code: string; name: string }[]
  defaultMemberState: string | null
}) {
  const [state, formAction, pending] = useActionState<ReportCheckState, FormData>(
    checkReportAction,
    {},
  )

  const [submissionType, setSubmissionType] = useState('SUBSTANTIAL_MODIFICATION')
  const [selectedStates, setSelectedStates] = useState<string[]>(
    defaultMemberState ? [defaultMemberState] : ['IT'],
  )
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploaded, setUploaded] = useState<{ storageKey: string; fileName: string } | null>(null)

  const payload = useMemo(
    () =>
      JSON.stringify({
        storageKey: uploaded?.storageKey ?? '',
        submissionType,
        memberStates: selectedStates,
      }),
    [uploaded, submissionType, selectedStates],
  )

  function toggleState(code: string) {
    setSelectedStates((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    )
  }

  /**
   * Straight to Storage on a one-shot signed URL.
   *
   * The bytes never touch the application server, which is what keeps a real
   * clinical report clear of the host's 4.5 MB request-body cap.
   */
  async function choose(picked: File | null) {
    setUploadError(null)
    setUploaded(null)
    setFile(picked)
    if (!picked) return

    if (picked.size > MAX_UPLOAD_BYTES) {
      setUploadError(`That file is ${(picked.size / 1024 / 1024).toFixed(1)} MB. The limit is 20 MB.`)
      return
    }
    if (!picked.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Upload the report as a PDF.')
      return
    }

    setUploading(true)
    try {
      const target = await createReportUploadAction(picked.name)
      if (target.error || !target.storageKey || !target.token) {
        setUploadError(target.error ?? 'The upload could not be prepared.')
        return
      }
      const supabase = createBrowserClient()
      const { error } = await supabase.storage
        .from(RFI_BUCKET)
        .uploadToSignedUrl(target.storageKey, target.token, picked, {
          contentType: 'application/pdf',
        })
      if (error) {
        setUploadError(`Upload failed: ${error.message}`)
        return
      }
      setUploaded({ storageKey: target.storageKey, fileName: picked.name })
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <form action={formAction} className="mt-6">
        <input type="hidden" name="payload" value={payload} />
        <input type="hidden" name="fileName" value={uploaded?.fileName ?? ''} />

        <label
          htmlFor="report"
          className="block cursor-pointer rounded-lg border border-dashed border-border p-6 text-center hover:bg-accent-soft"
        >
          <span className="block text-sm font-medium">
            {file ? file.name : 'Choose the clinical document (PDF)'}
          </span>
          <span className="mt-1 block text-[13px] text-muted">
            {uploading
              ? 'Uploading…'
              : uploaded
                ? 'Uploaded. Run the check below.'
                : 'Up to 20 MB. It is read for this check and deleted immediately afterwards — no copy is kept.'}
          </span>
          <input
            id="report"
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(e) => void choose(e.target.files?.[0] ?? null)}
          />
        </label>

        {uploadError && (
          <p role="alert" className="mt-3 rounded-md bg-risk-soft px-3.5 py-2.5 text-sm text-risk">
            {uploadError}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-4">
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

        <button
          type="submit"
          disabled={pending || uploading || !uploaded}
          className="mt-4 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? 'Checking…' : 'Check the report'}
        </button>

        {state.error && (
          <p role="alert" className="mt-4 rounded-md bg-risk-soft px-3.5 py-2.5 text-sm text-risk">
            {state.error}
          </p>
        )}
      </form>

      {state.result && (
        <Results
          result={state.result}
          runId={state.runId}
          ranFor={state.ranFor}
          fileName={state.fileName}
          unrecognised={state.unrecognised ?? []}
        />
      )}
    </>
  )
}
