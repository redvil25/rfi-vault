import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { log } from '@/lib/log'
import type { SubmissionType } from '@/lib/domain/taxonomy'

/**
 * Signal (c): how much of historical RFI volume attaches to each section.
 *
 * Not a probability. `rfi_consideration` records only requests that were raised;
 * sections that were submitted and drew nothing were never recorded, so the
 * denominator for a true rate does not exist. See 0017_section_rfi_rates.sql —
 * the distinction is repeated here because this is the value the UI renders and
 * the wording matters.
 */

export interface SectionRate {
  section: string
  hits: number
  /** Laplace-smoothed share of observed RFI volume, 0–1. */
  share: number
}

/**
 * The largest share any single section holds, used to scale the signal.
 *
 * Raw shares are small — with twenty-odd sections the biggest is rarely above
 * 0.15 — so feeding them into the blend unscaled would make this signal
 * contribute almost nothing regardless of its weight. Scaling by the observed
 * maximum makes it "how much of the RFI volume does this section carry, relative
 * to the worst section", which is the comparison a reviewer actually makes.
 */
export interface BaseRates {
  bySection: Map<string, SectionRate>
  max: number
  total: number
}

/**
 * Imported lazily, and only when no client was injected. `lib/db/server.ts`
 * carries the `server-only` marker, which throws the moment it is loaded under
 * tsx — so a static import here would break `npm run verify:assess` even though
 * that script supplies its own client and never needs the default.
 */
async function requestScopedClient(): Promise<SupabaseClient<Database>> {
  const { createClient } = await import('@/lib/db/server')
  return createClient()
}

export const EMPTY_BASE_RATES: BaseRates = { bySection: new Map(), max: 0, total: 0 }

/**
 * `client` is injectable so the verification script can run this against a real
 * database with the service client. Defaults to the request-scoped client, which
 * is the only thing application code should pass — or omit.
 */
export async function loadBaseRates(
  submissionType: SubmissionType,
  memberStates: string[],
  client?: SupabaseClient<Database>,
): Promise<BaseRates> {
  const supabase = client ?? (await requestScopedClient())

  const { data, error } = await supabase.rpc('section_rfi_rates', {
    f_submission_type: submissionType,
    f_member_states: memberStates.length > 0 ? memberStates : undefined,
  })

  if (error) {
    // A missing base rate is a missing signal, not a failed assessment: the
    // blend renormalises around it and the rule engine still runs.
    log.warn('risk.base_rates_failed', { submissionType }, error)
    return EMPTY_BASE_RATES
  }

  const rows = data ?? []

  const bySection = new Map<string, SectionRate>()
  let max = 0
  let total = 0

  for (const row of rows) {
    const rate: SectionRate = {
      section: row.section,
      hits: Number(row.hits),
      share: Number(row.share),
    }
    bySection.set(rate.section, rate)
    if (rate.share > max) max = rate.share
    total += rate.hits
  }

  return { bySection, max, total }
}

/** Scales a section's share against the busiest section. Returns undefined when unknown. */
export function baseRateSignal(rates: BaseRates, section: string): number | undefined {
  if (rates.bySection.size === 0 || rates.max <= 0) return undefined
  const rate = rates.bySection.get(section)
  if (!rate) return 0
  return Math.min(1, rate.share / rates.max)
}

/** Wording for the driver line, stated as volume share rather than probability. */
export function baseRateMessage(rates: BaseRates, section: string): string {
  const rate = rates.bySection.get(section)
  if (!rate || rates.total === 0) {
    return `No comparable requests recorded for ${section} in this slice of the repository.`
  }
  const percent = ((rate.hits / rates.total) * 100).toFixed(0)
  return (
    `${section} accounts for ${percent}% of the ${rates.total} comparable requests in the ` +
    'repository — a share of what has been raised, not a probability of being raised.'
  )
}
