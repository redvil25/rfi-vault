import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { log } from '@/lib/log'
import { CATEGORY_BY_ID } from '@/lib/domain/taxonomy'
import type { Precedent } from './types'

/**
 * Precedent retrieval for Feature 3 (docs/04-AI-PIPELINE.md §4.1).
 *
 * Filtered to the same application section, preferring the same Member State,
 * and restricted to responses that a regulator actually accepted. A rejected
 * answer is not precedent, and the filter is the argument: the repository is
 * only useful as a source of drafts because it knows which responses worked.
 *
 * Scoring is lexical, not semantic (ADR-039). `lexical_precedents` returns a
 * pg_trgm overlap score in 0..1, so the confidence gate still has a number to
 * refuse on — but it is a number about shared wording, and the field is named
 * `lexicalScore` throughout so nobody reads it as shared meaning. A paraphrase
 * with no vocabulary in common scores near zero here and will be refused.
 */

/** Top-k handed to the model. Wider than that and the prompt dilutes. */
export const PRECEDENT_K = 6

/** Retrieved before filtering, so there is room to drop self-matches and unanswered rows. */
const RETRIEVE_CANDIDATES = 30

export interface DraftTarget {
  considerationId: string
  considerationText: string
  section: string
  sectionPart: 'PART_I' | 'PART_II'
  memberState: string | null
  category: string
  /**
   * Search several sections at once instead of one.
   *
   * Feature 3 never needs this: a filed consideration knows the section it was
   * filed under. A pasted request often does not, and many taxonomy categories
   * legitimately span two or three sections — proof of payment turns up under
   * both Regulatory and Cover Letter. Guessing one of them retrieves from the
   * wrong place; refusing outright is worse, because the category is known.
   *
   * When set, the section filter is dropped in SQL and applied here against the
   * candidate set, so the query still narrows by application section part.
   */
  sectionCandidates?: string[]
}

export type RetrievalResult =
  | { ok: true; precedents: Precedent[]; maxSimilarity: number }
  | { ok: false; reason: string; precedents: Precedent[]; maxSimilarity: number | null }

interface HydratedRow {
  id: string
  section: string
  member_state: string | null
  category: string
  consideration_text: string
  sponsor_response_text: string | null
  response_status: string
  outcome: string
  rfi_document: { document_ref: string } | null
  trial: { eu_trial_number: string } | null
}

const HYDRATE_SELECT = [
  'id, section, member_state, category, consideration_text, sponsor_response_text',
  'response_status, outcome',
  'rfi_document!inner ( document_ref )',
  'trial!inner ( eu_trial_number )',
].join(', ')

/**
 * Who a refused draft escalates to.
 *
 * Read from the taxonomy, so the routing cannot disagree with the ownership the
 * ingestion path already assigned to the same category (ADR-024).
 */
export function escalateTo(category: string): string | null {
  return CATEGORY_BY_ID.get(category)?.owner ?? null
}

/**
 * Orders candidates the way a reviewer would: closest first, but a precedent from
 * the same Member State beats a slightly closer one from elsewhere.
 *
 * National requirements are the whole reason Part II differs by country. A
 * Spanish informed-consent precedent is worth more to a Spanish request than an
 * Italian one that happens to score 0.01 higher.
 */
export function rankPrecedents(precedents: Precedent[], memberState: string | null): Precedent[] {
  return [...precedents].sort((a, b) => {
    if (memberState) {
      const aLocal = a.memberState === memberState ? 1 : 0
      const bLocal = b.memberState === memberState ? 1 : 0
      if (aLocal !== bLocal) return bLocal - aLocal
    }
    return b.similarity - a.similarity
  })
}

export async function retrievePrecedents(
  target: DraftTarget,
  supabase: SupabaseClient<Database>,
): Promise<RetrievalResult> {
  const { data, error } = await supabase.rpc('lexical_precedents', {
    query_text: target.considerationText,
    f_section: target.sectionCandidates ? undefined : target.section,
    f_part: target.sectionPart,
    f_approved_only: true,
    match_count: RETRIEVE_CANDIDATES,
  })

  if (error) {
    log.error('draft.retrieval_failed', { considerationId: target.considerationId }, error)
    return {
      ok: false,
      reason: 'The precedent search failed, so nothing was drafted.',
      precedents: [],
      maxSimilarity: null,
    }
  }

  const scored = new Map<string, number>()
  for (const row of (data ?? []) as { consideration_id: string; lexical_score: number }[]) {
    // A paste is not a record and cannot match itself, but a filed
    // consideration can, and a draft built from its own text is circular.
    if (row.consideration_id === target.considerationId) continue
    scored.set(row.consideration_id, Number(row.lexical_score) || 0)
  }

  if (scored.size === 0) {
    return {
      ok: false,
      reason: 'No approved precedent in this application section shares any wording with this request.',
      precedents: [],
      maxSimilarity: null,
    }
  }

  // Hydrated through the caller's client, so RLS decides what is readable. A row
  // the fusion found but the policy hides simply does not come back.
  const { data: hydrated, error: hydrateError } = await supabase
    .from('rfi_consideration')
    .select(HYDRATE_SELECT)
    .in('id', [...scored.keys()])

  if (hydrateError) {
    log.error('draft.hydrate_failed', { considerationId: target.considerationId }, hydrateError)
    return {
      ok: false,
      reason: 'Reading the matched precedents failed, so nothing was drafted.',
      precedents: [],
      maxSimilarity: null,
    }
  }

  const precedents: Precedent[] = []
  const allowed = target.sectionCandidates ? new Set(target.sectionCandidates) : null

  for (const row of (hydrated ?? []) as unknown as HydratedRow[]) {
    if (allowed && !allowed.has(row.section)) continue
    // A precedent with no response is not a precedent. This is not a filter for
    // tidiness: an open request has nothing to teach the model about answering.
    if (!row.sponsor_response_text?.trim()) continue
    if (!row.rfi_document || !row.trial) continue

    precedents.push({
      considerationId: row.id,
      similarity: scored.get(row.id) ?? 0,
      considerationText: row.consideration_text,
      sponsorResponseText: row.sponsor_response_text,
      memberState: row.member_state,
      category: row.category,
      section: row.section,
      documentRef: row.rfi_document.document_ref,
      euTrialNumber: row.trial.eu_trial_number,
      responseStatus: row.response_status,
      outcome: row.outcome,
    })
  }

  if (precedents.length === 0) {
    return {
      ok: false,
      reason:
        'The nearest records in this section carry no accepted sponsor response, so there ' +
        'is no precedent to draft from.',
      precedents: [],
      maxSimilarity: null,
    }
  }

  const ranked = rankPrecedents(precedents, target.memberState)
  const maxSimilarity = Math.max(...precedents.map((p) => p.similarity))

  return { ok: true, precedents: ranked.slice(0, PRECEDENT_K), maxSimilarity }
}

/**
 * The confidence gate (docs/04-AI-PIPELINE.md §4.2).
 *
 * Below the threshold the system declines rather than inventing. In a pharma
 * context that is not a limitation, it is the feature — and it is the one
 * behaviour a regulatory audience will test first.
 */
export function passesConfidenceGate(maxSimilarity: number, threshold: number): boolean {
  return maxSimilarity >= threshold
}

export function refusalReason(maxSimilarity: number, threshold: number): string {
  return (
    `No sufficiently similar precedent found in the repository. The closest approved ` +
    `response scores ${maxSimilarity.toFixed(2)} against a threshold of ${threshold.toFixed(2)}, ` +
    'so this request is answered from scratch by a person rather than drafted from records ' +
    'that do not actually cover it.'
  )
}
