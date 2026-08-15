/**
 * The request middleware — docs/rebuild/05-logging.md §3.
 *
 * Assigns the `rid` once, returns it on the response, and binds it to the whole
 * async call tree so nothing downstream has to thread it through.
 *
 * The request/response types are structural rather than imported from Express.
 * This package is used by the API, the webhook, the worker and the monitor; a
 * structural type keeps it framework-free and lets the tests drive it without
 * standing up a server. Express's own Request/Response satisfy it.
 */

import { ulid } from "ulid";
import { type LogContext, runWithContext } from "./context.js";
import type { Logger } from "./logger.js";
import { DEFAULT_BODY_MAX_BYTES, redactBody, stripQuery } from "./redact.js";

export interface LoggableRequest {
  readonly method: string;
  readonly url: string;
  readonly originalUrl?: string;
  readonly baseUrl?: string;
  /** Express fills this in once a route has matched. */
  readonly route?: { readonly path?: string };
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body?: unknown;
}

export interface LoggableResponse {
  readonly statusCode: number;
  setHeader(name: string, value: string): unknown;
  on(event: string, listener: () => void): unknown;
}

export type BodyPolicy = "never" | "on-error" | "always";

export interface RequestLoggerOptions {
  readonly logger: Logger;
  /** Default "on-error": a healthy request does not need its body in the log. */
  readonly bodyPolicy?: BodyPolicy;
  readonly bodyMaxBytes?: number;
  /** Injectable for deterministic tests. */
  readonly newId?: () => string;
  readonly now?: () => number;
}

/** A header may arrive repeated; take the first, and only if it looks sane. */
function firstHeader(
  headers: LoggableRequest["headers"],
  name: string,
): string | undefined {
  const raw = headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  // Bounded and printable: a caller-supplied id must not become a log-injection
  // vector or an unbounded string in every record.
  if (trimmed === "" || trimmed.length > 64) return undefined;
  return /^[\w.:-]+$/.test(trimmed) ? trimmed : undefined;
}

/**
 * The route **pattern**, not the filled path (§3): `/api/unit/:serial`, so all
 * requests to one route aggregate. Falls back to the query-stripped path when
 * no route matched, which is the only thing a 404 has.
 */
function routeOf(req: LoggableRequest): string {
  const pattern = req.route?.path;
  if (typeof pattern === "string" && pattern !== "") {
    return `${req.baseUrl ?? ""}${pattern}` || pattern;
  }
  return stripQuery(req.originalUrl ?? req.url);
}

/**
 * Express-compatible middleware.
 *
 * Never throws into the request path (§2): every logging step is guarded, and a
 * failure to log is silently survivable where a failure to serve is not.
 */
export function requestLogger(options: RequestLoggerOptions) {
  const {
    logger,
    bodyPolicy = "on-error",
    bodyMaxBytes = DEFAULT_BODY_MAX_BYTES,
    newId = ulid,
    now = () => Date.now(),
  } = options;

  return function handle(
    req: LoggableRequest,
    res: LoggableResponse,
    next: (err?: unknown) => void,
  ): void {
    let rid: string;
    let cid: string | undefined;

    try {
      rid = firstHeader(req.headers, "x-request-id") ?? newId();
      cid = firstHeader(req.headers, "x-correlation-id");
      res.setHeader("x-request-id", rid);
    } catch {
      // Even id assignment must not break the request.
      next();
      return;
    }

    const started = now();

    // Held in the closure, not read back from AsyncLocalStorage. The "finish"
    // event fires from the socket's async context, which is not reliably the
    // one this middleware ran in, so the ambient rid can be missing exactly on
    // the record that most needs it. ALS still serves handlers downstream; the
    // http.request line carries the id explicitly.
    const context: LogContext = { rid, cid };

    runWithContext(context, () => {
      res.on("finish", () => {
        try {
          const status = res.statusCode;
          const failed = status >= 400;
          const wantBody =
            bodyPolicy === "always" || (bodyPolicy === "on-error" && failed);

          logger[failed ? "warn" : "info"](
            {
              rid,
              ...(context.sid === undefined ? {} : { sid: context.sid }),
              evt: "http.request",
              dur: now() - started,
              ctx: {
                method: req.method,
                route: routeOf(req),
                status,
                ...(cid === undefined ? {} : { cid }),
                // `reqBody`, not `body`: a bare `body` is never-logged content.
                ...(wantBody
                  ? { reqBody: redactBody(req.body, bodyMaxBytes) }
                  : {}),
              },
            },
            `${req.method} ${routeOf(req)} ${status}`,
          );
        } catch {
          // A logging failure is not a request failure.
        }
      });

      next();
    });
  };
}
