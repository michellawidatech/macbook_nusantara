/**
 * Following up once, politely (owner, 2026-10-27): *"the goal of this chatbot
 * is to convert the casual chatter to a lead and even customer."* Two
 * messages the worker sends by itself, each at most once:
 *
 *  - **The visit reminder.** On the day of a visit the bot booked, around
 *    09:00 Jakarta — or two hours before a visit earlier than 11:00 — in the
 *    owner's words: *"Halo kak 😊 apakah kakak jadi datang ke toko kami untuk
 *    lihat {unit}? Kami tunggu ya kedatangannya 🙏"*. The answer is read by
 *    code (`visitReplyTurn`): yes keeps it and leaves a colleague "Perlu
 *    sambut", no closes it, a new time moves it.
 *  - **The quiet hot lead.** A 🔥 lead whose last message was the bot's and
 *    who has been quiet about twenty hours, with no visit booked, no task
 *    open and no "no" said, is nudged ONCE about the unit they asked about —
 *    *"… masih ready ya"* only while the shelf says so, else the closest unit
 *    that is. Never more than once a week.
 *
 * ## Never twice, never inside a transaction with the network
 *
 * Each message is an `Outbox` WA_REPLY whose payload carries `followUp` (and
 * the visit's `reservationId`) — the marker every later pass reads, so a row
 * is never written twice. The check and the insert run under a per-thread
 * advisory lock inside one transaction, so two workers cannot both pass it.
 * The send pass delivers it like any reply; nothing here touches the network.
 *
 * ## The 24-hour window
 *
 * A free-form message reaches a customer only within 24 hours of their last
 * one (06 §11). The nudge is always inside it — it is sent at hour twenty.
 * The reminder may fall outside it, and is then sent ONLY through the linked
 * device (`WHATSAPP_TRANSPORT=baileys`), which has no window; on the Cloud API
 * it would need an approved template, so it is skipped and the reason logged.
 *
 * Runs as `nusantara_agent` (apps/worker/test/agentRole.test.ts).
 */

import {
  followUps,
  isLead,
  lastShownUnits,
  phoneForms,
  resetPointFor,
  saysNo,
} from "@nusantara/agent";
import {
  Prisma,
  TXN_TIMEOUTS,
  enqueueOutbox,
  type PrismaClient,
} from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import { WINDOW_MS } from "@nusantara/whatsapp";

export type FollowUpKind = "visit_reminder" | "lead_nudge";

export interface FollowUpDeps {
  readonly db: PrismaClient;
  readonly logger: Logger;
  /** How the worker sends: only the linked device may go past the window. */
  readonly transport: "cloud" | "baileys";
  readonly now?: () => Date;
  /** Messages one pass may queue, of each kind. */
  readonly maxPerTick?: number;
  /** How long a lead must have been quiet. Default 20 hours. */
  readonly quietMs?: number;
}

export interface FollowUpPassResult {
  readonly reminded: number;
  readonly nudged: number;
}

/** A lead is nudged after this long without a word. */
export const LEAD_QUIET_MS = 20 * 3_600_000;
/** And never again within this. */
export const NUDGE_EVERY_MS = 7 * 86_400_000;
/** A nudge leaves at least this much window for the send pass. */
const WINDOW_MARGIN_MS = 15 * 60_000;
/** A visit before this Jakarta hour is reminded two hours ahead instead of at 09:00. */
const EARLY_VISIT_HOUR = 11;
const REMIND_HOUR = 9;
const EARLY_LEAD_MS = 2 * 3_600_000;

const JKT_MS = 7 * 3_600_000;

/**
 * When a visit is reminded: 09:00 Jakarta on its day, or two hours before it
 * when it is earlier than 11:00 (owner, 2026-10-27).
 */
export function reminderAt(visit: Date): Date {
  const local = new Date(visit.getTime() + JKT_MS);
  if (local.getUTCHours() < EARLY_VISIT_HOUR)
    return new Date(visit.getTime() - EARLY_LEAD_MS);
  const nine = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    REMIND_HOUR,
  );
  return new Date(nine - JKT_MS);
}

/** The thread a reservation's E.164 phone belongs to. */
const waIdOf = (phone: string) => phone.replace(/^\+/, "");

const skuLabel = (sku: { name: string; variantLabel: string | null }) =>
  [sku.name, sku.variantLabel].filter(Boolean).join(" ");

/** Reminders skipped on the Cloud API, logged once per process each. */
const skippedOutsideWindow = new Set<string>();

/**
 * Queue one follow-up, unless one of this kind (for this visit) already
 * exists — checked under a per-thread advisory lock in the same transaction
 * as the insert, so two workers queue it once.
 */
