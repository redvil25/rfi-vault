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

/**
 * True only when a real Gemini key is present. Every AI code path must check
 * this and degrade to the deterministic path rather than throwing.
 */
export function aiEnabled(): boolean {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  return Boolean(key && key !== PLACEHOLDER && key.length > 20)
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
