'use server'

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createClient, getCurrentUser } from '@/lib/db/server'
import { log } from '@/lib/log'
import { consumeRateLimit } from '@/lib/rate-limit'
import { ALL_SECTIONS } from '@/lib/domain/taxonomy'
import { rejectionFor } from '@/lib/suggest/parse'
import {
  ANALYSIS_KEY_RE,
  createAnalysisUploadTarget,
  readUploadedDocument,
} from '@/lib/docs/analyse-upload'
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
  storageKey: z.string().regex(ANALYSIS_KEY_RE, 'The upload reference is malformed.'),
  section: z
    .union([z.enum(ALL_SECTIONS as unknown as [string, ...string[]]), z.literal('')])
    .transform((v) => (v === '' ? null : v)),
})

export interface SuggestState {
  error?: string
  outcome?: SuggestOutcome
  runId?: string
  fileName?: string
  pageCount?: number
}

export interface UploadTargetState {
  error?: string
  storageKey?: string
  token?: string
}

/**
 * Step 1. A one-shot signed URL, so the request document goes straight to
 * Storage and never crosses this server — the same arrangement the ingestion
 * path uses, and for the same reason: hosts cap request bodies well below what
 * a real CTIS export reaches.
 */
export async function createRequestUploadAction(fileName: string): Promise<UploadTargetState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'You are not signed in.' }

  const limited = await consumeRateLimit(`suggest:upload:${user.id}`, 24, WINDOW_SECONDS)
  if (!limited.allowed) {
    return { error: 'Too many uploads in a short time. Wait a moment and try again.' }
  }

  const target = await createAnalysisUploadTarget(fileName)
  if (!target.ok) return { error: target.error }
  return { storageKey: target.storageKey, token: target.token }
}

export async function suggestAction(
  _prev: SuggestState,
  formData: FormData,
): Promise<SuggestState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'You are not signed in.' }

  const parsed = schema.safeParse({
    storageKey: formData.get('storageKey') ?? '',
    section: formData.get('section') ?? '',
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const fileName = String(formData.get('fileName') ?? 'request.pdf').slice(0, 200)

  // The uploaded object is deleted as soon as its text has been read. An
  // incoming request is the sponsor's document, handed over to be answered, and
  // this repository has no reason to keep a copy of one it never filed.
  const read = await readUploadedDocument(parsed.data.storageKey)
  if (!read.ok) return { error: read.error }

  // Cheap, deterministic rejections before anything is spent on retrieval or a
  // model call. A fragment cannot be answered and should not cost anything.
  const rejection = rejectionFor(read.text)
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
      { text: read.text, section: parsed.data.section },
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
        file_name: fileName,
        pages: read.pageCount,
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

    return { outcome, runId, fileName, pageCount: read.pageCount }
  } catch (err) {
    log.error('suggest.action_failed', {}, err)
    return {
      error:
        'The suggestions could not be produced. Nothing was written to the repository, and no ' +
        'partial result is shown — half an answer here reads as a whole one.',
    }
  }
}
