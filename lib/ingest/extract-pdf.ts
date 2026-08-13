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

export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedPdf> {
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
