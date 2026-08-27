import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <h1 className="text-lg font-semibold">That page does not exist.</h1>
      <p className="mt-2 text-sm text-muted">
        The link may be out of date, or the record may have been filed under a
        different reference.
      </p>
      <Link
        href="/search"
        className="mt-6 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        Search the repository
      </Link>
    </div>
  )
}
