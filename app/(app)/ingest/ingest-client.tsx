'use client'

import Link from 'next/link'
import { useActionState, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { CATEGORIES, MEMBER_STATES } from '@/lib/domain/taxonomy'
import { createClient } from '@/lib/db/browser'
import {
  RFI_BUCKET, MAX_UPLOAD_BYTES, ACCEPTED_UPLOAD_ACCEPT_ATTR,
} from '@/lib/ingest/constants'
import {
  analyseStoredAction, commitAction, createUploadTargetAction,
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

/**
 * Reading a scan takes the better part of ten seconds. Without named stages the
 * page looks frozen and people click again, so each stage the client actually
 * controls is shown as it happens.
 */
type Phase = 'idle' | 'preparing' | 'uploading' | 'reading'

const PHASE_STEPS: { id: Exclude<Phase, 'idle'>; label: string }[] = [
  { id: 'preparing', label: 'Preparing upload' },
  { id: 'uploading', label: 'Uploading to encrypted storage' },
  { id: 'reading', label: 'Reading the document' },
]

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function Spinner() {
  return (
    <svg className="size-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function Progress({ phase }: { phase: Exclude<Phase, 'idle'> }) {
  const currentIndex = PHASE_STEPS.findIndex((s) => s.id === phase)

  return (
    <div
      className="rounded-lg border border-border bg-surface p-5"
      role="status"
      aria-live="polite"
    >
      <ol className="space-y-2.5">
        {PHASE_STEPS.map((step, i) => {
          const done = i < currentIndex
          const active = i === currentIndex
          return (
            <li
              key={step.id}
              className={`flex items-center gap-2.5 text-sm ${
                active ? 'font-medium' : done ? 'text-muted' : 'text-muted opacity-50'
              }`}
            >
              {done ? (
                <svg className="size-4 shrink-0 text-ok" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path
                    fillRule="evenodd"
                    d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.3 3.3 6.8-6.8a1 1 0 0 1 1.4 0Z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : active ? (
                <Spinner />
              ) : (
                <span className="size-4 shrink-0 rounded-full border border-border" />
              )}
              {step.label}
              {active && step.id === 'reading' && (
                <span className="text-xs text-muted">
                  — scans are read with OCR, this can take a few seconds
                </span>
              )}
            </li>
          )
        })}
      </ol>

      <div className="mt-4 h-1 overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500"
          style={{ width: `${((currentIndex + 0.5) / PHASE_STEPS.length) * 100}%` }}
        />
      </div>
    </div>
  )
}

export function IngestClient() {
  const [analyse, setAnalyse] = useState<AnalyseState>({})
  const [phase, setPhase] = useState<Phase>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [commit, commitFormAction] = useActionState<CommitState, FormData>(commitAction, {})

  function chooseFile(next: File | null) {
    setFile(next)
    setAnalyse({})
  }

  /**
   * Three steps, and the file bytes go straight from the browser to Supabase
   * Storage in step 2 — never through this application. Routing them through a
   * Server Action would hit the host's request-body limit (4.5 MB on Vercel)
   * on any realistic RFI export.
   */
  async function handleUpload() {
    if (!file || file.size === 0) {
      setAnalyse({ error: 'Choose a PDF or image to upload.' })
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setAnalyse({
        error: `That file is ${formatBytes(file.size)}. The limit is 20 MB.`,
      })
      return
    }

    setAnalyse({})
    setPhase('preparing')
    try {
      const target = await createUploadTargetAction(file.name)
      if (target.error || !target.storageKey || !target.token) {
        setAnalyse({ error: target.error ?? 'Could not prepare the upload.' })
        return
      }

      setPhase('uploading')
      const supabase = createClient()
      const { error } = await supabase.storage
        .from(RFI_BUCKET)
        .uploadToSignedUrl(target.storageKey, target.token, file, {
          contentType: file.type || 'application/octet-stream',
        })

      if (error) {
        setAnalyse({ error: `Upload failed: ${error.message}` })
        return
      }

      setPhase('reading')
      setAnalyse(await analyseStoredAction(target.storageKey, file.name))
    } catch (e) {
      setAnalyse({
        error: e instanceof Error ? e.message : 'Something went wrong during upload.',
      })
    } finally {
      setPhase('idle')
    }
  }

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

          {analyse.source !== 'TEXT_LAYER' && (
            <p className="mb-4 rounded-md bg-warn-soft px-3.5 py-2.5 text-sm text-warn">
              <strong className="font-medium">
                Read by OCR
                {typeof analyse.ocrConfidence === 'number'
                  ? ` (confidence ${analyse.ocrConfidence.toFixed(2)})`
                  : ''}
                .
              </strong>{' '}
              This {analyse.source === 'OCR_IMAGE' ? 'image' : 'PDF'} had no text
              layer, so the characters below were recognised from the page rather
              than read from the file. Check identifiers, numbers and dates
              especially — those are where OCR errs.
            </p>
          )}

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
  const busy = phase !== 'idle'

  return (
    <form action={handleUpload} className="space-y-4">
      {busy ? (
        <Progress phase={phase} />
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const dropped = e.dataTransfer.files?.[0]
            if (!dropped) return
            // Keep the native input in sync so the form still has the file.
            if (fileInputRef.current) fileInputRef.current.files = e.dataTransfer.files
            chooseFile(dropped)
          }}
          className={`rounded-lg border-2 border-dashed px-6 py-10 text-center transition ${
            dragging ? 'border-accent bg-accent-soft' : 'border-border bg-surface'
          }`}
        >
          <input
            ref={fileInputRef}
            id="file"
            name="file"
            type="file"
            accept={ACCEPTED_UPLOAD_ACCEPT_ATTR}
            className="sr-only"
            onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
          />

          {file ? (
            <div className="mx-auto flex max-w-md items-center gap-3 rounded-md border border-border bg-background px-3.5 py-3 text-left">
              <svg className="size-5 shrink-0 text-ok" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.7-9.3a1 1 0 0 0-1.4-1.4L9 10.6 7.7 9.3a1 1 0 0 0-1.4 1.4l2 2a1 1 0 0 0 1.4 0l4-4Z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted">
                  {formatBytes(file.size)} · ready to extract
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (fileInputRef.current) fileInputRef.current.value = ''
                  chooseFile(null)
                }}
                className="text-xs text-accent hover:underline"
              >
                Remove
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm font-medium">
                Drop a CTIS “Requests for information” export here
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 rounded-md bg-accent-soft px-4 py-2 text-sm font-medium text-accent transition hover:opacity-80"
              >
                Choose a file
              </button>
            </>
          )}

          <p className="mx-auto mt-4 max-w-md text-xs text-muted">
            PDF, PNG, JPEG or WebP, up to 20 MB — a text PDF, a scan, or a
            screenshot all work. Scans and images are read with OCR, and the
            result is shown to you before anything is filed. Uploads go directly
            to encrypted storage.
          </p>
        </div>
      )}

      {analyse.error && (
        <p role="alert" className="rounded-md bg-risk-soft px-3.5 py-2.5 text-sm text-risk">
          {analyse.error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !file}
        className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {busy && <Spinner />}
        {phase === 'idle'
          ? 'Extract and review'
          : phase === 'reading'
            ? 'Reading the document…'
            : 'Uploading…'}
      </button>
    </form>
  )
}
