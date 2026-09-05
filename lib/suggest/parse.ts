import { MEMBER_STATE_BY_CODE, PART_I_SECTIONS } from '@/lib/domain/taxonomy'
import { classifyConsideration } from '@/lib/ingest/classify'
import { CATEGORY_BY_ID } from '@/lib/domain/taxonomy'
import type { ParsedRequest } from './types'

/**
 * Reading a pasted request for information (docs/04-AI-PIPELINE.md §5.1).
 *
 * Everything here is deterministic and everything it cannot determine comes back
 * null. That is the whole discipline: a request filed under the wrong
 * application section retrieves precedent from the wrong section, and the writer
 * has no way to see that it happened. Guessing the section would make the
 * retrieval quietly wrong rather than visibly incomplete.
 */

/** Below this a paste is a fragment, not a request. */
export const MIN_REQUEST_WORDS = 8

/** Above this the model call is not worth making and the paste is probably a whole document. */
export const MAX_REQUEST_CHARS = 8000

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/**
 * CTIS exports prefix a Part II consideration with the Member State that raised
 * it — "IT - No payment receipt has been identified". A Part I consideration has
 * no prefix, because it belongs to the whole application.
 */
function memberStateFrom(text: string): string | null {
  const prefix = /^\s*([A-Z]{2})\s*[-–—:]\s/.exec(text)
  if (prefix && MEMBER_STATE_BY_CODE.has(prefix[1])) return prefix[1]

  // "raised by Italy", "the Spanish authority" — only exact names, never a guess.
  for (const [code, ms] of MEMBER_STATE_BY_CODE) {
    if (new RegExp(`\\b${ms.name}\\b`, 'i').test(text)) return code
  }
  return null
}

/**
 * Split a paste that contains several considerations.
 *
 * CTIS numbers them. A writer pasting a whole request would otherwise have the
 * second through fifth silently folded into the first one's text, which pollutes
 * the embedding and returns precedent for a blend of unrelated questions.
 */
export function splitConsiderations(raw: string): string[] {
  const marker = /(?:^|\n)\s*(?:consideration|request|question|point|item)\s*(?:no\.?\s*)?(\d{1,2})[.):\s]/gi
  const cuts: number[] = []
  let m: RegExpExecArray | null
  while ((m = marker.exec(raw)) !== null) {
    // Offset of the marker itself, not of the newline before it.
    cuts.push(m.index + (m[0].startsWith('\n') ? 1 : 0))
  }

  if (cuts.length < 2) {
    // A single leading "Consideration 1." is a label, not a split point.
    const single = raw.trim()
    return single ? [single] : []
  }

  const parts: string[] = []
  const preamble = raw.slice(0, cuts[0]).trim()
  if (preamble && wordCount(preamble) >= MIN_REQUEST_WORDS) parts.push(preamble)
  for (let i = 0; i < cuts.length; i++) {
    const slice = raw.slice(cuts[i], cuts[i + 1] ?? raw.length).trim()
    if (slice) parts.push(slice)
  }
  return parts
}

function sectionPartFor(section: string | null): 'PART_I' | 'PART_II' | null {
  if (!section) return null
  return (PART_I_SECTIONS as readonly string[]).includes(section) ? 'PART_I' : 'PART_II'
}

/**
 * Read one pasted request.
 *
 * `sectionHint` is whatever the user picked in the form. It always wins: they
 * are looking at the document and the classifier is not. The classifier fills
 * the field in only when they left it blank.
 */
export function parseRequest(raw: string, sectionHint?: string | null): ParsedRequest {
  const all = splitConsiderations(raw)
  const text = (all[0] ?? raw).trim()

  const classified = classifyConsideration({
    text,
    section: sectionHint ?? null,
    part: null,
    memberState: null,
  })

  // The category's own home section, used only when the user gave no hint and
  // the classifier was confident. A category that spans several sections tells
  // us nothing, so it resolves to null rather than to the first of them.
  const taxonomySections = CATEGORY_BY_ID.get(classified.category)?.sections ?? []
  const inferred =
    classified.confidence >= 0.4 && taxonomySections.length === 1 ? taxonomySections[0] : null

  const section = sectionHint ?? inferred

  return {
    text,
    memberState: memberStateFrom(text),
    section,
    sectionPart: sectionPartFor(section),
    category: classified.category,
    categoryConfidence: classified.confidence,
    siblings: all.slice(1).map((t, i) => ({ index: i + 2, text: t })),
  }
}

/** Why a paste cannot be worked with at all. Null when it can. */
export function rejectionFor(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return 'Paste the text of the request for information first.'
  if (wordCount(trimmed) < MIN_REQUEST_WORDS) {
    return `That is ${wordCount(trimmed)} word${wordCount(trimmed) === 1 ? '' : 's'}. A request for information needs at least ${MIN_REQUEST_WORDS} to retrieve anything meaningful — searching on a fragment returns precedent for the fragment, not for the question.`
  }
  if (trimmed.length > MAX_REQUEST_CHARS) {
    return `That is ${trimmed.length.toLocaleString('en-GB')} characters. Paste one consideration at a time — at most ${MAX_REQUEST_CHARS.toLocaleString('en-GB')}.`
  }
  return null
}
