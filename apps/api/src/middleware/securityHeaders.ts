/**
 * Response security headers — docs/rebuild/08-data-integrity.md §9.
 *
 * Hand-rolled rather than Helmet for the same reason `rateLimit.ts` and
 * `idempotency.ts` are: this app's needs are narrow and explicit beats
 * configurable. Helmet's defaults are written for a server that returns HTML;
 * this one returns JSON and nothing else, so almost every default would have to
 * be overridden anyway. Each header below is one auditable line.
 *
 * Mounted FIRST in `createApp`, before the router and before the body parser,
 * so an unhandled 404 and a 500 from the error handler carry them too — a
 * header that only appears on the happy path is not a control.
 */

import type { RequestHandler } from "express";

export interface SecurityHeadersDeps {
  /**
   * Send HSTS. Derived from `config.cookieSecure`, which is the same question
   * asked twice: is this deployment on HTTPS? Sending HSTS over plain HTTP is
   * at best ignored and at worst pins a developer's browser to an https://
   * localhost that does not exist.
   */
  readonly https: boolean;
}

/**
 * A JSON API can lock CSP all the way down: it never loads a script, a style,
 * an image or a font, and it is never framed. `default-src 'none'` says that
 * once. The value matters because a browser that is talked into rendering a
 * JSON response as a document — the classic reflected-XSS-via-API-echo — then
 * has nothing it is allowed to execute.
 *
 * `sandbox` is deliberately NOT in the list: `ArrivalPhoto` is in the schema,
 * so this API will serve files eventually, and a blanket sandbox turns an
 * image or an invoice download into a broken one. `default-src 'none'` already
 * carries the protection that matters.
 */
const CSP = [
  "default-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const TWO_YEARS_SECONDS = 63_072_000;

export function securityHeaders({
  https,
}: SecurityHeadersDeps): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("content-security-policy", CSP);

    // The single most important header here. Without it a browser is free to
    // sniff a JSON body as text/html and run what it finds inside.
    res.setHeader("x-content-type-options", "nosniff");

    // frame-ancestors above is the modern control; X-Frame-Options is the one
    // older browsers actually obey. Both, because clickjacking a POS means
    // clickjacking a stock write.
    res.setHeader("x-frame-options", "DENY");

    // No Referer at all: this API's URLs carry ids (a unit, a session, an
    // order) and those must not leak to whatever a staff member clicks next.
    res.setHeader("referrer-policy", "no-referrer");

    // Isolate the browsing context and refuse cross-origin embedding of these
    // responses, so a hostile page cannot hold a handle on this origin or pull
    // a response into its own document.
    res.setHeader("cross-origin-opener-policy", "same-origin");
    res.setHeader("cross-origin-resource-policy", "same-origin");
    res.setHeader("origin-agent-cluster", "?1");

    // Legacy Flash/Acrobat cross-domain policy files. Cheap to refuse.
    res.setHeader("x-permitted-cross-domain-policies", "none");

    // Every response here is either a staff member's own data or an error.
    // Neither may sit in a shared proxy where the next request can be served
    // someone else's inventory or someone else's session.
    res.setHeader("cache-control", "no-store");

    if (https) {
      res.setHeader(
        "strict-transport-security",
        `max-age=${TWO_YEARS_SECONDS}; includeSubDomains`,
      );
    }

    next();
  };
}
