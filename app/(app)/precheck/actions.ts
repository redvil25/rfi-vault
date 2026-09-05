'use server'

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createClient, getCurrentUser } from '@/lib/db/server'
import { log } from '@/lib/log'
import { consumeRateLimit } from '@/lib/rate-limit'
import { ALL_SECTIONS, MEMBER_STATE_BY_CODE } from '@/lib/domain/taxonomy'
import { runPrecheck } from '@/lib/precheck/run'
import { STALE_AFTER_MONTHS } from '@/lib/precheck/rules'
import type { PrecheckResult } from '@/lib/precheck/types'

/**
 * The check is deterministic and reads only aggregates, so it is cheap — but it
 * still runs a handful of queries per section, and an unbounded loop over a
 * large paste is a denial of service against everyone else's dashboard.
 */
const PRECHECK_LIMIT = 30
const WINDOW_SECONDS = 300

/** Per section. Long enough for a real application section, short enough to bound the lint. */
const MAX_SECTION_CHARS = 40_000

const schema = z.object({
  submissionType: z.enum(['INITIAL', 'SUBSTANTIAL_MODIFICATION', 'ADDITIONAL_MS']),
  memberStates: z
    .array(z.string())
    .max(30)
    .refine((codes) => codes.every((c) => MEMBER_STATE_BY_CODE.has(c)), {
      message: 'One of those Member States is not in the taxonomy.',
    }),
  sections: z
    .array(
      z.object({
        section: z.enum(ALL_SECTIONS as unknown as [string, ...string[]]),
        text: z.string().max(MAX_SECTION_CHARS, {
          message: `A section can be at most ${MAX_SECTION_CHARS.toLocaleString('en-GB')} characters.`,
        }),
      }),
    )
    .min(1, { message: 'Add at least one section before running the check.' })
    .max(ALL_SECTIONS.length),
})

export interface PrecheckState {
  error?: string
  result?: PrecheckResult
  /** Echoed back so the results panel can name what was checked. */
  ranFor?: { submissionType: string; memberStates: string[] }
}

export async function precheckAction(
  _prev: PrecheckState,
  formData: FormData,
): Promise<PrecheckState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'You are not signed in.' }

  let payload: unknown
  try {
    payload = JSON.parse(String(formData.get('payload') ?? ''))
  } catch {
    return { error: 'The form could not be read. Reload the page and try again.' }
  }

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const filled = parsed.data.sections.filter((s) => s.text.trim().length > 0)
  if (filled.length === 0) {
    return { error: 'Paste the text of at least one section before running the check.' }
  }

  const limited = await consumeRateLimit(`precheck:${user.id}`, PRECHECK_LIMIT, WINDOW_SECONDS)
  if (!limited.allowed) {
    return { error: 'Too many checks in a short time. Wait a moment and try again.' }
  }

  try {
    const supabase = await createClient()
    const result = await runPrecheck(
      {
        submissionType: parsed.data.submissionType,
        memberStates: parsed.data.memberStates,
        sections: filled,
      },
      supabase,
    )

    // --- Audit ------------------------------------------------------------
    //
    // A regulated team has to be able to show what they checked and when. The
    // event records the shape of the run and its verdict — never the pasted
    // dossier text, which is the sponsor's and has no business in an
    // append-only table every teammate can read.
    const runId = randomUUID()
    const { error: auditError } = await supabase.from('audit_events').insert({
      actor_id: user.id,
      actor_team: user.team,
      entity_type: 'precheck_run',
      entity_id: runId,
      action: 'PRECHECK_RUN',
      metadata: {
        submission_type: parsed.data.submissionType,
        member_states: parsed.data.memberStates,
        sections: filled.map((s) => s.section),
        blockers: result.counts.BLOCKER,
        likely: result.counts.LIKELY,
        watch: result.counts.WATCH,
        rules_evaluated: result.rules.length,
        rules_skipped: result.rules.filter((r) => r.outcome === 'SKIPPED').length,
        stale_after_months: STALE_AFTER_MONTHS,
        corpus_to: result.coverage.corpusTo,
      },
    })

    if (auditError) {
      // The check itself changed nothing, so a failed audit write is reported
      // rather than rolled back — but it is reported, because a result nobody
      // can later prove was run is not much use to a regulated team.
      log.error('precheck.audit_failed', { runId }, auditError)
      return {
        error:
          'The check ran, but it could not be written to the audit trail, so the result is ' +
          'not shown. A result you cannot later prove you ran is worse than none.',
      }
    }

    return {
      result,
      ranFor: {
        submissionType: parsed.data.submissionType,
        memberStates: parsed.data.memberStates,
      },
    }
  } catch (err) {
    log.error('precheck.action_failed', { sections: filled.length }, err)
    return {
      error:
        'The check could not be completed. Nothing was written to the repository, and no ' +
        'result is shown — a partial check would read as a clean one.',
    }
  }
}
