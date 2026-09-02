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
  readonly bodyLimit: string;
}

const TWELVE_HOURS = 12 * 60 * 60 * 1000;

function int(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
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
    bodyLimit: env["BODY_LIMIT"] ?? "1mb",
  };
}
