import { createHash } from 'node:crypto'
import { createServiceClient } from '@/lib/db/service'
import { aiEnabled, serverEnv } from '@/lib/env'
import { log } from '@/lib/log'

/**
 * Not `import 'server-only'`: the seed, embed and eval scripts import this
 * module legitimately, and that marker only resolves inside the Next bundler —
 * under tsx it throws on import and hides the real error. A runtime check gives
 * the same protection where it actually matters. Same reasoning as
 * lib/db/service.ts.
 */
if (typeof window !== 'undefined') {
  throw new Error('lib/ai must never run in the browser')
}

/**
 * The single choke point for every model call (ADR-012).
 *
 * Nothing else in the codebase may import an AI SDK function directly. Two
 * reasons, and both are load-bearing:
 *
 *   1. Swapping provider, or dropping in the local embedding fallback from
 *      docs/04-AI-PIPELINE.md §1, has to be a one-file change.
 *   2. Every call must land in `ai_calls`. The cost-per-RFI number on the
 *      Business Impact slide comes from that table, and a call that bypasses
 *      this module is a call missing from the slide.
 */

export type AiPurpose = 'EMBED' | 'EXTRACT' | 'DRAFT' | 'SUGGEST' | 'VERIFY' | 'RERANK'

export class AiDisabledError extends Error {
  constructor(what: string) {
    super(
      `${what} needs GOOGLE_GENERATIVE_AI_API_KEY. It is unset or still the placeholder, ` +
        'so the AI path is off. The deterministic paths — PDF parsing, keyword search, ' +
        'rule-based classification — all work without it.',
    )
    this.name = 'AiDisabledError'
  }
}

export function requireAi(what: string): void {
  if (!aiEnabled()) throw new AiDisabledError(what)
}

export interface ModelChoice {
  fast: string
  strong: string
  embedding: string
  embeddingDim: number
}

export function models(): ModelChoice {
  const env = serverEnv()
  return {
    fast: env.GEMINI_MODEL_FAST,
    strong: env.GEMINI_MODEL_STRONG,
    embedding: env.GEMINI_EMBEDDING_MODEL,
    embeddingDim: env.EMBEDDING_DIM,
  }
}

/** Stable identity for a prompt version, so a row in `ai_calls` is traceable to what produced it. */
export function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16)
}

export interface AiCallRecord {
  purpose: AiPurpose
  model: string
  promptHash?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  latencyMs: number
  costUsd?: number | null
  success: boolean
  error?: string | null
}

/**
 * Writes one telemetry row. Deliberately swallows its own failures: losing a
 * metric must never fail the user's request. Uses the service client because
 * `ai_calls` has no INSERT policy — reads are restricted to ADMIN and CTA
 * Management, and nothing but this function writes.
 */
export async function recordAiCall(record: AiCallRecord): Promise<void> {
  try {
    const { error } = await createServiceClient()
      .from('ai_calls')
      .insert({
        purpose: record.purpose,
        model: record.model,
        prompt_hash: record.promptHash ?? null,
        input_tokens: record.inputTokens ?? null,
        output_tokens: record.outputTokens ?? null,
        latency_ms: record.latencyMs,
        cost_usd: record.costUsd ?? null,
        success: record.success,
        error: record.error ?? null,
      })
    if (error) log.warn('ai.telemetry_write_failed', { purpose: record.purpose }, error)
  } catch (err) {
    log.warn('ai.telemetry_write_failed', { purpose: record.purpose }, err)
  }
}

/**
 * Price per million tokens, read from the environment rather than hard-coded.
 *
 * Published rates change, and a stale constant would put a wrong number on a
 * slide that claims to be measured. Unset means `cost_usd` stays null: an
 * absent cost is honest, an invented one is not.
 */
export function costUsd(purpose: AiPurpose, tokens: number | null | undefined): number | null {
  if (tokens == null) return null
  const key = `AI_USD_PER_MTOK_${purpose}`
  const raw = process.env[key]
  if (!raw) return null
  const rate = Number(raw)
  if (!Number.isFinite(rate) || rate < 0) {
    log.warn('ai.bad_price_env', { key, raw })
    return null
  }
  return (tokens / 1_000_000) * rate
}
