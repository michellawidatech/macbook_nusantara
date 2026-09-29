/**
 * `X-Hub-Signature-256` verification — 06 §9.2.
 *
 * Meta signs each POST with the SHA-256 HMAC of the EXACT bytes it sent, keyed
 * by the App Secret. Two rules, both of which have cost this project time
 * before and are the reason this is its own module:
 *
 *  1. **Hash the raw bytes.** `JSON.parse` then `JSON.stringify` reorders keys
 *     and normalises whitespace, so a signature computed over a re-serialised
 *     body never matches. `app.ts` keeps the buffer for exactly this.
 *  2. **Compare in constant time.** A byte-by-byte early return leaks the
 *     expected signature through response timing, and the attacker gets as many
 *     attempts as they like.
 *
 * Ported deliberately from `reference/whatsapp-webhook/signature.ts` rather
 * than imported: `reference/` is the previous build and is never a dependency
 * of this one (CLAUDE.md).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** The header value Meta should have sent for these bytes. */
export function expectedSignature(raw: Buffer, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(raw).digest("hex")}`;
}

/**
 * Is this the signature Meta would have produced?
 *
 * False for a missing header and false for an empty secret — the caller is
 * expected to have already refused the request in the latter case (06 §9.1),
 * but a verifier that returns true for "no secret" is a landmine regardless of
 * who calls it.
 */
export function verifySignature(
  raw: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header || !appSecret) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expectedSignature(raw, appSecret));
  // Length is checked first because timingSafeEqual throws on a mismatch. The
  // length of a signature is not a secret — its contents are.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Constant-time compare for the one-time verification handshake token.
 *
 * Separate from `verifySignature` because it compares a plain string rather
 * than an HMAC, and because an empty configured token must never match an empty
 * supplied one — that would let anyone register this host as their callback.
 */
export function tokenMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string" || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
