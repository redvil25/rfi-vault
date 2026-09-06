import { ALL_SECTIONS } from '@/lib/domain/taxonomy'

/**
 * Sectioning a document on its own headings (docs/04-AI-PIPELINE.md §3.9).
 *
 * Pasting into one box per section is the biggest friction in this feature: a
 * writer has a document, not eleven boxes. This splits a pasted dossier on the
 * headings it already contains and maps each one onto the taxonomy.
 *
 * Deterministic, and deliberately unwilling to guess. A heading it does not
 * recognise becomes an UNRECOGNISED block that is shown to the user and left
 * out of the check rather than filed under the nearest-looking section. Text
 * before the first heading is preamble and is treated the same way. Guessing
 * here would silently check the cover letter against the protocol's rules,
 * which is worse than checking nothing (ADR-025).
 */

export interface SplitBlock {
  /** Taxonomy section, or null when the heading was not recognised. */
  section: string | null
  /** The heading line as it was written, or null for text before any heading. */
  heading: string | null
  text: string
}

export interface SplitResult {
  blocks: SplitBlock[]
  /** Blocks that mapped onto the taxonomy — the ones the check can use. */
  recognised: { section: string; text: string }[]
  /** Headings that did not map, verbatim, so the user can see what was dropped. */
  unrecognised: string[]
}

/**
 * Aliases for headings that do not read exactly like the taxonomy.
 *
 * These are name variants, not domain claims — "Investigator's Brochure" and
 * "IB" are the same document, and saying so asserts nothing about EU CTR that
 * the taxonomy does not already assert.
 */
const ALIASES: Record<string, string> = {
  ib: 'Investigator Brochure',
  "investigator's brochure": 'Investigator Brochure',
  'investigators brochure': 'Investigator Brochure',
  impd: 'IMPD Quality',
  'impd quality': 'IMPD Quality',
  'impd s&e': 'IMPD Safety and Efficacy',
  'impd safety': 'IMPD Safety and Efficacy',
  'impd safety & efficacy': 'IMPD Safety and Efficacy',
  icf: 'Informed Consent',
  'informed consent form': 'Informed Consent',
  'patient information sheet': 'Informed Consent',
  'subject information': 'Informed Consent',
  'gmp / qp declaration': 'GMP and QP Declaration',
  'qp declaration': 'GMP and QP Declaration',
  'gmp declaration': 'GMP and QP Declaration',
  'eu caf': 'EU Application Form',
  'application form': 'EU Application Form',
  'cover letter': 'Cover Letter',
  'covering letter': 'Cover Letter',
  insurance: 'Insurance and Indemnification',
  indemnity: 'Insurance and Indemnification',
  'data protection': 'Data Protection',
  gdpr: 'Data Protection',
  recruitment: 'Subject Recruitment Arrangements',
  'recruitment arrangements': 'Subject Recruitment Arrangements',
  'investigator suitability': 'Investigator Suitability',
  'site suitability': 'Site Suitability',
  'facilities': 'Site Suitability',
  'financial arrangements': 'Financial Arrangements',
  finance: 'Financial Arrangements',
  'biological samples': 'Biological Samples',
  'auxiliary medicinal product': 'Auxiliary Medicinal Product',
  amp: 'Auxiliary Medicinal Product',
  labelling: 'IMP Labelling',
  'imp labelling': 'IMP Labelling',
  'scientific advice': 'Scientific Advice and PIP',
  pip: 'Scientific Advice and PIP',
  regulatory: 'Regulatory',
  protocol: 'Protocol',
}

const CANONICAL = new Map<string, string>([
  ...ALL_SECTIONS.map((s) => [s.toLowerCase(), s] as [string, string]),
  ...Object.entries(ALIASES),
])

/** Strip numbering, punctuation and casing so "3.2 IMPD Quality:" resolves. */
function normaliseHeading(line: string): string {
  return line
    .replace(/^[\s#>*_-]+/, '')
    .replace(/^(?:part\s+[iv]+\s*[-–—:.]?\s*)/i, '')
    .replace(/^(?:section\s+)?[0-9]+(?:\.[0-9]+)*[\s.):-]*/i, '')
    .replace(/[:.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * A line is a heading if it is short, has no terminal full stop, and resolves.
 *
 * The resolve requirement is doing the real work: a short line that maps onto
 * no section is prose, not an unrecognised heading, and treating every short
 * line as a heading would shred a bulleted list into fifty blocks.
 */
function headingFor(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length > 80) return null
  if (/[.!?;,]$/.test(trimmed)) return null
  // A heading is a label, not a sentence.
  if (trimmed.split(/\s+/).length > 8) return null
  return CANONICAL.get(normaliseHeading(trimmed)) ?? null
}

/**
 * True when a line sits where a heading sits and is shaped like one.
 *
 * Position carries most of the weight: a heading opens the document or follows
 * a blank line. Without that anchor the rule was so narrow that an unnumbered
 * heading like "Annexe Z — Local Appendix" was not detected at all, and its
 * body silently joined the previous section — unrecognised content checked
 * against another section's rules, which is the exact guess this file exists to
 * refuse.
 */
function looksLikeHeading(line: string, atBlockStart: boolean): boolean {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length > 80) return false
  if (/[.!?;,]$/.test(trimmed)) return false
  if (trimmed.split(/\s+/).length > 8) return false
  if (
    /^[\s#>*_-]*(?:part\s+[iv]+|section\s+[0-9]|[0-9]+(?:\.[0-9]+)*[\s.):-])/i.test(trimmed) ||
    /^#{1,6}\s/.test(trimmed)
  ) {
    return true
  }
  return atBlockStart
}

export function splitDossier(raw: string): SplitResult {
  const lines = raw.split(/\r?\n/)
  const blocks: SplitBlock[] = []
  let current: SplitBlock = { section: null, heading: null, text: '' }
  // The first line of the document, and any line after a blank one, is where a
  // heading is allowed to appear.
  let atBlockStart = true

  const push = () => {
    if (current.text.trim() || current.heading) blocks.push({ ...current, text: current.text.trim() })
  }

  for (const line of lines) {
    if (!line.trim()) {
      current.text += '\n'
      atBlockStart = true
      continue
    }

    const section = headingFor(line)
    if (section || looksLikeHeading(line, atBlockStart)) {
      push()
      current = { section, heading: line.trim(), text: '' }
      atBlockStart = false
      continue
    }

    current.text += `${line}\n`
    atBlockStart = false
  }
  push()

  // Same section twice — a dossier can revisit one — is concatenated rather
  // than split, because the consistency check compares *between* sections and
  // two blocks of the same name would compare against themselves.
  const merged = new Map<string, string>()
  for (const b of blocks) {
    if (!b.section || !b.text.trim()) continue
    merged.set(b.section, merged.has(b.section) ? `${merged.get(b.section)}\n\n${b.text}` : b.text)
  }

  return {
    blocks,
    recognised: [...merged.entries()].map(([section, text]) => ({ section, text })),
    unrecognised: blocks
      .filter((b) => !b.section && b.text.trim())
      .map((b) => b.heading ?? '(text before the first heading)'),
  }
}
