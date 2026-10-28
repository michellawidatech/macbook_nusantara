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

import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { Prisma, enqueueOutbox, type PrismaClient } from "@nusantara/db";
import { currentRequestId } from "@nusantara/logging";
import { isWithinWindow, windowClosesAt } from "@nusantara/whatsapp";
import {
  forgetProfile,
  RESET_INTENT,
  askingPrice,
  isHoldingLine,
  isResetCommand,
  phoneForms,
  summarySince,
  BOT_STALE_MS,
  STAFF_ACTIVE_MS,
  staffTypedReply,
} from "@nusantara/agent";
import { realName } from "@nusantara/domain";
import { ApiError, forbidden, notFound } from "../errors.js";
import {
  evaluationsFor,
  leadJson,
  listExtras,
  profileJson,
  registerInboxV2,
  reservationsFor,
  stockWatchesFor,
} from "./inboxV2.js";
import {
  recordSender,
  registerInboxSent,
  replyOutboxIds,
  sentItemsFor,
  type InboxSentDeps,
} from "./inboxSent.js";

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

/**
 * Which of a thread's rows /chat shows (Clear chat, owner ask 2026-10-27).
 *
 * A clear closes every row still waiting at that instant, stamping
 * `answeredAt` with the clear itself, so every row from before it is answered
 * AT or before `clearedAt`. What shows is what came after: a row answered
 * later, or one nobody has answered yet — which can only have arrived after
 * the clear. `ts` is never used: it is the customer's phone clock.
 */
export function visibleAfter(
  clearedAt: Date | null | undefined,
): Prisma.WaMessageWhereInput {
  return clearedAt
    ? { OR: [{ answeredAt: null }, { answeredAt: { gt: clearedAt } }] }
    : {};
}

/** `visibleAfter` in SQL, for a message alias and its memory row's alias. */
const VISIBLE_SQL = (msg: string, mem: string) =>
  Prisma.raw(
    `(${mem}."clearedAt" IS NULL OR ${msg}."answeredAt" IS NULL OR ${msg}."answeredAt" > ${mem}."clearedAt")`,
  );

/** Typed back on Delete conversation: the number itself. */
const deleteBody = z.object({ confirm: z.string().trim().min(1).max(40) });

const replyBody = z.object({
  text: z.string().trim().min(1).max(4_000),
});

/** Whole rupiah as a digit string — money never crosses as a number. */
const rupiah = z
  .string()
  .trim()
  .regex(/^\d{1,12}$/, "whole rupiah, digits only")
  .transform((v) => BigInt(v))
  .refine((v) => v > 0n, "must be more than 0");

const offerBody = z.object({
  /** What the shop will take. */
  price: rupiah,
  /** Exactly what the customer reads — the modal pre-fills it, staff may edit. */
  text: z.string().trim().min(1).max(4_000),
});

/** Every action a conversation shows: all open ones and the latest few done. */
const ACTION_SELECT = {
  id: true,
  kind: true,
  status: true,
  topic: true,
  summary: true,
  customerText: true,
  listPrice: true,
  askPrice: true,
  staffPrice: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  resolvedBy: { select: { name: true } },
  unit: {
    select: {
      serial: true,
      grade: true,
      price: true,
      landed: true,
      sku: {
        select: {
          name: true,
          variantLabel: true,
          price: true,
          model: { select: { name: true } },
        },
      },
    },
  },
} as const;

type ActionRow = Prisma.ChatActionGetPayload<{ select: typeof ACTION_SELECT }>;

/**
 * One action item as the Chat page draws it (owner ask 2026-09-29): enough to
 * act on without reading the conversation. `listPrice` is what the POS asks
 * NOW, since a colleague answering a negotiation must quote today's price;
 * the snapshot stands in only when the action names no unit. `cost` is the
 * unit's landed cost — the "modal" a staff member negotiates down to, which
 * is shown to staff here and never reaches a tool the bot can call.
 */
