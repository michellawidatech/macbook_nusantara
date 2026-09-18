/**
 * The one place the SPA talks to the API.
 *
 * 01 §4: every response carries `x-request-id`; the SPA echoes it back on the
 * next request as `x-correlation-id`, so a user reporting "it broke after I
 * clicked save" links two requests in the log (05 §3).
 */

export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly field?: string;
  };
}

/** Thrown for any non-2xx. `message` is already Indonesian, from the server. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field?: string;

  constructor(status: number, body: ApiErrorBody["error"]) {
    super(body.message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = body.code;
    this.field = body.field;
  }
}

/** Raised when the request never reached the server at all. */
export class ApiOfflineError extends Error {
  constructor() {
    super("Tidak bisa menghubungi server.");
    this.name = "ApiOfflineError";
  }
}

let lastRequestId: string | undefined;

type RefusalListener = (status: number, code: string) => void;
const refusalListeners = new Set<RefusalListener>();

/**
 * Hear about a 401 or 403 from ANY request — the session ended, or it is on a
 * password that must be changed first. `lib/session.ts` registers the one
 * listener, so a page does not have to notice that its own save was refused
 * because of who is (no longer) signed in. Returns the unsubscribe.
 */
export function onApiRefusal(listener: RefusalListener): () => void {
  refusalListeners.add(listener);
  return () => {
    refusalListeners.delete(listener);
  };
}

/** Exposed for the tests and for a future "report a problem" affordance. */
export function currentCorrelationId(): string | undefined {
  return lastRequestId;
}

export interface ApiOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  /** 08 §3 — set by any mutation a user could double-click. */
  readonly idempotencyKey?: string;
}

export async function api<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const { method = "GET", body, signal, idempotencyKey } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (lastRequestId !== undefined) headers["x-correlation-id"] = lastRequestId;
  if (idempotencyKey !== undefined) headers["idempotency-key"] = idempotencyKey;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      // The session cookie is HttpOnly; the SPA never sees or sends a token.
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError")
      throw cause;
    throw new ApiOfflineError();
  }

  const requestId = response.headers.get("x-request-id");
  if (requestId !== null) lastRequestId = requestId;

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text === "" ? undefined : JSON.parse(text);

  if (!response.ok) {
    const shape = parsed as Partial<ApiErrorBody> | undefined;
    const error = new ApiRequestError(
      response.status,
      shape?.error ?? {
        code: "KESALAHAN_SERVER",
        message: "Terjadi kesalahan di server.",
      },
    );
    // A wrong password at sign-in is a 401 too, and it says nothing about a
    // session — there is none yet.
    if (
      (error.status === 401 || error.status === 403) &&
      !path.startsWith("/api/auth/login")
    ) {
      for (const listener of refusalListeners)
        listener(error.status, error.code);
    }
    throw error;
  }

  return parsed as T;
}
