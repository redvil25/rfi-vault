/**
 * Populates rfi_embedding — the semantic half of hybrid search (ADR-003).
 *
 *   npm run embed             # embed everything not yet embedded
 *   npm run embed -- --force  # re-embed everything (after a model change)
 *   npm run embed -- --limit 50
 *
 * Two vectors per consideration, one for the question and one for the answer,
 * because users search in both spaces: "what did Italy ask about fees" matches
 * the consideration, "proof of payment attached" matches the response.
 *
 * Resumable on purpose. It writes each batch as it completes, so a quota error
 * halfway through costs only the unwritten batch — re-running picks up exactly
 * where it stopped.
 */
import '../load-env'
import { createServiceClient } from '../../lib/db/service'
import { embedDocuments, toVectorLiteral } from '../../lib/ai/embed'
import { aiEnabled } from '../../lib/env'
import { AiDisabledError } from '../../lib/ai/client'

const FORCE = process.argv.includes('--force')
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit')
  if (i === -1) return null
  const n = Number(process.argv[i + 1])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
})()

/** Written in one batch per call so a mid-run failure loses at most this many. */
const WRITE_BATCH = 96

interface Pending {
  consideration_id: string
  kind: 'CONSIDERATION' | 'RESPONSE'
  content: string
}

async function main() {
  if (!aiEnabled()) {
    throw new AiDisabledError('Embedding the corpus')
  }

  const db = createServiceClient()

  console.log('Reading considerations…')
  const rows: {
    id: string
    consideration_text: string
    sponsor_response_text: string | null
  }[] = []

  // PostgREST caps a response at 1000 rows; page rather than silently truncate.
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('rfi_consideration')
      .select('id, consideration_text, sponsor_response_text')
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`reading considerations: ${error.message}`)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  console.log(`  ${rows.length} considerations`)

  let existing = new Set<string>()
  if (!FORCE) {
    const seen: { consideration_id: string; kind: string }[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('rfi_embedding')
        .select('consideration_id, kind')
        .range(from, from + PAGE - 1)
      if (error) throw new Error(`reading existing embeddings: ${error.message}`)
      if (!data || data.length === 0) break
      seen.push(...data)
      if (data.length < PAGE) break
    }
    existing = new Set(seen.map((e) => `${e.consideration_id}:${e.kind}`))
    console.log(`  ${existing.size} already embedded`)
  } else {
    console.log('  --force: re-embedding everything')
  }

  const pending: Pending[] = []
  for (const row of rows) {
    const candidates: Pending[] = [
      { consideration_id: row.id, kind: 'CONSIDERATION', content: row.consideration_text },
    ]
    if (row.sponsor_response_text?.trim()) {
      candidates.push({
        consideration_id: row.id,
        kind: 'RESPONSE',
        content: row.sponsor_response_text,
      })
    }
    for (const c of candidates) {
      if (!c.content?.trim()) continue
      if (existing.has(`${c.consideration_id}:${c.kind}`)) continue
      pending.push(c)
    }
  }

  const work = LIMIT ? pending.slice(0, LIMIT) : pending
  if (work.length === 0) {
    console.log('\nNothing to embed. Everything is up to date.')
    return
  }

  console.log(`\nEmbedding ${work.length} texts…`)
  const started = Date.now()
  let written = 0
  let tokens = 0

  for (let i = 0; i < work.length; i += WRITE_BATCH) {
    const batch = work.slice(i, i + WRITE_BATCH)
    const { embeddings, inputTokens } = await embedDocuments(batch.map((b) => b.content))
    if (inputTokens != null) tokens += inputTokens

    const { error } = await db.from('rfi_embedding').upsert(
      batch.map((b, j) => ({
        consideration_id: b.consideration_id,
        kind: b.kind,
        content: b.content,
        embedding: toVectorLiteral(embeddings[j]),
      })),
      { onConflict: 'consideration_id,kind' },
    )
    if (error) throw new Error(`writing embeddings: ${error.message}`)

    written += batch.length
    process.stdout.write(`\r  ${written}/${work.length}`)
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\n\nDone. ${written} embeddings in ${seconds}s${tokens ? `, ${tokens} input tokens` : ''}.`)
  console.log('Every call is recorded in ai_calls. Run `npm run eval` for the retrieval table.')
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
