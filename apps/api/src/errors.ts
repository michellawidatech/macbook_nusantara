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
 * The single place an error becomes a response.
 *
 * An unexpected error is logged in full and answered with a generic Indonesian
 * message: a stack trace is for the log, never for the cashier's screen.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
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
