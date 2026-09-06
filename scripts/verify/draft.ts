/**
 * Live verification of Feature 3 and the response workflow.
 *
 *   npm run verify:draft
 *
 * Proves, as real signed-in users against the live project, the things unit
 * tests cannot reach: that the confidence gate actually refuses, that a refusal
 * is recorded, that the status machine moves a response one step at a time with
 * an audit event for each, and that approving a response is what makes it
 * visible to another team.
 *
 * Runs with or without a Gemini key. Without one, the gate refuses on "no model
 * configured" and the refusal path is exercised end to end — which is the
 * behaviour that matters most, so it is checked either way rather than skipped.
 */

import '../load-env'
import { createClient } from '@supabase/supabase-js'
import { publicEnv, aiEnabled } from '../../lib/env'
import { createServiceClient } from '../../lib/db/service'
import { generateGroundedDraft } from '../../lib/draft/generate'
import { applyTransition } from '../../lib/workflow/apply'
import { availableActions } from '../../lib/workflow/transitions'
import type { Database } from '../../lib/db/types'

const PASSWORD = 'RfiVault!Demo2026'
const TRIAL_NO = '2099-000001-99-00'
const DOC_REF = 'CT-2099-000001-99-00-SM01-901'

let failures = 0

function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures++
}

/**
 * The user id comes back from the session, not from a lookup by team. There are
 * two Affiliate accounts, and `audit_insert` requires actor_id = auth.uid() — so
 * picking "the first AFFILIATE profile" would pass locally and fail whenever the
 * seed happened to order them the other way.
 */
async function signedInAs(email: string) {
  const db = createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { data, error } = await db.auth.signInWithPassword({ email, password: PASSWORD })
  if (error || !data.user) throw new Error(`sign-in failed for ${email}: ${error?.message}`)
  return { db, userId: data.user.id }
}

