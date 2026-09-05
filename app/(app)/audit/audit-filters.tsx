'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import type { AuditParams } from '@/lib/audit/query'

const TEAMS: [string, string][] = [
  ['RA_CLINICAL', 'RA Clinical'],
  ['AFFILIATE', 'Affiliate'],
  ['CTA_MANAGEMENT', 'CTA Management'],
  ['EU_SUBMISSION_HUB', 'EU Submission Hub'],
  ['ADMIN', 'Admin'],
]

const ENTITY_TYPES: [string, string][] = [
  ['rfi_document', 'RFI document'],
  ['rfi_consideration', 'Consideration'],
  ['precheck_run', 'Clinical report check'],
  ['suggestion_run', 'Suggestion run'],
  ['corpus', 'Corpus'],
]

export function AuditFilters({
  actions,
  active,
}: {
  actions: string[]
  active: AuditParams
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [, startTransition] = useTransition()

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    // Any filter change invalidates the page number.
    next.delete('page')
    startTransition(() => router.push(`/audit?${next.toString()}`))
  }

  const selects: { key: string; label: string; options: [string, string][] }[] = [
    {
      key: 'action',
      label: 'Action',
      options: actions.map((a) => [a, a.replaceAll('_', ' ').toLowerCase()]),
    },
    { key: 'entityType', label: 'Record type', options: ENTITY_TYPES },
    { key: 'team', label: 'Team', options: TEAMS },
  ]

  const hasFilters = Boolean(active.action || active.entityType || active.team)

  return (
    <div className="flex flex-wrap items-end gap-3">
      {selects.map((s) => {
        if (s.options.length === 0) return null
        const current = (active as unknown as Record<string, string | undefined>)[s.key] ?? ''
        return (
          <div key={s.key} className="min-w-0">
            <label
              htmlFor={`a-${s.key}`}
              className="mb-1 block text-[11px] font-medium tracking-wide text-muted uppercase"
            >
              {s.label}
            </label>
            <select
              id={`a-${s.key}`}
              value={current}
              onChange={(e) => set(s.key, e.target.value)}
              className="max-w-52 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm"
            >
              <option value="">Any</option>
              {s.options.map(([v, l]) => (
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
          onClick={() => startTransition(() => router.push('/audit'))}
          className="pb-1.5 text-sm text-accent hover:underline"
        >
          Reset filters
        </button>
      )}
    </div>
  )
}
