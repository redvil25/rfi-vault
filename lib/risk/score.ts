import type { DriverType, RiskBand, RuleFinding } from './types'

/**
 * Blending and banding. Pure functions, no database, no model — so the numbers
 * on the slide come from something that can be unit-tested.
 */

/**
 * Signal weights (ADR-004). The rule engine leads on purpose: a deterministic
 * finding is more trustworthy and more actionable than a similarity number, and
 * it works with zero historical data.
 */
export const SIGNAL_WEIGHTS: Record<DriverType, number> = {
  RULE: 0.5,
  SIMILARITY: 0.3,
  BASE_RATE: 0.2,
}

/**
 * Sigmoid shape. `a` sets the steepness, `b` the raw score that maps to 50.
 *
 * NOT FITTED. docs/05-EVALUATION.md §3 calls for fitting these on a training
 * split and reporting AUC on a held-out split, which needs labelled sections —
 * draft sections marked with whether they went on to attract a request for
 * information. The corpus contains only RFIs that happened, so the negative
 * class does not exist yet and there is nothing to fit against.
 *
 * Say "provisional" in the deck, never "calibrated". `fitSigmoid` below is the
 * hook for when labels exist.
 */
export const SIGMOID = { a: 6, b: 0.35, fitted: false } as const

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

/**
 * Aggregates rule findings into a 0–1 rule score using noisy-OR.
 *
 * Chosen over a weighted sum for two reasons. It cannot exceed 1, so it never
 * needs an arbitrary clamp that would flatten the top of the range. And it has
 * the right shape for the domain: a second missing artefact does raise risk, but
 * by less than the first did, because the section is already going to attract a
 * request either way.
 */
export function ruleScore(findings: RuleFinding[]): number {
  let survives = 1
  for (const finding of findings) {
    survives *= 1 - clamp01(finding.severity)
  }
  return round4(1 - survives)
}

export interface SignalInputs {
  /** 0–1 from evaluateRules + ruleScore. Always present. */
  rule: number
  /** 0–1, mean cosine of the nearest historical RFI-triggering sections. */
  similarity?: number
  /** 0–1 share of historical RFI volume for this slice. */
  baseRate?: number
}

export interface BlendResult {
  raw: number
  score: number
  band: RiskBand
  signalsUsed: DriverType[]
  contributions: Record<DriverType, number>
}

/**
 * Blends whatever signals are available.
 *
 * Missing signals are renormalised out, not treated as zero. With no embeddings
 * the similarity term is unavailable, and scoring it as 0 would drag every
 * section toward LOW and quietly turn a missing subsystem into false
 * reassurance — the worst failure mode this feature has.
 */
export function blend(inputs: SignalInputs): BlendResult {
  const present: [DriverType, number][] = [['RULE', clamp01(inputs.rule)]]
  if (inputs.similarity !== undefined) present.push(['SIMILARITY', clamp01(inputs.similarity)])
  if (inputs.baseRate !== undefined) present.push(['BASE_RATE', clamp01(inputs.baseRate)])

  const totalWeight = present.reduce((sum, [type]) => sum + SIGNAL_WEIGHTS[type], 0)

  let raw = 0
  const contributions = { RULE: 0, SIMILARITY: 0, BASE_RATE: 0 } as Record<DriverType, number>

  for (const [type, value] of present) {
    const share = (SIGNAL_WEIGHTS[type] / totalWeight) * value
    contributions[type] = round4(share)
    raw += share
  }

  raw = round4(raw)
  const score = Math.round(100 * sigmoid(SIGMOID.a * (raw - SIGMOID.b)))

  return {
    raw,
    score,
    band: bandFor(score),
    signalsUsed: present.map(([type]) => type),
    contributions,
  }
}

/**
 * Band thresholds. docs/05 §3 asks for these to come from the precision/recall
 * curve rather than being picked round; like the sigmoid, that needs labels.
 * These are the documented starting points and are marked provisional.
 */
export const BANDS = { medium: 33, high: 66 } as const

export function bandFor(score: number): RiskBand {
  if (score > BANDS.high) return 'HIGH'
  if (score >= BANDS.medium) return 'MEDIUM'
  return 'LOW'
}

export const BAND_GUIDANCE: Record<RiskBand, string> = {
  HIGH: 'Fix before submitting.',
  MEDIUM: 'Review the differences before submitting.',
  LOW: 'No deterministic finding; spot-check only.',
}

/**
 * Placeholder for the fitting step, kept so the call site exists and the gap is
 * visible in code rather than only in a document.
 *
 * Throws rather than returning the provisional constants: silently handing back
 * unfitted parameters from a function named `fitSigmoid` is exactly how an
 * uncalibrated number ends up on a slide labelled "calibrated".
 */
export function fitSigmoid(
  labelled: { raw: number; triggeredRfi: boolean }[],
): { a: number; b: number } {
  const positives = labelled.filter((row) => row.triggeredRfi).length
  throw new Error(
    'fitSigmoid is not implemented. It needs draft sections labelled with whether they ' +
      'went on to attract a request for information, and both classes must be present. ' +
      `Received ${labelled.length} example(s), ${positives} positive and ` +
      `${labelled.length - positives} negative. The corpus holds only requests that were ` +
      'raised, so the negative class does not exist yet. See docs/05-EVALUATION.md §3.',
  )
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}
