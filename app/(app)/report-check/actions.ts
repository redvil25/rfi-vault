'use server'

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createClient, getCurrentUser } from '@/lib/db/server'
import { log } from '@/lib/log'
import { consumeRateLimit } from '@/lib/rate-limit'
import { MEMBER_STATE_BY_CODE } from '@/lib/domain/taxonomy'
import {
  ANALYSIS_KEY_RE,
  createAnalysisUploadTarget,
  readUploadedDocument,
} from '@/lib/docs/analyse-upload'
import { splitDossier } from '@/lib/precheck/split'
import { runPrecheck } from '@/lib/precheck/run'
import { STALE_AFTER_MONTHS } from '@/lib/precheck/rules'
import type { PrecheckResult } from '@/lib/precheck/types'

/**
 * A run costs a handful of aggregate queries and one model call over the
 * document. Bounded so one account cannot queue unlimited PDF parsing.
 */
const CHECK_LIMIT = 12
const UPLOAD_LIMIT = 24
const WINDOW_SECONDS = 300

export interface UploadTargetState {
  error?: string
  storageKey?: string
  token?: string
}

/**
 * Step 1. Hands the browser a one-shot signed URL so the report goes straight
 * to Storage. The bytes never cross this server, which keeps the upload clear
 * of the host's request-body limit — 4.5 MB on Vercel, well under the 20 MB a
 * real clinical report can reach.
 */
export async function createReportUploadAction(fileName: string): Promise<UploadTargetState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'You are not signed in.' }

  const limited = await consumeRateLimit(`report:upload:${user.id}`, UPLOAD_LIMIT, WINDOW_SECONDS)
  if (!limited.allowed) {
    return { error: 'Too many uploads in a short time. Wait a moment and try again.' }
  }

  const target = await createAnalysisUploadTarget(fileName)
  if (!target.ok) return { error: target.error }
  return { storageKey: target.storageKey, token: target.token }
}

const schema = z.object({
  storageKey: z.string().regex(ANALYSIS_KEY_RE, 'The upload reference is malformed.'),
  submissionType: z.enum(['INITIAL', 'SUBSTANTIAL_MODIFICATION', 'ADDITIONAL_MS']),
  memberStates: z
    .array(z.string())
    .max(30)
    .refine((codes) => codes.every((c) => MEMBER_STATE_BY_CODE.has(c)), {
      message: 'One of those Member States is not in the taxonomy.',
    }),
})

export interface ReportCheckState {
  error?: string
  result?: PrecheckResult
  runId?: string
  fileName?: string
  /** Headings the splitter could not map. Listed rather than filed under a guess. */
  unrecognised?: string[]
  ranFor?: { submissionType: string; memberStates: string[] }
}

/**
 * Step 2. Reads the uploaded report back, sections it on its own headings, and
 * runs every check over it. The stored object is deleted as soon as its text
 * has been read — see lib/docs/analyse-upload.ts.
 */
export async function checkReportAction(
  _prev: ReportCheckState,
  formData: FormData,
): Promise<ReportCheckState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'You are not signed in.' }

  let payload: unknown
  try {
    payload = JSON.parse(String(formData.get('payload') ?? ''))
  } catch {
    return { error: 'The form could not be read. Reload the page and try again.' }
  }

  const parsed = schema.safeParse(payload)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const limited = await consumeRateLimit(`report:check:${user.id}`, CHECK_LIMIT, WINDOW_SECONDS)
  if (!limited.allowed) {
    return { error: 'Too many checks in a short time. Wait a moment and try again.' }
  }

  const fileName = String(formData.get('fileName') ?? 'report.pdf').slice(0, 200)

  const read = await readUploadedDocument(parsed.data.storageKey)
  if (!read.ok) return { error: read.error }

  // Sectioned on the headings the report already carries. A heading that maps
  // onto nothing in the taxonomy is reported and left out, never filed under
  // the nearest-looking section — checking a cover letter against the
  // protocol's rules is worse than not checking it.
  const split = splitDossier(read.text)
  if (split.recognised.length === 0) {
    return {
      error:
        'No heading in that document maps onto an application section, so there was nothing to ' +
        'check it against. The check works on a report whose sections are named — Protocol, ' +
        'IMPD Quality, Informed Consent, and so on.',
      fileName,
      unrecognised: split.unrecognised,
    }
  }

  try {
    const supabase = await createClient()
    const result = await runPrecheck(
      {
        submissionType: parsed.data.submissionType,
        memberStates: parsed.data.memberStates,
        sections: split.recognised,
        pageCount: read.pageCount,
      },
      supabase,
    )

    // --- Audit ------------------------------------------------------------
    //
    // Records the shape of the run and its verdict. Never the report itself,
    // which is the sponsor's, was deleted after reading, and has no business in
    // an append-only table the whole team can read.
    const runId = randomUUID()
    const { error: auditError } = await supabase.from('audit_events').insert({
      actor_id: user.id,
      actor_team: user.team,
      entity_type: 'precheck_run',
      entity_id: runId,
      action: 'REPORT_CHECKED',
      metadata: {
        file_name: fileName,
        pages: read.pageCount,
        submission_type: parsed.data.submissionType,
        member_states: parsed.data.memberStates,
        sections: split.recognised.map((s) => s.section),
        sections_unrecognised: split.unrecognised.length,
        blockers: result.counts.BLOCKER,
        likely: result.counts.LIKELY,
        watch: result.counts.WATCH,
        missing_items: result.completeness?.missing.length ?? 0,
        completeness_ran: result.completeness !== null,
        rules_evaluated: result.rules.length,
        stale_after_months: STALE_AFTER_MONTHS,
      },
    })

    if (auditError) {
      log.error('report.audit_failed', { runId }, auditError)
      return {
        error:
          'The check ran, but it could not be written to the audit trail, so the result is not ' +
          'shown. A result you cannot later prove you ran is worse than none.',
      }
    }

    return {
      result,
      runId,
      fileName,
      unrecognised: split.unrecognised,
      ranFor: {
        submissionType: parsed.data.submissionType,
        memberStates: parsed.data.memberStates,
      },
    }
  } catch (err) {
    log.error('report.action_failed', {}, err)
    return {
      error:
        'The check could not be completed. Nothing was written to the repository, and no ' +
        'partial result is shown — a partial check would read as a clean one.',
    }
  }
}
