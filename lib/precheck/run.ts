import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { log } from '@/lib/log'
import { CATEGORY_BY_ID, MEMBER_STATE_BY_CODE } from '@/lib/domain/taxonomy'
import { lintSection } from './lint'
import {
  describeRule,
  fixFor,
  isLive,
  severityForLint,
  severityForRule,
  skipReason,
  toMinedRule,
  type MinedRuleRow,
} from './rules'
import type {
  Coverage,
  Flag,
  MinedRule,
  PrecheckInput,
  PrecheckResult,
  RulePrecedent,
  RuleReport,
  Severity,
} from './types'
import { SEVERITY_ORDER } from './types'

/**
 * The pre-submission check (docs/04-AI-PIPELINE.md §3).
 *
 * Three passes, none of which call a model:
 *
 *   1. Lint the text the writer pasted, for the gap they admitted themselves.
 *   2. Mine the corpus for what this Member State and section actually gets
 *      asked, scoped to submissions like this one and to rules still alive.
 *   3. Attach the verbatim precedent and the response that closed it, so every
 *      flag arrives with its own evidence.
 *
 * The output leads with flags, not with a score, and it reports what did *not*
 * run alongside what did. A writer who cannot see coverage has to assume it.
 */

/** Precedents fetched per flag. Three is what fits on screen without a scroll. */
const PRECEDENTS_PER_FLAG = 3

/** Mined rules turned into flags per section, highest recurrence first. */
const RULES_PER_SECTION = 4

interface PrecedentRow {
  consideration_id: string
  consideration_text: string
  sponsor_response_text: string | null
  member_state: string | null
  section: string
  issued_at: string
  document_ref: string
  eu_trial_number: string
  protocol_code: string | null
}

function toPrecedent(row: PrecedentRow): RulePrecedent {
  return {
    considerationId: row.consideration_id,
    considerationText: row.consideration_text,
    sponsorResponseText: row.sponsor_response_text ?? '',
    memberState: row.member_state,
    section: row.section,
    issuedAt: row.issued_at,
    documentRef: row.document_ref,
    euTrialNumber: row.eu_trial_number,
    protocolCode: row.protocol_code,
  }
}

/**
 * Which mined rule a lint hit belongs to.
 *
 * A phrase like "not attached" says something is missing but not *what*, so the
 * section's most recurrent live theme is the best available guess at which
 * artefact the writer means. It is a guess, and the UI says so by showing the
 * precedent rather than asserting the link.
 */
function ruleForSection(rules: MinedRule[], section: string): MinedRule | null {
  return rules.filter((r) => r.section === section && isLive(r)).sort((a, b) => b.hits - a.hits)[0] ?? null
}

