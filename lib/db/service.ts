import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { publicEnv, requireServiceRoleKey } from '@/lib/env'
import type { Database } from './types'

/**
 * BYPASSES ROW LEVEL SECURITY.
 *
 * Only for seeding, ingestion, and admin scripts. Never import this into a
 * request path that serves a user — doing so silently disables every access
 * control in 0012.
 */
export function createServiceClient() {
  // Not `import 'server-only'`: node scripts (seed, ingestion) import this module
  // legitimately, and that guard only resolves inside the Next bundler. A runtime
  // check gives the same protection where it actually matters.
  if (typeof window !== 'undefined') {
    throw new Error('createServiceClient() must never run in the browser')
  }

  return createSupabaseClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    requireServiceRoleKey(),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
