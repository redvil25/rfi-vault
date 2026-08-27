'use client'

import Link from 'next/link'
import { useEffect } from 'react'

/**
 * Segment error boundary.
 *
 * Before this existed, any throw in a Server Component — most often a rejected
 * session token from a lost refresh race — replaced the whole page with Next's
 * default crash screen. Next strips error messages in production and leaves
 * only `digest`, so that is what is shown: it is the key that ties this screen
 * to the server log entry.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app] segment error:', error)
  }, [error])

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="rounded-lg border border-border bg-surface px-6 py-10 text-center">
        <h1 className="text-lg font-semibold">Something went wrong on our side.</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          Nothing was changed in the repository. This is usually a session that
          expired mid-request — trying again normally resolves it.
        </p>

        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Try again
          </button>
          <Link href="/sign-in" className="px-4 py-2 text-sm text-accent hover:underline">
            Sign in again
          </Link>
        </div>

        {error.digest && (
          <p className="mt-6 border-t border-border pt-4 font-mono text-[11px] text-muted">
            reference {error.digest}
          </p>
        )}
      </div>
    </div>
  )
}
