import { serverEnv } from '@/lib/env'
import { log } from '@/lib/log'

/**
 * The local embedding fallback promised in docs/04-AI-PIPELINE.md §1.
 *
 * Groq, which is the generation provider this project can actually get a key
 * for, serves no embedding model at all. Without one there is no cosine
 * similarity, without that there is no confidence gate, and without the gate
 * Features 3 and 6 have nothing to refuse on — so they refuse everything. A
 * local sentence-transformer is what makes semantic retrieval independent of
 * whoever is serving text generation this week (ADR-035).
 *
 * Two properties worth saying out loud to this audience:
 *
 *   Nothing leaves the machine. Embedding a sponsor's draft text is a data
 *   transfer to a third party; doing it locally is not. For a company that
 *   pins its database to Frankfurt, that is the more defensible arrangement,
 *   not merely the cheaper one.
 *
 *   It costs nothing and needs no key, so `npm run seed && npm run embed`
 *   reproduces the whole corpus on a laptop with no account anywhere.
 *
 * The model is `Xenova/all-mpnet-base-v2` — 768 dimensions, matching
 * `vector(768)` in 0003_core.sql. The more common all-MiniLM-L6-v2 is 384 and
 * would be rejected by Postgres on insert.
 */

/**
 * The package generates its pipeline type per task and does not export it, so
 * this describes only the call shape actually used. Narrower than `any`, and it
 * keeps the `no-explicit-any` rule meaning something in `lib/`.
 */
type FeatureExtractor = (
  values: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist: () => number[][] }>

let pipelinePromise: Promise<FeatureExtractor> | null = null

/**
 * Loaded once per process and reused.
 *
 * The first call pays for reading the weights off disk — and, the very first
 * time on a machine, for downloading them. Every call after is local matrix
 * work. Kept as a promise rather than a value so concurrent callers share one
 * load instead of racing to start several.
 */
async function extractor(): Promise<FeatureExtractor> {
  if (!pipelinePromise) {
    const model = serverEnv().LOCAL_EMBEDDING_MODEL
    log.info('ai.local_embedder_loading', { model })
    pipelinePromise = load(model)
      .then((p) => {
        log.info('ai.local_embedder_ready', { model })
        return p
      })
      .catch((err) => {
        // Reset, so a transient download failure does not poison the process
        // for its whole lifetime.
        pipelinePromise = null
        throw err
      })
  }
  return pipelinePromise
}

/**
 * Native backend first, WASM second.
 *
 * `onnxruntime-node` is faster and is what a laptop and CI should use, but it
 * needs native binaries fetched by an install script — and a host that blocks
 * install scripts (Vercel does) leaves the package present and unusable. The
 * symptom was not an error at deploy: it was "embedding the query failed" on
 * the live search page, with everything green locally.
 *
 * WASM needs no binaries and runs anywhere, so it is the fallback rather than
 * the default: correctness everywhere, speed where it is available.
 */
async function load(model: string): Promise<FeatureExtractor> {
  let pipeline: (
    task: string,
    model: string,
    options?: { device: string },
  ) => Promise<FeatureExtractor>

  try {
    ;({ pipeline } = (await import('@huggingface/transformers')) as unknown as {
      pipeline: typeof pipeline
    })
  } catch (err) {
    // The import itself, not the pipeline. onnxruntime-node dlopens
    // libonnxruntime.so.1, so a deployment missing that file fails here — and
    // the first version of this fallback wrapped only the pipeline call, one
    // line too late to catch anything.
    throw new Error(
      'The local embedding model could not be loaded: ' +
        `${err instanceof Error ? err.message : String(err)}. ` +
        'If this says libonnxruntime.so.1 is missing, the ONNX runtime binaries were not ' +
        'shipped with the deployment — see outputFileTracingIncludes in next.config.ts. ' +
        'Setting EMBEDDING_PROVIDER=gemini avoids the native dependency entirely, but the ' +
        'corpus must then be re-embedded with `npm run embed`.',
      { cause: err },
    )
  }

  try {
    return await pipeline('feature-extraction', model)
  } catch (err) {
    log.warn('ai.local_embedder_native_failed', { model }, err)
    return await pipeline('feature-extraction', model, { device: 'wasm' })
  }
}

/**
 * Mean-pooled, L2-normalised sentence embeddings.
 *
 * Both settings are what `sentence-transformers` does for this model, and
 * getting either wrong produces vectors that are the right shape and the wrong
 * direction — which looks like a mediocre retriever rather than like a bug.
 * Normalising also means cosine distance and inner product agree, so the
 * `<=>` operator in `hybrid_search` needs no change.
 */
export async function embedLocally(values: string[]): Promise<number[][]> {
  if (values.length === 0) return []

  const pipe = await extractor()
  const expected = serverEnv().EMBEDDING_DIM

  const output = await pipe(values, { pooling: 'mean', normalize: true })
  const data = output.tolist() as number[][]

  for (const [i, vector] of data.entries()) {
    if (vector.length !== expected) {
      throw new Error(
        `The local embedding model returned ${vector.length} dimensions for value ${i}, but ` +
          `rfi_embedding is vector(${expected}). Set LOCAL_EMBEDDING_MODEL to a model of that ` +
          'width, or change EMBEDDING_DIM and migrate the column — they must agree.',
      )
    }
  }

  return data
}

export const LOCAL_EMBEDDING_BATCH = 32
