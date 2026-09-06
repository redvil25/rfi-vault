/**
 * EU CTR RFI taxonomy — the domain backbone of the whole system.
 *
 * Everything downstream reads from here: the synthetic corpus generator, the
 * ingestion classifier, the analytics groupings, and the search facets. There is no official
 * category taxonomy for validation RFIs, so this is our contribution — see
 * docs/01-DOMAIN.md §5 for the reasoning and present it as a slide.
 *
 * Validate this with the Novo Nordisk mentor in session 2 and record their feedback
 * in MEMORY.md §3.
 */

export type SectionPart = 'PART_I' | 'PART_II'
export type RfiPhase = 'VALIDATION' | 'ASSESSMENT_PART_I' | 'ASSESSMENT_PART_II'
export type SubmissionType = 'INITIAL' | 'SUBSTANTIAL_MODIFICATION' | 'ADDITIONAL_MS'
export type TeamRole =
  | 'RA_CLINICAL'
  | 'AFFILIATE'
  | 'CTA_MANAGEMENT'
  | 'EU_SUBMISSION_HUB'
  | 'ADMIN'

/** Tier drives preventability: Tier 1 and 2 are administrative and largely avoidable. */
export type Tier = 1 | 2 | 3 | 4 | 5

export interface Category {
  id: string
  tier: Tier
  label: string
  /** Which application section this normally attaches to. */
  sections: string[]
  part: SectionPart
  /** Team that normally owns the response. Drives owner_team and RBAC demos. */
  owner: TeamRole
  /** Relative frequency weight. Deliberately Pareto — see docs/03-DATA-MODEL.md §2.1. */
  weight: number
  /** Would a completeness check before submission have avoided this class of RFI? Drives the analytics preventability split. */
  preventable: boolean
  /** The artefact this category is about. Null = no single document answers it. */
  artefactKey: string | null
}

// ---------------------------------------------------------------------------
// Application sections
// ---------------------------------------------------------------------------

export const PART_I_SECTIONS = [
  'Regulatory',
  'Cover Letter',
  'EU Application Form',
  'Protocol',
  'Investigator Brochure',
  'IMPD Quality',
  'IMPD Safety and Efficacy',
  'GMP and QP Declaration',
  'Auxiliary Medicinal Product',
  'IMP Labelling',
  'Scientific Advice and PIP',
] as const

