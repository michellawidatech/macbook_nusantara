/**
 * Idempotency-Key — docs/rebuild/08-data-integrity.md §3.
 *
 * "Every mutating endpoint accepts `Idempotency-Key`. The key + its response
 * are stored; a repeat returns the stored response instead of acting again.
 * The cashier double-clicking Checkout on a slow connection is the single most
 * likely way to create a duplicate order."
 *
 * Storage is the `IdempotencyKey` table, which is NOT one of the ERD's original
 * 62 — it was added in S6 with the owner's approval, because no existing table
 * could hold a stored response.
 */

import { createHash } from "node:crypto";
import type { RequestHandler, Response } from "express";
import type { PrismaClient } from "@nusantara/db";
import { ApiError } from "../errors.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface IdempotencyDeps {
  readonly db: PrismaClient;
  readonly ttlMs: number;
}

/** A stable fingerprint of what was asked for. */
function fingerprint(method: string, route: string, body: unknown): string {
  return createHash("sha256")
    .update(`${method} ${route} ${JSON.stringify(body ?? null)}`)
    .digest("hex");
}

/**
 * Replay a previous response, or record this one.
 *
 * Only responses the server actually decided are stored — a 5xx is not, so a
 * transient failure can be retried rather than being cached as the answer
 * forever.
 */
export function idempotency({ db, ttlMs }: IdempotencyDeps): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      try {
        const key = req.get("idempotency-key");
        // Unauthenticated or non-mutating requests have nothing to replay.
        if (
          key === undefined ||
          key === "" ||
          !MUTATING.has(req.method) ||
          req.staff === undefined
        ) {
          next();
          return;
        }

        const staffId = req.staff.id;
        const route = req.originalUrl.split("?")[0] ?? req.originalUrl;
        const requestHash = fingerprint(req.method, route, req.body);

        const existing = await db.idempotencyKey.findUnique({
          where: { key_staffId: { key, staffId } },
        });

        if (existing !== null && existing.expiresAt > new Date()) {
          // The same key with a different body is a bug on the client, not a
          // retry. Answering from the cache would hide it.
          if (existing.requestHash !== requestHash) {
            next(
              new ApiError(
                409,
                "KONFLIK",
                "Idempotency-Key ini sudah dipakai untuk permintaan yang berbeda.",
              ),
            );
            return;
          }

          res.setHeader("idempotent-replay", "true");
          res
            .status(existing.statusCode)
            .json(JSON.parse(existing.responseBody));
          return;
        }

        captureAndStore(
          res,
          { db, ttlMs },
          { key, staffId, method: req.method, route, requestHash },
        );
        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}

interface StoreInput {
  readonly key: string;
  readonly staffId: string;
  readonly method: string;
  readonly route: string;
  readonly requestHash: string;
}

/** Wrap res.json so the decided response is remembered before it is sent. */
function captureAndStore(
  res: Response,
  deps: IdempotencyDeps,
  input: StoreInput,
): void {
  const originalJson = res.json.bind(res);

  res.json = (body: unknown): Response => {
    const status = res.statusCode;

    if (status < 500) {
      const now = new Date();
      // Fire-and-forget: a failure to remember must not fail the request the
      // customer is waiting on. A missed record costs a duplicate on retry,
      // which the unique constraint below still catches most of the time.
      void deps.db.idempotencyKey
        .create({
          data: {
            ...input,
            statusCode: status,
            // Express has already applied the BigInt replacer for the wire, but
            // this copy is serialized here, so apply it again.
            responseBody: JSON.stringify(body, (_k, v) =>
              typeof v === "bigint" ? v.toString() : v,
            ),
            createdAt: now,
            expiresAt: new Date(now.getTime() + deps.ttlMs),
          },
        })
        .catch(() => undefined);
    }

    return originalJson(body);
  };
}
