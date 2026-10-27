/**
 * The task a hand-over leaves for a person (owner ask 2026-09-29).
 *
 * *"If off, it will be escalated to human, with an action item and summary of
 * each person's chat"* — and, for a negotiation, *"if the user updates the
 * price they want before the staff replies, upsert to update the nego
 * price"*. So every hand-over writes one `ChatAction`, and a thread holds at
 * most ONE open task of each kind (a partial unique index in the migration):
 * the customer who asks the price three ways is one PRICE task, and the one
 * who drops their offer from 7,5jt to 7jt moves `askPrice` on the task a
 * colleague already has open rather than stacking a second one.
 *
 * The offer is read by code (`parseAskPrice`), never by the model — it is the
 * number a staff member will act on, and a model asked to extract it will
 * sometimes round it.
 */

import {
  actionKindOf,
  askingPrice,
  parseAskPrice,
  phoneForms,
  type ChatActionKind,
  type HandoffTopic,
} from "@nusantara/agent";
import {
  DP_PROOF_PREFIX,
  recordStoreChanges,
  type Prisma,
  type PrismaClient,
} from "@nusantara/db";
import type { Logger } from "@nusantara/logging";

type Tx = Prisma.TransactionClient;

export interface ActionInput {
  readonly from: string;
  /**
   * A hand-over topic — or, for a job that is not a hand-over (2026-10-27),
   * its own word with an explicit `kind`: `visit` ("Perlu sambut"),
   * `restock` ("Perlu kabari") and `dp` ("Perlu putuskan DP", 2026-10-27).
   * Those are not hand-over topics on purpose, so `waitingTasks` does not
   * tell the bot to stop answering while they are open.
   */
  readonly topic: HandoffTopic | "visit" | "restock" | "dp";
  /** Overrides the kind the topic implies — required for a non-hand-over topic. */
  readonly kind?: ChatActionKind;
  readonly summary: string;
  /** The customer's words that raised it. */
  readonly customerText: string;
  /** The unit it is about, when the bot named one. */
  readonly serial?: string;
  /** The newest inbound message it has read, when there is one. */
  readonly messageId?: string;
  readonly now: Date;
}

/** Write or refresh the thread's open task of this kind. */
export async function upsertChatAction(
  tx: Tx,
  input: ActionInput,
): Promise<{ id: string; created: boolean }> {
  const kind =
    input.kind ??
    (input.topic === "visit" || input.topic === "dp"
      ? "RESERVATION"
      : input.topic === "restock"
        ? "STOCK"
        : actionKindOf(input.topic));
  const [unit, customer] = await Promise.all([
    input.serial
      ? tx.unit.findUnique({
          where: { serial: input.serial },
          select: {
            id: true,
            skuId: true,
            price: true,
            sku: { select: { price: true } },
          },
        })
      : null,
    tx.customer.findFirst({
      where: { phone: { in: phoneForms(input.from) } },
      select: { id: true },
    }),
  ]);
  const ask = kind === "NEGOTIATION" ? parseAskPrice(input.customerText) : null;
  const unitFields = unit
    ? { unitId: unit.id, skuId: unit.skuId, listPrice: askingPrice(unit) }
    : {};
  const common = {
    topic: input.topic,
    summary: input.summary.slice(0, 1_000),
    customerText: input.customerText.slice(0, 2_000),
    ...(input.messageId ? { messageId: input.messageId } : {}),
    updatedAt: input.now,
    ...(customer ? { customerId: customer.id } : {}),
    ...unitFields,
    ...(ask !== null ? { askPrice: ask } : {}),
  };

  // A DP proof is what a pending reservation request is waiting for
  // (2026-10-27): every open Requests tab redraws that request's status.
  if (input.summary.startsWith(DP_PROOF_PREFIX)) {
    const waiting = await tx.reservationProposal.findMany({
      where: {
        from: input.from,
        confirmedAt: null,
        cancelledAt: null,
        expiresAt: { gt: input.now },
      },
      select: { id: true },
    });
    await recordStoreChanges(
      tx,
      waiting.map((w) => ["reservationRequests", w.id] as const),
    );
  }
  const open = await tx.chatAction.findFirst({
    where: { from: input.from, kind, status: "OPEN" },
    select: { id: true },
  });
  if (open) {
    await tx.chatAction.update({ where: { id: open.id }, data: common });
    return { id: open.id, created: false };
  }
  const made = await tx.chatAction.create({
    data: { from: input.from, kind, createdAt: input.now, ...common },
    select: { id: true },
  });
  return { id: made.id, created: true };
}

/**
 * Carry a customer's newer offer onto an open negotiation.
 *
 * Code only, no model, and run before the draft pass: a customer writing
 * "kalau 7jt boleh?" and then "7,2 deh" moves the figure on the task the
 * colleague has open, whether or not the bot gets to answer the newer line —
 * it may not, while a colleague is chatting (draft.ts `quietCandidates`). A
 * hand-over no longer holds the thread itself since 2026-10-27.
 */
export async function refreshOffers(
  db: PrismaClient,
  logger: Logger,
  now: Date,
): Promise<number> {
  const open = await db.chatAction.findMany({
    where: { kind: "NEGOTIATION", status: "OPEN" },
    select: {
      id: true,
      from: true,
      askPrice: true,
      message: { select: { id: true, ts: true } },
    },
    take: 200,
  });
  let moved = 0;
  for (const action of open) {
    const newer = await db.waMessage.findMany({
      where: {
        from: action.from,
        direction: "IN",
        ...(action.message
          ? { ts: { gte: action.message.ts }, id: { not: action.message.id } }
          : {}),
      },
      orderBy: [{ ts: "asc" }, { id: "asc" }],
      select: { id: true, text: true },
      take: 50,
    });
    if (newer.length === 0) continue;
    const latest = newer[newer.length - 1]!;
    const offered = [...newer]
      .reverse()
      .map((m) => ({ m, ask: m.text ? parseAskPrice(m.text) : null }))
      .find((x) => x.ask !== null);
    const changed = offered !== undefined && offered.ask !== action.askPrice;
    await db.chatAction.update({
      where: { id: action.id },
      data: {
        messageId: latest.id,
        ...(changed
          ? {
              askPrice: offered.ask,
              customerText: offered.m.text ?? null,
              updatedAt: now,
            }
          : {}),
      },
    });
    if (changed) {
      moved += 1;
      logger.info(
        { evt: "worker.action.offer_moved", ctx: { from: action.from } },
        "the customer changed their offer before anybody answered",
      );
    }
  }
  return moved;
}
