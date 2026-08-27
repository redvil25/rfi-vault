import {
  CATEGORIES,
  MEMBER_STATE_BY_CODE,
  type Category,
} from '@/lib/domain/taxonomy'
import type { ArtefactState, DraftSectionInput, RuleFinding } from './types'

/**
 * The deterministic half of Feature 2, and the half that carries the most
 * weight (ADR-004).
 *
 * Every rule here is *derived from* `lib/domain/taxonomy.ts` rather than
 * restated alongside it. That is deliberate and it is the point: the taxonomy is
 * the team's domain contribution, reviewed with the mentor, and a second
 * hand-maintained copy of the same knowledge would drift from it within a week.
 * Adding a category with an `artefactKey` adds a rule automatically.
 *
 * Nothing in this file asserts a regulatory fact that is not already in the
 * taxonomy. The national rules read `MEMBER_STATES[].languages` and quote the
 * team's own `quirks` strings verbatim; they do not introduce article numbers,
 * deadlines or fee amounts (CLAUDE.md §8).
 */

/** Largest category weight in the taxonomy, used to normalise severity to 0–1. */
const MAX_CATEGORY_WEIGHT = Math.max(...CATEGORIES.map((c) => c.weight))

export interface Rule {
  id: string
  categoryId: string | null
  /**
   * The artefact this rule reads, when it reads one. The assessment form uses it
   * to render exactly the controls a section needs, so the checklist a reviewer
   * fills in and the checklist the engine evaluates cannot drift apart.
   */
  artefactKey: string | null
  /** 0–1, normalised from the category's relative frequency in the taxonomy. */
  severity: number
  /** Which sections this rule applies to. Empty means every section. */
  sections: string[]
  /** Restrict to one Member State, or null for all. */
  memberState: string | null
  message: string
  recommendedAction: string
  /** PRESENT passes, MISSING is a finding, UNKNOWN counts against coverage. */
  evaluate: (input: DraftSectionInput, memberState: string | null) => ArtefactState
}

/**
 * Reads a tri-state artefact flag.
 *
 * `true` passes. `false` is a finding. Absent, null or a non-boolean is UNKNOWN —
 * never a finding. An application that simply did not declare its artefacts must
 * not be reported as high risk; it must be reported as unchecked.
 */
export function readArtefact(value: unknown): ArtefactState {
  if (value === true) return 'PRESENT'
  if (value === false) return 'MISSING'
  return 'UNKNOWN'
}

/** A list-valued artefact, e.g. the local-language versions actually attached. */
function readList(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  return null
}

function severityOf(category: Category): number {
  return Number((category.weight / MAX_CATEGORY_WEIGHT).toFixed(4))
}

// ---------------------------------------------------------------------------
// Artefact rules, generated from the taxonomy
// ---------------------------------------------------------------------------

/**
 * One rule per category that names a deterministic artefact. Twenty-one of the
 * twenty-nine categories do; the rest are judgement calls — protocol design,
 * IMPD adequacy — which a checklist cannot settle and which the similarity
 * signal covers instead.
 */
function artefactRules(): Rule[] {
  return CATEGORIES.filter((c) => c.artefactKey !== null).map((category) => ({
    id: `ARTEFACT_${category.id}`,
    categoryId: category.id,
    artefactKey: category.artefactKey,
    severity: severityOf(category),
    sections: category.sections,
    memberState: null,
    message: `${category.label}.`,
    recommendedAction: `Confirm the ${humanise(category.artefactKey!)} for this section before submission.`,
    evaluate: (input) => readArtefact(input.artefacts[category.artefactKey!]),
  }))
}

function humanise(artefactKey: string): string {
  return artefactKey.replaceAll('_', ' ')
}

// ---------------------------------------------------------------------------
// National rules, generated from MEMBER_STATES
// ---------------------------------------------------------------------------

/**
 * Sections whose material is read by trial subjects, and therefore expected in
 * the national language. Taken from the sections the taxonomy already attaches
 * to DOC_TRANSLATION_MISSING and ICF_LOCAL_LANGUAGE — not a separate judgement.
 */
