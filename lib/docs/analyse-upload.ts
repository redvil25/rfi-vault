import { createServiceClient } from '@/lib/db/service'
import { extractPdfText } from '@/lib/ingest/extract-pdf'
import { MAX_UPLOAD_BYTES, RFI_BUCKET } from '@/lib/ingest/constants'
import { log } from '@/lib/log'

/**
 * Uploading a document to be *read* rather than filed
 * (docs/04-AI-PIPELINE.md §3.8).
 *
 * The ingestion path (lib/ingest/commit.ts) keeps what it uploads: a filed RFI
 * export is a record, and the stored PDF is its source. The two analysis
 * screens are the opposite. A clinical report or an incoming request is the
 * sponsor's document, handed over to be checked and nothing else, and this
 * repository has no business keeping a copy of it.
 *
 * So the object is deleted the moment its text has been read, in a `finally`,
 * whether the read succeeded or not. What survives a run is the audit event
 * saying a check happened — never the document it happened to.
 *
 * The bytes never cross the application server on the way in. Hosts cap request
 * bodies well below the 20 MB ceiling (Vercel Serverless Functions at 4.5 MB),
 * so a Server Action that accepts the file works on a small fixture locally and
 * fails in production on a real report. Same reasoning as ADR-018.
 */

/** Storage keys this module issues. Narrower than the ingest prefix on purpose. */
export const ANALYSIS_KEY_RE = /^analysis\/\d{4}\/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,80}$/

export type UploadTarget =
  | { ok: true; storageKey: string; token: string }
  | { ok: false; error: string }

export async function createAnalysisUploadTarget(originalName: string): Promise<UploadTarget> {
  if (typeof originalName !== 'string' || originalName.length === 0 || originalName.length > 255) {
    return { ok: false, error: 'That file name is not usable.' }
  }

  const db = createServiceClient()
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
  const storageKey = `analysis/${new Date().getFullYear()}/${crypto.randomUUID()}-${safeName}`

  const { data, error } = await db.storage.from(RFI_BUCKET).createSignedUploadUrl(storageKey)
  if (error || !data) {
    log.error('analyse.upload_target_failed', { storageKey }, error)
    return { ok: false, error: 'The upload could not be prepared. Try again.' }
  }

  return { ok: true, storageKey, token: data.token }
}

export type ReadResult =
  | { ok: true; text: string; pageCount: number }
  | { ok: false; error: string }

/**
 * Reads the uploaded PDF's text, then deletes the object.
 *
 * Validation happens here rather than in the browser: a signed URL proves the
 * user was allowed to upload something, not that what arrived is a PDF.
 */
export async function readUploadedDocument(storageKey: string): Promise<ReadResult> {
  if (typeof storageKey !== 'string' || !ANALYSIS_KEY_RE.test(storageKey)) {
    return { ok: false, error: 'The upload reference is malformed. Start again.' }
  }

  const db = createServiceClient()

  try {
    const { data: blob, error } = await db.storage.from(RFI_BUCKET).download(storageKey)
    if (error || !blob) {
      log.error('analyse.download_failed', { storageKey }, error)
      return { ok: false, error: 'The uploaded file could not be read.' }
    }
    if (blob.size === 0) return { ok: false, error: 'The uploaded file is empty.' }
    if (blob.size > MAX_UPLOAD_BYTES) {
      return { ok: false, error: 'That file is larger than the 20 MB limit.' }
    }

    const bytes = new Uint8Array(await blob.arrayBuffer())

    // Magic bytes, never the content type sent with the signed upload — that is
    // client-supplied and proves nothing.
    if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
      return { ok: false, error: 'That file is not a PDF.' }
    }

    const extracted = await extractPdfText(bytes)

    if (extracted.looksScanned) {
      return {
        ok: false,
        error:
          'This PDF has no text layer — it looks like a scan. There is no OCR here, so nothing ' +
          'could be read from it. Export the document as text-bearing PDF and try again.',
      }
    }
    if (extracted.text.trim().length === 0) {
      return { ok: false, error: 'No text could be read from that PDF.' }
    }

    return { ok: true, text: extracted.text, pageCount: extracted.pageCount }
  } catch (err) {
    log.error('analyse.read_failed', { storageKey }, err)
    return { ok: false, error: 'The uploaded file could not be read.' }
  } finally {
    // Always. The document was handed over to be checked, not to be kept, and a
    // failed read is no reason to retain it.
    const { error } = await db.storage.from(RFI_BUCKET).remove([storageKey])
    if (error) log.warn('analyse.cleanup_failed', { storageKey }, error)
  }
}
