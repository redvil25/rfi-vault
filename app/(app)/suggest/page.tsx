import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/db/server'
import { aiEnabled } from '@/lib/env'
import { ALL_SECTIONS } from '@/lib/domain/taxonomy'
import { SuggestClient } from './suggest-client'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Suggestions · RFI Vault',
}

export default async function SuggestPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in')

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-xl font-semibold tracking-tight">Suggestions</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Upload a request for information that has just arrived, as a PDF. The repository is searched for
        precedent in the same application section, and up to three options are proposed — each
        taking a different approach, each cited to the records it was built from. If no precedent
        is close enough, nothing is drafted and the request is escalated instead.
      </p>

      {!aiEnabled() && (
        <p className="mt-4 rounded-md border border-border px-3.5 py-2.5 text-sm text-muted">
          <strong className="font-medium text-foreground">No model is configured.</strong>{' '}
          Suggestions need one, and semantic retrieval needs one to measure whether any precedent
          is close enough to answer from. Running it now will refuse, and say so — it will not
          fall back to keyword matches and present them as evidence.
        </p>
      )}

      <SuggestClient sections={[...ALL_SECTIONS]} />
    </div>
  )
}
