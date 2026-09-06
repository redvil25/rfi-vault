import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { log } from '@/lib/log'
import { TRANSITIONS, blockedBecause, type WorkflowAction } from './transitions'

type TeamRole = Database['public']['Enums']['team_role']

export interface ApplyInput {
  considerationId: string
  action: WorkflowAction
  reason: string | null
  /** Optional edit made by the reviewer at the same time as the transition. */
  responseText?: string
  actorId: string
  actorTeam: TeamRole | null
}

export type ApplyResult =
  | { ok: true; from: string; to: string }
  | { ok: false; error: string }

/**
 * Applies one status transition.
 *
 * Runs through the CALLER'S client, not the service role. That is deliberate:
 * `write_own_team` in 0012 is the authorisation, and routing this through the
 * service client would bypass the policy and leave the team check living only in
 * TypeScript. The pure rules in ./transitions.ts are checked first so the user
 * gets a sentence rather than a policy violation, but the database has the last
 * word either way.
 */
export async function applyTransition(
  input: ApplyInput,
  supabase: SupabaseClient<Database>,
): Promise<ApplyResult> {
  const rule = TRANSITIONS[input.action]
  if (!rule) return { ok: false, error: 'Unknown action.' }

  // Read the row as it is now. The status the browser was showing may be stale —
  // two reviewers on the same consideration is the ordinary case, not the edge.
  const { data: current, error: readError } = await supabase
    .from('rfi_consideration')
    .select('id, response_status, owner_team, sponsor_response_text, consideration_text')
    .eq('id', input.considerationId)
    .maybeSingle()

  if (readError) {
    log.error('workflow.read_failed', { considerationId: input.considerationId }, readError)
    return { ok: false, error: 'That response could not be read.' }
  }
  if (!current) {
    return { ok: false, error: 'That response does not exist, or you cannot see it.' }
  }

  const nextText = input.responseText?.trim() || current.sponsor_response_text?.trim() || ''

  const blocked = blockedBecause(input.action, {
    status: current.response_status,
    ownerTeam: current.owner_team,
    actorTeam: input.actorTeam,
    hasResponseText: nextText.length > 0,
  })
  if (blocked) return { ok: false, error: blocked }

  if (rule.requiresReason && !input.reason?.trim()) {
    return { ok: false, error: 'Say what needs to change. A reason is recorded in the audit trail.' }
  }

  // --- Move it -----------------------------------------------------------
  const update: Database['public']['Tables']['rfi_consideration']['Update'] = {
    response_status: rule.to,
  }
  if (input.responseText !== undefined) update.sponsor_response_text = nextText

  const { data: moved, error: updateError } = await supabase
    .from('rfi_consideration')
    .update(update)
    .eq('id', input.considerationId)
    // Optimistic concurrency: if someone else moved it since the read above,
    // this matches nothing and the second reviewer is told rather than silently
    // overwriting the first.
    .eq('response_status', current.response_status)
    .select('id')
    .maybeSingle()

  if (updateError) {
    log.error('workflow.update_failed', { considerationId: input.considerationId }, updateError)
    return { ok: false, error: 'The status could not be changed. Nothing was altered.' }
  }
  if (!moved) {
    return {
      ok: false,
      error: 'Someone else changed this response a moment ago. Reload and look again.',
    }
  }

  // --- Audit -------------------------------------------------------------
  //
  // Emitted through the caller's client so `audit_insert` (actor_id = auth.uid())
  // holds. A failed audit write is not silently tolerated: the status is put back
  // rather than left changed with no record of who changed it.
  const { error: auditError } = await supabase.from('audit_events').insert({
    actor_id: input.actorId,
    actor_team: input.actorTeam,
    entity_type: 'rfi_consideration',
    entity_id: input.considerationId,
    action: rule.auditAction,
    from_status: current.response_status,
    to_status: rule.to,
    reason: input.reason?.trim() || null,
    metadata: { edited: input.responseText !== undefined },
  })

  if (auditError) {
    log.error('workflow.audit_failed', { considerationId: input.considerationId }, auditError)
    await supabase
      .from('rfi_consideration')
      .update({ response_status: current.response_status })
      .eq('id', input.considerationId)
    return {
      ok: false,
      error: 'The change could not be recorded in the audit trail, so it was rolled back.',
    }
  }

  // --- Feedback loop -----------------------------------------------------
  //
  // There is nothing to do here any more, and that is the point. Retrieval reads
  // `rfi_consideration` directly, so an approved response is precedent the
  // instant its status flips — no second index to maintain, and no window in
  // which a response is approved but not yet findable. Dropping embeddings
  // removed a moving part rather than replacing it (ADR-039).
  log.info('workflow.transitioned', {
    considerationId: input.considerationId,
    action: input.action,
    from: current.response_status,
    to: rule.to,
  })

  return { ok: true, from: current.response_status, to: rule.to }
}

