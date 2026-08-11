/**
 * Deterministic synthetic corpus generator.
 *
 * No model calls. Runs from hand-written skeletons (templates.ts) plus a seeded
 * PRNG, so `npm run seed` reproduces the identical corpus on any machine and
 * works with no AI key configured. Say this on stage — reproducibility is a
 * Technical Implementation point.
 *
 *   npm run seed              # wipe and regenerate
 *   npm run seed -- --keep    # add to what is already there
 *
 * Planted structure (docs/03-DATA-MODEL.md §2.2):
 *   - Pareto category distribution
 *   - an ISTAT fee spike after 17 Feb 2025, for the analytics narrative
 *   - near-duplicate clusters, so "we solved this eleven times" is demonstrable
 *   - identifier-only cases, so keyword search provably beats semantic search
 */

import '../load-env'
import { createServiceClient } from '../../lib/db/service'
import {
  CATEGORIES, MEMBER_STATES, PHASE_WEIGHTS, SUBMISSION_TYPE_WEIGHTS,
  OUTCOME_WEIGHTS, ISTAT_FEE_CHANGE_DATE, CORPUS_DATE_RANGE,
  type Category, type MemberState,
} from '../../lib/domain/taxonomy'
import {
  TEMPLATES, DOCUMENT_NAMES, INVESTIGATORS, SITES, LANGUAGES,
  THERAPEUTIC_AREAS, TRIAL_PHASES, ANNEX_REFS,
} from './templates'

// ------------------------------------------------------------------ Config

const SEED = Number(process.env.SEED_RANDOM_SEED ?? 42)
const TRIALS = 130
const KEEP = process.argv.includes('--keep')

const DEMO_USERS = [
  { email: 'ra.clinical@rfivault.demo',  name: 'Anna Petersen',  team: 'RA_CLINICAL' as const,        ms: null },
  { email: 'affiliate.it@rfivault.demo', name: 'Marco Bianchi',  team: 'AFFILIATE' as const,          ms: 'IT' },
  { email: 'affiliate.es@rfivault.demo', name: 'Lucía Herrera',  team: 'AFFILIATE' as const,          ms: 'ES' },
  { email: 'cta.mgmt@rfivault.demo',     name: 'Jonas Holm',     team: 'CTA_MANAGEMENT' as const,     ms: null },
  { email: 'hub@rfivault.demo',          name: 'Priya Raman',    team: 'EU_SUBMISSION_HUB' as const,  ms: null },
]
const DEMO_PASSWORD = 'RfiVault!Demo2026'

// ------------------------------------------------------------------ PRNG

/** mulberry32 — small, fast, and deterministic across platforms. */
function makeRng(seed: number) {
  let a = seed >>> 0
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rng = makeRng(SEED)

const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1))
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]

function weighted<T>(items: readonly T[], weightOf: (x: T) => number): T {
  const total = items.reduce((s, x) => s + weightOf(x), 0)
  let r = rng() * total
  for (const x of items) {
    r -= weightOf(x)
    if (r <= 0) return x
  }
  return items[items.length - 1]
}

function weightedKey<K extends string>(weights: Record<K, number>): K {
  const keys = Object.keys(weights) as K[]
  return weighted(keys, (k) => weights[k])
}

function dateBetween(from: Date, to: Date): Date {
  return new Date(from.getTime() + rng() * (to.getTime() - from.getTime()))
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)

// ------------------------------------------------------------------ Slots

function fillSlots(
  text: string,
  ctx: { ms: MemberState; section: string; issuedAt: Date },
): string {
  const docNames = DOCUMENT_NAMES[ctx.section] ?? ['the submitted document']
  const version = `${int(1, 5)}.${int(0, 9)}`
  const amount = `EUR ${(int(120, 4800) * 10).toLocaleString('en-GB')}`
  const slotDate = dateBetween(addDays(ctx.issuedAt, -540), ctx.issuedAt)

  return text
    .replaceAll('{ms}', ctx.ms.code)
    .replaceAll('{msName}', ctx.ms.name)
    .replaceAll('{doc}', pick(docNames))
    .replaceAll('{ver}', version)
    .replaceAll('{date}', slotDate.toLocaleDateString('en-GB'))
    .replaceAll('{amount}', amount)
    .replaceAll('{site}', pick(SITES.filter((s) => s.startsWith(ctx.ms.code)).length
      ? SITES.filter((s) => s.startsWith(ctx.ms.code))
      : SITES))
    .replaceAll('{pi}', pick(INVESTIGATORS))
    .replaceAll('{lang}', LANGUAGES[ctx.ms.code] ?? 'the local language')
    .replaceAll('{pol}', `POL${int(100000, 999999)}`)
    .replaceAll('{annex}', pick(ANNEX_REFS))
    .replaceAll('{year}', String(ctx.issuedAt.getFullYear() - 1))
}

