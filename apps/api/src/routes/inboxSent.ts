/**
 * What the shop SENT a customer, as the inbox shows it — and taking it back
 * (owner ask 2026-10-23: *"Display the photo that we sent as well. Can we
 * edit or unsend from the web? I would want to do that in case the AI is
 * wrong."*).
 *
 *   GET  /api/inbox/:phone/sent/:outboxId/photo    the bytes of a sent photo
 *   POST /api/inbox/:phone/sent/:outboxId/unsend   delete for everyone
 *   POST /api/inbox/:phone/sent/:outboxId/edit     {text}: correct a sent text
 *
 * The sent items themselves ride on `GET /api/inbox/:phone` (`sentItemsFor`).
 *
 * ## What WhatsApp allows, and only through the linked device
 *
 * A message can be deleted for everyone for about two days after it went out
 * and a TEXT edited for fifteen minutes. Only the Baileys transport can do
 * either — Meta's Cloud API has neither call — so with no gateway configured
 * (`config.waGateway` null: the Cloud API shop) nothing is offered and both
 * routes answer 409. Both limits are checked here, against `Outbox.sentAt`,
 * before the gateway is asked: WhatsApp would accept a late delete and then
 * quietly not honour it, which reads to staff as "unsent" while the customer
 * still has it.
 *
 * ## The order of a write
 *
 * Validate, ask the gateway, and only THEN — in one transaction — stamp the
 * outbox row (`retractedAt`, or `editedAt` with the new `payload.body`), carry
 * an edit onto the `WaMessage.replyText` it answered when that still holds
 * the old text, and write the `AuditLog` row naming who. No network I/O
 * happens inside a transaction (CLAUDE.md). A gateway that refused means
 * nothing was written; a transaction that then lost a race to a colleague
 * pressing the same button is a 409, and the message is unsent either way.
 *
 * Any signed-in staff may do either (owner answer, 2026-10-23); the audit row
 * is what says who.
 */

import { type Router } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import { currentRequestId } from "@nusantara/logging";
import { ApiError, notFound } from "../errors.js";
import { callGateway, type GatewayTarget } from "../gatewayClient.js";

/** WhatsApp's edit window for a sent text. */
export const EDIT_WINDOW_MS = 15 * 60_000;
/** WhatsApp's delete-for-everyone window, taken at its usual ~48 hours. */
export const UNSEND_WINDOW_MS = 48 * 60 * 60_000;
/** How many sent items a conversation carries — the newest. */
export const SENT_ITEMS_SHOWN = 100;

export interface InboxSentDeps {
  readonly gateway: GatewayTarget | null;
  readonly logger: Logger;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

const phoneParam = z
  .string()
  .trim()
  .regex(/^\d{6,20}$/);
const idParam = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/);
const editBody = z.object({ text: z.string().trim().min(1).max(4_000) });

const SENT_KINDS = ["WA_REPLY", "WA_IMAGE"] as const;

/**
 * An id that names a message the linked device can address. A Cloud API id
 * (`wamid.…`, from before the shop moved to Baileys) cannot be edited or
 * deleted by any device, and `wa-gateway-…` is the gateway's stand-in when
 * Baileys returned no key at all.
 */
export function addressableId(id: string | null | undefined): id is string {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    !id.startsWith("wamid.") &&
    !id.startsWith("wa-gateway-")
  );
}

interface SentRow {
  id: string;
  kind: string;
  status: string;
  payload: unknown;
  createdAt: Date;
  sentAt: Date | null;
  providerMessageId: string | null;
  retractedAt: Date | null;
  editedAt: Date | null;
}

const SENT_SELECT = {
  id: true,
  kind: true,
  status: true,
  payload: true,
  createdAt: true,
  sentAt: true,
  providerMessageId: true,
  retractedAt: true,
  editedAt: true,
} as const;

/** The payload's fields, read rather than cast — it is a JSON column. */
function payloadOf(p: unknown): {
  to: string | null;
  body: string | null;
  photoId: string | null;
  inReplyTo: string | null;
} {
  const r = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
  const str = (k: string) => (typeof r[k] === "string" ? r[k] : null);
  return {
    to: str("to"),
    body: str("body"),
    photoId: str("photoId"),
    inReplyTo: str("inReplyTo"),
  };
}

