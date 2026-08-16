/**
 * One entry point for turning an uploaded file into text, whatever form it
 * arrived in.
 *
 * Both the review step and the commit step go through this, so a scanned
 * document cannot pass review and then yield nothing at commit time.
 */

import { extractPdfText } from './extract-pdf'
import { MIN_OCR_CONFIDENCE, ocrImage, ocrPdf } from './ocr'

export type ExtractionSource = 'TEXT_LAYER' | 'OCR_PDF' | 'OCR_IMAGE'

export interface Extraction {
  text: string
  pageCount: number
  source: ExtractionSource
  /** Only set for OCR sources. Mean Tesseract confidence, 0–1. */
  ocrConfidence: number | null
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

/** Format is decided by magic bytes, never by file name or content type. */
export function detectFormat(bytes: Uint8Array): 'pdf' | 'image' | null {
  if (isPdf(bytes)) return 'pdf'
  if (isPng(bytes) || isJpeg(bytes) || isWebp(bytes)) return 'image'
  return null
}

export async function extractDocument(bytes: Uint8Array): Promise<ExtractionResult> {
  const format = detectFormat(bytes)

  if (format === null) {
    return {
      ok: false,
      error: 'That file is not a PDF, PNG, JPEG or WebP.',
    }
  }

  if (format === 'image') {
    const ocr = await ocrImage(bytes)
    if (ocr.confidence < MIN_OCR_CONFIDENCE) {
      return {
        ok: false,
        error:
          `Text could not be read reliably from that image (confidence ${ocr.confidence.toFixed(2)}). ` +
          'A sharper or higher-resolution capture usually fixes it.',
      }
    }
    return {
      ok: true,
      extraction: {
        text: ocr.text,
        pageCount: 1,
        source: 'OCR_IMAGE',
        ocrConfidence: ocr.confidence,
      },
    }
  }

  // Text-layer PDFs are always preferred: extraction is exact, where OCR is a
  // best guess. OCR is the fallback, not the default.
  const direct = await extractPdfText(bytes)
  if (!direct.looksScanned) {
    return {
      ok: true,
      extraction: {
        text: direct.text,
        pageCount: direct.pageCount,
        source: 'TEXT_LAYER',
        ocrConfidence: null,
      },
    }
  }

  const ocr = await ocrPdf(bytes)
  if (ocr.confidence < MIN_OCR_CONFIDENCE) {
    return {
      ok: false,
      error:
        `This PDF has no text layer, and OCR could not read it reliably ` +
        `(confidence ${ocr.confidence.toFixed(2)}). A higher-resolution scan usually fixes it.`,
    }
  }

  return {
    ok: true,
    extraction: {
      text: ocr.text,
      pageCount: ocr.pageCount,
      source: 'OCR_PDF',
      ocrConfidence: ocr.confidence,
    },
  }
}
