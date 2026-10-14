/**
 * The POS behind REST — what the bot's Operations side may ask, and how
 * (chatbot v2 step 3, docs/chatbot-v2-design.md §4).
 *
 * Owner answer, 2026-10-14: the bot reaches the POS through its REST API, and
 * "a customer can only write to their own data". So every call carries a
 * short-lived token the worker signs for ONE turn of ONE thread, and the API
 * reads the customer from the token — **no route takes a phone number**. A
 * message saying "cancel the booking for 0812…" is a sentence, never an
 * argument, so it cannot reach somebody else's hold however it is phrased.
 *
 * The tools themselves are unchanged: `dispatchTool` still runs them, now on
 * the API's side of the wire. This file is the contract between the halves —
 * the route table, the token, the client, and how a request becomes a tool's
 * arguments — and it is pure apart from `fetch` and `node:crypto`.
 *
 * What stays in the worker: the knowledge search (its `K` handles must match
 * the prompt the worker built), the shop's facts and configurations, and the
 * hand-over. None of them is POS data about a unit or a customer.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { ANTHROPIC_TOOLS, type ToolContext } from "./tools.js";
import type { AgentCapabilities } from "./policy.js";

export type AgentMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface AgentRoute {
  readonly tool: string;
  readonly method: AgentMethod;
  /** Under `/api/agent/v1`. `:serial` / `:code` are filled from the arguments. */
  readonly path: string;
}

/**
 * Resource by resource. `/me` is the customer the token names — there is no
 * other customer this API can be asked about.
 */
export const AGENT_API_ROUTES: readonly AgentRoute[] = [
  { tool: "search_stock", method: "GET", path: "/stock" },
  { tool: "check_serial", method: "GET", path: "/units/:serial" },
  { tool: "unit_photos", method: "GET", path: "/units/:serial/photos" },
  { tool: "find_unit_photos", method: "GET", path: "/photos" },
  { tool: "browse_catalog", method: "GET", path: "/catalog" },
  { tool: "lookup_customer", method: "GET", path: "/me" },
  { tool: "remember_customer", method: "PATCH", path: "/me/profile" },
  { tool: "check_order", method: "GET", path: "/me/orders/:code" },
  { tool: "check_reservation", method: "GET", path: "/me/reservations" },
  { tool: "create_reservation", method: "POST", path: "/me/reservations" },
  { tool: "reschedule_reservation", method: "PATCH", path: "/me/reservations" },
  { tool: "cancel_reservation", method: "DELETE", path: "/me/reservations" },
];

/** The tools that cross the wire. Everything else runs in the worker. */
export const REMOTE_TOOLS: ReadonlySet<string> = new Set(
  AGENT_API_ROUTES.map((r) => r.tool),
);

const routeOf = (tool: string) => AGENT_API_ROUTES.find((r) => r.tool === tool);

// --- the token -------------------------------------------------------------

/** What a token says. Everything the API may know about who is asking. */
export interface AgentClaims {
  /** The thread: the wa_id the reply will go to. */
  readonly waId: string;
  /** One turn, so writes in a turn are counted once (`writesUsed`). */
  readonly turn: string;
  /** The shop's switches as the worker read them for this turn. */
  readonly caps: AgentCapabilities;
  /** Whether this caller may write (book, remember). The worker may. */
  readonly writes: boolean;
  /**
   * The worker's booking grace (`WORKER_RESERVATION_GRACE_MS`), so a booking
   * made on the API's side tells the customer the same "held until" the
   * worker's expiry pass will honour.
   */
  readonly graceMs?: number;
  /** Expiry, epoch milliseconds. */
  readonly exp: number;
}

/** A turn takes seconds; a token outliving a few minutes is a token to steal. */
export const AGENT_TOKEN_TTL_MS = 5 * 60_000;

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const sign = (body: string, secret: string) =>
  createHmac("sha256", secret).update(body).digest("base64url");

export function mintAgentToken(
  claims: Omit<AgentClaims, "exp">,
  secret: string,
  now: Date,
  ttlMs: number = AGENT_TOKEN_TTL_MS,
): string {
  if (!secret) throw new Error("no agent API secret");
  const body = b64(JSON.stringify({ ...claims, exp: now.getTime() + ttlMs }));
  return `${body}.${sign(body, secret)}`;
}

/** The claims, or null for anything forged, mangled or expired. */
export function verifyAgentToken(
  token: string,
  secret: string,
  now: Date,
): AgentClaims | null {
  if (!secret) return null;
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const want = Buffer.from(sign(body, secret));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let claims: AgentClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof claims?.waId !== "string" ||
    !claims.waId ||
    typeof claims.turn !== "string" ||
    typeof claims.exp !== "number" ||
    typeof claims.caps !== "object" ||
    claims.caps === null
  ) {
    return null;
  }
  return claims.exp > now.getTime() ? claims : null;
}