const TEMPLATE_BY_CATEGORY = new Map(TEMPLATES.map((t) => [t.category, t]))

// ------------------------------------------------------------------ Types

interface TrialRow {
  eu_trial_number: string
  short_title: string
  therapeutic_area: string
  phase: string
  sponsor: string
  member_states: string[]
}

interface DocRow {
  trialIndex: number
  document_ref: string
  submission_type: 'INITIAL' | 'SUBSTANTIAL_MODIFICATION' | 'ADDITIONAL_MS'
  phase: 'VALIDATION' | 'ASSESSMENT_PART_I' | 'ASSESSMENT_PART_II'
  reporting_ms: string
  issued_at: string
  due_at: string
  responded_at: string | null
}

interface ConsRow {
  docIndex: number
  trialIndex: number
  consideration_number: number
  section_part: 'PART_I' | 'PART_II'
  section: string
  document_name: string
  member_state: string
  category: string
  consideration_text: string
  sponsor_response_text: string | null
  response_status: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'SUBMITTED'
  outcome: 'ACCEPTED' | 'FOLLOW_UP_RFI' | 'UNKNOWN'
  owner_team: Category['owner']
  is_seed: boolean
}

// ------------------------------------------------------------------ Generate

function generate() {
  const trials: TrialRow[] = []
  const docs: DocRow[] = []
  const cons: ConsRow[] = []

  for (let t = 0; t < TRIALS; t++) {
    const area = pick(THERAPEUTIC_AREAS)
    const nStates = int(3, 9)
    const states: string[] = []
    while (states.length < nStates) {
      const ms = weighted(MEMBER_STATES, (m) => m.weight).code
      if (!states.includes(ms)) states.push(ms)
    }

    const year = int(2023, 2026)
    trials.push({
      eu_trial_number: `${year}-${String(int(500000, 599999))}-${int(10, 42)}-00`,
      short_title: `A ${pick(TRIAL_PHASES)} Trial of NN-${int(1000, 9999)} in ${area}`,
      therapeutic_area: area,
      phase: pick(TRIAL_PHASES),
      sponsor: 'Sponsor A',
      member_states: states,
    })

    // 1-4 RFI documents per trial.
    const nDocs = int(1, 4)
    for (let d = 0; d < nDocs; d++) {
      const submissionType = weightedKey(SUBMISSION_TYPE_WEIGHTS)
      const rfiPhase = weightedKey(PHASE_WEIGHTS)
      const issuedAt = dateBetween(CORPUS_DATE_RANGE.from, CORPUS_DATE_RANGE.to)
      // Validation clocks are short; assessment RFIs allow 12 days.
      const dueDays = rfiPhase === 'VALIDATION' ? 10 : 12
      const respondedOffset = int(2, dueDays)

      const smSuffix =
        submissionType === 'SUBSTANTIAL_MODIFICATION'
          ? `-SM${String(int(1, 12)).padStart(2, '0')}`
          : ''

      docs.push({
        trialIndex: t,
        document_ref: `CT-${trials[t].eu_trial_number}${smSuffix}-${String(d + 1).padStart(3, '0')}`,
        submission_type: submissionType,
        phase: rfiPhase,
        reporting_ms: pick(states),
        issued_at: issuedAt.toISOString(),
        due_at: addDays(issuedAt, dueDays).toISOString(),
        responded_at: rng() < 0.9 ? addDays(issuedAt, respondedOffset).toISOString() : null,
      })

      const docIndex = docs.length - 1
      const nCons = int(1, 5)

      for (let c = 0; c < nCons; c++) {
        // Categories are Pareto-weighted, so the top few dominate — as in reality.
        const category = weighted(CATEGORIES, (x) => x.weight)
        const msCode = pick(states)
        const ms = MEMBER_STATES.find((m) => m.code === msCode)!
        cons.push(
          buildConsideration(category, ms, docIndex, t, c + 1, issuedAt, false),
        )
      }
    }
  }

  plantIstatSpike(trials, docs, cons)
  plantDuplicateCluster(trials, docs, cons)

  return { trials, docs, cons }
}

