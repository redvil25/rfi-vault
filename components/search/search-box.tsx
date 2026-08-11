'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'

const EXAMPLES = [
  'proof of payment ISTAT updated fee',
  'informed consent not in local language',
  'QP declaration does not cover manufacturing site',
]

export function SearchBox({ initialQuery }: { initialQuery: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const [value, setValue] = useState(initialQuery)
  const [pending, startTransition] = useTransition()

  function run(q: string) {
    const next = new URLSearchParams(params.toString())
    if (q.trim()) next.set('q', q.trim())
    else next.delete('q')
    next.delete('page')
    startTransition(() => router.push(`/search?${next.toString()}`))
  }

  return (
    <div>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          run(value)
        }}
        className="flex gap-2"
      >
        <label htmlFor="q" className="sr-only">
          Search considerations and approved responses
        </label>
        <input
          id="q"
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Describe the issue, or paste a document reference…"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3.5 py-2.5 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Searching…' : 'Search'}
        </button>
        {initialQuery && (
          <button
            type="button"
            onClick={() => {
              setValue('')
              run('')
            }}
            className="rounded-md border border-border px-3 py-2.5 text-sm text-muted hover:bg-surface"
          >
            Clear
          </button>
        )}
      </form>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
        <span>Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              setValue(ex)
              run(ex)
            }}
            className="rounded-full border border-border bg-surface px-2.5 py-1 hover:bg-accent-soft"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  )
}
