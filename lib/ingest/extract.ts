/**
 * One entry point for turning an uploaded file into text.
 *
 * Both the review step and the commit step go through this, so a document that
 * cannot be read is refused at review rather than passing review and yielding
 * nothing at commit time.
 *
 * Scope, deliberately narrowed — see ADR-021. This reads the text layer of a
 * PDF and nothing else. Scans, photographs and screenshots are refused with an
 * explanation rather than guessed at. The refusal path below is the seam where
 * OCR or a vision model returns if the scope widens again; nothing else in the
 * codebase needs to change for that.
 */

import { extractPdfText } from './extract-pdf'

/** One member today. Kept as a union because the field is written to the audit trail. */
export type ExtractionSource = 'TEXT_LAYER'

export interface Extraction {
  text: string
  pageCount: number
  source: ExtractionSource
}

export type ExtractionResult =
  | { ok: true; extraction: Extraction }
  | { ok: false; error: string }

function isPdf(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

function isPng(bytes: Uint8Array): boolean {
  return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  )
}

/**
 * Format is decided by magic bytes, never by file name or content type. Images
 * are still recognised even though they are refused: "this is a picture, and
 * pictures are not read" is a useful message, "not a PDF" is not.
 */
export function detectFormat(bytes: Uint8Array): 'pdf' | 'image' | null {
  if (isPdf(bytes)) return 'pdf'
  if (isPng(bytes) || isJpeg(bytes) || isWebp(bytes)) return 'image'
  return null
}

/** Refusal text lives here so the wording is identical wherever a scan is rejected. */
export const IMAGE_REFUSAL =
  'That is an image. Only PDF exports with a text layer can be filed — reading text ' +
  'out of a picture is not supported. Export the request for information from CTIS ' +
  'as a PDF and upload that.'

export const SCANNED_REFUSAL =
  'That PDF is a scan: it carries page images but no text layer, so there is nothing ' +
  'to read. Nothing was filed. Export the request for information from CTIS as a PDF ' +
  'rather than scanning a printout.'

export async function extractDocument(bytes: Uint8Array): Promise<ExtractionResult> {
  const format = detectFormat(bytes)

  if (format === null) {
    return { ok: false, error: 'That file is not a PDF.' }
  }

  if (format === 'image') {
    return { ok: false, error: IMAGE_REFUSAL }
  }

  const direct = await extractPdfText(bytes)

  if (direct.looksScanned) {
    return { ok: false, error: SCANNED_REFUSAL }
  }

  return {
    ok: true,
    extraction: {
      text: direct.text,
      pageCount: direct.pageCount,
      source: 'TEXT_LAYER',
    },
  }
}
