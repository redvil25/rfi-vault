/**
 * Absence-and-futurity lint (docs/04-AI-PIPELINE.md §3.1).
 *
 * The strongest deterministic predictor of a request for information is the
 * writer admitting the gap themselves. "The insurance certificate has not yet
 * been returned and is not attached" is not a subtle signal that needs a model —
 * it is a sentence saying the dossier is incomplete, written by the person who
 * knows.
 *
 * Two families, both pure string matching:
 *
 *   ABSENCE   — the artefact is missing now, and the text says so.
 *   FUTURITY  — the artefact is promised for later, which for a validation
 *               submission means missing now.
 *   PLACEHOLDER — the draft never got finished: XXX, [insert], TBC, a leftover
 *               review comment, an unresolved tracked change.
 *
 * No API key, no network, no variance between runs. It works on a laptop with
 * the model switched off, which is the point: this is the half of the product a
 * regulatory team can audit line by line.
 *
 * Every pattern here describes the *writing*, never a regulatory requirement.
 * That distinction is deliberate — CLAUDE.md §8 forbids asserting article
 * numbers, deadlines or national rules this team has no authority over, and a
 * phrase list makes no such claim. The rules that do carry domain weight are
 * mined from the corpus instead (lib/precheck/rules.ts).
 */

export type LintKind = 'ABSENCE' | 'FUTURITY' | 'PLACEHOLDER'

export interface LintFinding {
  kind: LintKind
  /** The phrase as matched, lower-cased for grouping. */
  phrase: string
  /** Character offset of the match in the section text. */
  start: number
  end: number
  /** The sentence the match sits in, trimmed — what the UI shows. */
  excerpt: string
  /** Why this phrase is a signal, in the writer's terms. */
  because: string
}

interface Pattern {
  kind: LintKind
  /** Source fragment. Assembled with word boundaries; `\s+` tolerates line wraps. */
  source: string
  because: string
}

/**
 * The dossier is incomplete and the sentence admits it.
 *
 * These are ordered longest-first at match time, so "is not yet available"
 * reports once rather than also matching "not yet".
 */
/**
 * Negation reaches its participle through a variable middle: "not attached",
 * "not yet available", "will not be provided", "has not yet been returned". The
 * auxiliary and the adverb are each optional and can appear in either order, so
 * every absence verb is compiled through one prefix rather than enumerated by
 * hand — enumerating them is how "not yet been returned" got missed first time.
 */
const NOT = 'not\\s+(?:yet\\s+)?(?:(?:been|be)\\s+)?(?:yet\\s+)?'

const ABSENCE: Pattern[] = [
  { kind: 'ABSENCE', source: `${NOT}attached`, because: 'The text says the document is not in the package.' },
  { kind: 'ABSENCE', source: `${NOT}enclosed`, because: 'The text says the document is not in the package.' },
  { kind: 'ABSENCE', source: `${NOT}included`, because: 'The text says the document is not in the package.' },
  { kind: 'ABSENCE', source: `${NOT}submitted`, because: 'The text says the document has not been filed.' },
  { kind: 'ABSENCE', source: `${NOT}provided`, because: 'The text says the document has not been supplied.' },
  { kind: 'ABSENCE', source: `${NOT}supplied`, because: 'The text says the document has not been supplied.' },
  { kind: 'ABSENCE', source: `${NOT}available`, because: 'The text says the document does not exist yet.' },
  { kind: 'ABSENCE', source: `${NOT}finali[sz]ed`, because: 'An unfinished document is an incomplete dossier.' },
  { kind: 'ABSENCE', source: `${NOT}signed`, because: 'An unsigned document is normally treated as absent.' },
  { kind: 'ABSENCE', source: `${NOT}returned`, because: 'The text says the document is still with a third party.' },
  { kind: 'ABSENCE', source: `${NOT}received`, because: 'The text says the document has not arrived.' },
  { kind: 'ABSENCE', source: 'no\\s+longer\\s+valid', because: 'The text says the document has expired.' },
  { kind: 'ABSENCE', source: 'missing', because: 'The text names something as missing.' },
  { kind: 'ABSENCE', source: 'omitted', because: 'The text names something as left out.' },
  { kind: 'ABSENCE', source: 'awaiting', because: 'The submission depends on something that has not arrived.' },
  { kind: 'ABSENCE', source: 'pending', because: 'The submission depends on something not yet settled.' },
  { kind: 'ABSENCE', source: 'under\\s+negotiation', because: 'An unagreed document cannot be assessed.' },
  { kind: 'ABSENCE', source: 'under\\s+discussion', because: 'An unagreed document cannot be assessed.' },
  { kind: 'ABSENCE', source: 'in\\s+preparation', because: 'The document is still being written.' },
  { kind: 'ABSENCE', source: 'being\\s+(?:finali[sz]ed|prepared|obtained|translated)', because: 'The document is still being produced.' },
]

