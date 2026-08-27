/**
 * Placeholder configuration for unit tests.
 *
 * lib/env.ts validates the public environment at module load and throws on a
 * miss, which is the right behaviour for the app and an obstacle for a unit
 * test: importing any server module would otherwise require real credentials on
 * every contributor's machine and in CI.
 *
 * These are syntactically valid and deliberately non-functional. Anything that
 * would actually reach Supabase or Gemini belongs in `npm run verify`, which
 * runs against a real project on purpose.
 *
 * Set before the first import so lib/env.ts sees them.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://placeholder.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'placeholder-anon-key-not-a-real-key'

// aiEnabled() must read false in tests, so any code path that forgets to guard
// on it fails loudly here rather than silently in production.
process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'PLACEHOLDER_NOT_SET'
