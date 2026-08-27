import { createServiceClient } from '@/lib/db/service'
import { log } from '@/lib/log'

/**
 * Rate limiting for the CPU-expensive actions — PDF parsing and extraction —
 * where an authenticated user with no ceiling is a denial-of-service invitation.
 *
 * Two implementations, and the distinction matters:
 *
 *   `consumeRateLimit()` is the one application code should call. It uses a
 *   sliding window in Postgres, shared by every server instance.
 *
 *   `rateLimitLocal()` is per process. Behind N instances it permits roughly
 *   `limit x N`, which is why it is not the default any more (ADR-014). It stays
 *   as the fallback for the window between deploying this code and applying
 *   0014_keyword_baseline_and_rate_limit.sql — a degraded limit is a great deal
 *   better than an ingest page that 500s.
 *
 * Keyed by user id, never by IP: every gated action already requires a signed-in
 * user, and IP keying punishes shared corporate egress addresses.
 */

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

// ------------------------------------------------------------ in-memory

interface Window {
  hits: number[]
}

const windows = new Map<string, Window>()

// Bound the map so a long-running process cannot grow it without limit.
const MAX_KEYS = 5_000

export function rateLimitLocal(
  key: string,
  limit: number,
  windowSeconds: number,
): RateLimitResult {
  const now = Date.now()
  const windowMs = windowSeconds * 1000

  if (windows.size > MAX_KEYS) {
    // Cheapest safe eviction: drop everything and let windows rebuild. Briefly
    // generous, never unbounded.
    windows.clear()
  }

  const entry = windows.get(key) ?? { hits: [] }
  entry.hits = entry.hits.filter((t) => now - t < windowMs)

  if (entry.hits.length >= limit) {
    const oldest = entry.hits[0]
    windows.set(key, entry)
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    }
  }

  entry.hits.push(now)
  windows.set(key, entry)

  return {
    allowed: true,
    remaining: limit - entry.hits.length,
    retryAfterSeconds: 0,
  }
}

/** Test seam — the limiter is module-level state. */
export function resetRateLimits() {
  windows.clear()
  warnedAboutFallback = false
}

// -------------------------------------------------------------- Postgres

let warnedAboutFallback = false

/**
 * Consumes one token from a window shared across all instances.
 *
 * Falls back to the per-process limiter if the database call fails — most
 * likely because 0014 has not been applied yet. It warns once per process
 * rather than on every request, so the signal is visible in the log without
 * burying everything else.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  try {
    const { data, error } = await createServiceClient().rpc('consume_rate_limit', {
      p_bucket: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    })

    if (error) throw new Error(error.message)

    const row = data?.[0]
    if (!row) throw new Error('consume_rate_limit returned no row')

    return {
      allowed: row.allowed,
      remaining: row.remaining,
      retryAfterSeconds: row.retry_after_seconds,
    }
  } catch (err) {
    if (!warnedAboutFallback) {
      warnedAboutFallback = true
      log.warn(
        'ratelimit.fallback_to_in_memory',
        { hint: 'apply the pending migrations, then npm run db:types' },
        err,
      )
    }
    return rateLimitLocal(key, limit, windowSeconds)
  }
}
