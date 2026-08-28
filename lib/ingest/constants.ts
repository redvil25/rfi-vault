/**
 * Values shared by client and server. Kept in their own module so a client
 * component can import them without pulling in `lib/ingest/commit.ts`, which
 * constructs the service-role client.
 */

import type { ParsedDocument } from './parse-ctis'

export const RFI_BUCKET = 'rfi-documents'
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/**
 * Documents accepted in one filing.
 *
 * Bounded so one submission cannot queue unlimited parsing work. It lives here
 * rather than beside the action that enforces it because a `'use server'` module
 * may only export async functions — a plain constant there is a build error that
 * typecheck does not catch.
 */
export const MAX_BATCH = 10

/**
 * Rate limits for the ingestion actions, sized against MAX_BATCH rather than
 * picked round.
 *
 * Upload and analysis are consumed once per *file*, so a limit of 20 let a user
 * file two full batches in five minutes and then refused the third with "Too
 * many uploads" — during a demo, indistinguishable from a broken page. Six full
 * batches is the smallest ceiling that never bites a legitimate session while
 * still bounding the PDF parsing one account can queue.
 *
 * Committing is consumed once per *batch*, so it needs nothing like the same
 * headroom.
 */
export const RATE_LIMIT_WINDOW_SECONDS = 300
export const UPLOAD_RATE_LIMIT = MAX_BATCH * 6
export const ANALYSE_RATE_LIMIT = MAX_BATCH * 6
export const COMMIT_RATE_LIMIT = 30

/**
 * PDF only (ADR-021). The file picker and the Storage bucket agree on this, and
 * the server still decides the real format from magic bytes rather than trusting
 * either — an `accept` attribute is a hint to the file dialog, not a control.
 */
export const ACCEPTED_UPLOAD_TYPES = ['application/pdf'] as const

export const ACCEPTED_UPLOAD_ACCEPT_ATTR = '.pdf,application/pdf'

/**
 * A parse that carries everything filing requires. The two identifier fields are
 * non-null here and nullable on `ParsedDocument`, which is what makes the check
 * below worth having as a type guard rather than a boolean.
 */
export type FileableDocument = ParsedDocument & {
  documentRef: string
  euTrialNumber: string
}

export type Fileability =
  | { ok: true; document: FileableDocument }
  | { ok: false; problem: string }

/**
 * Decides whether a parsed document can be filed, and says why not.
 *
 * One function, called in three places that must never disagree: `analyseStored`
 * refuses the upload with it, `commitIngestion` re-checks it against its own
 * independent re-parse before writing, and the review screen uses it to decide
 * whether to offer an "Approve and file" button at all.
 *
 * They used to disagree. A document whose header parsed but whose body yielded
 * no considerations passed analysis, reached the review screen with a live
 * "Approve and file" button, and was refused only after the user pressed it —
 * the worst possible moment to learn nothing was going to be written.
 */
export function checkFileable(parsed: ParsedDocument): Fileability {
  if (!parsed.documentRef || !parsed.euTrialNumber) {
    const missing = [
      parsed.documentRef ? null : 'document reference',
      parsed.euTrialNumber ? null : 'EU trial number',
    ].filter(Boolean)
    return {
      ok: false,
      problem:
        `No readable ${missing.join(' or ')} in the document header, so this cannot be ` +
        'filed. Check that it is a CTIS request-for-information export.',
    }
  }

  if (parsed.considerations.length === 0) {
    return {
      ok: false,
      problem:
        'No considerations could be read from this document. The header parsed ' +
        `(${parsed.euTrialNumber}), but the body carries no "Consideration number" blocks — ` +
        'check that it is a request for information rather than a cover letter, an ' +
        'assessment report, or a decision notice.',
    }
  }

  return { ok: true, document: parsed as FileableDocument }
}
