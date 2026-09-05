import { z } from 'zod'
import type { Precedent, SentenceVerdict } from '@/lib/draft/types'

/**
 * Feature 6 contract — three grounded options for answering a pasted request
 * (docs/04-AI-PIPELINE.md §5).
 *
 * Feature 3 answers a request that is already filed, inside the status machine,
 * and produces one draft to be reviewed and approved. This answers one that just
 * landed in somebody's inbox and is not in the repository yet, and produces
 * **options** rather than an answer.
 *
 * Three, and strategically distinct. Three paraphrases of the same sentence are
 * not three options — a regulatory writer choosing between them is choosing
 * nothing. The strategies below are the three moves actually available when a
 * regulator asks for something: give it to them, explain why they already have
 * it, or admit it is coming and say when.
 */

export const STRATEGIES = ['SUPPLY', 'JUSTIFY', 'COMMIT'] as const
export type Strategy = (typeof STRATEGIES)[number]

export const STRATEGY_LABEL: Record<Strategy, string> = {
  SUPPLY: 'Supply the document',
  JUSTIFY: 'Justify what was already filed',
  COMMIT: 'Acknowledge and commit to a date',
}

export const STRATEGY_BLURB: Record<Strategy, string> = {
  SUPPLY: 'The artefact exists, or can be produced now. Attach it and say so.',
  JUSTIFY: 'The dossier already answers this. Point at where, and explain why it is sufficient.',
  COMMIT: 'The artefact does not exist yet. Say so, and commit to a date rather than going quiet.',
}

/**
 * The schema handed to `generateObject`.
 *
 * `citations.min(1)` per option, for the same reason Feature 3 has it: an option
 * with no citation is exactly the output this product exists to prevent, and
 * rejecting it at the schema boundary is stronger than asking the prompt nicely
 * (ADR-005).
 *
 * `.min(1).max(3)` rather than `.length(3)`. If the precedents support only two
 * honest strategies, two is the right answer — padding to three would invent the
 * third, which is the failure mode the whole feature is built to avoid.
 */
export const SuggestionsSchema = z.object({
  options: z
    .array(
      z.object({
        strategy: z.enum(STRATEGIES),
        /** One line naming the move, in the writer's terms. */
        headline: z.string().min(1).max(160),
        /** The response text itself, ready to be edited into the box. */
        draft: z.string().min(1).max(3000),
        /** When a reviewer should pick this option over the others. */
        whenToUse: z.string().min(1).max(400),
        /** What could go wrong with it — the reason not to pick it. */
        risk: z.string().min(1).max(400),
        citations: z
          .array(
            z.object({
              considerationId: z.string(),
              supportsClaim: z.string().max(400),
            }),
          )
          .min(1),
        attachmentsRequired: z.array(z.string().max(200)).max(10),
        confidence: z.number().min(0).max(1),
      }),
    )
    .min(1)
    .max(3),
  /** Anything the precedents do not settle. Shown regardless of which option is chosen. */
  openQuestions: z.array(z.string().max(400)).max(8),
})

export type SuggestionsPayload = z.infer<typeof SuggestionsSchema>

export type SuggestionOption = SuggestionsPayload['options'][number]

/** One option, after the verifier has graded it. */
export type GradedOption = SuggestionOption & {
  /** Share of sentences the verifier judged supported. Null when unverified. */
  groundedness: number | null
  verdicts: SentenceVerdict[]
}

/**
 * What the caller pasted, once it has been read.
 *
 * Every field is either extracted deterministically or left null. Nothing here
 * is guessed: an unrecognised section is null and the UI asks, because filing a
 * request under the wrong section retrieves the wrong precedent and the writer
 * has no way to tell.
 */
export interface ParsedRequest {
  text: string
  memberState: string | null
  section: string | null
  sectionPart: 'PART_I' | 'PART_II' | null
  /**
   * Sections precedent was searched across. One when it is known, several when
   * the category legitimately spans them, empty when it could not be narrowed.
   */
  sectionCandidates: string[]
  category: string
  /** 0–1 from the deterministic classifier. Low means "we are not sure what this is about". */
  categoryConfidence: number
  /** More than one consideration in the paste; the rest are offered, not silently dropped. */
  siblings: { index: number; text: string }[]
}

export type SuggestOutcome =
  | {
      refused: true
      reason: string
      /** Who to send it to instead. Read from the taxonomy. */
      escalateTo: string | null
      /** The closest thing found, even though it was not close enough. */
      nearest: Precedent[]
      maxSimilarity: number | null
      parsed: ParsedRequest
    }
  | {
      refused: false
      options: GradedOption[]
      openQuestions: string[]
      precedents: Precedent[]
      maxSimilarity: number
      parsed: ParsedRequest
      model: string
      /** True when the verifier did not run; the UI must not imply a grade it does not have. */
      verifierUnavailable: string | null
    }
