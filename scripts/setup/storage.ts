/**
 * Creates the private Storage bucket that holds uploaded RFI source documents.
 *
 *   npm run setup:storage
 *
 * Private, never public. Files are served through time-limited signed URLs so
 * a leaked path is useless — see docs/02-ARCHITECTURE.md §5.
 */

import '../load-env'
import { createServiceClient } from '../../lib/db/service'
import { RFI_BUCKET, MAX_UPLOAD_BYTES, ACCEPTED_UPLOAD_TYPES } from '../../lib/ingest/constants'

async function main() {
  const db = createServiceClient()

  const { data: buckets, error: listErr } = await db.storage.listBuckets()
  if (listErr) throw listErr

  const options = {
    public: false,
    fileSizeLimit: MAX_UPLOAD_BYTES,
    // Scans and screenshots are first-class inputs, not an edge case.
    allowedMimeTypes: [...ACCEPTED_UPLOAD_TYPES],
  }

  if (buckets.some((b) => b.name === RFI_BUCKET)) {
    // Idempotent: the accepted types changed when OCR was added, and an
    // existing bucket would otherwise keep rejecting images at the storage
    // layer, long after the application started accepting them.
    const { error } = await db.storage.updateBucket(RFI_BUCKET, options)
    if (error) throw error
    console.log(`Bucket "${RFI_BUCKET}" already existed — settings updated.`)
  } else {
    const { error } = await db.storage.createBucket(RFI_BUCKET, options)
    if (error) throw error
    console.log(`Created private bucket "${RFI_BUCKET}".`)
  }

  console.log(`  accepted: ${ACCEPTED_UPLOAD_TYPES.join(', ')}`)
  console.log(`  max size: ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`)

  const { data: check } = await db.storage.listBuckets()
  const bucket = check?.find((b) => b.name === RFI_BUCKET)
  console.log(`  public: ${bucket?.public}  (must be false)`)
  if (bucket?.public) {
    console.error('BUCKET IS PUBLIC — fix before storing anything.')
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
