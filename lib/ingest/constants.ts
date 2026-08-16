/**
 * Values shared by client and server. Kept in their own module so a client
 * component can import them without pulling in `lib/ingest/commit.ts`, which
 * constructs the service-role client.
 */

export const RFI_BUCKET = 'rfi-documents'
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/**
 * RFI exports reach teams as text PDFs, scans, and plain screenshots. All three
 * are accepted; the server decides the real format from magic bytes.
 */
export const ACCEPTED_UPLOAD_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const

export const ACCEPTED_UPLOAD_ACCEPT_ATTR = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp'
