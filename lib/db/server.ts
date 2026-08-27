import 'server-only'

import { cache } from 'react'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { publicEnv } from '@/lib/env'
import { log } from '@/lib/log'
import type { Database } from './types'

/**
 * Request-scoped client carrying the signed-in user's session, so every query
 * is evaluated under that user's RLS policies. This is the client all
 * application code should use — never the service-role one.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // proxy.ts refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  )
}

export interface CurrentUser {
  id: string
  email: string
  fullName: string
  team: Database['public']['Enums']['team_role'] | null
  memberState: string | null
}

/**
 * The signed-in user plus their team, or null.
 *
 * Wrapped in React's `cache()` so the layout and the page it renders share one
 * result. Without it every route paid two auth round trips plus two profile
 * queries per navigation — the layout calls this, and so does each page — and
 * the duplicate refreshes were part of what made the auth server return 409
 * "too many concurrent token refresh requests" under a normal page load.
 *
 * The cache is per-request, not global: React clears it between requests, so
 * one user's profile can never be served to another.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient()

  let userId: string | null = null
  let email = ''
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()
    if (error || !user) return null
    userId = user.id
    email = user.email ?? ''
  } catch (error) {
    // A refresh that loses a race, or a token rejected for clock skew, means
    // "not signed in right now" — not a crashed request.
    log.warn('auth.get_user_failed', {}, error)
    return null
  }

  const { data: profile } = await supabase
    .from('user_profile')
    .select('full_name, team, member_state')
    .eq('id', userId)
    .maybeSingle()

  return {
    id: userId,
    email,
    fullName: profile?.full_name ?? email ?? 'Unknown',
    team: profile?.team ?? null,
    memberState: profile?.member_state ?? null,
  }
})