export const PART_II_SECTIONS = [
  'Informed Consent',
  'Subject Recruitment Arrangements',
  'Investigator Suitability',
  'Site Suitability',
  'Insurance and Indemnification',
  'Financial Arrangements',
  'Data Protection',
  'Biological Samples',
] as const

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const CATEGORIES: Category[] = [
  // ---- Tier 1: administrative / fees. Highest volume, highest preventability. ----
  {
    id: 'FEE_PAYMENT_PROOF',
    tier: 1,
    label: 'Proof of national fee payment missing',
    sections: ['Regulatory', 'Cover Letter'],
    part: 'PART_I',
    owner: 'AFFILIATE',
    weight: 12,
    preventable: true,
    artefactKey: 'fee_proof',
  },
  {
    id: 'FEE_NATIONAL_UPDATE',
    tier: 1,
    label: 'National fee amount updated; old amount paid',
    sections: ['Regulatory'],
    part: 'PART_I',
    owner: 'AFFILIATE',
    weight: 7,
    preventable: true,
    artefactKey: 'fee_proof_current_tariff',
  },
  {
    id: 'FEE_REFERENCE_MISMATCH',
    tier: 1,
    label: 'Payment reference does not match the submission',
    sections: ['Regulatory'],
    part: 'PART_I',
    owner: 'AFFILIATE',
    weight: 4,
    preventable: true,
    artefactKey: 'fee_reference',
  },

  // ---- Tier 2: document management. Mechanical, therefore highly predictable. ----
  {
    id: 'DOC_MISSING',
    tier: 2,
    label: 'Required document absent from the dossier',
    sections: [...PART_I_SECTIONS, ...PART_II_SECTIONS],
    part: 'PART_I',
    owner: 'EU_SUBMISSION_HUB',
    weight: 10,
    preventable: true,
    artefactKey: 'document_present',
  },
  {
    id: 'DOC_VERSION_MISMATCH',
    tier: 2,
    label: 'Document version referenced does not match the version uploaded',
    sections: ['Protocol', 'Investigator Brochure', 'Informed Consent', 'Cover Letter'],
    part: 'PART_I',
    owner: 'CTA_MANAGEMENT',
    weight: 9,
    preventable: true,
    artefactKey: 'version_consistency',
  },
  {
    id: 'DOC_TRANSLATION_MISSING',
    tier: 2,
    label: 'Local-language version required and not provided',
    sections: ['Informed Consent', 'Subject Recruitment Arrangements', 'IMP Labelling'],
    part: 'PART_II',
    owner: 'AFFILIATE',
    weight: 8,
    preventable: true,
    artefactKey: 'local_language_versions',
  },
  {
    id: 'DOC_NAMING_CONVENTION',
    tier: 2,
    label: 'File naming does not follow the CTIS or national convention',
    sections: [...PART_I_SECTIONS],
    part: 'PART_I',
    owner: 'EU_SUBMISSION_HUB',
    weight: 5,
    preventable: true,
    artefactKey: 'naming_convention',
  },
  {
    id: 'DOC_SIGNATURE_DATE',
    tier: 2,
    label: 'Document unsigned, undated, or signed by the wrong role',
    sections: ['Investigator Suitability', 'GMP and QP Declaration', 'Cover Letter'],
    part: 'PART_II',
    owner: 'CTA_MANAGEMENT',
    weight: 5,
    preventable: true,
    artefactKey: 'signature_present',
  },
  {
    id: 'DOC_LEGIBILITY',
    tier: 2,
    label: 'Scanned document illegible or in an unacceptable format',
    sections: [...PART_I_SECTIONS, ...PART_II_SECTIONS],
    part: 'PART_I',
    owner: 'EU_SUBMISSION_HUB',
    weight: 2,
    preventable: true,
    artefactKey: 'legibility',
  },

  // ---- Tier 3: Part II national and ethical. ----
  {
    id: 'ICF_CONTENT',
    tier: 3,
    label: 'Informed consent wording incomplete or non-compliant',
    sections: ['Informed Consent'],
    part: 'PART_II',
    owner: 'AFFILIATE',
    weight: 8,
    preventable: false,
    artefactKey: 'icf_present',
  },
  {
    id: 'ICF_LOCAL_LANGUAGE',
    tier: 3,
    label: 'Informed consent not provided in the required local language(s)',
    sections: ['Informed Consent'],
    part: 'PART_II',
    owner: 'AFFILIATE',
    weight: 6,
    preventable: true,
    artefactKey: 'icf_local_lang',
  },
  {
    id: 'INSURANCE_COVER',
    tier: 3,
    label: 'Insurance certificate missing, expired, or not covering the territory',
    sections: ['Insurance and Indemnification'],
    part: 'PART_II',
    owner: 'CTA_MANAGEMENT',
    weight: 6,
    preventable: true,
    artefactKey: 'insurance_certificate',
  },
  {
    id: 'INVESTIGATOR_SUITABILITY',
    tier: 3,
    label: 'Investigator CV missing, outdated, unsigned, or GCP evidence absent',
    sections: ['Investigator Suitability'],
    part: 'PART_II',
    owner: 'AFFILIATE',
    weight: 6,
    preventable: true,
    artefactKey: 'investigator_cv',
  },
  {
    id: 'SITE_SUITABILITY',
    tier: 3,
    label: 'Site facility declaration missing or incomplete',
    sections: ['Site Suitability'],
    part: 'PART_II',
    owner: 'AFFILIATE',
    weight: 3,
    preventable: true,
    artefactKey: 'site_declaration',
  },
  {
    id: 'DATA_PROTECTION',
    tier: 3,
    label: 'GDPR compliance or data-flow description inadequate',
    sections: ['Data Protection'],
    part: 'PART_II',
    owner: 'RA_CLINICAL',
    weight: 3,
    preventable: false,
    artefactKey: 'data_protection_annex',
  },
  {
    id: 'FINANCIAL_ARRANGEMENTS',
    tier: 3,
    label: 'Subject compensation or investigator payment detail missing',
    sections: ['Financial Arrangements'],
    part: 'PART_II',
    owner: 'CTA_MANAGEMENT',
    weight: 3,
    preventable: true,
    artefactKey: 'financial_annex',
  },
  {
    id: 'RECRUITMENT_MATERIAL',
    tier: 3,
    label: 'Recruitment material not submitted or not approved',
    sections: ['Subject Recruitment Arrangements'],
    part: 'PART_II',
    owner: 'AFFILIATE',
    weight: 3,
    preventable: true,
    artefactKey: 'recruitment_material',
  },
  {
    id: 'BIOLOGICAL_SAMPLES',
    tier: 3,
    label: 'Biological sample collection, storage, or future-use rules unclear',
    sections: ['Biological Samples'],
    part: 'PART_II',
    owner: 'RA_CLINICAL',
    weight: 2,
    preventable: false,
    artefactKey: null,
  },

  // ---- Tier 4: Part I scientific. Lower volume, higher effort per item. ----
  {
    id: 'PROTOCOL_INCONSISTENCY',
    tier: 4,
    label: 'Internal contradiction between protocol sections',
    sections: ['Protocol'],
    part: 'PART_I',
    owner: 'RA_CLINICAL',
    weight: 5,
    preventable: false,
    artefactKey: null,
  },
  {
    id: 'PROTOCOL_DESIGN',
    tier: 4,
    label: 'Question on trial design, endpoints, or safety monitoring',
    sections: ['Protocol'],
    part: 'PART_I',
    owner: 'RA_CLINICAL',
    weight: 4,
    preventable: false,
    artefactKey: null,
  },
  {
    id: 'IMPD_QUALITY',
    tier: 4,
    label: 'CMC gap: stability data, specifications, or justification',
    sections: ['IMPD Quality'],
    part: 'PART_I',
    owner: 'RA_CLINICAL',
    weight: 5,
    preventable: false,
    artefactKey: null,
  },
  {
    id: 'IMPD_SAFETY_EFFICACY',
    tier: 4,
    label: 'Non-clinical or clinical data gap',
    sections: ['IMPD Safety and Efficacy'],
    part: 'PART_I',
    owner: 'RA_CLINICAL',
    weight: 3,
    preventable: false,
    artefactKey: null,
  },
  {
    id: 'GMP_QP_DECLARATION',
    tier: 4,
    label: 'QP declaration missing or not covering the manufacturing site',
    sections: ['GMP and QP Declaration'],
    part: 'PART_I',
    owner: 'RA_CLINICAL',
    weight: 4,
    preventable: true,
    artefactKey: 'qp_declaration',
  },
  {
    id: 'IB_VERSION',
    tier: 4,
    label: "Investigator's Brochure outdated relative to the protocol",
    sections: ['Investigator Brochure'],
    part: 'PART_I',
    owner: 'RA_CLINICAL',
    weight: 3,
    preventable: true,
    artefactKey: 'ib_version_current',
  },
  {
    id: 'LABELLING',
    tier: 4,
    label: 'IMP labelling annex non-compliant with national rules',
    sections: ['IMP Labelling'],
    part: 'PART_I',
    owner: 'AFFILIATE',
    weight: 3,
    preventable: true,
    artefactKey: 'labelling_annex',
  },
  {
    id: 'AUXILIARY_MEDICINAL_PRODUCT',
    tier: 4,
    label: 'Auxiliary medicinal product documentation gap',
    sections: ['Auxiliary Medicinal Product'],
    part: 'PART_I',
    owner: 'RA_CLINICAL',
    weight: 2,
    preventable: false,
    artefactKey: null,
  },

  // ---- Tier 5: application form and scope. ----
  {
    id: 'APPLICATION_FORM_DATA',
    tier: 5,
    label: 'Application form inconsistent with the dossier',
    sections: ['EU Application Form'],
    part: 'PART_I',
    owner: 'EU_SUBMISSION_HUB',
    weight: 5,
    preventable: true,
    artefactKey: 'form_consistency',
  },
  {
    id: 'SCOPE_CLARIFICATION',
    tier: 5,
    label: 'Clarification on whether the trial falls within scope of the Regulation',
    sections: ['EU Application Form', 'Protocol'],
    part: 'PART_I',
    owner: 'RA_CLINICAL',
    weight: 2,
    preventable: false,
    artefactKey: null,
  },
  {
    id: 'SM_JUSTIFICATION',
    tier: 5,
    label: 'Substantial modification rationale insufficient',
    sections: ['Cover Letter', 'Protocol'],
    part: 'PART_I',
    owner: 'CTA_MANAGEMENT',
    weight: 4,
    preventable: false,
    artefactKey: null,
  },
]

