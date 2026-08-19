/**
 * /api/inbox — the WhatsApp inbox, backed by real `WaMessage` rows.
 *
 * This is what the Chat page reads. Until it existed the page rendered the
 * mock store, so a message that Meta had genuinely delivered and that the
 * webhook had genuinely written to Postgres was invisible to everybody.
 *
 * ## How a thread is put together
 *
 * There is no `Thread` table and this build does not invent schema
 * (CLAUDE.md). A thread is simply every `WaMessage` sharing a `from` — the
 * customer's `wa_id` — which is why both endpoints group on that column.
 *
 * A reply is not a second row. `WaMessage` carries `replyText`,
 * `answeredByAgent`, `answeredById` and `answeredAt` for exactly this: the
 * inbound message holds the answer it received. So the conversation renders as
 * one inbound bubble per row, each optionally followed by the outbound bubble
 * hanging off it, and "has this been answered" is a column rather than a join.
 *
 * ## The 24-hour window
 *
 * 06 §11: free-form text delivers only within 24 hours of the customer's last
 * message, and outside it Graph fails in a success-shaped way. The list reports
 * the remaining window per thread and the reply endpoint refuses to queue a
 * send that cannot deliver, because "a reply box that looks functional but
 * silently cannot deliver is worse than a disabled one".
 */

import { Router } from "express";
import { z } from "zod";
import { Prisma, enqueueOutbox, type PrismaClient } from "@nusantara/db";
import { currentRequestId } from "@nusantara/logging";
import { isWithinWindow, windowClosesAt } from "@nusantara/whatsapp";
import { ApiError, notFound } from "../errors.js";

/**
 * A `wa_id` as Meta writes it: digits only, country code first, no `+`.
 *
 * Validated rather than trusted because it arrives in the URL and goes into a
 * query. Prisma parameterises either way; this keeps a malformed path from
 * reaching the database at all.
 */
const phoneParam = z
  .string()
  .trim()
  .regex(/^\d{6,20}$/, "a wa_id is digits only");

const replyBody = z.object({
  text: z.string().trim().min(1).max(4_000),
});

/** One row of the thread list, as the SQL below returns it. */
interface ThreadRow {
  phone: string;
  name: string | null;
  lastText: string | null;
  lastAt: Date;
  lastStatus: string;
  lastReply: string | null;
  pending: number;
  lastInboundAt: Date | null;
}

