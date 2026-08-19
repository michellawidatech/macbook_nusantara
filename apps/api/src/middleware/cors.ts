/**
 * CORS — docs/rebuild/08-data-integrity.md §9: "CORS is locked to the SPA
 * origin."
 *
 * `config.corsOrigin` existed since S6 but nothing read it, so the lock was
 * documented and not installed. In practice the API was saved by accident:
 * emitting no `Access-Control-Allow-Origin` at all makes a browser refuse a
 * cross-origin read anyway. That is fail-closed by omission, which is not the
 * same as fail-closed by decision — and it left the config lying.
 *
 * Written by hand rather than pulled from the `cors` package because the
 * allowlist here is one or two known origins and the dangerous knob in that
 * package (`origin: true`, which reflects whatever asked) is one this app must
 * never have.
 */

import type { RequestHandler } from "express";

export interface CorsDeps {
  /** Comma-separated. Normally the single SPA origin. */
  readonly allowedOrigins: string;
}

const ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";

/** Exactly the request headers `lib/api.ts` sends, and nothing more. */
const ALLOWED_HEADERS = [
  "content-type",
  "x-correlation-id",
  "idempotency-key",
].join(", ");

/** The response headers the SPA is allowed to read back (05 §3). */
const EXPOSED_HEADERS = ["x-request-id", "retry-after"].join(", ");

const PREFLIGHT_MAX_AGE = "600";

export function cors({ allowedOrigins }: CorsDeps): RequestHandler {
  const allowlist = new Set(
    allowedOrigins
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o !== "" && o !== "*"),
  );

  return (req, res, next) => {
    const origin = req.get("origin");

    // Same-origin requests — which is every real request, since both dev and
    // production put the SPA and the API behind one origin — send no Origin at
    // all. Nothing to negotiate.
    if (origin !== undefined) {
      // Always Vary, allowed or not. Without it a shared cache can hand a
      // second origin the ACAO header computed for the first one, which turns
      // a correct allowlist into a wrong answer served from cache.
      res.setHeader("vary", "origin");

      if (allowlist.has(origin)) {
        // The literal allowed origin, never a reflection of what was asked and
        // never `*` — `*` is incompatible with credentialed requests anyway,
        // and this API authenticates with a cookie.
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("access-control-allow-credentials", "true");
        res.setHeader("access-control-expose-headers", EXPOSED_HEADERS);
      }
    }

    if (req.method === "OPTIONS") {
      // A preflight is answered here or not at all: letting it fall through to
      // the router would 404 and tell the caller nothing useful. A disallowed
      // origin still gets 204, just without the headers that would let the
      // real request follow — the browser is the one that enforces.
      if (origin !== undefined && allowlist.has(origin)) {
        res.setHeader("access-control-allow-methods", ALLOWED_METHODS);
        res.setHeader("access-control-allow-headers", ALLOWED_HEADERS);
        res.setHeader("access-control-max-age", PREFLIGHT_MAX_AGE);
      }
      res.status(204).end();
      return;
    }

    next();
  };
}
