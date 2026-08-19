/**
 * Webhook configuration.
 *
 * Built from an explicitly passed environment, never read from `process.env` at
 * module scope. 01 §7 and CLAUDE.md are blunt about why: the fail-closed tests
 * have to prove this server rejects traffic when `APP_SECRET` is unset, and
 * they cannot prove it if importing the module has already picked up the
 * developer's shell. `server.ts` is the only place that touches `process.env`.
 *
 * ## The env-file rule, and the trap it exists for
 *
 * 06 §8 describes an `apps/whatsapp-webhook/.env`. This repo's secrets actually
 * live in `secrets/webhook-credentials.env`, and that file also carries a
 * `DATABASE_URL` pointing at **`nusantara_pos_app`** — the PREVIOUS build's live
 * database, which CLAUDE.md says must never be migrated, reset or written to.
 *
 * So loading it wholesale would silently repoint this process at old production
 * data. {@link loadEnvFile} therefore returns ONLY the keys in
 * {@link WEBHOOK_ENV_KEYS}. `DATABASE_URL` is not one of them and cannot be
 * made one by editing the file — which is the point. The database connection
 * comes from the process environment, exactly as it does for every other app in
 * this workspace.
 */

import { readFileSync } from "node:fs";

/**
 * The only keys an env file may contribute.
 *
 * An allow-list rather than a deny-list: a deny-list has to be updated every
 * time somebody adds a dangerous variable to a shared secrets file, and nobody
 * will remember to.
 */
export const WEBHOOK_ENV_KEYS = [
  "WEBHOOK_PORT",
  "PORT",
  "APP_SECRET",
  "VERIFY_TOKEN",
  "WHATSAPP_TOKEN",
  "PHONE_NUMBER_ID",
  "GRAPH_API_VERSION",
  "IG_ACCESS_TOKEN",
  "IG_BUSINESS_ACCOUNT_ID",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
] as const;

export interface WebhookConfig {
  readonly port: number;
  /** HMAC key for every inbound event. Empty means "reject everything". */
  readonly appSecret: string;
  /** Compared during the one-time handshake. Empty means "refuse to verify". */
  readonly verifyToken: string;
  readonly whatsappToken: string;
  readonly phoneNumberId: string;
  /** One constant for both channels — never two env fallbacks (CLAUDE.md). */
  readonly graphVersion: string;
  readonly igAccessToken: string;
  readonly igBusinessAccountId: string;
}

/** CLAUDE.md pins the Graph version for both channels. */
const DEFAULT_GRAPH_VERSION = "v25.0";

function int(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadConfig(
  env: Record<string, string | undefined>,
): WebhookConfig {
  return {
    port: int(env["WEBHOOK_PORT"] ?? env["PORT"], 3001),
    appSecret: env["APP_SECRET"]?.trim() ?? "",
    verifyToken: env["VERIFY_TOKEN"]?.trim() ?? "",
    whatsappToken: env["WHATSAPP_TOKEN"]?.trim() ?? "",
    phoneNumberId: env["PHONE_NUMBER_ID"]?.trim() ?? "",
    graphVersion: env["GRAPH_API_VERSION"]?.trim() || DEFAULT_GRAPH_VERSION,
    igAccessToken: env["IG_ACCESS_TOKEN"]?.trim() ?? "",
    igBusinessAccountId: env["IG_BUSINESS_ACCOUNT_ID"]?.trim() ?? "",
  };
}

/** Can this process actually deliver a WhatsApp message? */
export const canSendWhatsApp = (c: WebhookConfig): boolean =>
  Boolean(c.whatsappToken && c.phoneNumberId);

/** Can this process actually reply to an Instagram comment? */
export const canSendInstagram = (c: WebhookConfig): boolean =>
  Boolean(c.igAccessToken && c.igBusinessAccountId);

/**
 * Read `KEY=VALUE` lines from a file, keeping only {@link WEBHOOK_ENV_KEYS}.
 *
 * Returns `{}` for a missing or unreadable file — 06 §8: a missing env file is
 * not fatal, because in production the values come from the deployment's secret
 * store rather than from disk.
 *
 * Deliberately NOT `process.loadEnvFile`: that mutates `process.env` with
 * everything the file contains, which is precisely the `DATABASE_URL` hazard
 * this module's docblock describes.
 */
export function loadEnvFile(path: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }

  const allowed = new Set<string>(WEBHOOK_ENV_KEYS);
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!allowed.has(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    // Strip one layer of matching quotes, the way every dotenv loader does.
    if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'"))) {
      if (value.at(-1) === value[0]) value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
