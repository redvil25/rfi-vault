import type { LintFinding } from './lint'
import type { SectionPart, SubmissionType, TeamRole } from '@/lib/domain/taxonomy'

/**
 * The pre-submission check's contract.
 *
 * Deliberately not a score. The screen leads with counts of flags — "2 blockers,
 * 3 likely triggers" — because a 0-100 number implies a calibration this corpus
 * cannot support: it holds only requests that *were* raised, so there is no
 * negative class to fit against and no false-positive rate to quote (ADR-025).
 * Every number below is a count of things that happened, with the dates they
 * happened between.
 */

/** How hard a flag pushes. Ordering matters: the UI sorts on it. */
export type Severity = 'BLOCKER' | 'LIKELY' | 'WATCH'

export const SEVERITY_ORDER: Record<Severity, number> = {
  BLOCKER: 0,
  LIKELY: 1,
  WATCH: 2,
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  BLOCKER: 'Blocker',
  LIKELY: 'Likely trigger',
  WATCH: 'Worth a look',
}

/** Whether a rule ran, and if not, why not. Shown so coverage is visible, not guessed. */
export type RuleOutcome = 'FLAGGED' | 'CLEAR' | 'SKIPPED'

/** A recurring theme mined out of the corpus, with its evidence attached. */
export interface MinedRule {
  category: string
  /** Taxonomy label for the category, or the raw id if it is not in the taxonomy. */
  label: string
  section: string
  sectionPart: SectionPart
  /** Null for a Part I theme, which belongs to the whole application. */
  memberState: string | null
  hits: number
  distinctTrials: number
  /** Occurrences carrying an approved, accepted response — the ones with usable wording. */
  resolvedHits: number
  firstSeen: string
  lastSeen: string
  /** True when nothing has recurred for STALE_AFTER_MONTHS. Greyed, never fired. */
  stale: boolean
  /** Whole months since the theme was last seen. */
  monthsSinceLastSeen: number
}

/** One past request, verbatim, with the response that closed it. */
export interface RulePrecedent {
  considerationId: string
  considerationText: string
  sponsorResponseText: string
  memberState: string | null
  section: string
  issuedAt: string
  documentRef: string
  euTrialNumber: string
  protocolCode: string | null
}

/**
 * What to do about a flag, and who has to do it.
 *
 * The owner is the field writers actually act on. They rarely control the
 * missing document — they control who they chase for it. Read from the
 * taxonomy's `owner`, so it cannot disagree with the routing ingestion already
 * assigned to the same category (ADR-024).
 */
export interface Fix {
  /** The document the category is about, e.g. "POL payment receipt". Null when no single artefact answers it. */
  missingArtefact: string | null
  /** Verbatim wording from an accepted past response. Never generated. */
  suggestedWording: string | null
  /** Which past response the wording came from, so it can be checked. */
  suggestedWordingFrom: RulePrecedent | null
  owner: TeamRole | null
}

export interface Flag {
  id: string
  severity: Severity
  section: string
  title: string
  /** Plain sentence saying what was seen, in the writer's terms. */
  detail: string
  /** The lint hit behind this flag, if it came from the text rather than from the corpus. */
  lint: LintFinding | null
  /** The mined rule behind this flag, if it came from recurrence. */
  rule: MinedRule | null
  precedents: RulePrecedent[]
  fix: Fix
}

/** One rule's result, including the ones that did not run. */
export interface RuleReport {
  key: string
  label: string
  section: string
  outcome: RuleOutcome
  /** Why a SKIPPED rule did not run — never blank. */
  note: string
}

export interface PrecheckInput {
  submissionType: SubmissionType
  memberStates: string[]
  sections: { section: string; text: string }[]
}

/**
 * What the corpus behind this answer actually covers.
 *
 * Surfaced in the UI rather than buried in a doc. A regulatory user who
 * discovers a coverage gap themselves stops trusting the whole tool, and the
 * gaps here are real: the corpus is synthetic, and it stops at a fixed date.
 */
export interface Coverage {
  /** Considerations the caller's RLS let the mining see. */
  consideredRows: number
  corpusFrom: string | null
  corpusTo: string | null
  /** True when every row behind this result is seeded demonstration data. */
  syntheticOnly: boolean
  memberStatesCovered: string[]
  /** Member States asked for that have no precedent at all behind them. */
  memberStatesWithoutPrecedent: string[]
}

export interface PrecheckResult {
  flags: Flag[]
  rules: RuleReport[]
  coverage: Coverage
  counts: Record<Severity, number>
  ranAt: string
}
