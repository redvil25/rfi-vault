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

export const RFI_BUCKET = 'rfi-documents'

async function main() {
  const db = createServiceClient()

  const { data: buckets, error: listErr } = await db.storage.listBuckets()
  if (listErr) throw listErr

  if (buckets.some((b) => b.name === RFI_BUCKET)) {
    console.log(`Bucket "${RFI_BUCKET}" already exists.`)
  } else {
    const { error } = await db.storage.createBucket(RFI_BUCKET, {
      public: false,
      fileSizeLimit: 20 * 1024 * 1024,
      allowedMimeTypes: ['application/pdf'],
    })
    if (error) throw error
    console.log(`Created private bucket "${RFI_BUCKET}" (PDF only, 20 MB limit).`)
  }

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
