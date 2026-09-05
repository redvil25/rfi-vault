'use server'

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createClient, getCurrentUser } from '@/lib/db/server'
import { log } from '@/lib/log'
import { consumeRateLimit } from '@/lib/rate-limit'
import { ALL_SECTIONS } from '@/lib/domain/taxonomy'
import { MAX_REQUEST_CHARS, rejectionFor } from '@/lib/suggest/parse'
import { suggestResponses } from '@/lib/suggest/run'
import type { SuggestOutcome } from '@/lib/suggest/types'

/**
 * Up to four model calls per run — one to generate, three to verify — so this
 * carries the tightest limit in the product. Generous for a person working
 * through a request for information, and a hard ceiling on what one account can
 * spend in five minutes.
 */
const SUGGEST_LIMIT = 8
const WINDOW_SECONDS = 300

const schema = z.object({
  text: z.string().trim().min(1).max(MAX_REQUEST_CHARS),
  section: z
    .union([z.enum(ALL_SECTIONS as unknown as [string, ...string[]]), z.literal('')])
    .transform((v) => (v === '' ? null : v)),
})

export interface SuggestState {
  error?: string
  outcome?: SuggestOutcome
  runId?: string
}

export async function suggestAction(
  _prev: SuggestState,
  formData: FormData,
): Promise<SuggestState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'You are not signed in.' }

  const parsed = schema.safeParse({
    text: formData.get('text') ?? '',
    section: formData.get('section') ?? '',
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  // Cheap, deterministic rejections before anything is spent on retrieval or a
  // model call. A fragment cannot be answered and should not cost anything.
  const rejection = rejectionFor(parsed.data.text)
  if (rejection) return { error: rejection }

  const limited = await consumeRateLimit(`suggest:${user.id}`, SUGGEST_LIMIT, WINDOW_SECONDS)
  if (!limited.allowed) {
    const wait =
      limited.retryAfterSeconds < 60
        ? `${limited.retryAfterSeconds} seconds`
        : `${Math.ceil(limited.retryAfterSeconds / 60)} minutes`
    return { error: `Too many suggestion runs in a short time. Try again in ${wait}.` }
  }

  try {
    const supabase = await createClient()
    const outcome = await suggestResponses(
      { text: parsed.data.text, section: parsed.data.section },
      supabase,
      { actorId: user.id },
    )

    // --- Audit ------------------------------------------------------------
    //
    // Records that suggestions were produced, on what, and whether the system
    // refused — never the pasted request text, which is the sponsor's and has no
    // business in an append-only table every teammate can read.
    const runId = randomUUID()
    const { error: auditError } = await supabase.from('audit_events').insert({
      actor_id: user.id,
      actor_team: user.team,
      entity_type: 'suggestion_run',
      entity_id: runId,
      action: outcome.refused ? 'SUGGEST_REFUSED' : 'SUGGESTED',
      reason: outcome.refused ? outcome.reason.slice(0, 500) : null,
      metadata: {
        section: outcome.parsed.section,
        member_state: outcome.parsed.memberState,
        category: outcome.parsed.category,
        category_confidence: outcome.parsed.categoryConfidence,
        max_similarity: outcome.maxSimilarity,
        options: outcome.refused ? 0 : outcome.options.length,
        strategies: outcome.refused ? [] : outcome.options.map((o) => o.strategy),
        model: outcome.refused ? null : outcome.model,
      },
    })

    if (auditError) {
      // The run changed nothing in the repository, so this is reported rather
      // than rolled back — but it is reported. A generated response nobody can
      // later prove was produced, and from what, is not much use to a regulated
      // team.
      log.error('suggest.audit_failed', { runId }, auditError)
      return {
        error:
          'Options were produced, but the run could not be written to the audit trail, so they ' +
          'are not shown. A suggestion you cannot later prove you ran is worse than none.',
      }
    }

    return { outcome, runId }
  } catch (err) {
    log.error('suggest.action_failed', {}, err)
    return {
      error:
        'The suggestions could not be produced. Nothing was written to the repository, and no ' +
        'partial result is shown — half an answer here reads as a whole one.',
    }
  }
}