function buildConsideration(
  category: Category,
  ms: MemberState,
  docIndex: number,
  trialIndex: number,
  number: number,
  issuedAt: Date,
  isPlanted: boolean,
): ConsRow {
  const section = pick(category.sections)
  const tpl = TEMPLATE_BY_CATEGORY.get(category.id)!
  const ctx = { ms, section, issuedAt }

  // Most responses are approved and accepted — an unresolved corpus would not
  // be usable as precedent, which is the whole point of the repository.
  const outcome = weightedKey(OUTCOME_WEIGHTS)
  const r = rng()
  const status = r < 0.72 ? 'SUBMITTED' : r < 0.9 ? 'APPROVED' : r < 0.96 ? 'IN_REVIEW' : 'DRAFT'
  const answered = status === 'SUBMITTED' || status === 'APPROVED' || rng() < 0.5

  return {
    docIndex,
    trialIndex,
    consideration_number: number,
    section_part: category.part,
    section,
    document_name: pick(DOCUMENT_NAMES[section] ?? ['Submitted document']),
    member_state: ms.code,
    category: category.id,
    consideration_text: fillSlots(pick(tpl.consideration), ctx),
    sponsor_response_text: answered ? fillSlots(pick(tpl.response), ctx) : null,
    response_status: status,
    outcome: answered ? outcome : 'UNKNOWN',
    owner_team: category.owner,
    is_seed: isPlanted,
  }
}

/**
 * Narrative beat: Italy revised its fee with effect from 17 Feb 2025 and the
 * same RFI then arrived repeatedly over the following weeks. Gives the
 * analytics dashboard a story instead of noise (docs/06-DEMO-AND-DECK.md beat 7).
 */
function plantIstatSpike(trials: TrialRow[], docs: DocRow[], cons: ConsRow[]) {
  const italy = MEMBER_STATES.find((m) => m.code === 'IT')!
  const category = CATEGORIES.find((c) => c.id === 'FEE_NATIONAL_UPDATE')!
  const spikeEnd = addDays(ISTAT_FEE_CHANGE_DATE, 60)

  for (let i = 0; i < 26; i++) {
    const trialIndex = int(0, trials.length - 1)
    const issuedAt = dateBetween(ISTAT_FEE_CHANGE_DATE, spikeEnd)

    docs.push({
      trialIndex,
      document_ref: `CT-${trials[trialIndex].eu_trial_number}-SM${String(int(1, 9)).padStart(2, '0')}-${String(900 + i)}`,
      submission_type: 'SUBSTANTIAL_MODIFICATION',
      phase: 'VALIDATION',
      reporting_ms: 'IT',
      issued_at: issuedAt.toISOString(),
      due_at: addDays(issuedAt, 10).toISOString(),
      responded_at: addDays(issuedAt, int(2, 9)).toISOString(),
    })

    cons.push(
      buildConsideration(category, italy, docs.length - 1, trialIndex, 1, issuedAt, true),
    )
  }
}

/**
 * A tight cluster of the same underlying issue phrased differently across
 * Member States — this is what makes the "solved eleven times already"
 * recurrence moment land in the demo.
 */
