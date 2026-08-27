import { embedMany } from 'ai'
import { google } from '@ai-sdk/google'
import { log } from '@/lib/log'
import {
  costUsd, models, recordAiCall, requireAi, type AiPurpose,
} from './client'

/**
 * Not `import 'server-only'`: the seed, embed and eval scripts import this
 * module legitimately, and that marker only resolves inside the Next bundler —
 * under tsx it throws on import and hides the real error. A runtime check gives
 * the same protection where it actually matters. Same reasoning as
 * lib/db/service.ts.
 */
if (typeof window !== 'undefined') {
  throw new Error('lib/ai must never run in the browser')
}

/**
 * Embeddings for the semantic half of hybrid search.
 *
 * Two things here are deliberate and worth defending in the demo.
 *
 * `taskType` — Gemini embeds a document and a query into deliberately different
 * projections of the same space. Passing RETRIEVAL_DOCUMENT when indexing and
 * RETRIEVAL_QUERY when searching is a free retrieval gain; using one setting for
 * both is the most common way teams leave quality on the table.
 *
 * `outputDimensionality` — 768, matching `vector(768)` in 0003_core.sql. A
 * mismatch is not a soft failure: the insert is rejected by Postgres. The check
 * below turns that into a clear error at the point of the mistake.
 */

export type EmbeddingTask = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'

/** Gemini's embedding endpoint takes batches; this is well inside its limit. */
const BATCH_SIZE = 96

export interface EmbedResult {
  embeddings: number[][]
  inputTokens: number | null
  latencyMs: number
}

async function embedBatch(
  values: string[],
  task: EmbeddingTask,
  purpose: AiPurpose,
): Promise<EmbedResult> {
  const { embedding: model, embeddingDim } = models()
  const started = performance.now()

  try {
    const result = await embedMany({
      model: google.textEmbedding(model),
      values,
      maxRetries: 3,
      providerOptions: {
        google: { outputDimensionality: embeddingDim, taskType: task },
      },
    })

    const latencyMs = Math.round(performance.now() - started)
    const inputTokens = result.usage?.tokens ?? null

    for (const [i, vector] of result.embeddings.entries()) {
      if (vector.length !== embeddingDim) {
        throw new Error(
          `${model} returned ${vector.length} dimensions for value ${i}, but the ` +
            `rfi_embedding column is vector(${embeddingDim}). Check EMBEDDING_DIM ` +
            'and the outputDimensionality provider option — they must agree.',
        )
      }
    }

    await recordAiCall({
      purpose,
      model,
      inputTokens,
      latencyMs,
      costUsd: costUsd(purpose, inputTokens),
      success: true,
    })

    return { embeddings: result.embeddings as number[][], inputTokens, latencyMs }
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started)
    await recordAiCall({
      purpose,
      model,
      latencyMs,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

/**
 * Embeds many texts, in batches, preserving input order.
 *
 * Throws `AiDisabledError` when no key is configured rather than returning
 * empty vectors — a silent zero vector would poison the index and look like a
 * retrieval bug weeks later.
 */
export async function embedDocuments(values: string[]): Promise<EmbedResult> {
  requireAi('Embedding the corpus')
  if (values.length === 0) return { embeddings: [], inputTokens: 0, latencyMs: 0 }

  const embeddings: number[][] = []
  let inputTokens = 0
  let latencyMs = 0
  let sawTokens = false

  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const batch = values.slice(i, i + BATCH_SIZE)
    const result = await embedBatch(batch, 'RETRIEVAL_DOCUMENT', 'EMBED')
    embeddings.push(...result.embeddings)
    if (result.inputTokens != null) {
      inputTokens += result.inputTokens
      sawTokens = true
    }
    latencyMs += result.latencyMs
    log.info('ai.embed_batch', {
      done: embeddings.length,
      total: values.length,
      ms: result.latencyMs,
    })
  }

  return { embeddings, inputTokens: sawTokens ? inputTokens : null, latencyMs }
}

/** Embeds one search query. Same model, query-side task type. */
export async function embedQuery(query: string): Promise<number[]> {
  requireAi('Semantic search')
  const { embeddings } = await embedBatch([query], 'RETRIEVAL_QUERY', 'EMBED')
  return embeddings[0]
}

/**
 * pgvector accepts a bracketed list over the wire. Supabase's client sends this
 * column as a string; passing a JS array yields a type error from Postgres.
 */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`
}