const SUBJECT_FACING_SECTIONS = Array.from(
  new Set(
    CATEGORIES.filter((c) => c.id === 'DOC_TRANSLATION_MISSING' || c.id === 'ICF_LOCAL_LANGUAGE')
      .flatMap((c) => c.sections),
  ),
)

const TRANSLATION_CATEGORY = CATEGORIES.find((c) => c.id === 'DOC_TRANSLATION_MISSING')!

/**
 * One rule per Member State: subject-facing material must exist in that state's
 * language. The languages come from the taxonomy, so adding a Member State adds
 * its rule.
 */
function localLanguageRules(): Rule[] {
  return [...MEMBER_STATE_BY_CODE.values()].map((ms) => ({
    id: `LOCAL_LANGUAGE_${ms.code}`,
    categoryId: TRANSLATION_CATEGORY.id,
    artefactKey: 'local_language_versions',
    severity: severityOf(TRANSLATION_CATEGORY),
    sections: SUBJECT_FACING_SECTIONS,
    memberState: ms.code,
    message:
      `Subject-facing material for ${ms.name} is expected in ${ms.languages.join(' and ')}.`,
    recommendedAction:
      `Attach the ${ms.languages.join('/')} version of this section's subject-facing documents for ${ms.name}.`,
    evaluate: (input: DraftSectionInput) => {
      const versions = readList(input.artefacts.local_language_versions)
      if (versions === null) return readArtefact(input.artefacts.local_language_versions)
      return ms.languages.every((lang) => versions.includes(lang)) ? 'PRESENT' : 'MISSING'
    },
  }))
}

/**
 * National quirks the team recorded, surfaced as advisory checks.
 *
 * These carry the taxonomy's own wording verbatim. They are deliberately keyed
 * to an artefact the draft can declare, so a quirk with no checkable artefact
 * produces no rule rather than an unfalsifiable warning.
 */
const QUIRK_ARTEFACTS: Record<string, { artefact: string; categoryId: string }> = {
  IT: { artefact: 'fee_proof_current_tariff', categoryId: 'FEE_NATIONAL_UPDATE' },
  ES: { artefact: 'icf_local_lang', categoryId: 'ICF_LOCAL_LANGUAGE' },
  PL: { artefact: 'insurance_certificate', categoryId: 'INSURANCE_COVER' },
  FR: { artefact: 'icf_local_lang', categoryId: 'ICF_LOCAL_LANGUAGE' },
}

function quirkRules(): Rule[] {
  const rules: Rule[] = []
  for (const [code, { artefact, categoryId }] of Object.entries(QUIRK_ARTEFACTS)) {
    const ms = MEMBER_STATE_BY_CODE.get(code)
    const category = CATEGORIES.find((c) => c.id === categoryId)
    if (!ms || !category || ms.quirks.length === 0) continue

    rules.push({
      id: `QUIRK_${code}_${categoryId}`,
      categoryId,
      artefactKey: artefact,
      severity: severityOf(category),
      sections: category.sections,
      memberState: code,
      // The team's own wording, quoted rather than paraphrased.
      message: `${ms.name}: ${ms.quirks[0]}`,
      recommendedAction: `Check this against ${ms.name}'s national requirement before submission.`,
      evaluate: (input) => readArtefact(input.artefacts[artefact]),
    })
  }
  return rules
}

// ---------------------------------------------------------------------------
// Content rules — the few that read the text rather than a flag
// ---------------------------------------------------------------------------

const VERSION_CATEGORY = CATEGORIES.find((c) => c.id === 'DOC_VERSION_MISMATCH')!

/** `version 3.0`, `v2.1`, `Version 10` — the forms that appear in CTIS exports. */
const VERSION_RE = /\bv(?:ersion)?\s*\.?\s*(\d+(?:\.\d+)?)\b/gi

/**
 * Every version number mentioned in a section, deduplicated.
 *
 * Exported because the disagreement check is the one rule whose behaviour is not
 * obvious from its name, and it is worth testing directly.
 */
export function versionsMentioned(content: string): string[] {
  const found = new Set<string>()
  for (const match of content.matchAll(VERSION_RE)) found.add(match[1])
  return [...found]
}

