import { z } from 'zod'

/**
 * Feature 3 contract (docs/04-AI-PIPELINE.md §4.4).
 *
 * Kept in a leaf module with no server imports so a client component can render
 * a draft without pulling the AI SDK or the database client in with it.
 */

export const DELTA_DIMENSIONS = [
  'MEMBER_STATE',
  'FEE_AMOUNT',
  'DOCUMENT_VERSION',
  'DATE',
  'SUBMISSION_TYPE',
  'SCOPE',
  'OTHER',
] as const

export type DeltaDimension = (typeof DELTA_DIMENSIONS)[number]

/**
 * The schema handed to `generateObject`. Never parsed out of free text — the AI
 * SDK validates it at the tool-call layer, so a malformed answer is retried by
 * the model rather than crashing a route (CLAUDE.md §6).
 *
 * `citations` is `.min(1)`: a draft with no citation is exactly the output this
 * feature exists to prevent, and rejecting it at the schema boundary is stronger
 * than asking the prompt nicely.
 */
export const DraftSchema = z.object({
  draft: z.string().min(1).max(4000),
  citations: z
    .array(
      z.object({
        considerationId: z.string(),
        supportsClaim: z.string().max(400),
      }),
    )
    .min(1),
  deltas: z.array(
    z.object({
      dimension: z.enum(DELTA_DIMENSIONS),
      precedentValue: z.string().max(300),
      currentValue: z.string().max(300),
      reviewerAction: z.string().max(400),
    }),
  ),
  attachmentsRequired: z.array(z.string().max(200)).max(20),
  openQuestions: z.array(z.string().max(400)).max(10),
  confidence: z.number().min(0).max(1),
})

export type DraftPayload = z.infer<typeof DraftSchema>

export const VERDICTS = ['SUPPORTED', 'PARTIAL', 'UNSUPPORTED'] as const
export type Verdict = (typeof VERDICTS)[number]

/** One sentence of the draft, graded against the precedents it was built from. */
export const VerdictSchema = z.object({
  sentences: z.array(
    z.object({
      sentence: z.string(),
      verdict: z.enum(VERDICTS),
      considerationIds: z.array(z.string()).max(6),
    }),
  ),
})

export type VerdictPayload = z.infer<typeof VerdictSchema>

/** A retrieved precedent, as it is shown to the model and to the reviewer. */
export interface Precedent {
  considerationId: string
  similarity: number
  considerationText: string
  sponsorResponseText: string
  memberState: string | null
  category: string
  section: string
  documentRef: string
  euTrialNumber: string
  responseStatus: string
  outcome: string
}

export interface SentenceVerdict {
  sentence: string
  verdict: Verdict
  considerationIds: string[]
}

/**
 * The result of asking for a draft.
 *
 * A refusal is a first-class outcome with the same standing as a draft, not an
 * error. It carries the nearest precedents anyway, so the reviewer sees what the
 * system looked at before declining, and who to escalate to.
 */
export type DraftOutcome =
  | {
      refused: true
      reason: string
      nearest: Precedent[]
      escalateTo: string | null
      maxSimilarity: number | null
      draftId: string | null
    }
  | {
      refused: false
      draftId: string | null
      draft: string
      citations: DraftPayload['citations']
      deltas: DraftPayload['deltas']
      attachmentsRequired: string[]
      openQuestions: string[]
      confidence: number
      maxSimilarity: number
      precedents: Precedent[]
      groundedness: number | null
      verdicts: SentenceVerdict[]
      /** Set when the verifier could not run; the draft still stands, ungraded. */
      verifierUnavailable?: string
    }
