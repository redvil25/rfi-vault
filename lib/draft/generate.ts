import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { serverEnv } from '@/lib/env'
import { log } from '@/lib/log'
import { generateDraft, verifyDraft } from '@/lib/ai/draft'
import { groundednessOf } from '@/lib/ai/prompts/verify'
import {
  escalateTo, passesConfidenceGate, refusalReason, retrievePrecedents, type DraftTarget,
} from './retrieve'
import type { DraftOutcome, Precedent, SentenceVerdict } from './types'

/**
 * Feature 3, end to end.
 *
 * Order matters and is the safety property: retrieve, then gate, then draft.
 * Nothing reaches the model until the repository has proved it holds something
 * close enough to answer from. A pipeline that drafts first and checks after has
 * already produced the text it was supposed to refuse to produce.
 */

export interface DraftContext extends DraftTarget {
  euTrialNumber: string
  documentRef: string
  submissionType: string
}

export interface GenerateOptions {
  actorId: string
  /** Skips the verifier. Only the evaluation harness sets this. */
  skipVerification?: boolean
}

interface DraftRow {
  consideration_id: string
  refused: boolean
  refusal_reason: string | null
  draft_text: string | null
  citations: unknown
  deltas: unknown
  attachments_required: string[]
  open_questions: string[]
  model_confidence: number | null
  max_similarity: number | null
  groundedness: number | null
  verdicts: unknown
  precedent_ids: string[]
  model: string | null
  prompt_hash: string | null
  created_by: string
}

/**
 * Persists the attempt and returns its id, or null.
 *
 * Never throws. A draft the reviewer can see but that failed to record is worse
 * than one that recorded cleanly, but it is a great deal better than losing a
 * generation that has already been paid for to a telemetry write. The failure is
 * logged and the outcome is returned.
 */
async function persist(
  supabase: SupabaseClient<Database>,
  row: DraftRow,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('response_draft')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsonb columns
      .insert(row as any)
      .select('id')
      .single()

    if (error) {
      log.warn('draft.persist_failed', { considerationId: row.consideration_id }, error)
      return null
    }
    return data?.id ?? null
  } catch (err) {
    log.warn('draft.persist_failed', { considerationId: row.consideration_id }, err)
    return null
  }
}

function refusalRow(
  context: DraftContext,
  actorId: string,
  reason: string,
  nearest: Precedent[],
  maxSimilarity: number | null,
): DraftRow {
  return {
    consideration_id: context.considerationId,
    refused: true,
    refusal_reason: reason,
    draft_text: null,
    citations: [],
    deltas: [],
    attachments_required: [],
    open_questions: [],
    model_confidence: null,
    max_similarity: maxSimilarity,
    groundedness: null,
    verdicts: [],
    precedent_ids: nearest.map((p) => p.considerationId),
    model: null,
    prompt_hash: null,
    created_by: actorId,
  }
}

export async function generateGroundedDraft(
  context: DraftContext,
  supabase: SupabaseClient<Database>,
  options: GenerateOptions,
): Promise<DraftOutcome> {
  const threshold = serverEnv().DRAFT_LEXICAL_THRESHOLD

  // --- Retrieve ----------------------------------------------------------
  const retrieval = await retrievePrecedents(context, supabase)

  if (!retrieval.ok) {
    const draftId = await persist(
      supabase,
      refusalRow(context, options.actorId, retrieval.reason, retrieval.precedents, retrieval.maxSimilarity),
    )
    return {
      refused: true,
      reason: retrieval.reason,
      nearest: retrieval.precedents,
      escalateTo: escalateTo(context.category),
      maxSimilarity: retrieval.maxSimilarity,
      draftId,
    }
  }

  // --- Gate --------------------------------------------------------------
  if (!passesConfidenceGate(retrieval.maxSimilarity, threshold)) {
    const reason = refusalReason(retrieval.maxSimilarity, threshold)
    const draftId = await persist(
      supabase,
      refusalRow(context, options.actorId, reason, retrieval.precedents, retrieval.maxSimilarity),
    )
    log.info('draft.refused', {
      considerationId: context.considerationId,
      maxSimilarity: retrieval.maxSimilarity,
      threshold,
    })
    return {
      refused: true,
      reason,
      // The three nearest are shown anyway: "we looked, and here is what we
      // found" is a better answer than "no".
      nearest: retrieval.precedents.slice(0, 3),
      escalateTo: escalateTo(context.category),
      maxSimilarity: retrieval.maxSimilarity,
      draftId,
    }
  }

  // --- Draft -------------------------------------------------------------
  const generation = await generateDraft({
    considerationText: context.considerationText,
    section: context.section,
    sectionPart: context.sectionPart,
    memberState: context.memberState,
    category: context.category,
    euTrialNumber: context.euTrialNumber,
    documentRef: context.documentRef,
    submissionType: context.submissionType,
    precedents: retrieval.precedents,
  })

  const payload = generation.payload

  // A cited id the model did not receive is a fabricated citation. Dropping it
  // silently would hide exactly the failure the citations exist to expose, so
  // they are kept out of the record and counted as unsupported by the verifier.
  const retrievedIds = new Set(retrieval.precedents.map((p) => p.considerationId))
  const citations = payload.citations.filter((c) => retrievedIds.has(c.considerationId))
  const inventedCitations = payload.citations.length - citations.length
  if (inventedCitations > 0) {
    log.warn('draft.invented_citations', {
      considerationId: context.considerationId,
      dropped: inventedCitations,
    })
  }

  // --- Verify ------------------------------------------------------------
  let verdicts: SentenceVerdict[] = []
  let groundedness: number | null = null
  let verifierUnavailable: string | undefined

  if (options.skipVerification) {
    verifierUnavailable = 'verification was skipped for this run'
  } else {
    try {
      const verified = await verifyDraft(payload.draft, retrieval.precedents)
      verdicts = verified.sentences.map((s) => ({
        sentence: s.sentence,
        verdict: s.verdict,
        considerationIds: s.considerationIds.filter((id) => retrievedIds.has(id)),
      }))
      groundedness = groundednessOf(verdicts)
    } catch (err) {
      // The draft still stands, ungraded and labelled as such. Silently showing
      // an unverified draft as if it had passed is the one thing not to do.
      log.error('draft.verify_failed', { considerationId: context.considerationId }, err)
      verifierUnavailable = 'the verifier could not run, so this draft is ungraded'
    }
  }

  const draftId = await persist(supabase, {
    consideration_id: context.considerationId,
    refused: false,
    refusal_reason: null,
    draft_text: payload.draft,
    citations,
    deltas: payload.deltas,
    attachments_required: payload.attachmentsRequired,
    open_questions: payload.openQuestions,
    model_confidence: payload.confidence,
    max_similarity: retrieval.maxSimilarity,
    groundedness,
    verdicts,
    precedent_ids: retrieval.precedents.map((p) => p.considerationId),
    model: generation.model,
    prompt_hash: generation.promptHash,
    created_by: options.actorId,
  })

  log.info('draft.generated', {
    considerationId: context.considerationId,
    maxSimilarity: retrieval.maxSimilarity,
    confidence: payload.confidence,
    groundedness,
    citations: citations.length,
    deltas: payload.deltas.length,
  })

  return {
    refused: false,
    draftId,
    draft: payload.draft,
    citations,
    deltas: payload.deltas,
    attachmentsRequired: payload.attachmentsRequired,
    openQuestions: payload.openQuestions,
    confidence: payload.confidence,
    maxSimilarity: retrieval.maxSimilarity,
    precedents: retrieval.precedents,
    groundedness,
    verdicts,
    verifierUnavailable,
  }
}
