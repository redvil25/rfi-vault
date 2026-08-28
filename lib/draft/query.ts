import 'server-only'

import { createClient } from '@/lib/db/server'
import { createServiceClient } from '@/lib/db/service'
import { RFI_BUCKET } from '@/lib/ingest/constants'
import { log } from '@/lib/log'
import type { Database } from '@/lib/db/types'
import type { DeltaDimension, SentenceVerdict } from './types'

type Enums = Database['public']['Enums']

/**
 * Everything the RFI detail screen needs, in one place.
 *
 * Read through the request-scoped client, so a consideration another team is
 * still working on simply does not come back — `read_repository` in 0012 decides
 * that, not this file.
 */

export interface ConsiderationDetail {
  id: string
  considerationNumber: number
  sectionPart: Enums['section_part']
  section: string
  documentName: string | null
  memberState: string | null
  category: string
  considerationText: string
  sponsorResponseText: string | null
  responseStatus: Enums['response_status']
  outcome: Enums['rfi_outcome']
  ownerTeam: Enums['team_role'] | null
  sourcePage: number | null
  isSeed: boolean
  updatedAt: string
  documentId: string
  documentRef: string
  submissionType: Enums['submission_type']
  phase: Enums['rfi_phase']
  issuedAt: string
  dueAt: string | null
  sourceFilePath: string | null
  euTrialNumber: string
  shortTitle: string
  therapeuticArea: string | null
  impName: string | null
}

export interface StoredDraft {
  id: string
  refused: boolean
  refusalReason: string | null
  draftText: string | null
  citations: { considerationId: string; supportsClaim: string }[]
  deltas: {
    dimension: DeltaDimension
    precedentValue: string
    currentValue: string
    reviewerAction: string
  }[]
  attachmentsRequired: string[]
  openQuestions: string[]
  modelConfidence: number | null
  maxSimilarity: number | null
  groundedness: number | null
  verdicts: SentenceVerdict[]
  precedentIds: string[]
  model: string | null
  createdAt: string
}

const DETAIL_SELECT = [
  'id, consideration_number, section_part, section, document_name, member_state',
  'category, consideration_text, sponsor_response_text, response_status, outcome',
  'owner_team, source_page, is_seed, updated_at',
  'rfi_document!inner ( id, document_ref, submission_type, phase, issued_at, due_at, source_file_path )',
  'trial!inner ( eu_trial_number, short_title, therapeutic_area, imp_name )',
].join(', ')

interface DetailRow {
  id: string
  consideration_number: number
  section_part: Enums['section_part']
  section: string
  document_name: string | null
  member_state: string | null
  category: string
  consideration_text: string
  sponsor_response_text: string | null
  response_status: Enums['response_status']
  outcome: Enums['rfi_outcome']
  owner_team: Enums['team_role'] | null
  source_page: number | null
  is_seed: boolean
  updated_at: string
  rfi_document: {
    id: string
    document_ref: string
    submission_type: Enums['submission_type']
    phase: Enums['rfi_phase']
    issued_at: string
    due_at: string | null
    source_file_path: string | null
  }
  trial: {
    eu_trial_number: string
    short_title: string
    therapeutic_area: string | null
    imp_name: string | null
  }
}

export async function loadConsideration(id: string): Promise<ConsiderationDetail | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('rfi_consideration')
    .select(DETAIL_SELECT)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    log.error('rfi.detail_read_failed', { id }, error)
    return null
  }
  if (!data) return null

  const row = data as unknown as DetailRow

  return {
    id: row.id,
    considerationNumber: row.consideration_number,
    sectionPart: row.section_part,
    section: row.section,
    documentName: row.document_name,
    memberState: row.member_state,
    category: row.category,
    considerationText: row.consideration_text,
    sponsorResponseText: row.sponsor_response_text,
    responseStatus: row.response_status,
    outcome: row.outcome,
    ownerTeam: row.owner_team,
    sourcePage: row.source_page,
    isSeed: row.is_seed,
    updatedAt: row.updated_at,
    documentId: row.rfi_document.id,
    documentRef: row.rfi_document.document_ref,
    submissionType: row.rfi_document.submission_type,
    phase: row.rfi_document.phase,
    issuedAt: row.rfi_document.issued_at,
    dueAt: row.rfi_document.due_at,
    sourceFilePath: row.rfi_document.source_file_path,
    euTrialNumber: row.trial.eu_trial_number,
    shortTitle: row.trial.short_title,
    therapeuticArea: row.trial.therapeutic_area,
    impName: row.trial.imp_name,
  }
}

/** Generation history, newest first. Refusals included — they are the record too. */
export async function loadDrafts(considerationId: string): Promise<StoredDraft[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('response_draft')
    .select('*')
    .eq('consideration_id', considerationId)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    log.error('rfi.drafts_read_failed', { considerationId }, error)
    return []
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    refused: row.refused,
    refusalReason: row.refusal_reason,
    draftText: row.draft_text,
    // jsonb comes back as `Json`; these three are written only by
    // lib/draft/generate.ts against a Zod-validated payload, so the shape is
    // guaranteed at the write end rather than re-parsed at every read.
    citations: (row.citations ?? []) as unknown as StoredDraft['citations'],
    deltas: (row.deltas ?? []) as unknown as StoredDraft['deltas'],
    attachmentsRequired: row.attachments_required ?? [],
    openQuestions: row.open_questions ?? [],
    modelConfidence: row.model_confidence,
    maxSimilarity: row.max_similarity,
    groundedness: row.groundedness,
    verdicts: (row.verdicts ?? []) as unknown as SentenceVerdict[],
    precedentIds: row.precedent_ids ?? [],
    model: row.model,
    createdAt: row.created_at,
  }))
}

/** Every audit event about this consideration, oldest first — it reads as a history. */
export interface HistoryEvent {
  id: number
  occurredAt: string
  action: string
  fromStatus: string | null
  toStatus: string | null
  reason: string | null
  actorTeam: Enums['team_role'] | null
}

export async function loadHistory(considerationId: string): Promise<HistoryEvent[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('audit_events')
    .select('id, occurred_at, action, from_status, to_status, reason, actor_team')
    .eq('entity_type', 'rfi_consideration')
    .eq('entity_id', considerationId)
    .order('occurred_at', { ascending: true })
    .limit(50)

  if (error) {
    log.error('rfi.history_read_failed', { considerationId }, error)
    return []
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    action: row.action,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reason: row.reason,
    actorTeam: row.actor_team,
  }))
}

/**
 * A short-lived signed URL for the source PDF.
 *
 * The bucket is private and stays private; a link that expires in five minutes
 * is what "you can see the original" costs. Signed through the service client
 * because `authenticated` has no direct object access — authorisation already
 * happened when `loadConsideration` returned the row at all.
 */
export async function signedSourceUrl(path: string | null): Promise<string | null> {
  if (!path) return null

  try {
    const { data, error } = await createServiceClient()
      .storage.from(RFI_BUCKET)
      .createSignedUrl(path, 300)

    if (error || !data) {
      log.warn('rfi.signed_url_failed', { path }, error)
      return null
    }
    return data.signedUrl
  } catch (err) {
    log.warn('rfi.signed_url_failed', { path }, err)
    return null
  }
}