/** The artefact is promised for later. For a validation submission, later is too late. */
const FUTURITY: Pattern[] = [
  { kind: 'FUTURITY', source: 'will\\s+be\\s+(?:provided|submitted|supplied|filed|uploaded|attached|sent|forwarded)', because: 'A promise to supply later is a gap at submission.' },
  { kind: 'FUTURITY', source: 'will\\s+be\\s+(?:available|finali[sz]ed|signed|confirmed|completed|obtained)', because: 'A promise to complete later is a gap at submission.' },
  { kind: 'FUTURITY', source: 'will\\s+follow', because: 'A promise to supply later is a gap at submission.' },
  { kind: 'FUTURITY', source: 'to\\s+be\\s+(?:provided|submitted|supplied|filed|uploaded|attached)', because: 'A promise to supply later is a gap at submission.' },
  { kind: 'FUTURITY', source: 'to\\s+be\\s+(?:confirmed|determined|advised|decided|agreed|defined|finali[sz]ed|signed)', because: 'An undecided value cannot be assessed.' },
  { kind: 'FUTURITY', source: 'to\\s+follow', because: 'A promise to supply later is a gap at submission.' },
  { kind: 'FUTURITY', source: 'shall\\s+be\\s+(?:provided|submitted|supplied)', because: 'A promise to supply later is a gap at submission.' },
  { kind: 'FUTURITY', source: 'in\\s+due\\s+course', because: 'No date is committed to.' },
  { kind: 'FUTURITY', source: 'as\\s+soon\\s+as\\s+(?:possible|available)', because: 'No date is committed to.' },
  { kind: 'FUTURITY', source: 'once\\s+(?:available|received|signed|finali[sz]ed|approved)', because: 'The submission is conditional on something outstanding.' },
  { kind: 'FUTURITY', source: 'upon\\s+(?:request|receipt|availability)', because: 'The submission is conditional on something outstanding.' },
  { kind: 'FUTURITY', source: 'subject\\s+to\\s+(?:confirmation|approval|agreement|finali[sz]ation)', because: 'The submission is conditional on something outstanding.' },
  { kind: 'FUTURITY', source: 'tbc', because: 'To be confirmed — an undecided value.' },
  { kind: 'FUTURITY', source: 'tbd', because: 'To be determined — an undecided value.' },
  { kind: 'FUTURITY', source: 't\\.b\\.[cd]\\.?', because: 'An undecided value.' },
  { kind: 'FUTURITY', source: 'forthcoming', because: 'The artefact is promised rather than filed.' },
]

/**
 * The draft never got finished.
 *
 * These carry more weight than the phrase families: a bare `XXX` in a dossier is
 * not an editorial choice, it is a document that shipped by mistake.
 */
