/**
 * Retrieval evaluation harness — Suite A of docs/05-EVALUATION.md.
 *
 *   npm run eval
 *
 * Runs each retrieval configuration over the same gold set, writes
 * docs/metrics/latest.json plus a dated copy for the trend line, and prints the
 * markdown table that goes on the slide.
 *
 * Configurations that cannot run are reported as "not run" with the reason.
 * They are never reported as zero: a zero is a measurement, and printing one for
 * a configuration that never executed would put a false number on a slide.
 *
 * Reads through the service client deliberately. This measures the retriever,
 * not the access-control layer; RLS is verified separately by `npm run verify`.
 */
import '../load-env'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServiceClient } from '../../lib/db/service'
import { aiEnabled } from '../../lib/env'
import { buildGoldSet, type CorpusRow, type GoldQuery, type QueryType } from './gold'
import { mean, ndcgAtK, percentile, recallAtK, reciprocalRankAtK, round } from './metrics'

const K_RECALL = 5
const K_RANK = 10
/** Retrieve deeper than the deepest cutoff so nDCG@10 is never truncated by the fetch. */
const FETCH_DEPTH = 50

type Db = ReturnType<typeof createServiceClient>

interface ConfigResult {
  name: string
  ran: boolean
  reason?: string
  recallAt5?: number
  mrrAt10?: number
  ndcgAt10?: number
  p50Ms?: number
  p95Ms?: number
  byType?: Record<QueryType, { recallAt5: number; ndcgAt10: number; queries: number }>
}

/** Collapses duplicate consideration ids while preserving first-seen rank order. */
function dedupe(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

// ------------------------------------------------------------- retrievers

type Retriever = (query: string) => Promise<string[]>

function keywordRetriever(db: Db): Retriever {
  return async (query) => {
    const { data, error } = await db.rpc('search_considerations', {
      q: query,
      sort: 'relevance',
      lim: FETCH_DEPTH,
      off: 0,
    })
    if (error) throw new Error(`search_considerations: ${error.message}`)
    return dedupe(((data ?? []) as unknown as { id: string }[]).map((r) => r.id))
  }
}

function vectorRetriever(db: Db, embed: (q: string) => Promise<string>): Retriever {
  return async (query) => {
    const { data, error } = await db.rpc('vector_search', {
      query_embed: await embed(query),
      match_count: FETCH_DEPTH,
    })
    if (error) throw new Error(`vector_search: ${error.message}`)
    return dedupe(
      ((data ?? []) as unknown as { consideration_id: string }[]).map((r) => r.consideration_id),
    )
  }
}

function hybridRetriever(
  db: Db,
  embed: (q: string) => Promise<string>,
  rrfK: number,
): Retriever {
  return async (query) => {
    const { data, error } = await db.rpc('hybrid_search', {
      query_text: query,
      query_embed: await embed(query),
      match_count: FETCH_DEPTH,
      rrf_k: rrfK,
    })
    if (error) throw new Error(`hybrid_search: ${error.message}`)
    return dedupe(
      ((data ?? []) as unknown as { consideration_id: string }[]).map((r) => r.consideration_id),
    )
  }
}

// ------------------------------------------------------------------- run

async function evaluate(name: string, gold: GoldQuery[], retrieve: Retriever): Promise<ConfigResult> {
  const recalls: number[] = []
  const rrs: number[] = []
  const ndcgs: number[] = []
  const latencies: number[] = []
  const buckets: Record<QueryType, { recall: number[]; ndcg: number[] }> = {
    identifier: { recall: [], ndcg: [] },
    semantic: { recall: [], ndcg: [] },
    mixed: { recall: [], ndcg: [] },
  }

  for (const q of gold) {
    const relevant = new Set(q.relevant)
    const started = performance.now()
    const ranked = await retrieve(q.query)
    latencies.push(performance.now() - started)

    const recall = recallAtK(ranked, relevant, K_RECALL)
    const ndcg = ndcgAtK(ranked, relevant, K_RANK)
    recalls.push(recall)
    rrs.push(reciprocalRankAtK(ranked, relevant, K_RANK))
    ndcgs.push(ndcg)
    buckets[q.type].recall.push(recall)
    buckets[q.type].ndcg.push(ndcg)
  }

  const byType = Object.fromEntries(
    (Object.keys(buckets) as QueryType[]).map((type) => [
      type,
      {
        recallAt5: round(mean(buckets[type].recall)),
        ndcgAt10: round(mean(buckets[type].ndcg)),
        queries: buckets[type].recall.length,
      },
    ]),
  ) as ConfigResult['byType']

  return {
    name,
    ran: true,
    recallAt5: round(mean(recalls)),
    mrrAt10: round(mean(rrs)),
    ndcgAt10: round(mean(ndcgs)),
    p50Ms: Math.round(percentile(latencies, 50)),
    p95Ms: Math.round(percentile(latencies, 95)),
    byType,
  }
}

function fmt(value: number | undefined): string {
  return value === undefined ? '—' : value.toFixed(3)
}

function markdownTable(results: ConfigResult[]): string {
  const lines = [
    '| Configuration | Recall@5 | MRR@10 | nDCG@10 | p50 | p95 |',
    '|---|---|---|---|---|---|',
  ]
  for (const r of results) {
    lines.push(
      r.ran
        ? `| ${r.name} | ${fmt(r.recallAt5)} | ${fmt(r.mrrAt10)} | ${fmt(r.ndcgAt10)} | ${r.p50Ms} ms | ${r.p95Ms} ms |`
        : `| ${r.name} | not run — ${r.reason} | | | | |`,
    )
  }
  return lines.join('\n')
}

function markdownByType(results: ConfigResult[]): string {
  const ran = results.filter((r) => r.ran && r.byType)
  if (ran.length === 0) return ''
  const types: QueryType[] = ['identifier', 'semantic', 'mixed']
  const lines = [
    `| Query type | ${ran.map((r) => r.name).join(' | ')} |`,
    `|---|${ran.map(() => '---').join('|')}|`,
  ]
  for (const type of types) {
    const counts = ran[0].byType![type].queries
    if (counts === 0) continue
    lines.push(
      `| ${type} (n=${counts}) | ${ran.map((r) => fmt(r.byType![type].recallAt5)).join(' | ')} |`,
    )
  }
  return lines.join('\n')
}

async function loadCorpus(db: Db): Promise<CorpusRow[]> {
  const rows: CorpusRow[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('rfi_consideration')
      .select(
        'id, document_id, trial_id, category, member_state, section, is_seed, rfi_document!inner(document_ref), trial!inner(eu_trial_number)',
      )
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`reading corpus: ${error.message}`)
    if (!data || data.length === 0) break

    for (const r of data as unknown as (Omit<CorpusRow, 'document_ref' | 'eu_trial_number'> & {
      rfi_document: { document_ref: string }
      trial: { eu_trial_number: string }
    })[]) {
      rows.push({
        id: r.id,
        document_id: r.document_id,
        trial_id: r.trial_id,
        category: r.category,
        member_state: r.member_state,
        section: r.section,
        is_seed: r.is_seed,
        document_ref: r.rfi_document.document_ref,
        eu_trial_number: r.trial.eu_trial_number,
      })
    }
    if (data.length < PAGE) break
  }
  return rows
}

