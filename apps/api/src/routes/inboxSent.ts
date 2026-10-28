/**
 * What the shop SENT a customer, as the inbox shows it — and taking it back
 * (owner ask 2026-10-23: *"Display the photo that we sent as well. Can we
 * edit or unsend from the web? I would want to do that in case the AI is
 * wrong."*).
 *
 *   GET  /api/inbox/:phone/sent/:outboxId/photo    the bytes of a sent photo
 *   POST /api/inbox/:phone/sent/:outboxId/unsend   delete for everyone
 *   POST /api/inbox/:phone/sent/:outboxId/edit     {text}: correct a sent text
 *   POST /api/inbox/:phone/picture                 {image, caption?}: send a
 *                                                  picture from staff's own
 *                                                  device (2026-10-27)
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
import { enqueueOutbox, type Prisma, type PrismaClient } from "@nusantara/db";
import type { Logger } from "@nusantara/logging";
import { currentRequestId } from "@nusantara/logging";
import { isWithinWindow } from "@nusantara/whatsapp";
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

/**
 * A picture from staff's own device (owner ask 2026-10-27): what it may be.
 * The `ChatMedia` CHECK holds the same three types and the same ceiling, so
 * a writer that skipped this route would still be refused.
 */
export const PICTURE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PICTURE_MAX_BYTES = 5 * 1024 * 1024;
/** WhatsApp's own limit on an image caption. */
export const PICTURE_CAPTION_MAX = 1_024;
/**
 * The body limit `app.ts` gives this one route: a 5 MB picture is ~6.7 MB as
 * base64, plus the caption and the JSON around them.
 */
export const PICTURE_BODY_LIMIT = "8mb";
/** The path that limit applies to. */
export const PICTURE_PATH = /^\/api\/inbox\/\d{6,20}\/picture$/;

const pictureBody = z
  .object({
    /** A data URL, `data:image/png;base64,…` — how the app sends QC photos. */
    image: z.string().min(1),
    caption: z.string().trim().max(PICTURE_CAPTION_MAX).optional(),
  })
  .strict();

type PictureType = (typeof PICTURE_TYPES)[number];

/** The first bytes each type starts with — a renamed file is not a picture. */
function looksLike(type: PictureType, b: Buffer): boolean {
  if (type === "image/jpeg")
    return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (type === "image/png")
    return (
      b.length > 8 &&
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    );
  return (
    b.length > 12 &&
    b.subarray(0, 4).toString("latin1") === "RIFF" &&
    b.subarray(8, 12).toString("latin1") === "WEBP"
  );
}

/** The picture's bytes and type, or the refusal a person reads. */
export function decodePicture(
  dataUrl: string,
):
  | { ok: true; data: Buffer; contentType: PictureType }
  | { ok: false; status: number; message: string } {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  const type = m?.[1]?.toLowerCase() === "image/jpg" ? "image/jpeg" : m?.[1];
  if (!m || !(PICTURE_TYPES as readonly string[]).includes(type ?? ""))
    return {
      ok: false,
      status: 415,
      message: "Hanya gambar JPG, PNG atau WebP yang bisa dikirim.",
    };
  const data = Buffer.from(m[2] ?? "", "base64");
  if (data.length === 0)
    return { ok: false, status: 400, message: "Gambarnya kosong." };
  if (data.length > PICTURE_MAX_BYTES)
    return {
      ok: false,
      status: 413,
      message: "Gambar terlalu besar (maksimal 5 MB).",
    };
  if (!looksLike(type as PictureType, data))
    return {
      ok: false,
      status: 415,
      message: "Berkas itu bukan gambar JPG, PNG atau WebP.",
    };
  return { ok: true, data, contentType: type as PictureType };
}

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
  requestId: string | null;
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
  requestId: true,
} as const;

