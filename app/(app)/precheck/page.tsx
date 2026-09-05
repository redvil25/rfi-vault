import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/db/server'
import { ALL_SECTIONS, MEMBER_STATES } from '@/lib/domain/taxonomy'
import { PrecheckClient } from './precheck-client'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Pre-submission check · RFI Vault',
}

export default async function PrecheckPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in')

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-xl font-semibold tracking-tight">Pre-submission check</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Paste the text of an application section before you file it. The check reads the wording
        for gaps the writer has already admitted, and mines this repository for what this Member
        State actually asks about that section. Every flag arrives with the past request behind
        it and the response that closed it.
      </p>

      <PrecheckClient
        sections={[...ALL_SECTIONS]}
        memberStates={MEMBER_STATES.map((m) => ({ code: m.code, name: m.name }))}
        defaultMemberState={user.memberState}
      />
    </div>
  )
}
