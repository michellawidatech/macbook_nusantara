/**
 * wa-gateway configuration (owner decision 2026-10-22: WhatsApp through a
 * linked device, docs/whatsapp-baileys.md).
 *
 * Built from an explicitly passed environment, as every app here does it
 * (01 §7): `main.ts` is the only file that reads `process.env`.
 *
 * ## The refusal is the safety rule
 *
 * A linked device receives every chat the shop's number receives and sends as
 * the shop. Staging's database is a copy of the shop's — customers' numbers and
 * the Outbox of replies not yet sent included — so a gateway there would answer
 * real people from the real number, a second time. It therefore refuses to
 * start unless `APP_ENV=prod`, or a developer says `WA_GATEWAY_ALLOW_NONPROD=1`
 * on purpose (on a laptop, with a spare number). ops/run refuses a second time
 * before the process is even started.
 */

export interface PacingConfig {
  /** The least time between two messages to the same chat. */
  readonly perChatMs: number;
  /** The least time between any two messages from the shop's number. */
  readonly globalMs: number;
  /** "typing…" before a reply: at least this long … */
  readonly typingMinMs: number;
  /** … at most this long … */
  readonly typingMaxMs: number;
  /** … and this much per character in between. */
  readonly typingMsPerChar: number;
}

export interface GatewayConfig {
  readonly appEnv: string;
  readonly allowNonProd: boolean;
  /** Loopback only, always. Not configurable on purpose. */
  readonly host: "127.0.0.1";
  readonly port: number;
  /** Every route but /health wants it in `x-wa-gateway-secret`. */
  readonly secret: string;
  /** The linked session. Outside the release, so it survives a deploy. */
  readonly stateDir: string;
  /** Where an inbound message is POSTed, signed, as Meta would. */
  readonly webhookUrl: string;
  /** The webhook's APP_SECRET — the HMAC key `X-Hub-Signature-256` uses. */
  readonly appSecret: string;
  /** Link attempts allowed per window (the "do not link repeatedly" rule). */
  readonly linkMax: number;
  readonly linkWindowMs: number;
  readonly pacing: PacingConfig;
}

export const GATEWAY_SECRET_HEADER = "x-wa-gateway-secret";
export const DEFAULT_GATEWAY_PORT = 3002;

function int(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadGatewayConfig(
  env: Record<string, string | undefined>,
): GatewayConfig {
  return {
    appEnv: env["APP_ENV"]?.trim() ?? "",
    allowNonProd: env["WA_GATEWAY_ALLOW_NONPROD"]?.trim() === "1",
    host: "127.0.0.1",
    port: int(env["WA_GATEWAY_PORT"], DEFAULT_GATEWAY_PORT),
    secret: env["WA_GATEWAY_SECRET"]?.trim() ?? "",
    stateDir: env["WA_GATEWAY_STATE_DIR"]?.trim() ?? "",
    webhookUrl:
      env["WA_GATEWAY_WEBHOOK_URL"]?.trim() || "http://127.0.0.1:3001/webhook",
    appSecret: env["APP_SECRET"]?.trim() ?? "",
    linkMax: int(env["WA_GATEWAY_LINK_MAX"], 3),
    linkWindowMs: int(env["WA_GATEWAY_LINK_WINDOW_MS"], 3_600_000),
    pacing: {
      perChatMs: int(env["WA_GATEWAY_PER_CHAT_MS"], 1_500),
      globalMs: int(env["WA_GATEWAY_GLOBAL_MS"], 400),
      typingMinMs: int(env["WA_GATEWAY_TYPING_MIN_MS"], 800),
      typingMaxMs: int(env["WA_GATEWAY_TYPING_MAX_MS"], 3_500),
      typingMsPerChar: int(env["WA_GATEWAY_TYPING_MS_PER_CHAR"], 25),
    },
  };
}

/**
 * Why this process must not start, one sentence each. Empty means it may.
 * A placeholder secret counts as unset, as the doctor reads them.
 */
export function startupProblems(config: GatewayConfig): string[] {
  const out: string[] = [];
  if (config.appEnv !== "prod" && !config.allowNonProd) {
    out.push(
      `wa-gateway runs on prod only (APP_ENV is '${config.appEnv}'); set WA_GATEWAY_ALLOW_NONPROD=1 for a laptop test with a spare number`,
    );
  }
  if (config.secret.length < 16 || config.secret === "CHANGE_ME") {
    out.push("WA_GATEWAY_SECRET must be set, at least 16 characters");
  }
  if (!config.appSecret || config.appSecret === "CHANGE_ME") {
    out.push(
      "APP_SECRET must be set — the webhook refuses an unsigned delivery",
    );
  }
  if (!config.stateDir) {
    out.push(
      "WA_GATEWAY_STATE_DIR must be set (prod: /opt/nusantara/var/wa-gateway)",
    );
  }
  return out;
}
