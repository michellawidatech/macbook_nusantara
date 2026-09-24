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
import {
  MAX_WAIT_MS,
  MIN_WAIT_MS,
  SUMMARY_EVERY_TURNS,
  agentCapabilities,
  type AgentCapabilities,
  type AnthropicEnv,
  type WaitProfile,
} from "@nusantara/agent";
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
  "WORKER_DEBOUNCE_MIN_MS",
  "WORKER_DEBOUNCE_MAX_MS",
  "WORKER_SUMMARY_EVERY_TURNS",
  "WORKER_SUMMARY_QUIET_MS",
  "WORKER_MAX_SUMMARIES",
  "WORKER_MAX_BATCH",
  "WORKER_RESERVATION_GRACE_MS",
  "WORKER_RESERVATION_TTL_MS",
  "WORKER_MAX_EXPIRIES",
  "WORKER_AGENT_STAFF_ID",
  "AGENT_CAPABILITIES",
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
  /** The adaptive wait windows the debounce picks between. */
  readonly waits: WaitProfile;
  /** Messages one reply may cover, so a huge backlog becomes several replies. */
  readonly maxBatch: number;
  /** Answered turns that must pile up before a thread's note is refreshed. */
  readonly summaryEveryTurns: number;
  /** Or how long the thread must be quiet, with turns still uncovered. */
  readonly summaryQuietMs: number;
  readonly maxSummariesPerTick: number;
  /** How long after a missed appointment an agent hold is released. */
  readonly reservationGraceMs: number;
  /** How long a booking with no appointment may hold a unit. */
  readonly reservationTtlMs: number;
  readonly maxExpiriesPerTick: number;
  /**
   * The Staff row a bot-created UnitEvent is attributed to. Inserted by the
   * migration, so it exists in every environment.
   */
  readonly agentStaffId: string;
  /**
   * What the bot may do for itself — `AGENT_CAPABILITIES` (2026-09-21).
   *
   * `live` is the owner's 2026-09-21 design: the bot reads the shelf, sends
   * the shop's own photographs of a unit, and may book a hold. Anything else,
   * including the variable being unset, is the 2026-09-18 design: it answers
   * from the owner's approved sheet and hands every question about a
   * particular unit to a person.
   *
   * The cautious reading is the DEFAULT, deliberately. The live one is right
   * only once the stock in this database is the shop's real stock, and a
   * variable nobody set should not be the thing that decides a bot is quoting
   * prices off a half-migrated shelf.
   */
  readonly capabilities: AgentCapabilities;
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
    // The base window is the middle of a range now. A direct question is
    // answered sooner and "nanti saya kabarin" waits far longer; see
    // `computeWaitMs`.
    waits: {
      minMs: int(env["WORKER_DEBOUNCE_MIN_MS"], MIN_WAIT_MS),
      baseMs: int(env["WORKER_DEBOUNCE_MS"], 8_000),
      maxMs: int(env["WORKER_DEBOUNCE_MAX_MS"], MAX_WAIT_MS),
    },
    maxDraftsPerTick: int(env["WORKER_MAX_DRAFTS"], 5),
    maxBatch: int(env["WORKER_MAX_BATCH"], 30),
    maxSendsPerTick: int(env["WORKER_MAX_SENDS"], 20),
    summaryEveryTurns: int(
      env["WORKER_SUMMARY_EVERY_TURNS"],
      SUMMARY_EVERY_TURNS,
    ),
    summaryQuietMs: int(env["WORKER_SUMMARY_QUIET_MS"], 900_000),
    maxSummariesPerTick: int(env["WORKER_MAX_SUMMARIES"], 3),
    // Four hours late is a customer who is not coming. Two days is a booking
    // that never had a time in the first place.
    reservationGraceMs: int(env["WORKER_RESERVATION_GRACE_MS"], 4 * 3_600_000),
    reservationTtlMs: int(env["WORKER_RESERVATION_TTL_MS"], 48 * 3_600_000),
    maxExpiriesPerTick: int(env["WORKER_MAX_EXPIRIES"], 10),
    agentStaffId: env["WORKER_AGENT_STAFF_ID"]?.trim() || "staff_agent",
    // One reader for the whole repo (packages/agent policy.ts), so the worker
    // and the API's Draft endpoint cannot disagree about what the bot may do.
    capabilities: agentCapabilities(env),
  };
}
