import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { publicEnv } from '@/lib/env'
import { log } from '@/lib/log'

// Next 16 renamed the `middleware` file convention to `proxy`. Same semantics.
// Refreshes the Supabase session cookie on every request and gates the app.

const PUBLIC_PATHS = ['/sign-in', '/auth']

/** Exact match or a sub-path — not a prefix, which would make /sign-in-anything public. */
function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/**
 * Supabase stores its session in cookies named `sb-<project-ref>-auth-token`,
 * chunked as `.0`, `.1` when large. If none are present the caller has no
 * session, and asking the auth server to confirm that costs a network round
 * trip on every request — including from crawlers and signed-out visitors
 * landing on /sign-in. Checking for the cookie first is not an authorisation
 * decision: a cookie that *is* present is still verified by getUser() below.
 */
function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isPublic = isPublicPath(pathname)

  if (!hasSessionCookie(request)) {
    if (isPublic) return NextResponse.next({ request })
    const url = request.nextUrl.clone()
    url.pathname = '/sign-in'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  // Must be getUser(), not getSession() — getSession() trusts the cookie without
  // revalidating it against the auth server.
  //
  // A page navigation fires several requests at once (document, RSC payload,
  // prefetches). When the access token has expired they all try to redeem the
  // same refresh token and the auth server rejects the losers with a 409, which
  // used to surface as a crashed page. A failed refresh is not an exception —
  // it means "not signed in right now", so it is handled as such.
  let user = null
  try {
    const result = await supabase.auth.getUser()
    user = result.data.user
  } catch (error) {
    log.warn('proxy.session_refresh_failed', { pathname }, error)
    // Fall through as unauthenticated; the redirect below is the right answer.
  }

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/sign-in'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  if (user && pathname === '/sign-in') {
    const url = request.nextUrl.clone()
    url.pathname = '/search'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation.
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