const PLACEHOLDER: Pattern[] = [
  { kind: 'PLACEHOLDER', source: 'x{3,}', because: 'Placeholder text left in the document.' },
  { kind: 'PLACEHOLDER', source: '\\[\\s*(?:insert|add|complete|enter|name|date|number|amount|tbc|tbd|\\.\\.\\.|x+)[^\\]]{0,40}\\]', because: 'Placeholder text left in the document.' },
  { kind: 'PLACEHOLDER', source: '<\\s*(?:insert|add|complete|enter|name|date|number|amount)[^>]{0,40}>', because: 'Placeholder text left in the document.' },
  { kind: 'PLACEHOLDER', source: '\\{\\{[^}]{1,60}\\}\\}', because: 'An unfilled template field.' },
  { kind: 'PLACEHOLDER', source: '\\.{4,}', because: 'A blank fill-in line was never completed.' },
  { kind: 'PLACEHOLDER', source: '_{4,}', because: 'A blank fill-in line was never completed.' },
  { kind: 'PLACEHOLDER', source: '#{3,}', because: 'Placeholder text left in the document.' },
  { kind: 'PLACEHOLDER', source: 'lorem\\s+ipsum', because: 'Filler text left in the document.' },
  { kind: 'PLACEHOLDER', source: 'comment\\s*\\[[a-z0-9]{1,8}\\]', because: 'A review comment survived into the filed text.' },
  { kind: 'PLACEHOLDER', source: '(?:commented|inserted|deleted)\\s*\\[[a-z0-9]{1,8}\\]', because: 'An unresolved tracked change survived into the filed text.' },
  { kind: 'PLACEHOLDER', source: 'track(?:ed)?\\s+changes?\\s+(?:not\\s+)?(?:accepted|resolved|remaining)', because: 'The document says its own revisions are unresolved.' },
  { kind: 'PLACEHOLDER', source: '(?:author|reviewer|editor)\\s*:\\s*(?:please|check|confirm|verify)', because: 'A note to a colleague survived into the filed text.' },
  { kind: 'PLACEHOLDER', source: 'highlighted\\s+in\\s+yellow', because: 'A note to a colleague survived into the filed text.' },
]

/**
 * Word-boundary rules differ by family.
 *
 * Phrase patterns get `\b` on both sides so "pending" does not fire inside
 * "appending". Placeholder patterns are mostly punctuation, where `\b` either
 * does nothing or actively fails — `\b` before `[` never matches after a space —
 * so they are anchored on their own shape instead.
 */
function compile(p: Pattern): RegExp {
  const needsBoundary = /^[a-z]/.test(p.source)
  const endsAlnum = /[a-z0-9)]$/.test(p.source)
  const body =
    p.kind === 'PLACEHOLDER' && !needsBoundary
      ? p.source
      : `${needsBoundary ? '\\b' : ''}${p.source}${endsAlnum ? '\\b' : ''}`
  return new RegExp(body, 'gi')
}

/**
 * Longest source first, so a specific phrase wins over a substring of itself and
 * the overlap filter below never has to arbitrate between two equally good hits.
 */
const PATTERNS: { pattern: Pattern; re: RegExp }[] = [...ABSENCE, ...FUTURITY, ...PLACEHOLDER]
  .sort((a, b) => b.source.length - a.source.length)
  .map((pattern) => ({ pattern, re: compile(pattern) }))

/** Sentence around an offset, so a finding reads as prose rather than as a token. */
function excerptAround(text: string, start: number, end: number): string {
  const before = text.lastIndexOf('.', start - 1)
  const afterCandidates = [text.indexOf('.', end), text.indexOf('\n', end)].filter((i) => i >= 0)
  const after = afterCandidates.length > 0 ? Math.min(...afterCandidates) : -1
  const from = before >= 0 ? before + 1 : 0
  const to = after >= 0 ? after + 1 : text.length
  const slice = text.slice(from, to).trim().replace(/\s+/g, ' ')
  return slice.length > 240 ? `${slice.slice(0, 237)}…` : slice
}

/**
 * Every match, minus overlaps.
 *
 * Overlap resolution matters more than it looks: "will not be provided" contains
 * "not be provided" *and* "provided", and reporting a writer three findings for
 * one clause is how a linter gets switched off. First match wins, and because
 * patterns are sorted longest-first, first is also most specific.
 */
export function lintSection(text: string): LintFinding[] {
  if (!text.trim()) return []

  const found: LintFinding[] = []
  const taken: [number, number][] = []

  for (const { pattern, re } of PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const start = m.index
      const end = start + m[0].length
      // Zero-width matches would loop for ever; nothing here should produce one,
      // but a future pattern with an all-optional body would.
      if (end === start) {
        re.lastIndex += 1
        continue
      }
      if (taken.some(([s, e]) => start < e && end > s)) continue
      taken.push([start, end])
      found.push({
        kind: pattern.kind,
        phrase: m[0].toLowerCase().replace(/\s+/g, ' '),
        start,
        end,
        excerpt: excerptAround(text, start, end),
        because: pattern.because,
      })
    }
  }

  return found.sort((a, b) => a.start - b.start)
}

/** How many distinct phrases the lint knows about. Shown as coverage in the UI. */
export const LINT_PATTERN_COUNT = PATTERNS.length
