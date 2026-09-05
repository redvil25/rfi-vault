import 'server-only'

import { createClient } from '@/lib/db/server'
import { embedQuery, toVectorLiteral } from '@/lib/ai/embed'
import { embeddingsEnabled, serverEnv } from '@/lib/env'
import { log } from '@/lib/log'
import type { Database } from '@/lib/db/types'
import type { SearchHit, SearchParams, SearchResult } from './manual'
import { searchConsiderations } from './manual'
import { bandFor, type ConfidenceBand } from './confidence'

// Re-exported so callers have one import for search; defined in a leaf module
// so a React component can render a band without pulling in the db client.
export { bandFor, BAND_LABELS, BAND_GUIDANCE, BAND_STYLE, CONFIDENCE_THRESHOLDS } from './confidence'
export type { ConfidenceBand } from './confidence'

type Enums = Database['public']['Enums']

/**
 * Hybrid retrieval: pgvector cosine and Postgres full-text, fused by Reciprocal
 * Rank Fusion in a single SQL round trip (ADR-002, 0011_search_functions).
 *
 * Falls back to the keyword path rather than failing when the semantic half is
 * unavailable — no API key, no embeddings written yet, or the model erroring
 * mid-demo. `mode` on the result says which path actually ran, so the UI can
 * tell the user the truth instead of quietly showing worse results.
 */

export type SearchMode = 'hybrid' | 'keyword'

export interface HybridHit extends SearchHit {
  /** Cosine similarity from the vector leg, 0 when only keyword matched. */
  similarity: number
  /** Calibrated band for display — never show a raw RRF score (docs/04 §2.3). */
  confidence: ConfidenceBand
  rrfScore: number
}

export interface HybridResult extends Omit<SearchResult, 'hits'> {
  hits: HybridHit[]
  mode: SearchMode
  /** Set when hybrid was asked for but could not run. */
  fellBackBecause?: string
}

export function matchedOnFor(row: {
  vector_rank: number | null
  fts_rank: number | null
}): string {
  const vector = row.vector_rank != null
  const keyword = row.fts_rank != null
  if (vector && keyword) return 'semantic + keyword'
  if (vector) return 'semantic'
  return 'keyword'
}

/**
 * Keeps the best-scoring row per consideration.
 *
 * One consideration can surface twice — once through its question vector and
 * once through its answer vector (ADR-003). Showing it twice would look like a
 * duplicate-data bug to a reviewer.
 */
export function collapseByConsideration<T extends { consideration_id: string; rrf_score: number }>(
  rows: T[],
): T[] {
  const best = new Map<string, T>()
  for (const row of rows) {
    const prior = best.get(row.consideration_id)
    if (!prior || row.rrf_score > prior.rrf_score) best.set(row.consideration_id, row)
  }
  return [...best.values()].sort((a, b) => b.rrf_score - a.rrf_score)
}

