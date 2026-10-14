/**
 * API configuration.
 *
 * Always constructed from an explicitly passed environment, never read from
 * `process.env` at module scope. 01 §7: "Fail-closed tests must not read the
 * developer's `.env` — inject config explicitly." This repo has been bitten by
 * that once already.
 */

export interface LoginLimitConfig {
  /** Failures allowed inside the window before the delay starts growing. */
  readonly maxAttempts: number;
  readonly windowMs: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export interface ApiConfig {
  readonly env: string;
  readonly port: number;
  /** 01 §4 names the cookie. */
  readonly cookieName: string;
  /** Off only for local HTTP development. */
  readonly cookieSecure: boolean;
  /** 08 §9: sessions expire absolutely, not on idle. */
  readonly sessionTtlMs: number;
  readonly idempotencyTtlMs: number;
  readonly login: LoginLimitConfig;
  /** CORS is locked to the SPA origin (08 §9). */
  readonly corsOrigin: string;
  /**
   * Express's `trust proxy`: which hops in front of the API may be believed
   * about who the client is. The login limiter keys on the result, per IP.
   *
   * `loopback` by default. On the Mac mini `tailscale serve` and Caddy both
   * run on the same machine, so every hop in front of the API is 127.0.0.1
   * and the first address that is NOT loopback is the person. The old `1`
   * trusted Caddy alone, which made req.ip tailscale's 127.0.0.1 for every
   * client — the whole shop shared one limiter bucket, and one person's typos
   * delayed everybody's sign-in. A number (`TRUST_PROXY=2`) or a subnet list
   * is passed through for a host laid out differently.
   */
  readonly trustProxy: string | number;
  readonly bodyLimit: string;
  /**
   * Which release is serving, for `/api/health`. `ops/run` exports it from the
   * release's own RELEASE file; the deploy pipeline refuses a switch whose API
   * does not answer with the version it just installed. Null outside a release.
   */
  readonly release: string | null;
  /**
   * Shared with the worker only (chatbot v2 step 3): it signs the per-turn
   * tokens `/api/agent/v1` accepts. Unset, that route answers 503 and the
   * worker keeps running its tools locally.
   */
  readonly agentApiSecret: string | null;
  /** The Staff row a bot booking is attributed to — the worker's default. */
  readonly agentStaffId: string;
}

const TWELVE_HOURS = 12 * 60 * 60 * 1000;

function int(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function trustProxy(raw: string | undefined): string | number {
  const value = raw?.trim();
  if (value === undefined || value === "") return "loopback";
  return /^\d+$/.test(value) ? Number(value) : value;
}

export function loadConfig(env: Record<string, string | undefined>): ApiConfig {
  const nodeEnv = env["NODE_ENV"] ?? "development";
  return {
    env: nodeEnv,
    // `API_PORT` is this repo's own name and wins, so nothing about local
    // development changes. `PORT` is the fallback because every PaaS — Railway
    // included — assigns the port at runtime and injects it under that name;
    // without this the container would bind 4000, the platform would health-check
    // the port it assigned, and the deploy would fail as "no response".
    port: int(env["API_PORT"] ?? env["PORT"], 4000),
    cookieName: env["SESSION_COOKIE_NAME"] ?? "nusantara_token",
    // Secure by default; only an explicit opt-out turns it off, so a
    // misconfigured production cannot quietly serve cookies over HTTP.
    cookieSecure: env["SESSION_COOKIE_INSECURE"] !== "1",
    sessionTtlMs: int(env["SESSION_TTL_MS"], TWELVE_HOURS),
    idempotencyTtlMs: int(env["IDEMPOTENCY_TTL_MS"], 24 * 60 * 60 * 1000),
    login: {
      maxAttempts: int(env["LOGIN_MAX_ATTEMPTS"], 5),
      windowMs: int(env["LOGIN_WINDOW_MS"], 15 * 60 * 1000),
      baseDelayMs: int(env["LOGIN_BASE_DELAY_MS"], 1_000),
      maxDelayMs: int(env["LOGIN_MAX_DELAY_MS"], 5 * 60 * 1000),
    },
    corsOrigin: env["CORS_ORIGIN"] ?? "http://localhost:3000",
    trustProxy: trustProxy(env["TRUST_PROXY"]),
    bodyLimit: env["BODY_LIMIT"] ?? "1mb",
    release: env["NUSANTARA_RELEASE"] || null,
    agentApiSecret: env["AGENT_API_SECRET"]?.trim() || null,
    agentStaffId: env["WORKER_AGENT_STAFF_ID"]?.trim() || "staff_agent",
  };
}
