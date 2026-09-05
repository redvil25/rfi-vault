import Link from 'next/link'
import { Suspense } from 'react'
import { searchFacets, searchParamsSchema } from '@/lib/search/manual'
import { hybridSearch } from '@/lib/search/hybrid'
import { SearchBox } from '@/components/search/search-box'
import { FilterBar } from '@/components/search/filter-bar'
import { ResultCard } from '@/components/search/result-card'

export const dynamic = 'force-dynamic'

type RawParams = Record<string, string | string[] | undefined>

function buildHref(raw: RawParams, page: number) {
  const next = new URLSearchParams()
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && v) next.set(k, v)
  }
  next.set('page', String(page))
  return `/search?${next.toString()}`
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>
}) {
  const raw = await searchParams

  const parsed = searchParamsSchema.safeParse(raw)
  if (!parsed.success) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-lg font-semibold">Invalid search</h1>
        <p className="mt-2 text-sm text-muted">
          {parsed.error.issues[0].path.join('.')}: {parsed.error.issues[0].message}
        </p>
        <Link href="/search" className="mt-4 inline-block text-sm text-accent hover:underline">
          Start over
        </Link>
      </div>
    )
  }

  const params = parsed.data
  const [result, facets] = await Promise.all([
    hybridSearch(params),
    searchFacets({
      q: params.q,
      part: params.part,
      memberState: params.memberState,
      therapeuticArea: params.therapeuticArea,
      impName: params.impName,
      protocolCode: params.protocolCode,
    }),
  ])

  const active: Record<string, string | undefined> = {
    part: params.part,
    memberState: params.memberState,
    category: params.category,
    section: params.section,
    therapeuticArea: params.therapeuticArea,
    impName: params.impName,
    protocolCode: params.protocolCode,
    phase: params.phase,
    submissionType: params.submissionType,
    sort: params.sort,
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Search the repository</h1>
        <p className="mt-1 text-sm text-muted">
          {result.mode === 'hybrid'
            ? 'Meaning and keywords together — semantic matches are fused with exact matching on document references and EU trial numbers.'
            : 'Full-text search across every consideration and approved sponsor response, plus exact matching on document references and EU trial numbers.'}
        </p>
      </header>

      <Suspense fallback={<div className="h-24" />}>
        <SearchBox initialQuery={params.q ?? ''} />
      </Suspense>

      {/*
        Search is running on half its machinery when there is no model. Saying
        so is the difference between "nothing matched" and "nothing was looked
        for", and the user cannot tell them apart on their own.
      */}
      {result.fellBackBecause && params.q ? (
        <p className="mt-4 rounded-md border border-border px-3.5 py-2.5 text-sm text-muted">
          <strong className="font-medium text-foreground">Keyword search only.</strong>{' '}
          Semantic matching is not running ({result.fellBackBecause}), so records that mean the
          same thing in different words will not appear here.
        </p>
      ) : null}

      <div className="mt-6 border-y border-border py-4">
        <Suspense fallback={<div className="h-14" />}>
          <FilterBar facets={facets} active={active} />
        </Suspense>
      </div>

      <div className="mt-5 mb-4 flex items-baseline justify-between text-sm">
        <p className="text-muted">
          {result.total === 0 ? (
            'No matches'
          ) : (
            <>
              <span className="font-medium text-foreground">
                {result.total.toLocaleString('en-GB')}
              </span>{' '}
              {result.total === 1 ? 'consideration' : 'considerations'}
              {params.q ? <> matching “{params.q}”</> : null}
            </>
          )}
        </p>
        <p className="text-xs text-muted">
          {result.mode === 'hybrid' ? 'semantic + keyword' : 'keyword only'} · {result.tookMs} ms
        </p>
      </div>

      {result.total === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-14 text-center">
          <p className="text-sm font-medium">Nothing matched that search.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            {result.mode === 'hybrid'
              ? 'Try fewer words, or clear the filters. Nothing in the repository matches this closely enough to show.'
              : 'Try fewer words, or clear the filters. Exact phrases only match if they appear verbatim — semantic search, which finds records that mean the same thing in different words, is not running.'}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {result.hits.map((hit) => (
              <ResultCard key={hit.id} hit={hit} query={params.q} />
            ))}
          </div>

          {result.totalPages > 1 && (
            <nav
              aria-label="Pagination"
              className="mt-6 flex items-center justify-between border-t border-border pt-4 text-sm"
            >
              {params.page > 1 ? (
                <Link href={buildHref(raw, params.page - 1)} className="text-accent hover:underline">
                  ← Previous
                </Link>
              ) : (
                <span className="text-muted">← Previous</span>
              )}

              <span className="text-muted">
                Page {result.page} of {result.totalPages}
              </span>

              {params.page < result.totalPages ? (
                <Link href={buildHref(raw, params.page + 1)} className="text-accent hover:underline">
                  Next →
                </Link>
              ) : (
                <span className="text-muted">Next →</span>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  )
}
