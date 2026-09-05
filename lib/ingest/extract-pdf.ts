/**
 * PDF text extraction. Kept separate from parsing so the parser can be unit
 * tested against plain strings with no PDF machinery involved.
 */

export interface ExtractedPdf {
  text: string
  pageCount: number
  /** Text extraction yields nothing on scanned documents — they need OCR. */
  looksScanned: boolean
}

/**
 * `Math.sumPrecise` for runtimes that do not have it yet.
 *
 * pdf.js calls it at module scope, so on a runtime without it the *import* of
 * unpdf throws — before a single page is read, and with a message
 * ("Math.sumPrecise is not a function") that names nothing to do with PDFs.
 * Node 24 locally has it and the Node 24 build on the deployment host does not,
 * which is the worst version of this: green everywhere it was tested, failing
 * only in production, on every upload.
 *
 * Neumaier compensated summation, which is what the proposal is for — a naive
 * `reduce` would lose the precision pdf.js asked for by calling this.
 */
function installSumPrecise(): void {
  const math = Math as unknown as { sumPrecise?: (values: Iterable<number>) => number }
  if (typeof math.sumPrecise === 'function') return

  math.sumPrecise = (values: Iterable<number>): number => {
    let sum = 0
    let compensation = 0
    for (const value of values) {
      if (typeof value !== 'number') {
        throw new TypeError('Math.sumPrecise: every value must be a number')
      }
      const next = sum + value
      compensation +=
        Math.abs(sum) >= Math.abs(value) ? sum - next + value : value - next + sum
      sum = next
    }
    const total = sum + compensation
    // The proposal returns -0 for an empty iterable, and Number.isNaN-safe
    // arithmetic above can turn -0 into 0.
    return Object.is(total, 0) && Object.is(sum, 0) ? sum : total
  }
}

export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedPdf> {
  installSumPrecise()

  // Dynamic import: unpdf is ESM-only, and this module is loaded from both the
  // Next bundle and CJS node scripts.
  const { extractText, getDocumentProxy } = await import('unpdf')

  // pdf.js TRANSFERS the buffer it is given, leaving the caller's Uint8Array
  // detached and zero-length. Callers that extract text and then upload the
  // same bytes would silently store an empty file. Hand it a copy.
  const pdf = await getDocumentProxy(bytes.slice())
  const { totalPages, text } = await extractText(pdf, { mergePages: true })

  const merged = Array.isArray(text) ? text.join('\n') : text

  return {
    text: merged,
    pageCount: totalPages,
    // A page of real text is comfortably over 200 characters. Well under that
    // per page means an image-only PDF, which v1 does not handle.
    looksScanned: merged.replace(/\s/g, '').length < totalPages * 200,
  }
}
