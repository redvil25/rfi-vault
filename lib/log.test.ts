import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { log, timed } from './log'

let out: string[]
let err: string[]

beforeEach(() => {
  out = []
  err = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => void out.push(line))
  vi.spyOn(console, 'error').mockImplementation((line: string) => void err.push(line))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('log', () => {
  it('emits one parseable JSON object per event', () => {
    log.info('search.ran', { mode: 'keyword', hits: 12 })
    expect(out).toHaveLength(1)
    const parsed = JSON.parse(out[0])
    expect(parsed).toMatchObject({ level: 'info', event: 'search.ran', mode: 'keyword', hits: 12 })
    expect(typeof parsed.ts).toBe('string')
  })

  it('sends warn and error to stderr, info to stdout', () => {
    log.info('a')
    log.warn('b')
    log.error('c')
    expect(out).toHaveLength(1)
    expect(err).toHaveLength(2)
  })

  it('drops debug below the default threshold', () => {
    log.debug('noisy')
    expect(out).toHaveLength(0)
  })

  it('reduces an Error to name, message and a trimmed stack', () => {
    log.error('ingest.failed', { stage: 'parse' }, new TypeError('bad pdf'))
    const parsed = JSON.parse(err[0])
    expect(parsed.errorName).toBe('TypeError')
    expect(parsed.errorMessage).toBe('bad pdf')
    expect(parsed.errorStack.split('\n').length).toBeLessThanOrEqual(6)
  })

  /**
   * A Supabase error object carries connection details on non-standard
   * properties. Spreading it into the log line would publish them.
   */
  it('does not copy arbitrary properties off a thrown object', () => {
    const nasty = Object.assign(new Error('boom'), { connectionString: 'postgres://user:pw@host' })
    log.error('db.failed', {}, nasty)
    expect(err[0]).not.toContain('postgres://')
  })

  it('handles a non-Error being thrown', () => {
    log.error('weird', {}, 'just a string')
    expect(JSON.parse(err[0]).errorMessage).toBe('just a string')
  })

  it('never throws on an unserialisable field', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => log.info('circular', circular as never)).not.toThrow()
    expect(JSON.parse(out[0]).note).toContain('unserialisable')
  })
})

describe('timed', () => {
  it('returns the value and logs success with a duration', async () => {
    const result = await timed('work', { id: 1 }, async () => 'value')
    expect(result).toBe('value')
    const parsed = JSON.parse(out[0])
    expect(parsed.ok).toBe(true)
    expect(typeof parsed.ms).toBe('number')
  })

  it('re-throws and logs failure rather than swallowing it', async () => {
    await expect(
      timed('work', {}, async () => {
        throw new Error('nope')
      }),
    ).rejects.toThrow('nope')
    const parsed = JSON.parse(err[0])
    expect(parsed.ok).toBe(false)
    expect(parsed.errorMessage).toBe('nope')
  })
})
