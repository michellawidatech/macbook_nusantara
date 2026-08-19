/**
 * Password hashing and session tokens — docs/rebuild/08-data-integrity.md §9.
 *
 *   - Argon2id, "not bcrypt — memory-hard matters more than speed here".
 *   - The session token is random 256-bit and stored **hashed**; the raw value
 *     only ever exists in the cookie. A database leak is then not an instant
 *     login as every user.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

/**
 * Cost parameters, tuned to roughly 100 ms on the target host (§9). They live
 * here rather than at each call site so a retune is one edit.
 */
export const ARGON2_OPTIONS = {
  // `algorithm` is deliberately omitted: Argon2id is @node-rs/argon2's default,
  // and naming it here would mean importing an ambient const enum, which this
  // repo's `verbatimModuleSyntax` forbids. A test asserts the produced hash
  // really begins with `$argon2id$`, which is stronger evidence than a
  // compile-time constant anyway.
  memoryCost: 19_456, // 19 MiB — OWASP's floor for Argon2id
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

/**
 * Verify a password. Returns false rather than throwing on a malformed stored
 * hash: a corrupt row must fail the login, not the process.
 */
export async function verifyPassword(
  stored: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(stored, plain, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/** 256 bits of randomness, URL-safe. This value exists only in the cookie. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The form stored in `StaffSession.tokenHash`.
 *
 * SHA-256 rather than Argon2: the token is already 256 bits of entropy, so
 * there is nothing to brute-force, and every authenticated request pays this
 * cost. Argon2 here would be a per-request penalty buying nothing.
 */
export function hashSessionToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Constant-time compare for two hex digests of equal length. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
