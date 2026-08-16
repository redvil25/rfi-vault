/**
 * Values shared by client and server. Kept in their own module so a client
 * component can import them without pulling in `lib/ingest/commit.ts`, which
 * constructs the service-role client.
 */

export const RFI_BUCKET = 'rfi-documents'
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
