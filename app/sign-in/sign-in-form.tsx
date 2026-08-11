'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { signIn, type SignInState } from './actions'

const DEMO_ACCOUNTS = [
  { email: 'hub@rfivault.demo', label: 'EU Submission Hub', who: 'Priya Raman' },
  { email: 'affiliate.it@rfivault.demo', label: 'Affiliate — Italy', who: 'Marco Bianchi' },
  { email: 'ra.clinical@rfivault.demo', label: 'RA Clinical', who: 'Anna Petersen' },
  { email: 'cta.mgmt@rfivault.demo', label: 'CTA Management', who: 'Jonas Holm' },
]

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  )
}

export function SignInForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState<SignInState, FormData>(signIn, {})

  return (
    <div className="w-full max-w-sm">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next ?? ''} />

        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="username"
            defaultValue="hub@rfivault.demo"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            defaultValue="RfiVault!Demo2026"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
          />
        </div>

        {state.error && (
          <p role="alert" className="rounded-md bg-risk-soft px-3 py-2 text-sm text-risk">
            {state.error}
          </p>
        )}

        <Submit />
      </form>

      <div className="mt-8 border-t border-border pt-5">
        <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
          Demo accounts
        </p>
        <ul className="space-y-1.5 text-xs text-muted">
          {DEMO_ACCOUNTS.map((a) => (
            <li key={a.email} className="flex justify-between gap-3">
              <span>{a.label}</span>
              <code className="text-[11px]">{a.email}</code>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">
          All accounts share the password shown above. Each sees a different slice
          of the repository — that is the row-level security model, not a UI filter.
        </p>
      </div>
    </div>
  )
}
