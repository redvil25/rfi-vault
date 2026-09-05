import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/db/server'
import { signOut } from '../sign-in/actions'

const TEAM_LABELS: Record<string, string> = {
  RA_CLINICAL: 'RA Clinical',
  AFFILIATE: 'Affiliate',
  CTA_MANAGEMENT: 'CTA Management',
  EU_SUBMISSION_HUB: 'EU Submission Hub',
  ADMIN: 'Admin',
}

const NAV = [
  { href: '/search', label: 'Search', ready: true },
  { href: '/ingest', label: 'File a document', ready: true },
  { href: '/precheck', label: 'Pre-submission check', ready: true },
  { href: '/analytics', label: 'Analytics', ready: true },
  { href: '/audit', label: 'Audit trail', ready: true },
]

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/sign-in')

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface md:flex md:flex-col">
        <div className="border-b border-border px-5 py-4">
          <Link href="/search" className="text-base font-semibold tracking-tight">
            RFI Vault
          </Link>
          <p className="mt-0.5 text-[11px] text-muted">EU CTR repository</p>
        </div>

        <nav className="flex-1 px-3 py-4">
          <ul className="space-y-0.5">
            {NAV.map((item) => (
              <li key={item.href}>
                {item.ready ? (
                  <Link
                    href={item.href}
                    className="block rounded-md px-3 py-2 text-sm hover:bg-accent-soft"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span
                    className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-muted"
                    title="Not built yet"
                  >
                    {item.label}
                    <span className="text-[10px] tracking-wide uppercase">soon</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-border px-5 py-4">
          <p className="text-sm font-medium">{user.fullName}</p>
          <p className="text-xs text-muted">
            {user.team ? TEAM_LABELS[user.team] : 'No team'}
            {user.memberState ? ` · ${user.memberState}` : ''}
          </p>
          <form action={signOut}>
            <button
              type="submit"
              className="mt-2.5 text-xs text-accent hover:underline"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
