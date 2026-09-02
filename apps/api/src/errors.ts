/**
 * The error contract — docs/rebuild/01-conventions.md §4.
 *
 * "Errors return `{ error: { code, message, field? } }`. `message` is written
 * for a human staff member in Indonesian, because it is shown verbatim."
 *
 * `code` is the stable identifier the SPA branches on; `message` is prose and
 * may be reworded freely.
 */

import type { ErrorRequestHandler, RequestHandler } from "express";
import type { Logger } from "@nusantara/logging";
import { ZodError } from "zod";
import {
  AmbiguousHoldError,
  BookingInPastError,
  BookingTooFarAheadError,
  DuplicateHoldError,
  HoldAlreadySettledError,
  HoldNotFoundError,
  OutsideStoreHoursError,
  Prisma,
  UnitNotAvailableError,
  UnknownSerialError,
} from "@nusantara/db";
import { IllegalUnitTransitionError } from "@nusantara/domain";

export type ErrorCode =
  | "VALIDASI"
  | "TIDAK_LOGIN"
  | "AKSES_DITOLAK"
  | "TIDAK_DITEMUKAN"
  | "KONFLIK"
  | "TERLALU_BANYAK"
  | "KESALAHAN_SERVER";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly field?: string;
  /** Seconds, for a 429. */
  readonly retryAfter?: number;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    options: { field?: string; retryAfter?: number } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.field = options.field;
    this.retryAfter = options.retryAfter;
  }
}

export const unauthenticated = (): ApiError =>
  new ApiError(
    401,
    "TIDAK_LOGIN",
    "Sesi tidak valid atau sudah berakhir. Silakan masuk lagi.",
  );

export const forbidden = (): ApiError =>
  new ApiError(
    403,
    "AKSES_DITOLAK",
    "Akses ditolak. Fitur ini khusus pemilik.",
  );

export const notFound = (what: string): ApiError =>
  new ApiError(404, "TIDAK_DITEMUKAN", `${what} tidak ditemukan.`);

/** Anything that fell through the router. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new ApiError(404, "TIDAK_DITEMUKAN", "Endpoint tidak ditemukan."));
};

/**
 * A service's refusal, translated into this app's error contract.
 *
 * The service layer in `packages/db` may not import `ApiError` — the agent and
 * the worker call the same functions, and neither of them is an HTTP server.
 * So the boundary needs one translator, and it lives here rather than in every
 * route's `catch`, for the same reason the BigInt replacer is set once on the
 * app: so that no route can forget.
 *
 * `message` is passed through verbatim for every class we own, because each of
 * them writes Indonesian prose for a cashier (01 §4) and names the subject —
 * which serial is gone, which code is taken. Prisma's own messages are NOT
 * passed through: they name columns and constraints, and a cashier reading
 * "Unique constraint failed on the fields: (`phone`)" learns nothing.
 *
 * Anything unrecognised is returned unchanged and falls through to the branches
 * below, including the generic 500.
 */
export function mapServiceError(err: unknown): unknown {
  if (err instanceof UnknownSerialError)
    return new ApiError(404, "TIDAK_DITEMUKAN", err.message);
  if (err instanceof HoldNotFoundError)
    return new ApiError(404, "TIDAK_DITEMUKAN", err.message);

  if (err instanceof UnitNotAvailableError)
    return new ApiError(409, "KONFLIK", err.message);
  if (err instanceof DuplicateHoldError)
    return new ApiError(409, "KONFLIK", err.message);
  if (err instanceof HoldAlreadySettledError)
    return new ApiError(409, "KONFLIK", err.message);
  if (err instanceof AmbiguousHoldError)
    return new ApiError(409, "KONFLIK", err.message);
  if (err instanceof IllegalUnitTransitionError)
    return new ApiError(409, "KONFLIK", err.message);

  if (err instanceof BookingInPastError)
    return new ApiError(400, "VALIDASI", err.message, { field: "scheduledFor" });
  if (err instanceof BookingTooFarAheadError)
    return new ApiError(400, "VALIDASI", err.message, { field: "scheduledFor" });
  if (err instanceof OutsideStoreHoursError)
    return new ApiError(400, "VALIDASI", err.message, { field: "scheduledFor" });

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2025 — a row the service read by id is not there.
    if (err.code === "P2025")
      return new ApiError(404, "TIDAK_DITEMUKAN", "Data tidak ditemukan.");
    // P2002 — unique violation.
    if (err.code === "P2002")
      return new ApiError(
        409,
        "KONFLIK",
        "Data ini sudah ada. Muat ulang halaman dan coba lagi.",
      );
    // P2003 — a foreign key naming something that does not exist. That is a bad
    // request, not a race: the caller sent an id for a row nobody has.
    if (err.code === "P2003") {
      const field = (err.meta as { field_name?: unknown } | undefined)
        ?.field_name;
      return new ApiError(
        400,
        "VALIDASI",
        "Ada pilihan yang tidak dikenal. Muat ulang halaman dan coba lagi.",
        typeof field === "string" ? { field } : {},
      );
    }
    // P2034 — write conflict or deadlock. NOT a 409: `withRetry` exists to
    // retry exactly this, and its own docblock says a constraint violation is
    // an answer while this is not. It also must stay outside the 2xx-4xx range
    // the idempotency middleware stores, or the transient would be pinned as
    // the permanent answer for that key for a full day.
    if (err.code === "P2034")
      return new ApiError(
        503,
        "KESALAHAN_SERVER",
        "Transaksi bentrok dengan transaksi lain. Coba lagi sebentar.",
      );
  }

  return err;
}

/**
 * The single place an error becomes a response.
 *
 * An unexpected error is logged in full and answered with a generic Indonesian
 * message: a stack trace is for the log, never for the cashier's screen.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (rawError, _req, res, _next) => {
    // First, so a service's typed refusal becomes an ApiError before the
    // branches below see it — and so no route handler has to remember.
    const err = mapServiceError(rawError);

    if (err instanceof ZodError) {
      const first = err.issues[0];
      res.status(400).json({
        error: {
          code: "VALIDASI",
          message: "Data yang dikirim tidak valid.",
          ...(first?.path[0] === undefined
            ? {}
            : { field: String(first.path[0]) }),
        },
      });
      return;
    }

    if (err instanceof ApiError) {
      if (err.retryAfter !== undefined)
        res.setHeader("retry-after", String(err.retryAfter));
      res.status(err.status).json({
        error: {
          code: err.code,
          message: err.message,
          ...(err.field === undefined ? {} : { field: err.field }),
        },
      });
      return;
    }

    logger.error({ err, evt: "http.unhandled" }, "kesalahan tidak tertangani");
    res.status(500).json({
      error: {
        code: "KESALAHAN_SERVER",
        message: "Terjadi kesalahan di server. Coba lagi sebentar.",
      },
    });
  };
}
