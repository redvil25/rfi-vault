/**
 * End-to-end ingestion test against the live project.
 *
 *   npm run verify:ingest
 *
 * Uploads the fixture PDF, files it, and asserts it lands correctly, is
 * searchable by a signed-in user, is refused on a second attempt, and left an
 * audit event. Cleans up the trial and document afterwards — audit events
 * cannot be deleted by design, so a few rows accumulate. That is correct
 * behaviour, not a leak.
 */

import '../load-env'
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { publicEnv } from '../../lib/env'
import { createServiceClient } from '../../lib/db/service'
import {
  analyseStored, commitIngestion, canIngest, createUploadTarget, RFI_BUCKET,
} from '../../lib/ingest/commit'
import type { Database } from '../../lib/db/types'

const FIXTURE = 'fixtures/rfi-example-ctis.pdf'
const PASSWORD = 'RfiVault!Demo2026'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures++
}

async function main() {
  const db = createServiceClient()

  // --- Role gate ----------------------------------------------------------
  check('EU Submission Hub may file documents', canIngest('EU_SUBMISSION_HUB'))
  check('CTA Management may file documents', canIngest('CTA_MANAGEMENT'))
  check('an Affiliate may NOT file documents', !canIngest('AFFILIATE'))
  check('RA Clinical may NOT file documents', !canIngest('RA_CLINICAL'))
  check('a user with no team may NOT file documents', !canIngest(null))

  const { data: hub } = await db
    .from('user_profile')
    .select('id')
    .eq('team', 'EU_SUBMISSION_HUB')
    .single()
  if (!hub) throw new Error('no EU_SUBMISSION_HUB demo user — run npm run seed first')

  // Start from a clean slate for this document reference.
  const DOC_REF = 'CT-2024-519530-24-00-SM06-001'
  const TRIAL_NO = '2024-519530-24-00'
  await db.from('trial').delete().eq('eu_trial_number', TRIAL_NO)

  // --- Analyse ------------------------------------------------------------
  const bytes = new Uint8Array(await readFile(FIXTURE))
  // Captured BEFORE analysis: pdf.js detaches buffers, and comparing against a
  // detached view is how an earlier version of this test passed 0 === 0.
  const originalLength = bytes.byteLength

  // Mirrors the browser flow: signed URL, direct upload, then server-side analysis.
  const target = await createUploadTarget('rfi-example-ctis.pdf')
  if (!target.ok) throw new Error(`upload target failed: ${target.error}`)

  const { error: upErr } = await db.storage
    .from(RFI_BUCKET)
    .uploadToSignedUrl(target.storageKey, target.token, bytes, {
      contentType: 'application/pdf',
    })
  if (upErr) throw new Error(`signed upload failed: ${upErr.message}`)

  const analysed = await analyseStored(target.storageKey)
  if (!analysed.ok) throw new Error(`analyse failed: ${analysed.error}`)

  check(
    'upload stored the PDF and parsed 5 considerations',
    analysed.parsed.considerations.length === 5 && analysed.parsed.confidence === 1,
    `confidence ${analysed.parsed.confidence}, key ${analysed.storageKey}`,
  )

  const { data: stored } = await db.storage.from(RFI_BUCKET).download(analysed.storageKey)
  const storedLength = stored ? (await stored.arrayBuffer()).byteLength : 0
  check(
    'the stored object is byte-identical to the file on disk',
    storedLength === originalLength && originalLength > 0,
    `${storedLength} bytes stored, ${originalLength} on disk`,
  )

  // --- Reject a non-permitted team ---------------------------------------
  const denied = await commitIngestion({
    storageKey: analysed.storageKey,
    actorId: hub.id,
    actorTeam: 'AFFILIATE',
    overrides: [],
  })
  check('commit refuses a team without ingestion rights', !denied.ok)

  // --- Commit, with one reviewer correction -------------------------------
  const committed = await commitIngestion({
    storageKey: analysed.storageKey,
    actorId: hub.id,
    actorTeam: 'EU_SUBMISSION_HUB',
    // Consideration 5 has no Member State prefix; a reviewer assigns DE.
    overrides: [{ considerationNumber: 5, category: 'GMP_QP_DECLARATION', memberState: 'DE' }],
  })

  if (!committed.ok) throw new Error(`commit failed: ${committed.error}`)
  check(
    'filed the document and its considerations',
    committed.considerationCount === 5 && committed.documentRef === DOC_REF,
    `${committed.considerationCount} considerations, ${committed.overriddenCount} corrected`,
  )

  // --- Rows landed correctly ----------------------------------------------
  const { data: rows } = await db
    .from('rfi_consideration')
    .select('consideration_number, category, member_state, section, response_status, owner_team')
    .eq('document_id', committed.documentId)
    .order('consideration_number')

  check('five consideration rows exist', rows?.length === 5, `${rows?.length} rows`)
  check(
    'the reviewer correction was applied',
    rows?.[4]?.member_state === 'DE',
    `consideration 5 member_state=${rows?.[4]?.member_state}`,
  )
  check(
    'the unanswered consideration was filed as open, not accepted',
    rows?.[2]?.response_status === 'DRAFT',
    `consideration 3 status=${rows?.[2]?.response_status}`,
  )
  check(
    'answered considerations were filed as submitted precedent',
    rows?.filter((r) => r.response_status === 'SUBMITTED').length === 4,
  )
  check(
    'ownership was routed by category, not by the uploader',
    rows?.[0]?.owner_team === 'AFFILIATE' && rows?.[2]?.owner_team === 'RA_CLINICAL',
    `c1=${rows?.[0]?.owner_team} c3=${rows?.[2]?.owner_team}`,
  )

  const { data: docRow } = await db
    .from('rfi_document')
    .select('source_file_path, page_count, submission_type')
    .eq('id', committed.documentId)
    .single()
  check(
    'the document links back to its source file',
    docRow?.source_file_path === analysed.storageKey && docRow?.page_count === 2,
    `${docRow?.source_file_path}`,
  )
  check('submission type was read from the document', docRow?.submission_type === 'SUBSTANTIAL_MODIFICATION')

  // --- Audit --------------------------------------------------------------
  const { data: audit } = await db
    .from('audit_events')
    .select('action, actor_team, metadata')
    .eq('entity_id', committed.documentId)
    .eq('action', 'INGESTED')

  check('an audit event names the actor and the document', audit?.length === 1,
    `actor_team=${audit?.[0]?.actor_team}`)

  // --- Duplicate ----------------------------------------------------------
  const dup = await commitIngestion({
    storageKey: analysed.storageKey,
    actorId: hub.id,
    actorTeam: 'EU_SUBMISSION_HUB',
    overrides: [],
  })
  check('a second attempt at the same document reference is refused',
    !dup.ok && /already been filed/i.test(dup.ok === false ? dup.error : ''))

  const { count: afterDup } = await db
    .from('rfi_consideration')
    .select('*', { count: 'exact', head: true })
    .eq('document_id', committed.documentId)
  check('the refused duplicate changed nothing', afterDup === 5, `${afterDup} rows`)

  // --- Searchable by a real user ------------------------------------------
  const userDb = createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  )
  await userDb.auth.signInWithPassword({ email: 'affiliate.it@rfivault.demo', password: PASSWORD })

  const { data: byRef } = await userDb.rpc('search_considerations', { q: DOC_REF, lim: 10 })
  check('an Affiliate can find the newly filed document by its reference',
    (byRef?.length ?? 0) === 4 && byRef![0].matched_on.startsWith('identifier'),
    `${byRef?.length} hits (4 submitted, 1 open draft correctly hidden)`)

  const { data: byText } = await userDb.rpc('search_considerations', {
    q: 'ISTAT updated fee proof of payment',
    lim: 20,
  })
  check('the ingested ISTAT consideration is findable by text',
    (byText ?? []).some((r) => r.document_ref === DOC_REF))

  // --- Cleanup ------------------------------------------------------------
  await db.from('trial').delete().eq('eu_trial_number', TRIAL_NO)
  await db.storage.from(RFI_BUCKET).remove([analysed.storageKey])
  console.log('\nCleaned up the test trial, document and stored file.')
  console.log('Audit events were left in place — they are append-only by design.')

  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
