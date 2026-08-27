/**
 * Gold set construction for the retrieval suite.
 *
 * IMPORTANT — read before quoting any number this produces.
 *
 * These queries are derived from the corpus generator's own ground truth, not
 * hand-marked by a human. That is honest and reproducible, and it is what makes
 * `npm run eval` runnable today, but it is weaker evidence than the 50
 * human-marked queries described in docs/05-EVALUATION.md §1. Two distinct
 * limits follow, and both belong in the deck footnote rather than being quietly
 * dropped:
 *
 *   1. Relevance is defined structurally (same document, same planted cluster),
 *      so a genuinely relevant record outside that structure counts as a miss.
 *      Absolute scores are therefore pessimistic.
 *   2. The identifier queries are trivially easy for keyword search and near
 *      impossible for vector search. That is exactly the point being measured —
 *      it is the argument for hybrid — but it means the *overall* average across
 *      query types is not a meaningful headline. Report the per-type breakdown.
 *
 * Replace this with human-marked queries when the team has an hour. The harness
 * reads whichever is present.
 */

export type QueryType = 'identifier' | 'semantic' | 'mixed'

export interface GoldQuery {
  id: string
  type: QueryType
  query: string
  /** Consideration ids that count as relevant. */
  relevant: string[]
  note: string
}

export interface CorpusRow {
  id: string
  document_id: string
  trial_id: string
  category: string
  member_state: string | null
  section: string
  is_seed: boolean
  document_ref: string
  eu_trial_number: string
}

/**
 * A deterministic pick, so two runs on the same corpus produce the same gold set
 * and the metrics are comparable across days. Same mulberry32 as the seeder.
 */
