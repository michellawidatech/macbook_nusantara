/**
 * The WhatsApp connection — the owner's view of the linked device that is the
 * shop's number (owner decision 2026-10-22, docs/whatsapp-baileys.md).
 *
 *   GET  /api/whatsapp/connection          state, the QR while waiting, number, since
 *   POST /api/whatsapp/connection/link     ask for a QR (refused while linked)
 *   POST /api/whatsapp/connection/logout   unlink the device
 *
 * Owner-only, every one: a QR is the number itself for the minute it is shown,
 * and unlinking stops the shop answering customers.
 *
 * A proxy to apps/wa-gateway on loopback, which holds the session and enforces
 * the rules — one session, link attempts rationed. This side adds the secret,
 * the audit line, and a clear answer when the gateway is not there: a shop on
 * the Cloud API has no gateway at all, and a gateway that is down must read as
 * "down" and not as a spinner.
 *
 * The audit line is written AFTER the gateway has answered, as a single
 * insert: no network I/O happens inside a database transaction (CLAUDE.md).
 * A link is recorded as CREATE when it was requested — whether the phone then
 * scanned the QR is the gateway's to know, not this request's — and an unlink
 * as DELETE, naming the number it unlinked.
 */

import { Router, type RequestHandler } from "express";
import type { PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import { ApiError } from "../errors.js";
import { callGateway } from "../gatewayClient.js";

export type GatewayHealth = "OK" | "UNREACHABLE" | "NOT_CONFIGURED";

export interface WhatsAppRouterDeps {
  readonly db: PrismaClient;
  readonly logger: Logger;
  readonly gateway: { readonly url: string; readonly secret: string } | null;
  readonly requireOwner: RequestHandler;
  /** A test's fake gateway answers through this. */
  readonly fetchImpl?: typeof fetch;
}

interface GatewayStatusBody {
  readonly state?: string;
  readonly number?: string;
}

const notRunning = (configured: boolean) =>
  new ApiError(
    503,
    "GATEWAY_MATI",
    configured
      ? "Gateway WhatsApp tidak berjalan di server."
      : "Gateway WhatsApp belum dipasang di server ini.",
  );

export function whatsappRouter(deps: WhatsAppRouterDeps): Router {
  const { db, logger, gateway } = deps;
  const router = Router();
  router.use(deps.requireOwner);

  const call = (method: "GET" | "POST", path: string) =>
    callGateway({
      gateway,
      logger,
      method,
      path,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });

  /** A gateway answer that is not the one asked for is a misconfiguration. */
  const unexpected = (status: number) => {
    logger.error(
      { evt: "whatsapp.gateway.refused", ctx: { status } },
      status === 401
        ? "the WhatsApp gateway refused the API's secret — WA_GATEWAY_SECRET differs between api.env and wa-gateway.env"
        : "the WhatsApp gateway answered unexpectedly",
    );
    return new ApiError(
      503,
      "GATEWAY_MATI",
      "Gateway WhatsApp menolak permintaan dari server.",
    );
  };

  const audit = async (
    req: Parameters<RequestHandler>[0],
    action: "CREATE" | "DELETE",
    before: string | null,
    after: string | null,
  ) => {
    await db.auditLog.create({
      data: {
        at: new Date(),
        staffId: req.staff?.id ?? null,
        entity: "WhatsApp",
        entityId: "connection",
        action,
        field: "session",
        before,
        after,
        requestId: req.get("x-request-id") ?? null,
        ip: req.ip ?? null,
      },
    });
  };

  router.get("/connection", async (_req, res, next) => {
    try {
      if (!gateway) {
        res.json({ gateway: "NOT_CONFIGURED" satisfies GatewayHealth });
        return;
      }
      const r = await call("GET", "/status");
      if (!r.ok) {
        res.json({ gateway: "UNREACHABLE" satisfies GatewayHealth });
        return;
      }
      if (r.status !== 200) throw unexpected(r.status);
      res.json({
        gateway: "OK" satisfies GatewayHealth,
        ...(r.body as object),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/connection/link", async (req, res, next) => {
    try {
      const r = await call("POST", "/link");
      if (!r.ok) throw notRunning(gateway !== null);
      const body = r.body as {
        error?: { code?: string; retryAfterSec?: number };
      } & GatewayStatusBody;
      if (r.status === 409) {
        throw new ApiError(
          409,
          "KONFLIK",
          body.error?.code === "BUSY"
            ? "WhatsApp sedang menyambung. Tunggu sebentar."
            : "WhatsApp sudah tersambung. Putuskan dulu sebelum menautkan lagi.",
        );
      }
      if (r.status === 429) {
        const retryAfter = body.error?.retryAfterSec ?? 3_600;
        throw new ApiError(
          429,
          "TERLALU_BANYAK",
          `Terlalu sering menautkan WhatsApp. Coba lagi dalam ${Math.ceil(retryAfter / 60)} menit.`,
          { retryAfter },
        );
      }
      if (r.status !== 200) throw unexpected(r.status);
      await audit(req, "CREATE", null, JSON.stringify({ link: "requested" }));
      res.json({ gateway: "OK" satisfies GatewayHealth, ...body });
    } catch (err) {
      next(err);
    }
  });

  router.post("/connection/logout", async (req, res, next) => {
    try {
      // Which number is being unlinked, for the audit line — read first,
      // because after the logout the gateway no longer knows.
      const before = await call("GET", "/status");
      const r = await call("POST", "/logout");
      if (!r.ok) throw notRunning(gateway !== null);
      if (r.status !== 200) throw unexpected(r.status);
      const was =
        before.ok && before.status === 200
          ? ((before.body as GatewayStatusBody).number ?? null)
          : null;
      // JSON, the shape Settings → Activity reads a row's values in.
      await audit(
        req,
        "DELETE",
        JSON.stringify(was ? { number: was } : { number: null }),
        null,
      );
      res.json({
        gateway: "OK" satisfies GatewayHealth,
        ...(r.body as object),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
