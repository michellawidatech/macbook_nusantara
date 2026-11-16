/**
 * `/api/instagram` — the Comments tab and the owner's Instagram card
 * (2026-11-16, docs/superpowers/specs/2026-11-16-instagram-design.md).
 *
 * Every action writes the comment, its `Outbox` send intent and an `AuditLog`
 * line with who, in ONE transaction; the worker's Instagram pass does the
 * talking to Meta (no network I/O inside a transaction). The DMs themselves
 * are `/api/inbox` threads under `ig:<IGSID>` — not here.
 */

import { Router, type RequestHandler, type Request } from "express";
import { z } from "zod";
import {
  enqueueOutbox,
  type Prisma,
  type PrismaClient,
  type Tx,
} from "@nusantara/db";
import { currentRequestId } from "@nusantara/logging";
import {
  commentStatusAfterUnhide,
  igPrivateReplyOpen,
  IG_TEXT_MAX_BYTES,
  utf8Length,
} from "@nusantara/domain";
import { ApiError, notFound } from "../errors.js";

export const IG_SETTINGS_ID = "singleton";
export const IG_CONNECTION_ID = "singleton";

/** What a shop that never opened the card gets. Auto-reply is OFF. */
export const DEFAULT_IG_SETTINGS = {
  autoReply: false,
  replyTemplate: "Cek DM ya kak 😊",
  dmTemplate:
    "Halo kak, terima kasih sudah komen 😊 Ada yang bisa kami bantu? Unit yang kakak lihat masih bisa kami cek ya.",
} as const;

const STATUSES = ["NEW", "REPLIED", "DMED", "DONE", "HIDDEN"] as const;

