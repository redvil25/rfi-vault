import { afterEach, describe, expect, it } from 'vitest'
import { serverEnv } from './env'

/**
 * A blank environment variable is how a person un-sets one in a dashboard, and
 * it reached this schema as an empty string. `z.coerce.number()` turned that
 * into 0, `.positive()` rejected it, and the whole server schema failed to
 * parse — three layers from where it surfaced, as "embedding the query failed"
 * on the live search page.
 */

const KEYS = [
  'EMBEDDING_DIM',
  'RRF_K',
  'DRAFT_SIMILARITY_THRESHOLD',
  'SEED_RANDOM_SEED',
  'GROQ_MODEL_FAST',
  'GROQ_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'LOCAL_EMBEDDING_MODEL',
] as const

const saved = new Map<string, string | undefined>()

function set(key: string, value: string | undefined) {
  if (!saved.has(key)) saved.set(key, process.env[key])
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  saved.clear()
})

describe('a blank variable is the same as an unset one', () => {
  it.each(KEYS)('does not throw when %s is blank', (key) => {
    set(key, '')
    expect(() => serverEnv()).not.toThrow()
  })

  it('falls back to the documented defaults rather than to zero', () => {
    set('EMBEDDING_DIM', '')
    set('RRF_K', '')
    set('DRAFT_SIMILARITY_THRESHOLD', '')
    const env = serverEnv()
    // 768 matches vector(768) in 0003_core.sql; a 0 here is not a smaller
    // vector, it is a schema that refuses to parse at all.
    expect(env.EMBEDDING_DIM).toBe(768)
    expect(env.RRF_K).toBe(60)
    expect(env.DRAFT_SIMILARITY_THRESHOLD).toBeCloseTo(0.62)
  })

  it('falls back for blank model names too', () => {
    set('GROQ_MODEL_FAST', '   ')
    expect(serverEnv().GROQ_MODEL_FAST).toBe('openai/gpt-oss-120b')
  })

  it('treats a blank key as no key, not as a key of length zero', () => {
    set('GROQ_API_KEY', '')
    set('GOOGLE_GENERATIVE_AI_API_KEY', '')
    expect(serverEnv().GROQ_API_KEY).toBeUndefined()
    expect(serverEnv().GOOGLE_GENERATIVE_AI_API_KEY).toBeUndefined()
  })

  it('still honours a real value', () => {
    set('EMBEDDING_DIM', '384')
    set('RRF_K', '20')
    expect(serverEnv().EMBEDDING_DIM).toBe(384)
    expect(serverEnv().RRF_K).toBe(20)
  })

  it('still rejects a value that is present and wrong', () => {
    set('EMBEDDING_DIM', '-1')
    expect(() => serverEnv()).toThrow()
    set('EMBEDDING_DIM', 'not a number')
    expect(() => serverEnv()).toThrow()
  })
})
