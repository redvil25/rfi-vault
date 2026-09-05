/**
 * Cross-section consistency (docs/04-AI-PIPELINE.md §3.3).
 *
 * Values that appear in more than one place in a dossier have to agree. The
 * planned number of subjects on the application form has to match the protocol;
 * the protocol version quoted in the cover letter has to match the protocol
 * itself; the IMP name and strength have to be the same everywhere they appear.
 * A mismatch is a routine request for information, it is deterministic to
 * detect, and unlike a mined rule it needs no corpus at all.
 *
 * This is deliberately conservative. It only compares values it can extract
 * from two or more of the sections the writer actually pasted, and it reports
 * "not checked" rather than "consistent" when it saw fewer than two. Reporting
 * a pass for a comparison that never happened is the failure mode this whole
 * feature exists to avoid (ADR-025).
 *
 * The extractors read the shapes CTIS documents actually use. They are not a
 * parser for the dossier and do not try to be: a value written in a form this
 * file does not recognise is simply not extracted, and the check says so.
 */

export interface ConsistencyFinding {
  id: string
  label: string
  /** Sections the value was found in. */
  sections: string[]
  /** True when the comparison actually happened — two or more values were found. */
  checked: boolean
  /** True when the extracted values disagree. */
  disagrees: boolean
  /** Sentence for the UI — always populated, including for a clean result. */
  note: string
  /** What was found where, so a reader can see the mismatch rather than take it on trust. */
  values: { section: string; value: string }[]
}

interface Extractor {
  id: string
  label: string
  /** Human phrasing of what the value is, used in both notes. */
  noun: string
  extract: (text: string) => string | null
  /** Values are compared after this, so "v3.0" and "V 3.0" are the same version. */
  normalise?: (raw: string) => string
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(text)
    if (m?.[1]) return m[1].trim()
  }
  return null
}

const EXTRACTORS: Extractor[] = [
  {
    id: 'protocol-version',
    label: 'Protocol version quoted consistently',
    noun: 'protocol version',
    extract: (t) =>
      firstMatch(t, [
        /protocol\s+(?:version|v)[\s.:]*([0-9]+(?:\.[0-9]+)*)/i,
        /version\s+([0-9]+(?:\.[0-9]+)*)\s+of\s+the\s+protocol/i,
        /protocol[^.\n]{0,40}?\bv\.?\s*([0-9]+(?:\.[0-9]+)*)/i,
      ]),
    // "3.0" and "3" are the same version; a trailing zero is formatting.
    normalise: (raw) => raw.replace(/(\.0)+$/, ''),
  },
  {
    id: 'protocol-date',
    label: 'Protocol date quoted consistently',
    noun: 'protocol date',
    extract: (t) =>
      firstMatch(t, [
        // The gap must tolerate a full stop: "Protocol version 4.0 dated …"
        // puts one inside the version number, and excluding dots here stopped
        // this extractor matching anything at all.
        /protocol[^\n]{0,60}?dated\s+([0-9]{1,2}\s+\w+\s+[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}[/.][0-9]{1,2}[/.][0-9]{4})/i,
        /protocol[^\n]{0,40}?\bdate[\s:]+([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}[/.][0-9]{1,2}[/.][0-9]{4})/i,
      ]),
    normalise: (raw) => raw.replace(/[/.]/g, '-').toLowerCase(),
  },
  {
    id: 'subject-count',
    label: 'Planned number of subjects agrees',
    noun: 'planned number of subjects',
    extract: (t) =>
      firstMatch(t, [
        /(?:planned|total|approximately|up\s+to)?\s*([0-9][0-9,\s]{1,8})\s*(?:subjects|participants|patients)\s+(?:will\s+be\s+)?(?:enrolled|randomised|randomized|recruited|included)/i,
        /(?:number\s+of\s+(?:subjects|participants|patients))[\s:]+(?:approximately\s+)?([0-9][0-9,\s]{1,8})/i,
        /(?:enrol|enroll|recruit)(?:ment|ing)?\s+of\s+(?:approximately\s+)?([0-9][0-9,\s]{1,8})\s*(?:subjects|participants|patients)/i,
      ]),
    normalise: (raw) => raw.replace(/[,\s]/g, ''),
  },
  {
    id: 'imp-name',
    label: 'IMP name agrees',
    noun: 'investigational medicinal product',
    extract: (t) =>
      firstMatch(t, [
        /\b(NN[-\s]?[0-9]{3,4})\b/i,
        /investigational\s+medicinal\s+product[^.\n]{0,20}?\b([A-Z][A-Za-z0-9-]{2,20})\b/,
      ]),
    normalise: (raw) => raw.replace(/[\s-]/g, '').toUpperCase(),
  },
  {
    id: 'imp-strength',
    label: 'IMP strength agrees',
    noun: 'IMP strength',
    extract: (t) =>
      firstMatch(t, [
        /([0-9]+(?:\.[0-9]+)?)\s*(?:mg|mcg|µg|ug|g|mg\/mL|mg\/ml)\b/i,
      ]),
    normalise: (raw) => raw.replace(/\s+/g, '').toLowerCase(),
  },
  {
    id: 'eu-trial-number',
    label: 'EU trial number agrees',
    noun: 'EU trial number',
    extract: (t) => firstMatch(t, [/\b([0-9]{4}-[0-9]{6}-[0-9]{2}-[0-9]{2})\b/]),
  },
]

/**
 * Compare every extractable value across the pasted sections.
 *
 * A value found in only one section is not evidence of anything, so it is
 * reported as unchecked. That is the whole discipline here: the number of
 * comparisons this can make depends entirely on what the writer pasted, and
 * saying so is more useful than a green tick that means "we did not look".
 */
export function checkConsistency(
  sections: { section: string; text: string }[],
): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = []

  for (const extractor of EXTRACTORS) {
    const values: { section: string; value: string }[] = []
    for (const { section, text } of sections) {
      const raw = extractor.extract(text)
      if (raw) values.push({ section, value: raw })
    }

    if (values.length < 2) {
      findings.push({
        id: extractor.id,
        label: extractor.label,
        sections: values.map((v) => v.section),
        checked: false,
        disagrees: false,
        note:
          values.length === 0
            ? `No ${extractor.noun} found in the sections provided. Not checked.`
            : `Found the ${extractor.noun} in one section only (${values[0].section}). Nothing to compare it against.`,
        values,
      })
      continue
    }

    const norm = (v: string) => (extractor.normalise ? extractor.normalise(v) : v).toLowerCase()
    const distinct = new Set(values.map((v) => norm(v.value)))

    findings.push({
      id: extractor.id,
      label: extractor.label,
      sections: values.map((v) => v.section),
      checked: true,
      disagrees: distinct.size > 1,
      note:
        distinct.size > 1
          ? `The ${extractor.noun} differs between sections: ${values
              .map((v) => `${v.section} says ${v.value}`)
              .join('; ')}. These must agree before filing.`
          : `The ${extractor.noun} agrees across ${values.length} sections (${values[0].value}).`,
      values,
    })
  }

  return findings
}