function actionJson(a: ActionRow) {
  const live = a.unit ? askingPrice(a.unit) : null;
  const money = (v: bigint | null | undefined) =>
    v == null ? null : v.toString();
  return {
    id: a.id,
    kind: a.kind,
    status: a.status,
    topic: a.topic,
    summary: a.summary,
    customerText: a.customerText,
    unit: a.unit
      ? {
          serial: a.unit.serial,
          name: [
            a.unit.sku.model.name,
            a.unit.sku.variantLabel ?? a.unit.sku.name,
          ]
            .filter(Boolean)
            .join(" "),
          grade: a.unit.grade,
        }
      : null,
    listPrice: money(a.unit ? live : a.listPrice),
    cost: money(a.unit?.landed),
    askPrice: money(a.askPrice),
    staffPrice: money(a.staffPrice),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
    resolvedBy: a.resolvedBy?.name ?? null,
  };
}

/** Recently finished actions a conversation still shows. */
const DONE_ACTIONS_SHOWN = 5;

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
/**
 * Did the BOT write this row's reply? (owner report 2026-10-27: the bot's own
 * "Bentar ya kak, aku cek dulu 🙏" read as Staff on /chat.)
 *
 * `answeredByAgent` says so for an answer, but a hand-over row is written
 * with it false — the flag also means "the bot dealt with this", which a
 * hand-over did not — and a colleague's later close stamps their id on it.
 * So the reply is the bot's when the flag says so, when no person is named on
 * the row (staff replies always are), when it is the line the worker recorded
 * with the hand-over (`entities.handoff.reply`), or — rows from before that
 * was recorded — when it is one of the bot's own fixed hand-over lines.
 */
export function botWroteReply(m: {
  readonly replyText: string | null;
  readonly answeredByAgent: boolean;
  readonly answeredById?: string | null;
  readonly entities?: unknown;
}): boolean {
  if (!m.replyText) return false;
  if (m.answeredByAgent || !m.answeredById) return true;
  const h =
    m.entities && typeof m.entities === "object"
      ? (m.entities as { handoff?: { reply?: unknown } }).handoff
      : undefined;
  if (h && typeof h === "object" && h.reply === m.replyText) return true;
  return isHoldingLine(m.replyText);
}

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

/**
 * `sent` is the WhatsApp gateway and a logger (2026-10-23): unsend and edit
 * go through the linked device, and with no gateway configured they are
 * refused and never offered. Optional so a test building the router alone
 * still gets an inbox.
 */
