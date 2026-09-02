/**
 * /api/inbound — a machine arrives, and becomes sellable stock.
 *
 * Thin on purpose, exactly like /api/reservations: parse with Zod, take the
 * actor from the session, call one service inside one transaction, serialise.
 * Everything that decides anything — the ledger, the genesis transition, the
 * projection, the all-or-nothing accept — lives in `packages/db`'s
 * `receiveUnit` / `acceptUnits`, so the rule cannot be true here and false
 * wherever else stock is taken in.
 *
 * ## What this router does NOT decide
 *
 * Whether a row is *ready* to accept. `qcReady` in `apps/web/src/lib/inboundQc.ts`
 * is what excludes a second-hand machine still owing a description, and it
 * stays there because it has to explain itself to somebody looking at the grid:
 * the button is disabled with a reason beside it, which is a better answer than
 * a 400 after the press. Posting a serial here asserts that decision was made.
 *
 * The one rule this router DOES enforce is the serial's shape, because that is
 * not a matter of opinion and because this is the desk where a wrong read MINTS
 * a unit. `validateSerial` is the same function the field uses.
 *
 * No middleware is declared here. `requireAuth` and `idempotency` are mounted
 * above every business router in app.ts, so these need a live session and both
 * POSTs honour `Idempotency-Key` — which matters more here than almost
 * anywhere: a retried *Accept all* must not append a second QC_SELESAI.
 */

import { Router } from "express";
import { z } from "zod";
import {
  acceptUnits,
  listPurchaseOrders,
  MAX_PO_PER_PAGE,
  purchaseOrderDetail,
  receiveUnit,
  setPurchaseOrderClosed,
  TXN_TIMEOUTS,
  type Grade,
  type POStatus,
  type PrismaClient,
} from "@nusantara/db";
import { currentRequestId } from "@nusantara/logging";
import { ApiError, unauthenticated } from "../errors.js";

const badRequest = (field: string, message: string) =>
  new ApiError(400, "VALIDASI", message, { field });

/**
 * The stored serial's window: Apple's own barcode, `S` and then 10–12.
 *
 * Restated here rather than imported because `apps/web/src/lib/serialScan.ts`
 * is in the SPA and this is the server, and the server may not trust a rule
 * that only ever ran in a browser. Kept deliberately narrow — the alphabet is
 * not policed here, because the `I`/`O` rule is about a SCANNER misreading a 1
 * or a 0 and a person looking at the machine can legitimately key either.
 */
const SERIAL = /^S[A-Z0-9]{10,12}$/;

const serial = z
  .string()
  .trim()
  .toUpperCase()
  .refine((s) => SERIAL.test(s), {
    message: "Nomor seri tidak sesuai format.",
  });

/** Money arrives as a decimal string — BigInt does not survive JSON (01 §4). */
const rupiah = z
  .string()
  .regex(/^\d+$/, "Nilai rupiah harus bilangan bulat.")
  .transform((s) => BigInt(s));

const PO_STATUSES = [
  "DRAF",
  "DIPESAN",
  "SEBAGIAN",
  "DITERIMA",
  "BATAL",
] as const satisfies readonly POStatus[];

/** A comma-separated multi-select, as it appears in the URL. */
const csvStatus = z
  .string()
  .optional()
  .transform((v) =>
    v === undefined || v === ""
      ? []
      : v
          .split(",")
          .map((x) => x.trim())
          .filter((x) => x !== ""),
  )
  .pipe(z.array(z.enum(PO_STATUSES)));

const listQuery = z.object({
  q: z.string().trim().max(64).optional(),
  status: csvStatus,
  // Tri-state on purpose: absent is "both", which is not the same as either.
  closed: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(MAX_PO_PER_PAGE).default(20),
});

const closeBody = z.object({ closed: z.boolean() });

const receiveBody = z.object({
  serial,
  skuId: z.string().min(1),
  buy: rupiah,
  landed: rupiah,
  locationId: z.string().min(1),
  poItemId: z.string().min(1).nullish(),
  purchaseOrderId: z.string().min(1).nullish(),
});

/**
 * Exactly `Grade` in schema.prisma — A, B, C and NEW, and no D.
 *
 * `satisfies readonly Grade[]` is what makes that a compiler check rather than
 * a comment: this list first had a D in it, invented from the shape of a
 * grading scale, and the type is what caught it. A grade the enum does not have
 * would otherwise reach Postgres and fail as a 500 on a press of *Accept*.
 */
const GRADES = ["NEW", "A", "B", "C"] as const satisfies readonly Grade[];

const acceptBody = z.object({
  units: z
    .array(
      z.object({
        serial,
        grade: z.enum(GRADES).nullish(),
        // `.nullish()` and not `.optional()`: null is "QC looked and there is
        // nothing to say", which is what a sealed machine records, and it has
        // to be distinguishable from a field the client simply omitted.
        description: z.string().trim().max(2_000).nullish(),
      }),
    )
    .min(1)
    // An invoice is tens of machines, not thousands. A cap here is what stops
    // one request holding row locks on the whole warehouse inside a single
    // ten-second transaction.
    .max(200),
  purchaseOrderId: z.string().min(1).nullish(),
  refCode: z.string().trim().max(64).nullish(),
});

