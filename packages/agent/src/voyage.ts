/**
 * Embeddings for chat recall, from Voyage AI through MongoDB Atlas
 * (owner, 2026-10-22). Anthropic has no embeddings API.
 *
 *     POST https://ai.mongodb.com/v1/embeddings
 *     Authorization: Bearer $VOYAGE_API_KEY
 *     { input: [...], model, input_type, output_dimension, output_dtype }
 *
 * Plain `fetch`, no SDK: one request shape, and a dependency for it would
 * be one more thing in the release for nothing.
 *
 * `VOYAGE_API_KEY` is the worker's alone (worker.env). It is never logged:
 * an error here reports the HTTP status, never the request.
 *
 * Every call has a deadline. Recall runs while a customer waits for a reply,
 * and a Voyage outage must cost that reply at most `timeoutMs`, never break
 * it — the caller falls back to keyword recall on any failure.
 */

export const VOYAGE_URL = "https://ai.mongodb.com/v1/embeddings";
export const VOYAGE_DEFAULT_MODEL = "voyage-4-lite";
/** 512 int8 dimensions: 512 bytes a turn, and plenty for one customer's chat. */
export const VOYAGE_DIMENSIONS = 512;

export interface VoyageOptions {
  readonly apiKey: string;
  /** `VOYAGE_MODEL`, else `voyage-4-lite`. */
  readonly model: string;
  /** Injectable so a test never reaches the network. */
  readonly fetchImpl?: typeof fetch;
  readonly url?: string;
}

/** Read the Voyage settings from an explicitly passed environment, or null. */
export function readVoyageEnv(
  env: Record<string, string | undefined>,
): VoyageOptions | null {
  const apiKey = env["VOYAGE_API_KEY"]?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    model: env["VOYAGE_MODEL"]?.trim() || VOYAGE_DEFAULT_MODEL,
  };
}

/** Raised for any failed call. Carries the status, never the key or body. */
export class VoyageError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "VoyageError";
  }
}

/**
 * Embed `inputs`, in order. Each vector is `VOYAGE_DIMENSIONS` integers in
 * [-128, 127]. Throws `VoyageError` on any failure, including the deadline.
 */
export async function voyageEmbed(
  opts: VoyageOptions,
  inputs: readonly string[],
  inputType: "document" | "query",
  timeoutMs: number,
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(opts.url ?? VOYAGE_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${opts.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        input: inputs,
        model: opts.model,
        input_type: inputType,
        output_dimension: VOYAGE_DIMENSIONS,
        output_dtype: "int8",
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new VoyageError(
      err instanceof Error && err.name === "TimeoutError"
        ? `voyage: no answer within ${timeoutMs} ms`
        : "voyage: request failed",
    );
  }
  if (!res.ok) throw new VoyageError(`voyage: HTTP ${res.status}`, res.status);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new VoyageError("voyage: the answer was not JSON");
  }
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || data.length !== inputs.length)
    throw new VoyageError("voyage: wrong number of embeddings");
  const out: number[][] = new Array(inputs.length);
  for (const [i, item] of data.entries()) {
    const it = item as { embedding?: unknown; index?: unknown };
    const at = typeof it.index === "number" ? it.index : i;
    const v = it.embedding;
    if (
      !Array.isArray(v) ||
      v.length !== VOYAGE_DIMENSIONS ||
      !v.every((x) => Number.isInteger(x) && x >= -128 && x <= 127) ||
      at < 0 ||
      at >= inputs.length
    )
      throw new VoyageError("voyage: an embedding was not 512 int8 values");
    out[at] = v as number[];
  }
  if (out.some((v) => v === undefined))
    throw new VoyageError("voyage: an embedding was missing");
  return out;
}
