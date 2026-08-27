'use client'

import { useEffect } from 'react'

/**
 * Last-resort boundary: catches errors thrown by the root layout itself, which
 * a segment `error.tsx` cannot reach. It replaces the document, so it has to
 * render its own <html> and <body> and cannot rely on the app's stylesheet.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app] global error:', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#f7f8fa',
          color: '#14181f',
          fontFamily: 'ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial, sans-serif',
        }}
      >
        <main style={{ maxWidth: '32rem', padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>
            RFI Vault could not start.
          </h1>
          <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#5b6675' }}>
            The application failed before any page could render. Nothing was
            changed in the repository.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.5rem',
              border: 0,
              borderRadius: '0.375rem',
              background: '#1c5bd6',
              color: '#fff',
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
          {error.digest && (
            <p style={{ marginTop: '1.5rem', fontFamily: 'ui-monospace, monospace', fontSize: '11px', color: '#5b6675' }}>
              reference {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  )
}
