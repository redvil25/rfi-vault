'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { CATEGORIES, MEMBER_STATES } from '@/lib/domain/taxonomy'
import {
  analyseAction, commitAction,
  type AnalyseState, type CommitState,
} from './actions'

const CATEGORY_OPTIONS = [...CATEGORIES]
  .sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id))
  .map((c) => ({ id: c.id, label: `${c.id} — ${c.label}` }))

function confidenceTone(v: number) {
  if (v >= 0.8) return 'bg-ok-soft text-ok'
  if (v >= 0.5) return 'bg-warn-soft text-warn'
  return 'bg-risk-soft text-risk'
}

function Submit({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? busy : idle}
    </button>
  )
}

export function IngestClient() {
  const [analyse, analyseFormAction] = useActionState<AnalyseState, FormData>(analyseAction, {})
  const [commit, commitFormAction] = useActionState<CommitState, FormData>(commitAction, {})

  // Reviewer corrections, keyed by consideration number.
  const [overrides, setOverrides] = useState<
    Record<number, { category?: string; memberState?: string | null }>
  >({})

  function setOverride(n: number, patch: { category?: string; memberState?: string | null }) {
    setOverrides((prev) => ({ ...prev, [n]: { ...prev[n], ...patch } }))
  }

  // ---------------------------------------------------------------- Success
  if (commit.success) {
    const s = commit.success
    return (
      <div className="rounded-lg border border-ok/30 bg-ok-soft/40 p-6">
        <h2 className="text-base font-semibold">Filed into the repository</h2>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="w-36 text-muted">Document</dt>
            <dd className="font-mono">{s.documentRef}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-36 text-muted">Trial</dt>
            <dd className="font-mono">{s.trialNumber}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-36 text-muted">Considerations</dt>
            <dd>{s.considerationCount}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-36 text-muted">Corrected by you</dt>
            <dd>{s.overriddenCount}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-muted">
          An audit event was recorded naming you as the actor. The considerations are
          searchable immediately.
        </p>
        <div className="mt-5 flex gap-3">
          <Link
            href={`/search?q=${encodeURIComponent(s.documentRef)}`}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Find them in search
          </Link>
          <Link href="/ingest" className="px-4 py-2 text-sm text-accent hover:underline">
            File another
          </Link>
        </div>
      </div>
    )
  }

  // ----------------------------------------------------------------- Review
  if (analyse.parsed && analyse.storageKey) {
    const doc = analyse.parsed
    const overrideList = Object.entries(overrides).map(([n, o]) => ({
      considerationNumber: Number(n),
      ...o,
    }))

    return (
      <form action={commitFormAction} className="space-y-5">
        <input type="hidden" name="storageKey" value={analyse.storageKey} />
        <input type="hidden" name="overrides" value={JSON.stringify(overrideList)} />

        <section className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Check the extraction</h2>
            <span className={`rounded px-2 py-1 text-xs font-medium ${confidenceTone(doc.confidence)}`}>
              parser confidence {doc.confidence}
            </span>
          </div>

          <p className="mb-4 text-sm text-muted">
            Nothing has been written to the repository yet. Extraction is deterministic —
            no model was involved — but you are the one who signs off on it.
          </p>

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {[
              ['File', analyse.fileName],
              ['Pages', String(analyse.pageCount ?? '—')],
              ['Trial number', doc.euTrialNumber],
              ['Document reference', doc.documentRef],
              ['Submission type', doc.submissionType?.replaceAll('_', ' ').toLowerCase()],
              ['Issued', doc.issuedAt ? new Date(doc.issuedAt).toLocaleString('en-GB') : null],
            ].map(([label, value]) => (
              <div key={label} className="flex gap-2">
                <dt className="w-40 shrink-0 text-muted">{label}</dt>
                <dd className={value ? 'font-mono text-[13px]' : 'text-risk'}>
                  {value ?? 'not found'}
                </dd>
              </div>
            ))}
          </dl>

          {doc.warnings.length > 0 && (
            <ul className="mt-4 space-y-1 rounded-md bg-warn-soft px-3.5 py-2.5 text-sm text-warn">
              {doc.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">
            {doc.considerations.length} considerations
          </h3>

          {doc.considerations.map((c) => {
            const o = overrides[c.considerationNumber] ?? {}
            const category = o.category ?? c.category
            const memberState = o.memberState !== undefined ? o.memberState : c.memberState
            const edited = category !== c.category || memberState !== c.memberState

            return (
              <article
                key={c.considerationNumber}
                className="rounded-lg border border-border bg-surface p-4"
              >
                <div className="mb-2.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="font-medium text-foreground">
                    Consideration {c.considerationNumber}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{c.sectionPart === 'PART_I' ? 'Part I' : c.sectionPart === 'PART_II' ? 'Part II' : '?'}</span>
                  <span aria-hidden>·</span>
                  <span>{c.section ?? c.sectionRaw ?? 'unmapped section'}</span>
                  <span
                    className={`ml-auto rounded px-1.5 py-0.5 font-medium ${confidenceTone(c.categoryConfidence)}`}
                  >
                    category {c.categoryConfidence}
                  </span>
                  {edited && (
                    <span className="rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent">
                      corrected
                    </span>
                  )}
                </div>

                <p className="text-[13px] leading-relaxed">{c.considerationText}</p>

                {c.sponsorResponseText ? (
                  <div className="mt-2.5 border-l-2 border-ok bg-ok-soft/40 py-2 pl-3 text-[13px] leading-relaxed">
                    <span className="mb-0.5 block text-[11px] font-medium tracking-wide text-muted uppercase">
                      Sponsor response
                    </span>
                    {c.sponsorResponseText}
                  </div>
                ) : (
                  <p className="mt-2.5 text-[13px] text-muted italic">
                    No sponsor response in the document — this will be filed as open.
                  </p>
                )}

                {c.warnings.length > 0 && (
                  <ul className="mt-2.5 space-y-0.5 rounded bg-warn-soft px-3 py-2 text-xs text-warn">
                    {c.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 flex flex-wrap gap-3 border-t border-border pt-3">
                  <div>
                    <label
                      htmlFor={`cat-${c.considerationNumber}`}
                      className="mb-1 block text-[11px] font-medium tracking-wide text-muted uppercase"
                    >
                      Category
                    </label>
                    <select
                      id={`cat-${c.considerationNumber}`}
                      value={category}
                      onChange={(e) =>
                        setOverride(c.considerationNumber, { category: e.target.value })
                      }
                      className="max-w-96 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm"
                    >
                      {c.category === 'UNCLASSIFIED' && (
                        <option value="UNCLASSIFIED">UNCLASSIFIED — pick one</option>
                      )}
                      {CATEGORY_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor={`ms-${c.considerationNumber}`}
                      className="mb-1 block text-[11px] font-medium tracking-wide text-muted uppercase"
                    >
                      Member State
                    </label>
                    <select
                      id={`ms-${c.considerationNumber}`}
                      value={memberState ?? ''}
                      onChange={(e) =>
                        setOverride(c.considerationNumber, {
                          memberState: e.target.value || null,
                        })
                      }
                      className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm"
                    >
                      <option value="">None (Part I / all)</option>
                      {MEMBER_STATES.map((m) => (
                        <option key={m.code} value={m.code}>
                          {m.code} — {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </article>
            )
          })}
        </section>

        {commit.error && (
          <p role="alert" className="rounded-md bg-risk-soft px-3.5 py-2.5 text-sm text-risk">
            {commit.error}
          </p>
        )}

        <div className="flex items-center gap-4 border-t border-border pt-5">
          <Submit idle="Approve and file" busy="Filing…" />
          <Link href="/ingest" className="text-sm text-muted hover:underline">
            Discard and start again
          </Link>
        </div>
      </form>
    )
  }

  // ----------------------------------------------------------------- Upload
  return (
    <form action={analyseFormAction} className="space-y-4">
      <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center">
        <label htmlFor="file" className="block text-sm font-medium">
          CTIS “Requests for information” export (PDF)
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept="application/pdf,.pdf"
          required
          className="mx-auto mt-4 block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3.5 file:py-2 file:text-sm file:font-medium file:text-accent"
        />
        <p className="mx-auto mt-4 max-w-md text-xs text-muted">
          Text-based PDFs only, up to 20 MB. Scanned documents are detected and
          rejected rather than parsed badly — OCR is a known gap.
        </p>
      </div>

      {analyse.error && (
        <p role="alert" className="rounded-md bg-risk-soft px-3.5 py-2.5 text-sm text-risk">
          {analyse.error}
        </p>
      )}

      <Submit idle="Extract and review" busy="Extracting…" />
    </form>
  )
}
