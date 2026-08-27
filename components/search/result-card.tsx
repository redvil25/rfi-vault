import type { SearchHit } from '@/lib/search/manual'
import {
  BAND_GUIDANCE, BAND_LABELS, BAND_STYLE, type ConfidenceBand,
} from '@/lib/search/confidence'

const STATUS_STYLE: Record<string, string> = {
  SUBMITTED: 'bg-ok-soft text-ok',
  APPROVED: 'bg-ok-soft text-ok',
  IN_REVIEW: 'bg-warn-soft text-warn',
  DRAFT: 'bg-accent-soft text-accent',
}

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  IN_REVIEW: 'In review',
  DRAFT: 'Draft',
}

const PHASE_LABEL: Record<string, string> = {
  VALIDATION: 'Validation',
  ASSESSMENT_PART_I: 'Assessment Part I',
  ASSESSMENT_PART_II: 'Assessment Part II',
}

const SUBMISSION_LABEL: Record<string, string> = {
  INITIAL: 'Initial',
  SUBSTANTIAL_MODIFICATION: 'Substantial modification',
  ADDITIONAL_MS: 'Additional Member State',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Highlights query terms in the result text. Escapes the query first — the term
 * is user input and goes into a RegExp.
 */
function Highlighted({ text, query }: { text: string; query?: string }) {
  const terms = (query ?? '')
    .split(/\s+/)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter((t) => t.length > 2)

  if (terms.length === 0) return <>{text}</>

  const parts = text.split(new RegExp(`(${terms.join('|')})`, 'gi'))
  const lowered = new Set(terms.map((t) => t.toLowerCase()))

  return (
    <>
      {parts.map((part, i) =>
        lowered.has(part.toLowerCase()) ? <mark key={i}>{part}</mark> : part,
      )}
    </>
  )
}

/**
 * `confidence` is present only when the semantic leg ran. A keyword-only result
 * has no similarity to band, and inventing one would be worse than omitting it.
 */
export function ResultCard({
  hit,
  query,
}: {
  hit: SearchHit & { confidence?: ConfidenceBand; similarity?: number }
  query?: string
}) {
  const showBand = hit.confidence !== undefined && hit.confidence !== 'NONE'

  const reusable =
    (hit.responseStatus === 'APPROVED' || hit.responseStatus === 'SUBMITTED') &&
    hit.outcome === 'ACCEPTED' &&
    hit.sponsorResponseText

  return (
    <article className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
        {hit.memberState && (
          <span className="rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent">
            {hit.memberState}
          </span>
        )}
        <span
          className={`rounded px-1.5 py-0.5 font-medium ${STATUS_STYLE[hit.responseStatus]}`}
        >
          {STATUS_LABEL[hit.responseStatus]}
        </span>
        <span>{hit.sectionPart === 'PART_I' ? 'Part I' : 'Part II'}</span>
        <span aria-hidden>·</span>
        <span>{hit.section}</span>
        <span aria-hidden>·</span>
        <span>{PHASE_LABEL[hit.phase]}</span>
        <span aria-hidden>·</span>
        <span>{SUBMISSION_LABEL[hit.submissionType]}</span>
        <span aria-hidden>·</span>
        <time dateTime={hit.issuedAt}>{formatDate(hit.issuedAt)}</time>

        {showBand && (
          <span
            className={`ml-auto rounded px-1.5 py-0.5 font-medium ${BAND_STYLE[hit.confidence!]}`}
            title={`cosine similarity ${hit.similarity?.toFixed(3)} — ${BAND_GUIDANCE[hit.confidence!]}`}
          >
            {BAND_LABELS[hit.confidence!]}
          </span>
        )}
      </div>

      <p className="text-[13px] leading-relaxed">
        <span className="font-medium text-muted">Consideration {hit.considerationNumber}. </span>
        <Highlighted text={hit.considerationText} query={query} />
      </p>

      {hit.sponsorResponseText ? (
        <div
          className={`mt-3 rounded-md border-l-2 py-2.5 pl-3.5 text-[13px] leading-relaxed ${
            reusable ? 'border-ok bg-ok-soft/40' : 'border-border bg-background'
          }`}
        >
          <p className="mb-1 text-[11px] font-medium tracking-wide text-muted uppercase">
            {reusable ? 'Approved sponsor response — reusable precedent' : 'Sponsor response'}
          </p>
          <Highlighted text={hit.sponsorResponseText} query={query} />
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-muted italic">No response recorded yet.</p>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-[11px] text-muted">
        <code className="font-mono">{hit.documentRef}</code>
        <span aria-hidden>·</span>
        <span>{hit.shortTitle}</span>
        {hit.impName && (
          <>
            <span aria-hidden>·</span>
            <span className="font-mono">{hit.impName}</span>
          </>
        )}
        {hit.therapeuticArea && (
          <>
            <span aria-hidden>·</span>
            <span>{hit.therapeuticArea}</span>
          </>
        )}
        <span className="ml-auto rounded bg-background px-1.5 py-0.5">
          matched on {hit.matchedOn}
        </span>
      </div>
    </article>
  )
}
