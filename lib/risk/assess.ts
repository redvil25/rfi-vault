import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { sectionSimilarityRpc, type SectionSimilarityRow } from '@/lib/db/pending-rpc'
import { embedQuery, toVectorLiteral } from '@/lib/ai/embed'
import { aiEnabled } from '@/lib/env'
import { log } from '@/lib/log'
import { CATEGORY_BY_ID } from '@/lib/domain/taxonomy'
import type { SubmissionType } from '@/lib/domain/taxonomy'
import {
  baseRateMessage,
  baseRateSignal,
  loadBaseRates,
  type BaseRates,
} from './base-rate'
import { evaluateRules } from './rules'
import { BAND_GUIDANCE, blend, ruleScore } from './score'
import type {
  DraftSectionInput,
  PrecedentHit,
  RiskDriver,
  SectionAssessment,
} from './types'

/**
 * Orchestrates the three signals into a per-section assessment.
 *
 * The deterministic path always runs. Similarity needs embeddings and a model
 * key; when either is missing the signal is *omitted* and the blend
 * renormalises, rather than being scored zero. That distinction is the whole
 * safety property of this feature: a missing subsystem must not read as "this
 * section is fine".
 */

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

/** Mean of the top-k cosines, not the max — max is noisy at this corpus size. */
const SIMILARITY_TOP_K = 3

/** Below this a precedent is background reading, not evidence. */
const PRECEDENT_FLOOR = 0.55

interface SimilarityResult {
  signal: number | undefined
  precedents: PrecedentHit[]
  unavailableBecause?: string
}

async function similarityFor(
  input: DraftSectionInput,
  supabase: SupabaseClient<Database>,
): Promise<SimilarityResult> {
  if (!aiEnabled()) {
    return { signal: undefined, precedents: [], unavailableBecause: 'no model configured' }
  }
  if (!input.content.trim()) {
    return { signal: undefined, precedents: [], unavailableBecause: 'the section is empty' }
  }

  let embedding: number[]
  try {
    embedding = await embedQuery(input.content)
  } catch (err) {
    log.error('risk.embed_failed', { section: input.section }, err)
    return { signal: undefined, precedents: [], unavailableBecause: 'embedding the section failed' }
  }

  const { data, error } = await sectionSimilarityRpc(supabase, {
    query_embed: toVectorLiteral(embedding),
    f_section: input.section,
    f_member_states: input.memberStates.length > 0 ? input.memberStates : undefined,
    match_count: 10,
  })

  if (error) {
    log.error('risk.similarity_failed', { section: input.section }, error)
    return { signal: undefined, precedents: [], unavailableBecause: 'the similarity search failed' }
  }

  const rows: SectionSimilarityRow[] = data ?? []
  if (rows.length === 0) {
    return {
      signal: undefined,
      precedents: [],
      unavailableBecause: 'no comparable sections have been embedded',
    }
  }

  const scored = rows
    .map((r) => ({ row: r, similarity: Number(r.similarity) }))
    .sort((a, b) => b.similarity - a.similarity)

  const top = scored.slice(0, SIMILARITY_TOP_K)
  const signal = top.reduce((sum, s) => sum + s.similarity, 0) / top.length

  const precedents: PrecedentHit[] = scored
    .filter((s) => s.similarity >= PRECEDENT_FLOOR)
    .slice(0, 3)
    .map((s) => ({
      considerationId: s.row.consideration_id,
      similarity: Number(s.similarity.toFixed(4)),
      consideration: s.row.consideration_text,
      approvedResponse: s.row.sponsor_response_text,
      memberState: s.row.member_state,
      category: s.row.category,
    }))

  return { signal: Math.max(0, Math.min(1, signal)), precedents }
}

/**
 * The line that turns a score into work.
 *
 * Prefers the most severe deterministic finding, because it names something
 * specific and checkable. Falls back to precedent, then to an honest statement
 * that nothing was found — never to invented advice.
 */
function recommendedActionFor(
  assessment: Pick<SectionAssessment, 'findings' | 'precedents' | 'unchecked' | 'section'>,
): string {
  const top = assessment.findings[0]
  if (top) {
    const owner = top.categoryId ? CATEGORY_BY_ID.get(top.categoryId)?.owner : undefined
    const who = owner ? ` (${owner.replaceAll('_', ' ').toLowerCase()})` : ''
    return `${top.recommendedAction}${who}`
  }

  if (assessment.precedents.length > 0) {
    const p = assessment.precedents[0]
    const where = p.memberState ? ` in ${p.memberState}` : ''
    return (
      `No checklist finding, but this closely resembles a past request${where} about ` +
      `${p.category.replaceAll('_', ' ').toLowerCase()}. Read that precedent before submitting.`
    )
  }

  if (assessment.unchecked.length > 0) {
    return (
      `Nothing was flagged, but ${assessment.unchecked.length} check${
        assessment.unchecked.length === 1 ? '' : 's'
      } could not run because the artefacts were not declared. Declare them for a real answer.`
    )
  }

  return `No finding for ${assessment.section}. Spot-check only.`
}

