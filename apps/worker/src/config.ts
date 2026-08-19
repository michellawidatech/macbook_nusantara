/**
 * Worker configuration.
 *
 * Built from an explicitly passed environment, exactly as the webhook and the
 * API do it (01 §7). `main.ts` is the only file in this app that reads
 * `process.env`, which is what lets every pass below be driven by a test with
 * no credentials in sight.
 *
 * The env-file loader below is key-filtered for the reason the webhook's config
 * spells out: `secrets/webhook-credentials.env` also carries a `DATABASE_URL`
 * pointing at the PREVIOUS build's live database, and loading it wholesale
 * would silently repoint this process at production data it must never write
 * to (CLAUDE.md).
 */

import { readFileSync } from "node:fs";
import type { AnthropicEnv } from "@nusantara/agent";
import type { WhatsAppCredentials } from "@nusantara/whatsapp";

/**
 * The only keys the worker will accept from a shared secrets file.
 *
 * A near-copy of the webhook's list, and deliberately NOT the same list
 * imported from it. The allow-list is a statement about what this process is
 * allowed to become, not a shared constant: the worker sends messages and
 * drafts them, so it needs the Graph and Anthropic credentials — and it has no
 * business loading `APP_SECRET` or `VERIFY_TOKEN`, which only the endpoint that
 * verifies inbound signatures should ever hold.
 *
 * `DATABASE_URL` is absent from both lists for the reason the webhook's config
 * spells out: the shared secrets file points it at the PREVIOUS build's live
 * database, which this build must never write to (CLAUDE.md). The connection
 * comes from the process environment, as it does for every app here.
 */
export const WORKER_ENV_KEYS = [
  "WHATSAPP_TOKEN",
  "PHONE_NUMBER_ID",
  "GRAPH_API_VERSION",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "WORKER_POLL_MS",
  "WORKER_DEBOUNCE_MS",
  "WORKER_MAX_DRAFTS",
  "WORKER_MAX_SENDS",
] as const;

/**
 * Read the allowed keys out of an env file. A missing file is not an error —
 * the shell is a complete source of configuration on its own.
 */
export function loadEnvFile(path: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }

  const allowed = new Set<string>(WORKER_ENV_KEYS);
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

export interface WorkerConfig {
  readonly whatsapp: WhatsAppCredentials;
  readonly anthropic: AnthropicEnv;
  /** How long between ticks when the last tick had nothing to do. */
  readonly idlePollMs: number;
  /**
   * How long a sender must be quiet before the agent answers them.
   *
   * 06 §9.5: WhatsApp messages are debounced per sender, because a customer who
   * types "halo" / "mau tanya" / "ada macbook?" as three messages should get one
   * considered answer rather than three fragments. A polling worker gets that
   * for free by refusing to look at a thread whose newest message is still warm.
   */
  readonly debounceMs: number;
  /** Threads drafted per tick. A cap, so one busy minute cannot fan out. */
  readonly maxDraftsPerTick: number;
  /** Outbox rows sent per tick. */
  readonly maxSendsPerTick: number;
}

function int(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadWorkerConfig(
  env: Record<string, string | undefined>,
): WorkerConfig {
  return {
    whatsapp: {
      whatsappToken: env["WHATSAPP_TOKEN"]?.trim() ?? "",
      phoneNumberId: env["PHONE_NUMBER_ID"]?.trim() ?? "",
      // One constant for both channels — never two env fallbacks (CLAUDE.md).
      graphVersion: env["GRAPH_API_VERSION"]?.trim() || "v25.0",
    },
    anthropic: {
      apiKey: env["ANTHROPIC_API_KEY"]?.trim() || undefined,
      authToken: env["ANTHROPIC_AUTH_TOKEN"]?.trim() || undefined,
    },
    idlePollMs: int(env["WORKER_POLL_MS"], 2_000),
    debounceMs: int(env["WORKER_DEBOUNCE_MS"], 8_000),
    maxDraftsPerTick: int(env["WORKER_MAX_DRAFTS"], 5),
    maxSendsPerTick: int(env["WORKER_MAX_SENDS"], 20),
  };
}