async function main() {
  const db = createServiceClient()

  console.log('Reading the corpus…')
  const corpus = await loadCorpus(db)
  if (corpus.length === 0) {
    throw new Error('The corpus is empty. Run `npm run seed` first.')
  }
  console.log(`  ${corpus.length} considerations`)

  const gold = buildGoldSet(corpus, Number(process.env.SEED_RANDOM_SEED ?? 42))
  console.log(`  ${gold.length} gold queries derived from planted structure\n`)

  const { count: embeddingCount } = await db
    .from('rfi_embedding')
    .select('id', { count: 'exact', head: true })

  const results: ConfigResult[] = []

  console.log('Keyword only…')
  results.push(await evaluate('Keyword only (ts_rank_cd)', gold, keywordRetriever(db)))

  const semanticBlocker = !aiEnabled()
    ? 'GOOGLE_GENERATIVE_AI_API_KEY is not set'
    : (embeddingCount ?? 0) === 0
      ? 'rfi_embedding is empty — run `npm run embed`'
      : null

  if (semanticBlocker) {
    results.push({ name: 'Vector only (pgvector cosine)', ran: false, reason: semanticBlocker })
    results.push({ name: 'Hybrid (RRF)', ran: false, reason: semanticBlocker })
  } else {
    const { embedQuery, toVectorLiteral } = await import('../../lib/ai/embed')
    // Each query is embedded once and reused across configurations, so the
    // comparison is not distorted by embedding latency counted twice.
    const cache = new Map<string, string>()
    const embed = async (q: string) => {
      const hit = cache.get(q)
      if (hit) return hit
      const literal = toVectorLiteral(await embedQuery(q))
      cache.set(q, literal)
      return literal
    }

    console.log('Vector only…')
    results.push(await evaluate('Vector only (pgvector cosine)', gold, vectorRetriever(db, embed)))

    const rrfK = Number(process.env.RRF_K ?? 60)
    console.log('Hybrid…')
    results.push(await evaluate(`Hybrid (RRF, k=${rrfK})`, gold, hybridRetriever(db, embed, rrfK)))
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    corpusSize: corpus.length,
    embeddingCount: embeddingCount ?? 0,
    goldQueries: gold.length,
    goldSource: 'derived from seed ground truth — see scripts/eval/gold.ts',
    cutoffs: { recall: K_RECALL, rank: K_RANK },
    results,
  }

  const dir = join('docs', 'metrics')
  mkdirSync(dir, { recursive: true })
  const stamp = payload.generatedAt.slice(0, 10)
  writeFileSync(join(dir, 'latest.json'), JSON.stringify(payload, null, 2) + '\n')
  writeFileSync(join(dir, `${stamp}.json`), JSON.stringify(payload, null, 2) + '\n')

  console.log('\n' + markdownTable(results))
  const byType = markdownByType(results)
  if (byType) console.log('\nRecall@5 by query type:\n\n' + byType)

  console.log(`\nWritten to docs/metrics/latest.json and docs/metrics/${stamp}.json`)
  if (semanticBlocker) {
    console.log(
      `\nOnly the keyword row ran. ${semanticBlocker}.\n` +
        'The ablation table is the argument for hybrid search — it needs all three rows.',
    )
  }
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
