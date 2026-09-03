import { createServiceClient } from '@/lib/db/service'
import { log } from '@/lib/log'
import { CATEGORY_BY_ID, UNMAPPED_SECTION } from '@/lib/domain/taxonomy'
import { extractDocument, type ExtractionSource } from './extract'
import { parseCtisRfi, type ParsedDocument } from './parse-ctis'
import type { Database } from '@/lib/db/types'

export { RFI_BUCKET, MAX_UPLOAD_BYTES } from './constants'
import { RFI_BUCKET, MAX_UPLOAD_BYTES, checkFileable } from './constants'

type TeamRole = Database['public']['Enums']['team_role']

// Re-exported so existing importers keep working; defined in a leaf module so
// importing it does not pull the OCR stack in with it. See ./roles.ts.
export { canIngest, INGEST_ROLES } from './roles'
import { canIngest } from './roles'

/**
 * Database errors carry schema details, constraint names and occasionally row
 * values. They belong in the server log, not in a browser. The user gets a
 * stable sentence; the operator gets the detail.
 */
function internalError(stage: string, err: unknown): string {
  log.error('ingest.stage_failed', { stage }, err)
  return `Could not ${stage}. The document was not filed — nothing was changed.`
}

export interface ConsiderationOverride {
  considerationNumber: number
  category?: string
  memberState?: string | null
}

export interface CommitInput {
  storageKey: string
  actorId: string
  actorTeam: TeamRole
  overrides: ConsiderationOverride[]
}

export type CommitResult =
  | {
      ok: true
      documentId: string
      documentRef: string
      trialNumber: string
      considerationCount: number
      overriddenCount: number
    }
  | { ok: false; error: string }

/**
 * Writes a reviewed extraction into the repository.
 *
 * The parse is redone here from the stored file rather than trusting anything
 * posted back by the client. Only the reviewer's explicit overrides are taken
 * from the request, and each is matched to a consideration by number — so a
 * tampered payload can change a category, which the audit trail records, but
 * cannot inject consideration text that was never in the document.
 *
 * Writes go through the service client on purpose. Filing a document creates
 * rows owned by *other* teams (a fee RFI is owned by the Affiliate even when
 * the Hub files it), which the `insert_own_team` policy correctly forbids.
 * Authorisation is therefore enforced here, before any write, and every commit
 * emits an audit event naming the actor. See ADR-013.
 */
/**
 * The section a consideration is filed under, or an admission that we do not know.
 *
 * Takes only the *mapped* section on purpose. This used to read
 * `c.section ?? c.sectionRaw ?? 'Regulatory'`, which undid the parser's own
 * refusal: normaliseSection() rejects anything that does not match the taxonomy
 * and warns about it, and then this wrote the rejected string anyway. Member
 * State names — "Spain", "France", "Germany" — reached the database that way
 * and appeared in the search "Document type" dropdown beside real application
 * section parts. The 'Regulatory' fallback was worse still: it is the
 * highest-volume section, so a misfiled row vanishes into the biggest bucket
 * and skews the base rates the risk engine reads back out.
 *
 * `section` is NOT NULL, so something must be written; the only honest
 * something is a value that says so.
 */
export function sectionForRow(mapped: string | null): string {
  return mapped ?? UNMAPPED_SECTION
}

