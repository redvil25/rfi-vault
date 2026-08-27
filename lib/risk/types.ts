import type { SectionPart, SubmissionType } from '@/lib/domain/taxonomy'

/**
 * Feature 2 — proactive risk scoring.
 *
 * Scores a *draft* application section for the risk that it will attract a
 * request for information, before submission. Per section, never one number for
 * the whole application: "Protocol: low, IMPD Quality: high" tells a named
 * person what to fix this afternoon, where a single score tells them nothing.
 */

/** Tri-state on purpose — see `ArtefactState`. */
export type ArtefactValue = boolean | null | undefined

/**
 * What a checklist item can say about an artefact.
 *
 * The distinction between MISSING and UNKNOWN is the one that keeps this
 * honest. "The insurance certificate is absent" is a finding. "Nobody has told
 * us whether there is an insurance certificate" is not a finding, it is a gap in
 * coverage — and reporting the second as the first would manufacture risk out of
 * missing metadata.
 */
export type ArtefactState = 'PRESENT' | 'MISSING' | 'UNKNOWN'

export interface DraftSectionInput {
  section: string
  sectionPart: SectionPart
  /** Free text of the section, used by the content rules and the similarity signal. */
  content: string
  /** Deterministic checklist inputs, e.g. { fee_proof: true, qp_declaration: null }. */
  artefacts: Record<string, ArtefactValue | string[] | undefined>
  /** Member States this application is going to. Drives the national rules. */
  memberStates: string[]
  submissionType: SubmissionType
}

export type DriverType = 'RULE' | 'SIMILARITY' | 'BASE_RATE'

export interface RuleFinding {
  ruleId: string
  /** Category this rule guards, so a finding links to precedent and to an owner. */
  categoryId: string | null
  /** 0–1. Derived from the category's own frequency weight, not chosen by hand. */
  severity: number
  memberState: string | null
  message: string
  recommendedAction: string
}

export interface RiskDriver {
  type: DriverType
  id?: string
  /** Share of the final raw score attributable to this driver, 0–1. */
  contribution: number
  message: string
}

export interface PrecedentHit {
  considerationId: string
  similarity: number
  consideration: string
  approvedResponse: string | null
  memberState: string | null
  category: string
}

export type RiskBand = 'LOW' | 'MEDIUM' | 'HIGH'

export interface SectionAssessment {
  section: string
  sectionPart: SectionPart
  score: number
  band: RiskBand
  findings: RuleFinding[]
  /**
   * Applicable rules that could not be evaluated because the artefact was not
   * declared. Surfaced rather than silently skipped: a section can only be
   * "low risk" to the extent it was actually checked.
   */
  unchecked: { ruleId: string; message: string }[]
  /** Applicable rules evaluated / applicable rules total, 0–1. */
  coverage: number
  topDrivers: RiskDriver[]
  precedents: PrecedentHit[]
  recommendedAction: string
  explanation: string
  /** Which signals actually contributed. Absent signals are renormalised, not zeroed. */
  signalsUsed: DriverType[]
}