// ---------------------------------------------------------------------------
// Member States
// ---------------------------------------------------------------------------

export interface MemberState {
  code: string
  name: string
  /** Relative share of RFIs. Over-representation reflects heavier national requirements. */
  weight: number
  languages: string[]
  /** Recurring national traps. These become rule-engine checks and demo beats. */
  quirks: string[]
}

export const MEMBER_STATES: MemberState[] = [
  {
    code: 'IT',
    name: 'Italy',
    weight: 14,
    languages: ['it'],
    quirks: [
      'National fee revised annually by the ISTAT index; sponsors frequently pay the previous amount.',
      'Payment reference (POL number) must match the submission exactly.',
      'AIFA decree reference expected in the cover documentation.',
    ],
  },
  {
    code: 'ES',
    name: 'Spain',
    weight: 12,
    languages: ['es'],
    quirks: [
      'AEMPS and CEIm both in scope; local-language ICF mandatory.',
      'Site contract and insurance formalities checked closely.',
    ],
  },
  {
    code: 'DE',
    name: 'Germany',
    weight: 12,
    languages: ['de'],
    quirks: [
      'BfArM or PEI plus the responsible ethics committee.',
      'Radiation-protection documentation where applicable.',
      'Specific national annexes to the application form.',
    ],
  },
  {
    code: 'FR',
    name: 'France',
    weight: 11,
    languages: ['fr'],
    quirks: [
      'ANSM plus CPP; strict document formalities.',
      'French-language requirements applied strictly to subject-facing material.',
    ],
  },
  {
    code: 'PL',
    name: 'Poland',
    weight: 9,
    languages: ['pl'],
    quirks: [
      'Insurance cover terms scrutinised.',
      'Translated documentation required for subject-facing material.',
    ],
  },
  { code: 'NL', name: 'Netherlands', weight: 7, languages: ['nl'], quirks: ['CCMO-specific formats expected.'] },
  { code: 'BE', name: 'Belgium', weight: 6, languages: ['nl', 'fr'], quirks: ['Two language versions frequently required.'] },
  { code: 'DK', name: 'Denmark', weight: 6, languages: ['da'], quirks: ['Lighter national annexes; biobank rules relevant.'] },
  { code: 'SE', name: 'Sweden', weight: 5, languages: ['sv'], quirks: ['Biobank and sample handling documentation.'] },
  { code: 'FI', name: 'Finland', weight: 4, languages: ['fi', 'sv'], quirks: ['Bilingual subject-facing material in some regions.'] },
  { code: 'CZ', name: 'Czechia', weight: 4, languages: ['cs'], quirks: ['Local-language ICF and site documentation.'] },
  { code: 'HU', name: 'Hungary', weight: 3, languages: ['hu'], quirks: ['Local-language requirements applied strictly.'] },
  { code: 'PT', name: 'Portugal', weight: 3, languages: ['pt'], quirks: ['CEIC timelines and local contract formalities.'] },
  { code: 'AT', name: 'Austria', weight: 2, languages: ['de'], quirks: ['Ethics committee documentation specifics.'] },
  { code: 'IE', name: 'Ireland', weight: 2, languages: ['en'], quirks: ['English-language dossier; insurance terms checked.'] },
]