export async function commitIngestion(input: CommitInput): Promise<CommitResult> {
  if (!canIngest(input.actorTeam)) {
    return { ok: false, error: 'Your team is not permitted to file documents.' }
  }

  const db = createServiceClient()

  // --- Re-read and re-parse from storage ---------------------------------
  const { data: blob, error: dlErr } = await db.storage
    .from(RFI_BUCKET)
    .download(input.storageKey)

  if (dlErr || !blob) {
    return { ok: false, error: internalError('read the uploaded file', dlErr) }
  }

  const bytes = new Uint8Array(await blob.arrayBuffer())
  const extraction = await extractDocument(bytes)
  if (!extraction.ok) return { ok: false, error: extraction.error }

  const extracted = extraction.extraction

  // Re-checked against this re-parse, never trusted from the review screen. The
  // same function decided whether to offer the button in the first place, so the
  // two cannot drift apart.
  const fileable = checkFileable(parseCtisRfi(extracted.text))
  if (!fileable.ok) return { ok: false, error: fileable.problem }
  const parsed = fileable.document

  // --- Reject duplicates -------------------------------------------------
  const { data: existing } = await db
    .from('rfi_document')
    .select('id')
    .eq('document_ref', parsed.documentRef)
    .maybeSingle()

  if (existing) {
    return {
      ok: false,
      error: `${parsed.documentRef} has already been filed. Nothing was changed.`,
    }
  }

  // --- Trial -------------------------------------------------------------
  const memberStates = [
    ...new Set(parsed.considerations.map((c) => c.memberState).filter((m): m is string => !!m)),
  ]

  const { data: trial, error: trialErr } = await db
    .from('trial')
    .upsert(
      {
        eu_trial_number: parsed.euTrialNumber,
        // The RFI export carries no trial title; a reviewer can correct this later.
        short_title: `Trial ${parsed.euTrialNumber}`,
        member_states: memberStates,
      },
      { onConflict: 'eu_trial_number', ignoreDuplicates: false },
    )
    .select('id')
    .single()

  if (trialErr || !trial) {
    return { ok: false, error: internalError('record the trial', trialErr) }
  }

  // --- Document ----------------------------------------------------------
  const { data: doc, error: docErr } = await db
    .from('rfi_document')
    .insert({
      trial_id: trial.id,
      document_ref: parsed.documentRef,
      submission_type: parsed.submissionType ?? 'INITIAL',
      // Validation is the scope of the problem statement and the default when
      // the export does not say otherwise.
      phase: 'VALIDATION',
      issued_at: parsed.issuedAt ?? new Date().toISOString(),
      source_file_path: input.storageKey,
      page_count: extracted.pageCount,
    })
    .select('id')
    .single()

  if (docErr || !doc) {
    return { ok: false, error: internalError('record the document', docErr) }
  }

  // --- Considerations ----------------------------------------------------
  const overrideByNumber = new Map(input.overrides.map((o) => [o.considerationNumber, o]))
  let overriddenCount = 0

  const rows = parsed.considerations.map((c) => {
    const o = overrideByNumber.get(c.considerationNumber)

    const category =
      o?.category && CATEGORY_BY_ID.has(o.category) ? o.category : c.category
    const memberState =
      o && 'memberState' in o ? (o.memberState || null) : c.memberState

    if (category !== c.category || memberState !== c.memberState) overriddenCount++

    return {
      document_id: doc.id,
      trial_id: trial.id,
      consideration_number: c.considerationNumber,
      section_part: c.sectionPart ?? 'PART_I',
      section: sectionForRow(c.section),
      document_name: c.documentName,
      member_state: memberState,
      category,
      consideration_text: c.considerationText,
      sponsor_response_text: c.sponsorResponseText,
      // An ingested response that already exists in the export was accepted by
      // the regulator; one still absent is open work for the owning team.
      response_status: c.sponsorResponseText ? ('SUBMITTED' as const) : ('DRAFT' as const),
      outcome: c.sponsorResponseText ? ('ACCEPTED' as const) : ('UNKNOWN' as const),
      owner_team: CATEGORY_BY_ID.get(category)?.owner ?? null,
      is_seed: false,
    }
  })

  const { error: consErr } = await db.from('rfi_consideration').insert(rows)

  if (consErr) {
    // Roll back by hand: there is no transaction across PostgREST calls, and a
    // document row with no considerations would be worse than nothing.
    await db.from('rfi_document').delete().eq('id', doc.id)
    return { ok: false, error: internalError('record the considerations', consErr) }
  }

  // --- Audit -------------------------------------------------------------
  const { error: auditErr } = await db.from('audit_events').insert({
    actor_id: input.actorId,
    actor_team: input.actorTeam,
    entity_type: 'rfi_document',
    entity_id: doc.id,
    action: 'INGESTED',
    to_status: 'SUBMITTED',
    reason: `Filed ${parsed.documentRef} from an uploaded CTIS export`,
    metadata: {
      documentRef: parsed.documentRef,
      trialNumber: parsed.euTrialNumber,
      storageKey: input.storageKey,
      pageCount: extracted.pageCount,
      extractionSource: extracted.source,
      considerationCount: rows.length,
      parserConfidence: parsed.confidence,
      overriddenCount,
      parserWarnings: parsed.warnings,
    },
  })

  // A failed audit write must not silently succeed — it is the one record that
  // has to exist. The document is removed rather than left unaccounted for.
  if (auditErr) {
    await db.from('rfi_consideration').delete().eq('document_id', doc.id)
    await db.from('rfi_document').delete().eq('id', doc.id)
    return { ok: false, error: internalError('write the audit event', auditErr) }
  }

  return {
    ok: true,
    documentId: doc.id,
    documentRef: parsed.documentRef,
    trialNumber: parsed.euTrialNumber,
    considerationCount: rows.length,
    overriddenCount,
  }
}

/**
 * Issues a one-shot signed upload URL so the browser writes the PDF straight to
 * Storage.
 *
 * The file bytes never pass through the application server. That is not an
 * optimisation: hosts cap request bodies well below our 20 MB ceiling (Vercel
 * Serverless Functions at 4.5 MB), so routing uploads through a Server Action
 * works locally on a small fixture and then fails in production on a real RFI
 * export. Keeping bytes off the host also keeps the app host-agnostic (ADR-011).
 */