export async function runPrecheck(
  input: PrecheckInput,
  supabase: SupabaseClient<Database>,
  now: Date = new Date(),
): Promise<PrecheckResult> {
  const sections = input.sections.filter((s) => s.text.trim().length > 0)
  const sectionNames = sections.map((s) => s.section)

  // ---- 2. mine the corpus -------------------------------------------------
  let mined: MinedRule[] = []
  if (sectionNames.length > 0) {
    const { data, error } = await supabase.rpc('mined_rules', {
      f_member_states: input.memberStates,
      f_submission_type: input.submissionType,
      f_sections: sectionNames,
    })
    if (error) {
      log.error('precheck.mine_failed', { sections: sectionNames.length }, error)
      throw new Error(`Could not read precedent from the repository: ${error.message}`)
    }
    mined = ((data ?? []) as MinedRuleRow[]).map((row) => toMinedRule(row, now))
  }

  // ---- 3. precedent, once per category that will be shown -----------------
  const wanted = new Map<string, MinedRule>()
  for (const section of sectionNames) {
    for (const rule of mined
      .filter((r) => r.section === section && isLive(r))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, RULES_PER_SECTION)) {
      wanted.set(`${rule.category}::${rule.section}`, rule)
    }
  }
  // A lint hit borrows its section's leading rule, which may not be in the
  // top slice above.
  for (const section of sectionNames) {
    const lead = ruleForSection(mined, section)
    if (lead) wanted.set(`${lead.category}::${lead.section}`, lead)
  }

  const precedents = new Map<string, RulePrecedent[]>()
  await Promise.all(
    [...wanted.values()].map(async (rule) => {
      const { data, error } = await supabase.rpc('rule_precedents', {
        f_category: rule.category,
        f_section: rule.section,
        f_member_states: input.memberStates,
        f_submission_type: input.submissionType,
        match_count: PRECEDENTS_PER_FLAG,
      })
      if (error) {
        // One category failing must not fail the whole check. The flag still
        // shows, without its evidence, and the UI says the evidence is missing.
        log.warn('precheck.precedent_failed', { category: rule.category }, error)
        return
      }
      precedents.set(
        `${rule.category}::${rule.section}`,
        ((data ?? []) as PrecedentRow[]).map(toPrecedent),
      )
    }),
  )

  // ---- 1. lint, and assemble ----------------------------------------------
  const flags: Flag[] = []
  const rules: RuleReport[] = []

  for (const { section, text } of sections) {
    const lead = ruleForSection(mined, section)
    const leadKey = lead ? `${lead.category}::${lead.section}` : null
    const leadPrecedents = leadKey ? (precedents.get(leadKey) ?? []) : []

    for (const finding of lintSection(text)) {
      flags.push({
        id: `lint:${section}:${finding.start}`,
        severity: severityForLint(finding),
        section,
        title:
          finding.kind === 'PLACEHOLDER'
            ? `Placeholder text left in ${section}`
            : `"${finding.phrase}" in ${section}`,
        detail: finding.because,
        lint: finding,
        rule: lead,
        precedents: leadPrecedents,
        fix: fixFor(lead?.category ?? '', leadPrecedents),
      })
    }

    const sectionRules = mined
      .filter((r) => r.section === section)
      .sort((a, b) => b.hits - a.hits)

    for (const rule of sectionRules) {
      const key = `${rule.category}::${rule.section}`
      const live = isLive(rule)
      const shown = live && sectionRules.filter(isLive).slice(0, RULES_PER_SECTION).includes(rule)

      rules.push({
        key: `${key}::${rule.memberState ?? 'ALL'}`,
        label: rule.label,
        section,
        outcome: shown ? 'FLAGGED' : live ? 'CLEAR' : 'SKIPPED',
        note: live
          ? describeRule(rule)
          : skipReason(rule),
      })

      if (!shown) continue

      const rulePrecedents = precedents.get(key) ?? []
      flags.push({
        id: `rule:${key}:${rule.memberState ?? 'ALL'}`,
        severity: severityForRule(rule),
        section,
        title: rule.label,
        detail: describeRule(rule),
        lint: null,
        rule,
        precedents: rulePrecedents,
        fix: fixFor(rule.category, rulePrecedents),
      })
    }
  }

  flags.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (b.rule?.hits ?? 0) - (a.rule?.hits ?? 0),
  )

  const counts = flags.reduce<Record<Severity, number>>(
    (acc, f) => ({ ...acc, [f.severity]: acc[f.severity] + 1 }),
    { BLOCKER: 0, LIKELY: 0, WATCH: 0 },
  )

  return {
    flags,
    rules,
    coverage: coverageOf(mined, input.memberStates),
    counts,
    ranAt: now.toISOString(),
  }
}

/**
 * What the answer rests on.
 *
 * Stated in the UI rather than left for the user to discover. The two honest
 * limits are the corpus date range — nothing after it has been seen — and the
 * Member States with no precedent at all, where "no flags" means "no data",
 * which is a different thing entirely and the more dangerous of the two.
 */
export function coverageOf(mined: MinedRule[], memberStates: string[]): Coverage {
  const dates = mined.flatMap((r) => [r.firstSeen, r.lastSeen]).sort()
  const covered = new Set(mined.map((r) => r.memberState).filter((m): m is string => m !== null))
  return {
    consideredRows: mined.reduce((sum, r) => sum + r.hits, 0),
    corpusFrom: dates[0] ?? null,
    corpusTo: dates[dates.length - 1] ?? null,
    // Every row in this repository is generated by scripts/seed. Nothing is a
    // real trial, sponsor or patient, and a user is told so on the screen that
    // uses it rather than in a document they will not read.
    syntheticOnly: true,
    memberStatesCovered: [...covered].sort(),
    memberStatesWithoutPrecedent: memberStates
      .filter((code) => !covered.has(code))
      .filter((code) => MEMBER_STATE_BY_CODE.has(code))
      .sort(),
  }
}

/** Section list offered on the form, in taxonomy order. */
export function sectionsWithKnownCategories(): string[] {
  const withCategories = new Set([...CATEGORY_BY_ID.values()].flatMap((c) => c.sections))
  return [...withCategories].sort()
}
