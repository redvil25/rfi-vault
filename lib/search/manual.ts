import 'server-only'

import { z } from 'zod'
import { createClient } from '@/lib/db/server'
import {
  searchConsiderationsRpc, searchFacetsRpc, type SearchConsiderationRow,
} from '@/lib/db/pending-rpc'
import type { Database } from '@/lib/db/types'

type Enums = Database['public']['Enums']

/**
 * Manual (non-AI) search.
 *
 * Runs entirely in Postgres: weighted full-text over the consideration and the
 * approved response, plus verbatim identifier matching for document references
 * and EU trial numbers. Works with no model configured — see docs/04-AI-PIPELINE.md
 * for the semantic layer that is fused on top of this later.
 */

export const SORTS = ['relevance', 'newest', 'oldest'] as const

export const searchParamsSchema = z.object({
  q: z.string().trim().max(300).optional(),
  part: z.enum(['PART_I', 'PART_II']).optional(),
  section: z.string().trim().max(100).optional(),
  memberState: z.string().trim().length(2).toUpperCase().optional(),
  category: z.string().trim().max(60).optional(),
  therapeuticArea: z.string().trim().max(80).optional(),
  impName: z.string().trim().max(40).optional(),
  phase: z.enum(['VALIDATION', 'ASSESSMENT_PART_I', 'ASSESSMENT_PART_II']).optional(),
  submissionType: z
    .enum(['INITIAL', 'SUBSTANTIAL_MODIFICATION', 'ADDITIONAL_MS'])
    .optional(),
  status: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'SUBMITTED']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  sort: z.enum(SORTS).default('relevance'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type SearchParams = z.infer<typeof searchParamsSchema>

export interface SearchHit {
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
  documentRef: string
  submissionType: Enums['submission_type']
  phase: Enums['rfi_phase']
  issuedAt: string
  dueAt: string | null
  euTrialNumber: string
  shortTitle: string
  therapeuticArea: string | null
  impName: string | null
  rank: number
  matchedOn: string
}

export interface SearchResult {
  hits: SearchHit[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  tookMs: number
}

function toHit(r: SearchConsiderationRow): SearchHit {
  return {
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
    documentRef: r.document_ref,
    submissionType: r.submission_type,
    phase: r.phase,
    issuedAt: r.issued_at,
    dueAt: r.due_at,
    euTrialNumber: r.eu_trial_number,
    shortTitle: r.short_title,
    therapeuticArea: r.therapeutic_area,
    impName: r.imp_name,
    rank: r.rank,
    matchedOn: r.matched_on,
  }
}

export async function searchConsiderations(
  params: SearchParams,
): Promise<SearchResult> {
  const supabase = await createClient()
  const started = performance.now()

  const { data, error } = await searchConsiderationsRpc(supabase, {
    q: params.q ?? undefined,
    f_part: params.part ?? undefined,
    f_section: params.section ?? undefined,
    f_member_state: params.memberState ?? undefined,
    f_category: params.category ?? undefined,
    f_phase: params.phase ?? undefined,
    f_submission_type: params.submissionType ?? undefined,
    f_status: params.status ?? undefined,
    f_from: params.from ?? undefined,
    f_to: params.to ?? undefined,
    f_therapeutic_area: params.therapeuticArea ?? undefined,
    f_imp_name: params.impName ?? undefined,
    sort: params.sort,
    lim: params.pageSize,
    off: (params.page - 1) * params.pageSize,
  })

  if (error) throw new Error(`search_considerations failed: ${error.message}`)

  const rows = data ?? []
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0

  return {
    hits: rows.map(toHit),
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
    tookMs: Math.round(performance.now() - started),
  }
}

export interface Facet {
  facet: string
  value: string
  count: number
}

export async function searchFacets(params: {
  q?: string
  part?: Enums['section_part']
  memberState?: string
  therapeuticArea?: string
  impName?: string
}): Promise<Record<string, Facet[]>> {
  const supabase = await createClient()

  const { data, error } = await searchFacetsRpc(supabase, {
    q: params.q ?? undefined,
    f_part: params.part ?? undefined,
    f_member_state: params.memberState ?? undefined,
    f_therapeutic_area: params.therapeuticArea ?? undefined,
    f_imp_name: params.impName ?? undefined,
  })

  if (error) throw new Error(`search_facets failed: ${error.message}`)

  const grouped: Record<string, Facet[]> = {}
  for (const row of data ?? []) {
    ;(grouped[row.facet] ??= []).push({
      facet: row.facet,
      value: row.value,
      count: Number(row.count),
    })
  }
  return grouped
}
