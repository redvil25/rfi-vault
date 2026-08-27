import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

/**
 * Feature 5. Reads the append-only trail.
 *
 * Read-only by construction: `audit_events` has UPDATE, DELETE and TRUNCATE
 * triggers that raise (0005, 0009), so there is no write path here to get wrong.
 *
 * Row visibility is decided by the `audit_read_own_team` policy — a team sees
 * its own actions, ADMIN and CTA Management see everything. Nothing in this file
 * re-implements that; if it did, the two would eventually disagree.
 */

type Enums = Database['public']['Enums']

export const auditParamsSchema = z.object({
  action: z.string().trim().max(40).optional(),
  entityType: z.string().trim().max(40).optional(),
  // Validated as the enum, not free text: `actor_team` is a Postgres enum column
  // and PostgREST rejects a value outside it, so an unchecked string would turn a
  // typo in the URL into a 400 rather than an empty filter.
  team: z
    .enum(['RA_CLINICAL', 'AFFILIATE', 'CTA_MANAGEMENT', 'EU_SUBMISSION_HUB', 'ADMIN'])
    .optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export type AuditParams = z.infer<typeof auditParamsSchema>

export interface AuditEvent {
  id: number
  occurredAt: string
  actorId: string | null
  actorTeam: Enums['team_role'] | null
  entityType: string
  entityId: string
  action: string
  fromStatus: string | null
  toStatus: string | null
  reason: string | null
  metadata: Record<string, unknown>
  /** True when the current user is the actor — the only identity RLS lets us resolve. */
  isYou: boolean
}

export interface AuditResult {
  events: AuditEvent[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  /** Distinct actions present in what this user can see, for the filter. */
  actions: string[]
}

interface Row {
  id: number
  occurred_at: string
  actor_id: string | null
  actor_team: Enums['team_role'] | null
  entity_type: string
  entity_id: string
  action: string
  from_status: string | null
  to_status: string | null
  reason: string | null
  metadata: Record<string, unknown> | null
}

/**
 * Imported lazily, and only when no client was injected: `lib/db/server.ts`
 * carries the `server-only` marker, which throws the moment it loads under tsx.
 * A static import would break the verification script even though it supplies
 * its own client.
 */
async function requestScopedClient(): Promise<SupabaseClient<Database>> {
  const { createClient } = await import('@/lib/db/server')
  return createClient()
}

export async function loadAuditEvents(
  params: AuditParams,
  currentUserId: string,
  client?: SupabaseClient<Database>,
): Promise<AuditResult> {
  const supabase = client ?? (await requestScopedClient())

  let query = supabase
    .from('audit_events')
    .select(
      'id, occurred_at, actor_id, actor_team, entity_type, entity_id, action, from_status, to_status, reason, metadata',
      { count: 'exact' },
    )
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })

  if (params.action) query = query.eq('action', params.action)
  if (params.entityType) query = query.eq('entity_type', params.entityType)
  if (params.team) query = query.eq('actor_team', params.team)
  if (params.from) query = query.gte('occurred_at', params.from)
  if (params.to) query = query.lte('occurred_at', params.to)

  const offset = (params.page - 1) * params.pageSize
  const { data, error, count } = await query.range(offset, offset + params.pageSize - 1)

  if (error) throw new Error(`audit_events read failed: ${error.message}`)

  const events: AuditEvent[] = ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    occurredAt: r.occurred_at,
    actorId: r.actor_id,
    actorTeam: r.actor_team,
    entityType: r.entity_type,
    entityId: r.entity_id,
    action: r.action,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    reason: r.reason,
    metadata: r.metadata ?? {},
    isYou: r.actor_id === currentUserId,
  }))

  const total = count ?? 0

  return {
    events,
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
    actions: await distinctActions(supabase),
  }
}

/**
 * Distinct action names, for the filter dropdown.
 *
 * Reads a bounded window rather than the whole table: this only needs to
 * populate a dropdown, and scanning every row to do it would get slower with
 * every event ever recorded — in a table that by design never shrinks.
 */
async function distinctActions(supabase: SupabaseClient<Database>): Promise<string[]> {
  const { data } = await supabase
    .from('audit_events')
    .select('action')
    .order('occurred_at', { ascending: false })
    .limit(1000)

  const seen = new Set<string>()
  for (const row of (data ?? []) as { action: string }[]) seen.add(row.action)
  return [...seen].sort()
}
