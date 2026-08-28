import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { createServiceClient } from '@/lib/db/service'
import { embedDocuments } from '@/lib/ai/embed'
import { toVectorLiteral } from '@/lib/ai/embed'
import { aiEnabled } from '@/lib/env'
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
  | { ok: true; from: string; to: string; reEmbedded: boolean; reEmbedNote?: string }
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
  let reEmbedded = false
  let reEmbedNote: string | undefined

  if (rule.to === 'APPROVED') {
    const outcome = await reEmbedResponse(input.considerationId, current.consideration_text, nextText)
    reEmbedded = outcome.ok
    reEmbedNote = outcome.note
  }

  log.info('workflow.transitioned', {
    considerationId: input.considerationId,
    action: input.action,
    from: current.response_status,
    to: rule.to,
    reEmbedded,
  })

  return { ok: true, from: current.response_status, to: rule.to, reEmbedded, reEmbedNote }
}

/**
 * Re-embeds a newly approved response so it becomes precedent for the next
 * search (docs/04-AI-PIPELINE.md §4.6).
 *
 * Never fails the transition. Approval is a regulatory act and it either
 * happened or it did not; whether the index has caught up yet is a separate
 * concern, and refusing an approval because an embedding call timed out would be
 * indefensible. The caller is told, so the UI can say "approved, not yet
 * searchable by meaning" rather than implying the loop closed when it has not.
 *
 * Writes go through the service client because `rfi_embedding` carries a read
 * policy and no insert grant for `authenticated` — the index is maintained by
 * the system, not by users.
 */
async function reEmbedResponse(
  considerationId: string,
  considerationText: string,
  responseText: string,
): Promise<{ ok: boolean; note?: string }> {
  if (!aiEnabled()) {
    return { ok: false, note: 'no model configured, so it is searchable by keyword only' }
  }
  if (!responseText.trim()) {
    return { ok: false, note: 'there is no response text to index' }
  }

  try {
    const content = `${considerationText}\n\n${responseText}`
    const { embeddings } = await embedDocuments([content])
    const vector = embeddings[0]
    if (!vector) return { ok: false, note: 'the embedding came back empty' }

    const { error } = await createServiceClient()
      .from('rfi_embedding')
      .upsert(
        {
          consideration_id: considerationId,
          kind: 'RESPONSE',
          content,
          embedding: toVectorLiteral(vector),
        },
        { onConflict: 'consideration_id,kind' },
      )

    if (error) {
      log.warn('workflow.reembed_write_failed', { considerationId }, error)
      return { ok: false, note: 'the search index could not be updated' }
    }

    return { ok: true }
  } catch (err) {
    log.warn('workflow.reembed_failed', { considerationId }, err)
    return { ok: false, note: 'the embedding call failed' }
  }
}
