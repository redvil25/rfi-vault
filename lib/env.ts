import { z } from 'zod'

/**
 * Fail fast and loudly on misconfiguration rather than at the first query.
 *
 * AI keys are deliberately optional: the manual search path, rule-based
 * classification, and the whole repository must work with no model configured.
 * `aiEnabled` is the single switch the rest of the codebase reads.
 */

const PLACEHOLDER = 'PLACEHOLDER_NOT_SET'

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
})

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  GEMINI_MODEL_FAST: z.string().default('gemini-2.5-flash'),
  GEMINI_MODEL_STRONG: z.string().default('gemini-2.5-pro'),
  GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  GROQ_API_KEY: z.string().optional(),
  /**
   * Drafting and verification. Measured, not assumed — see ADR-037.
   *
   * `gpt-oss-20b` drafted options whose stated risk was "None."; `qwen3.8-27b`
   * produced three options containing `[INSERT_REFERENCE_NUMBER]` and one whose
   * entire draft was "N/A". `gpt-oss-120b` is the one that writes text a
   * regulatory reviewer could use.
   *
   * The verifier is deliberately from a different family rather than a larger
   * member of the same one. A grader that shares the drafter's blind spots
   * agrees with it, and ADR-006 wants a check, not a chorus.
   */
  GROQ_MODEL_FAST: z.string().default('openai/gpt-oss-120b'),
  GROQ_MODEL_STRONG: z.string().default('qwen/qwen3.8-27b'),
  /**
   * 768 dimensions, matching `vector(768)` in 0003_core.sql, and the reason this
   * model rather than the more common all-MiniLM-L6-v2, which is 384. A mismatch
   * is not a soft failure — Postgres rejects the insert.
   */
  LOCAL_EMBEDDING_MODEL: z.string().default('Xenova/all-mpnet-base-v2'),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(768),
  RRF_K: z.coerce.number().int().positive().default(60),
  DRAFT_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.62),
  SEED_RANDOM_SEED: z.coerce.number().int().default(42),
})

/** Safe to read in the browser. */
export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
})

/** Server-only. Importing this from a client component is a build error. */
export function serverEnv() {
  return serverSchema.parse(process.env)
}

/** A key that is absent, empty, or still the placeholder is not a key. */
function usable(key: string | undefined): boolean {
  return Boolean(key && key !== PLACEHOLDER && key.length > 20)
}

export type GenerationProvider = 'google' | 'groq'

/**
 * Which provider serves text generation, or null when none is configured.
 *
 * Groq wins when both are present, because it is the one somebody deliberately
 * added: the Gemini variables ship with defaults and are easy to leave lying
 * around, a Groq key is not.
 */
export function generationProvider(): GenerationProvider | null {
  if (usable(process.env.GROQ_API_KEY)) return 'groq'
  if (usable(process.env.GOOGLE_GENERATIVE_AI_API_KEY)) return 'google'
  return null
}

/**
 * True when something can generate text. Every generation path must check this
 * and degrade to the deterministic path rather than throwing.
 */
export function aiEnabled(): boolean {
  return generationProvider() !== null
}

/**
 * Embeddings are a separate capability from generation, and conflating them was
 * a real bug: Groq serves no embedding model at all, so a Groq key made
 * `aiEnabled()` true while semantic retrieval remained impossible. Retrieval
 * must ask this question, not that one.
 *
 * Always true, because the local sentence-transformer fallback needs no key and
 * no network once its weights are cached (ADR-035). Kept as a function so the
 * call sites read as a capability check rather than as a constant.
 */
export function embeddingsEnabled(): boolean {
  return true
}

/** True when embeddings come from Gemini rather than from the local model. */
export function remoteEmbeddings(): boolean {
  return usable(process.env.GOOGLE_GENERATIVE_AI_API_KEY)
}

export function requireServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. It is required for seeding and ingestion.',
    )
  }
  return key
}
