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

// Declared before the server schema uses it, because these two are validated at
// module load and a blank there must fail loudly rather than silently default.

/**
 * An empty environment variable means "not set", not "zero".
 *
 * A host that stores a variable with no value hands the process an empty
 * string. `z.coerce.number()` turns that into `0`, which then fails
 * `.positive()` — so a blank numeric variable did not fall back to its
 * default, it threw, and the whole server schema failed to parse. The symptom
 * was three layers away from the cause: a feature reporting that retrieval had
 * failed, with a ZodError about an unrelated variable buried in the logs.
 *
 * Blanking a variable is how a person un-sets one in a dashboard. It has to
 * behave like absence.
 */
function blankAsUnset(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}

const optionalText = z.preprocess(blankAsUnset, z.string().optional())
const textWithDefault = (fallback: string) =>
  z.preprocess(blankAsUnset, z.string().default(fallback))

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.preprocess(blankAsUnset, z.string().min(20).optional()),
  GOOGLE_GENERATIVE_AI_API_KEY: optionalText,
  GEMINI_MODEL_FAST: textWithDefault('gemini-2.5-flash'),
  GEMINI_MODEL_STRONG: textWithDefault('gemini-2.5-pro'),
  GROQ_API_KEY: optionalText,
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
  GROQ_MODEL_FAST: textWithDefault('openai/gpt-oss-120b'),
  GROQ_MODEL_STRONG: textWithDefault('qwen/qwen3.8-27b'),
  /**
   * 768 dimensions, matching `vector(768)` in 0003_core.sql, and the reason this
   * model rather than the more common all-MiniLM-L6-v2, which is 384. A mismatch
   * is not a soft failure — Postgres rejects the insert.
   */
  /**
   * Lexical overlap below which drafting and suggestions refuse (ADR-039).
   *
   * Not the old cosine threshold under a new name. 0.62 was tuned for embedding
   * similarity, where a paraphrase scores highly; pg_trgm scores shared
   * *wording*, and the same answerable requests land between 0.36 and 1.00
   * while requests with no precedent in the corpus land at 0.00. 0.25 sits in
   * that gap with room on both sides.
   *
   * Provisional, and measurable: `npm run eval` prints the separation it was
   * chosen from, and it should be re-checked whenever the corpus changes shape.
   */
  DRAFT_LEXICAL_THRESHOLD: z.preprocess(
    blankAsUnset,
    z.coerce.number().min(0).max(1).default(0.25),
  ),
  SEED_RANDOM_SEED: z.preprocess(blankAsUnset, z.coerce.number().int().default(42)),
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

export function requireServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. It is required for seeding and ingestion.',
    )
  }
  return key
}
