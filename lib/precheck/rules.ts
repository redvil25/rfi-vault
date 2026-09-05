import { CATEGORY_BY_ID } from '@/lib/domain/taxonomy'
import type { LintFinding } from './lint'
import type { Fix, MinedRule, RulePrecedent, Severity } from './types'

/**
 * Mined rules, date-scoped (docs/04-AI-PIPELINE.md §3.2).
 *
 * Rules are derived from the corpus, never hand-authored. A hand-written
 * national-requirements matrix for fifteen Member States is a promise this team
 * cannot keep: it asserts details nobody here has authority over, it rots within
 * a quarter, and it stops at whichever four countries got the most attention.
 * A mined rule carries its own evidence — a count, a date range, and the
 * verbatim text — so it is explainable by construction and it scales to every
 * country in the corpus at no extra cost.
 *
 * The date range is not decoration. Italy's fee rule applies to submissions from
 * 17 February 2025; a rule mined from 2023 may describe a requirement that no
 * longer exists. So every rule carries `firstSeen` and `lastSeen`, and one that
 * has not recurred within STALE_AFTER_MONTHS is greyed rather than fired.
 * Showing a writer a dead rule as if it were live is how a tool stops being
 * opened.
 */

/** A theme unseen for this long is shown greyed, and never becomes a flag. */
export const STALE_AFTER_MONTHS = 12

/**
 * Below this many occurrences a theme is coincidence, not a rule.
 *
 * Three is low on purpose. The cost of a spurious flag here is one glance from
 * a reviewer; the cost of a missed one is a request for information with a hard
 * clock on it. The count travels with the flag, so a reader can discount a
 * three-hit rule themselves rather than having it hidden from them.
 */
export const MIN_HITS_FOR_RULE = 3

/** Occurrences at which recurrence stops being "worth a look" and becomes "likely". */
const LIKELY_HITS = 8

export function monthsBetween(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth())
  return to.getUTCDate() < from.getUTCDate() ? Math.max(0, months - 1) : Math.max(0, months)
}

/** Raw shape returned by the `mined_rules` SQL function. */
export interface MinedRuleRow {
  category: string
  section: string
  section_part: 'PART_I' | 'PART_II'
  member_state: string | null
  hits: number
  distinct_trials: number
  resolved_hits: number
  first_seen: string
  last_seen: string
}

export function toMinedRule(row: MinedRuleRow, now: Date): MinedRule {
  const lastSeen = new Date(row.last_seen)
  const monthsSinceLastSeen = monthsBetween(lastSeen, now)
  return {
    category: row.category,
    label: CATEGORY_BY_ID.get(row.category)?.label ?? row.category,
    section: row.section,
    sectionPart: row.section_part,
    memberState: row.member_state,
    hits: Number(row.hits),
    distinctTrials: Number(row.distinct_trials),
    resolvedHits: Number(row.resolved_hits),
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    stale: monthsSinceLastSeen >= STALE_AFTER_MONTHS,
    monthsSinceLastSeen,
  }
}

/**
 * Rules that may fire: recurrent enough to mean something, and recent enough to
 * still be true.
 *
 * Stale rules are kept in the result and reported as SKIPPED rather than
 * dropped. A writer who cannot see what did not run has to guess at coverage,
 * and guessing is what the check exists to replace.
 */
export function isLive(rule: MinedRule): boolean {
  return rule.hits >= MIN_HITS_FOR_RULE && !rule.stale
}

/**
 * Severity from evidence, not from a fitted weight.
 *
 * A lint hit outranks recurrence because it is a fact about *this* dossier — the
 * text says the artefact is missing — whereas recurrence is a fact about other
 * people's dossiers. A placeholder is a blocker on its own: `XXX` in a filed
 * document is not a judgement call.
 */
export function severityForLint(finding: LintFinding): Severity {
  if (finding.kind === 'PLACEHOLDER') return 'BLOCKER'
  return finding.kind === 'ABSENCE' ? 'BLOCKER' : 'LIKELY'
}

export function severityForRule(rule: MinedRule): Severity {
  return rule.hits >= LIKELY_HITS ? 'LIKELY' : 'WATCH'
}

/**
 * What to chase and who to chase.
 *
 * `missingArtefact` and `owner` both come from the taxonomy, so this file states
 * no regulatory fact of its own. `suggestedWording` is lifted verbatim from an
 * accepted past response and carries the record it came from — nothing here
 * writes regulatory prose, because nobody pastes generated text into a CTIS
 * dossier and a suggestion that cannot be traced is worth less than no
 * suggestion at all.
 */
export function fixFor(category: string, precedents: RulePrecedent[]): Fix {
  const taxonomy = CATEGORY_BY_ID.get(category)
  const source = precedents.find((p) => p.sponsorResponseText.trim().length > 0) ?? null
  return {
    missingArtefact: taxonomy?.artefactKey ?? null,
    suggestedWording: source ? source.sponsorResponseText.trim() : null,
    suggestedWordingFrom: source,
    owner: taxonomy?.owner ?? null,
  }
}

/**
 * "Italy raised this on 34 applications between Feb 2025 and Jun 2026."
 *
 * The sentence a regulatory writer trusts, and the reason the mined rule beats a
 * number. Dates are rendered as month and year: the corpus knows the issue date
 * of the request, not the day the requirement came into force, and a precise-
 * looking day would imply otherwise.
 */
export function describeRule(rule: MinedRule): string {
  const monthYear = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  const who = rule.memberState ?? 'Member States'
  const trials =
    rule.distinctTrials > 1 ? ` across ${rule.distinctTrials} trials` : ' on a single trial'
  return (
    `${who} raised this ${rule.hits} time${rule.hits === 1 ? '' : 's'}${trials}, ` +
    `between ${monthYear(rule.firstSeen)} and ${monthYear(rule.lastSeen)}.`
  )
}

/** Why a rule was not run, in the writer's terms. Never blank — silence reads as a pass. */
export function skipReason(rule: MinedRule): string {
  if (rule.stale) {
    return `Last seen ${rule.monthsSinceLastSeen} months ago. Not applied — a requirement that has not recurred in ${STALE_AFTER_MONTHS} months may no longer exist.`
  }
  return `Only ${rule.hits} occurrence${rule.hits === 1 ? '' : 's'} in the corpus. Below the ${MIN_HITS_FOR_RULE} needed to call it a pattern.`
}