/** Why a sent item cannot be unsent, or null when it can. */
function unsendRefusal(
  row: SentRow,
  now: Date,
  baileys: boolean,
): string | null {
  if (!baileys)
    return "Menarik pesan hanya bisa lewat WhatsApp yang ditautkan ke POS — Cloud API tidak mendukungnya.";
  if (row.status !== "SENT") return "Pesan ini belum terkirim.";
  if (row.retractedAt) return "Pesan ini sudah ditarik.";
  if (!addressableId(row.providerMessageId))
    return "Pesan ini terkirim sebelum fitur ini ada, jadi tidak bisa ditarik atau diubah.";
  if (!row.sentAt || now.getTime() - row.sentAt.getTime() > UNSEND_WINDOW_MS)
    return "Sudah lewat 48 jam — WhatsApp tidak lagi mengizinkan pesan ini ditarik.";
  return null;
}

/** Why a sent item cannot be edited, or null when it can. */
function editRefusal(row: SentRow, now: Date, baileys: boolean): string | null {
  if (!baileys)
    return "Mengubah pesan hanya bisa lewat WhatsApp yang ditautkan ke POS — Cloud API tidak mendukungnya.";
  if (row.kind !== "WA_REPLY") return "Hanya pesan teks yang bisa diubah.";
  if (row.status !== "SENT") return "Pesan ini belum terkirim.";
  if (row.retractedAt) return "Pesan ini sudah ditarik.";
  if (!addressableId(row.providerMessageId))
    return "Pesan ini terkirim sebelum fitur ini ada, jadi tidak bisa ditarik atau diubah.";
  if (!row.sentAt || now.getTime() - row.sentAt.getTime() > EDIT_WINDOW_MS)
    return "Sudah lewat 15 menit — WhatsApp tidak lagi mengizinkan pesan ini diubah.";
  return null;
}

export interface SentItemJson {
  id: string;
  kind: "WA_REPLY" | "WA_IMAGE";
  status: string;
  createdAt: string;
  sentAt: string | null;
  /** WA_REPLY: the text as the customer has it now. */
  body?: string;
  /** WA_IMAGE: the photo, drawn through `/sent/:id/photo`. */
  photoId?: string;
  /** The `WaMessage.id` it answered, when the writer recorded one. */
  inReplyTo: string | null;
  retractedAt: string | null;
  editedAt: string | null;
  canEdit: boolean;
  canUnsend: boolean;
}

function sentJson(row: SentRow, now: Date, baileys: boolean): SentItemJson {
  const p = payloadOf(row.payload);
  return {
    id: row.id,
    kind: row.kind as SentItemJson["kind"],
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    ...(row.kind === "WA_REPLY" && p.body !== null ? { body: p.body } : {}),
    ...(row.kind === "WA_IMAGE" && p.photoId !== null
      ? { photoId: p.photoId }
      : {}),
    inReplyTo: p.inReplyTo,
    retractedAt: row.retractedAt?.toISOString() ?? null,
    editedAt: row.editedAt?.toISOString() ?? null,
    canEdit: editRefusal(row, now, baileys) === null,
    canUnsend: unsendRefusal(row, now, baileys) === null,
  };
}

/**
 * The thread's sent texts and photos, oldest first — the newest
 * `SENT_ITEMS_SHOWN` of them. Matched on `payload.to`, which every writer of
 * a WA_REPLY / WA_IMAGE sets to the thread's wa_id.
 */
export async function sentItemsFor(
  db: PrismaClient,
  phone: string,
  opts: { baileys: boolean; now?: Date },
): Promise<SentItemJson[]> {
  const now = opts.now ?? new Date();
  const rows = await db.outbox.findMany({
    where: {
      kind: { in: [...SENT_KINDS] },
      payload: { path: ["to"], equals: phone },
    },
    select: SENT_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: SENT_ITEMS_SHOWN,
  });
  return rows.reverse().map((r) => sentJson(r, now, opts.baileys));
}