// --- from a request to a tool's arguments ----------------------------------

/** The keys a tool's schema declares as numbers — the only ones a query string coerces. */
const NUMERIC_KEYS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  ANTHROPIC_TOOLS.map((t) => {
    const props = (t.input_schema.properties ?? {}) as Record<
      string,
      { type?: string }
    >;
    return [
      t.name,
      new Set(
        Object.entries(props)
          .filter(([, p]) => p.type === "integer" || p.type === "number")
          .map(([k]) => k),
      ),
    ];
  }),
);

/**
 * One tool's arguments out of a request: path parameters, then the query,
 * then a JSON body. A query string carries text, so a key the tool's schema
 * calls a number is turned back into one (`search_stock`'s price bounds);
 * nothing else is guessed at — a serial of digits stays a string.
 */
export function argsFromRequest(
  tool: string,
  req: {
    readonly params?: Record<string, string>;
    readonly query?: Record<string, unknown>;
    readonly body?: unknown;
  },
): Record<string, unknown> {
  const numeric = NUMERIC_KEYS.get(tool) ?? new Set<string>();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req.query ?? {})) {
    if (typeof v !== "string") continue;
    out[k] = numeric.has(k) && /^\d+$/.test(v) ? Number(v) : v;
  }
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    Object.assign(out, req.body as Record<string, unknown>);
  }
  for (const [k, v] of Object.entries(req.params ?? {})) out[k] = v;
  return out;
}

// --- the worker's client ---------------------------------------------------

export interface AgentApiOptions {
  /** e.g. `http://127.0.0.1:4000/api/agent/v1` */
  readonly baseUrl: string;
  readonly secret: string;
  readonly fetchImpl?: typeof fetch;
  /** A call that has not answered in this long is a failed lookup. */
  readonly timeoutMs?: number;
}

/** What `converse` calls instead of `dispatchTool` for a tool on the wire. */
export type ToolDispatch = (
  name: string,
  input: unknown,
  ctx: ToolContext,
) => Promise<unknown>;

/**
 * A dispatcher that sends the POS tools to the API and runs the rest locally.
 *
 * Fails soft exactly as `dispatchTool` does: a timeout, a 5xx or a refused
 * switch comes back as an `{ error }` object the model reads and hands over
 * on, never as a throw that ends the turn — and the failure goes to
 * `ctx.onError`, so it is in the log and not only in the customer's reply.
 */
export function agentApiDispatch(
  opts: AgentApiOptions,
  local: ToolDispatch,
  turn: { readonly id: string; readonly now: Date },
): ToolDispatch {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, "");
  return async (name, input, ctx) => {
    const route = routeOf(name);
    if (!route) return local(name, input, ctx);

    const args =
      input && typeof input === "object" && !Array.isArray(input)
        ? { ...(input as Record<string, unknown>) }
        : {};
    let path = route.path;
    for (const key of ["serial", "code"]) {
      if (!path.includes(`:${key}`)) continue;
      const value = String(args[key] ?? "").trim();
      if (!value) return { error: `No ${key} given.` };
      path = path.replace(`:${key}`, encodeURIComponent(value));
      delete args[key];
    }

    let url = `${base}${path}`;
    let body: string | undefined;
    if (route.method === "GET" || route.method === "DELETE") {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(args)) {
        if (v === undefined || v === null || v === "") continue;
        q.set(k, String(v));
      }
      const qs = q.toString();
      if (qs) url += `?${qs}`;
    } else {
      body = JSON.stringify(args);
    }

    const token = mintAgentToken(
      {
        waId: ctx.from,
        turn: turn.id,
        caps: ctx.capabilities ?? ({} as AgentCapabilities),
        writes: Boolean(ctx.reserve || ctx.profile),
        ...(ctx.reserve?.graceMs !== undefined
          ? { graceMs: ctx.reserve.graceMs }
          : {}),
      },
      opts.secret,
      turn.now,
    );

    try {
      const res = await fetchImpl(url, {
        method: route.method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });
      const payload = (await res.json().catch(() => null)) as unknown;
      // A 404 from a lookup is an answer ("no unit with that serial"), and
      // the API sends the tool's own words with it.
      if (res.ok || res.status === 404) return payload;
      ctx.onError?.(
        name,
        new Error(`agent API ${res.status} on ${route.path}`),
      );
      if (res.status === 403) {
        return {
          error: "That lookup is switched off. Hand over to a colleague.",
        };
      }
      return {
        error: `The ${name} lookup failed. Say you will check and hand over to a colleague.`,
      };
    } catch (err) {
      ctx.onError?.(name, err);
      return {
        error: `The ${name} lookup failed. Say you will check and hand over to a colleague.`,
      };
    }
  };
}
