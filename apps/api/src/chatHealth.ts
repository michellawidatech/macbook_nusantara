/**
 * Is the chatbot working? (owner, 2026-10-28: *"a constant check if the
 * chatbot is not running, and then notify in POS and to the staff"*.)
 *
 * Three facts the database and the gateway can answer, no heartbeat needed:
 *
 * - **BOT_STALE** — a customer's message has waited for the bot more than
 *   `STALE_MS`. The worker's own watchdog answers one at 3 minutes, so one
 *   still waiting at 5 means nobody is processing: the worker is down,
 *   stuck, or failing every turn. Chats the bot is meant to leave alone are
 *   not counted: bot switched off, a colleague typing in the last 15
 *   minutes, a staff alert number.
 * - **OUTBOX_STUCK** — a reply due more than `STALE_MS` ago has not gone.
 * - **WA_DISCONNECTED** — the linked WhatsApp is not connected (Baileys only).
 *
 * `startChatHealthMonitor` runs it every 2 minutes in the API (prod only)
 * and, on a CHANGE, messages the alert numbers straight through the gateway —
 * not through the Outbox, whose sender is the worker that may be the thing
 * that is down. With WhatsApp itself disconnected nothing can be sent; the
 * POS shows it (`GET /api/chat/health`).
 */
import { Prisma, type PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import {
  POS_PUBLIC_URL,
  loadNotifyNumbers,
  loadTesters,
} from "@nusantara/agent";
import { callGateway, type GatewayTarget } from "./gatewayClient.js";

export const STALE_MS = 5 * 60_000;
export const HEALTH_CHECK_MS = 2 * 60_000;
const STAFF_ACTIVE_MS = 15 * 60_000;
export const HEALTH_STATE_KEY = "chatbot.health.state";

export type HealthCode = "BOT_STALE" | "OUTBOX_STUCK" | "WA_DISCONNECTED";

export interface ChatHealth {
  readonly ok: boolean;
  readonly problems: ReadonlyArray<{
    readonly code: HealthCode;
    /** Minutes the oldest stuck item has waited, where that applies. */
    readonly minutes?: number;
  }>;
  readonly checkedAt: string;
}

export async function checkChatHealth(
  db: PrismaClient,
  opts: {
    readonly gateway: GatewayTarget | null;
    readonly logger: Logger;
    readonly now?: Date;
    readonly fetchImpl?: typeof fetch;
  },
): Promise<ChatHealth> {
  const now = opts.now ?? new Date();
  const staleBefore = new Date(now.getTime() - STALE_MS);
  const staffSince = new Date(now.getTime() - STAFF_ACTIVE_MS);
  const [alerts, testers] = await Promise.all([
    loadNotifyNumbers(db),
    loadTesters(db),
  ]);
  const ignored = alerts.filter((n) => !testers.includes(n));

  const [stale] = await db.$queryRaw<Array<{ oldest: Date | null }>>(
    Prisma.sql`
      SELECT MIN(m."ts") AS oldest
        FROM "WaMessage" m
        LEFT JOIN "WaThreadMemory" t ON t."from" = m."from"
       WHERE m."direction" = 'IN'
         AND m."status" = 'BARU'
         AND m."ts" < (${staleBefore}::timestamptz AT TIME ZONE 'UTC')
         AND (t."autoReply" IS NULL OR t."autoReply" = true)
         AND (t."clearedAt" IS NULL OR m."ts" > t."clearedAt")
         AND NOT (m."from" = ANY(${ignored}::text[]))
         AND NOT EXISTS (
               SELECT 1 FROM "WaMessage" s
                WHERE s."from" = m."from"
                  AND s."answeredByAgent" = false
                  AND s."answeredById" IS NOT NULL
                  AND s."answeredAt" > (${staffSince}::timestamptz AT TIME ZONE 'UTC')
             )
    `,
  );
  const stuck = await db.outbox.findFirst({
    where: {
      status: { in: ["PENDING", "SENDING"] },
      nextAttemptAt: { lt: staleBefore },
      createdAt: { gt: new Date(now.getTime() - 24 * 3_600_000) },
    },
    orderBy: { nextAttemptAt: "asc" },
    select: { nextAttemptAt: true },
  });

  const problems: Array<{ code: HealthCode; minutes?: number }> = [];
  const minutesSince = (d: Date) =>
    Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (stale?.oldest)
    problems.push({ code: "BOT_STALE", minutes: minutesSince(stale.oldest) });
  if (stuck)
    problems.push({
      code: "OUTBOX_STUCK",
      minutes: minutesSince(stuck.nextAttemptAt),
    });
  if (opts.gateway) {
    const answer = await callGateway({
      gateway: opts.gateway,
      logger: opts.logger,
      method: "GET",
      path: "/status",
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
    const state =
      answer.ok && typeof answer.body === "object" && answer.body !== null
        ? (answer.body as { state?: unknown }).state
        : null;
    if (state !== "CONNECTED") problems.push({ code: "WA_DISCONNECTED" });
  }
  return { ok: problems.length === 0, problems, checkedAt: now.toISOString() };
}

/** What each problem is called in the staff alert. */
const WORDS: Record<HealthCode, string> = {
  BOT_STALE: "pesan pelanggan belum dibalas bot",
  OUTBOX_STUCK: "balasan tertahan, belum terkirim",
  WA_DISCONNECTED: "WhatsApp toko terputus",
};

export function healthAlertText(health: ChatHealth, baseUrl = POS_PUBLIC_URL) {
  if (health.ok) return "✅ Chatbot sudah normal lagi.";
  const what = health.problems
    .map((p) =>
      p.minutes !== undefined
        ? `${WORDS[p.code]} (${p.minutes} menit)`
        : WORDS[p.code],
    )
    .join(", ");
  return `⚠️ Chatbot bermasalah: ${what}. Cek POS: ${baseUrl}/chat`;
}

/** The stored state: "ok", or the problem codes in order. */
const stateOf = (h: ChatHealth) =>
  h.ok ? "ok" : h.problems.map((p) => p.code).join(",");

/**
 * One check, and — when the state changed since the last one — a WhatsApp
 * line to every alert number. Returns what it found. Exported for the test.
 */
export async function healthTick(
  db: PrismaClient,
  opts: {
    readonly gateway: GatewayTarget | null;
    readonly logger: Logger;
    readonly now?: Date;
    readonly fetchImpl?: typeof fetch;
    readonly baseUrl?: string;
  },
): Promise<{ health: ChatHealth; alerted: number }> {
  const health = await checkChatHealth(db, opts);
  const now = opts.now ?? new Date();
  const state = stateOf(health);
  const prev = await db.appSetting.findUnique({
    where: { key: HEALTH_STATE_KEY },
    select: { value: true },
  });
  // First run: remember, say nothing — a deploy is not news.
  if (prev?.value === state || prev === null) {
    if (prev === null)
      await db.appSetting.create({
        data: { key: HEALTH_STATE_KEY, value: state, updatedAt: now },
      });
    return { health, alerted: 0 };
  }
  await db.appSetting.update({
    where: { key: HEALTH_STATE_KEY },
    data: { value: state, updatedAt: now },
  });
  opts.logger[health.ok ? "info" : "warn"](
    { evt: "chat.health.changed", ctx: { from: prev.value, to: state } },
    health.ok ? "the chatbot is working again" : "the chatbot has a problem",
  );
  // Nothing can be sent while WhatsApp itself is down; the POS says so.
  if (health.problems.some((p) => p.code === "WA_DISCONNECTED"))
    return { health, alerted: 0 };
  const body = healthAlertText(health, opts.baseUrl);
  let alerted = 0;
  for (const to of await loadNotifyNumbers(db)) {
    const answer = await callGateway({
      gateway: opts.gateway,
      logger: opts.logger,
      method: "POST",
      path: "/graph/v25.0/health/messages",
      body: { messaging_product: "whatsapp", to, type: "text", text: { body } },
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
    if (answer.ok && answer.status < 300) alerted += 1;
  }
  return { health, alerted };
}

/** Every 2 minutes, in the shop's API only. Returns the stop. */
export function startChatHealthMonitor(
  db: PrismaClient,
  opts: { readonly gateway: GatewayTarget | null; readonly logger: Logger },
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await healthTick(db, opts);
    } catch (err) {
      opts.logger.warn(
        {
          evt: "chat.health.failed",
          err: { message: err instanceof Error ? err.message : String(err) },
        },
        "the chatbot health check failed",
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), HEALTH_CHECK_MS);
  void tick();
  return () => clearInterval(timer);
}