export async function assessSection(
  input: DraftSectionInput,
  rates: BaseRates,
  supabase: SupabaseClient<Database>,
): Promise<SectionAssessment> {
  const evaluation = evaluateRules(input)
  const rule = ruleScore(evaluation.findings)

  const similarity = await similarityFor(input, supabase)
  const baseRate = baseRateSignal(rates, input.section)

  const blended = blend({
    rule,
    similarity: similarity.signal,
    baseRate,
  })

  const drivers: RiskDriver[] = []

  if (evaluation.findings.length > 0) {
    drivers.push({
      type: 'RULE',
      id: evaluation.findings[0].ruleId,
      contribution: blended.contributions.RULE,
      message:
        evaluation.findings.length === 1
          ? evaluation.findings[0].message
          : `${evaluation.findings[0].message} (and ${evaluation.findings.length - 1} other checklist ${
              evaluation.findings.length - 1 === 1 ? 'finding' : 'findings'
            })`,
    })
  }

  if (similarity.signal !== undefined) {
    drivers.push({
      type: 'SIMILARITY',
      contribution: blended.contributions.SIMILARITY,
      message: `Resembles ${similarity.precedents.length || SIMILARITY_TOP_K} past ${
        input.section
      } sections that drew a request for information.`,
    })
  }

  if (baseRate !== undefined) {
    drivers.push({
      type: 'BASE_RATE',
      contribution: blended.contributions.BASE_RATE,
      message: baseRateMessage(rates, input.section),
    })
  }

  drivers.sort((a, b) => b.contribution - a.contribution)

  const partial: Pick<SectionAssessment, 'findings' | 'precedents' | 'unchecked' | 'section'> = {
    findings: evaluation.findings,
    precedents: similarity.precedents,
    unchecked: evaluation.unchecked,
    section: input.section,
  }

  const coverage =
    evaluation.applicable === 0 ? 1 : evaluation.evaluated / evaluation.applicable

  const explanationParts = [
    `${BAND_GUIDANCE[blended.band]}`,
    evaluation.findings.length > 0
      ? `${evaluation.findings.length} checklist ${
          evaluation.findings.length === 1 ? 'finding' : 'findings'
        }`
      : 'no checklist findings',
    `${Math.round(coverage * 100)}% of applicable checks could be evaluated`,
  ]
  if (similarity.unavailableBecause) {
    explanationParts.push(`similarity not scored — ${similarity.unavailableBecause}`)
  }

  return {
    section: input.section,
    sectionPart: input.sectionPart,
    score: blended.score,
    band: blended.band,
    findings: evaluation.findings,
    unchecked: evaluation.unchecked,
    coverage: Number(coverage.toFixed(4)),
    topDrivers: drivers,
    precedents: similarity.precedents,
    recommendedAction: recommendedActionFor(partial),
    explanation: explanationParts.join(' · '),
    signalsUsed: blended.signalsUsed,
  }
}

export interface DraftAssessment {
  sections: SectionAssessment[]
  submissionType: SubmissionType
  memberStates: string[]
  /** Sections are returned worst-first: the reviewer works top-down. */
  assessedAt: string
}

export async function assessDraft(
  sections: DraftSectionInput[],
  submissionType: SubmissionType,
  memberStates: string[],
  client?: SupabaseClient<Database>,
): Promise<DraftAssessment> {
  const supabase = client ?? (await requestScopedClient())
  const rates = await loadBaseRates(submissionType, memberStates, supabase)

  // Sequential on purpose: each section may embed, and firing a dozen embedding
  // calls at once is the fastest way to meet a rate limit mid-demo.
  const assessed: SectionAssessment[] = []
  for (const section of sections) {
    assessed.push(await assessSection(section, rates, supabase))
  }

  assessed.sort((a, b) => b.score - a.score || a.section.localeCompare(b.section))

  return {
    sections: assessed,
    submissionType,
    memberStates,
    assessedAt: new Date().toISOString(),
  }
}