function plantDuplicateCluster(trials: TrialRow[], docs: DocRow[], cons: ConsRow[]) {
  const category = CATEGORIES.find((c) => c.id === 'DOC_TRANSLATION_MISSING')!
  const states = ['IT', 'ES', 'DE', 'FR', 'PL', 'CZ', 'HU', 'PT', 'NL', 'BE', 'DK']

  states.forEach((code, i) => {
    const ms = MEMBER_STATES.find((m) => m.code === code)!
    const trialIndex = int(0, trials.length - 1)
    const issuedAt = dateBetween(new Date('2024-06-01'), new Date('2026-06-01'))

    docs.push({
      trialIndex,
      document_ref: `CT-${trials[trialIndex].eu_trial_number}-${String(800 + i)}`,
      submission_type: 'INITIAL',
      phase: 'VALIDATION',
      reporting_ms: code,
      issued_at: issuedAt.toISOString(),
      due_at: addDays(issuedAt, 10).toISOString(),
      responded_at: addDays(issuedAt, int(3, 9)).toISOString(),
    })

    cons.push(
      buildConsideration(category, ms, docs.length - 1, trialIndex, 1, issuedAt, true),
    )
  })
}

// ------------------------------------------------------------------ Users

async function seedUsers(db: ReturnType<typeof createServiceClient>) {
  for (const u of DEMO_USERS) {
    const { data, error } = await db.auth.admin.createUser({
      email: u.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: u.name },
    })

    let userId = data?.user?.id
    if (error) {
      if (!/already/i.test(error.message)) throw error
      const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 200 })
      userId = list?.users.find((x) => x.email === u.email)?.id
    }
    if (!userId) throw new Error(`could not resolve user id for ${u.email}`)

    const { error: pErr } = await db.from('user_profile').upsert({
      id: userId,
      full_name: u.name,
      team: u.team,
      member_state: u.ms,
    })
    if (pErr) throw pErr
  }
  console.log(`  users        ${DEMO_USERS.length} (password: ${DEMO_PASSWORD})`)
}

// ------------------------------------------------------------------ Insert

async function chunked<T>(rows: T[], size: number, fn: (batch: T[]) => Promise<void>) {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size))
  }
}

async function main() {
  const db = createServiceClient()

  if (!KEEP) {
    console.log('Clearing existing corpus...')
    // Cascades to rfi_document -> rfi_consideration -> rfi_embedding.
    await db.from('trial').delete().neq('eu_trial_number', '')
  }

  console.log(`Generating (seed=${SEED})...`)
  const { trials, docs, cons } = generate()

  const trialIds: string[] = []
  await chunked(trials, 200, async (batch) => {
    const { data, error } = await db.from('trial').insert(batch).select('id')
    if (error) throw error
    trialIds.push(...data.map((r) => r.id))
  })

  const docIds: string[] = []
  await chunked(docs, 200, async (batch) => {
    const { data, error } = await db
      .from('rfi_document')
      .insert(batch.map((d) => ({
        trial_id: trialIds[d.trialIndex],
        document_ref: d.document_ref,
        submission_type: d.submission_type,
        phase: d.phase,
        reporting_ms: d.reporting_ms,
        issued_at: d.issued_at,
        due_at: d.due_at,
        responded_at: d.responded_at,
      })))
      .select('id')
    if (error) throw error
    docIds.push(...data.map((r) => r.id))
  })

  // consideration_number must be unique within a document.
  const seen = new Map<number, number>()
  const consPayload = cons.map((c) => {
    const n = (seen.get(c.docIndex) ?? 0) + 1
    seen.set(c.docIndex, n)
    return {
      document_id: docIds[c.docIndex],
      trial_id: trialIds[c.trialIndex],
      consideration_number: n,
      section_part: c.section_part,
      section: c.section,
      document_name: c.document_name,
      member_state: c.member_state,
      category: c.category,
      consideration_text: c.consideration_text,
      sponsor_response_text: c.sponsor_response_text,
      response_status: c.response_status,
      outcome: c.outcome,
      owner_team: c.owner_team,
      is_seed: c.is_seed,
    }
  })

  await chunked(consPayload, 500, async (batch) => {
    const { error } = await db.from('rfi_consideration').insert(batch)
    if (error) throw error
  })

  await seedUsers(db)

  console.log('\nSeeded:')
  console.log(`  trials       ${trials.length}`)
  console.log(`  documents    ${docs.length}`)
  console.log(`  considerations ${consPayload.length}`)
  console.log('\nDone. Corpus is synthetic and reproducible with the same seed.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
