/**
 * Structured logging.
 *
 * One line of JSON per event, because the only place these are read is a host's
 * log viewer, where a grep across `console.error('[ingest] ...', err)` finds
 * nothing useful. Fields are stable so a query like `level:error event:ingest.commit`
 * works. There is no transport and no dependency — stdout is the transport, and
 * every host this app can run on collects it.
 *
 * Nothing here ever throws: a logger that can fail a request is worse than no
 * logger. Errors are reduced to name/message/stack, never spread wholesale, so
 * a Supabase error object cannot leak a connection string into the log body.
 */

export type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const MIN_LEVEL: number =
  LEVELS[(process.env.LOG_LEVEL as Level | undefined) ?? 'info'] ?? LEVELS.info

/** Values safe to serialise into a log line. */
type Scalar = string | number | boolean | null | undefined
export type Fields = Record<string, Scalar | Scalar[] | Record<string, Scalar>>

function describeError(err: unknown): Record<string, Scalar> {
  if (err instanceof Error) {
    return {
      errorName: err.name,
      errorMessage: err.message,
      // Only the frames, never the enumerable properties an SDK error may carry.
      errorStack: typeof err.stack === 'string' ? err.stack.split('\n').slice(0, 6).join('\n') : null,
    }
  }
  if (typeof err === 'string') return { errorMessage: err }
  return { errorMessage: 'non-error thrown', errorType: typeof err }
}

function emit(level: Level, event: string, fields: Fields, err?: unknown) {
  if (LEVELS[level] < MIN_LEVEL) return

  let line: string
  try {
    line = JSON.stringify({
      level,
      event,
      ts: new Date().toISOString(),
      ...fields,
      ...(err === undefined ? {} : describeError(err)),
    })
  } catch {
    // Circular or otherwise unserialisable field. Never lose the event itself.
    line = JSON.stringify({ level, event, ts: new Date().toISOString(), note: 'fields dropped: unserialisable' })
  }

  if (level === 'error' || level === 'warn') console.error(line)
  else console.log(line)
}

export const log = {
  debug: (event: string, fields: Fields = {}) => emit('debug', event, fields),
  info: (event: string, fields: Fields = {}) => emit('info', event, fields),
  warn: (event: string, fields: Fields = {}, err?: unknown) => emit('warn', event, fields, err),
  error: (event: string, fields: Fields = {}, err?: unknown) => emit('error', event, fields, err),
}

/**
 * Times an operation and logs the outcome either way. Returns whatever the
 * operation returned; re-throws whatever it threw, so it is transparent to
 * callers and cannot swallow a failure.
 */
export async function timed<T>(
  event: string,
  fields: Fields,
  fn: () => Promise<T>,
): Promise<T> {
  const started = performance.now()
  try {
    const result = await fn()
    log.info(event, { ...fields, ok: true, ms: Math.round(performance.now() - started) })
    return result
  } catch (err) {
    log.error(event, { ...fields, ok: false, ms: Math.round(performance.now() - started) }, err)
    throw err
  }
}
