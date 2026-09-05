import { generateObject } from 'ai'
import { z } from 'zod'
import { costUsd, languageModel, models, promptHash, recordAiCall, requireAi } from './client'
import {
  COMPLETENESS_SYSTEM_PROMPT,
  buildCompletenessUserMessage,
  completenessPromptFingerprint,
  type CompletenessRequest,
} from './prompts/completeness'

if (typeof window !== 'undefined') {
  throw new Error('lib/ai must never run in the browser')
}

/**
 * Zero, not the drafting temperature.
 *
 * This produces findings, not prose. A completeness check that returns a
 * different set of gaps on a second run over the same document is not a check a
 * regulatory team can act on, and variation buys nothing here.
 */
const COMPLETENESS_TEMPERATURE = 0

/**
 * Every key is required, and the prompt says so out loud.
 *
 * Groq's structured output enforces that `required` lists every property, so a
 * `.default([])` — which removes the key from `required` — is rejected before
 * the call is even made. Keeping them required moves the burden to the prompt:
 * return an empty array, never omit the key. Both failure modes were seen on
 * the same document, one after the other.
 */
export const CompletenessSchema = z.object({
  missing: z
    .array(
      z.object({
        item: z.string().min(1).max(200),
        why: z.string().min(1).max(500),
        section: z.string().max(80),
        /**
         * Record ids, not objects.
         *
         * `.min(1)` for the same reason every other schema here has it: an
         * unsourced finding is the output this product exists to prevent, and
         * the boundary is a stronger place to refuse it than the prompt.
         *
         * A `{ considerationId, supportsClaim }` shape was tried first and the
         * model returned bare ids inside it, failing its own schema on every
         * retry. `why` already carries the explanation, so the wrapper bought
         * nothing but a validation failure.
         */
        citations: z.array(z.string()).min(1).max(8),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(12),
  /** What the document does answer. Shown so the reader sees coverage, not just gaps. */
  addressed: z
    .array(
      z.object({
        item: z.string().min(1).max(200),
        whereFound: z.string().min(1).max(300),
        citations: z.array(z.string()).min(1).max(8),
      }),
    )
    .max(12),
  /** Things the extraction could not settle. An extraction gap is not a dossier gap. */
  openQuestions: z.array(z.string().max(400)).max(8),
})

export type CompletenessPayload = z.infer<typeof CompletenessSchema>

export interface CompletenessGeneration {
  payload: CompletenessPayload
  model: string
  promptHash: string
}

export async function checkCompleteness(
  request: CompletenessRequest,
): Promise<CompletenessGeneration> {
  requireAi('Checking the report for gaps')

  const { fast } = models()
  const hash = promptHash(completenessPromptFingerprint(request))
  const started = performance.now()

  try {
    const result = await generateObject({
      model: languageModel(fast),
      schema: CompletenessSchema,
      system: COMPLETENESS_SYSTEM_PROMPT,
      prompt: buildCompletenessUserMessage(request),
      temperature: COMPLETENESS_TEMPERATURE,
      maxRetries: 2,
    })

    const latencyMs = Math.round(performance.now() - started)
    const inputTokens = result.usage?.inputTokens ?? null

    await recordAiCall({
      purpose: 'COMPLETENESS',
      model: fast,
      promptHash: hash,
      inputTokens,
      outputTokens: result.usage?.outputTokens ?? null,
      latencyMs,
      costUsd: costUsd('COMPLETENESS', inputTokens),
      success: true,
    })

    return { payload: result.object, model: fast, promptHash: hash }
  } catch (err) {
    await recordAiCall({
      purpose: 'COMPLETENESS',
      model: fast,
      promptHash: hash,
      latencyMs: Math.round(performance.now() - started),
      success: false,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