export async function createUploadTarget(
  originalName: string,
): Promise<
  { ok: true; storageKey: string; token: string } | { ok: false; error: string }
> {
  const db = createServiceClient()
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
  const storageKey = `ingest/${new Date().getFullYear()}/${crypto.randomUUID()}-${safeName}`

  const { data, error } = await db.storage
    .from(RFI_BUCKET)
    .createSignedUploadUrl(storageKey)

  if (error || !data) return { ok: false, error: internalError('prepare the upload', error) }

  return { ok: true, storageKey, token: data.token }
}

/**
 * Reads a freshly uploaded object back out of Storage and reports what the
 * parser made of it. Writes nothing to the repository.
 *
 * Validation happens here, not in the browser: a signed URL proves the user was
 * allowed to upload, not that what they uploaded is a PDF. Anything that fails
 * validation is deleted rather than left sitting in the bucket.
 */
export async function analyseStored(
  storageKey: string,
): Promise<
  | {
      ok: true
      storageKey: string
      parsed: ParsedDocument
      pageCount: number
      source: ExtractionSource
    }
  | { ok: false; error: string }
> {
  const db = createServiceClient()

  const { data: blob, error } = await db.storage.from(RFI_BUCKET).download(storageKey)
  if (error || !blob) return { ok: false, error: internalError('read the uploaded file', error) }

  if (blob.size === 0) {
    await db.storage.from(RFI_BUCKET).remove([storageKey])
    return { ok: false, error: 'The uploaded file is empty.' }
  }
  if (blob.size > MAX_UPLOAD_BYTES) {
    await db.storage.from(RFI_BUCKET).remove([storageKey])
    return { ok: false, error: 'That file is larger than the 20 MB limit.' }
  }

  const bytes = new Uint8Array(await blob.arrayBuffer())

  // Format is decided by magic bytes inside extractDocument, never by the
  // content type sent with the signed upload, which is client-supplied.
  const extraction = await extractDocument(bytes)
  if (!extraction.ok) {
    await db.storage.from(RFI_BUCKET).remove([storageKey])
    return { ok: false, error: extraction.error }
  }

  const extracted = extraction.extraction

  // Refuse here rather than at the far end of the review screen.
  //
  // A document that cannot be filed must not reach review at all: the reviewer
  // would read an extraction, press "Approve and file", and only then be told
  // nothing was going to be written. Refusing at this step puts the reason
  // beside the file name, in the same list as every other unreadable upload, and
  // lets the batch's good documents carry on.
  const fileable = checkFileable(parseCtisRfi(extracted.text))
  if (!fileable.ok) {
    await db.storage.from(RFI_BUCKET).remove([storageKey])
    return { ok: false, error: fileable.problem }
  }
  const parsed = fileable.document

  // Likewise for a document already in the repository. The commit step refuses
  // it — it must, since two uploads can race — but finding out before reading
  // twelve considerations is the difference between a warning and wasted work.
  const { data: existing } = await db
    .from('rfi_document')
    .select('id')
    .eq('document_ref', parsed.documentRef)
    .maybeSingle()

  if (existing) {
    await db.storage.from(RFI_BUCKET).remove([storageKey])
    return {
      ok: false,
      error: `${parsed.documentRef} has already been filed. Nothing was changed.`,
    }
  }

  return {
    ok: true,
    storageKey,
    parsed,
    pageCount: extracted.pageCount,
    source: extracted.source,
  }
}

/**
 * Deletes uploads that were never filed.
 *
 * Every abandoned review used to leave its PDFs in the bucket for ever: the
 * reviewer presses "Discard and start again", the browser forgets the storage
 * keys, and nothing else ever refers to them. Over a demo week that is a private
 * bucket slowly filling with documents no row points at.
 *
 * A key that IS referenced by an `rfi_document` row is never deleted, whoever
 * asks. Storage keys are guessable in shape, so without that check one ingestor
 * could destroy the source file behind another team's filed document — the
 * evidence the audit trail exists to preserve.
 */
export async function discardUploads(storageKeys: string[]): Promise<number> {
  if (storageKeys.length === 0) return 0

  const db = createServiceClient()
  const unique = [...new Set(storageKeys)]

  const { data: referenced, error } = await db
    .from('rfi_document')
    .select('source_file_path')
    .in('source_file_path', unique)

  if (error) {
    log.warn('ingest.discard_lookup_failed', { keys: unique.length }, error)
    return 0
  }

  const filed = new Set((referenced ?? []).map((r) => r.source_file_path))
  const removable = unique.filter((key) => !filed.has(key))
  if (removable.length === 0) return 0

  const { error: removeError } = await db.storage.from(RFI_BUCKET).remove(removable)
  if (removeError) {
    log.warn('ingest.discard_failed', { keys: removable.length }, removeError)
    return 0
  }

  return removable.length
}
