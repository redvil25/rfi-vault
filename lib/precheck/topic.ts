import { CATEGORY_BY_ID } from '@/lib/domain/taxonomy'

/**
 * Does this section text address a mined theme at all? (docs/04-AI-PIPELINE.md §3.4)
 *
 * A mined rule on its own says what a Member State *asks about a section*. It
 * says nothing about the document in front of the writer. Firing it unconditionally
 * meant the check returned the same Italian fee flags for any text pasted into
 * Regulatory — including the word "health" — because the pasted text was never
 * consulted. The flag looked like a finding about the dossier and was not one.
 *
 * So a mined rule now has to clear two gates before it can become a flag:
 *
 *   SUBSTANCE  the section has to be long enough to be an application section.
 *   TOPIC      the text must not already address the theme. A rule about proof
 *              of payment is worth raising when nothing in the section mentions
 *              a fee, a payment or a receipt; it is noise when the section is
 *              plainly about that already.
 *
 * The terms come from the taxonomy — the category's own label and its
 * `artefactKey` — so this file asserts nothing about EU CTR that the taxonomy
 * does not already assert, and adding a category brings its terms with it
 * (ADR-024).
 */

/**
 * Words that describe a *defect* rather than a *subject*.
 *
 * Category labels are written as complaints — "Proof of national fee payment
 * **missing**" — and the complaint half matches nothing in a dossier, which is
 * written as a statement. Keeping them would make every rule look addressed.
 */
const DEFECT_WORDS = new Set([
  'missing', 'absent', 'not', 'non', 'no', 'incomplete', 'inadequate', 'unclear',
  'outdated', 'illegible', 'unsigned', 'undated', 'expired', 'insufficient',
  'inconsistent', 'inconsistency', 'mismatch', 'match', 'matches', 'does', 'do',
  'gap', 'wrong', 'old', 'previous', 'contradiction', 'internal', 'question',
  'required', 'require', 'requires', 'provided', 'submitted', 'covering',
  'compliant', 'compliance', 'follow', 'referenced', 'uploaded', 'approved',
  'detail', 'rules', 'present', 'consistency', 'current',
])

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'or', 'and', 'to', 'in', 'on', 'for', 'with', 'by',
  'from', 'is', 'are', 'be', 'been', 'was', 'were', 'that', 'this', 'it', 'its',
  'between', 'within', 'whether', 'falls', 'than', 'into', 'at', 'as',
])

/** Short tokens that are real domain terms rather than noise. */
const SHORT_KEEP = new Set(['cv', 'qp', 'ib', 'icf', 'gcp', 'imp', 'fee', 'gmp', 'sm', 'pip'])

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * The subject words for a category, derived from the taxonomy.
 *
 * Cached because this runs once per rule per section and the taxonomy is fixed
 * for the life of the process.
 */
const CACHE = new Map<string, string[]>()

export function topicTermsFor(category: string): string[] {
  const cached = CACHE.get(category)
  if (cached) return cached

  const taxonomy = CATEGORY_BY_ID.get(category)
  const terms = new Set<string>()

  if (taxonomy) {
    for (const token of [...tokenise(taxonomy.artefactKey ?? ''), ...tokenise(taxonomy.label)]) {
      if (STOPWORDS.has(token) || DEFECT_WORDS.has(token)) continue
      if (token.length < 3 && !SHORT_KEEP.has(token)) continue
      if (token.length === 3 && !SHORT_KEEP.has(token) && /^[0-9]+$/.test(token)) continue
      terms.add(token)
    }
  }

  const list = [...terms]
  CACHE.set(category, list)
  return list
}

/** `payment` also matches `payments`; nothing cleverer, and nothing stemmed wrongly. */
function mentions(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}(?:s|es)?\\b`, 'i').test(text)
}

/**
 * True when the section already talks about the theme.
 *
 * One term is enough. This is a relevance filter, not a completeness check: a
 * section that mentions the fee at all is one where a "you have not mentioned
 * the fee" flag would be wrong, and whether the fee is handled *correctly* is
 * exactly what the precedent panel is for.
 */
export function addressesTopic(text: string, category: string): boolean {
  const terms = topicTermsFor(category)
  if (terms.length === 0) return false
  return terms.some((t) => mentions(text, t))
}

/**
 * Minimum words before a mined rule may fire.
 *
 * An application section is prose. A handful of words is a stray paste, a
 * heading, or a test — and running a country's recurrence rules against it
 * produces flags that are about the corpus rather than about the document,
 * which is precisely the confusion this gate exists to prevent.
 */
export const SUBSTANCE_MIN_WORDS = 25

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function isSubstantive(text: string): boolean {
  return wordCount(text) >= SUBSTANCE_MIN_WORDS
}

/** Why a mined rule did not fire against this text. Never blank. */
export function topicSkipReason(text: string, category: string): string | null {
  if (!isSubstantive(text)) {
    const n = wordCount(text)
    return `Section is ${n} word${n === 1 ? '' : 's'} — too short to assess. Mined rules need at least ${SUBSTANCE_MIN_WORDS} words of section text to say anything about it.`
  }
  if (addressesTopic(text, category)) {
    const hit = topicTermsFor(category).filter((t) => mentions(text, t))
    return `This section already refers to ${hit.join(', ')}, so the theme appears to be addressed. Check the precedent if you want to confirm it is complete.`
  }
  return null
}

/** The sentence a fired rule leads with, naming what the text did not mention. */
export function absenceSentence(category: string): string {
  const terms = topicTermsFor(category)
  return terms.length > 0
    ? `Nothing in this section mentions ${terms.join(', ')}.`
    : 'This section does not appear to address the theme.'
}
