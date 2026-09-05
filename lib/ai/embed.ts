import { embedMany } from 'ai'
import { google } from '@ai-sdk/google'
import { log } from '@/lib/log'
import { remoteEmbeddings, serverEnv } from '@/lib/env'
import { LOCAL_EMBEDDING_BATCH, embedLocally } from './embed-local'
import {
  costUsd, models, recordAiCall, type AiPurpose,
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

/**
 * One batch, from whichever embedder is available.
 *
 * Gemini when a Google key is present, the local sentence-transformer
 * otherwise. Both land in `ai_calls` — the local one at zero cost and with a
 * model name that says where it ran, because a run whose embeddings came from a
 * different model is a run whose retrieval numbers are not comparable, and the
 * telemetry has to be able to say which was which.
 */
async function embedBatch(
  values: string[],
  task: EmbeddingTask,
  purpose: AiPurpose,
): Promise<EmbedResult> {
  if (!remoteEmbeddings()) return embedBatchLocally(values, purpose)

  // Declared 'gemini' with no usable key is a misconfiguration, not a reason to
  // quietly fall back: falling back would embed this query in a different space
  // from the corpus and return confident nonsense.
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error(
      'EMBEDDING_PROVIDER is "gemini" but GOOGLE_GENERATIVE_AI_API_KEY is not set. Set the key, ' +
        'or set EMBEDDING_PROVIDER=local and re-run `npm run embed` so the corpus and the query ' +
        'are embedded by the same model.',
    )
  }

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

async function embedBatchLocally(values: string[], purpose: AiPurpose): Promise<EmbedResult> {
  const model = `local:${serverEnv().LOCAL_EMBEDDING_MODEL}`
  const started = performance.now()

  try {
    const embeddings = await embedLocally(values)
    const latencyMs = Math.round(performance.now() - started)
    await recordAiCall({
      purpose,
      model,
      // No tokens and no cost: it ran here. Recording an invented figure would
      // corrupt the cost-per-RFI number the Business Impact slide reads from
      // this table.
      inputTokens: null,
      latencyMs,
      costUsd: 0,
      success: true,
    })
    return { embeddings, inputTokens: null, latencyMs }
  } catch (err) {
    await recordAiCall({
      purpose,
      model,
      latencyMs: Math.round(performance.now() - started),
      success: false,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

/**
 * Embeds many texts, in batches, preserving input order.
 *
 * No `requireAi` any more: embeddings are a separate capability from text
 * generation and the local model needs no key. Conflating the two was a real
 * bug — a Groq key made `aiEnabled()` true while semantic retrieval stayed
 * impossible, because Groq serves no embedding model.
 */
export async function embedDocuments(values: string[]): Promise<EmbedResult> {
  if (values.length === 0) return { embeddings: [], inputTokens: 0, latencyMs: 0 }

  const embeddings: number[][] = []
  let inputTokens = 0
  let latencyMs = 0
  let sawTokens = false

  const batchSize = remoteEmbeddings() ? BATCH_SIZE : LOCAL_EMBEDDING_BATCH
  for (let i = 0; i < values.length; i += batchSize) {
    const batch = values.slice(i, i + batchSize)
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

/** Embeds one search query. Same model as the corpus, query-side task type. */
export async function embedQuery(query: string): Promise<number[]> {
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
