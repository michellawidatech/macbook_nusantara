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
  BASE_WAIT_MS,
  MAX_WAIT_MS,
  MIN_WAIT_MS,
  SUMMARY_EVERY_TURNS,
  agentCapabilities,
  readAnthropicEnv,
  readVoyageEnv,
  type AgentApiOptions,
  type AgentCapabilities,
  type AnthropicEnv,
  type VoyageOptions,
  type WaitProfile,
} from "@nusantara/agent";
import {
  gatewayFetch,
  type GatewayTarget,
  type WhatsAppCredentials,
} from "@nusantara/whatsapp";

/**
 * How a reply reaches WhatsApp (owner decision 2026-10-22).
 *
 * `cloud` is Meta's Cloud API with the shop's token — unchanged, and the
 * default. `baileys` sends the SAME Graph requests to `apps/wa-gateway` on
 * loopback, which speaks WhatsApp Web as a device linked to the shop's number
 * (docs/whatsapp-baileys.md). There is no token in that mode: the send code
 * still wants one before it calls itself configured, so a placeholder stands
 * in, and `gatewayFetch` drops the Authorization header built from it before
 * anything leaves the process.
 *
 * Baileys mode with the URL or the secret missing stays Baileys mode with
 * EMPTY credentials — the send pass's existing "dormant": replies queue,
 * nothing is claimed, and the first log line says why. Falling back to the
 * Cloud API instead would send from Meta with whatever token happened to be
 * left in the file, which is not what anybody chose.
 */
export type WhatsAppTransport =
  { readonly kind: "cloud" } | ({ readonly kind: "baileys" } & GatewayTarget);

/** What stands in for a token in Baileys mode. Never sent anywhere. */
export const BAILEYS_TOKEN_PLACEHOLDER = "wa-gateway";

/**
 * The fetch the send pass is handed (`TickDeps.fetchImpl`): none for the
 * Cloud API — the client's own `fetch` to graph.facebook.com — and the
 * gateway's rewrite for Baileys. The seam tools/wa-local and the tests use.
 */
export function sendFetchFor(
  transport: WhatsAppTransport,
  baseFetch: typeof fetch = fetch,
): typeof fetch | undefined {
  return transport.kind === "baileys" && transport.url && transport.secret
    ? gatewayFetch(transport, baseFetch)
    : undefined;
}

export function transportOf(
  env: Record<string, string | undefined>,
): WhatsAppTransport {
  if (env["WHATSAPP_TRANSPORT"]?.trim().toLowerCase() !== "baileys") {
    return { kind: "cloud" };
  }
  return {
    kind: "baileys",
    url: env["WA_GATEWAY_URL"]?.trim() ?? "",
    secret: env["WA_GATEWAY_SECRET"]?.trim() ?? "",
  };
}

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
  "CHATBOT_MODEL",
  "CHATBOT_SUMMARY_MODEL",
  "VOYAGE_API_KEY",
  "VOYAGE_MODEL",
  "WORKER_MEMORY_TURNS",
  "WORKER_MEMORY_EMBEDS",
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
  "WORKER_DRAFT_CONCURRENCY",
  "AGENT_API_URL",
  "AGENT_API_SECRET",
  "WORKER_MAX_SENDS",
  "WHATSAPP_TRANSPORT",
  "WA_GATEWAY_URL",
  "WA_GATEWAY_SECRET",
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
  /** The Cloud API or the Baileys gateway — `WHATSAPP_TRANSPORT`. */
  readonly transport: WhatsAppTransport;
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
  /**
   * Threads answered at the same time (chatbot v2, 2026-10-14). Each holds at
   * most one database connection, so the worker's `connection_limit` must
   * leave room for it (worker.env.example).
   */
  readonly draftConcurrency: number;
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
   * What the bot may do for itself when a switch on /chat was never pressed
   * — `AGENT_CAPABILITIES`.
   *
   * Since 2026-10-27 the POS is the bot's source of truth: unset reads as
   * every switch on (`SHOP_CAPABILITIES`) — a bot booking is a visit that
   * holds no unit. `parallel` is the 2026-09-18 design, for a database whose
   * shelf is not the shop's. A switch the owner pressed wins over all three.
   */
  readonly capabilities: AgentCapabilities;
  /**
   * The POS's agent API (chatbot v2 step 3): `AGENT_API_URL` +
   * `AGENT_API_SECRET`. Both set, the stock, photo, customer and booking
   * tools run behind `/api/agent/v1` under a per-turn token; either missing,
   * they run here against the database, as before. Null is not an error — it
   * is how a worker deployed ahead of its API keeps answering.
   */
  readonly agentApi: AgentApiOptions | null;
  /**
   * Voyage AI, for chat recall (2026-10-22): `VOYAGE_API_KEY` (worker.env
   * only — never printed) and `VOYAGE_MODEL`. Null without a key: turns are
   * still chunked and recalled by keywords, just never embedded.
   */
  readonly voyage: VoyageOptions | null;
  /** Answered turns written into `ChatMemoryChunk` per tick. */
  readonly memoryTurnsPerTick: number;
  /** Chunks embedded per tick — one Voyage call. */
  readonly memoryEmbedsPerTick: number;
}

