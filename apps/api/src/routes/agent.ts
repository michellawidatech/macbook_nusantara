/**
 * `/api/agent/v1` — the POS as the chatbot's Operations side sees it
 * (chatbot v2 step 3; docs/chatbot-v2-design.md §4, packages/agent agentApi.ts).
 *
 * Not behind a staff session: the caller is the worker, and it proves itself
 * with a token it signed for one turn of one thread (`AGENT_API_SECRET`, held
 * by the worker and this process and nobody else). The token is also the only
 * place the customer comes from — `ctx.from` is `claims.waId`, and no route
 * reads a phone number from the path, the query or the body. "A customer can
 * only write to their own data" (owner, 2026-10-14) is that sentence.
 *
 * Fail closed: with no secret configured every call is 503, so a deploy that
 * has not set it exposes nothing; the worker then keeps running its tools
 * locally, as it did before this route existed.
 *
 * The tools run exactly as they did in the worker — `dispatchTool`, the same
 * functions, the same fail-soft `{ error }` objects — with two HTTP readings
 * on top: a switched-off tool is 403, and a lookup that found nothing
 * (`found: false`) is 404 with the tool's own words as the body.
 */

import { Router, type RequestHandler } from "express";
import type { PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import {
  AGENT_API_ROUTES,
  CODE_ONLY_TOOLS,
  argsFromRequest,
  dispatchTool,
  effectiveCapabilities,
  toolsFor,
  verifyAgentToken,
  type AgentClaims,
  type ToolContext,
} from "@nusantara/agent";

export interface AgentRouterDeps {
  readonly db: PrismaClient;
  readonly logger: Logger;
  /** Null or empty: the route answers 503 to everything. */
  readonly secret: string | null;
  /** The Staff row a bot booking's UnitEvent is attributed to. */
  readonly agentStaffId: string;
  /** Injectable clock, for the token's expiry. */
  readonly now?: () => Date;
}

/** Writes already made in a turn, so a retried call cannot book twice. */
interface TurnState {
  readonly writes: Set<string>;
  readonly exp: number;
}

export function agentRouter(deps: AgentRouterDeps): Router {
  const { db, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const router = Router();
  const turns = new Map<string, TurnState>();

  const authenticate: RequestHandler = (req, res, next) => {
    if (!deps.secret) {
      res.status(503).json({ error: "The agent API is not configured." });
      return;
    }
    const header = req.get("authorization") ?? "";
    const token = /^Bearer\s+(\S+)$/.exec(header)?.[1];
    const claims = token ? verifyAgentToken(token, deps.secret, now()) : null;
    if (!claims) {
      res.status(401).json({ error: "Invalid or expired agent token." });
      return;
    }
    res.locals["claims"] = claims;
    next();
  };

  /** The turn's write set, created on first use and dropped once it expires. */
  const turnOf = (claims: AgentClaims): Set<string> => {
    const at = now().getTime();
    for (const [k, v] of turns) if (v.exp <= at) turns.delete(k);
    const key = `${claims.waId}:${claims.turn}`;
    let state = turns.get(key);
    if (!state) {
      state = { writes: new Set(), exp: claims.exp };
      turns.set(key, state);
    }
    return state.writes;
  };

  router.use(authenticate);

  for (const route of AGENT_API_ROUTES) {
    const method = route.method.toLowerCase() as
      "get" | "post" | "patch" | "delete";
    router[method](route.path, async (req, res, next) => {
      try {
        const claims = res.locals["claims"] as AgentClaims;
        const ctx: ToolContext = {
          from: claims.waId,
          now: now(),
          capabilities: claims.caps,
          writesUsed: turnOf(claims),
          onError: (tool, err) =>
            logger.error(
              {
                evt: "agent_api.tool.failed",
                ctx: { tool, from: claims.waId },
                ...(err instanceof Error
                  ? { err: { name: err.name, message: err.message } }
                  : {}),
              },
              "an agent tool failed",
            ),
          ...(claims.writes
            ? {
                reserve: {
                  write: db,
                  staffId: deps.agentStaffId,
                  ...(typeof claims.graceMs === "number"
                    ? { graceMs: claims.graceMs }
                    : {}),
                },
                profile: { write: db },
              }
            : {}),
        };

        // The same gate the model's tool list is built from, so a tool the
        // switches forbid is not reachable by calling its URL either.
        const allowed = new Set(
          toolsFor(ctx, { capabilities: claims.caps, proposals: true }).map(
            (t) => t.name,
          ),
        );
        // The confirm is never in a model's tool list; it is the pipeline's
        // own call, allowed on exactly the terms a booking is.
        if (
          claims.writes &&
          effectiveCapabilities(claims.caps).reserve &&
          (CODE_ONLY_TOOLS as readonly string[]).includes(route.tool)
        )
          allowed.add(route.tool);
        if (!allowed.has(route.tool)) {
          res.status(403).json({ error: "That lookup is switched off." });
          return;
        }

        const out = await dispatchTool(
          db,
          route.tool,
          argsFromRequest(route.tool, {
            params: req.params as Record<string, string>,
            query: req.query as Record<string, unknown>,
            body: req.body,
          }),
          ctx,
        );
        const notFound =
          typeof out === "object" &&
          out !== null &&
          (out as { found?: unknown }).found === false;
        res.status(notFound ? 404 : 200).json(out);
      } catch (err) {
        next(err);
      }
    });
  }

  return router;
}