/** The payload's fields, read rather than cast — it is a JSON column. */
function payloadOf(p: unknown): {
  to: string | null;
  body: string | null;
  photoId: string | null;
  chatMediaId: string | null;
  caption: string | null;
  inReplyTo: string | null;
  followUp: "visit_reminder" | "lead_nudge" | null;
} {
  const r = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
  const str = (k: string) => (typeof r[k] === "string" ? r[k] : null);
  return {
    to: str("to"),
    body: str("body"),
    photoId: str("photoId"),
    chatMediaId: str("chatMediaId"),
    caption: str("caption"),
    inReplyTo: str("inReplyTo"),
    followUp:
      r["followUp"] === "visit_reminder" || r["followUp"] === "lead_nudge"
        ? r["followUp"]
        : null,
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
  /** WA_IMAGE: a picture staff sent from their own device (2026-10-27). */
  chatMediaId?: string;
  /** WA_IMAGE: the line sent under it, when there was one. */
  caption?: string;
  /** Who sent it: the `ChatMedia` uploader, or the staff on its audit line. */
  sentBy?: string | null;
  /** Queued by the worker (no staff, no request) — drawn as the Bot. */
  fromBot: boolean;
  /** The `WaMessage.id` it answered, when the writer recorded one. */
  inReplyTo: string | null;
  /**
   * The worker's one polite follow-up (2026-10-27): a visit reminder or a
   * quiet lead's nudge. Absent on everything else.
   */
  followUp?: "visit_reminder" | "lead_nudge";
  retractedAt: string | null;
  editedAt: string | null;
  /**
   * Who last edited it / who unsent it (owner ask 2026-10-27), read from the
   * `AuditLog` rows the two routes write. Null for one done before that log
   * existed — the bubble then keeps the bare word.
   */
  editedBy: string | null;
  retractedBy: string | null;
  canEdit: boolean;
  canUnsend: boolean;
}

/** Who did what to a sent item, by outbox id. */
export interface SentAttribution {
  readonly editedBy: string | null;
  readonly retractedBy: string | null;
  /** The staff who uploaded a picture from their own device. */
  readonly sentBy?: string | null;
}

/**
 * Who sent each row, by outbox id (2026-10-28: *"in each message that are
 * sent to user by admin in POS we should give it a name in each bubble"*).
 * A picture from staff's own device names its `ChatMedia` uploader; anything
 * else names the staff member on its `Outbox` CREATE audit line, which every
 * staff send writes (`recordSender`). A row with neither stays unnamed.
 */
export async function uploadersFor(
  db: PrismaClient,
  rows: ReadonlyArray<{ id: string; kind: string; payload: unknown }>,
): Promise<Map<string, string>> {
  const byMedia = new Map<string, string>();
  for (const r of rows) {
    const id = r.kind === "WA_IMAGE" ? payloadOf(r.payload).chatMediaId : null;
    if (id) byMedia.set(id, r.id);
  }
  const out = new Map<string, string>();
  if (rows.length === 0) return out;
  const [media, created] = await Promise.all([
    byMedia.size === 0
      ? Promise.resolve([])
      : db.chatMedia.findMany({
          where: { id: { in: [...byMedia.keys()] } },
          select: { id: true, uploadedBy: { select: { name: true } } },
        }),
    db.auditLog.findMany({
      where: {
        entity: "Outbox",
        action: "CREATE",
        entityId: { in: rows.map((r) => r.id) },
      },
      select: { entityId: true, staff: { select: { name: true } } },
    }),
  ]);
  for (const a of created) if (a.staff?.name) out.set(a.entityId, a.staff.name);
  for (const m of media) out.set(byMedia.get(m.id)!, m.uploadedBy.name);
  return out;
}

/**
 * The audit line that names who sent an outbox row (2026-10-28), written in
 * the same transaction as the row — the picture route's pattern.
 */
export async function recordSender(
  tx: Prisma.TransactionClient,
  input: {
    readonly staffId: string;
    readonly outboxId: string;
    readonly after: Record<string, unknown>;
    readonly requestId: string | null;
    readonly ip: string | null;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      at: new Date(),
      staffId: input.staffId,
      entity: "Outbox",
      entityId: input.outboxId,
      action: "CREATE",
      field: null,
      before: null,
      after: JSON.stringify(input.after),
      requestId: input.requestId,
      ip: input.ip,
    },
  });
}

