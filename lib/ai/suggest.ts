import { generateObject } from 'ai'
import { google } from '@ai-sdk/google'
import { costUsd, models, promptHash, recordAiCall, requireAi } from './client'
import {
  SUGGEST_SYSTEM_PROMPT,
  buildSuggestUserMessage,
  suggestPromptFingerprint,
  type SuggestRequest,
} from './prompts/suggest'
import { SuggestionsSchema, type SuggestionsPayload } from '@/lib/suggest/types'

/**
 * Not `import 'server-only'`: the verification scripts import this module
 * legitimately, and that marker only resolves inside the Next bundler. Same
 * reasoning as lib/ai/client.ts.
 */
if (typeof window !== 'undefined') {
  throw new Error('lib/ai must never run in the browser')
}

/**
 * Slightly warmer than drafting's 0.2.
 *
 * The task is different: Feature 3 wants the one best answer, and variance there
 * is noise. Here the model is asked for three options that differ in substance,
 * and a temperature of 0 makes a model that has one idea write it out three
 * times. 0.4 is still far below the range where it starts inventing facts, and
 * the schema plus the verifier catch it if it does.
 */
const SUGGEST_TEMPERATURE = 0.4

export interface SuggestGeneration {
  payload: SuggestionsPayload
  model: string
  promptHash: string
}

export async function generateSuggestions(request: SuggestRequest): Promise<SuggestGeneration> {
  requireAi('Suggesting sponsor responses')

  const { fast } = models()
  const hash = promptHash(suggestPromptFingerprint(request))
  const started = performance.now()

  try {
    const result = await generateObject({
      model: google(fast),
      schema: SuggestionsSchema,
      system: SUGGEST_SYSTEM_PROMPT,
      prompt: buildSuggestUserMessage(request),
      temperature: SUGGEST_TEMPERATURE,
      maxRetries: 2,
    })

    const latencyMs = Math.round(performance.now() - started)
    const inputTokens = result.usage?.inputTokens ?? null
    const outputTokens = result.usage?.outputTokens ?? null

    await recordAiCall({
      purpose: 'SUGGEST',
      model: fast,
      promptHash: hash,
      inputTokens,
      outputTokens,
      latencyMs,
      costUsd: costUsd('SUGGEST', inputTokens),
      success: true,
    })

    return { payload: result.object, model: fast, promptHash: hash }
  } catch (err) {
    await recordAiCall({
      purpose: 'SUGGEST',
      model: fast,
      promptHash: hash,
      latencyMs: Math.round(performance.now() - started),
      success: false,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
