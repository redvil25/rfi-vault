import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/db/server'
import { MEMBER_STATES } from '@/lib/domain/taxonomy'
import { ReportCheckClient } from './report-check-client'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Clinical Report Check · RFI Vault',
}

export default async function ReportCheckPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in')

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-xl font-semibold tracking-tight">Clinical Report Check</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Upload a clinical document before you file it. It is sectioned on its own headings, read
        for gaps the writer has already admitted, checked for values that disagree between
        sections, and compared against what these Member States have actually asked about those
        sections before. Every finding arrives with the past request behind it and the response
        that closed it. The file is deleted as soon as its text has been read.
      </p>

      <ReportCheckClient
        memberStates={MEMBER_STATES.map((m) => ({ code: m.code, name: m.name }))}
        defaultMemberState={user.memberState}
      />
    </div>
  )
}
