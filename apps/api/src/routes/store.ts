/**
 * /api/store — the POS store on PostgreSQL (docs/store-on-postgres.md).
 *
 * Four endpoints and no business rules: every rule lives in
 * `packages/db/src/store`, which the B2Soft import calls too.
 *
 *   GET  /api/store              the whole shop, as the browser reads it
 *   GET  /api/store/changes      what moved since a cursor (410: reload)
 *   POST /api/store/commit       a changeset (400: refused, 409: somebody was first)
 *   GET  /api/store/photos/:id   a stored QC photograph
 *
 * What only Financial & Report reads is scoped by `auth/financeScope.ts`: an
 * account without `canViewFinance` is sent none of it and may only add to it.
 *
 * `requireAuth` and `idempotency` are mounted above every business router in
 * app.ts, so a commit needs a live session and a retried commit with the same
 * `Idempotency-Key` is answered from the stored response rather than written
 * twice. The actor is always `req.staff` — never a name in the body.
 */
import { Router } from "express";
import {
  StoreConflictError,
  StoreValidationError,
  commitStore,
  snapshotStore,
  storeChangesSince,
  storePhoto,
  type PrismaClient,
} from "@nusantara/db";
import { ApiError, notFound, unauthenticated } from "../errors.js";
import {
  assertFinanceWritable,
  scopeDelta,
  scopeSnapshot,
} from "../auth/financeScope.js";

function toApiError(e: unknown): unknown {
  if (e instanceof StoreValidationError) {
    return new ApiError(
      400,
      "VALIDASI",
      e.message,
      e.collection === undefined ? {} : { field: e.collection },
    );
  }
  if (e instanceof StoreConflictError) {
    return new ApiError(409, "KONFLIK", e.message, { field: e.collection });
  }
  return e;
}

export function storeRouter(db: PrismaClient): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const staff = req.staff;
      if (!staff) throw unauthenticated();
      const snapshot = await snapshotStore(db, { staffId: staff.id });
      res.set("Cache-Control", "no-store");
      res.json({ ...snapshot, db: scopeSnapshot(staff, snapshot.db) });
    } catch (e) {
      next(toApiError(e));
    }
  });

  router.get("/changes", async (req, res, next) => {
    try {
      const staff = req.staff;
      if (!staff) throw unauthenticated();
      const after =
        typeof req.query["after"] === "string" ? req.query["after"] : "0";
      const delta = await storeChangesSince(db, { staffId: staff.id }, after);
      if (delta === "RESET") {
        throw new ApiError(
          410,
          "KONFLIK",
          "Data di perangkat ini sudah terlalu lama. Muat ulang halaman.",
        );
      }
      res.set("Cache-Control", "no-store");
      res.json(scopeDelta(staff, delta));
    } catch (e) {
      next(toApiError(e));
    }
  });

  router.post("/commit", async (req, res, next) => {
    try {
      const staff = req.staff;
      if (!staff) throw unauthenticated();
      assertFinanceWritable(staff, req.body);
      const result = await commitStore(db, {
        staffId: staff.id,
        changes: req.body,
        // For the activity log (2026-10-22): where the save came from.
        requestId: req.get("x-request-id") ?? null,
        ip: req.ip ?? null,
      });
      res.json(scopeDelta(staff, result));
    } catch (e) {
      next(toApiError(e));
    }
  });

  router.get("/photos/:id", async (req, res, next) => {
    try {
      const photo = await storePhoto(db, req.params.id);
      if (photo === null) throw notFound("Foto");
      res.set("Content-Type", photo.contentType);
      res.set("Cache-Control", "private, max-age=86400");
      res.send(Buffer.from(photo.data));
    } catch (e) {
      next(toApiError(e));
    }
  });

  return router;
}
