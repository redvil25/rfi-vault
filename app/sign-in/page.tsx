import { SignInForm } from './sign-in-form'

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">RFI Vault</h1>
          <p className="mt-1.5 text-sm text-muted">
            EU CTR request-for-information repository
          </p>
        </div>

        <SignInForm next={next} />

        <p className="mt-10 text-xs text-muted">
          Synthetic demonstration corpus. Contains no real trial, sponsor, or
          patient data.
        </p>
      </div>
    </main>
  )
}
