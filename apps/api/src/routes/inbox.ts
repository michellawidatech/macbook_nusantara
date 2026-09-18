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
 * ## The per-thread bot switch
 *
 * `WaThreadMemory.autoReply` decides whether the worker answers this customer
 * unattended. It is staff-owned, defaults true, and gates the worker's draft
 * pass and nothing else — the inbox, the drafting button and the reply box all
 * behave identically either way, because none of them send without a person.
 *
 * ## The bot's hand-overs (2026-09-18)
 *
 * When the bot gives a conversation to a person — the stock or price of a
 * named machine, anything the owner's answers do not cover — the batch it
 * answered is PERLU_STAF, `intent` says `staf:<topic>`, and the newest row's
 * `entities.handoff` carries the topic and the bot's one-line note. The worker
 * then holds that thread (apps/worker/src/draft.ts) until a person answers:
 * a reply here, or `POST /:phone/handled` when it was dealt with some other
 * way — on the phone, at the counter. Both close every waiting row, which is
 * what lets the bot pick the thread up again.
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
import { phoneForms } from "@nusantara/agent";
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

const autoReplyBody = z.object({
  /** True: the bot answers this customer. False: a person does. */
  enabled: z.boolean(),
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
  /** False only where staff have taken this one thread off the bot. */
  autoReply: boolean;
  /** The newest open hand-over's row, if the bot gave this thread to a person. */
  handoffIntent: string | null;
  handoffEntities: unknown;
  handoffAt: Date | null;
}

export interface Handoff {
  /** policy.ts `HANDOFF_TOPICS`, or "other" for a row older than the topics. */
  readonly topic: string;
  /** The bot's note for the colleague, or null. */
  readonly summary: string | null;
  /** Set when the code, not the model, decided — `route`, a refusal, a failure. */
  readonly forcedBy: string | null;
  readonly at: string | null;
}

/**
 * Read a hand-over back off a row. `entities` is the agent's JSON column
 * ("shape not ours" in the schema), so every field is checked rather than
 * cast, and a row escalated before 2026-09-18 — no `handoff` object, intent
 * `perlu_staf` — still reads as a hand-over with no note.
 */
export function readHandoff(
  intent: string | null,
  entities: unknown,
  at: Date | null,
): Handoff {
  const h =
    entities && typeof entities === "object" && "handoff" in entities
      ? (entities as { handoff?: unknown }).handoff
      : undefined;
  const field = (k: string): string | null => {
    const v =
      h && typeof h === "object"
        ? (h as Record<string, unknown>)[k]
        : undefined;
    return typeof v === "string" && v.trim() !== "" ? v : null;
  };
  const topic =
    field("topic") ?? (intent?.startsWith("staf:") ? intent.slice(5) : "other");
  return {
    topic,
    summary: field("summary"),
    forcedBy: field("forcedBy"),
    at: field("at") ?? at?.toISOString() ?? null,
  };
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
               agg."lastInboundAt" AS "lastInboundAt",
               -- COALESCE rather than the bare column: most threads have
               -- no memory row at all, and no row means the bot answers —
               -- the same answer the column's DEFAULT gives.
               COALESCE(mem."autoReply", true) AS "autoReply",
               esc."intent"    AS "handoffIntent",
               esc."entities"  AS "handoffEntities",
               esc."ts"        AS "handoffAt"
          FROM "WaMessage" m
          LEFT JOIN "WaThreadMemory" mem ON mem."from" = m."from"
          -- The newest row the bot handed to a person and nobody has closed
          -- yet. Its note is on the batch's newest row, so newest first.
          LEFT JOIN LATERAL (
                 SELECT h."intent", h."entities", h."ts"
                   FROM "WaMessage" h
                  WHERE h."from" = m."from"
                    AND h."direction" = 'IN'
                    AND h."status" = 'PERLU_STAF'
                  ORDER BY h."ts" DESC, h."id" DESC
                  LIMIT 1
               ) esc ON true
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
          /** False means a person is handling this one, not the bot. */
          autoReply: r.autoReply,
          /**
           * Set while the bot has handed this thread to a person and nobody
           * has answered — the one list a colleague needs to work through.
           */
          handoff:
            r.handoffAt === null
              ? null
              : readHandoff(r.handoffIntent, r.handoffEntities, r.handoffAt),
          /** Null once the window has closed, so the UI can disable the reply box. */
          windowClosesAt:
            r.lastInboundAt && isWithinWindow(r.lastInboundAt, now)
              ? windowClosesAt(r.lastInboundAt).toISOString()
              : null,
        }))
        // Handed to a person first, then unanswered, then most recent.
        // Sorted here rather than in SQL because both flags are derived and
        // the list is small enough that paginating it would cost more than it
        // saves.
        .sort(
          (a, b) =>
            Number(b.handoff !== null) - Number(a.handoff !== null) ||
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
          intent: true,
          entities: true,
          answeredBy: { select: { name: true } },
        },
      });

      if (messages.length === 0) throw notFound("Percakapan");

      // The agent's own rolling note on this thread, and who the shop knows
      // this number to be. Both are read here rather than from a second
      // endpoint because the Chat page needs them at exactly the moment it
      // opens a conversation, and a second round trip would only make the
      // panel populate later than the messages beside it.
      const [memory, customer] = await Promise.all([
        db.waThreadMemory.findUnique({
          where: { from: phone.data },
          select: {
            summary: true,
            summaryAt: true,
            directive: true,
            autoReply: true,
            autoReplyAt: true,
            autoReplyBy: { select: { name: true } },
          },
        }),
        // `WaMessage.customerId` is never written by any code in this build,
        // so a thread is matched to a customer by number. `Customer.phone` is
        // E.164 and a wa_id is bare digits, hence both forms — two exact
        // values, so the unique index still applies.
        db.customer.findFirst({
          where: { phone: { in: phoneForms(phone.data) } },
          select: {
            id: true,
            name: true,
            phone: true,
            createdAt: true,
            referralSource: { select: { name: true } },
          },
        }),
      ]);

      // Counts rather than rows: the panel says "3 pesanan", and shipping the
      // orders themselves would be a second, larger payload nobody reads.
      const [orderCount, lastOrder, openReservations] = customer
        ? await Promise.all([
            db.order.count({
              where: {
                customerId: customer.id,
                status: { in: ["LUNAS", "BELUM", "RETUR", "RETUR_SEBAGIAN"] },
              },
            }),
            db.order.findFirst({
              where: {
                customerId: customer.id,
                status: { in: ["LUNAS", "BELUM", "RETUR", "RETUR_SEBAGIAN"] },
              },
              select: { code: true, ts: true, total: true },
              orderBy: { ts: "desc" },
            }),
            db.reservation.count({
              where: { customerId: customer.id, status: "TERJADWAL" },
            }),
          ])
        : [0, null, 0];

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
        /**
         * The agent's rolling note, written by the worker's summary pass. Null
         * until a thread has had enough answered turns to be worth
         * summarising — the page says so rather than inventing one.
         */
        summary: memory?.summary
          ? {
              text: memory.summary,
              at: memory.summaryAt?.toISOString() ?? null,
            }
          : null,
        /** A standing instruction staff left about this customer. */
        directive: memory?.directive ?? null,
        /** The open hand-over, newest first — null once a person has answered. */
        handoff: (() => {
          const open = [...messages]
            .reverse()
            .find((m) => m.direction === "IN" && m.status === "PERLU_STAF");
          return open ? readHandoff(open.intent, open.entities, open.ts) : null;
        })(),
        /**
         * Whether the bot answers this customer unattended.
         *
         * `?? true` for a thread with no memory row, which is most of them:
         * no row means nobody has ruled on this number, and the bot answers.
         * `by`/`at` are null until somebody has actually flipped it, so the
         * page can say "on by default" rather than naming a person who never
         * touched it.
         */
        autoReply: {
          enabled: memory?.autoReply ?? true,
          by: memory?.autoReplyBy?.name ?? null,
          at: memory?.autoReplyAt?.toISOString() ?? null,
        },
        /**
         * Who the shop knows this number to be. Null for a number that has
         * never bought anything, which the page must say plainly rather than
         * filling in with guesses.
         */
        customer: customer
          ? {
              id: customer.id,
              name: customer.name,
              phone: customer.phone,
              since: customer.createdAt.toISOString(),
              referralSource: customer.referralSource?.name ?? null,
              orderCount,
              openReservations,
              lastOrder: lastOrder
                ? {
                    code: lastOrder.code,
                    at: lastOrder.ts.toISOString(),
                    // BigInt does not survive JSON.stringify.
                    total: lastOrder.total.toString(),
                  }
                : null,
            }
          : null,
        messages: messages.map((m) => ({
          id: m.id,
          waMessageId: m.waMessageId,
          text: m.text,
          at: m.ts.toISOString(),
          direction: m.direction,
          status: m.status,
          msgType: m.msgType,
          /** Why the bot gave this message to a person, on the row it answered. */
          handoff:
            m.status === "PERLU_STAF" ||
            (m.intent?.startsWith("staf:") ?? false)
              ? readHandoff(m.intent, m.entities, m.answeredAt)
              : null,
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

  /**
   * POST /api/inbox/:phone/handled — "this is dealt with", without a reply.
   *
   * For the hand-over answered some other way: the colleague rang the
   * customer, or the customer walked in. Closes every waiting row of the thread
   * as answered by this staff member — the same thing a reply here does to
   * them — so the worker's hand-over hold lifts and the bot answers the next
   * message. Nothing is sent and nothing is queued; `replyText` stays empty,
   * which is how the thread shows that nobody wrote back in the chat.
   */
  router.post("/:phone/handled", async (req, res, next) => {
    try {
      const phone = phoneParam.safeParse(req.params["phone"]);
      if (!phone.success)
        throw new ApiError(400, "VALIDASI", "Nomor WhatsApp tidak valid.");
      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");

      const { count } = await db.waMessage.updateMany({
        where: {
          from: phone.data,
          direction: "IN",
          status: { in: ["BARU", "PERLU_STAF"] },
        },
        data: {
          status: "DIJAWAB_STAF",
          answeredByAgent: false,
          answeredById: staff.id,
          answeredAt: new Date(),
        },
      });
      if (count === 0) {
        const exists = await db.waMessage.findFirst({
          where: { from: phone.data },
          select: { id: true },
        });
        if (!exists) throw notFound("Percakapan");
      }
      res.json({ closed: count });
    } catch (err) {
      next(err);
    }
  });

  /**
   * PUT /api/inbox/:phone/auto-reply — hand one customer to a person, or back.
   *
   * Scope worth being exact about: this governs the UNATTENDED path only. The
   * worker's draft pass skips a thread with `autoReply = false`
   * (apps/worker/src/draft.ts) and nothing else changes — staff can still open
   * the thread, still press "Ask the bot to draft", still send. Nothing is ever
   * sent from the Chat page without a person pressing Send, so the button that
   * writes a draft into the reply box was never the thing to gate.
   *
   * `PUT` rather than `POST`: the body carries the state wanted, not a change
   * to apply, so pressing the switch twice on a flaky connection lands the
   * customer where the staff member left it rather than back where they
   * started.
   *
   * ## Why the upsert names its columns one at a time
   *
   * `WaThreadMemory` is the two-writer table (08 §7) and Postgres enforces the
   * split with column-level UPDATE grants. This role owns the directive columns
   * and now the autoReply columns; it does not own `summary`, `summaryAt`,
   * `summaryTurns` or the `coveredThrough` pair, and the update branch must not
   * name them.
   *
   * The create branch is the exception the grants cannot express, and it is
   * deliberate: `summaryTurns` and `clarifyCount` are NOT NULL with no default,
   * so a row created from this side has to initialise them. Initialising a
   * counter on a row that did not exist a moment ago is not overwriting the
   * summariser's work — there was none — and it is the only column of the
   * agent's this endpoint can touch, on the one path where nothing can be lost.
   */
  router.put("/:phone/auto-reply", async (req, res, next) => {
    try {
      const phone = phoneParam.safeParse(req.params["phone"]);
      if (!phone.success)
        throw new ApiError(400, "VALIDASI", "Nomor WhatsApp tidak valid.");

      const parsed = autoReplyBody.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(400, "VALIDASI", "Nilai saklar tidak valid.", {
          field: "enabled",
        });
      }

      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");

      // A thread is every WaMessage sharing a `from`, so a number nobody has
      // ever written from is not a thread. Without this the endpoint would
      // create memory rows for arbitrary numbers typed into the URL.
      const exists = await db.waMessage.findFirst({
        where: { from: phone.data },
        select: { id: true },
      });
      if (!exists) throw notFound("Percakapan");

      const now = new Date();
      const saved = await db.waThreadMemory.upsert({
        where: { from: phone.data },
        update: {
          autoReply: parsed.data.enabled,
          autoReplyAt: now,
          autoReplyById: staff.id,
          updatedAt: now,
        },
        create: {
          from: phone.data,
          autoReply: parsed.data.enabled,
          autoReplyAt: now,
          autoReplyById: staff.id,
          // NOT NULL, no default, and the summariser has written nothing here.
          summaryTurns: 0,
          clarifyCount: 0,
          updatedAt: now,
        },
        select: {
          autoReply: true,
          autoReplyAt: true,
          autoReplyBy: { select: { name: true } },
        },
      });

      res.json({
        enabled: saved.autoReply,
        by: saved.autoReplyBy?.name ?? null,
        at: saved.autoReplyAt?.toISOString() ?? null,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
