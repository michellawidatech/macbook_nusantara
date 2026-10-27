/**
 * "Tell me when it's in stock" (owner-approved 2026-10-27).
 *
 * The bot writes a `StockWatch` when a customer says yes to "Mau saya kabari
 * kalau sudah ready kak?" (packages/agent `watch_stock`). This pass notices a
 * sellable unit that matches an open watch and has come onto the shelf since
 * the wish — by variant when the words named one, by product when they named
 * one product, by the words themselves otherwise, and within their budget —
 * and leaves ONE staff task per thread:
 *
 *     Perlu kabari — Air M3 16/512 sudah ready, Budi minta dikabari
 *
 * then stamps `notifiedAt`, in the same transaction, so the task is left once.
 * A person sends the message: nothing goes to the customer from here — they
 * may be long outside the 24-hour window, and a colleague may want to say it
 * with a price.
 *
 * A wish nobody could meet in `WATCH_STALE_MS` is closed, so the open list is
 * the live one.
 *
 * Runs as `nusantara_agent`, which may SELECT, INSERT and UPDATE
 * `StockWatch` and no more (migration 20261027150000).
 */

import { askingPrice, notifyTask, phoneForms } from "@nusantara/agent";
import { TXN_TIMEOUTS, type PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import { upsertChatAction } from "./actions.js";

export interface WatchPassDeps {
  readonly db: PrismaClient;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly maxPerTick?: number;
}

/** A wish this old with nothing to show for it is closed. */
export const WATCH_STALE_MS = 60 * 86_400_000;

/** The words that must all match something, as the stock search reads them. */
const words = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[\s,/|·]+/)
    .map((t) => t.trim().replace(/[%_\\]/g, ""))
    .filter(
      (t) => t.length >= 2 && !["gb", "inch", "unit", "grade"].includes(t),
    )
    .slice(0, 6);

export async function watchPass(
  deps: WatchPassDeps,
): Promise<{ notified: number; closed: number }> {
  const { db, logger } = deps;
  const now = (deps.now ?? (() => new Date()))();
  let notified = 0;
  let closed = 0;
  try {
    const stale = await db.stockWatch.updateMany({
      where: {
        closedAt: null,
        notifiedAt: null,
        createdAt: { lt: new Date(now.getTime() - WATCH_STALE_MS) },
      },
      data: { closedAt: now },
    });
    closed = stale.count;

    const open = await db.stockWatch.findMany({
      where: { closedAt: null, notifiedAt: null },
      orderBy: { createdAt: "asc" },
      take: deps.maxPerTick ?? 50,
      select: {
        id: true,
        from: true,
        query: true,
        skuId: true,
        modelId: true,
        budget: true,
        createdAt: true,
      },
    });

    for (const w of open) {
      const terms = words(w.query);
      const candidates = await db.unit.findMany({
        where: {
          status: "TERSEDIA",
          archivedAt: null,
          sku: { archived: false, model: { archived: false } },
          ...(w.skuId
            ? { skuId: w.skuId }
            : w.modelId
              ? { sku: { modelId: w.modelId, archived: false } }
              : terms.length
                ? {
                    AND: terms.map((t) => ({
                      OR: [
                        {
                          sku: {
                            name: { contains: t, mode: "insensitive" as const },
                          },
                        },
                        {
                          sku: {
                            variantLabel: {
                              contains: t,
                              mode: "insensitive" as const,
                            },
                          },
                        },
                        {
                          sku: {
                            model: {
                              name: {
                                contains: t,
                                mode: "insensitive" as const,
                              },
                            },
                          },
                        },
                        {
                          sku: {
                            model: {
                              category: {
                                name: {
                                  contains: t,
                                  mode: "insensitive" as const,
                                },
                              },
                            },
                          },
                        },
                      ],
                    })),
                  }
                : { serial: "" }),
        },
        select: {
          id: true,
          serial: true,
          price: true,
          sku: { select: { name: true, variantLabel: true, price: true } },
        },
        take: 50,
      });
      // Within their budget, when they gave one; a unit nobody priced is not
      // one a colleague can offer yet.
      const fits = candidates.filter((u) => {
        if (w.budget === null) return true;
        const p = askingPrice(u);
        return p !== null && p <= w.budget;
      });
      // On the shelf SINCE the wish: its newest ledger row is after it.
      let hit: (typeof fits)[number] | null = null;
      for (const u of fits) {
        const last = await db.unitEvent.findFirst({
          where: { unitId: u.id },
          orderBy: { seq: "desc" },
          select: { at: true },
        });
        if (last && last.at > w.createdAt) {
          hit = u;
          break;
        }
      }
      if (!hit) continue;

      const [profile, customer, message] = await Promise.all([
        db.customerProfile.findUnique({
          where: { from: w.from },
          select: { name: true },
        }),
        db.customer.findFirst({
          where: { phone: { in: phoneForms(w.from) } },
          select: { name: true },
        }),
        db.waMessage.findFirst({
          where: { from: w.from, direction: "IN" },
          orderBy: [{ ts: "desc" }, { id: "desc" }],
          select: { id: true },
        }),
      ]);
      const unit = [hit.sku.name, hit.sku.variantLabel]
        .filter(Boolean)
        .join(" ");
      const done = await db.$transaction(async (tx) => {
        // Only while still un-notified: two workers leave one task.
        const { count } = await tx.stockWatch.updateMany({
          where: { id: w.id, notifiedAt: null, closedAt: null },
          data: { notifiedAt: now },
        });
        if (count !== 1) return false;
        await upsertChatAction(tx, {
          from: w.from,
          topic: "restock",
          kind: "STOCK",
          summary: notifyTask({
            name: profile?.name ?? customer?.name ?? null,
            unit,
          }),
          customerText: w.query,
          serial: hit!.serial,
          ...(message ? { messageId: message.id } : {}),
          now,
        });
        return true;
      }, TXN_TIMEOUTS);
      if (done) {
        notified += 1;
        logger.info(
          { evt: "worker.watch.notified", ctx: { from: w.from } },
          "a unit somebody asked to hear about is on the shelf — left a colleague the task",
        );
      }
    }
  } catch (err) {
    logger.error(
      {
        evt: "worker.watch.failed",
        ...(err instanceof Error
          ? { err: { name: err.name, message: err.message } }
          : {}),
      },
      "the stock watch pass failed — the next tick tries again",
    );
  }
  return { notified, closed };
}
