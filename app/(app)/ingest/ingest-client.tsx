'use client'

import Link from 'next/link'
import { useActionState, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { CATEGORIES, MEMBER_STATES } from '@/lib/domain/taxonomy'
import { createClient } from '@/lib/db/browser'
import {
  RFI_BUCKET, MAX_UPLOAD_BYTES, MAX_BATCH, ACCEPTED_UPLOAD_ACCEPT_ATTR,
} from '@/lib/ingest/constants'
import type { ParsedDocument } from '@/lib/ingest/parse-ctis'
import {
  analyseStoredAction, commitAction, createUploadTargetAction, type CommitState,
} from './actions'

const CATEGORY_OPTIONS = [...CATEGORIES]
  .sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id))
  .map((c) => ({ id: c.id, label: `${c.id} — ${c.label}` }))

function confidenceTone(v: number) {
  if (v >= 0.8) return 'bg-ok-soft text-ok'
  if (v >= 0.5) return 'bg-warn-soft text-warn'
  return 'bg-risk-soft text-risk'
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
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

function Spinner() {
  return (
    <svg className="size-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function Tick({ className = 'size-4 shrink-0 text-ok' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.3 3.3 6.8-6.8a1 1 0 0 1 1.4 0Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** A document that was read successfully and is waiting for the reviewer. */
interface ReviewDoc {
  id: string
  fileName: string
  storageKey: string
  pageCount: number
  parsed: ParsedDocument
}

/** A file that never made it that far, kept so the user is told which one and why. */
interface RejectedUpload {
  fileName: string
  error: string
}

type Override = { category?: string; memberState?: string | null }

/** Per document, then per consideration number. */
type Overrides = Record<string, Record<number, Override>>

interface Progress {
  done: number
  total: number
  current: string
}

export function IngestClient() {
  const [files, setFiles] = useState<File[]>([])
  const [docs, setDocs] = useState<ReviewDoc[]>([])
  const [rejected, setRejected] = useState<RejectedUpload[]>([])
  const [overrides, setOverrides] = useState<Overrides>({})
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [commit, commitFormAction] = useActionState<CommitState, FormData>(commitAction, {})

  function addFiles(incoming: FileList | null) {
    if (!incoming || incoming.length === 0) return
    setError(null)

    const accepted: File[] = []
    const problems: string[] = []

    for (const file of Array.from(incoming)) {
      if (file.size === 0) {
        problems.push(`${file.name} is empty.`)
        continue
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        problems.push(`${file.name} is ${formatBytes(file.size)}; the limit is 20 MB.`)
        continue
      }
      // Same name and size twice is a double-drop, not two documents.
      const already =
        files.some((f) => f.name === file.name && f.size === file.size) ||
        accepted.some((f) => f.name === file.name && f.size === file.size)
      if (already) continue
      accepted.push(file)
    }

    const room = MAX_BATCH - files.length
    if (accepted.length > room) {
      problems.push(`Only ${MAX_BATCH} documents can be filed at a time.`)
      accepted.length = Math.max(0, room)
    }

    if (problems.length > 0) setError(problems.join(' '))
    if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted])
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  /**
   * Uploads and reads each file in turn.
   *
   * Sequential rather than parallel: the bytes go straight to Storage, but each
   * read is a server round trip that parses a PDF, and firing ten at once is the
   * quickest way to hit the rate limit the ingest actions deliberately impose.
   *
   * One bad file does not stop the others. It is collected and reported beside
   * the ones that worked, because a batch where three of four are fine should
   * file three, not none.
   */
  async function handleUpload() {
    if (files.length === 0) {
      setError('Choose at least one PDF to upload.')
      return
    }

    setError(null)
    setRejected([])
    const read: ReviewDoc[] = []
    const failed: RejectedUpload[] = []
    const supabase = createClient()

    for (const [index, file] of files.entries()) {
      setProgress({ done: index, total: files.length, current: file.name })

      try {
        const target = await createUploadTargetAction(file.name)
        if (target.error || !target.storageKey || !target.token) {
          failed.push({
            fileName: file.name,
            error: target.error ?? 'Could not prepare the upload.',
          })
          continue
        }

        const { error: uploadError } = await supabase.storage
          .from(RFI_BUCKET)
          .uploadToSignedUrl(target.storageKey, target.token, file, {
            contentType: file.type || 'application/octet-stream',
          })

        if (uploadError) {
          failed.push({ fileName: file.name, error: `Upload failed: ${uploadError.message}` })
          continue
        }

        const analysed = await analyseStoredAction(target.storageKey, file.name)
        if (analysed.error || !analysed.parsed || !analysed.storageKey) {
          failed.push({
            fileName: file.name,
            error: analysed.error ?? 'The document could not be read.',
          })
          continue
        }

        read.push({
          id: analysed.storageKey,
          fileName: file.name,
          storageKey: analysed.storageKey,
          pageCount: analysed.pageCount ?? 0,
          parsed: analysed.parsed,
        })
      } catch (e) {
        failed.push({
          fileName: file.name,
          error: e instanceof Error ? e.message : 'Something went wrong during upload.',
        })
      }
    }

    setProgress(null)
    setDocs(read)
    setRejected(failed)
    if (read.length === 0 && failed.length > 0) {
      setError('None of those files could be read. Nothing was filed.')
    }
  }

  function setOverride(docId: string, n: number, patch: Override) {
    setOverrides((prev) => ({
      ...prev,
      [docId]: { ...prev[docId], [n]: { ...prev[docId]?.[n], ...patch } },
    }))
  }

  function startOver() {
    setFiles([])
    setDocs([])
    setRejected([])
    setOverrides({})
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ---------------------------------------------------------------- Outcome
  if (commit.filed || (commit.rejected?.length ?? 0) > 0) {
    const filed = commit.filed ?? []
    const refused = commit.rejected ?? []
    const totalConsiderations = filed.reduce((n, d) => n + d.considerationCount, 0)

    return (
      <div className="space-y-4">
        {filed.length > 0 && (
          <div className="rounded-lg border border-ok/30 bg-ok-soft/40 p-6">
            <h2 className="text-base font-semibold">
              {filed.length === 1
                ? 'Filed into the repository'
                : `${filed.length} documents filed into the repository`}
            </h2>

            <ul className="mt-3 space-y-2">
              {filed.map((d) => (
                <li key={d.storageKey} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                  <Tick />
                  <span className="font-mono">{d.documentRef}</span>
                  <span className="text-muted">{d.trialNumber}</span>
                  <span className="text-muted">
                    {d.considerationCount} consideration{d.considerationCount === 1 ? '' : 's'}
                    {d.overriddenCount > 0 ? `, ${d.overriddenCount} corrected by you` : ''}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-4 text-sm text-muted">
              An audit event was recorded for each document, naming you as the actor. All{' '}
              {totalConsiderations} consideration{totalConsiderations === 1 ? ' is' : 's are'}{' '}
              searchable immediately.
            </p>

            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href={`/search?q=${encodeURIComponent(filed[0].trialNumber)}`}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Find them in search
              </Link>
              <Link href="/ingest" className="px-4 py-2 text-sm text-accent hover:underline">
                File more
              </Link>
            </div>
          </div>
        )}

        {refused.length > 0 && (
          <div className="rounded-lg border border-risk/30 bg-risk-soft/40 p-5">
            <h3 className="text-sm font-semibold">
              {refused.length} document{refused.length === 1 ? '' : 's'} not filed
            </h3>
            <ul className="mt-2 space-y-1.5 text-sm">
              {refused.map((r) => (
                <li key={r.storageKey}>{r.error}</li>
              ))}
            </ul>
            {filed.length === 0 && (
              <Link
                href="/ingest"
                className="mt-4 inline-block text-sm text-accent hover:underline"
              >
                Start again
              </Link>
            )}
          </div>
        )}
      </div>
    )
  }

  // ----------------------------------------------------------------- Review
  if (docs.length > 0) {
    const payload = docs.map((doc) => ({
      storageKey: doc.storageKey,
      overrides: Object.entries(overrides[doc.id] ?? {}).map(([n, o]) => ({
        considerationNumber: Number(n),
        ...o,
      })),
    }))

    const totalConsiderations = docs.reduce((n, d) => n + d.parsed.considerations.length, 0)

    return (
      <form action={commitFormAction} className="space-y-5">
        <input type="hidden" name="documents" value={JSON.stringify(payload)} />

        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-base font-semibold">
            Check {docs.length === 1 ? 'the extraction' : `${docs.length} extractions`}
          </h2>
          <p className="mt-2 text-sm text-muted">
            Nothing has been written to the repository yet. Extraction is deterministic — no
            model was involved — but you are the one who signs off on it.{' '}
            {totalConsiderations} consideration{totalConsiderations === 1 ? '' : 's'} across{' '}
            {docs.length} document{docs.length === 1 ? '' : 's'}.
          </p>
        </div>

        {rejected.length > 0 && (
          <div className="rounded-md bg-warn-soft px-3.5 py-2.5 text-sm text-warn">
            <p className="font-medium">
              {rejected.length} file{rejected.length === 1 ? '' : 's'} could not be read and{' '}
              {rejected.length === 1 ? 'is' : 'are'} not included below:
            </p>
            <ul className="mt-1.5 space-y-1">
              {rejected.map((r) => (
                <li key={r.fileName}>
                  <span className="font-medium">{r.fileName}</span> — {r.error}
                </li>
              ))}
            </ul>
          </div>
        )}

        {docs.map((doc) => (
          <DocumentReview
            key={doc.id}
            doc={doc}
            overrides={overrides[doc.id] ?? {}}
            onOverride={(n, patch) => setOverride(doc.id, n, patch)}
            onRemove={() => setDocs((prev) => prev.filter((d) => d.id !== doc.id))}
            removable={docs.length > 1}
          />
        ))}

        {commit.error && (
          <p role="alert" className="rounded-md bg-risk-soft px-3.5 py-2.5 text-sm text-risk">
            {commit.error}
          </p>
        )}

        <div className="flex items-center gap-4 border-t border-border pt-5">
          <Submit
            idle={
              docs.length === 1 ? 'Approve and file' : `Approve and file ${docs.length} documents`
            }
            busy="Filing…"
          />
          <button type="button" onClick={startOver} className="text-sm text-muted hover:underline">
            Discard and start again
          </button>
        </div>
      </form>
    )
  }

  // ----------------------------------------------------------------- Upload
  const busy = progress !== null

  return (
    <form action={handleUpload} className="space-y-4">
      {busy ? (
        <div
          className="rounded-lg border border-border bg-surface p-5"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2.5 text-sm font-medium">
            <Spinner />
            Reading {progress.done + 1} of {progress.total} — {progress.current}
          </div>
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-background">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${((progress.done + 0.5) / progress.total) * 100}%` }}
            />
          </div>
          <p className="mt-3 text-xs text-muted">
            Each file goes straight to encrypted storage, then is read. One at a time, so a
            large batch does not trip the rate limit.
          </p>
        </div>
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
            addFiles(e.dataTransfer.files)
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
            multiple
            accept={ACCEPTED_UPLOAD_ACCEPT_ATTR}
            className="sr-only"
            onChange={(e) => {
              addFiles(e.target.files)
              // Allow re-selecting the same file after removing it.
              e.target.value = ''
            }}
          />

          {files.length > 0 ? (
            <div className="mx-auto max-w-lg space-y-2 text-left">
              {files.map((file, i) => (
                <div
                  key={`${file.name}-${file.size}-${i}`}
                  className="flex items-center gap-3 rounded-md border border-border bg-background px-3.5 py-2.5"
                >
                  <Tick />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted">{formatBytes(file.size)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="text-xs text-accent hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}

              {files.length < MAX_BATCH && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full rounded-md border border-dashed border-border py-2 text-sm text-accent transition hover:bg-accent-soft"
                >
                  Add another document
                </button>
              )}
            </div>
          ) : (
            <>
              <p className="text-sm font-medium">
                Drop one or more CTIS “Requests for information” exports here
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 rounded-md bg-accent-soft px-4 py-2 text-sm font-medium text-accent transition hover:opacity-80"
              >
                Choose files
              </button>
            </>
          )}

          <p className="mx-auto mt-4 max-w-md text-xs text-muted">
            PDF up to 20 MB each, up to {MAX_BATCH} at a time, exported from CTIS. A scanned
            printout has no text layer and will be refused — export the document rather than
            scanning it. Everything read is shown to you before anything is filed, and uploads
            go directly to encrypted storage.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-md bg-risk-soft px-3.5 py-2.5 text-sm text-risk">
          {error}
        </p>
      )}

      {rejected.length > 0 && docs.length === 0 && (
        <ul className="rounded-md bg-warn-soft px-3.5 py-2.5 text-sm text-warn">
          {rejected.map((r) => (
            <li key={r.fileName}>
              <span className="font-medium">{r.fileName}</span> — {r.error}
            </li>
          ))}
        </ul>
      )}

      <button
        type="submit"
        disabled={busy || files.length === 0}
        className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {busy && <Spinner />}
        {busy
          ? 'Reading…'
          : files.length > 1
            ? `Extract and review ${files.length} documents`
            : 'Extract and review'}
      </button>
    </form>
  )
}

function DocumentReview({
  doc,
  overrides,
  onOverride,
  onRemove,
  removable,
}: {
  doc: ReviewDoc
  overrides: Record<number, Override>
  onOverride: (n: number, patch: Override) => void
  onRemove: () => void
  removable: boolean
}) {
  const parsed = doc.parsed

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{doc.fileName}</h3>
        <div className="flex items-center gap-3">
          <span
            className={`rounded px-2 py-1 text-xs font-medium ${confidenceTone(parsed.confidence)}`}
          >
            parser confidence {parsed.confidence}
          </span>
          {removable && (
            <button type="button" onClick={onRemove} className="text-xs text-accent hover:underline">
              Don’t file this one
            </button>
          )}
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {[
          ['Pages', String(doc.pageCount || '—')],
          ['Trial number', parsed.euTrialNumber],
          ['Document reference', parsed.documentRef],
          ['Submission type', parsed.submissionType?.replaceAll('_', ' ').toLowerCase()],
          ['Issued', parsed.issuedAt ? new Date(parsed.issuedAt).toLocaleString('en-GB') : null],
        ].map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="w-40 shrink-0 text-muted">{label}</dt>
            <dd className={value ? 'font-mono text-[13px]' : 'text-risk'}>{value ?? 'not found'}</dd>
          </div>
        ))}
      </dl>

      {parsed.warnings.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-md bg-warn-soft px-3.5 py-2.5 text-sm text-warn">
          {parsed.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <h4 className="mt-5 mb-3 text-sm font-medium">
        {parsed.considerations.length} consideration
        {parsed.considerations.length === 1 ? '' : 's'}
      </h4>

      <div className="space-y-3">
        {parsed.considerations.map((c) => {
          const o = overrides[c.considerationNumber] ?? {}
          const category = o.category ?? c.category
          const memberState = o.memberState !== undefined ? o.memberState : c.memberState
          const edited = category !== c.category || memberState !== c.memberState

          return (
            <article
              key={c.considerationNumber}
              className="rounded-lg border border-border bg-background p-4"
            >
              <div className="mb-2.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="font-medium text-foreground">
                  Consideration {c.considerationNumber}
                </span>
                <span aria-hidden>·</span>
                <span>
                  {c.sectionPart === 'PART_I'
                    ? 'Part I'
                    : c.sectionPart === 'PART_II'
                      ? 'Part II'
                      : '?'}
                </span>
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
                    htmlFor={`cat-${doc.id}-${c.considerationNumber}`}
                    className="mb-1 block text-[11px] font-medium tracking-wide text-muted uppercase"
                  >
                    Category
                  </label>
                  <select
                    id={`cat-${doc.id}-${c.considerationNumber}`}
                    value={category}
                    onChange={(e) => onOverride(c.considerationNumber, { category: e.target.value })}
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
                    htmlFor={`ms-${doc.id}-${c.considerationNumber}`}
                    className="mb-1 block text-[11px] font-medium tracking-wide text-muted uppercase"
                  >
                    Member State
                  </label>
                  <select
                    id={`ms-${doc.id}-${c.considerationNumber}`}
                    value={memberState ?? ''}
                    onChange={(e) =>
                      onOverride(c.considerationNumber, { memberState: e.target.value || null })
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
      </div>
    </section>
  )
}
