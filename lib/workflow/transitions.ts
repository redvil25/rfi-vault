import type { Database } from '@/lib/db/types'

/**
 * The response status machine (docs/00-PLAN.md, Phase 2, Sat 29 Aug).
 *
 * Pure and dependency-free: no database, no session, no clock. The rules are the
 * part that has to be right, so they are the part that is unit-tested, and the
 * server action below this is left with nothing to decide.
 *
 * DRAFT ──submit──▶ IN_REVIEW ──approve──▶ APPROVED ──file──▶ SUBMITTED
 *   ▲                   │
 *   └──request changes──┘
 *
 * SUBMITTED is terminal. A response that has gone to the regulator cannot be
 * edited back into an earlier state — the correction path is a new request for
 * information, which is how the regulation actually works, and how `audit_events`
 * already behaves (ADR-007).
 */

type ResponseStatus = Database['public']['Enums']['response_status']
type TeamRole = Database['public']['Enums']['team_role']

export const WORKFLOW_ACTIONS = [
  'SUBMIT_FOR_REVIEW',
  'REQUEST_CHANGES',
  'APPROVE',
  'MARK_SUBMITTED',
] as const

export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number]

export interface TransitionRule {
  from: ResponseStatus
  to: ResponseStatus
  /** Goes into `audit_events.action`. */
  auditAction: string
  label: string
  /** The same act in the past tense, for "only a ... can be ..." messages. */
  pastLabel: string
  /** Sending work back always needs a reason; sending it forward does not. */
  requiresReason: boolean
  /** Approving an empty response is meaningless, so text is required first. */
  requiresResponseText: boolean
}

export const TRANSITIONS: Record<WorkflowAction, TransitionRule> = {
  SUBMIT_FOR_REVIEW: {
    from: 'DRAFT',
    to: 'IN_REVIEW',
    auditAction: 'SUBMITTED_FOR_REVIEW',
    pastLabel: 'sent for review',
    label: 'Send for review',
    requiresReason: false,
    requiresResponseText: true,
  },
  REQUEST_CHANGES: {
    from: 'IN_REVIEW',
    to: 'DRAFT',
    auditAction: 'CHANGES_REQUESTED',
    pastLabel: 'sent back for changes',
    label: 'Request changes',
    requiresReason: true,
    requiresResponseText: false,
  },
  APPROVE: {
    from: 'IN_REVIEW',
    to: 'APPROVED',
    auditAction: 'APPROVED',
    pastLabel: 'approved',
    label: 'Approve',
    requiresReason: false,
    requiresResponseText: true,
  },
  MARK_SUBMITTED: {
    from: 'APPROVED',
    to: 'SUBMITTED',
    auditAction: 'SUBMITTED_TO_REGULATOR',
    pastLabel: 'marked as submitted',
    label: 'Mark as submitted to the regulator',
    requiresReason: false,
    requiresResponseText: true,
  },
}

/**
 * Who may move a response.
 *
 * Mirrors `write_own_team` in 0012 rather than inventing a second rule: the
 * owning team, plus the two coordinating teams. Stated here as well so the UI
 * can hide a button the database would refuse, instead of offering an action
 * that fails.
 */
export function mayTransition(actorTeam: TeamRole | null, ownerTeam: TeamRole | null): boolean {
  if (!actorTeam) return false
  if (actorTeam === 'ADMIN' || actorTeam === 'CTA_MANAGEMENT') return true
  return ownerTeam !== null && actorTeam === ownerTeam
}

export interface ActionContext {
  status: ResponseStatus
  ownerTeam: TeamRole | null
  actorTeam: TeamRole | null
  hasResponseText: boolean
}

/** Why an action is unavailable, or null when it is available. */
export function blockedBecause(
  action: WorkflowAction,
  context: ActionContext,
): string | null {
  const rule = TRANSITIONS[action]

  if (!mayTransition(context.actorTeam, context.ownerTeam)) {
    return 'This response belongs to another team.'
  }
  if (context.status !== rule.from) {
    return `Only a response that is ${rule.from.replaceAll('_', ' ').toLowerCase()} can be ${rule.pastLabel}.`
  }
  if (rule.requiresResponseText && !context.hasResponseText) {
    return 'There is no response text yet.'
  }
  return null
}

/** Everything the actor can do to this response right now, in workflow order. */
export function availableActions(context: ActionContext): WorkflowAction[] {
  return WORKFLOW_ACTIONS.filter((action) => blockedBecause(action, context) === null)
}

export const STATUS_LABELS: Record<ResponseStatus, string> = {
  DRAFT: 'Draft',
  IN_REVIEW: 'In review',
  APPROVED: 'Approved',
  SUBMITTED: 'Submitted',
}

/**
 * What each state means for who can see it — the sentence the UI shows.
 *
 * Worth stating on screen because it is the product: an approved response
 * becomes shared precedent for every team, and a reviewer should know that at
 * the moment they approve rather than discover it afterwards.
 */
export const STATUS_MEANING: Record<ResponseStatus, string> = {
  DRAFT: 'Visible to the owning team and coordinators only.',
  IN_REVIEW: 'Visible to the owning team and coordinators only. Awaiting a reviewer.',
  APPROVED: 'Shared with every team as precedent, and searchable across the repository.',
  SUBMITTED: 'Sent to the regulator. This record is final and cannot be moved back.',
}
