/**
 * Redaction and truncation — docs/rebuild/05-logging.md §6.
 *
 * Pure, no I/O: the one place that decides what never reaches a log line.
 *
 * The rules from the previous build (`reference/redact.ts`) are the floor and
 * carry over unchanged. §6 adds two:
 *
 *   - phone numbers are masked to `+6281****4321`. The chatbot inbox is the
 *     place to read a phone number; a log file is not;
 *   - customer names and addresses are never logged — id only.
 *
 * Nothing in this file throws. A logging failure must never reach the request
 * path (§2), so a pathological body degrades to a marker instead.
 */

/** Marker written in place of a redacted value. */
export const REDACTED = "[redacted]";

/**
 * Header names (lowercase) whose values must never be logged. Covers Meta's
 * webhook HMAC, the POS session cookie and bearer, and common API keys.
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
 * Body field names whose values must never be logged. Matched against the
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

/**
 * Fields that are never logged at all, matched on the **whole** normalised key
 * rather than as a substring. Two groups, one rule:
 *
 *   - customer identity — §6: "Customer names and addresses are never logged —
 *     id only";
 *   - message content — the text of a WhatsApp message, an IG comment, a unit
 *     note, a staff directive or an agent summary. §5 §6 requires a real Meta
 *     webhook payload to emerge with no message text, and §2 already says
 *     "never log a whole entity; log its id and the two or three fields that
 *     matter".
 *
 * `name` is included, which also masks SKU, model and location names. That is
 * the right default — a customer's name reaches this code as a bare `name`
 * (Meta sends `contacts[].profile.name`) and no allowlist can tell the two
 * apart. When a non-personal name genuinely belongs in a record, give it a
 * qualified key: `skuName`, `locationName`, `modelName` all pass through.
 */
export const NEVER_LOGGED_KEYS: ReadonlySet<string> = new Set([
  // identity
  "name",
  "custname",
  "customername",
  "fullname",
  "namapelanggan",
  "address",
  "alamat",
  "street",
  "jalan",
  // content
  "body",
  "text",
  "caption",
  "replytext",
  "dmtext",
  "note",
  "directive",
  "summary",
]);

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True when `key` names a field whose value must be masked. */
export function isSensitiveKey(key: string): boolean {
  const k = normaliseKey(key);
  return SENSITIVE_BODY_KEYS.some((s) => k.includes(s));
}

/** True when `key` names customer PII or message content (§6). */
export function isNeverLogged(key: string): boolean {
  return NEVER_LOGGED_KEYS.has(normaliseKey(key));
}

/**
 * Indonesian mobile numbers in the forms staff and Meta actually produce —
 * `+6281…`, `6281…`, `081…` — plus any other E.164 number.
 */
const PHONE_PATTERN = /(?:\+?62|0)8\d{7,13}|\+\d{8,15}/g;

/**
 * Mask one phone number: keep the first five characters and the last four,
 * with a fixed four-asterisk middle. `+6281234564321` → `+6281****4321`.
 *
 * The mask is a fixed width on purpose: a variable one would leak the length.
 */
export function maskPhone(phone: string): string {
  if (phone.length <= 9) return "****";
  return `${phone.slice(0, 5)}****${phone.slice(-4)}`;
}

/** Mask every phone-shaped run inside a string. */
export function maskPhones(text: string): string {
  return text.replace(PHONE_PATTERN, (m) => maskPhone(m));
}

/** Depth cap for the recursive walk — a pathological body cannot stall logging. */
const MAX_DEPTH = 8;

/**
 * Deep-copy `value`, masking every sensitive field, dropping customer PII, and
 * masking phone numbers inside any remaining string.
 *
 * Non-plain values (Date, Buffer) are returned as-is; cycles and over-deep
 * branches degrade to a marker rather than throwing.
 */
export function redactValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "string") return maskPhones(value);
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[deep]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value))
    return value.map((v) => redactValue(v, depth + 1, seen));
  // An Error is passed through untouched so pino's `err` serializer can turn it
  // into { type, msg, stack }. Walking it here would flatten it to {}, because
  // message and stack are non-enumerable. The serializer masks it instead.
  if (
    Buffer.isBuffer(value) ||
    value instanceof Date ||
    value instanceof Error
  ) {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] =
      isSensitiveKey(k) || isNeverLogged(k)
        ? REDACTED
        : redactValue(v, depth + 1, seen);
  }
  return out;
}

type HeaderValue = string | string[] | number | undefined;
type HeaderMap = Record<string, HeaderValue> | null | undefined;

/**
 * A plain, lowercase-keyed copy of `headers` with every sensitive value
 * replaced. A sensitive header is masked before any join, so no fragment leaks.
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
    out[key] = maskPhones(
      Array.isArray(value) ? value.join(", ") : String(value),
    );
  }
  return out;
}

/**
 * Serialize a body for logging, or `undefined` when there is nothing to log.
 * Money is a string: BigInt does not survive JSON.stringify (§2).
 */
export function serializeBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body === "" ? undefined : body;
  if (Buffer.isBuffer(body))
    return body.length === 0 ? undefined : body.toString("utf8");
  try {
    const json = JSON.stringify(body, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    return json === undefined ? undefined : json;
  } catch {
    return "[unserializable body]";
  }
}

/**
 * Truncate to at most `maxBytes` UTF-8 bytes, noting how many were dropped.
 * A multi-byte character straddling the boundary is cut — acceptable for a
 * preview, and it guarantees the byte budget is respected.
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
 * Resolve the body byte cap. Injectable rather than read from the environment
 * at call time, because a fail-closed test must not depend on a developer's
 * `.env` (01 §7).
 */
export function resolveBodyMaxBytes(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_BODY_MAX_BYTES;
}

/**
 * Mask, serialize, then truncate — the form a log record actually carries.
 *
 * A body that arrives as a JSON *string* is parsed, masked and re-serialized,
 * so `{"password":"x"}` is caught whether it reaches us as an object or text.
 */
export function redactBody(
  body: unknown,
  maxBytes: number = DEFAULT_BODY_MAX_BYTES,
): string | undefined {
  let target: unknown;

  if (typeof body === "string") {
    const trimmed = body.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        target = redactValue(JSON.parse(trimmed));
      } catch {
        target = maskPhones(body); // not JSON after all — keep the text, masked
      }
    } else {
      target = maskPhones(body);
    }
  } else {
    target = redactValue(body);
  }

  const s = serializeBody(target);
  return s === undefined ? undefined : truncateToBytes(s, maxBytes);
}

/** Strip the query string from a path. §6: query strings are never logged. */
export function stripQuery(path: string): string {
  const cut = path.indexOf("?");
  return cut === -1 ? path : path.slice(0, cut);
}