// ---------------------------------------------------------------------------
// Distributions — reproduce realistic shape (docs/03-DATA-MODEL.md §2.1)
// ---------------------------------------------------------------------------

export const PHASE_WEIGHTS: Record<RfiPhase, number> = {
  VALIDATION: 65,
  ASSESSMENT_PART_I: 20,
  ASSESSMENT_PART_II: 15,
}

export const SUBMISSION_TYPE_WEIGHTS: Record<SubmissionType, number> = {
  INITIAL: 55,
  SUBSTANTIAL_MODIFICATION: 40,
  ADDITIONAL_MS: 5,
}

export const OUTCOME_WEIGHTS = {
  ACCEPTED: 80,
  FOLLOW_UP_RFI: 12,
  UNKNOWN: 8,
} as const

/**
 * The Italian fee change is a planted narrative beat: a visible spike in
 * FEE_NATIONAL_UPDATE RFIs after this date gives the analytics dashboard a story
 * rather than noise. See docs/06-DEMO-AND-DECK.md beat 7.
 */
export const ISTAT_FEE_CHANGE_DATE = new Date('2025-02-17T00:00:00Z')

export const CORPUS_DATE_RANGE = {
  from: new Date('2023-01-01T00:00:00Z'),
  to: new Date('2026-08-01T00:00:00Z'),
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]))
export const MEMBER_STATE_BY_CODE = new Map(MEMBER_STATES.map((m) => [m.code, m]))
export const ALL_SECTIONS = [...PART_I_SECTIONS, ...PART_II_SECTIONS]

