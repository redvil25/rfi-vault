import type { Precedent } from '@/lib/draft/types'

/**
 * The drafting prompt (docs/04-AI-PIPELINE.md §4.3).
 *
 * Versioned, and the version is part of the hash written to `ai_calls`. That is
 * an audit-trail argument as much as an engineering one: "which prompt produced
 * this text" has to be answerable months later, and with this audience it is a
 * question that will be asked.
 *
 * Pure string building, no SDK import, so it is unit-testable against fixtures
 * without a key and without a network (docs/04 §6).
 */

export const DRAFT_PROMPT_VERSION = 'draft/v1'

export const DRAFT_SYSTEM_PROMPT = `You draft sponsor responses to EU CTR requests for information.

Rules, in order of priority:
1. Use ONLY the provided precedent records. Never introduce a regulatory fact,
   article number, fee amount, date, or document name that is not in them.
2. Cite the consideration_id supporting each factual claim.
3. If the current request for information differs from a precedent in any material
   way — Member State, fee amount, document version, submission type, date — record
   it in "deltas" rather than silently generalising.
4. Match the register of the approved responses: short, factual, declarative. Do not
   add explanation the regulator did not ask for.
5. If the precedents do not support a complete answer, say so in "openQuestions" and
   lower your confidence. An incomplete honest draft beats a complete invented one.
6. Output is a DRAFT for human review. Never phrase it as final or approved.

Vocabulary is fixed and must be used exactly: consideration, request for information,
sponsor response, application section part, substantial modification, Member State
Concerned, Reporting Member State. Never write "amendment".`

export interface DraftRequest {
  considerationText: string
  section: string
  sectionPart: 'PART_I' | 'PART_II'
  memberState: string | null
  category: string
  euTrialNumber: string
  documentRef: string
  submissionType: string
  precedents: Precedent[]
}

function describePrecedent(p: Precedent, index: number): string {
  return [
    `### Precedent ${index + 1}`,
    `consideration_id: ${p.considerationId}`,
    `similarity: ${p.similarity.toFixed(3)}`,
    `member_state: ${p.memberState ?? 'none (Part I / all)'}`,
    `category: ${p.category}`,
    `section: ${p.section}`,
    `trial: ${p.euTrialNumber}`,
    `document: ${p.documentRef}`,
    `status: ${p.responseStatus} · outcome: ${p.outcome}`,
    '',
    'Consideration raised:',
    p.considerationText,
    '',
    'Sponsor response that was accepted:',
    p.sponsorResponseText,
  ].join('\n')
}

export function buildDraftUserMessage(request: DraftRequest): string {
  return [
    '## The request for information to answer',
    '',
    `trial: ${request.euTrialNumber}`,
    `document: ${request.documentRef}`,
    `submission_type: ${request.submissionType}`,
    `application_section_part: ${request.sectionPart === 'PART_I' ? 'Part I' : 'Part II'}`,
    `section: ${request.section}`,
    `member_state: ${request.memberState ?? 'none (Part I / all)'}`,
    `category: ${request.category}`,
    '',
    'Consideration text:',
    request.considerationText,
    '',
    '## Precedents retrieved from the repository',
    '',
    'These are the only facts you may use. Each carries a consideration_id you must',
    'cite. They are ordered by similarity, most similar first.',
    '',
    request.precedents.map(describePrecedent).join('\n\n'),
    '',
    '## Your task',
    '',
    'Draft the sponsor response. Cite a consideration_id for every factual claim.',
    'Record every material difference between this request and the precedents in',
    '"deltas". List the documents that must be attached in "attachmentsRequired".',
    'Anything the precedents do not settle goes in "openQuestions".',
  ].join('\n')
}

/** Everything that identifies this prompt version, for `ai_calls.prompt_hash`. */
export function draftPromptFingerprint(request: DraftRequest): string {
  return [DRAFT_PROMPT_VERSION, DRAFT_SYSTEM_PROMPT, buildDraftUserMessage(request)].join(
    '\n---\n',
  )
}