export function inboxRouter(db: PrismaClient): Router {
  const router = Router();

  /**
   * GET /api/inbox — every thread, most recently active first.
   *
   * `DISTINCT ON` is the Postgres way to say "the newest row per sender"
   * without a correlated subquery per thread. The aggregate join beside it
   * carries the two facts that cannot come from a single row: how many messages
   * are still waiting on somebody, and when the customer last wrote — which is
   * what opens the 24-hour window.
   *
   * `::int` on the count is deliberate: Postgres counts in `bigint`, Prisma
   * hands that back as a JavaScript `BigInt`, and the app's JSON replacer would
   * then serialise a plain tally as a string. Money is the thing that must
   * cross as a string (CLAUDE.md), not a row count.
   */
  router.get("/", async (_req, res, next) => {
    try {
      const rows = await db.$queryRaw<ThreadRow[]>(Prisma.sql`
        SELECT DISTINCT ON (m."from")
               m."from"        AS "phone",
               m."name"        AS "name",
               m."text"        AS "lastText",
               m."ts"          AS "lastAt",
               m."status"::text AS "lastStatus",
               m."replyText"   AS "lastReply",
               agg."pending"   AS "pending",
               agg."lastInboundAt" AS "lastInboundAt"
          FROM "WaMessage" m
          JOIN (
                 SELECT "from",
                        COUNT(*) FILTER (
                          WHERE "direction" = 'IN'
                            AND "status" IN ('BARU', 'PERLU_STAF')
                        )::int AS "pending",
                        MAX("ts") FILTER (WHERE "direction" = 'IN') AS "lastInboundAt"
                   FROM "WaMessage"
                  GROUP BY "from"
               ) agg ON agg."from" = m."from"
         ORDER BY m."from", m."ts" DESC
      `);

      const now = new Date();
      const threads = rows
        .map((r) => ({
          phone: r.phone,
          name: r.name,
          channel: "WHATSAPP" as const,
          lastText: r.lastText,
          lastAt: r.lastAt.toISOString(),
          lastReply: r.lastReply,
          /** Waiting on a person or on the bot — the inbox's only sort that matters. */
          needsReply: r.pending > 0,
          pending: r.pending,
          /** Null once the window has closed, so the UI can disable the reply box. */
          windowClosesAt:
            r.lastInboundAt && isWithinWindow(r.lastInboundAt, now)
              ? windowClosesAt(r.lastInboundAt).toISOString()
              : null,
        }))
        // Unanswered first, then most recent. Sorted here rather than in SQL
        // because `needsReply` is derived and the list is small enough that
        // paginating it would cost more than it saves.
        .sort(
          (a, b) =>
            Number(b.needsReply) - Number(a.needsReply) ||
            b.lastAt.localeCompare(a.lastAt),
        );

      res.json({ threads });
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/inbox/:phone — one conversation, oldest first. */
  router.get("/:phone", async (req, res, next) => {
    try {
      const phone = phoneParam.safeParse(req.params["phone"]);
      if (!phone.success)
        throw new ApiError(400, "VALIDASI", "Nomor WhatsApp tidak valid.");

      const messages = await db.waMessage.findMany({
        where: { from: phone.data },
        orderBy: { ts: "asc" },
        // Capped: a long-running customer thread should not push a thousand
        // rows at a phone on a shop's connection. Oldest are the ones to drop.
        take: 200,
        select: {
          id: true,
          waMessageId: true,
          text: true,
          ts: true,
          direction: true,
          status: true,
          msgType: true,
          replyText: true,
          answeredByAgent: true,
          answeredAt: true,
          name: true,
          answeredBy: { select: { name: true } },
        },
      });

      if (messages.length === 0) throw notFound("Percakapan");

      const lastInboundAt = messages.reduce<Date | null>(
        (acc, m) => (m.direction === "IN" && (!acc || m.ts > acc) ? m.ts : acc),
        null,
      );
      const open = isWithinWindow(lastInboundAt);

      res.json({
        phone: phone.data,
        // The most recent profile name Meta sent, since a customer can
        // rename themselves mid-thread and the newest is the right one.
        name: messages.reduce<string | null>((acc, m) => m.name ?? acc, null),
        channel: "WHATSAPP",
        windowClosesAt:
          lastInboundAt && open
            ? windowClosesAt(lastInboundAt).toISOString()
            : null,
        messages: messages.map((m) => ({
          id: m.id,
          waMessageId: m.waMessageId,
          text: m.text,
          at: m.ts.toISOString(),
          direction: m.direction,
          status: m.status,
          msgType: m.msgType,
          reply: m.replyText
            ? {
                text: m.replyText,
                byAgent: m.answeredByAgent,
                by: m.answeredBy?.name ?? null,
                at: m.answeredAt?.toISOString() ?? null,
              }
            : null,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/inbox/:phone/reply — a staff member answers by hand.
   *
   * One transaction writes the answer onto the message and the send intent into
   * the outbox, exactly as 08 §5 requires: no HTTP call happens here, and if
   * this transaction rolls back there is no orphaned promise to a customer. The
   * worker performs the send.
   *
   * The reply is attached to the customer's most recent inbound message, and
   * any older still-waiting messages in the same thread are closed by the same
   * answer. That is not a shortcut — a customer who sends "halo", "mau tanya"
   * and "ada macbook?" gets one considered reply (06 §9.5), and leaving the
   * first two showing as unanswered would keep the thread red forever.
   */
  router.post("/:phone/reply", async (req, res, next) => {
    try {
      const phone = phoneParam.safeParse(req.params["phone"]);
      if (!phone.success)
        throw new ApiError(400, "VALIDASI", "Nomor WhatsApp tidak valid.");

      const parsed = replyBody.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(400, "VALIDASI", "Balasan tidak boleh kosong.", {
          field: "text",
        });
      }

      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");

      const latest = await db.waMessage.findFirst({
        where: { from: phone.data, direction: "IN" },
        orderBy: { ts: "desc" },
        select: { id: true, ts: true },
      });
      if (!latest) throw notFound("Percakapan");

      // Refused before anything is written. Queuing a send that Graph will
      // reject would show the staff member a sent reply the customer never got.
      if (!isWithinWindow(latest.ts)) {
        throw new ApiError(
          409,
          "KONFLIK",
          "Jendela 24 jam sudah tutup. Balasan bebas tidak akan terkirim — gunakan template yang sudah disetujui.",
        );
      }

      const now = new Date();
      const result = await db.$transaction(async (tx) => {
        const updated = await tx.waMessage.update({
          where: { id: latest.id },
          data: {
            replyText: parsed.data.text,
            status: "DIJAWAB_STAF",
            answeredByAgent: false,
            answeredById: staff.id,
            answeredAt: now,
          },
          select: { id: true, replyText: true, answeredAt: true },
        });

        // The earlier fragments of the same question, closed by this answer.
        await tx.waMessage.updateMany({
          where: {
            from: phone.data,
            direction: "IN",
            status: { in: ["BARU", "PERLU_STAF"] },
            id: { not: latest.id },
          },
          data: {
            status: "DIJAWAB_STAF",
            answeredById: staff.id,
            answeredAt: now,
          },
        });

        await enqueueOutbox(tx, {
          kind: "WA_REPLY",
          payload: {
            to: phone.data,
            body: parsed.data.text,
            inReplyTo: latest.id,
          },
          // 05 §3: the same rid the request logged under, so a disputed
          // send can be traced back to the person who pressed Send.
          requestId: currentRequestId() ?? null,
        });

        return updated;
      });

      res.status(201).json({
        id: result.id,
        text: result.replyText,
        at: result.answeredAt?.toISOString() ?? now.toISOString(),
        // The row is committed; delivery is the worker's job and has not
        // happened yet. Saying "queued" rather than "sent" is the difference
        // 06 §11 insists on.
        status: "QUEUED",
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