/**
 * The staff names behind each edit and unsend, newest first per row and
 * action: an edit is `UPDATE` and an unsend `DELETE` on entity `Outbox`.
 * Only rows that were edited or unsent are asked about.
 */
export async function attributionFor(
  db: PrismaClient,
  ids: readonly string[],
): Promise<Map<string, SentAttribution>> {
  const out = new Map<string, SentAttribution>();
  if (ids.length === 0) return out;
  const rows = await db.auditLog.findMany({
    where: {
      entity: "Outbox",
      entityId: { in: [...ids] },
      action: { in: ["UPDATE", "DELETE"] },
    },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: {
      entityId: true,
      action: true,
      staff: { select: { name: true } },
    },
  });
  for (const r of rows) {
    const had = out.get(r.entityId) ?? { editedBy: null, retractedBy: null };
    const name = r.staff?.name ?? null;
    if (!name) continue;
    if (r.action === "UPDATE" && had.editedBy === null)
      out.set(r.entityId, { ...had, editedBy: name });
    else if (r.action === "DELETE" && had.retractedBy === null)
      out.set(r.entityId, { ...had, retractedBy: name });
  }
  return out;
}

function sentJson(
  row: SentRow,
  now: Date,
  baileys: boolean,
  who?: SentAttribution,
): SentItemJson {
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
    ...(row.kind === "WA_IMAGE" && p.chatMediaId !== null
      ? { chatMediaId: p.chatMediaId }
      : {}),
    // Every bubble names its sender (2026-10-28). A row nobody signed for
    // and that no request queued is the worker's — the bot's.
    sentBy: who?.sentBy ?? null,
    fromBot: !who?.sentBy && row.requestId === null,
    ...(row.kind === "WA_IMAGE" && p.caption ? { caption: p.caption } : {}),
    inReplyTo: p.inReplyTo,
    ...(p.followUp ? { followUp: p.followUp } : {}),
    retractedAt: row.retractedAt?.toISOString() ?? null,
    editedAt: row.editedAt?.toISOString() ?? null,
    editedBy: row.editedAt ? (who?.editedBy ?? null) : null,
    retractedBy: row.retractedAt ? (who?.retractedBy ?? null) : null,
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
  opts: {
    baileys: boolean;
    now?: Date;
    /** A cleared chat's instant: only what was queued after it shows. */
    after?: Date | null;
  },
): Promise<SentItemJson[]> {
  const now = opts.now ?? new Date();
  const rows = await db.outbox.findMany({
    where: {
      kind: { in: [...SENT_KINDS] },
      payload: { path: ["to"], equals: phone },
      ...(opts.after ? { createdAt: { gt: opts.after } } : {}),
    },
    select: SENT_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: SENT_ITEMS_SHOWN,
  });
  const [who, uploaders] = await Promise.all([
    attributionFor(
      db,
      rows.filter((r) => r.editedAt || r.retractedAt).map((r) => r.id),
    ),
    uploadersFor(db, rows),
  ]);
  return rows.reverse().map((r) =>
    sentJson(r, now, opts.baileys, {
      editedBy: null,
      retractedBy: null,
      ...who.get(r.id),
      sentBy: uploaders.get(r.id) ?? null,
    }),
  );
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

/** Everything `sentJson` says about who, for one row just written. */
async function whoOf(
  db: PrismaClient,
  row: { id: string; kind: string; payload: unknown },
): Promise<SentAttribution> {
  const [who, uploaders] = await Promise.all([
    attributionFor(db, [row.id]),
    uploadersFor(db, [row]),
  ]);
  return {
    editedBy: null,
    retractedBy: null,
    ...who.get(row.id),
    sentBy: uploaders.get(row.id) ?? null,
  };
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
      const { phone, row } = await load(
        req.params["phone"],
        req.params["outboxId"],
      );
      const { photoId, chatMediaId } = payloadOf(row.payload);
      if (row.kind !== "WA_IMAGE" || (!photoId && !chatMediaId))
        throw notFound("Foto");
      // A QC photo is gone when the unit sold: QC photos are purged at the
      // sale (CLAUDE.md's one sanctioned delete). The page says so; nothing
      // is wrong. A picture from staff's device goes only with the whole
      // conversation, and is served only to the thread it was sent to.
      const photo = photoId
        ? await db.unitNotePhoto.findUnique({
            where: { id: photoId },
            select: { data: true, contentType: true },
          })
        : await db.chatMedia.findFirst({
            where: { id: chatMediaId!, from: phone },
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
                ? p.chatMediaId
                  ? { to: phone, picture: p.chatMediaId, caption: p.caption }
                  : { to: phone, photo: p.photoId }
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
      res.json(sentJson(saved, at, baileys, await whoOf(db, saved)));
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
      res.json(sentJson(saved, at, baileys, await whoOf(db, saved)));
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/inbox/:phone/picture — a picture from staff's own computer or
   * phone, not a unit's QC photo (owner ask 2026-10-27). `{ image, caption? }`,
   * the image a data URL of a JPG, PNG or WebP of at most 5 MB.
   *
   * Refused up front when the 24-hour window has closed — the same rule the
   * reply box is held to — so staff are told now rather than seeing a failed
   * row later. Then ONE transaction, with no network in it: the `ChatMedia`
   * row, the WA_IMAGE `Outbox` row naming it (`chatMediaId`), and the
   * `AuditLog` line saying who (entity `Outbox`, CREATE — the same entity an
   * unsend of it is logged under). The worker sends it like a QC photo.
   *
   * Any signed-in staff may send one, as any may reply.
   */
  router.post("/:phone/picture", async (req, res, next) => {
    try {
      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");
      const phone = phoneParam.safeParse(req.params["phone"]);
      if (!phone.success)
        throw new ApiError(400, "VALIDASI", "Nomor WhatsApp tidak valid.");
      const body = pictureBody.safeParse(req.body);
      if (!body.success)
        throw new ApiError(400, "VALIDASI", "Gambar tidak valid.", {
          field: "image",
        });
      const picture = decodePicture(body.data.image);
      if (!picture.ok)
        throw new ApiError(picture.status, "VALIDASI", picture.message, {
          field: "image",
        });
      const caption = body.data.caption || undefined;

      const latest = await db.waMessage.findFirst({
        where: { from: phone.data, direction: "IN" },
        orderBy: { ts: "desc" },
        select: { id: true, ts: true },
      });
      if (!latest) throw notFound("Percakapan");
      if (!isWithinWindow(latest.ts, now()))
        throw new ApiError(
          409,
          "KONFLIK",
          "Jendela 24 jam WhatsApp sudah tutup — gambar tidak akan terkirim.",
        );

      const at = now();
      const saved = await db.$transaction(async (tx) => {
        const media = await tx.chatMedia.create({
          data: {
            from: phone.data,
            data: new Uint8Array(picture.data),
            contentType: picture.contentType,
            size: picture.data.length,
            uploadedById: staff.id,
            createdAt: at,
          },
          select: { id: true },
        });
        const queued = await enqueueOutbox(tx, {
          kind: "WA_IMAGE",
          payload: {
            to: phone.data,
            chatMediaId: media.id,
            ...(caption ? { caption } : {}),
            inReplyTo: latest.id,
          },
          requestId: currentRequestId() ?? null,
        });
        await tx.auditLog.create({
          data: {
            at,
            staffId: staff.id,
            entity: "Outbox",
            entityId: queued.id,
            action: "CREATE",
            field: null,
            before: null,
            after: JSON.stringify({
              to: phone.data,
              picture: media.id,
              contentType: picture.contentType,
              size: picture.data.length,
              ...(caption ? { caption } : {}),
            }),
            requestId: currentRequestId() ?? req.get("x-request-id") ?? null,
            ip: req.ip ?? null,
          },
        });
        return tx.outbox.findUniqueOrThrow({
          where: { id: queued.id },
          select: SENT_SELECT,
        });
      });
      res
        .status(201)
        .json(sentJson(saved, at, baileys, await whoOf(db, saved)));
    } catch (err) {
      next(err);
    }
  });
}
