import { generateObject } from 'ai'
import { z } from 'zod'
import { costUsd, languageModel, models, promptHash, recordAiCall, requireAi } from './client'
import {
  REVIEW_SYSTEM_PROMPT,
  buildReviewUserMessage,
  reviewPromptFingerprint,
  type ReviewRequest,
} from './prompts/review'

if (typeof window !== 'undefined') {
  throw new Error('lib/ai must never run in the browser')
}

/**
 * Zero. A review that changes its verdict between runs on the same text is not
 * a review, and there is no phrasing variety wanted here — the useful output is
 * a judgement and a concrete change, not a turn of phrase.
 */
const REVIEW_TEMPERATURE = 0

/**
 * Every key required, and the prompt says to return empty rather than omit.
 *
 * Groq's structured output enforces that `required` lists every property, so a
 * `.default()` — which removes the key from `required` — is rejected before the
 * call is made. `revised` is an empty string rather than null for the same
 * reason: a nullable is one more thing for the model to get wrong.
 */
export const ReviewSchema = z.object({
  verdict: z.enum(['ADEQUATE', 'IMPROVE']),
  summary: z.string().min(1).max(400),
  strengths: z.array(z.string().max(300)).max(6),
  improvements: z
    .array(
      z.object({
        issue: z.string().min(1).max(300),
        suggestion: z.string().min(1).max(600),
        citations: z.array(z.string()).min(1).max(6),
      }),
    )
    .max(6),
  revised: z.string().max(3000),
})

export type ReviewPayload = z.infer<typeof ReviewSchema>

export interface ReviewGeneration {
  payload: ReviewPayload
  model: string
  promptHash: string
}

export async function reviewResponse(request: ReviewRequest): Promise<ReviewGeneration> {
  requireAi('Reviewing a sponsor response')

  const { fast } = models()
  const hash = promptHash(reviewPromptFingerprint(request))
  const started = performance.now()

  try {
    const result = await generateObject({
      model: languageModel(fast),
      schema: ReviewSchema,
      system: REVIEW_SYSTEM_PROMPT,
      prompt: buildReviewUserMessage(request),
      temperature: REVIEW_TEMPERATURE,
      maxRetries: 2,
    })

    const latencyMs = Math.round(performance.now() - started)
    const inputTokens = result.usage?.inputTokens ?? null

    await recordAiCall({
      purpose: 'REVIEW',
      model: fast,
      promptHash: hash,
      inputTokens,
      outputTokens: result.usage?.outputTokens ?? null,
      latencyMs,
      costUsd: costUsd('REVIEW', inputTokens),
      success: true,
    })

    return { payload: result.object, model: fast, promptHash: hash }
  } catch (err) {
    await recordAiCall({
      purpose: 'REVIEW',
      model: fast,
      promptHash: hash,
      latencyMs: Math.round(performance.now() - started),
      success: false,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
