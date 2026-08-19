/**
 * Inbound persistence — 06 §9.4.
 *
 * Two things are written per delivery: the raw envelope verbatim
 * (`WaRawEvent` / `IgRawEvent`, so an event can be replayed after a bug is
 * fixed) and one normalised `WaMessage` per inbound WhatsApp message.
 *
 * **Dedup is the database's job.** Meta retries anything slow or non-2xx for up
 * to ~36 hours, so the same message arrives more than once. `waMessageId` is
 * `UNIQUE`, and this inserts first and treats a unique violation as "already
 * handled". A `findFirst`-then-`create` check loses the race between two
 * concurrent retries — which is not theoretical, because retries of the same
 * event can land at the same moment.
 *
 * Instagram is raw-only for now, and that is a deliberate stopping point rather
 * than an oversight: `IgComment.mediaId` is a required FK to `IgMedia`, and
 * filling it means a Graph call to fetch the media a comment hangs off. Until
 * that exists, capturing `IgRawEvent` means nothing is lost and the normalising
 * pass can be written against real payloads.
 */

import type { PrismaClient } from "@nusantara/db";

/** The WhatsApp `value` shape, as much of it as we read. */
interface WhatsAppValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  messages?: Array<{
    from?: string;
    id?: string;
    timestamp?: string;
    type?: string;
    text?: { body?: string };
  }>;
  /** Delivery/read receipts. Carried by the same field, and not a message. */
  statuses?: Array<{ id: string; status: string; recipient_id: string }>;
}

/**
 * A Meta webhook envelope.
 *
 * `value` is `unknown` because one app receives both WhatsApp
 * (`whatsapp_business_account`) and Instagram (`instagram`) events with
 * different shapes; each extractor narrows it.
 */
export interface WebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{ field?: string; value?: unknown }>;
  }>;
}

/**
 * A row this module created.
 *
 * A narrow shape rather than Prisma's full `WaMessage`: `@nusantara/db`
 * deliberately exports only `Prisma` and `PrismaClient`, and the caller needs
 * four columns to decide what to do next. Selecting them explicitly says so.
 */
export interface CreatedMessage {
  readonly id: string;
  readonly waMessageId: string;
  readonly from: string;
  readonly text: string | null;
}

/** A normalised inbound message, ready to become a `WaMessage`. */
export interface InboundMessage {
  readonly waMessageId: string;
  readonly from: string;
  readonly name: string | null;
  readonly text: string | null;
  readonly msgType: string;
  readonly ts: Date;
}

/** WhatsApp timestamps are unix seconds in a string. Fall back to now. */
function tsFromSeconds(raw: string | undefined): Date {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

/**
 * Flatten an envelope into the messages it carries. Pure — no I/O, so the
 * parsing is testable without a database.
 *
 * A delivery-status callback carries `statuses` and no `messages`, and yields
 * nothing. That is most of the traffic once a number is live, and treating it
 * as a message would answer the customer's own read receipt.
 */
export function extractMessages(payload: WebhookPayload): InboundMessage[] {
  if (payload.object !== "whatsapp_business_account") return [];
  const out: InboundMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = (change.value ?? {}) as WhatsAppValue;
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

/** Prisma's unique-constraint violation. */
const isUniqueViolation = (e: unknown): boolean =>
  typeof e === "object" &&
  e !== null &&
  (e as { code?: string }).code === "P2002";

/**
 * Persist a verified WhatsApp delivery.
 *
 * Returns only the rows this call created, so a redelivery hands the caller an
 * empty array and re-runs nothing downstream.
 */
export async function persistInbound(
  db: PrismaClient,
  payload: WebhookPayload,
): Promise<CreatedMessage[]> {
  const receivedAt = new Date();
  await db.waRawEvent.create({
    // `signatureOk: true` unconditionally, because the route rejects anything
    // unsigned before it reaches here (06 §9.1). The column exists so a future
    // quarantine path can record a rejected event without pretending it passed.
    data: { payload: payload as object, signatureOk: true, receivedAt },
  });

  const created: CreatedMessage[] = [];
  for (const m of extractMessages(payload)) {
    try {
      created.push(
        await db.waMessage.create({
          data: {
            waMessageId: m.waMessageId,
            from: m.from,
            name: m.name,
            text: m.text,
            msgType: m.msgType,
            ts: m.ts,
            direction: "IN",
            // BARU doubles as the work queue: the agent pipeline moves a row to
            // DIJAWAB_AGEN or PERLU_STAF once it exists.
            status: "BARU",
            // Required and not defaulted in the schema. `{}` rather than null:
            // the extraction has not run, and an empty object says "nothing
            // extracted" where null would say "column not applicable".
            entities: {},
            answeredByAgent: false,
          },
          select: { id: true, waMessageId: true, from: true, text: true },
        }),
      );
    } catch (e) {
      // A concurrent retry won the insert. That is the dedup working, not an
      // error — the other delivery owns the row and will process it.
      if (isUniqueViolation(e)) continue;
      throw e;
    }
  }
  return created;
}

/**
 * Persist a verified Instagram delivery, raw only.
 *
 * Returns how many comments the envelope carried, purely so the log line can
 * say something useful about work that is not yet being done.
 */
export async function persistInboundIg(
  db: PrismaClient,
  payload: WebhookPayload,
): Promise<number> {
  await db.igRawEvent.create({
    data: {
      payload: payload as object,
      signatureOk: true,
      receivedAt: new Date(),
    },
  });
  return (payload.entry ?? []).reduce(
    (n, entry) =>
      n + (entry.changes ?? []).filter((c) => c.field === "comments").length,
    0,
  );
}
