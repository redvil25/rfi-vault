import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  IMAGE_REFUSAL,
  SCANNED_REFUSAL,
  detectFormat,
  extractDocument,
} from './extract'

const TEXT_PDF = 'fixtures/rfi-example-ctis.pdf'
const SCANNED_PDF = 'fixtures/rfi-example-scanned.pdf'

/** Smallest bytes that identify each format; only the magic prefix is read. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
])

describe('detectFormat', () => {
  it('identifies a PDF by magic bytes', async () => {
    const bytes = new Uint8Array(await readFile(TEXT_PDF))
    expect(detectFormat(bytes)).toBe('pdf')
  })

  it('still identifies images, so they can be refused specifically', () => {
    expect(detectFormat(PNG)).toBe('image')
    expect(detectFormat(JPEG)).toBe('image')
    expect(detectFormat(WEBP)).toBe('image')
  })

  it('returns null for anything else', () => {
    expect(detectFormat(new TextEncoder().encode('just some text'))).toBeNull()
  })

  /**
   * The upload is a signed URL, so the browser chooses the content type. Trusting
   * it would let a caller label anything `application/pdf`.
   */
  it('ignores what the file claims to be', () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    expect(detectFormat(zip)).toBeNull()
  })
})

describe('extractDocument', () => {
  it('reads a text-layer PDF', async () => {
    const bytes = new Uint8Array(await readFile(TEXT_PDF))
    const result = await extractDocument(bytes)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.extraction.source).toBe('TEXT_LAYER')
    expect(result.extraction.pageCount).toBe(2)
    expect(result.extraction.text).toContain('Consideration number')
  })

  /**
   * ADR-021 narrowed ingestion to text-layer PDFs. The important property is not
   * that a scan is rejected — it is that it is rejected with an explanation and
   * without writing anything, rather than filing an empty document.
   */
  it('refuses a scanned PDF and says why', async () => {
    const bytes = new Uint8Array(await readFile(SCANNED_PDF))
    const result = await extractDocument(bytes)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe(SCANNED_REFUSAL)
    expect(result.error).toMatch(/no text layer/i)
    expect(result.error).toMatch(/nothing was filed/i)
  })

  it('refuses an image and points at the PDF export', async () => {
    const result = await extractDocument(PNG)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe(IMAGE_REFUSAL)
    expect(result.error).toMatch(/CTIS/)
  })

  it('refuses a file that is not a PDF at all', async () => {
    const result = await extractDocument(new TextEncoder().encode('hello'))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('That file is not a PDF.')
  })

  it('never returns text alongside a refusal', async () => {
    const bytes = new Uint8Array(await readFile(SCANNED_PDF))
    const result = await extractDocument(bytes)
    expect(result).not.toHaveProperty('extraction')
  })
})
