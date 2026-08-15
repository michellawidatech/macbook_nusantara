/**
 * The sink — docs/rebuild/05-logging.md §2.
 *
 * "Applications write NDJSON to stdout. Nothing else. No app opens a file, no
 * app writes logs to Postgres, no app knows where logs end up."
 *
 * A logging outage can never take down a checkout, because there is no logging
 * I/O in the request path to fail.
 */

import {
  pino,
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from "pino";
import { currentContext } from "./context.js";
import { maskPhones, redactValue } from "./redact.js";

export type { Logger };

/** §2: one of these, never a free-text app name. */
export type AppName = "api" | "web" | "whatsapp-webhook" | "monitor" | "worker";

export type Level = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface CreateLoggerOptions {
  readonly app: AppName;
  /** Injected, never read from process.env here — fail-closed tests (01 §7). */
  readonly env?: string;
  readonly level?: Level;
  /** Defaults to stdout. Tests pass a stream to capture the NDJSON. */
  readonly destination?: DestinationStream;
}

/**
 * The record shape §2 mandates, for every line of every app:
 *
 *   t, lvl, app, env, rid, sid, msg, evt, dur, ctx, err
 *
 * `pid` and `hostname` are removed: they are noise here, and `app` already
 * says which process wrote the line.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const { app, env = "development", level = "info", destination } = options;

  const config: LoggerOptions = {
    level,
    base: { app, env },
    messageKey: "msg",
    errorKey: "err",

    // ISO-8601, UTC — written as a raw fragment, which is how pino keeps
    // timestamping off the hot path.
    timestamp: () => `,"t":"${new Date().toISOString()}"`,

    formatters: {
      // "lvl": "info", not "level": 30.
      level: (label) => ({ lvl: label }),

      // Every record passes through redaction on its way out: money becomes a
      // string (BigInt does not survive JSON.stringify), phone numbers are
      // masked, and secrets never reach the stream. Doing it here means a
      // careless call site cannot leak — §6 is enforced, not requested.
      log: (record) => redactValue(record) as Record<string, unknown>,
    },

    serializers: {
      // §2 names the fields type / msg / stack.
      err: (error: unknown) => {
        // Redaction is applied here rather than in formatters.log, because the
        // Error is deliberately passed through that walk intact.
        if (!(error instanceof Error)) {
          return { type: "NonError", msg: maskPhones(String(error)) };
        }
        return {
          type: error.name,
          msg: maskPhones(error.message),
          stack:
            error.stack === undefined ? undefined : maskPhones(error.stack),
        };
      },
    },

    // §3: rid and sid are ambient, not arguments. A line five calls deep is
    // correlated without anyone remembering to pass the id.
    mixin: () => {
      const ctx = currentContext();
      if (ctx === undefined) return {};
      return ctx.sid === undefined
        ? { rid: ctx.rid }
        : { rid: ctx.rid, sid: ctx.sid };
    },
  };

  return destination === undefined ? pino(config) : pino(config, destination);
}