export function inboundRouter(db: PrismaClient): Router {
  const router = Router();

  /**
   * The invoice list — what /inbound opens on.
   *
   * `closed` is its own filter rather than a `status` value, because closing is
   * a filing decision and `status` is about the GOODS: an order can be fully
   * received and still open because the ongkir has not been settled.
   */
  router.get("/", (req, res, next) => {
    void (async () => {
      try {
        const parsed = listQuery.safeParse(req.query);
        if (!parsed.success) {
          next(
            badRequest(
              String(parsed.error.issues[0]?.path[0] ?? "q"),
              "Filter tidak valid.",
            ),
          );
          return;
        }
        const { q, status, closed, page, perPage } = parsed.data;
        const result = await listPurchaseOrders(db, {
          ...(q === undefined ? {} : { q }),
          ...(status.length === 0 ? {} : { status }),
          ...(closed === undefined ? {} : { closed }),
          page,
          perPage,
        });
        res.json({ rows: result.rows, total: result.total, page, perPage });
      } catch (e) {
        next(e);
      }
    })();
  });

  /**
   * One invoice, with its lines and the machines identified against them.
   *
   * The QC grid is NOT returned, and that is the point: a slot — a machine the
   * invoice says is here that nobody has identified — lives in the page, not in
   * the database. The page counts `qty` against the units it gets back.
   */
  router.get("/:poId", (req, res, next) => {
    void (async () => {
      try {
        const poId = String(req.params["poId"] ?? "");
        const po = await purchaseOrderDetail(db, poId);
        if (po === null) {
          next(new ApiError(404, "TIDAK_DITEMUKAN", "Faktur tidak ditemukan."));
          return;
        }
        res.json(po);
      } catch (e) {
        next(e);
      }
    })();
  });

  /**
   * Close the invoice, or reopen it.
   *
   * Never refuses. An outstanding balance or an ungraded machine is a WARNING
   * the page shows before it asks — that judgement is the operator's, and an
   * intake screen must not make a mistake permanent.
   */
  router.post("/:poId/close", async (req, res, next) => {
    try {
      const parsed = closeBody.safeParse(req.body);
      if (!parsed.success) throw badRequest("closed", "Nilai tidak valid.");
      if (!req.staff) throw unauthenticated();

      const poId = String(req.params["poId"] ?? "");
      const existing = await db.purchaseOrder.findUnique({
        where: { id: poId },
        select: { id: true },
      });
      if (existing === null)
        throw new ApiError(404, "TIDAK_DITEMUKAN", "Faktur tidak ditemukan.");

      const result = await db.$transaction(
        (tx) =>
          setPurchaseOrderClosed(tx, { id: poId, closed: parsed.data.closed }),
        TXN_TIMEOUTS,
      );
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  /** A serial has been read off a case: the unit comes into existence, in QC. */
  router.post("/unit", async (req, res, next) => {
    try {
      const parsed = receiveBody.safeParse(req.body);
      if (!parsed.success)
        throw badRequest(
          String(parsed.error.issues[0]?.path[0] ?? "serial"),
          parsed.error.issues[0]?.message ?? "Data unit tidak valid.",
        );
      const staff = req.staff;
      if (!staff) throw unauthenticated();

      const b = parsed.data;
      const unit = await db.$transaction(
        (tx) =>
          receiveUnit(tx, {
            serial: b.serial,
            skuId: b.skuId,
            buy: b.buy,
            landed: b.landed,
            locationId: b.locationId,
            poItemId: b.poItemId ?? null,
            purchaseOrderId: b.purchaseOrderId ?? null,
            // Never from the body: a client must not be able to attribute an
            // intake to somebody else, or forge the audit correlation.
            staffId: staff.id,
            requestId: currentRequestId() ?? null,
          }),
        TXN_TIMEOUTS,
      );

      res.status(201).json(unit);
    } catch (e) {
      next(e);
    }
  });

  /** QC is satisfied: these machines become sellable stock. */
  router.post("/accept", async (req, res, next) => {
    try {
      const parsed = acceptBody.safeParse(req.body);
      if (!parsed.success)
        throw badRequest(
          String(parsed.error.issues[0]?.path[0] ?? "units"),
          parsed.error.issues[0]?.message ?? "Data QC tidak valid.",
        );
      const staff = req.staff;
      if (!staff) throw unauthenticated();

      const b = parsed.data;
      // One serial twice in one body would append two QC_SELESAI to the same
      // machine, and the second has no legal `from` — so it would fail the
      // transition and take the whole invoice with it. Refusing here names the
      // cause instead.
      const seen = new Set<string>();
      for (const u of b.units) {
        if (seen.has(u.serial))
          throw badRequest("units", `Nomor seri ganda: ${u.serial}`);
        seen.add(u.serial);
      }

      const result = await db.$transaction(
        (tx) =>
          acceptUnits(tx, {
            units: b.units.map((u) => ({
              serial: u.serial,
              ...(u.grade === undefined ? {} : { grade: u.grade }),
              ...(u.description === undefined
                ? {}
                : { description: u.description }),
            })),
            purchaseOrderId: b.purchaseOrderId ?? null,
            refCode: b.refCode ?? null,
            staffId: staff.id,
            requestId: currentRequestId() ?? null,
          }),
        TXN_TIMEOUTS,
      );

      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  return router;
}
