import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { serverEnv } from '@/lib/env'
import { log } from '@/lib/log'
import { generateSuggestions } from '@/lib/ai/suggest'
import { verifyDraft } from '@/lib/ai/draft'
import { groundednessOf } from '@/lib/ai/prompts/verify'
import {
  escalateTo,
  passesConfidenceGate,
  refusalReason,
  retrievePrecedents,
} from '@/lib/draft/retrieve'
import type { Precedent } from '@/lib/draft/types'
import { lintSection } from '@/lib/precheck/lint'
import { parseRequest } from './parse'
import { STRATEGIES, type GradedOption, type SuggestOutcome, type SuggestionOption } from './types'

/**
 * Feature 6, end to end (docs/04-AI-PIPELINE.md §5).
 *
 * Same order as Feature 3, for the same reason: retrieve, then gate, then
 * generate. Nothing reaches the model until the repository has proved it holds
 * something close enough to answer from. A pipeline that generates first and
 * checks after has already produced the text it was supposed to refuse to
 * produce (ADR-005).
 *
 * The difference from Feature 3 is what comes out. That produces one draft for a
 * filed consideration inside the status machine; this produces up to three
 * strategically distinct options for a request that just arrived and is not in
 * the repository yet. Nothing here writes to `rfi_consideration` — the request
 * is the user's paste, not a record — so there is no status to move and nothing
 * to approve.
 */

export interface SuggestInput {
  text: string
  /** Whatever the user picked. Always beats the classifier: they can see the document. */
  section: string | null
}

export interface SuggestOptions {
  actorId: string
  /** Skips the verifier. Only the verification script sets this. */
  skipVerification?: boolean
}

/**
 * Grade every option against the same precedents it was built from.
 *
 * Run per option rather than over the three concatenated, because a verdict on
 * "the third sentence" is meaningless if the grader cannot tell which option it
 * belongs to. Three calls to the stronger model is the price of a groundedness
 * figure that means something per option.
 *
 * A verifier failure degrades to ungraded rather than failing the request. The
 * options are still grounded — the schema forced a citation on each — and the UI
 * says plainly that they were not checked, which is the honest reading of a
 * missing grade (ADR-025).
 */
async function grade(
  options: SuggestionOption[],
  precedents: Precedent[],
  skip: boolean,
): Promise<{ graded: GradedOption[]; verifierUnavailable: string | null }> {
  if (skip) {
    return {
      graded: options.map((o) => ({ ...o, groundedness: null, verdicts: [] })),
      verifierUnavailable: 'verification was skipped for this run',
    }
  }

  const results = await Promise.allSettled(
    options.map((o) => verifyDraft(o.draft, precedents)),
  )

  let failure: string | null = null
  const graded = options.map((option, i) => {
    const result = results[i]
    if (result.status === 'rejected') {
      log.warn('suggest.verify_failed', { strategy: option.strategy }, result.reason)
      failure ??= 'the verifier could not be reached'
      return { ...option, groundedness: null, verdicts: [] }
    }
    return {
      ...option,
      groundedness: groundednessOf(result.value.sentences),
      verdicts: result.value.sentences,
    }
  })

  return { graded, verifierUnavailable: failure }
}

/**
 * Order the options the way a writer reads them.
 *
 * By strategy, not by the model's confidence. The three moves have a natural
 * order — supply it, argue you already did, promise a date — and shuffling them
 * between runs on a confidence score the user cannot see makes the screen feel
 * arbitrary. Confidence is shown on each card instead, where it can be judged.
 */
function inStrategyOrder(options: GradedOption[]): GradedOption[] {
  return [...options].sort(
    (a, b) => STRATEGIES.indexOf(a.strategy) - STRATEGIES.indexOf(b.strategy),
  )
}

/**
 * Drop options that are not answers.
 *
 * Two failures seen from real models, neither of which the schema can catch
 * because both produce well-formed strings:
 *
 *   Placeholders. A draft reading "referencing [INSERT_REFERENCE_NUMBER]" is
 *   text the pre-submission check would flag as a blocker the moment it were
 *   pasted into a dossier. Suggesting it would have this product handing a
 *   writer the exact defect its other feature exists to catch, so Feature 2's
 *   own lint is the judge here — one implementation, one standard.
 *
 *   Non-answers. One model returned an option whose entire draft was "N/A",
 *   with a paragraph in `risk` explaining that the strategy was unsupported.
 *   That is a refusal wearing an option's clothes, and it graded 100% for
 *   groundedness because it asserts nothing.
 */
function isUsableDraft(draft: string): boolean {
  const text = draft.trim()
  if (text.length < 25) return false
  if (/^(n\/?a|none|not applicable|no response)/i.test(text)) return false
  return !lintSection(text).some((f) => f.kind === 'PLACEHOLDER')
}

