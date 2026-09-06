import { createHash } from 'node:crypto'
import { google } from '@ai-sdk/google'
import { createGroq } from '@ai-sdk/groq'
import type { LanguageModel } from 'ai'
import { createServiceClient } from '@/lib/db/service'
import { aiEnabled, generationProvider, serverEnv } from '@/lib/env'
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

export type AiPurpose =
  | 'EMBED'
  | 'EXTRACT'
  | 'DRAFT'
  | 'SUGGEST'
  | 'COMPLETENESS'
  | 'REVIEW'
  | 'VERIFY'
  | 'RERANK'

export class AiDisabledError extends Error {
  constructor(what: string) {
    super(
      `${what} needs a text-generation key: either GROQ_API_KEY or ` +
        'GOOGLE_GENERATIVE_AI_API_KEY. Neither is set, or both are still the placeholder, ' +
        'so the generation path is off. Everything else still works and needs no key at ' +
        'all: PDF parsing, rule-based classification, search, the Clinical Report Check, ' +
        'and precedent retrieval with its confidence gate, which is lexical since ADR-039.',
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
}

/** Model names for whichever provider is configured. */
export function models(): ModelChoice {
  const env = serverEnv()
  const groq = generationProvider() === 'groq'
  return {
    fast: groq ? env.GROQ_MODEL_FAST : env.GEMINI_MODEL_FAST,
    strong: groq ? env.GROQ_MODEL_STRONG : env.GEMINI_MODEL_STRONG,
  }
}

/**
 * The language model for a call, from whichever provider is configured.
 *
 * Every `generateObject` in the codebase resolves its model through here, so
 * changing provider stays the one-file change ADR-012 promised. The Groq client
 * is constructed per call rather than at module load: the key is read from the
 * environment at request time, and a module-level client captures whatever was
 * set when the file was first imported.
 */
export function languageModel(name: string): LanguageModel {
  if (generationProvider() === 'groq') {
    return createGroq({ apiKey: process.env.GROQ_API_KEY })(name)
  }
  return google(name)
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
