import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractPdfText } from './extract-pdf'

/**
 * The one test that actually loads pdf.js.
 *
 * Everything else about parsing is unit-tested against plain strings, which is
 * the right trade — except that it left the *import* of unpdf untested, and that
 * is where the failure was. pdf.js calls `Math.sumPrecise` at module scope, so
 * on a runtime without it the import throws before a page is read, with a
 * message naming nothing to do with PDFs. Green everywhere it was tested,
 * failing in production on every upload.
 */

const fixture = (name: string) =>
  new Uint8Array(readFileSync(resolve(process.cwd(), 'fixtures', name)))

describe('extractPdfText', () => {
  it('loads pdf.js and reads a text-layer PDF', async () => {
    const result = await extractPdfText(fixture('rfi-example-ctis.pdf'))
    expect(result.pageCount).toBeGreaterThan(0)
    expect(result.looksScanned).toBe(false)
    expect(result.text).toContain('Consideration number')
  })

  it('reports a scanned PDF rather than returning an empty extraction', async () => {
    // An empty extraction reported as success would produce a confident finding
    // that the document contains nothing.
    const result = await extractPdfText(fixture('rfi-example-scanned.pdf'))
    expect(result.looksScanned).toBe(true)
  })

  it('does not detach the caller’s buffer', async () => {
    // pdf.js transfers the buffer it is given. A caller that extracted text and
    // then uploaded the same bytes would silently store an empty file.
    const bytes = fixture('rfi-example-ctis.pdf')
    const before = bytes.byteLength
    await extractPdfText(bytes)
    expect(bytes.byteLength).toBe(before)
  })
})
