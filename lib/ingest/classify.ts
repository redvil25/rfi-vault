/**
 * Rule-based category classifier for RFI considerations.
 *
 * Deterministic and inspectable on purpose. A regulatory reviewer can read
 * these rules and argue with them, which is not true of a prompt. It also means
 * classification works with no API key and never varies between runs.
 *
 * Where it is genuinely unsure it returns UNCLASSIFIED rather than guessing —
 * the review screen then asks a human. That is the correct failure mode here:
 * a wrong category silently poisons every share the analytics dashboard reports.
 */

import { CATEGORY_BY_ID } from '@/lib/domain/taxonomy'

export interface ClassifyInput {
  text: string
  section: string | null
  part: 'PART_I' | 'PART_II' | null
  memberState: string | null
}

export interface ClassifyResult {
  category: string
  /** 0–1, derived from the winning score and its margin over the runner-up. */
  confidence: number
  /** Which patterns fired, for the review screen and for debugging. */
  evidence: string[]
}

interface Rule {
  category: string
  /** Any match contributes. Weight is per rule, not per pattern. */
  patterns: RegExp[]
  weight: number
  /** Optional narrowing — a rule only applies within these sections. */
  sections?: string[]
}

const RULES: Rule[] = [
  // ---- Fees -------------------------------------------------------------
  {
    category: 'FEE_NATIONAL_UPDATE',
    weight: 5,
    patterns: [
      /\bISTAT\b/i,
      /updated?\s+(fee|tariff)/i,
      /additional\s+amount\s+required/i,
      /(fee|tariff)\s+(was\s+)?(revised|updated|increased)/i,
      /adeguamento\s+delle\s+tariffe/i,
      /previous\s+tariff/i,
    ],
  },
  {
    category: 'FEE_REFERENCE_MISMATCH',
    weight: 4,
    patterns: [
      /(reference|POL\s*\d*)\b[^.]{0,60}\b(does not (correspond|match)|cannot be reconciled)/i,
      /payment reference[^.]{0,40}(mismatch|incorrect|not correspond)/i,
    ],
  },
  {
    category: 'FEE_PAYMENT_PROOF',
    weight: 3,
    patterns: [
      /proof of payment/i,
      /payment (receipt|confirmation)/i,
      /bank transfer receipt/i,
      /\bfee\b[^.]{0,40}\b(not|missing|has not been paid)/i,
    ],
  },

  // ---- Documents --------------------------------------------------------
  {
    category: 'DOC_TRANSLATION_MISSING',
    weight: 5,
    patterns: [
      /\b(translation|translated)\b/i,
      /(local|national)\s+language/i,
      /\b(in|into)\s+(Italian|Spanish|German|French|Polish|Dutch|Danish|Swedish|Finnish|Czech|Hungarian|Portuguese)\b/i,
      /provided in English only/i,
    ],
  },
  {
    category: 'DOC_VERSION_MISMATCH',
    weight: 4,
    patterns: [
      /version[^.]{0,60}(does not match|differs|inconsistenc|earlier version)/i,
      /(refers? to|referenced)[^.]{0,40}version[^.]{0,40}(while|but)/i,
    ],
  },
  {
    category: 'DOC_SIGNATURE_DATE',
    weight: 4,
    patterns: [
      /\b(is )?not signed\b/i,
      /\b(unsigned|undated)\b/i,
      /signature date[^.]{0,30}missing/i,
      /signed and dated/i,
    ],
  },
  {
    category: 'DOC_NAMING_CONVENTION',
    weight: 4,
    patterns: [/naming convention/i, /file name[^.]{0,40}(does not|must)/i],
  },
  {
    category: 'DOC_LEGIBILITY',
    weight: 4,
    patterns: [/\b(not )?legible\b/i, /cannot be opened/i, /illegible/i, /rescan/i],
  },
  {
    category: 'DOC_MISSING',
    weight: 2,
    patterns: [
      /has not been (submitted|provided|uploaded)/i,
      /(is|was) not (present|found|included|located)/i,
      /\bmissing\b/i,
      /please upload/i,
    ],
  },

  // ---- Part II ----------------------------------------------------------
  {
    category: 'ICF_LOCAL_LANGUAGE',
    weight: 6,
    sections: ['Informed Consent'],
    patterns: [
      /informed consent[^.]{0,80}(translation|local language|in (Italian|Spanish|German|French|Polish|Dutch|Danish|Swedish|Finnish|Czech|Hungarian|Portuguese))/i,
      /informed consent[^.]{0,60}English only/i,
    ],
  },
  {
    category: 'ICF_CONTENT',
    weight: 3,
    sections: ['Informed Consent'],
    patterns: [
      /informed consent/i,
      /information sheet/i,
      /right to withdraw/i,
    ],
  },
  {
    category: 'INSURANCE_COVER',
    weight: 5,
    patterns: [/\binsurance\b/i, /indemnification/i, /\bcover(age)?\b[^.]{0,40}\bterritor/i],
  },
  {
    category: 'INVESTIGATOR_SUITABILITY',
    weight: 5,
    patterns: [
      /curriculum vitae|\bCV\b/i,
      /GCP training/i,
      /suitability of the investigator/i,
    ],
  },
  {
    category: 'SITE_SUITABILITY',
    weight: 4,
    patterns: [/(site|facilit)[^.]{0,40}(suitability|declaration)/i],
  },
  {
    category: 'DATA_PROTECTION',
    weight: 5,
    patterns: [/\bGDPR\b/i, /personal data/i, /data (flow|protection)/i],
  },
  {
    category: 'FINANCIAL_ARRANGEMENTS',
    weight: 4,
    patterns: [
      /compensation of (trial )?subjects/i,
      /payments? to (the )?investigator/i,
      /financial (agreement|arrangement)/i,
    ],
  },
  {
    category: 'RECRUITMENT_MATERIAL',
    weight: 5,
    patterns: [/recruitment material/i, /advertisement/i, /subject-facing/i],
  },
  {
    category: 'BIOLOGICAL_SAMPLES',
    weight: 5,
    patterns: [/biological samples?/i, /biobank/i, /future use of[^.]{0,30}samples?/i],
  },

  // ---- Part I scientific -------------------------------------------------
  {
    category: 'GMP_QP_DECLARATION',
    weight: 6,
    patterns: [/\bQP declaration\b/i, /\bGMP\b/i, /qualified person/i],
  },
  {
    category: 'IMPD_QUALITY',
    weight: 5,
    sections: ['IMPD Quality'],
    patterns: [
      /stability data/i,
      /specification limits?/i,
      /shelf life/i,
      /drug (substance|product)/i,
      /manufacturing process/i,
    ],
  },
  {
    category: 'IMPD_SAFETY_EFFICACY',
    weight: 5,
    sections: ['IMPD Safety and Efficacy'],
    patterns: [/non-clinical/i, /toxicity/i, /starting dose/i],
  },
  {
    category: 'IB_VERSION',
    weight: 5,
    patterns: [/investigator'?s brochure/i, /reference safety information/i],
  },
  {
    category: 'LABELLING',
    weight: 5,
    patterns: [/label(ling)?\b/i, /label mock-?up/i],
  },
  {
    category: 'AUXILIARY_MEDICINAL_PRODUCT',
    weight: 6,
    patterns: [/auxiliary medicinal product/i],
  },
  {
    category: 'PROTOCOL_INCONSISTENCY',
    weight: 4,
    sections: ['Protocol'],
    patterns: [
      /(does not match|differs from|not consistent with|inconsistenc)/i,
      /synopsis[^.]{0,60}(statistical|section)/i,
    ],
  },
  {
    category: 'PROTOCOL_DESIGN',
    weight: 3,
    sections: ['Protocol'],
    patterns: [
      /please justify/i,
      /stopping rules/i,
      /\bcomparator\b/i,
      /follow-up period/i,
      /trial design/i,
    ],
  },

  // ---- Form and scope ----------------------------------------------------
  {
    category: 'SM_JUSTIFICATION',
    weight: 5,
    patterns: [
      /substantial modification[^.]{0,60}(rationale|justification|impact)/i,
      /rationale for this substantial modification/i,
    ],
  },
  {
    category: 'APPLICATION_FORM_DATA',
    weight: 4,
    sections: ['EU Application Form'],
    patterns: [/application form/i],
  },
  {
    category: 'SCOPE_CLARIFICATION',
    weight: 5,
    patterns: [
      /scope of Regulation/i,
      /low-intervention clinical trial/i,
      /fall within the scope/i,
    ],
  },
]

export function classifyConsideration(input: ClassifyInput): ClassifyResult {
  const { text, section } = input
  if (!text.trim()) return { category: 'UNCLASSIFIED', confidence: 0, evidence: [] }

  const scores = new Map<string, number>()
  const evidence = new Map<string, string[]>()

  for (const rule of RULES) {
    // A section-scoped rule outside its section is ignored entirely rather than
    // merely down-weighted; that is what keeps ICF rules off IMPD text.
    //
    // An UNKNOWN section is not the same as a wrong one. Scanned documents and
    // unusual headings ("Part II - Quality") often fail to map to the taxonomy,
    // and skipping every scoped rule there would return UNCLASSIFIED for text
    // that is plainly classifiable from its wording. Unknown section means all
    // rules compete on evidence alone.
    if (rule.sections && section !== null && !rule.sections.includes(section)) continue

    const hits = rule.patterns.filter((p) => p.test(text))
    if (hits.length === 0) continue

    // Diminishing returns: a second matching pattern in the same rule is
    // corroboration, not double the evidence.
    const score = rule.weight * (1 + (hits.length - 1) * 0.25)
    scores.set(rule.category, (scores.get(rule.category) ?? 0) + score)
    evidence.set(rule.category, [
      ...(evidence.get(rule.category) ?? []),
      ...hits.map((h) => h.source),
    ])
  }

  // A section that maps 1:1 onto a category is a real signal in its own right.
  if (section) {
    for (const [id, cat] of CATEGORY_BY_ID) {
      if (cat.sections.length === 1 && cat.sections[0] === section) {
        scores.set(id, (scores.get(id) ?? 0) + 1.5)
      }
    }
  }

  if (scores.size === 0) return { category: 'UNCLASSIFIED', confidence: 0, evidence: [] }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1])
  const [winner, topScore] = ranked[0]
  const runnerUp = ranked[1]?.[1] ?? 0

  // Confidence blends absolute evidence with the margin over the runner-up: a
  // strong match that barely beats another category is not a confident match.
  const strength = Math.min(1, topScore / 7)
  const margin = topScore > 0 ? (topScore - runnerUp) / topScore : 0
  const confidence = Number((strength * 0.6 + margin * 0.4).toFixed(2))

  if (confidence < 0.25) {
    return { category: 'UNCLASSIFIED', confidence, evidence: evidence.get(winner) ?? [] }
  }

  return { category: winner, confidence, evidence: evidence.get(winner) ?? [] }
}