function int(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadWorkerConfig(
  env: Record<string, string | undefined>,
): WorkerConfig {
  // One constant for both channels — never two env fallbacks (CLAUDE.md).
  const graphVersion = env["GRAPH_API_VERSION"]?.trim() || "v25.0";
  const transport = transportOf(env);
  return {
    whatsapp:
      transport.kind === "cloud"
        ? {
            whatsappToken: env["WHATSAPP_TOKEN"]?.trim() ?? "",
            phoneNumberId: env["PHONE_NUMBER_ID"]?.trim() ?? "",
            graphVersion,
          }
        : {
            // Never WHATSAPP_TOKEN, even if the file still holds one.
            whatsappToken:
              transport.url && transport.secret
                ? BAILEYS_TOKEN_PLACEHOLDER
                : "",
            // A path segment the gateway ignores; the number is the device's.
            phoneNumberId: env["PHONE_NUMBER_ID"]?.trim() || "baileys",
            graphVersion,
          },
    transport,
    // The credential, and CHATBOT_MODEL / CHATBOT_SUMMARY_MODEL — the
    // model is an environment override, so moving the bot off Haiku 5.5 (or
    // back) is an env edit and a restart, never a release.
    anthropic: readAnthropicEnv(env),
    idlePollMs: int(env["WORKER_POLL_MS"], 2_000),
    debounceMs: int(env["WORKER_DEBOUNCE_MS"], BASE_WAIT_MS),
    // The base window is the middle of a range now. A direct question is
    // answered sooner and "nanti saya kabarin" waits far longer; see
    // `computeWaitMs`.
    waits: {
      minMs: int(env["WORKER_DEBOUNCE_MIN_MS"], MIN_WAIT_MS),
      baseMs: int(env["WORKER_DEBOUNCE_MS"], BASE_WAIT_MS),
      maxMs: int(env["WORKER_DEBOUNCE_MAX_MS"], MAX_WAIT_MS),
    },
    // 16 a tick, 8 at once: at "10–25 concurrent" (owner, 2026-10-14) a busy
    // minute drains in two ticks instead of five.
    maxDraftsPerTick: int(env["WORKER_MAX_DRAFTS"], 16),
    draftConcurrency: int(env["WORKER_DRAFT_CONCURRENCY"], 8),
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
    agentApi:
      env["AGENT_API_URL"]?.trim() && env["AGENT_API_SECRET"]?.trim()
        ? {
            baseUrl: env["AGENT_API_URL"].trim(),
            secret: env["AGENT_API_SECRET"].trim(),
          }
        : null,
    voyage: readVoyageEnv(env),
    memoryTurnsPerTick: int(env["WORKER_MEMORY_TURNS"], 40),
    memoryEmbedsPerTick: int(env["WORKER_MEMORY_EMBEDS"], 32),
  };
}
