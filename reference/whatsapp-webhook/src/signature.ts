/**
 * Webhook payload signature verification.
 *
 * Meta signs each POST with `X-Hub-Signature-256: sha256=<hmac>` where the HMAC
 * is SHA-256 of the EXACT raw request bytes keyed by your App Secret. We must
 * verify over the raw bytes captured before JSON parsing, using a constant-time
 * comparison.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export function expectedSignature(raw: Buffer, appSecret: string): string {
  return "sha256=" + createHmac("sha256", appSecret).update(raw).digest("hex");
}

export function verifySignature(
  raw: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header || !appSecret) return false;
  const expected = expectedSignature(raw, appSecret);
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
