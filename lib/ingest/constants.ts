/**
 * Values shared by client and server. Kept in their own module so a client
 * component can import them without pulling in `lib/ingest/commit.ts`, which
 * constructs the service-role client.
 */

export const RFI_BUCKET = 'rfi-documents'
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/**
 * Documents accepted in one filing.
 *
 * Bounded so one submission cannot queue unlimited parsing work. It lives here
 * rather than beside the action that enforces it because a `'use server'` module
 * may only export async functions — a plain constant there is a build error that
 * typecheck does not catch.
 */
export const MAX_BATCH = 10

/**
 * PDF only (ADR-021). The file picker and the Storage bucket agree on this, and
 * the server still decides the real format from magic bytes rather than trusting
 * either — an `accept` attribute is a hint to the file dialog, not a control.
 */
export const ACCEPTED_UPLOAD_TYPES = ['application/pdf'] as const

export const ACCEPTED_UPLOAD_ACCEPT_ATTR = '.pdf,application/pdf'
