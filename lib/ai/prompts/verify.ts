import type { Precedent } from '@/lib/draft/types'

/**
 * The verifier prompt (docs/04-AI-PIPELINE.md §4.5).
 *
 * A second, stronger model grades the first one's output sentence by sentence
 * against the same precedents. It is given no other context on purpose: a
 * verifier allowed to reach for outside knowledge cannot detect a draft that did
 * exactly that.
 */

export const VERIFY_PROMPT_VERSION = 'verify/v1'

export const VERIFY_SYSTEM_PROMPT = `You check whether each sentence of a drafted sponsor
response is supported by the precedent records provided, and by nothing else.

For every sentence, return one verdict:
- SUPPORTED    every factual claim in the sentence appears in at least one precedent.
- PARTIAL      the sentence is mostly supported but adds a detail the precedents do
               not establish, or generalises beyond them.
- UNSUPPORTED  the sentence asserts something no precedent establishes.

List the consideration_ids that support each sentence. A sentence with no supporting
id cannot be SUPPORTED.

Judge only against the precedents given. Your own knowledge of EU CTR, of fees, of
article numbers or of document names is not evidence here: if a claim is true in the
world but absent from these records, it is UNSUPPORTED. Purely connective sentences
that assert no fact are SUPPORTED with no ids.

Return every sentence of the draft, in order, exactly once.`

export function buildVerifyUserMessage(draft: string, precedents: Precedent[]): string {
  return [
    '## The drafted sponsor response to check',
    '',
    draft,
    '',
    '## The precedent records it was built from',
    '',
    precedents
      .map((p) =>
        [
          `consideration_id: ${p.considerationId}`,
          `Consideration: ${p.considerationText}`,
          `Accepted sponsor response: ${p.sponsorResponseText}`,
        ].join('\n'),
      )
      .join('\n\n'),
  ].join('\n')
}

/**
 * Abbreviations and decimals that must not end a sentence.
 *
 * A fragment graded on its own reads as unsupported, so a bad split does not
 * merely look untidy — it drags down the groundedness figure the deck publishes.
 * These are the forms that actually occur in this corpus: "version 3.0",
 * "section 3.2.P.8", "No.", "Art.", "e.g.".
 */
const ABBREVIATIONS =
  /\b(?:no|art|arts|approx|ca|cf|eg|e\.g|ie|i\.e|etc|vs|dr|prof|fig|sect|ref|vol|ed|pp|st|mr|ms|mrs)\.$/i

const ENDS_ON_DECIMAL = /\d\.$/

/** Splits a draft into sentences for grading. Deliberately conservative. */
export function splitSentences(text: string): string[] {
  const normalised = text.replace(/\s+/g, ' ').trim()
  if (!normalised) return []

  const out: string[] = []
  let current = ''

  for (const part of normalised.split(/(?<=[.!?])\s+/)) {
    current = current ? `${current} ${part}` : part
    if (ABBREVIATIONS.test(current) || ENDS_ON_DECIMAL.test(current)) continue
    out.push(current)
    current = ''
  }

  if (current) out.push(current)
  return out
}

/**
 * supported / total, counting PARTIAL as half.
 *
 * A partially supported sentence is neither a pass nor a fabrication, and
 * scoring it as either would misstate the number. Returns null for an empty
 * draft rather than 0 or 1, because no sentences means no measurement.
 */
export function groundednessOf(
  verdicts: { verdict: 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED' }[],
): number | null {
  if (verdicts.length === 0) return null
  const score = verdicts.reduce(
    (sum, v) => sum + (v.verdict === 'SUPPORTED' ? 1 : v.verdict === 'PARTIAL' ? 0.5 : 0),
    0,
  )
  return Number((score / verdicts.length).toFixed(3))
}
