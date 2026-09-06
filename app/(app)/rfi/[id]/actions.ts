'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/db/server'
import { getCurrentUser } from '@/lib/db/server'
import { log } from '@/lib/log'
import { consumeRateLimit } from '@/lib/rate-limit'
import { generateGroundedDraft } from '@/lib/draft/generate'
import { loadConsideration } from '@/lib/draft/query'
import type { DraftOutcome } from '@/lib/draft/types'
import { applyTransition } from '@/lib/workflow/apply'
import { WORKFLOW_ACTIONS } from '@/lib/workflow/transitions'

const UUID = z.string().uuid()

/**
 * Drafting is the one endpoint here that costs money and time, so it carries the
 * tightest limit: six per five minutes. Generous for a person working through a
 * request for information, and a hard ceiling on what one account can spend.
 */
const DRAFT_LIMIT = 6
const TRANSITION_LIMIT = 60
const WINDOW_SECONDS = 300

export interface DraftState {
  error?: string
  outcome?: DraftOutcome
}

export async function draftAction(considerationId: string): Promise<DraftState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'You are not signed in.' }

  if (!UUID.safeParse(considerationId).success) {
    return { error: 'That is not a valid record reference.' }
  }

  const limited = await consumeRateLimit(`draft:${user.id}`, DRAFT_LIMIT, WINDOW_SECONDS)
  if (!limited.allowed) {
    return {
      error: `Too many drafts in a short time. Try again in ${
        limited.retryAfterSeconds < 60
          ? `${limited.retryAfterSeconds} seconds`
          : `${Math.ceil(limited.retryAfterSeconds / 60)} minutes`
      }.`,
    }
  }

  // Read through the user's client: if RLS hides this consideration, there is
  // nothing to draft for and the answer is the same as "it does not exist".
  const consideration = await loadConsideration(considerationId)
  if (!consideration) {
    return { error: 'That request for information does not exist, or you cannot see it.' }
  }

  if (consideration.responseStatus === 'SUBMITTED') {
    return {
      error:
        'This response has already gone to the regulator. Drafting against it would suggest ' +
        'it can still be changed, and it cannot.',
    }
  }

  try {
    const supabase = await createClient()
    const outcome = await generateGroundedDraft(
      {
        considerationId: consideration.id,
        considerationText: consideration.considerationText,
        section: consideration.section,
        sectionPart: consideration.sectionPart,
        memberState: consideration.memberState,
        category: consideration.category,
        euTrialNumber: consideration.euTrialNumber,
        documentRef: consideration.documentRef,
        submissionType: consideration.submissionType,
      },
      supabase,
      { actorId: user.id },
    )

    revalidatePath(`/rfi/${considerationId}`)
    return { outcome }
  } catch (err) {
    log.error('draft.action_failed', { considerationId }, err)
    return {
      error:
        'The draft could not be produced. Nothing was written to the repository. ' +
        'The request for information is unchanged.',
    }
  }
}

const transitionSchema = z.object({
  considerationId: UUID,
  action: z.enum(WORKFLOW_ACTIONS),
  reason: z.string().trim().max(1000).optional(),
  responseText: z.string().trim().max(20_000).optional(),
})

export interface TransitionState {
  error?: string
  moved?: { from: string; to: string }
  note?: string
}

export async function transitionAction(
  _prev: TransitionState,
  formData: FormData,
): Promise<TransitionState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'You are not signed in.' }

  const parsed = transitionSchema.safeParse({
    considerationId: formData.get('considerationId'),
    action: formData.get('action'),
    reason: formData.get('reason') || undefined,
    responseText: formData.get('responseText') ?? undefined,
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const limited = await consumeRateLimit(
    `workflow:${user.id}`,
    TRANSITION_LIMIT,
    WINDOW_SECONDS,
  )
  if (!limited.allowed) {
    return { error: 'Too many changes in a short time. Wait a moment and try again.' }
  }

  const supabase = await createClient()
  const result = await applyTransition(
    {
      considerationId: parsed.data.considerationId,
      action: parsed.data.action,
      reason: parsed.data.reason ?? null,
      responseText: parsed.data.responseText,
      actorId: user.id,
      actorTeam: user.team,
    },
    supabase,
  )

  if (!result.ok) return { error: result.error }

  revalidatePath(`/rfi/${parsed.data.considerationId}`)
  // An approved response becomes shared precedent immediately: retrieval reads
  // rfi_consideration directly, so there is no index to catch up (ADR-039).
  if (result.to === 'APPROVED') revalidatePath('/search')

  return { moved: { from: result.from, to: result.to } }
}
