import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types'

/**
 * Typed access to database functions that exist in `supabase/migrations/` but
 * not yet in `lib/db/types.ts`.
 *
 * `types.ts` is generated from the *linked* project, so a function is untyped
 * between the moment its migration is committed and the moment someone applies
 * it remotely and runs `npm run db:types`. That window is normal; scattering a
 * cast at each call site to survive it is not — the casts outlive the window and
 * nobody remembers which were temporary.
 *
 * Everything here is therefore in one file with one instruction:
 *
 *   after `npm run db:migrate && npm run db:types`, delete this module and call
 *   `supabase.rpc(...)` directly. TypeScript will point at every caller.
 *
 * The argument and row types below are transcribed from the migrations by hand.
 * They are the *claim*; the generated types are the proof. Keep them honest.
 */

type AnyClient = SupabaseClient<Database>

interface RpcResponse<T> {
  data: T | null
  error: { message: string } | null
}

type UntypedRpc = (fn: string, args: object) => Promise<RpcResponse<unknown>>

function call<T>(client: AnyClient, fn: string, args: object): Promise<RpcResponse<T>> {
  return (client.rpc as unknown as UntypedRpc)(fn, args) as Promise<RpcResponse<T>>
}

// ------------------------------------------- 0014_keyword_baseline_and_rate_limit

export interface ConsumeRateLimitRow {
  allowed: boolean
  remaining: number
  retry_after_seconds: number
}

export function consumeRateLimitRpc(
  client: AnyClient,
  args: { p_bucket: string; p_limit: number; p_window_seconds: number },
) {
  return call<ConsumeRateLimitRow[]>(client, 'consume_rate_limit', args)
}

// -------------------------------------------------- 0017_section_rfi_rates

export interface SectionRfiRateRow {
  section: string
  section_part: Database['public']['Enums']['section_part']
  hits: number | string
  share: number | string
}

export function sectionRfiRatesRpc(
  client: AnyClient,
  args: {
    f_submission_type?: Database['public']['Enums']['submission_type']
    f_member_states?: string[]
  },
) {
  return call<SectionRfiRateRow[]>(client, 'section_rfi_rates', args)
}

export interface SectionSimilarityRow {
  consideration_id: string
  similarity: number | string
  category: string
  section: string
  member_state: string | null
  consideration_text: string
  sponsor_response_text: string | null
  response_status: Database['public']['Enums']['response_status']
}

export function sectionSimilarityRpc(
  client: AnyClient,
  args: {
    query_embed: string
    f_section?: string
    f_member_states?: string[]
    match_count?: number
  },
) {
  return call<SectionSimilarityRow[]>(client, 'section_similarity', args)
}

// ------------------------------------------- 0018_trial_imp_and_filters
//
// `search_considerations`, `search_facets` and `hybrid_search` all exist in the
// generated types, but with their pre-0018 signatures — without the therapeutic
// area and IMP filters, and without the two extra return columns. Calling them
// with the new arguments is a type error until the migration is applied
// remotely, so they route through here alongside the genuinely new functions.

export interface SearchConsiderationRow {
  id: string
  consideration_number: number
  section_part: Database['public']['Enums']['section_part']
  section: string
  document_name: string | null
  member_state: string | null
  category: string
  consideration_text: string
  sponsor_response_text: string | null
  response_status: Database['public']['Enums']['response_status']
  outcome: Database['public']['Enums']['rfi_outcome']
  owner_team: Database['public']['Enums']['team_role'] | null
  document_ref: string
  submission_type: Database['public']['Enums']['submission_type']
  phase: Database['public']['Enums']['rfi_phase']
  issued_at: string
  due_at: string | null
  eu_trial_number: string
  short_title: string
  therapeutic_area: string | null
  imp_name: string | null
  rank: number
  matched_on: string
  total_count: number | string
}

export interface SearchConsiderationsArgs {
  q?: string
  f_part?: Database['public']['Enums']['section_part']
  f_section?: string
  f_member_state?: string
  f_category?: string
  f_phase?: Database['public']['Enums']['rfi_phase']
  f_submission_type?: Database['public']['Enums']['submission_type']
  f_status?: Database['public']['Enums']['response_status']
  f_from?: string
  f_to?: string
  f_therapeutic_area?: string
  f_imp_name?: string
  sort?: string
  lim?: number
  off?: number
}

export function searchConsiderationsRpc(client: AnyClient, args: SearchConsiderationsArgs) {
  return call<SearchConsiderationRow[]>(client, 'search_considerations', args)
}

export interface FacetRow {
  facet: string
  value: string
  count: number | string
}

export interface SearchFacetsArgs {
  q?: string
  f_part?: Database['public']['Enums']['section_part']
  f_member_state?: string
  f_therapeutic_area?: string
  f_imp_name?: string
}

export function searchFacetsRpc(client: AnyClient, args: SearchFacetsArgs) {
  return call<FacetRow[]>(client, 'search_facets', args)
}

export interface HybridSearchRow {
  consideration_id: string
  kind: string
  vector_rank: number | null
  fts_rank: number | null
  rrf_score: number
  vector_similarity: number
}

export interface HybridSearchArgs {
  query_text: string
  query_embed: string
  match_count?: number
  f_section?: string
  f_member_state?: string
  f_part?: Database['public']['Enums']['section_part']
  f_category?: string
  f_from?: string
  f_approved_only?: boolean
  f_therapeutic_area?: string
  f_imp_name?: string
  rrf_k?: number
}

export function hybridSearchRpc(client: AnyClient, args: HybridSearchArgs) {
  return call<HybridSearchRow[]>(client, 'hybrid_search', args)
}

// --------------------------------------------------------- 0019_analytics

export interface CategoryStatRow {
  category: string
  occurrences: number | string
  distinct_trials: number | string
  member_states: number | string
  accepted: number | string
  open_items: number | string
}

export function rfiStatsByCategoryRpc(client: AnyClient) {
  return call<CategoryStatRow[]>(client, 'rfi_stats_by_category', {})
}

export interface MonthStatRow {
  month: string
  occurrences: number | string
  member_states: number | string
}

export function rfiStatsByMonthRpc(client: AnyClient, args: { f_member_state?: string } = {}) {
  return call<MonthStatRow[]>(client, 'rfi_stats_by_month', args)
}

export interface MemberStateStatRow {
  member_state: string
  occurrences: number | string
  distinct_trials: number | string
}

export function rfiStatsByMemberStateRpc(client: AnyClient) {
  return call<MemberStateStatRow[]>(client, 'rfi_stats_by_member_state', {})
}

export interface TurnaroundRow {
  answered: number | string
  unanswered: number | string
  median_days: number | string | null
  p90_days: number | string | null
  mean_days: number | string | null
  answered_late: number | string
}

export function rfiTurnaroundStatsRpc(client: AnyClient) {
  return call<TurnaroundRow[]>(client, 'rfi_turnaround_stats', {})
}