function makeRng(seed: number) {
  let a = seed >>> 0
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Natural-language probes, one per category.
 *
 * The relevant set for each comes from the generator's own labels, never from
 * judgement about which results look good. Only the wording is authored: it is
 * what a regulatory colleague would actually type.
 *
 * Two rules were applied when writing these, and both matter for the numbers to
 * mean anything:
 *
 *   1. Never use the category id or its label as the query. The category is
 *      weighted into the `fts` document, so "fee national update" would be
 *      keyword search retrieving a string that was indexed from the answer —
 *      circular, and it flatters keyword search with a score it did not earn.
 *   2. Avoid wording that straddles two categories. Relevance here is exact
 *      category membership, so a probe phrased across the boundary between,
 *      say, DOC_TRANSLATION_MISSING and ICF_LOCAL_LANGUAGE would score a
 *      correct retrieval as a miss.
 *
 * `type` records how much domain vocabulary the phrasing shares with the corpus.
 * `semantic` probes deliberately share very little, which is where keyword-only
 * retrieval is expected to fail — that expectation is the thing being measured,
 * not assumed.
 */
const PROBES: {
  id: string
  query: string
  category: string
  type: Exclude<QueryType, 'identifier'>
  memberState?: string
  plantedOnly?: boolean
  note: string
}[] = [
  {
    id: 'sem-translation',
    query: 'the authority wants the dossier paperwork in their own language, we only filed English',
    category: 'DOC_TRANSLATION_MISSING',
    type: 'semantic',
    plantedOnly: true,
    note: 'planted near-duplicate cluster across 11 Member States',
  },
  {
    id: 'sem-istat-fee',
    query: 'the amount Italy charges went up and what we paid is no longer current',
    category: 'FEE_NATIONAL_UPDATE',
    type: 'semantic',
    memberState: 'IT',
    plantedOnly: true,
    note: 'planted ISTAT fee spike',
  },
  {
    id: 'sem-fee-proof',
    query: 'we never attached the receipt showing the money was actually transferred',
    category: 'FEE_PAYMENT_PROOF',
    type: 'semantic',
    note: 'proof of payment, phrased without the corpus vocabulary',
  },
  {
    id: 'sem-insurance',
    query: 'our indemnity cover had lapsed and does not name the country in question',
    category: 'INSURANCE_COVER',
    type: 'semantic',
    note: 'insurance, paraphrased',
  },
  {
    id: 'sem-gdpr',
    query: 'they asked how personal information moves between countries and who holds it',
    category: 'DATA_PROTECTION',
    type: 'semantic',
    note: 'data protection, paraphrased',
  },
  {
    id: 'sem-impd-quality',
    query: 'they want more shelf life evidence on the active ingredient',
    category: 'IMPD_QUALITY',
    type: 'semantic',
    note: 'CMC stability, paraphrased',
  },
  {
    id: 'sem-recruitment',
    query: 'the adverts we planned for finding participants were never sent in',
    category: 'RECRUITMENT_MATERIAL',
    type: 'semantic',
    note: 'recruitment material, paraphrased',
  },
  {
    id: 'sem-ib-version',
    query: 'the brochure is older than the protocol it is supposed to support',
    category: 'IB_VERSION',
    type: 'semantic',
    note: "Investigator's Brochure currency, paraphrased",
  },
  {
    id: 'sem-labelling',
    query: 'the text printed on the packaging does not satisfy that country',
    category: 'LABELLING',
    type: 'semantic',
    note: 'labelling, paraphrased',
  },
  {
    id: 'sem-sm-justification',
    query: 'the reason we gave for changing the trial was not considered detailed enough',
    category: 'SM_JUSTIFICATION',
    type: 'semantic',
    note: 'substantial modification rationale, paraphrased',
  },
  {
    id: 'mix-version-mismatch',
    query: 'the document version we referenced is not the version that was uploaded',
    category: 'DOC_VERSION_MISMATCH',
    type: 'mixed',
    note: 'natural phrasing that shares some corpus vocabulary',
  },
  {
    id: 'mix-investigator-cv',
    query: 'the principal investigator CV was outdated and had no signature',
    category: 'INVESTIGATOR_SUITABILITY',
    type: 'mixed',
    note: 'natural phrasing that shares some corpus vocabulary',
  },
  {
    id: 'mix-qp-declaration',
    query: 'the QP declaration does not cover the manufacturing site we named',
    category: 'GMP_QP_DECLARATION',
    type: 'mixed',
    note: 'natural phrasing that shares some corpus vocabulary',
  },
  {
    id: 'mix-protocol-contradiction',
    query: 'two sections of the protocol contradict each other',
    category: 'PROTOCOL_INCONSISTENCY',
    type: 'mixed',
    note: 'natural phrasing that shares some corpus vocabulary',
  },
  {
    id: 'mix-icf-content',
    query: 'the consent form is missing wording the regulation requires',
    category: 'ICF_CONTENT',
    type: 'mixed',
    note: 'natural phrasing that shares some corpus vocabulary',
  },
  {
    id: 'mix-application-form',
    query: 'the application form does not agree with the rest of the dossier',
    category: 'APPLICATION_FORM_DATA',
    type: 'mixed',
    note: 'natural phrasing that shares some corpus vocabulary',
  },
]

export function buildGoldSet(corpus: CorpusRow[], seed = 42): GoldQuery[] {
  const rng = makeRng(seed)
  const queries: GoldQuery[] = []

  // --- Identifier queries -------------------------------------------------
  // Ground truth by construction: every consideration filed under a document
  // reference is relevant to a search for that reference, and nothing else is.
  const byDocument = new Map<string, CorpusRow[]>()
  for (const row of corpus) {
    const list = byDocument.get(row.document_ref)
    if (list) list.push(row)
    else byDocument.set(row.document_ref, [row])
  }

  const documentRefs = [...byDocument.keys()].sort()
  const pickedDocs = pickN(documentRefs, 15, rng)
  for (const ref of pickedDocs) {
    const rows = byDocument.get(ref)!
    queries.push({
      id: `id-doc-${ref}`,
      type: 'identifier',
      query: ref,
      relevant: rows.map((r) => r.id).sort(),
      note: 'document reference, verbatim',
    })
  }

  const byTrial = new Map<string, CorpusRow[]>()
  for (const row of corpus) {
    const list = byTrial.get(row.eu_trial_number)
    if (list) list.push(row)
    else byTrial.set(row.eu_trial_number, [row])
  }
  const trialNumbers = [...byTrial.keys()].sort()
  for (const trial of pickN(trialNumbers, 10, rng)) {
    queries.push({
      id: `id-trial-${trial}`,
      type: 'identifier',
      query: trial,
      relevant: byTrial.get(trial)!.map((r) => r.id).sort(),
      note: 'EU trial number, verbatim',
    })
  }

  // --- Authored probes over generator-labelled categories -----------------
  for (const probe of PROBES) {
    const relevant = corpus
      .filter(
        (r) =>
          r.category === probe.category &&
          (probe.plantedOnly !== true || r.is_seed) &&
          (probe.memberState === undefined || r.member_state === probe.memberState),
      )
      .map((r) => r.id)
      .sort()

    // A probe for a category the corpus does not contain would score 0 for every
    // configuration and drag the average down for no reason. Skip it instead.
    if (relevant.length === 0) continue

    queries.push({
      id: probe.id,
      type: probe.type,
      query: probe.query,
      relevant,
      note: probe.note,
    })
  }

  return queries
}

function pickN<T>(items: T[], n: number, rng: () => number): T[] {
  if (items.length <= n) return [...items]
  const pool = [...items]
  const out: T[] = []
  for (let i = 0; i < n && pool.length > 0; i++) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0])
  }
  return out
}
