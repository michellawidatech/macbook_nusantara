/**
 * Redaction + truncation helpers for HTTP logging. Pure, no I/O — the one place
 * that decides what never reaches the `HttpLog` table.
 *
 * Rules (see continue_plan.md security checklist):
 *  - Strip `authorization` / `cookie` / `x-hub-signature*` (and a few sibling
 *    secret headers) so bearer tokens, session cookies and Meta's HMAC never
 *    land in the log store.
 *  - Mask secret-bearing BODY fields (`password`, `token`, `apiKey`, …) at any
 *    depth and in any casing, so a login body never reaches the store in the
 *    clear. Header redaction alone is not enough — the credential is in the body.
 *  - Truncate request/response bodies to `LOG_BODY_MAX_BYTES` (default 2KB) so a
 *    large upload can't bloat a log row.
 */

/** Marker written in place of a redacted header value. */
export const REDACTED = "[redacted]";

/**
 * Header names (lowercase) whose values must never be stored. Covers the WhatsApp
 * webhook signature, POS auth cookie/bearer, and common API-key headers.
 */
export const SENSITIVE_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-hub-signature",
  "x-hub-signature-256",
  "x-api-key",
  "x-anthropic-api-key",
  "proxy-authorization",
]);

/**
 * Body field names whose values must never be stored. Matched against the
 * lowercased key with separators stripped (`password_hash` → `passwordhash`),
 * as a SUBSTRING, so `newPassword`, `x-api-key` and `refresh_token` all hit.
 */
export const SENSITIVE_BODY_KEYS: readonly string[] = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "authorization",
  "cookie",
  "credential",
  "sessionid",
  "privatekey",
  "otp",
  "pin",
  "cvv",
  "cardnumber",
];

/** True when `key` names a field whose value must be masked. */
export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_BODY_KEYS.some((s) => k.includes(s));
}

/** Depth cap for the recursive walk — a pathological body can't stall logging. */
const MAX_DEPTH = 8;

/**
 * Deep-copy `value`, replacing every sensitive field's value with {@link REDACTED}.
 * Non-plain values (Date, Buffer, class instances) are returned as-is; cycles and
 * over-deep branches degrade to a marker rather than throwing.
 */
export function redactValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[deep]";
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1, seen));
  if (Buffer.isBuffer(value) || value instanceof Date) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? REDACTED : redactValue(v, depth + 1, seen);
  }
  return out;
}

type HeaderValue = string | string[] | number | undefined;
type HeaderMap = Record<string, HeaderValue> | null | undefined;

/**
 * Return a plain, lowercase-keyed copy of `headers` with every sensitive value
 * replaced by `REDACTED`. Array values (e.g. `set-cookie`) are joined; a header
 * that is sensitive is masked before it can be joined, so no fragment leaks.
 * `undefined` values are dropped entirely.
 */
export function redactHeaders(headers: HeaderMap): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [rawKey, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const key = rawKey.toLowerCase();
    if (SENSITIVE_HEADERS.has(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}

/**
 * Serialize a request/response body to a string for logging, or `undefined` when
 * there is nothing to log. Objects are JSON-encoded with BigInt coerced to a
 * number (money ids in this codebase). Never throws — a circular/unserializable
 * body degrades to a placeholder.
 */
export function serializeBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body || undefined;
  if (Buffer.isBuffer(body)) return body.length ? body.toString("utf8") : undefined;
  try {
    const json = JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? Number(v) : v));
    return json === undefined ? undefined : json;
  } catch {
    return "[unserializable body]";
  }
}

/**
 * Truncate `text` to at most `maxBytes` UTF-8 bytes, appending a marker noting
 * how many bytes were dropped. A multi-byte character straddling the boundary is
 * cut (its trailing fragment becomes the Unicode replacement char) — acceptable
 * for a log preview, and it guarantees the byte budget is respected.
 */
export function truncateToBytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  const kept = buf.subarray(0, maxBytes).toString("utf8");
  return `${kept}…[+${buf.length - maxBytes} bytes]`;
}

/** Default body cap when `LOG_BODY_MAX_BYTES` is unset or invalid. */
export const DEFAULT_BODY_MAX_BYTES = 2048;

/**
 * Resolve the body byte cap from an env value (defaults to `LOG_BODY_MAX_BYTES`).
 * Falls back to {@link DEFAULT_BODY_MAX_BYTES} for missing / non-positive input.
 */
export function resolveBodyMaxBytes(
  raw: string | undefined = process.env.LOG_BODY_MAX_BYTES,
): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_BODY_MAX_BYTES;
}

/**
 * Mask sensitive fields, serialize, then truncate — the form the middleware /
 * outbound wrapper actually store. Returns `undefined` for an empty body.
 *
 * A body that arrives as a JSON *string* (e.g. an already-serialized outbound
 * payload) is parsed, masked and re-serialized, so `{"password":"x"}` is caught
 * whether it reaches us as an object or as text.
 */
export function redactBody(
  body: unknown,
  maxBytes: number = resolveBodyMaxBytes(),
): string | undefined {
  let target: unknown = body;
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        target = redactValue(JSON.parse(trimmed));
      } catch {
        target = body; // not JSON after all — store the raw text
      }
    }
  } else {
    target = redactValue(body);
  }
  const s = serializeBody(target);
  return s === undefined ? undefined : truncateToBytes(s, maxBytes);
}