const listQuery = z.object({
  status: z.enum(STATUSES).optional(),
  media: z.string().trim().min(1).max(64).optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const text = z
  .string()
  .trim()
  .min(1)
  .refine((t) => utf8Length(t) <= IG_TEXT_MAX_BYTES, "too long");
const textBody = z.object({ text });
const hideBody = z.object({ hidden: z.boolean() });
const doneBody = z.object({ done: z.boolean().default(true) });
const settingsBody = z.object({
  autoReply: z.boolean(),
  replyTemplate: z.string().trim().max(300),
  dmTemplate: z
    .string()
    .trim()
    .max(1000)
    .refine((t) => utf8Length(t) <= IG_TEXT_MAX_BYTES, "too long"),
});

export interface InstagramRouterDeps {
  readonly db: PrismaClient;
  readonly requireOwner: RequestHandler;
  /** Whether Meta approved the Human Agent feature (`IG_HUMAN_AGENT=1`). */
  readonly igHumanAgent?: boolean;
  readonly now?: () => Date;
}

const COMMENT_SELECT = {
  id: true,
  igCommentId: true,
  fromId: true,
  fromUsername: true,
  text: true,
  parentId: true,
  ts: true,
  status: true,
  replyText: true,
  replyCommentId: true,
  repliedByAgent: true,
  repliedAt: true,
  dmText: true,
  dmSentAt: true,
  repliedBy: { select: { name: true } },
  dmSentBy: { select: { name: true } },
  media: {
    select: {
      id: true,
      igMediaId: true,
      caption: true,
      mediaType: true,
      permalink: true,
      thumbnailUrl: true,
      timestamp: true,
    },
  },
} satisfies Prisma.IgCommentSelect;

type CommentRow = Prisma.IgCommentGetPayload<{ select: typeof COMMENT_SELECT }>;

function commentJson(c: CommentRow, now: Date) {
  return {
    id: c.id,
    igCommentId: c.igCommentId,
    fromId: c.fromId,
    username: c.fromUsername,
    text: c.text,
    isReply: c.parentId !== null,
    at: c.ts.toISOString(),
    status: c.status,
    reply: c.replyText
      ? {
          text: c.replyText,
          at: c.repliedAt?.toISOString() ?? null,
          byAgent: c.repliedByAgent,
          by: c.repliedBy?.name ?? null,
          posted: c.replyCommentId !== null,
        }
      : null,
    dm: c.dmText
      ? {
          text: c.dmText,
          at: c.dmSentAt?.toISOString() ?? null,
          by: c.dmSentBy?.name ?? null,
          byAgent: c.dmSentBy === null,
        }
      : null,
    /** One private DM per comment, within 7 days of it. */
    canPrivateReply: igPrivateReplyOpen(c.ts, c.dmSentAt, now),
    media: {
      id: c.media.id,
      igMediaId: c.media.igMediaId,
      caption: c.media.caption,
      mediaType: c.media.mediaType,
      permalink: c.media.permalink,
      thumbnailUrl: c.media.thumbnailUrl,
      at: c.media.timestamp?.toISOString() ?? null,
    },
  };
}

async function audit(
  tx: Tx,
  req: Request,
  at: Date,
  entity: string,
  entityId: string,
  action: "CREATE" | "UPDATE",
  before: unknown,
  after: unknown,
) {
  await tx.auditLog.create({
    data: {
      at,
      staffId: req.staff!.id,
      entity,
      entityId,
      action,
      field: null,
      before: before === null ? null : JSON.stringify(before),
      after: JSON.stringify(after),
      requestId: currentRequestId() ?? req.get("x-request-id") ?? null,
      ip: req.ip ?? null,
    },
  });
}

export function instagramRouter(deps: InstagramRouterDeps): Router {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const router = Router();

  const staffOf = (req: Request) => {
    if (!req.staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");
    return req.staff;
  };

  /** GET /api/instagram/comments — newest first, filtered. */
  router.get("/comments", async (req, res, next) => {
    try {
      const q = listQuery.safeParse(req.query);
      if (!q.success)
        throw new ApiError(400, "VALIDASI", "Filter tidak valid.");
      const { status, media, q: search, limit } = q.data;
      const rows = await db.igComment.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(media ? { mediaId: media } : {}),
          ...(search
            ? {
                OR: [
                  { text: { contains: search, mode: "insensitive" } },
                  { fromUsername: { contains: search, mode: "insensitive" } },
                  {
                    media: {
                      caption: { contains: search, mode: "insensitive" },
                    },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ ts: "desc" }, { id: "desc" }],
        take: limit,
        select: COMMENT_SELECT,
      });
      const at = now();
      const counts = await db.igComment.groupBy({
        by: ["status"],
        _count: { _all: true },
      });
      res.json({
        comments: rows.map((r) => commentJson(r, at)),
        counts: Object.fromEntries(
          STATUSES.map((s) => [
            s,
            counts.find((c) => c.status === s)?._count._all ?? 0,
          ]),
        ),
      });
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/instagram/media — the posts that have comments, for the filter. */
  router.get("/media", async (_req, res, next) => {
    try {
      const posts = await db.igMedia.findMany({
        where: { comments: { some: {} } },
        orderBy: [{ timestamp: "desc" }, { fetchedAt: "desc" }],
        take: 200,
        select: {
          id: true,
          igMediaId: true,
          caption: true,
          permalink: true,
          thumbnailUrl: true,
          _count: { select: { comments: true } },
        },
      });
      res.json({
        media: posts.map((p) => ({
          id: p.id,
          igMediaId: p.igMediaId,
          caption: p.caption,
          permalink: p.permalink,
          thumbnailUrl: p.thumbnailUrl,
          comments: p._count.comments,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  /** The comment, or 404. */
  const load = async (id: unknown) => {
    const c = await db.igComment.findUnique({
      where: { id: String(id ?? "") },
      select: COMMENT_SELECT,
    });
    if (!c) throw notFound("Komentar");
    return c;
  };
  const reload = async (id: string) =>
    commentJson(
      await db.igComment.findUniqueOrThrow({
        where: { id },
        select: COMMENT_SELECT,
      }),
      now(),
    );

  /** POST /api/instagram/comments/:id/reply — a public reply under it. */
  router.post("/comments/:id/reply", async (req, res, next) => {
    try {
      const staff = staffOf(req);
      const body = textBody.safeParse(req.body);
      if (!body.success)
        throw new ApiError(400, "VALIDASI", "Balasan tidak boleh kosong.", {
          field: "text",
        });
      const c = await load(req.params["id"]);
      const at = now();
      await db.$transaction(async (tx) => {
        await tx.igComment.update({
          where: { id: c.id },
          data: {
            replyText: body.data.text,
            replyCommentId: null,
            repliedById: staff.id,
            repliedByAgent: false,
            repliedAt: at,
            status:
              c.status === "HIDDEN"
                ? "HIDDEN"
                : c.dmSentAt
                  ? "DMED"
                  : "REPLIED",
          },
        });
        const queued = await enqueueOutbox(tx, {
          kind: "IG_REPLY",
          payload: { commentId: c.igCommentId, body: body.data.text },
          requestId: currentRequestId() ?? null,
        });
        await audit(tx, req, at, "IgComment", c.id, "UPDATE", null, {
          reply: body.data.text,
          outboxId: queued.id,
        });
      });
      res.status(201).json(await reload(c.id));
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/instagram/comments/:id/private-reply — the one DM it allows. */
  router.post("/comments/:id/private-reply", async (req, res, next) => {
    try {
      const staff = staffOf(req);
      const body = textBody.safeParse(req.body);
      if (!body.success)
        throw new ApiError(400, "VALIDASI", "Pesan tidak boleh kosong.", {
          field: "text",
        });
      const c = await load(req.params["id"]);
      const at = now();
      if (!igPrivateReplyOpen(c.ts, c.dmSentAt, at))
        throw new ApiError(
          409,
          "KONFLIK",
          c.dmSentAt
            ? "Komentar ini sudah dibalas lewat DM — Instagram hanya mengizinkan satu."
            : "Sudah lewat 7 hari — Instagram tidak lagi mengizinkan DM untuk komentar ini.",
        );
      await db.$transaction(async (tx) => {
        await tx.igComment.update({
          where: { id: c.id },
          data: {
            dmText: body.data.text,
            dmSentById: staff.id,
            dmSentAt: at,
            status: c.status === "HIDDEN" ? "HIDDEN" : "DMED",
          },
        });
        const queued = await enqueueOutbox(tx, {
          kind: "IG_PRIVATE_REPLY",
          payload: { commentId: c.igCommentId, body: body.data.text },
          requestId: currentRequestId() ?? null,
        });
        await audit(tx, req, at, "IgComment", c.id, "UPDATE", null, {
          privateReply: body.data.text,
          outboxId: queued.id,
        });
      });
      res.status(201).json(await reload(c.id));
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/instagram/comments/:id/hide — `{hidden}`. */
  router.post("/comments/:id/hide", async (req, res, next) => {
    try {
      staffOf(req);
      const body = hideBody.safeParse(req.body);
      if (!body.success)
        throw new ApiError(400, "VALIDASI", "Permintaan tidak valid.");
      const c = await load(req.params["id"]);
      const at = now();
      const status = body.data.hidden
        ? "HIDDEN"
        : commentStatusAfterUnhide({
            replyText: c.replyText,
            dmSentAt: c.dmSentAt,
          });
      await db.$transaction(async (tx) => {
        await tx.igComment.update({ where: { id: c.id }, data: { status } });
        const queued = await enqueueOutbox(tx, {
          kind: "IG_HIDE",
          payload: { commentId: c.igCommentId, hidden: body.data.hidden },
          requestId: currentRequestId() ?? null,
        });
        await audit(
          tx,
          req,
          at,
          "IgComment",
          c.id,
          "UPDATE",
          { status: c.status },
          { status, outboxId: queued.id },
        );
      });
      res.json(await reload(c.id));
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/instagram/comments/:id/done — `{done}` (false reopens it). */
  router.post("/comments/:id/done", async (req, res, next) => {
    try {
      staffOf(req);
      const body = doneBody.safeParse(req.body ?? {});
      if (!body.success)
        throw new ApiError(400, "VALIDASI", "Permintaan tidak valid.");
      const c = await load(req.params["id"]);
      if (c.status === "HIDDEN")
        throw new ApiError(
          409,
          "KONFLIK",
          "Komentar ini disembunyikan — tampilkan dulu.",
        );
      const at = now();
      const status = body.data.done
        ? "DONE"
        : commentStatusAfterUnhide({
            replyText: c.replyText,
            dmSentAt: c.dmSentAt,
          });
      await db.$transaction(async (tx) => {
        await tx.igComment.update({ where: { id: c.id }, data: { status } });
        await audit(
          tx,
          req,
          at,
          "IgComment",
          c.id,
          "UPDATE",
          { status: c.status },
          { status },
        );
      });
      res.json(await reload(c.id));
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/instagram/settings — the auto-reply switch and its templates. */
  router.get("/settings", async (_req, res, next) => {
    try {
      const row = await db.igSettings.findUnique({
        where: { id: IG_SETTINGS_ID },
      });
      res.json({
        autoReply: row?.autoReply ?? DEFAULT_IG_SETTINGS.autoReply,
        replyTemplate: row?.replyTemplate ?? DEFAULT_IG_SETTINGS.replyTemplate,
        dmTemplate: row?.dmTemplate ?? DEFAULT_IG_SETTINGS.dmTemplate,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      });
    } catch (err) {
      next(err);
    }
  });

  /** PUT /api/instagram/settings — the owner's. */
  router.put("/settings", deps.requireOwner, async (req, res, next) => {
    try {
      const body = settingsBody.safeParse(req.body);
      if (!body.success)
        throw new ApiError(400, "VALIDASI", "Pengaturan tidak valid.");
      if (body.data.autoReply && body.data.replyTemplate === "")
        throw new ApiError(
          400,
          "VALIDASI",
          "Balasan komentar tidak boleh kosong selama balasan otomatis menyala.",
          { field: "replyTemplate" },
        );
      const at = now();
      const before = await db.igSettings.findUnique({
        where: { id: IG_SETTINGS_ID },
      });
      const saved = await db.$transaction(async (tx) => {
        const row = await tx.igSettings.upsert({
          where: { id: IG_SETTINGS_ID },
          create: { id: IG_SETTINGS_ID, ...body.data, updatedAt: at },
          update: { ...body.data, updatedAt: at },
        });
        await audit(
          tx,
          req,
          at,
          "IgSettings",
          IG_SETTINGS_ID,
          before ? "UPDATE" : "CREATE",
          before
            ? {
                autoReply: before.autoReply,
                replyTemplate: before.replyTemplate,
                dmTemplate: before.dmTemplate,
              }
            : null,
          body.data,
        );
        return row;
      });
      res.json({
        autoReply: saved.autoReply,
        replyTemplate: saved.replyTemplate,
        dmTemplate: saved.dmTemplate,
        updatedAt: saved.updatedAt.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/instagram/connection — the owner's card: the account the worker
   * last saw, the token's expiry, and the newest delivery from Meta. The API
   * never holds the token; the worker writes `IgConnection`.
   */
  router.get("/connection", deps.requireOwner, async (_req, res, next) => {
    try {
      const [row, last, threads] = await Promise.all([
        db.igConnection.findUnique({ where: { id: IG_CONNECTION_ID } }),
        db.igRawEvent.findFirst({
          orderBy: { receivedAt: "desc" },
          select: { receivedAt: true },
        }),
        db.igContact.count(),
      ]);
      res.json({
        connected: Boolean(row?.username && !row.lastError),
        account: row
          ? {
              igUserId: row.igUserId,
              username: row.username,
              name: row.name,
              accountType: row.accountType,
              checkedAt: row.checkedAt?.toISOString() ?? null,
              lastError: row.lastError,
              tokenRefreshedAt: row.tokenRefreshedAt?.toISOString() ?? null,
              tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
            }
          : null,
        lastEventAt: last?.receivedAt.toISOString() ?? null,
        senders: threads,
        humanAgent: deps.igHumanAgent === true,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
