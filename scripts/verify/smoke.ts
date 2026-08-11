/**
 * End-to-end smoke test against the live database, as real signed-in users.
 *
 *   npm run verify
 *
 * Covers what unit tests cannot: that Row Level Security actually isolates
 * teams, that the search RPCs behave under a user session rather than the
 * service role, and that the audit trail is genuinely immutable. Run this
 * before every demo.
 */

import '../load-env'
import { createClient } from '@supabase/supabase-js'
import { publicEnv } from '../../lib/env'
import { createServiceClient } from '../../lib/db/service'
import type { Database } from '../../lib/db/types'

const PASSWORD = 'RfiVault!Demo2026'

let failures = 0

function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures++
}

async function signedInAs(email: string) {
  const db = createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { error } = await db.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return db
}

async function main() {
  console.log('Verifying against', publicEnv.NEXT_PUBLIC_SUPABASE_URL, '\n')

  // --- Anonymous access must reveal nothing -------------------------------
  const anon = createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  )
  const { data: anonRows } = await anon.from('rfi_consideration').select('id').limit(5)
  check(
    'anonymous callers read nothing from the repository',
    (anonRows?.length ?? 0) === 0,
    `${anonRows?.length ?? 0} rows visible`,
  )

  // --- Signed-in search ---------------------------------------------------
  const hub = await signedInAs('hub@rfivault.demo')

  const { data: textHits, error: textErr } = await hub.rpc('search_considerations', {
    q: 'proof of payment updated fee',
    lim: 10,
  })
  check(
    'text search returns results',
    !textErr && (textHits?.length ?? 0) > 0,
    textErr?.message ?? `${textHits?.length} hits, ${textHits?.[0]?.total_count} total`,
  )

  const ref = textHits?.[0]?.document_ref
  if (ref) {
    const { data: idHits } = await hub.rpc('search_considerations', { q: ref, lim: 5 })
    check(
      'identifier search finds the exact document and outranks text matches',
      (idHits?.length ?? 0) > 0 && idHits![0].matched_on.startsWith('identifier'),
      `matched_on=${idHits?.[0]?.matched_on} rank=${idHits?.[0]?.rank}`,
    )
  }

  const { data: filtered } = await hub.rpc('search_considerations', {
    q: 'fee',
    f_member_state: 'IT',
    lim: 50,
  })
  check(
    'member state filter is honoured',
    (filtered?.length ?? 0) > 0 && filtered!.every((r) => r.member_state === 'IT'),
    `${filtered?.length} hits, all IT`,
  )

  const { data: facets } = await hub.rpc('search_facets', {})
  check('facets return counts', (facets?.length ?? 0) > 0, `${facets?.length} facet rows`)

  // --- RLS isolation ------------------------------------------------------
  const affiliate = await signedInAs('affiliate.it@rfivault.demo')

  const { data: affiliateWip } = await affiliate
    .from('rfi_consideration')
    .select('id, owner_team, response_status')
    .in('response_status', ['DRAFT', 'IN_REVIEW'])
    .limit(200)

  const foreignWip = (affiliateWip ?? []).filter((r) => r.owner_team !== 'AFFILIATE')
  check(
    'an Affiliate cannot read another team\'s work in progress',
    foreignWip.length === 0,
    `${foreignWip.length} foreign draft/in-review rows visible`,
  )

  const { data: sharedForAffiliate } = await affiliate
    .from('rfi_consideration')
    .select('id')
    .in('response_status', ['APPROVED', 'SUBMITTED'])
    .limit(5)
  check(
    'approved knowledge is shared across teams',
    (sharedForAffiliate?.length ?? 0) > 0,
    `${sharedForAffiliate?.length} approved rows visible`,
  )

  const { data: aiCalls } = await affiliate.from('ai_calls').select('id').limit(1)
  check(
    'an Affiliate cannot read cost telemetry',
    (aiCalls?.length ?? 0) === 0,
  )

  // --- Audit immutability -------------------------------------------------
  // Two independent layers, and they fail differently, so both are asserted.
  //
  // Layer 1 (RLS): there is no UPDATE or DELETE policy on audit_events, so a
  // normal user's statement matches zero rows. PostgREST reports success with
  // nothing changed — absence of an error here is NOT evidence of protection,
  // so this asserts the row count instead.
  const service = createServiceClient()
  const countRows = async () => {
    const { count } = await service
      .from('audit_events')
      .select('*', { count: 'exact', head: true })
    return count ?? 0
  }

  const before = await countRows()
  await hub.from('audit_events').update({ action: 'TAMPERED' }).neq('id', 0)
  await hub.from('audit_events').delete().neq('id', 0)
  const after = await countRows()

  const { data: tampered } = await service
    .from('audit_events')
    .select('id')
    .eq('action', 'TAMPERED')
    .limit(1)

  check(
    'RLS: a normal user cannot modify or remove audit rows',
    after === before && (tampered?.length ?? 0) === 0,
    `${before} rows before, ${after} after`,
  )

  // Layer 2 (trigger): even with RLS bypassed, the database itself refuses.
  // This is the layer that survives a compromised service key or a direct
  // psql session, and it is the one worth demoing.
  const { error: svcUpd } = await service
    .from('audit_events')
    .update({ action: 'TAMPERED' })
    .neq('id', 0)
  const { error: svcDel } = await service.from('audit_events').delete().neq('id', 0)

  check(
    'trigger: even the service role cannot UPDATE audit rows',
    Boolean(svcUpd) && /append-only/i.test(svcUpd!.message),
    svcUpd?.message ?? 'no error raised',
  )
  check(
    'trigger: even the service role cannot DELETE audit rows',
    Boolean(svcDel) && /append-only/i.test(svcDel!.message),
    svcDel?.message ?? 'no error raised',
  )

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
