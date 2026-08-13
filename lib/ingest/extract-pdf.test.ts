import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { extractPdfText } from './extract-pdf'

const FIXTURE = 'fixtures/rfi-example-ctis.pdf'

describe('extractPdfText', () => {
  it('extracts text and page count', async () => {
    const bytes = new Uint8Array(await readFile(FIXTURE))
    const result = await extractPdfText(bytes)

    expect(result.pageCount).toBe(2)
    expect(result.looksScanned).toBe(false)
    expect(result.text).toContain('Consideration number')
  })

  it('does not detach the caller\'s buffer', async () => {
    // Regression: pdf.js TRANSFERS the buffer it is given. Passing the caller's
    // array straight through left it zero-length, so ingestion extracted the
    // text and then uploaded an empty file to Storage — and the e2e check that
    // compared the two lengths passed vacuously, 0 === 0.
    const bytes = new Uint8Array(await readFile(FIXTURE))
    const lengthBefore = bytes.byteLength
    expect(lengthBefore).toBeGreaterThan(0)

    await extractPdfText(bytes)

    expect(bytes.byteLength).toBe(lengthBefore)
    // And it must still be usable afterwards.
    const second = await extractPdfText(bytes)
    expect(second.pageCount).toBe(2)
  })

  it('flags a document with no extractable text as scanned', async () => {
    // A structurally valid PDF carrying a single page and no text layer.
    const empty = new TextEncoder().encode(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
        '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
        'trailer<</Root 1 0 R>>',
    )
    const result = await extractPdfText(empty)
    expect(result.looksScanned).toBe(true)
  })
})
