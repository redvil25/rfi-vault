import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { CATEGORY_BY_ID, MEMBER_STATE_BY_CODE } from '@/lib/domain/taxonomy'
import { log } from '@/lib/log'

/**
 * Feature 4. Reads the aggregates from 0019 and joins the taxonomy on top.
 *
 * SQL returns counts; tier, preventability and owning team are applied here from
 * `lib/domain/taxonomy.ts`. One copy of the domain knowledge, same reasoning as
 * the rule engine (ADR-024).
 *
 * Everything is read through the user's client, so RLS applies. Two teams
 * looking at this page can legitimately see different totals, and that is
 * correct rather than a bug.
 */

export interface CategoryStat {
  category: string
  label: string
  tier: number
  preventable: boolean
  owner: string | null
  occurrences: number
  distinctTrials: number
  memberStates: number
  accepted: number
  openItems: number
  /** Occurrences divided by distinct trials. Above 1 means it repeats within a trial. */
  repeatRate: number
}

export interface MonthStat {
  month: string
  occurrences: number
  memberStates: number
}

export interface MemberStateStat {
  code: string
  name: string
  occurrences: number
  distinctTrials: number
}

export interface Turnaround {
  answered: number
  unanswered: number
  medianDays: number | null
  p90Days: number | null
  meanDays: number | null
  answeredLate: number
}

export interface Preventability {
  total: number
  preventable: number
  /** Share of volume in categories the taxonomy marks preventable, 0–1. */
  share: number
  /** Volume in Tier 1 and Tier 2 — administrative and document handling. */
  tier12: number
  tier12Share: number
}

export interface AnalyticsSnapshot {
  categories: CategoryStat[]
  months: MonthStat[]
  memberStates: MemberStateStat[]
  turnaround: Turnaround | null
  preventability: Preventability
  total: number
  /** True when nothing could be read — an empty corpus, or a failed query. */
  empty: boolean
}

const n = (value: number | string | null | undefined): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const nullableNumber = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Imported lazily, and only when no client was injected: `lib/db/server.ts`
 * carries the `server-only` marker, which throws the moment it loads under tsx.
 * A static import would break the verification script even though it supplies
 * its own client.
 */
async function requestScopedClient(): Promise<SupabaseClient<Database>> {
  const { createClient } = await import('@/lib/db/server')
  return createClient()
}

export async function loadAnalytics(
  client?: SupabaseClient<Database>,
): Promise<AnalyticsSnapshot> {
  const supabase = client ?? (await requestScopedClient())

  const [categoriesResult, monthsResult, memberStatesResult, turnaroundResult] =
    await Promise.all([
      supabase.rpc('rfi_stats_by_category'),
      supabase.rpc('rfi_stats_by_month'),
      supabase.rpc('rfi_stats_by_member_state'),
      supabase.rpc('rfi_turnaround_stats'),
    ])

  for (const [name, result] of [
    ['category', categoriesResult],
    ['month', monthsResult],
    ['member_state', memberStatesResult],
    ['turnaround', turnaroundResult],
  ] as const) {
    if (result.error) log.error('analytics.query_failed', { query: name }, result.error)
  }

  const categories: CategoryStat[] = (categoriesResult.data ?? []).map((row) => {
    const taxonomy = CATEGORY_BY_ID.get(row.category)
    const occurrences = n(row.occurrences)
    const distinctTrials = n(row.distinct_trials)
    return {
      category: row.category,
      label: taxonomy?.label ?? row.category.replaceAll('_', ' ').toLowerCase(),
      tier: taxonomy?.tier ?? 0,
      preventable: taxonomy?.preventable ?? false,
      owner: taxonomy?.owner ?? null,
      occurrences,
      distinctTrials,
      memberStates: n(row.member_states),
      accepted: n(row.accepted),
      openItems: n(row.open_items),
      repeatRate: distinctTrials > 0 ? occurrences / distinctTrials : 0,
    }
  })

  const total = categories.reduce((sum, c) => sum + c.occurrences, 0)
  const preventable = categories
    .filter((c) => c.preventable)
    .reduce((sum, c) => sum + c.occurrences, 0)
  const tier12 = categories
    .filter((c) => c.tier === 1 || c.tier === 2)
    .reduce((sum, c) => sum + c.occurrences, 0)

  const months: MonthStat[] = (monthsResult.data ?? []).map((row) => ({
    month: row.month,
    occurrences: n(row.occurrences),
    memberStates: n(row.member_states),
  }))

  const memberStates: MemberStateStat[] = (memberStatesResult.data ?? []).map((row) => ({
    code: row.member_state,
    name: MEMBER_STATE_BY_CODE.get(row.member_state)?.name ?? row.member_state,
    occurrences: n(row.occurrences),
    distinctTrials: n(row.distinct_trials),
  }))

  const turnaroundRow = turnaroundResult.data?.[0]
  const turnaround: Turnaround | null = turnaroundRow
    ? {
        answered: n(turnaroundRow.answered),
        unanswered: n(turnaroundRow.unanswered),
        medianDays: nullableNumber(turnaroundRow.median_days),
        p90Days: nullableNumber(turnaroundRow.p90_days),
        meanDays: nullableNumber(turnaroundRow.mean_days),
        answeredLate: n(turnaroundRow.answered_late),
      }
    : null

  return {
    categories,
    months,
    memberStates,
    turnaround,
    preventability: {
      total,
      preventable,
      share: total > 0 ? preventable / total : 0,
      tier12,
      tier12Share: total > 0 ? tier12 / total : 0,
    },
    total,
    empty: total === 0,
  }
}
