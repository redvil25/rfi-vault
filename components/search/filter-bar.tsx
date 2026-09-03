'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import type { Facet } from '@/lib/search/manual'

interface Props {
  facets: Record<string, Facet[]>
  active: Record<string, string | undefined>
}

const SELECTS: {
  key: string
  label: string
  facet?: string
  options?: [string, string][]
  /**
   * Sort the facet values alphabetically instead of by count.
   *
   * Facets arrive most-frequent-first, which is right for a short list where the
   * common values are the useful ones. A protocol code is unique to one trial, so
   * every count is roughly the same and frequency order is effectively random —
   * in a list this long the only way to find a known code is alphabetically.
   */
  sortAlpha?: boolean
}[] = [
  { key: 'part', label: 'Application part', facet: 'section_part' },
  { key: 'memberState', label: 'Member State', facet: 'member_state' },
  { key: 'category', label: 'Category', facet: 'category' },
  // Labelled "Document type" at the team's request. The underlying field is the
  // CTIS application section part — see the note in docs/01-DOMAIN.md §5.
  { key: 'section', label: 'Document type', facet: 'section' },
  { key: 'therapeuticArea', label: 'Therapeutic area', facet: 'therapeutic_area' },
  { key: 'impName', label: 'IMP', facet: 'imp_name' },
  // The sponsor's own study identifier, not the EU trial number — see 0021.
  { key: 'protocolCode', label: 'Protocol code', facet: 'protocol_code', sortAlpha: true },
  {
    key: 'phase',
    label: 'Phase',
    options: [
      ['VALIDATION', 'Validation'],
      ['ASSESSMENT_PART_I', 'Assessment Part I'],
      ['ASSESSMENT_PART_II', 'Assessment Part II'],
    ],
  },
  {
    key: 'submissionType',
    label: 'Submission type',
    options: [
      ['INITIAL', 'Initial'],
      ['SUBSTANTIAL_MODIFICATION', 'Substantial modification'],
      ['ADDITIONAL_MS', 'Additional Member State'],
    ],
  },
  {
    key: 'sort',
    label: 'Sort',
    options: [
      ['relevance', 'Relevance'],
      ['newest', 'Newest first'],
      ['oldest', 'Oldest first'],
    ],
  },
]

function label(key: string, value: string) {
  if (key === 'part') return value === 'PART_I' ? 'Part I' : 'Part II'
  if (key === 'category') return value.replaceAll('_', ' ').toLowerCase()
  return value
}

export function FilterBar({ facets, active }: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const [, startTransition] = useTransition()

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('page')
    startTransition(() => router.push(`/search?${next.toString()}`))
  }

  const hasFilters = SELECTS.some((s) => s.key !== 'sort' && active[s.key])

  return (
    <div className="flex flex-wrap items-end gap-3">
      {SELECTS.map((s) => {
        const facetValues = facets[s.facet ?? ''] ?? []
        const ordered = s.sortAlpha
          ? [...facetValues].sort((a, b) => a.value.localeCompare(b.value, 'en'))
          : facetValues

        const options: [string, string][] =
          s.options ??
          ordered.map((f) => [f.value, `${label(s.key, f.value)} (${f.count})`])

        if (options.length === 0) return null

        return (
          <div key={s.key} className="min-w-0">
            <label
              htmlFor={`f-${s.key}`}
              className="mb-1 block text-[11px] font-medium tracking-wide text-muted uppercase"
            >
              {s.label}
            </label>
            <select
              id={`f-${s.key}`}
              value={active[s.key] ?? ''}
              onChange={(e) => set(s.key, e.target.value)}
              className="max-w-52 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm"
            >
              {s.key !== 'sort' && <option value="">Any</option>}
              {options.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        )
      })}

      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            const next = new URLSearchParams()
            const q = params.get('q')
            if (q) next.set('q', q)
            startTransition(() => router.push(`/search?${next.toString()}`))
          }}
          className="pb-1.5 text-sm text-accent hover:underline"
        >
          Reset filters
        </button>
      )}
    </div>
  )
}
