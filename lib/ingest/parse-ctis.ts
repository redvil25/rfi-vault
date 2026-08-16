/**
 * Deterministic parser for CTIS "Requests for information" exports.
 *
 * No model is involved. The export is rigidly structured — fixed field labels,
 * one repeating block per consideration — so a parser extracts every field
 * exactly, with no hallucination surface. That matters more than parser
 * sophistication: a regulatory user can audit a regex, they cannot audit a
 * prompt.
 *
 * An LLM only earns its place on documents that do NOT follow this layout.
 * `confidence` and `warnings` below are what routes a document to that path,
 * or to a human.
 */

import {
  ALL_SECTIONS, PART_I_SECTIONS, PART_II_SECTIONS, MEMBER_STATE_BY_CODE,
} from '@/lib/domain/taxonomy'
import { classifyConsideration } from './classify'

export type SectionPart = 'PART_I' | 'PART_II'
export type SubmissionType = 'INITIAL' | 'SUBSTANTIAL_MODIFICATION' | 'ADDITIONAL_MS'

export interface ParsedConsideration {
  considerationNumber: number
  sectionPart: SectionPart | null
  /** Canonical section name, mapped onto our taxonomy. */
  section: string | null
  /** Section exactly as printed, kept for the review screen. */
  sectionRaw: string | null
  documentName: string | null
  memberState: string | null
  considerationText: string
  sponsorResponseText: string | null
  category: string
  categoryConfidence: number
  warnings: string[]
}

export interface ParsedDocument {
  euTrialNumber: string | null
  documentRef: string | null
  submissionType: SubmissionType | null
  issuedAt: string | null
  considerations: ParsedConsideration[]
  warnings: string[]
  /** 0–1. Below 0.8, the review screen should demand attention. */
  confidence: number
}

// --------------------------------------------------------------------- Regex

const RE_TRIAL = /\b(\d{4}-\d{6}-\d{2}-\d{2})\b/
const RE_DOC_REF = /\b(CT-\d{4}-\d{6}-\d{2}-\d{2}(?:-[A-Z]{2}\d{2})?-\d{3,})\b/
// No \b anchors: in the real export the header renders as
// "...Requests for information05/08/2026 12:53" with no separating space, and
// \b finds no boundary between "n" and "0". Digit lookaround instead.
const RE_TIMESTAMP = /(?<!\d)(\d{2})\/(\d{2})\/(\d{4})\s*(\d{2}):(\d{2})(?!\d)/
const RE_MS_PREFIX = /^([A-Z]{2})\s*[-–]\s+/

/**
 * Field labels. "Application section parts" appears WITHOUT a colon in the real
 * export while every neighbouring label has one, so the colon is optional
 * throughout rather than special-cased.
 */
const LABELS = {
  number: /^Consideration number\s*:?\s*$/i,
  parts: /^Application section parts?\s*:?\s*$/i,
  document: /^Application section and document\s*:?\s*$/i,
  consideration: /^Consideration\s*:?\s*$/i,
  response: /^Sponsor response\s*:?\s*$/i,
} as const

type LabelKey = keyof typeof LABELS

/**
 * The page header repeats on every page and lands in the middle of whichever
 * field spans the page break — usually the sponsor response, which then ends
 * with a trial number and half a document reference.
 *
 * Matching on the full document reference is not enough: OCR reads the columnar
 * header row by row, so the reference arrives split and no single line contains
 * it whole. These signals each appear in the header and effectively never in
 * consideration prose.
 */
function isPageHeader(
  line: string,
  trialNumber: string | null,
  documentRef: string | null,
): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false

  if (trialNumber && trimmed.includes(trialNumber)) return true
  if (documentRef && trimmed.includes(documentRef)) return true
  if (/Requests?\s+for\s+information/i.test(trimmed)) return true
  if (RE_DOC_REF_STEM.test(trimmed)) return true

  // Orphaned continuation of a wrapped "SUBSTANTIAL MODIFICATION" header cell.
  if (/^(SUBSTANTIAL|MODIFICATION|INITIAL|ADDITIONAL MS)$/i.test(trimmed)) return true

  return false
}

function labelOf(line: string): LabelKey | null {
  for (const [key, re] of Object.entries(LABELS) as [LabelKey, RegExp][]) {
    if (re.test(line.trim())) return key
  }
  return null
}

// ----------------------------------------------------------------- Normalise

/**
 * Maps the printed section onto our canonical taxonomy. The export writes
 * "Informed consent" where our taxonomy says "Informed Consent", and
 * "Recruitment arrangements" where we say "Subject Recruitment Arrangements".
 * Scored by token overlap rather than exact match; unmatched values are kept
 * verbatim in `sectionRaw` for the reviewer.
 */
