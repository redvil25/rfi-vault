import type { Database } from '@/lib/db/types'

/**
 * Who may file a document, in a leaf module with no heavy imports.
 *
 * This lives apart from `commit.ts` on purpose. `commit.ts` pulls in the OCR
 * stack — tesseract.js, @napi-rs/canvas, unpdf — so importing `canIngest` from
 * there dragged all of it into the ingest *page*'s server bundle, when only the
 * ingest *action* ever runs OCR. Same reasoning as `constants.ts`.
 */

type TeamRole = Database['public']['Enums']['team_role']

/**
 * Ingestion is a submission-hub function; an Affiliate reads precedent, it does
 * not file documents on behalf of the whole organisation.
 */
export const INGEST_ROLES = ['EU_SUBMISSION_HUB', 'CTA_MANAGEMENT', 'ADMIN'] as const

export function canIngest(team: TeamRole | null): boolean {
  return team !== null && (INGEST_ROLES as readonly string[]).includes(team)
}