/**
 * Which sent text a reply bubble IS: the newest WA_REPLY that answered that
 * message (`inReplyTo`) with exactly the text the row holds. An edit carries
 * the new text onto both, so the pair still matches afterwards. A reply with
 * no such row — one sent before the outbox kept `inReplyTo`, or one whose
 * text was overwritten by a later reply on the same message — has none, and
 * its bubble simply has no menu.
 */
export function replyOutboxIds(
  messages: ReadonlyArray<{ id: string; replyText: string | null }>,
  sent: readonly SentItemJson[],
): Map<string, string> {
  const out = new Map<string, string>();
  const claimed = new Set<string>();
  for (const m of messages) {
    if (!m.replyText) continue;
    for (let i = sent.length - 1; i >= 0; i -= 1) {
      const s = sent[i]!;
      if (
        s.kind === "WA_REPLY" &&
        s.inReplyTo === m.id &&
        s.body === m.replyText &&
        !claimed.has(s.id)
      ) {
        out.set(m.id, s.id);
        claimed.add(s.id);
        break;
      }
    }
  }
  return out;
}

export function registerInboxSent(
  router: Router,
  db: PrismaClient,
  deps: InboxSentDeps,
): void {
  const now = deps.now ?? (() => new Date());
  const baileys = deps.gateway !== null;

  /** The row, refused as not found unless it is a sent item of this phone. */
  const load = async (rawPhone: unknown, rawId: unknown) => {
    const phone = phoneParam.safeParse(rawPhone);
    if (!phone.success)
      throw new ApiError(400, "VALIDASI", "Nomor WhatsApp tidak valid.");
    const id = idParam.safeParse(rawId);
    if (!id.success) throw notFound("Pesan");
    const row = await db.outbox.findUnique({
      where: { id: id.data },
      select: SENT_SELECT,
    });
    if (
      !row ||
      !(SENT_KINDS as readonly string[]).includes(row.kind) ||
      payloadOf(row.payload).to !== phone.data
    )
      throw notFound("Pesan");
    return { phone: phone.data, row };
  };

  /** A gateway answer that was not a yes, in the reader's terms. */
  const gatewayRefused = (status: number) => {
    if (status === 503)
      return new ApiError(
        503,
        "GATEWAY_MATI",
        "Nomor WhatsApp sedang tidak tertaut ke server. Coba lagi setelah tersambung.",
      );
    deps.logger.error(
      { evt: "inbox.sent.gateway_refused", ctx: { status } },
      status === 401
        ? "the WhatsApp gateway refused the API's secret — WA_GATEWAY_SECRET differs between api.env and wa-gateway.env"
        : "the WhatsApp gateway refused an unsend or an edit",
    );
    return new ApiError(
      503,
      "GATEWAY_MATI",
      "WhatsApp tidak menerima permintaan itu. Coba lagi sebentar lagi.",
    );
  };

  router.get("/:phone/sent/:outboxId/photo", async (req, res, next) => {
    try {
      const { row } = await load(req.params["phone"], req.params["outboxId"]);
      const photoId = payloadOf(row.payload).photoId;
      if (row.kind !== "WA_IMAGE" || !photoId) throw notFound("Foto");
      // Gone when the unit sold: QC photos are purged at the sale (CLAUDE.md's
      // one sanctioned delete). The page says so; nothing is wrong.
      const photo = await db.unitNotePhoto.findUnique({
        where: { id: photoId },
        select: { data: true, contentType: true },
      });
      if (!photo?.data || photo.data.length === 0) throw notFound("Foto");
      res.set("Content-Type", photo.contentType ?? "image/jpeg");
      res.set("Cache-Control", "private, max-age=86400");
      res.send(Buffer.from(photo.data));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:phone/sent/:outboxId/unsend", async (req, res, next) => {
    try {
      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");
      const { phone, row } = await load(
        req.params["phone"],
        req.params["outboxId"],
      );
      const refusal = unsendRefusal(row, now(), baileys);
      if (refusal) throw new ApiError(409, "KONFLIK", refusal);

      const r = await callGateway({
        gateway: deps.gateway,
        logger: deps.logger,
        method: "POST",
        path: "/messages/revoke",
        body: { to: phone, id: row.providerMessageId },
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      });
      if (!r.ok)
        throw new ApiError(
          503,
          "GATEWAY_MATI",
          "Gateway WhatsApp tidak berjalan di server.",
        );
      if (r.status !== 200) throw gatewayRefused(r.status);

      const at = now();
      const p = payloadOf(row.payload);
      const saved = await db.$transaction(async (tx) => {
        const { count } = await tx.outbox.updateMany({
          where: { id: row.id, retractedAt: null },
          data: { retractedAt: at },
        });
        if (count !== 1)
          throw new ApiError(409, "KONFLIK", "Pesan ini sudah ditarik.");
        await tx.auditLog.create({
          data: {
            at,
            staffId: staff.id,
            entity: "Outbox",
            entityId: row.id,
            action: "DELETE",
            field: null,
            before: JSON.stringify(
              row.kind === "WA_IMAGE"
                ? { to: phone, photo: p.photoId }
                : { to: phone, text: p.body },
            ),
            after: null,
            requestId: currentRequestId() ?? req.get("x-request-id") ?? null,
            ip: req.ip ?? null,
          },
        });
        return tx.outbox.findUniqueOrThrow({
          where: { id: row.id },
          select: SENT_SELECT,
        });
      });
      res.json(sentJson(saved, at, baileys));
    } catch (err) {
      next(err);
    }
  });

  router.post("/:phone/sent/:outboxId/edit", async (req, res, next) => {
    try {
      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");
      const { phone, row } = await load(
        req.params["phone"],
        req.params["outboxId"],
      );
      const parsed = editBody.safeParse(req.body);
      if (!parsed.success)
        throw new ApiError(400, "VALIDASI", "Pesan tidak boleh kosong.", {
          field: "text",
        });
      const refusal = editRefusal(row, now(), baileys);
      if (refusal) throw new ApiError(409, "KONFLIK", refusal);
      const p = payloadOf(row.payload);
      const text = parsed.data.text;
      if (text === p.body)
        throw new ApiError(400, "VALIDASI", "Teksnya belum diubah.", {
          field: "text",
        });

      const r = await callGateway({
        gateway: deps.gateway,
        logger: deps.logger,
        method: "POST",
        path: "/messages/edit",
        body: { to: phone, id: row.providerMessageId, text },
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      });
      if (!r.ok)
        throw new ApiError(
          503,
          "GATEWAY_MATI",
          "Gateway WhatsApp tidak berjalan di server.",
        );
      if (r.status !== 200) throw gatewayRefused(r.status);

      const at = now();
      const payload = {
        ...(row.payload as Record<string, unknown>),
        body: text,
      } as Prisma.InputJsonValue;
      const saved = await db.$transaction(async (tx) => {
        const { count } = await tx.outbox.updateMany({
          where: { id: row.id, retractedAt: null },
          data: { payload, editedAt: at },
        });
        if (count !== 1)
          throw new ApiError(409, "KONFLIK", "Pesan ini sudah ditarik.");
        // The bubble the inbox draws is the row's replyText. Only while it
        // still says what was sent: a later reply on the same message has
        // overwritten it, and that one is not what was edited.
        if (p.inReplyTo && p.body !== null) {
          await tx.waMessage.updateMany({
            where: { id: p.inReplyTo, from: phone, replyText: p.body },
            data: { replyText: text },
          });
        }
        await tx.auditLog.create({
          data: {
            at,
            staffId: staff.id,
            entity: "Outbox",
            entityId: row.id,
            action: "UPDATE",
            field: "text",
            before: JSON.stringify({ text: p.body }),
            after: JSON.stringify({ text }),
            requestId: currentRequestId() ?? req.get("x-request-id") ?? null,
            ip: req.ip ?? null,
          },
        });
        return tx.outbox.findUniqueOrThrow({
          where: { id: row.id },
          select: SENT_SELECT,
        });
      });
      res.json(sentJson(saved, at, baileys));
    } catch (err) {
      next(err);
    }
  });
}