export function normaliseSection(
  raw: string | null,
  part: SectionPart | null,
): string | null {
  if (!raw) return null
  const candidates: readonly string[] =
    part === 'PART_I' ? PART_I_SECTIONS
    : part === 'PART_II' ? PART_II_SECTIONS
    : ALL_SECTIONS

  const rawTokens = new Set(
    raw.toLowerCase().split(/[^a-z0-9.]+/).filter((t) => t.length > 2),
  )
  if (rawTokens.size === 0) return null

  let best: { section: string; score: number } | null = null
  for (const section of candidates) {
    const tokens = section.toLowerCase().split(/[^a-z0-9.]+/).filter((t) => t.length > 2)
    if (tokens.length === 0) continue
    const overlap = tokens.filter((t) => rawTokens.has(t)).length
    if (overlap === 0) continue
    // Favour a tight match: overlap relative to both sides.
    const score = overlap / Math.max(tokens.length, rawTokens.size)
    if (!best || score > best.score) best = { section, score }
  }

  return best && best.score >= 0.4 ? best.section : null
}

function parseSectionParts(value: string | null): {
  part: SectionPart | null
  sectionRaw: string | null
} {
  if (!value) return { part: null, sectionRaw: null }

  // "Part I - Regulatory" | "Part II - Informed consent".
  //
  // OCR mangles roman numerals badly and predictably: capital I becomes a pipe
  // or a lowercase L, so "Part I" arrives as "Part |" and "Part II" as
  // "Part Il". Accept the confusable set and normalise, rather than losing the
  // Part I / Part II split — which is the single most important field in the
  // whole record.
  // Lookahead rather than \b: "|" is not a word character, so \b never fires
  // between it and the following space.
  const m = /^Part\s+([IiLl|1-9]{1,3})(?=\s|[-–—]|$)\s*[-–—]?\s*(.*)$/i.exec(value.trim())
  if (!m) return { part: null, sectionRaw: value.trim() || null }

  const token = m[1]
  const sectionRaw = m[2].trim() || null

  // Arabic forms first, so "Part 2" is not read as a run of ones.
  if (/^\d$/.test(token)) {
    return {
      part: token === '1' ? 'PART_I' : token === '2' ? 'PART_II' : null,
      sectionRaw,
    }
  }

  const normalised = token.replace(/[iIlL|1]/g, 'I')
  return {
    part: normalised === 'I' ? 'PART_I' : normalised === 'II' ? 'PART_II' : null,
    sectionRaw,
  }
}

/** Stem of a document reference, without the trailing sequence number. */
const RE_DOC_REF_STEM = /\b(CT-\d{4}-\d{6}-\d{2}-\d{2}(?:-[A-Z]{2}\d{2})?)\b/
/** The sequence number always immediately precedes this fixed phrase. */
const RE_SEQ_BEFORE_PHRASE = /\b(\d{3,})\s*[-–—]\s*Requests?\s+for\s+information/i

/**
 * Recovers the document reference.
 *
 * The strict form works on text-layer PDFs. Scanned exports lay the header out
 * in columns, and OCR reads it row by row, so the reference is split by
 * unrelated text:
 *
 *   CT-2024-519530-24-00-SM06-  05/08/2026 12:50
 *   MODIFICATION 001 - Requests for information
 *
 * The stem and the sequence number end up separated by a date. Recovering it by
 * proximity would pick up "12:50"; anchoring the sequence number to the fixed
 * phrase it always precedes is reliable instead.
 */
function parseDocumentRef(text: string): string | null {
  const strict = RE_DOC_REF.exec(text)?.[1]
  if (strict) return strict

  const stem = RE_DOC_REF_STEM.exec(text)?.[1]
  const seq = RE_SEQ_BEFORE_PHRASE.exec(text)?.[1]
  if (stem && seq) return `${stem}-${seq}`

  return null
}

function parseSubmissionType(text: string): SubmissionType | null {
  if (/substantial\s+modification/i.test(text)) return 'SUBSTANTIAL_MODIFICATION'
  if (/additional\s+(member\s+state|ms)\b/i.test(text)) return 'ADDITIONAL_MS'
  if (/\binitial\b/i.test(text)) return 'INITIAL'
  // The SM06 infix in the document reference is a second, independent signal.
  if (/-SM\d{2}-/i.test(text)) return 'SUBSTANTIAL_MODIFICATION'
  return null
}

function parseIssuedAt(text: string): string | null {
  const m = RE_TIMESTAMP.exec(text)
  if (!m) return null
  const [, dd, mm, yyyy, hh, min] = m
  const date = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +min))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Rejoins identifiers broken across a line by the renderer or by OCR.
 *
 * A scanned export wraps the document reference mid-token:
 *   "CT-2024-519530-24-00-SM06-\n001 - Requests for information"
 * Used only for header-field extraction, never for consideration text, where
 * removing a newline after a legitimate hyphen would corrupt the wording.
 */