/** Two options with the same strategy is a model that ignored the instruction. Keep the first. */
function dedupe(options: SuggestionOption[]): SuggestionOption[] {
  const seen = new Set<string>()
  return options.filter((o) => {
    const key = `${o.strategy}::${o.draft.trim().slice(0, 120).toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function suggestResponses(
  input: SuggestInput,
  supabase: SupabaseClient<Database>,
  options: SuggestOptions,
): Promise<SuggestOutcome> {
  const parsed = parseRequest(input.text, input.section)

  // Retrieval narrows by application section. One section when it is known,
  // the category's own set when it legitimately spans a few — proof of payment
  // is filed under both Regulatory and Cover Letter, and refusing on that was a
  // bug, not caution. It refuses only when the category narrows nothing.
  if (parsed.sectionCandidates.length === 0 || !parsed.sectionPart) {
    return {
      refused: true,
      reason:
        'The application section could not be narrowed from this text, and precedent is ' +
        'retrieved per section. Choose the section above and run it again — a suggestion built ' +
        'from another section’s precedent would look right and be wrong.',
      escalateTo: escalateTo(parsed.category),
      nearest: [],
      maxSimilarity: null,
      parsed,
    }
  }

  const retrieval = await retrievePrecedents(
    {
      // No id: the paste is not a record. The field exists to drop self-matches,
      // and a request that is not in the repository cannot match itself.
      considerationId: '',
      considerationText: parsed.text,
      section: parsed.section ?? parsed.sectionCandidates[0],
      sectionPart: parsed.sectionPart,
      memberState: parsed.memberState,
      category: parsed.category,
      // Only when there is genuinely more than one, so Feature 3's behaviour and
      // the single-section case stay on the narrower SQL filter.
      sectionCandidates:
        parsed.sectionCandidates.length > 1 ? parsed.sectionCandidates : undefined,
    },
    supabase,
  )

  if (!retrieval.ok) {
    return {
      refused: true,
      reason: retrieval.reason,
      escalateTo: escalateTo(parsed.category),
      nearest: retrieval.precedents,
      maxSimilarity: retrieval.maxSimilarity,
      parsed,
    }
  }

  const threshold = serverEnv().DRAFT_LEXICAL_THRESHOLD
  if (!passesConfidenceGate(retrieval.maxSimilarity, threshold)) {
    return {
      refused: true,
      reason: refusalReason(retrieval.maxSimilarity, threshold),
      escalateTo: escalateTo(parsed.category),
      nearest: retrieval.precedents.slice(0, 3),
      maxSimilarity: retrieval.maxSimilarity,
      parsed,
    }
  }

  let generation
  try {
    generation = await generateSuggestions({
      considerationText: parsed.text,
      section: parsed.section ?? parsed.sectionCandidates.join(' or '),
      sectionPart: parsed.sectionPart,
      memberState: parsed.memberState,
      category: parsed.category,
      precedents: retrieval.precedents,
    })
  } catch (err) {
    log.error('suggest.generate_failed', { section: parsed.section }, err)
    return {
      refused: true,
      reason:
        'The model could not produce options for this request. Nothing was written, and the ' +
        'precedent below is what the repository holds — it is still usable on its own.',
      escalateTo: escalateTo(parsed.category),
      nearest: retrieval.precedents.slice(0, 3),
      maxSimilarity: retrieval.maxSimilarity,
      parsed,
    }
  }

  // A citation naming a record that was not retrieved is a fabricated reference,
  // and it is the one failure the schema cannot catch on its own. Drop the
  // citation rather than the option: the remaining ones may still carry it, and
  // the verifier grades what is left.
  const retrievedIds = new Set(retrieval.precedents.map((p) => p.considerationId))
  const cleaned = dedupe(generation.payload.options).map((o) => ({
    ...o,
    citations: o.citations.filter((c) => retrievedIds.has(c.considerationId)),
  }))

  const usable = cleaned.filter((o) => o.citations.length > 0 && isUsableDraft(o.draft))
  if (usable.length === 0) {
    log.warn('suggest.all_citations_invalid', { section: parsed.section })
    return {
      refused: true,
      reason:
        'No option survived checking. They either cited records that were not retrieved, or ' +
        'contained placeholder text this repository would flag as a blocker in a real dossier. ' +
        'They are discarded rather than shown — an uncheckable or unusable suggestion is worse ' +
        'than none.',
      escalateTo: escalateTo(parsed.category),
      nearest: retrieval.precedents.slice(0, 3),
      maxSimilarity: retrieval.maxSimilarity,
      parsed,
    }
  }

  const { graded, verifierUnavailable } = await grade(
    usable,
    retrieval.precedents,
    options.skipVerification ?? false,
  )

  return {
    refused: false,
    options: inStrategyOrder(graded),
    openQuestions: generation.payload.openQuestions,
    precedents: retrieval.precedents,
    maxSimilarity: retrieval.maxSimilarity,
    parsed,
    model: generation.model,
    verifierUnavailable,
  }
}
