import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { log } from '@/lib/log'
import { CATEGORY_BY_ID, MEMBER_STATE_BY_CODE } from '@/lib/domain/taxonomy'
import { classifyConsideration } from '@/lib/ingest/classify'
import { lintSection } from './lint'
import { checkConsistency } from './consistency'
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
  Scope,
  Severity,
} from './types'
import { SEVERITY_ORDER } from './types'

/**
 * The pre-submission check (docs/04-AI-PIPELINE.md §3).
 *
 * Four deterministic passes, none of which call a model:
 *
 *   1. Lint the text the writer pasted, for the gap they admitted themselves.
 *   2. Check values that must agree across sections — protocol version, subject
 *      numbers, IMP name and strength.
 *   3. Mine the corpus for what this Member State and section actually gets
 *      asked, scoped to submissions like this one.
 *   4. Attach the verbatim precedent and the response that closed it.
 *
 * The output leads with flags, not with a score, and it reports what did *not*
 * run alongside what did.
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
 * Scopes, narrowest first.
 *
 * The narrow scope is the honest one — what *this* country asks about *this*
 * kind of submission — but on a corpus of any realistic size it is often thin
 * enough to return nothing, and a check that silently finds nothing reads
 * exactly like a check that found nothing wrong.
 *
 * So the scope widens until it has something to say, and the screen states
 * which scope produced the answer. Widening in silence would be worse than not
 * widening at all: "Italy asks this" and "somebody, somewhere, asks this" are
 * different claims and the user has to be able to tell them apart.
 */
function scopesFor(input: PrecheckInput): Scope[] {
  const states = input.memberStates.filter((c) => MEMBER_STATE_BY_CODE.has(c))
  const named = states.join(', ')
  return [
    {
      id: 'EXACT',
      memberStates: states,
      submissionType: input.submissionType,
      label: named ? `${named}, this submission type` : 'this submission type',
    },
    {
      id: 'ANY_SUBMISSION_TYPE',
      memberStates: states,
      submissionType: null,
      label: named ? `${named}, any submission type` : 'any submission type',
    },
    {
      id: 'ANY_MEMBER_STATE',
      memberStates: [],
      submissionType: null,
      label: 'any Member State, any submission type',
    },
  ]
}

async function mineAt(
  scope: Scope,
  sections: string[],
  supabase: SupabaseClient<Database>,
  now: Date,
): Promise<MinedRule[]> {
  const { data, error } = await supabase.rpc('mined_rules', {
    f_member_states: scope.memberStates,
    f_submission_type: scope.submissionType ?? undefined,
    f_sections: sections,
  })
  if (error) {
    log.error('precheck.mine_failed', { scope: scope.id }, error)
    throw new Error(`Could not read precedent from the repository: ${error.message}`)
  }
  return ((data ?? []) as MinedRuleRow[]).map((row) => toMinedRule(row, now))
}

/**
 * Which mined theme a lint hit is about.
 *
 * The first version borrowed the section's most recurrent live rule, which was
 * wrong in the way that matters: on a section whose rules are all stale it
 * borrowed nothing, so the flag arrived with no artefact, no owner and no
 * precedent — the three things the writer actually wanted.
 *
 * The text says what it is about. `classifyConsideration` already turns
 * regulatory prose into a taxonomy category deterministically, and it is the
 * same classifier ingestion files documents with, so a flag and a filed
 * consideration cannot disagree about what "proof of payment" means (ADR-024).
 */
function categoriseFinding(excerpt: string, sectionText: string, section: string): string | null {
  for (const text of [excerpt, sectionText]) {
    const { category, confidence } = classifyConsideration({
      text,
      section,
      part: null,
      memberState: null,
    })
    if (category !== 'UNCLASSIFIED' && confidence >= 0.25) return category
  }
  return null
}

