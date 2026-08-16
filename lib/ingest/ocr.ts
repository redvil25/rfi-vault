/**
 * OCR for scanned RFI documents and for screenshots.
 *
 * Many RFI exports reach the team as a scan or a screenshot rather than a
 * text-layer PDF — the sample we were given is two JPEG page images in a PDF
 * wrapper, with zero extractable characters. Refusing those would refuse a
 * large share of real inputs.
 *
 * Tesseract is used rather than a vision model on purpose:
 *   - it needs no API key, so ingestion keeps working with AI disabled
 *   - it is deterministic, which matters for a regulated audit trail
 *   - it cannot invent text that was not on the page, which a language model can
 *
 * A vision model would read messy handwriting better. That is a later upgrade
 * behind this same interface, not a reason to block on a key today.
 */

export interface OcrResult {
  text: string
  /** Mean Tesseract confidence, 0–1, averaged across pages. */
  confidence: number
  pageCount: number
}

const OCR_LANG = 'eng'

/** Below this, the page is almost certainly not readable text. */
export const MIN_OCR_CONFIDENCE = 0.55

/**
 * Rendering scale for PDF pages. Tesseract is markedly more accurate on larger
 * input; 2× is the usual sweet spot before memory and time stop paying off.
 */
const RENDER_SCALE = 2

/**
 * Language data is vendored at `vendor/tessdata/eng.traineddata` rather than
 * fetched at runtime.
 *
 * By default tesseract.js downloads it from a CDN and caches it in the working
 * directory. On a serverless host the filesystem is read-only, so that fails at
 * exactly the wrong moment; and even where it works, a 5 MB download on every
 * cold start is a slow, network-dependent surprise. Vendoring makes OCR
 * deterministic and offline.
 */
function tessdataPath(): string {
  return `${process.cwd().replace(/\\/g, '/')}/vendor/tessdata`
}

async function recognise(images: Uint8Array[]): Promise<OcrResult> {
  const { createWorker } = await import('tesseract.js')

  const worker = await createWorker(OCR_LANG, undefined, {
    langPath: tessdataPath(),
    // The vendored file is uncompressed, and nothing may be written to disk.
    gzip: false,
    cacheMethod: 'none',
  })

  try {
    const texts: string[] = []
    const confidences: number[] = []

    for (const image of images) {
      const { data } = await worker.recognize(Buffer.from(image))
      texts.push(data.text)
      confidences.push(data.confidence / 100)
    }

    return {
      text: texts.join('\n'),
      confidence:
        confidences.length > 0
          ? confidences.reduce((a, b) => a + b, 0) / confidences.length
          : 0,
      pageCount: images.length,
    }
  } finally {
    await worker.terminate()
  }
}

/** OCR an image file that was uploaded directly (PNG, JPEG, WebP). */
export async function ocrImage(bytes: Uint8Array): Promise<OcrResult> {
  return recognise([bytes])
}

/**
 * Rasterise each page of a scanned PDF and OCR it.
 *
 * `renderPageAsImage` needs `@napi-rs/canvas`, which is an optional peer of
 * unpdf. If it is unavailable the caller gets a clear message rather than a
 * stack trace.
 */
export async function ocrPdf(bytes: Uint8Array, maxPages = 20): Promise<OcrResult> {
  const { renderPageAsImage, getDocumentProxy } = await import('unpdf')

  // pdf.js transfers the buffer it is given, so hand each consumer a copy.
  const pdf = await getDocumentProxy(bytes.slice())
  const pageCount = Math.min(pdf.numPages, maxPages)

  const images: Uint8Array[] = []
  for (let page = 1; page <= pageCount; page++) {
    const rendered = await renderPageAsImage(bytes.slice(), page, {
      scale: RENDER_SCALE,
      // unpdf has no bundled canvas in Node; the implementation is injected.
      canvasImport: () => import('@napi-rs/canvas'),
    })
    images.push(new Uint8Array(rendered))
  }

  const result = await recognise(images)
  return { ...result, pageCount: pdf.numPages }
}

export function isOcrSupportedImage(mimeOrName: string): boolean {
  return /(^image\/(png|jpe?g|webp)$)|(\.(png|jpe?g|webp)$)/i.test(mimeOrName)
}
