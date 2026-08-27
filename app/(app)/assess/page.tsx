import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/db/server'
import { aiEnabled } from '@/lib/env'
import { AssessClient } from './assess-client'

export const dynamic = 'force-dynamic'

export default async function AssessPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in')

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Pre-submission check</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Scores each section of a draft application for the risk that it attracts a request
          for information — before it is submitted. The checklist is deterministic and runs
          with no model involved; similarity to past requests is layered on top where it is
          available.
        </p>
      </header>

      {!aiEnabled() && (
        <p className="mb-6 rounded-md bg-warn-soft px-3.5 py-2.5 text-sm text-warn">
          <strong className="font-medium">Checklist and history only.</strong>{' '}
          No model is configured, so sections are not compared against past requests. The
          deterministic checks below are unaffected — and scores are re-weighted across the
          signals that did run, never padded with a zero.
        </p>
      )}

      <AssessClient />
    </div>
  )
}
