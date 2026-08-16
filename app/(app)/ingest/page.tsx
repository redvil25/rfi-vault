import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/db/server'
import { canIngest } from '@/lib/ingest/commit'
import { IngestClient } from './ingest-client'

export const dynamic = 'force-dynamic'

export default async function IngestPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in')

  if (!canIngest(user.team)) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-xl font-semibold tracking-tight">File an RFI document</h1>
        <div className="mt-5 rounded-lg border border-border bg-surface px-6 py-10 text-center">
          <p className="text-sm font-medium">Your team cannot file documents.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Filing into the shared repository is done by the EU Submission Hub or CTA
            Management. You can search everything that has already been filed.
          </p>
          <Link
            href="/search"
            className="mt-5 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Go to search
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">File an RFI document</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Upload a CTIS request-for-information export — a text PDF, a scan, or a
          screenshot. Scans and images are read with OCR; fields are then extracted by a
          deterministic parser, so nothing can be invented. You review every
          consideration before anything is written to the repository.
        </p>
      </header>

      <IngestClient />
    </div>
  )
}