function rejoinHyphenBreaks(text: string): string {
  return text.replace(/-[ \t]*\r?\n[ \t]*/g, '-')
}

/** Joins wrapped lines. Paragraph breaks are not recoverable from the extract. */
function joinLines(lines: string[]): string {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// -------------------------------------------------------------------- Parser

export function parseCtisRfi(rawText: string): ParsedDocument {
  const warnings: string[] = []
  const text = rawText.replace(/\r\n/g, '\n')

  // Header fields are matched against a de-hyphenated copy of the whole
  // document. Scanned exports repeat the header on every page and mangle it
  // differently each time — page 1 of our sample loses the colon from the
  // timestamp while page 2 keeps it — so restricting the search to the first
  // few hundred characters loses fields that are perfectly readable further in.
  const headerSpace = rejoinHyphenBreaks(text)

  const euTrialNumber = RE_TRIAL.exec(headerSpace)?.[1] ?? null
  const documentRef = parseDocumentRef(headerSpace)
  const submissionType = parseSubmissionType(headerSpace)
  const issuedAt = parseIssuedAt(headerSpace)

  if (!euTrialNumber) warnings.push('No EU trial number found in the document header.')
  if (!documentRef) warnings.push('No document reference found in the document header.')
  if (!submissionType) warnings.push('Submission type could not be determined.')
  if (!issuedAt) warnings.push('Issue date could not be determined.')

  const lines = text.split('\n')

  // Collect labelled fields, splitting into a new block at each "Consideration
  // number:". Page headers repeat mid-document and are skipped by the label
  // machine because they never match a label and never follow one.
  const blocks: Partial<Record<LabelKey, string[]>>[] = []
  let current: Partial<Record<LabelKey, string[]>> | null = null
  let active: LabelKey | null = null

  for (const line of lines) {
    const key = labelOf(line)

    if (key === 'number') {
      if (current) blocks.push(current)
      current = {}
      active = 'number'
      continue
    }

    if (!current) continue

    if (key) {
      active = key
      current[key] ??= []
      continue
    }

    if (active) {
      if (isPageHeader(line, euTrialNumber, documentRef)) continue
      ;(current[active] ??= []).push(line)
    }
  }
  if (current) blocks.push(current)

  const considerations: ParsedConsideration[] = []

  for (const [i, b] of blocks.entries()) {
    const blockWarnings: string[] = []

    const numberText = joinLines(b.number ?? [])
    const parsedNumber = Number.parseInt(numberText, 10)
    if (!Number.isFinite(parsedNumber)) {
      blockWarnings.push(`Consideration number not readable ("${numberText}"), using position.`)
    }

    const { part, sectionRaw } = parseSectionParts(joinLines(b.parts ?? []) || null)
    const section = normaliseSection(sectionRaw, part)
    if (sectionRaw && !section) {
      blockWarnings.push(`Section "${sectionRaw}" did not map to the taxonomy.`)
    }
    if (!part) blockWarnings.push('Application section part (Part I / Part II) not found.')

    const considerationText = joinLines(b.consideration ?? [])
    if (!considerationText) blockWarnings.push('Consideration text is empty.')

    const responseText = joinLines(b.response ?? []) || null

    const msMatch = RE_MS_PREFIX.exec(considerationText)
    let memberState: string | null = null
    if (msMatch && MEMBER_STATE_BY_CODE.has(msMatch[1])) {
      memberState = msMatch[1]
    } else if (msMatch) {
      blockWarnings.push(`Prefix "${msMatch[1]}" is not a known Member State code.`)
    }

    const { category, confidence } = classifyConsideration({
      text: considerationText,
      section,
      part,
      memberState,
    })
    if (category === 'UNCLASSIFIED') {
      blockWarnings.push('Category could not be determined from keywords — needs review.')
    }

    considerations.push({
      considerationNumber: Number.isFinite(parsedNumber) ? parsedNumber : i + 1,
      sectionPart: part,
      section,
      sectionRaw,
      documentName: joinLines(b.document ?? []) || null,
      memberState,
      considerationText,
      sponsorResponseText: responseText,
      category,
      categoryConfidence: confidence,
      warnings: blockWarnings,
    })
  }

  if (considerations.length === 0) {
    warnings.push('No considerations found. This may not be a CTIS RFI export.')
  }

  // Header fields are worth more than per-consideration polish: a document with
  // no reference cannot be filed at all.
  const headerScore =
    [euTrialNumber, documentRef, submissionType, issuedAt].filter(Boolean).length / 4
  const bodyScore =
    considerations.length === 0
      ? 0
      : considerations.filter((c) => c.warnings.length === 0).length / considerations.length

  return {
    euTrialNumber,
    documentRef,
    submissionType,
    issuedAt,
    considerations,
    warnings,
    confidence: Number((headerScore * 0.5 + bodyScore * 0.5).toFixed(2)),
  }
}