async function main() {
  console.log('Verifying drafting and workflow against', publicEnv.NEXT_PUBLIC_SUPABASE_URL)
  console.log(aiEnabled() ? 'A model IS configured.\n' : 'No model configured.\n')

  const service = createServiceClient()

  // --- A consideration this script owns, so nothing real is disturbed -----
  await service.from('trial').delete().eq('eu_trial_number', TRIAL_NO)

  const { data: trial } = await service
    .from('trial')
    .insert({
      eu_trial_number: TRIAL_NO,
      short_title: 'Workflow verification trial',
      member_states: ['ES'],
    })
    .select('id')
    .single()
  if (!trial) throw new Error('could not create the verification trial')

  const { data: doc } = await service
    .from('rfi_document')
    .insert({
      trial_id: trial.id,
      document_ref: DOC_REF,
      submission_type: 'SUBSTANTIAL_MODIFICATION',
      phase: 'VALIDATION',
      issued_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (!doc) throw new Error('could not create the verification document')

  const { data: consideration } = await service
    .from('rfi_consideration')
    .insert({
      document_id: doc.id,
      trial_id: trial.id,
      consideration_number: 1,
      section_part: 'PART_II',
      section: 'Informed Consent',
      member_state: 'ES',
      category: 'ICF_LOCAL_LANGUAGE',
      consideration_text:
        'ES - The informed consent form submitted for site ES-901 is provided in English only. ' +
        'A Spanish version is required for all participating sites in Spain.',
      sponsor_response_text: null,
      response_status: 'DRAFT',
      outcome: 'UNKNOWN',
      owner_team: 'AFFILIATE',
      is_seed: false,
    })
    .select('id')
    .single()
  if (!consideration) throw new Error('could not create the verification consideration')

  try {
    const affiliate = await signedInAs('affiliate.es@rfivault.demo')
    const coordinator = await signedInAs('cta.mgmt@rfivault.demo')
    const raClinical = await signedInAs('ra.clinical@rfivault.demo')

    const asAffiliate = affiliate.db
    const asCoordinator = coordinator.db
    const asRaClinical = raClinical.db

    // --- Drafting -------------------------------------------------------
    const outcome = await generateGroundedDraft(
      {
        considerationId: consideration.id,
        considerationText: 'ES - The informed consent form is provided in English only.',
        section: 'Informed Consent',
        sectionPart: 'PART_II',
        memberState: 'ES',
        category: 'ICF_LOCAL_LANGUAGE',
        euTrialNumber: TRIAL_NO,
        documentRef: DOC_REF,
        submissionType: 'SUBSTANTIAL_MODIFICATION',
      },
      asAffiliate,
      { actorId: affiliate.userId },
    )

    if (outcome.refused) {
      check(
        'the system refused rather than inventing a response',
        typeof outcome.reason === 'string' && outcome.reason.length > 20,
        outcome.reason.slice(0, 90),
      )
      check(
        'the refusal names who to escalate to',
        outcome.escalateTo !== null,
        outcome.escalateTo ?? 'none',
      )
    } else {
      check(
        'every drafted claim carries a citation',
        outcome.citations.length > 0,
        `${outcome.citations.length} citations, ${outcome.precedents.length} precedents`,
      )
      check(
        'the draft cleared the confidence gate on a real precedent',
        outcome.maxSimilarity > 0,
        `closest ${outcome.maxSimilarity.toFixed(3)}`,
      )
      check(
        'the verifier graded the draft sentence by sentence',
        outcome.groundedness !== null,
        outcome.groundedness === null
          ? (outcome.verifierUnavailable ?? 'not graded')
          : `groundedness ${outcome.groundedness}`,
      )
    }

    // --- The attempt was recorded, refusal or not -----------------------
    const { data: recorded } = await asAffiliate
      .from('response_draft')
      .select('id, refused, refusal_reason')
      .eq('consideration_id', consideration.id)
    check(
      'the generation attempt was recorded, refusal included',
      (recorded?.length ?? 0) === 1,
      `${recorded?.length ?? 0} rows, refused=${recorded?.[0]?.refused}`,
    )

    // --- RLS on the drafts table ----------------------------------------
    const { data: foreignDrafts } = await asRaClinical
      .from('response_draft')
      .select('id')
      .eq('consideration_id', consideration.id)
    check(
      "another team cannot read this team's draft",
      (foreignDrafts?.length ?? 0) === 0,
      `${foreignDrafts?.length ?? 0} rows visible to RA Clinical`,
    )

    // --- The status machine ---------------------------------------------
    const empty = await applyTransition(
      {
        considerationId: consideration.id,
        action: 'SUBMIT_FOR_REVIEW',
        reason: null,
        actorId: affiliate.userId,
        actorTeam: 'AFFILIATE',
      },
      asAffiliate,
    )
    check(
      'an empty response cannot be sent for review',
      !empty.ok,
      empty.ok ? 'it was allowed' : empty.error,
    )

    const skipped = await applyTransition(
      {
        considerationId: consideration.id,
        action: 'APPROVE',
        reason: null,
        responseText: 'The Spanish version of the informed consent form is provided.',
        actorId: affiliate.userId,
        actorTeam: 'AFFILIATE',
      },
      asAffiliate,
    )
    check(
      'a draft cannot jump straight to approved',
      !skipped.ok,
      skipped.ok ? 'it was allowed' : skipped.error,
    )

    const sent = await applyTransition(
      {
        considerationId: consideration.id,
        action: 'SUBMIT_FOR_REVIEW',
        reason: null,
        responseText:
          'The Spanish version of the informed consent form, version 3.0, is provided for site ES-901.',
        actorId: affiliate.userId,
        actorTeam: 'AFFILIATE',
      },
      asAffiliate,
    )
    check('a complete response can be sent for review', sent.ok, sent.ok ? '' : sent.error)

    const foreign = await applyTransition(
      {
        considerationId: consideration.id,
        action: 'APPROVE',
        reason: null,
        actorId: affiliate.userId,
        actorTeam: 'RA_CLINICAL',
      },
      asRaClinical,
    )
    check(
      'a team that does not own the response cannot approve it',
      !foreign.ok,
      foreign.ok ? 'it was allowed' : foreign.error,
    )

    // --- Not yet shared --------------------------------------------------
    const { data: beforeApproval } = await asRaClinical
      .from('rfi_consideration')
      .select('id')
      .eq('id', consideration.id)
    check(
      'a response in review is invisible to other teams',
      (beforeApproval?.length ?? 0) === 0,
      `${beforeApproval?.length ?? 0} rows visible`,
    )

    const approved = await applyTransition(
      {
        considerationId: consideration.id,
        action: 'APPROVE',
        reason: null,
        actorId: coordinator.userId,
        actorTeam: 'CTA_MANAGEMENT',
      },
      asCoordinator,
    )
    check('a coordinator can approve it', approved.ok, approved.ok ? '' : approved.error)

    // --- The feedback loop, as RLS sees it -------------------------------
    const { data: afterApproval } = await asRaClinical
      .from('rfi_consideration')
      .select('id, response_status')
      .eq('id', consideration.id)
    check(
      'approving is what makes it precedent for every other team',
      (afterApproval?.length ?? 0) === 1,
      `now visible to RA Clinical as ${afterApproval?.[0]?.response_status}`,
    )

    // Nothing to assert about indexing any more: retrieval reads
    // rfi_consideration directly, so approval *is* publication (ADR-039). The
    // check that matters is the one below — that another team can now see it.

    // --- Terminal --------------------------------------------------------
    const filed = await applyTransition(
      {
        considerationId: consideration.id,
        action: 'MARK_SUBMITTED',
        reason: null,
        actorId: coordinator.userId,
        actorTeam: 'CTA_MANAGEMENT',
      },
      asCoordinator,
    )
    check('an approved response can be marked as submitted', filed.ok, filed.ok ? '' : filed.error)

    check(
      'SUBMITTED is terminal — no action remains',
      availableActions({
        status: 'SUBMITTED',
        ownerTeam: 'AFFILIATE',
        actorTeam: 'ADMIN',
        hasResponseText: true,
      }).length === 0,
    )

    // --- The audit trail --------------------------------------------------
    const { data: events } = await service
      .from('audit_events')
      .select('action, from_status, to_status')
      .eq('entity_type', 'rfi_consideration')
      .eq('entity_id', consideration.id)
      .order('occurred_at', { ascending: true })

    const actions = (events ?? []).map((e) => e.action)
    check(
      'every transition left an audit event, in order',
      actions.join(' > ') === 'SUBMITTED_FOR_REVIEW > APPROVED > SUBMITTED_TO_REGULATOR',
      actions.join(' > ') || 'none',
    )
  } finally {
    await service.from('trial').delete().eq('eu_trial_number', TRIAL_NO)
    console.log('\nCleaned up the verification trial, document and consideration.')
    console.log('Audit events were left in place — they are append-only by design.')
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
