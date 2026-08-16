/**
 * Sliding-window rate limiter.
 *
 * IMPORTANT — this is in-memory and therefore PER INSTANCE. Behind more than
 * one server process it allows roughly `limit × instances`. That is an honest
 * prototype-grade control, not a production one: a real deployment moves this
 * to Redis or a Postgres table so the window is shared. It is here because PDF
 * parsing is CPU-bound and an unauthenticated-adjacent action with no ceiling
 * is a denial-of-service invitation.
 *
 * Keyed by user id, never by IP — every gated action already requires a signed
 * in user, and IP keying punishes shared corporate egress addresses.
 */

interface Window {
  hits: number[]
}

const windows = new Map<string, Window>()

// Bound the map so a long-running process cannot grow it without limit.
const MAX_KEYS = 5_000

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

export function rateLimit(
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
}
