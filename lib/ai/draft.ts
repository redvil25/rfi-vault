import { generateObject } from 'ai'
import { costUsd, languageModel, models, promptHash, recordAiCall, requireAi } from './client'
import {
  DRAFT_SYSTEM_PROMPT, buildDraftUserMessage, draftPromptFingerprint, type DraftRequest,
} from './prompts/draft'
import {
  VERIFY_PROMPT_VERSION, VERIFY_SYSTEM_PROMPT, buildVerifyUserMessage,
} from './prompts/verify'
import { DraftSchema, VerdictSchema, type DraftPayload, type Precedent, type VerdictPayload } from '@/lib/draft/types'

/**
 * Not `import 'server-only'`: the verification scripts import this module
 * legitimately, and that marker only resolves inside the Next bundler. Same
 * reasoning as lib/ai/client.ts.
 */
if (typeof window !== 'undefined') {
  throw new Error('lib/ai must never run in the browser')
}

/**
 * The two model calls Feature 3 makes. Both go through `recordAiCall`, so the
 * cost-per-draft figure on the Business Impact slide comes from `ai_calls` and
 * not from an estimate (ADR-012).
 *
 * Temperatures are from docs/04 §6 and are not a matter of taste: 0.2 for
 * drafting, because some variation in phrasing is fine, and 0 for verification,
 * because a grader that disagrees with itself between runs is not a grader.
 */

const DRAFT_TEMPERATURE = 0.2
const VERIFY_TEMPERATURE = 0

export interface DraftGeneration {
  payload: DraftPayload
  model: string
  promptHash: string
}

export async function generateDraft(request: DraftRequest): Promise<DraftGeneration> {
  requireAi('Drafting a sponsor response')

  const { fast } = models()
  const hash = promptHash(draftPromptFingerprint(request))
  const started = performance.now()

  try {
    const result = await generateObject({
      model: languageModel(fast),
      schema: DraftSchema,
      system: DRAFT_SYSTEM_PROMPT,
      prompt: buildDraftUserMessage(request),
      temperature: DRAFT_TEMPERATURE,
      maxRetries: 2,
    })

    const latencyMs = Math.round(performance.now() - started)
    const inputTokens = result.usage?.inputTokens ?? null
    const outputTokens = result.usage?.outputTokens ?? null

    await recordAiCall({
      purpose: 'DRAFT',
      model: fast,
      promptHash: hash,
      inputTokens,
      outputTokens,
      latencyMs,
      costUsd: costUsd('DRAFT', inputTokens),
      success: true,
    })

    return { payload: result.object, model: fast, promptHash: hash }
  } catch (err) {
    await recordAiCall({
      purpose: 'DRAFT',
      model: fast,
      promptHash: hash,
      latencyMs: Math.round(performance.now() - started),
      success: false,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

/**
 * The verifier pass (docs/04 §4.5). Uses the stronger model on purpose: the
 * point of the check is that it is not the same reasoning that produced the
 * draft.
 */
export async function verifyDraft(
  draft: string,
  precedents: Precedent[],
): Promise<VerdictPayload> {
  requireAi('Verifying a drafted response')

  const { strong } = models()
  const hash = promptHash(
    [VERIFY_PROMPT_VERSION, VERIFY_SYSTEM_PROMPT, buildVerifyUserMessage(draft, precedents)].join(
      '\n---\n',
    ),
  )
  const started = performance.now()

  try {
    const result = await generateObject({
      model: languageModel(strong),
      schema: VerdictSchema,
      system: VERIFY_SYSTEM_PROMPT,
      prompt: buildVerifyUserMessage(draft, precedents),
      temperature: VERIFY_TEMPERATURE,
      maxRetries: 2,
    })

    const latencyMs = Math.round(performance.now() - started)
    const inputTokens = result.usage?.inputTokens ?? null

    await recordAiCall({
      purpose: 'VERIFY',
      model: strong,
      promptHash: hash,
      inputTokens,
      outputTokens: result.usage?.outputTokens ?? null,
      latencyMs,
      costUsd: costUsd('VERIFY', inputTokens),
      success: true,
    })

    return result.object
  } catch (err) {
    await recordAiCall({
      purpose: 'VERIFY',
      model: strong,
      promptHash: hash,
      latencyMs: Math.round(performance.now() - started),
      success: false,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
