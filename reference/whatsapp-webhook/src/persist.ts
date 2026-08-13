/**
 * Inbound persistence for the webhook receiver.
 *
 * The POST route stays thin: verify HMAC → 200 → `persistInbound()` → hand the
 * new rows to the agent pipeline via `setImmediate`. We store the raw event
 * verbatim (`WaRawEvent`, for replay/debug) and one normalized `WaMessage` per
 * inbound message, deduped on `waMessageId` because Meta retries deliveries.
 *
 * `WaMessage.status` doubles as the work queue: a fresh row is `BARU`; the
 * pipeline moves it to `DIJAWAB_AGEN` / `PERLU_STAF`. A periodic sweeper
 * re-runs any row still `BARU` after a couple of minutes (a process that died
 * mid-pipeline), so no message is silently dropped.
 */

import { prisma, type WaMessage } from "@nusantara/db";

interface WhatsAppValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  messages?: Array<{
    from: string;
    id: string;
    timestamp: string;
    type: string;
    text?: { body: string };
    interactive?: unknown;
    location?: { latitude: number; longitude: number };
  }>;
  statuses?: Array<{ id: string; status: string; recipient_id: string }>;
}

/**
 * A Meta webhook envelope. `value` is left `unknown` because one app receives
 * both WhatsApp (`whatsapp_business_account`) and Instagram (`instagram`)
 * events with different value shapes; each extractor narrows it (extractMessages
 * here for WA, extractComments in instagram.ts for IG).
 */
export interface WebhookPayload {
  object?: string;
  entry?: Array<{ id: string; changes?: Array<{ field: string; value: unknown }> }>;
}

/** A normalized inbound message, ready to persist as a `WaMessage`. */
export interface InboundMessage {
  waMessageId: string;
  from: string;
  name: string | null;
  text: string | null;
  msgType: string;
  ts: Date;
}

/**
 * Flatten a webhook payload into the inbound messages it carries. Delivery/read
 * status callbacks (which have no `messages`) yield nothing. Pure — no I/O.
 */
export function extractMessages(payload: WebhookPayload): InboundMessage[] {
  if (payload.object !== "whatsapp_business_account") return [];
  const out: InboundMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value as WhatsAppValue;
      const name = value.contacts?.[0]?.profile?.name ?? null;
      for (const msg of value.messages ?? []) {
        if (!msg.id || !msg.from) continue;
        out.push({
          waMessageId: msg.id,
          from: msg.from,
          name,
          text: msg.text?.body ?? null,
          msgType: msg.type ?? "unknown",
          ts: tsFromSeconds(msg.timestamp),
        });
      }
    }
  }
  return out;
}

/** WhatsApp timestamps are unix seconds (as a string); fall back to now(). */
function tsFromSeconds(raw: string | undefined): Date {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

const isUniqueViolation = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

/**
 * Persist the raw event and every new inbound message. Returns only the rows we
 * created (status `BARU`), so a duplicate delivery re-runs nothing. Safe against
 * a race between concurrent retries: the `waMessageId` unique constraint is the
 * final arbiter, and a lost race is swallowed.
 */
export async function persistInbound(payload: WebhookPayload): Promise<WaMessage[]> {
  await prisma.waRawEvent.create({ data: { payload: payload as object } });

  const created: WaMessage[] = [];
  for (const m of extractMessages(payload)) {
    const existing = await prisma.waMessage.findUnique({
      where: { waMessageId: m.waMessageId },
      select: { id: true },
    });
    if (existing) continue;
    try {
      created.push(
        await prisma.waMessage.create({
          data: {
            waMessageId: m.waMessageId,
            from: m.from,
            name: m.name,
            text: m.text,
            msgType: m.msgType,
            ts: m.ts,
            status: "BARU",
          },
        }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) continue; // concurrent retry won the insert
      throw e;
    }
  }
  return created;
}

/** How long a row may sit in BARU before the sweeper retries it. */
export const STUCK_AFTER_MS = 2 * 60 * 1000;
/** Sweeper poll interval. */
export const SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * Reschedule any sender with a `WaMessage` still `BARU` older than
 * {@link STUCK_AFTER_MS} — bursts whose pipeline never completed. `schedule` is
 * the same per-sender debounce entry the route uses, so the recovery path runs
 * through the same processing lock (no double-run). Deduped by sender.
 */
export async function sweepStuck(schedule: (from: string) => void): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS);
  const stuck = await prisma.waMessage.findMany({
    where: { status: "BARU", ts: { lt: cutoff } },
    select: { from: true },
    distinct: ["from"],
  });
  for (const row of stuck) {
    try {
      schedule(row.from);
    } catch (err) {
      console.error(`[webhook] sweeper failed for ${row.from}:`, err);
    }
  }
  return stuck.length;
}

/** Start the periodic sweeper; returns the interval handle (unref'd). */
export function startSweeper(schedule: (from: string) => void): NodeJS.Timeout {
  const handle = setInterval(() => {
    void sweepStuck(schedule).catch((err) => console.error("[webhook] sweep error:", err));
  }, SWEEP_INTERVAL_MS);
  handle.unref?.();
  return handle;
}