export function inboxRouter(
  db: PrismaClient,
  sent: InboxSentDeps | null = null,
  requireOwner?: RequestHandler,
): Router {
  const router = Router();
  // Delete conversation is the owner's (2026-10-27). A router built without
  // the guard — a test building it alone — refuses the route outright rather
  // than letting anybody through.
  const ownerOnly: RequestHandler =
    requireOwner ?? ((_req, _res, next) => next(forbidden()));
  const baileys = sent?.gateway != null;

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
  /**
   * GET /api/inbox/waiting — how many chats are waiting for a PERSON, and
   * the one waiting longest (owner, 2026-10-28: *"give notification
   * persisting in the entire app if there is anything that they need to
   * answer"*). A hand-over not dealt with (PERLU_STAF), or a message in a
   * chat whose bot is switched off. Cheap: the bell on every page polls it.
   */
  router.get("/waiting", async (_req, res, next) => {
    try {
      const rows = await db.$queryRaw<Array<{ from: string }>>(Prisma.sql`
        SELECT m."from"
          FROM "WaMessage" m
          LEFT JOIN "WaThreadMemory" t ON t."from" = m."from"
         WHERE m."direction" = 'IN'
           AND (m."status" = 'PERLU_STAF'
                OR (m."status" = 'BARU' AND t."autoReply" = false))
           AND (t."clearedAt" IS NULL OR m."ts" > t."clearedAt")
         GROUP BY m."from"
         ORDER BY MIN(m."ts") ASC
      `);
      res.json({ count: rows.length, oldest: rows[0]?.from ?? null });
    } catch (err) {
      next(err);
    }
  });

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
                    AND (mem."clearedAt" IS NULL
                         OR h."answeredAt" IS NULL
                         OR h."answeredAt" > mem."clearedAt")
                  ORDER BY h."ts" DESC, h."id" DESC
                  LIMIT 1
               ) esc ON true
          -- Inner join: a thread with nothing after its clear has no row
          -- here and so is not listed at all (Clear chat, 2026-10-27).
          JOIN (
                 SELECT a."from",
                        COUNT(*) FILTER (
                          WHERE a."direction" = 'IN'
                            AND a."status" IN ('BARU', 'PERLU_STAF')
                        )::int AS "pending",
                        MAX(a."ts") FILTER (WHERE a."direction" = 'IN') AS "lastInboundAt"
                   FROM "WaMessage" a
                   LEFT JOIN "WaThreadMemory" am ON am."from" = a."from"
                  WHERE ${VISIBLE_SQL("a", "am")}
                  GROUP BY a."from"
               ) agg ON agg."from" = m."from"
         WHERE ${VISIBLE_SQL("m", "mem")}
         ORDER BY m."from", m."ts" DESC
      `);

      const now = new Date();
      // Open action items per thread, so the list can say what is waiting.
      const open = await db.chatAction.groupBy({
        by: ["from", "kind"],
        where: { status: "OPEN" },
      });
      const kindsOf = new Map<string, string[]>();
      for (const o of open)
        kindsOf.set(o.from, [...(kindsOf.get(o.from) ?? []), o.kind]);
      // Chatbot v2: unread, the three tags and the best name (inboxV2.ts).
      const extras = await listExtras(
        db,
        rows.map((r) => r.phone),
      );
      const threads = rows
        .map((r) => ({
          ...(() => {
            const x = extras.get(r.phone);
            const escalation =
              r.handoffAt !== null || (kindsOf.get(r.phone) ?? []).length > 0;
            return {
              displayName: x?.displayName ?? null,
              unread: x?.unread ?? 0,
              tags: {
                lead: x?.lead ?? false,
                reservation: x?.reservation ?? false,
                escalation,
              },
              leadScore: x?.leadScore ?? null,
            };
          })(),
          phone: r.phone,
          name: realName(r.name),
          channel: "WHATSAPP" as const,
          lastText: r.lastText,
          lastAt: r.lastAt.toISOString(),
          lastReply: r.lastReply,
          /** Waiting on a person or on the bot — the inbox's only sort that matters. */
          needsReply: r.pending > 0,
          pending: r.pending,
          /** False means a person is handling this one, not the bot. */
          autoReply: r.autoReply,
          /** The kinds of the thread's open action items (NEGOTIATION, PRICE…). */
          openActions: kindsOf.get(r.phone) ?? [],
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

      // A cleared chat shows only what came after the clear, and a thread
      // with nothing after it is not a conversation /chat has (404).
      const cleared =
        (
          await db.waThreadMemory.findUnique({
            where: { from: phone.data },
            select: { clearedAt: true },
          })
        )?.clearedAt ?? null;

      const messages = await db.waMessage.findMany({
        where: { from: phone.data, ...visibleAfter(cleared) },
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
          answeredById: true,
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
      const [memory, customer, actions, profile] = await Promise.all([
        db.waThreadMemory.findUnique({
          where: { from: phone.data },
          select: {
            summary: true,
            summaryAt: true,
            coveredThroughAt: true,
            directive: true,
            autoReply: true,
            autoReplyAt: true,
            autoReplyBy: { select: { name: true } },
            leaseUntil: true,
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
        Promise.all([
          db.chatAction.findMany({
            where: {
              from: phone.data,
              status: "OPEN",
              ...(cleared ? { createdAt: { gt: cleared } } : {}),
            },
            select: ACTION_SELECT,
            orderBy: { updatedAt: "desc" },
          }),
          db.chatAction.findMany({
            where: {
              from: phone.data,
              status: "DONE",
              ...(cleared ? { createdAt: { gt: cleared } } : {}),
            },
            select: ACTION_SELECT,
            orderBy: { resolvedAt: "desc" },
            take: DONE_ACTIONS_SHOWN,
          }),
        ]).then(([o, d]) => [...o, ...d]),
        // What the customer told the bot about themselves (remember_customer),
        // and what a colleague added — the v2 profile (inboxV2.ts).
        profileJson(db, phone.data),
      ]);
      const [lead, reservations, watches, evaluations, sentItems] =
        await Promise.all([
          leadJson(db, phone.data),
          reservationsFor(db, phone.data),
          // "Tell me when it's in stock" (2026-10-27), open ones first.
          stockWatchesFor(db, phone.data),
          evaluationsFor(
            db,
            messages.filter((m) => m.replyText).map((m) => m.id),
          ),
          // What the shop sent, photos included, each with whether it can
          // still be edited or unsent (inboxSent.ts, 2026-10-23).
          sentItemsFor(db, phone.data, { baileys, after: cleared }),
        ]);
      const outboxOfReply = replyOutboxIds(messages, sentItems);

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

      // Why a customer message is still waiting, when the bot is not the
      // one who will answer it (2026-10-27): the newest reply a colleague
      // TYPED here within the hold the worker keeps (`staffTypedReply`, the
      // worker's own reading), and whether a turn holds the thread now.
      const nowMs = Date.now();
      const staffReply = messages
        .filter(
          (m) =>
            m.answeredAt !== null &&
            nowMs - m.answeredAt.getTime() < STAFF_ACTIVE_MS &&
            staffTypedReply(m),
        )
        .reduce<(typeof messages)[number] | null>(
          (acc, m) => (!acc || m.answeredAt! > acc.answeredAt! ? m : acc),
          null,
        );

      const lastInboundAt = messages.reduce<Date | null>(
        (acc, m) => (m.direction === "IN" && (!acc || m.ts > acc) ? m.ts : acc),
        null,
      );
      const open = isWithinWindow(lastInboundAt);

      res.json({
        phone: phone.data,
        // The most recent profile name Meta sent, since a customer can
        // rename themselves mid-thread and the newest is the right one.
        // Never a placeholder ("unknown"): the page falls back to the number.
        name: messages.reduce<string | null>(
          (acc, m) => realName(m.name) ?? acc,
          null,
        ),
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
        summary:
          memory && summarySince(memory, cleared)
            ? {
                text: memory.summary!,
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
         * What /chat needs to say why a customer message is still waiting
         * (2026-10-27). `staffActive`: a colleague typed a reply here and the
         * bot stays out until `until`. `writing`: a turn holds the thread
         * right now. A BARU message older than `staleAfterMs` with neither
         * is one the bot should have answered — the worker's watchdog sends
         * the holding line at that point, so the page says the bot is late.
         */
        botWait: {
          staffActive: staffReply
            ? {
                by: staffReply.answeredBy?.name ?? null,
                at: staffReply.answeredAt!.toISOString(),
                until: new Date(
                  staffReply.answeredAt!.getTime() + STAFF_ACTIVE_MS,
                ).toISOString(),
              }
            : null,
          writing: Boolean(
            memory?.leaseUntil && memory.leaseUntil.getTime() > nowMs,
          ),
          staleAfterMs: BOT_STALE_MS,
        },
        /**
         * Who the shop knows this number to be. Null for a number that has
         * never bought anything, which the page must say plainly rather than
         * filling in with guesses.
         */
        customer: customer
          ? {
              id: customer.id,
              name: realName(customer.name),
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
        /** Open action items first, then the latest few done. */
        actions: actions.map(actionJson),
        /**
         * What the customer has told the bot about themselves — their own
         * words, unverified. Null until they have said anything.
         */
        profile,
        /** The 🔥 tag: whether, the router's last score, and whose. */
        lead,
        /** Open holds under this number, by the bot or at the counter. */
        reservations,
        /** What this customer asked to be told about when it is back in stock. */
        watches,
        /**
         * Every text and photo sent to this number (the newest 100, oldest
         * first). A reply bubble names its own by `reply.outboxId`; the rest
         * — photos, the line before them, a reply a later one overwrote —
         * are drawn at their own time.
         */
        sent: sentItems,
        messages: messages.map((m) => ({
          id: m.id,
          waMessageId: m.waMessageId,
          text: m.text,
          at: m.ts.toISOString(),
          direction: m.direction,
          status: m.status,
          msgType: m.msgType,
          /** A tester's `/new`: the conversation starts over after this row. */
          reset: m.intent === RESET_INTENT && isResetCommand(m.text),
          /** Why the bot gave this message to a person, on the row it answered. */
          handoff:
            m.status === "PERLU_STAF" ||
            (m.intent?.startsWith("staf:") ?? false)
              ? readHandoff(m.intent, m.entities, m.answeredAt)
              : null,
          reply: m.replyText
            ? {
                text: m.replyText,
                byAgent: botWroteReply(m),
                by: botWroteReply(m) ? null : (m.answeredBy?.name ?? null),
                at: m.answeredAt?.toISOString() ?? null,
                /** The newest staff verdict on this reply (Evaluation). */
                evaluation: evaluations.get(m.id) ?? null,
                /** The sent item this reply IS, or null (no ⋯ menu). */
                outboxId: outboxOfReply.get(m.id) ?? null,
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

        // Answering in the chat is what settles what the bot left for a
        // person (2026-10-15: the task dialog and its Mark done are gone —
        // the waiting message is outlined instead). Same close as /handled.
        await tx.chatAction.updateMany({
          where: { from: phone.data, status: "OPEN" },
          data: {
            status: "DONE",
            resolvedAt: now,
            resolvedById: staff.id,
            updatedAt: now,
          },
        });

        const queued = await enqueueOutbox(tx, {
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
        // Who sent it, so its bubble keeps the name after a later reply
        // to the same message takes the row's `replyText` (2026-10-28).
        await recordSender(tx, {
          staffId: staff.id,
          outboxId: queued.id,
          after: { to: phone.data, text: parsed.data.text },
          requestId: currentRequestId() ?? null,
          ip: req.ip ?? null,
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
   * them — so nothing stays outlined as waiting and the bot stops naming it
   * as with a colleague (since 2026-10-27 a hand-over no longer silences the
   * thread; the bot answers newer messages either way). Nothing is sent and nothing is queued; `replyText` stays empty,
   * which is how the thread shows that nobody wrote back in the chat.
   */
  router.post("/:phone/handled", async (req, res, next) => {
    try {
      const phone = phoneParam.safeParse(req.params["phone"]);
      if (!phone.success)
        throw new ApiError(400, "VALIDASI", "Nomor WhatsApp tidak valid.");
      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");

      const handledAt = new Date();
      const [{ count }] = await db.$transaction([
        db.waMessage.updateMany({
          where: {
            from: phone.data,
            direction: "IN",
            status: { in: ["BARU", "PERLU_STAF"] },
          },
          data: {
            status: "DIJAWAB_STAF",
            answeredByAgent: false,
            answeredById: staff.id,
            answeredAt: handledAt,
          },
        }),
        // Dealt with means every task it left is dealt with too.
        db.chatAction.updateMany({
          where: { from: phone.data, status: "OPEN" },
          data: {
            status: "DONE",
            resolvedAt: handledAt,
            resolvedById: staff.id,
            updatedAt: handledAt,
          },
        }),
      ]);
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
   * POST /api/inbox/:phone/actions/:id/offer — answer a negotiation (owner ask
   * 2026-09-29): the price the shop will take, and the sentence carrying it.
   *
   * One transaction, exactly as a reply by hand: the action closes with the
   * price recorded, the answer lands on the customer's newest message, every
   * waiting row is closed (nothing is left outlined), and the send is
   * queued. The customer's offer is not re-read here — the modal showed the
   * figure the worker last saw, and the staff member answered that.
   */
  router.post("/:phone/actions/:id/offer", async (req, res, next) => {
    try {
      const phone = phoneParam.safeParse(req.params["phone"]);
      if (!phone.success)
        throw new ApiError(400, "VALIDASI", "Nomor WhatsApp tidak valid.");
      const parsed = offerBody.safeParse(req.body);
      if (!parsed.success)
        throw new ApiError(400, "VALIDASI", "Harga dan pesan wajib diisi.");
      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");

      const action = await db.chatAction.findFirst({
        where: { id: String(req.params["id"]), from: phone.data },
        select: { id: true, status: true },
      });
      if (!action) throw notFound("Tugas");
      if (action.status !== "OPEN")
        throw new ApiError(409, "KONFLIK", "Tugas ini sudah diselesaikan.");

      const latest = await db.waMessage.findFirst({
        where: { from: phone.data, direction: "IN" },
        orderBy: { ts: "desc" },
        select: { id: true, ts: true },
      });
      if (!latest) throw notFound("Percakapan");
      if (!isWithinWindow(latest.ts)) {
        throw new ApiError(
          409,
          "KONFLIK",
          "Jendela 24 jam sudah tutup. Balasan bebas tidak akan terkirim — gunakan template yang sudah disetujui.",
        );
      }

      const now = new Date();
      await db.$transaction(async (tx) => {
        const { count } = await tx.chatAction.updateMany({
          where: { id: action.id, status: "OPEN" },
          data: {
            status: "DONE",
            staffPrice: parsed.data.price,
            resolvedAt: now,
            resolvedById: staff.id,
            updatedAt: now,
          },
        });
        if (count !== 1)
          throw new ApiError(409, "KONFLIK", "Tugas ini sudah diselesaikan.");
        await tx.waMessage.update({
          where: { id: latest.id },
          data: {
            replyText: parsed.data.text,
            status: "DIJAWAB_STAF",
            answeredByAgent: false,
            answeredById: staff.id,
            answeredAt: now,
          },
        });
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
        const queued = await enqueueOutbox(tx, {
          kind: "WA_REPLY",
          payload: {
            to: phone.data,
            body: parsed.data.text,
            inReplyTo: latest.id,
          },
          requestId: currentRequestId() ?? null,
        });
        await recordSender(tx, {
          staffId: staff.id,
          outboxId: queued.id,
          after: { to: phone.data, text: parsed.data.text },
          requestId: currentRequestId() ?? null,
          ip: req.ip ?? null,
        });
      });
      res.status(201).json({ id: action.id, status: "QUEUED" });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/inbox/:phone/actions/:id/done — the task was dealt with some
   * other way. Nothing is sent. The thread's waiting messages are untouched:
   * a reply, or Mark handled, is what closes them.
   */
  router.post("/:phone/actions/:id/done", async (req, res, next) => {
    try {
      const phone = phoneParam.safeParse(req.params["phone"]);
      if (!phone.success)
        throw new ApiError(400, "VALIDASI", "Nomor WhatsApp tidak valid.");
      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");
      const now = new Date();
      const { count } = await db.chatAction.updateMany({
        where: {
          id: String(req.params["id"]),
          from: phone.data,
          status: "OPEN",
        },
        data: {
          status: "DONE",
          resolvedAt: now,
          resolvedById: staff.id,
          updatedAt: now,
        },
      });
      if (count === 0) throw notFound("Tugas");
      res.json({ done: true });
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

  /**
   * POST /api/inbox/:phone/clear — *Clear chat* (owner ask 2026-10-27).
   *
   * Hides the conversation and makes the bot forget it, the way a tester's
   * `/new` does, without deleting a thing. One transaction:
   *
   *  1. every row still waiting is closed as handled by this person — the
   *     Mark-handled close, so nothing is left outlined as waiting;
   *  2. the thread's open tasks are done;
   *  3. `WaThreadMemory.clearedAt`/`clearedById` — the app role's own columns
   *     (invariant 13) — mark the point every reader starts from
   *     (`resetPointFor`, and `visibleAfter` here);
   *  4. ONE `AuditLog` row says who (entity `WaThread`, ARCHIVE).
   *
   * The thread leaves the list until the customer writes again, and then
   * shows only what came after. Since 2026-10-27 the bot also forgets what it
   * LEARNED (`forgetProfile`) and the 🔥 lead stops counting; ratings,
   * corrections and a colleague's own profile facts are untouched. Any
   * signed-in staff (owner answer).
   */
  router.post("/:phone/clear", async (req, res, next) => {
    try {
      const phone = phoneParam.safeParse(req.params["phone"]);
      if (!phone.success)
        throw new ApiError(400, "VALIDASI", "Nomor WhatsApp tidak valid.");
      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");

      const exists = await db.waMessage.findFirst({
        where: { from: phone.data },
        select: { id: true },
      });
      if (!exists) throw notFound("Percakapan");

      const at = new Date();
      const closed = await db.$transaction(async (tx) => {
        const { count } = await tx.waMessage.updateMany({
          where: {
            from: phone.data,
            direction: "IN",
            status: { in: ["BARU", "PERLU_STAF"] },
          },
          data: {
            status: "DIJAWAB_STAF",
            answeredByAgent: false,
            answeredById: staff.id,
            answeredAt: at,
          },
        });
        await tx.chatAction.updateMany({
          where: { from: phone.data, status: "OPEN" },
          data: {
            status: "DONE",
            resolvedAt: at,
            resolvedById: staff.id,
            updatedAt: at,
          },
        });
        // What the bot learned in that conversation goes with it (owner,
        // 2026-10-27: "it still retains the score and the memory of like the
        // usage and all"): the profile's learned columns are nulled and the
        // bot's facts taken back. The 🔥 lead and its score are agent-owned
        // columns this role cannot write; every reader ignores a lead marked
        // before the clear instead (`isLead(m, resetAt)`).
        await forgetProfile(tx, phone.data, at);
        // Only the app's columns on update; the create branch initialises
        // the two NOT NULL counters on a row that did not exist (auto-reply's
        // reasoning, above).
        await tx.waThreadMemory.upsert({
          where: { from: phone.data },
          update: { clearedAt: at, clearedById: staff.id, updatedAt: at },
          create: {
            from: phone.data,
            clearedAt: at,
            clearedById: staff.id,
            summaryTurns: 0,
            clarifyCount: 0,
            updatedAt: at,
          },
          select: { id: true },
        });
        await tx.auditLog.create({
          data: {
            at,
            staffId: staff.id,
            entity: "WaThread",
            entityId: phone.data,
            action: "ARCHIVE",
            field: "clearedAt",
            before: null,
            after: JSON.stringify({ clearedAt: at.toISOString() }),
            requestId: currentRequestId() ?? req.get("x-request-id") ?? null,
            ip: req.ip ?? null,
          },
        });
        return count;
      });
      res.json({ clearedAt: at.toISOString(), closed });
    } catch (err) {
      next(err);
    }
  });

  /**
   * DELETE /api/inbox/:phone — *Delete conversation*, for good (owner only,
   * 2026-10-27). The body must carry the number typed back (`confirm`), the
   * second layer of the page's confirm, so a stray request cannot do it.
   *
   * The deleting is `wa_thread_delete` (migration 20261027090000), a
   * SECURITY DEFINER function and the only door to a DELETE on these tables:
   * messages, recall chunks, tasks, traces, the thread's memory, what was
   * queued or sent to the number, raw envelopes naming it and booking
   * proposals. It KEEPS the customer's profile, every rating and correction,
   * and exactly the messages and traces those name — hidden behind a fresh
   * `clearedAt`. Real reservations are never touched. The one `AuditLog`
   * row, in the same transaction, says who and how many rows — never what
   * the messages said.
   */
  router.delete("/:phone", ownerOnly, async (req, res, next) => {
    try {
      const phone = phoneParam.safeParse(req.params["phone"]);
      if (!phone.success)
        throw new ApiError(400, "VALIDASI", "Nomor WhatsApp tidak valid.");
      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");
      const body = deleteBody.safeParse(req.body ?? {});
      if (!body.success || body.data.confirm.replace(/\D/g, "") !== phone.data)
        throw new ApiError(
          400,
          "VALIDASI",
          "Ketik nomor WhatsApp-nya untuk menghapus percakapan ini.",
          { field: "confirm" },
        );

      const [message, memory] = await Promise.all([
        db.waMessage.findFirst({
          where: { from: phone.data },
          select: { id: true },
        }),
        db.waThreadMemory.findUnique({
          where: { from: phone.data },
          select: { id: true },
        }),
      ]);
      if (!message && !memory) throw notFound("Percakapan");

      const at = new Date();
      const removed = await db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
          SELECT wa_thread_delete(
                   ${phone.data},
                   ${staff.id},
                   (${at}::timestamptz AT TIME ZONE 'UTC')
                 ) AS n`);
        const n = Number(rows[0]?.n ?? 0);
        // The profile is kept (its link to the customer, a colleague's
        // facts); what the bot learned from the deleted chat is not.
        await forgetProfile(tx, phone.data, at);
        await tx.auditLog.create({
          data: {
            at,
            staffId: staff.id,
            entity: "WaThread",
            entityId: phone.data,
            action: "DELETE",
            field: null,
            before: null,
            after: JSON.stringify({ rows: n }),
            requestId: currentRequestId() ?? req.get("x-request-id") ?? null,
            ip: req.ip ?? null,
          },
        });
        return n;
      });
      res.json({ deleted: removed });
    } catch (err) {
      next(err);
    }
  });

  registerInboxV2(router, db);
  if (sent) registerInboxSent(router, db, sent);

  return router;
}
