import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rateLimitLocal, resetRateLimits } from './rate-limit'

describe('rateLimit', () => {
  beforeEach(() => {
    resetRateLimits()
    vi.useRealTimers()
  })

  it('allows up to the limit and then refuses', () => {
    for (let i = 0; i < 3; i++) {
      expect(rateLimitLocal('user-a', 3, 60).allowed).toBe(true)
    }
    const blocked = rateLimitLocal('user-a', 3, 60)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('counts each key independently, so one user cannot block another', () => {
    rateLimitLocal('user-a', 1, 60)
    expect(rateLimitLocal('user-a', 1, 60).allowed).toBe(false)
    expect(rateLimitLocal('user-b', 1, 60).allowed).toBe(true)
  })

  it('reports remaining allowance', () => {
    expect(rateLimitLocal('user-c', 3, 60).remaining).toBe(2)
    expect(rateLimitLocal('user-c', 3, 60).remaining).toBe(1)
    expect(rateLimitLocal('user-c', 3, 60).remaining).toBe(0)
  })

  it('lets the window slide so a blocked user recovers', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-13T10:00:00Z'))

    expect(rateLimitLocal('user-d', 2, 60).allowed).toBe(true)
    expect(rateLimitLocal('user-d', 2, 60).allowed).toBe(true)
    expect(rateLimitLocal('user-d', 2, 60).allowed).toBe(false)

    // Still inside the window.
    vi.setSystemTime(new Date('2026-08-13T10:00:30Z'))
    expect(rateLimitLocal('user-d', 2, 60).allowed).toBe(false)

    // Window has passed.
    vi.setSystemTime(new Date('2026-08-13T10:01:01Z'))
    expect(rateLimitLocal('user-d', 2, 60).allowed).toBe(true)
  })
})
