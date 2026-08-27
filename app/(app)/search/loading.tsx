/**
 * Streams the page shell immediately while the search RPC runs, instead of
 * holding a blank document until the database answers. The skeleton mirrors the
 * real layout so nothing jumps when results replace it.
 */
export default function SearchLoading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Searching the repository…</span>

      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Search the repository</h1>
        <p className="mt-1 text-sm text-muted">
          Full-text search across every consideration and approved sponsor response,
          plus exact matching on document references and EU trial numbers.
        </p>
      </header>

      <div className="h-11 animate-pulse rounded-md bg-surface" />

      <div className="mt-6 border-y border-border py-4">
        <div className="flex gap-2">
          {[80, 110, 96, 72].map((w, i) => (
            <div
              key={i}
              className="h-8 animate-pulse rounded-md bg-surface"
              style={{ width: w }}
            />
          ))}
        </div>
      </div>

      <div className="mt-5 mb-4 h-5 w-40 animate-pulse rounded bg-surface" />

      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-4">
            <div className="h-3 w-52 animate-pulse rounded bg-background" />
            <div className="mt-3 space-y-2">
              <div className="h-3 w-full animate-pulse rounded bg-background" />
              <div className="h-3 w-11/12 animate-pulse rounded bg-background" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-background" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