/** True when at least one embedding exists; hybrid over an empty index is worse than keyword. */
async function hasEmbeddings(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<boolean> {
  const { count, error } = await supabase
    .from('rfi_embedding')
    .select('id', { count: 'exact', head: true })
  if (error) {
    log.warn('search.embedding_count_failed', {}, error)
    return false
  }
  return (count ?? 0) > 0
}

const HYDRATE_SELECT = [
  'id, consideration_number, section_part, section, document_name, member_state',
  'category, consideration_text, sponsor_response_text, response_status, outcome',
  'owner_team',
  'rfi_document!inner ( document_ref, submission_type, phase, issued_at, due_at )',
  'trial!inner ( eu_trial_number, short_title, therapeutic_area, imp_name )',
].join(', ')

interface HydratedRow {
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
  rfi_document: {
    document_ref: string
    submission_type: Enums['submission_type']
    phase: Enums['rfi_phase']
    issued_at: string
    due_at: string | null
  }
  trial: {
    eu_trial_number: string
    short_title: string
    therapeutic_area: string | null
    imp_name: string | null
  }
}

export async function hybridSearch(params: SearchParams): Promise<HybridResult> {
  const started = performance.now()

  async function fallback(reason: string): Promise<HybridResult> {
    log.info('search.fallback_to_keyword', { reason })
    const result = await searchConsiderations(params)
    return {
      ...result,
      hits: result.hits.map((h) => ({
        ...h,
        similarity: 0,
        confidence: 'NONE' as const,
        rrfScore: 0,
      })),
      mode: 'keyword',
      fellBackBecause: reason,
    }
  }

  // No query text means the user is browsing filters; there is nothing to embed
  // and keyword browse ordering is the correct behaviour.
  if (!params.q?.trim()) return fallback('no query text')
  if (!embeddingsEnabled()) return fallback('no embedding model available')

  const supabase = await createClient()
  if (!(await hasEmbeddings(supabase))) return fallback('corpus not embedded yet')

  let queryEmbedding: number[]
  try {
    queryEmbedding = await embedQuery(params.q)
  } catch (err) {
    log.error('search.embed_query_failed', { q: params.q.slice(0, 60) }, err)
    return fallback('embedding the query failed')
  }

  // Fetch a wider slice than one page so pagination has something to page over.
  const matchCount = Math.min(200, params.pageSize * 5)

  const { data, error } = await supabase.rpc('hybrid_search', {
    query_text: params.q,
    query_embed: toVectorLiteral(queryEmbedding),
    match_count: matchCount,
    f_section: params.section ?? undefined,
    f_member_state: params.memberState ?? undefined,
    f_part: params.part ?? undefined,
    f_category: params.category ?? undefined,
    f_from: params.from ?? undefined,
    f_approved_only: params.status === 'APPROVED' ? true : undefined,
    f_therapeutic_area: params.therapeuticArea ?? undefined,
    f_imp_name: params.impName ?? undefined,
    f_protocol_code: params.protocolCode ?? undefined,
    rrf_k: serverEnv().RRF_K,
  })

  if (error) {
    log.error('search.hybrid_rpc_failed', { q: params.q.slice(0, 60) }, error)
    return fallback('hybrid search failed')
  }

  const ranked = collapseByConsideration(data ?? [])

  if (ranked.length === 0) {
    return {
      hits: [],
      total: 0,
      page: params.page,
      pageSize: params.pageSize,
      totalPages: 1,
      tookMs: Math.round(performance.now() - started),
      mode: 'hybrid',
    }
  }

  const offset = (params.page - 1) * params.pageSize
  const pageRows = ranked.slice(offset, offset + params.pageSize)

  // Hydrate through the user's client so RLS decides what is readable. A row the
  // fusion found but the policy hides simply does not come back.
  const { data: hydrated, error: hydrateError } = await supabase
    .from('rfi_consideration')
    .select(HYDRATE_SELECT)
    .in(
      'id',
      pageRows.map((r) => r.consideration_id),
    )

  if (hydrateError) {
    log.error('search.hydrate_failed', {}, hydrateError)
    return fallback('reading the matched records failed')
  }

  const byId = new Map(((hydrated ?? []) as unknown as HydratedRow[]).map((r) => [r.id, r]))

  const hits: HybridHit[] = []
  for (const row of pageRows) {
    const r = byId.get(row.consideration_id)
    if (!r) continue // hidden by RLS
    const similarity = Number(row.vector_similarity) || 0
    hits.push({
      id: r.id,
      considerationNumber: r.consideration_number,
      sectionPart: r.section_part,
      section: r.section,
      documentName: r.document_name,
      memberState: r.member_state,
      category: r.category,
      considerationText: r.consideration_text,
      sponsorResponseText: r.sponsor_response_text,
      responseStatus: r.response_status,
      outcome: r.outcome,
      ownerTeam: r.owner_team,
      documentRef: r.rfi_document.document_ref,
      submissionType: r.rfi_document.submission_type,
      phase: r.rfi_document.phase,
      issuedAt: r.rfi_document.issued_at,
      dueAt: r.rfi_document.due_at,
      euTrialNumber: r.trial.eu_trial_number,
      shortTitle: r.trial.short_title,
      therapeuticArea: r.trial.therapeutic_area,
      impName: r.trial.imp_name,
      rank: Number(row.rrf_score),
      matchedOn: matchedOnFor(row),
      similarity,
      confidence: bandFor(similarity),
      rrfScore: Number(row.rrf_score),
    })
  }

  return {
    hits,
    total: ranked.length,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.max(1, Math.ceil(ranked.length / params.pageSize)),
    tookMs: Math.round(performance.now() - started),
    mode: 'hybrid',
  }
}