async function queueOnce(
  db: PrismaClient,
  input: {
    readonly to: string;
    readonly body: string;
    readonly followUp: FollowUpKind;
    readonly reservationId?: string;
    /** For the nudge: only one in this many milliseconds. */
    readonly sinceMs?: number;
    readonly now: Date;
  },
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`followup:${input.to}`}))`;
    const already = await tx.outbox.findFirst({
      where: {
        kind: "WA_REPLY",
        AND: [
          { payload: { path: ["to"], equals: input.to } },
          { payload: { path: ["followUp"], equals: input.followUp } },
          ...(input.reservationId
            ? [
                {
                  payload: {
                    path: ["reservationId"],
                    equals: input.reservationId,
                  },
                },
              ]
            : []),
        ],
        ...(input.sinceMs
          ? { createdAt: { gt: new Date(input.now.getTime() - input.sinceMs) } }
          : {}),
      },
      select: { id: true },
    });
    if (already) return false;
    await enqueueOutbox(tx, {
      kind: "WA_REPLY",
      payload: {
        to: input.to,
        body: input.body,
        followUp: input.followUp,
        ...(input.reservationId ? { reservationId: input.reservationId } : {}),
      } satisfies Prisma.InputJsonValue,
    });
    return true;
  }, TXN_TIMEOUTS);
}

/** The thread's newest inbound message, if it has one. */
async function lastInbound(db: PrismaClient, from: string) {
  return db.waMessage.findFirst({
    where: { from, direction: "IN" },
    orderBy: [{ ts: "desc" }, { id: "desc" }],
    select: {
      id: true,
      ts: true,
      text: true,
      status: true,
      answeredByAgent: true,
      answeredAt: true,
    },
  });
}

async function remindVisits(
  deps: FollowUpDeps,
  now: Date,
  max: number,
): Promise<number> {
  const { db, logger } = deps;
  const visits = await db.reservation.findMany({
    where: {
      source: "AGEN",
      status: "TERJADWAL",
      // A visit holds nothing: no items (2026-10-27).
      items: { none: {} },
      phone: { not: null },
      scheduledFor: {
        gt: now,
        lte: new Date(now.getTime() + 15 * 3_600_000),
      },
    },
    select: {
      id: true,
      code: true,
      phone: true,
      scheduledFor: true,
      createdAt: true,
      proposal: {
        select: {
          items: {
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: {
              unit: {
                select: { sku: { select: { name: true, variantLabel: true } } },
              },
            },
          },
        },
      },
    },
    orderBy: { scheduledFor: "asc" },
    take: 50,
  });

  let queued = 0;
  for (const v of visits) {
    if (queued >= max) break;
    const at = reminderAt(v.scheduledFor!);
    // Not yet, and never for a visit booked after its reminder was due —
    // somebody who booked an hour ago needs no reminder.
    if (now < at || v.createdAt >= at) continue;
    const to = waIdOf(v.phone!);
    const memory = await db.waThreadMemory.findUnique({
      where: { from: to },
      select: { autoReply: true },
    });
    if (memory?.autoReply === false) continue;
    const last = await lastInbound(db, to);
    const inWindow =
      last !== null &&
      now.getTime() - last.ts.getTime() < WINDOW_MS - WINDOW_MARGIN_MS;
    if (!inWindow && deps.transport !== "baileys") {
      if (!skippedOutsideWindow.has(v.id)) {
        skippedOutsideWindow.add(v.id);
        if (skippedOutsideWindow.size > 5_000) skippedOutsideWindow.clear();
        logger.info(
          { evt: "worker.followup.window_closed", ctx: { code: v.code } },
          "visit reminder skipped: the 24-hour window has closed and the Cloud API would need a template",
        );
      }
      continue;
    }
    let unit: string | null = null;
    const sku = v.proposal?.items[0]?.unit.sku;
    if (sku) unit = skuLabel(sku);
    else {
      const [serial] = await lastShownUnits(db, to, null);
      if (serial) {
        const u = await db.unit.findUnique({
          where: { serial },
          select: { sku: { select: { name: true, variantLabel: true } } },
        });
        if (u) unit = skuLabel(u.sku);
      }
    }
    const made = await queueOnce(db, {
      to,
      body: followUps.visitReminder(unit),
      followUp: "visit_reminder",
      reservationId: v.id,
      now,
    });
    if (made) {
      queued += 1;
      logger.info(
        { evt: "worker.followup.visit_reminder", ctx: { code: v.code } },
        "reminded a customer of their visit",
      );
    }
  }
  return queued;
}

/** What the nudge can honestly say about the unit they asked about. */
async function nudgeText(
  db: PrismaClient,
  serial: string,
): Promise<string | null> {
  const asked = await db.unit.findUnique({
    where: { serial },
    select: {
      status: true,
      archivedAt: true,
      skuId: true,
      price: true,
      sku: {
        select: {
          name: true,
          variantLabel: true,
          price: true,
          model: { select: { categoryId: true } },
        },
      },
    },
  });
  if (!asked) return null;
  const label = skuLabel(asked.sku);
  const ready =
    (asked.status === "TERSEDIA" && asked.archivedAt === null) ||
    (await db.unit.count({
      where: { skuId: asked.skuId, status: "TERSEDIA", archivedAt: null },
    })) > 0;
  if (ready) return followUps.leadNudge(label);
  // Gone: the closest priced unit of the same kind that is on the shelf.
  const reference = asked.price ?? asked.sku.price;
  const shelf = await db.unit.findMany({
    where: {
      status: "TERSEDIA",
      archivedAt: null,
      sku: {
        archived: false,
        model: { archived: false, categoryId: asked.sku.model.categoryId },
      },
    },
    select: {
      price: true,
      sku: { select: { name: true, variantLabel: true, price: true } },
    },
    take: 200,
  });
  const priced = shelf
    .map((u) => ({ u, p: u.price ?? u.sku.price }))
    .filter((x) => x.p > 0n);
  if (priced.length === 0) return null;
  const gap = (p: bigint) => (p > reference ? p - reference : reference - p);
  priced.sort((a, b) =>
    gap(a.p) < gap(b.p) ? -1 : gap(a.p) > gap(b.p) ? 1 : 0,
  );
  return followUps.leadNudgeAlternative(label, skuLabel(priced[0]!.u.sku));
}

async function nudgeLeads(
  deps: FollowUpDeps,
  now: Date,
  max: number,
): Promise<number> {
  const { db, logger } = deps;
  const quietMs = deps.quietMs ?? LEAD_QUIET_MS;
  const leads = await db.waThreadMemory.findMany({
    where: { leadAt: { not: null }, autoReply: true },
    select: {
      from: true,
      leadAt: true,
      leadStaffAt: true,
      leadClearedAt: true,
      clearedAt: true,
    },
    orderBy: { leadAt: "desc" },
    take: 200,
  });

  let queued = 0;
  for (const m of leads) {
    if (queued >= max) break;
    if (!isLead(m)) continue;
    const from = m.from;
    const last = await lastInbound(db, from);
    // Their last message was answered by the bot, and nothing since.
    if (
      !last ||
      last.status !== "DIJAWAB_AGEN" ||
      !last.answeredByAgent ||
      !last.answeredAt
    )
      continue;
    // Quiet long enough — and still inside the window, with room to send.
    if (now.getTime() - last.answeredAt.getTime() < quietMs) continue;
    if (now.getTime() - last.ts.getTime() >= WINDOW_MS - WINDOW_MARGIN_MS)
      continue;
    // A cleared conversation is over until they write again.
    if (m.clearedAt && m.clearedAt >= last.ts) continue;
    const [task, visit] = await Promise.all([
      db.chatAction.findFirst({
        where: { from, status: "OPEN" },
        select: { id: true },
      }),
      db.reservation.findFirst({
        where: { phone: { in: phoneForms(from) }, status: "TERJADWAL" },
        select: { id: true },
      }),
    ]);
    if (task || visit) continue;
    // A customer who said no is not nudged.
    const recent = await db.waMessage.findMany({
      where: { from, direction: "IN" },
      orderBy: [{ ts: "desc" }, { id: "desc" }],
      take: 3,
      select: { text: true },
    });
    if (recent.some((r) => r.text && saysNo(r.text))) continue;
    const [serial] = await lastShownUnits(
      db,
      from,
      await resetPointFor(db, from),
    );
    if (!serial) continue;
    const body = await nudgeText(db, serial);
    if (!body) continue;
    const made = await queueOnce(db, {
      to: from,
      body,
      followUp: "lead_nudge",
      sinceMs: NUDGE_EVERY_MS,
      now,
    });
    if (made) {
      queued += 1;
      logger.info(
        { evt: "worker.followup.lead_nudge", ctx: { from } },
        "nudged a quiet lead once",
      );
    }
  }
  return queued;
}

export async function followUpPass(
  deps: FollowUpDeps,
): Promise<FollowUpPassResult> {
  const now = (deps.now ?? (() => new Date()))();
  const max = deps.maxPerTick ?? 10;
  let reminded = 0;
  let nudged = 0;
  try {
    reminded = await remindVisits(deps, now, max);
  } catch (err) {
    deps.logger.error(
      {
        evt: "worker.followup.reminder_failed",
        ...(err instanceof Error
          ? { err: { name: err.name, message: err.message } }
          : {}),
      },
      "the visit reminders failed — the next tick tries again",
    );
  }
  try {
    nudged = await nudgeLeads(deps, now, max);
  } catch (err) {
    deps.logger.error(
      {
        evt: "worker.followup.nudge_failed",
        ...(err instanceof Error
          ? { err: { name: err.name, message: err.message } }
          : {}),
      },
      "the lead nudges failed — the next tick tries again",
    );
  }
  return { reminded, nudged };
}