function contentRules(): Rule[] {
  return [
    {
      id: 'CONTENT_VERSION_CONSISTENCY',
      categoryId: VERSION_CATEGORY.id,
      // Reads the section text, not a declared flag.
      artefactKey: null,
      severity: severityOf(VERSION_CATEGORY),
      sections: VERSION_CATEGORY.sections,
      memberState: null,
      message:
        'This section cites more than one document version. A cover letter referring to a ' +
        'version other than the one uploaded is a common validation finding.',
      recommendedAction:
        'Reconcile the version numbers cited here against the versions actually uploaded.',
      evaluate: (input) => {
        const versions = versionsMentioned(input.content)
        // No version cited at all is not a contradiction; it is nothing to check.
        if (versions.length === 0) return 'UNKNOWN'
        return versions.length === 1 ? 'PRESENT' : 'MISSING'
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Assembly and evaluation
// ---------------------------------------------------------------------------

export const RULES: Rule[] = [
  ...artefactRules(),
  ...localLanguageRules(),
  ...quirkRules(),
  ...contentRules(),
]

/** Rules that apply to a given section and set of Member States. */
export function applicableRules(input: DraftSectionInput): { rule: Rule; memberState: string | null }[] {
  const out: { rule: Rule; memberState: string | null }[] = []

  for (const rule of RULES) {
    const sectionMatches = rule.sections.length === 0 || rule.sections.includes(input.section)
    if (!sectionMatches) continue

    if (rule.memberState === null) {
      out.push({ rule, memberState: null })
      continue
    }
    // A national rule applies only if the application actually goes there.
    if (input.memberStates.includes(rule.memberState)) {
      out.push({ rule, memberState: rule.memberState })
    }
  }

  return out
}

export interface RuleEvaluation {
  findings: RuleFinding[]
  unchecked: { ruleId: string; message: string }[]
  applicable: number
  evaluated: number
}

export function evaluateRules(input: DraftSectionInput): RuleEvaluation {
  const findings: RuleFinding[] = []
  const unchecked: { ruleId: string; message: string }[] = []
  const applicable = applicableRules(input)

  for (const { rule, memberState } of applicable) {
    const state = rule.evaluate(input, memberState)

    if (state === 'MISSING') {
      findings.push({
        ruleId: rule.id,
        categoryId: rule.categoryId,
        severity: rule.severity,
        memberState,
        message: rule.message,
        recommendedAction: rule.recommendedAction,
      })
    } else if (state === 'UNKNOWN') {
      unchecked.push({ ruleId: rule.id, message: rule.message })
    }
  }

  // Most severe first: the reviewer reads top-down and stops when out of time.
  findings.sort((a, b) => b.severity - a.severity || a.ruleId.localeCompare(b.ruleId))

  return {
    findings,
    unchecked,
    applicable: applicable.length,
    evaluated: applicable.length - unchecked.length,
  }
}

export interface ArtefactPrompt {
  key: string
  label: string
  /** Rendered as a multi-select of language codes rather than a yes/no. */
  kind: 'boolean' | 'languages'
  /** Member States that make this artefact relevant, for the hint text. */
  memberStates: string[]
}

/**
 * The checklist a reviewer should fill in for one section.
 *
 * Derived from the same `applicableRules` the engine uses, so the form can never
 * ask for an artefact the engine ignores, or omit one it will mark unchecked.
 */
export function artefactPromptsFor(input: DraftSectionInput): ArtefactPrompt[] {
  const byKey = new Map<string, ArtefactPrompt>()

  for (const { rule, memberState } of applicableRules(input)) {
    if (!rule.artefactKey) continue

    const existing = byKey.get(rule.artefactKey)
    if (existing) {
      if (memberState && !existing.memberStates.includes(memberState)) {
        existing.memberStates.push(memberState)
      }
      continue
    }

    byKey.set(rule.artefactKey, {
      key: rule.artefactKey,
      label: humanise(rule.artefactKey),
      kind: rule.artefactKey === 'local_language_versions' ? 'languages' : 'boolean',
      memberStates: memberState ? [memberState] : [],
    })
  }

  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label))
}