/**
 * The four user groups named in the problem statement, plus Admin.
 *
 * These are the enum values `team_role` and the `owner` on every category, so a
 * screen that shows a team is showing a taxonomy value and reads it from here.
 */
export const TEAM_ROLES: TeamRole[] = [
  'RA_CLINICAL',
  'AFFILIATE',
  'CTA_MANAGEMENT',
  'EU_SUBMISSION_HUB',
  'ADMIN',
]

/** How a team is written for a reader. `RA_CLINICAL` is a database value, not a label. */
export const TEAM_LABELS: Record<TeamRole, string> = {
  RA_CLINICAL: 'RA Clinical',
  AFFILIATE: 'Affiliate',
  CTA_MANAGEMENT: 'CTA Management',
  EU_SUBMISSION_HUB: 'EU Submission Hub',
  ADMIN: 'Admin',
}

/**
 * The categories a team owns the response to.
 *
 * Ingestion and the seed both write `owner_team` from `category.owner`, so this
 * is the mapping the corpus was filed under rather than a second opinion about
 * it — which is why search filters on the column instead of expanding a team
 * into this list (ADR-024, migration 0029).
 */
export function categoriesOwnedBy(team: TeamRole): Category[] {
  return CATEGORIES.filter((c) => c.owner === team)
}

/**
 * Filed when the parser could not map the printed section onto the taxonomy.
 *
 * `section` is NOT NULL, so ingestion has to write something. The something has
 * to be a value that reads as "we could not tell", because the alternatives are
 * worse: the raw printed string puts a Member State name like "Spain" in a
 * dropdown of application section parts, and a fallback to a real section files
 * the row under a part it was never in. Mirrors UNCLASSIFIED for category —
 * the same admission, one field over.
 */
export const UNMAPPED_SECTION = 'UNMAPPED'

/** Preventable share — the headline number on the analytics "preventability" panel. */
export function preventableWeightShare(): number {
  const total = CATEGORIES.reduce((s, c) => s + c.weight, 0)
  const prev = CATEGORIES.filter((c) => c.preventable).reduce((s, c) => s + c.weight, 0)
  return prev / total
}