export async function runPrecheck(
  input: PrecheckInput,
  supabase: SupabaseClient<Database>,
  now: Date = new Date(),
): Promise<PrecheckResult> {
  const sections = input.sections.filter((s) => s.text.trim().length > 0)
  const sectionNames = [...new Set(sections.map((s) => s.section))]

  // ---- 3. mine the corpus, widening only as far as it has to ---------------
  const scopes = scopesFor(input)
  let mined: MinedRule[] = []
  let scope: Scope = scopes[0]

  if (sectionNames.length > 0) {
    for (const candidate of scopes) {
      scope = candidate
      mined = await mineAt(candidate, sectionNames, supabase, now)
      if (mined.some(isLive)) break
    }
  }

  // ---- 4. precedent -------------------------------------------------------
  //
  // Fetched for every theme with a resolved occurrence, whether or not the rule
  // is live. Staleness governs whether a rule *fires* — it does not make the
  // history untrue, and the accepted answer from 2025 is still the best wording
  // anyone has. The card labels how old it is and lets the reader judge.
  const wanted = new Map<string, MinedRule>()
  for (const section of sectionNames) {
    const inSection = mined.filter((r) => r.section === section)
    for (const rule of inSection.filter(isLive).sort((a, b) => b.hits - a.hits).slice(0, RULES_PER_SECTION)) {
      wanted.set(`${rule.category}::${rule.section}`, rule)
    }
    for (const rule of inSection.filter((r) => r.resolvedHits > 0).sort((a, b) => b.hits - a.hits).slice(0, RULES_PER_SECTION)) {
      wanted.set(`${rule.category}::${rule.section}`, rule)
    }
  }

  // Categories the lint landed on, which may have no mined rule at all.
  const lintCategories = new Map<string, { category: string; section: string }>()
  const findingsBySection = new Map<string, ReturnType<typeof lintSection>>()
  for (const { section, text } of sections) {
    const findings = lintSection(text)
    findingsBySection.set(section, findings)
    for (const f of findings) {
      const category = categoriseFinding(f.excerpt, text, section)
      if (category) lintCategories.set(`${category}::${section}`, { category, section })
    }
  }

  const lookups = new Map<string, { category: string; section: string }>()
  for (const [key, rule] of wanted) lookups.set(key, { category: rule.category, section: rule.section })
  for (const [key, v] of lintCategories) lookups.set(key, v)

  const precedents = new Map<string, RulePrecedent[]>()
  await Promise.all(
    [...lookups.entries()].map(async ([key, { category, section }]) => {
      const { data, error } = await supabase.rpc('rule_precedents', {
        f_category: category,
        f_section: section,
        f_member_states: scope.memberStates,
        f_submission_type: scope.submissionType ?? undefined,
        match_count: PRECEDENTS_PER_FLAG,
      })
      if (error) {
        // One category failing must not fail the whole check. The flag still
        // shows, without its evidence, and the card says the evidence is absent.
        log.warn('precheck.precedent_failed', { category }, error)
        return
      }
      precedents.set(key, ((data ?? []) as PrecedentRow[]).map(toPrecedent))
    }),
  )

  // ---- 1 + 2. lint, consistency, and assemble -----------------------------
  const flags: Flag[] = []
  const rules: RuleReport[] = []

  for (const { section, text } of sections) {
    for (const finding of findingsBySection.get(section) ?? []) {
      const category = categoriseFinding(finding.excerpt, text, section)
      const key = category ? `${category}::${section}` : null
      const found = key ? (precedents.get(key) ?? []) : []
      const rule = key ? (mined.find((r) => `${r.category}::${r.section}` === key) ?? null) : null

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
        rule,
        precedents: found,
        fix: fixFor(category ?? '', found),
      })
    }

    // ---- 2. values that must agree across sections ------------------------
    const sectionRules = mined.filter((r) => r.section === section).sort((a, b) => b.hits - a.hits)
    const live = sectionRules.filter(isLive).slice(0, RULES_PER_SECTION)

    for (const rule of sectionRules) {
      const key = `${rule.category}::${rule.section}`
      const shown = live.includes(rule)

      rules.push({
        key: `${key}::${rule.memberState ?? 'ALL'}`,
        label: rule.label,
        section,
        outcome: shown ? 'FLAGGED' : isLive(rule) ? 'CLEAR' : 'SKIPPED',
        note: isLive(rule) ? describeRule(rule) : skipReason(rule),
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

  for (const finding of checkConsistency(sections)) {
    rules.push({
      key: `consistency:${finding.id}`,
      label: finding.label,
      section: finding.sections.join(' / '),
      // A comparison that could not run is SKIPPED, never CLEAR. A green tick
      // for a check that never happened is the one thing this feature must not
      // do (ADR-025).
      outcome: finding.disagrees ? 'FLAGGED' : finding.checked ? 'CLEAR' : 'SKIPPED',
      note: finding.note,
    })
    if (!finding.disagrees) continue
    flags.push({
      id: `consistency:${finding.id}`,
      severity: 'BLOCKER',
      section: finding.sections.join(' / '),
      title: finding.label,
      detail: finding.note,
      lint: null,
      rule: null,
      precedents: [],
      fix: { missingArtefact: null, suggestedWording: null, suggestedWordingFrom: null, owner: null },
      disagreement: finding.values,
    })
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
    scope,
    coverage: coverageOf(mined, input.memberStates),
    counts,
    ranAt: now.toISOString(),
  }
}

/**
 * What the answer rests on.
 *
 * Stated in the UI rather than left for the user to discover. The honest limits
 * are the corpus date range — nothing after it has been seen — and the Member
 * States with no precedent at all, where "no flags" means "no data", which is a
 * different thing entirely and the more dangerous of the two.
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
