/**
 * The inbox endpoints chatbot v2's Chat tab adds (2026-10-15):
 * the read marker, the 🔥 lead, the customer profile and its facts, the
 * open holds, and "attach media". Mounted by `inboxRouter` on its own router,
 * so every route here sits behind the same staff session.
 *
 * The contract is `.context/chatbot-v2-api-contract.md`; the UI is
 * `apps/web/src/routes/chatbot`.
 */

import { type Router } from "express";
import { z } from "zod";
import { enqueueOutbox, Prisma, type PrismaClient } from "@nusantara/db";
import { isWithinWindow } from "@nusantara/whatsapp";
import {
  dispatchTool,
  isLead,
  phoneForms,
  resetPointFor,
  resetPointsFor,
  visibleProfile,
} from "@nusantara/agent";
import { realName } from "@nusantara/domain";
import { ApiError, notFound } from "../errors.js";

/** How many units one "attach media" may carry. */
export const MAX_MEDIA_UNITS = 5;

/**
 * The line sent before a unit's photos (owner's wording, 2026-10-23: *"berikut
 * untuk photo {unit name} nya ya kakk, boleh dilihat lihat dulu"*).
 */
export function photoCaption(unit: string): string {
  return `Berikut foto ${unit} nya ya kak, boleh dilihat-lihat dulu 😊`;
}

const phoneParam = z
  .string()
  .trim()
  .regex(/^\d{6,20}$/, "a wa_id is digits only");

const money = z
  .union([
    z
      .string()
      .trim()
      .regex(/^\d{1,13}$/),
    z.null(),
  ])
  .optional();
const text = (max: number) =>
  z.union([z.string().trim().max(max), z.null()]).optional();

const profileBody = z
  .object({
    name: text(80),
    ageEstimate: text(20),
    occupation: text(80),
    budgetMin: money,
    budgetMax: money,
    useCase: text(160),
    currentDevice: text(120),
    preference: text(200),
  })
  .strict();

const factBody = z
  .object({
    kind: z.enum(["USAGE", "APP", "PREFERENCE", "ABOUT"]),
    value: z.string().trim().min(1).max(120),
  })
  .strict();

export type ProfileJson = {
  name: string | null;
  ageEstimate: string | null;
  occupation: string | null;
  budgetMin: string | null;
  budgetMax: string | null;
  useCase: string | null;
  currentDevice: string | null;
  preference: string | null;
  facts: Array<{
    id: string;
    kind: "USAGE" | "APP" | "PREFERENCE" | "ABOUT";
    value: string;
    source: "BOT" | "STAFF";
  }>;
  updatedAt: string;
};

/** The profile as the Chat tab reads it, or null before anybody said anything. */
export async function profileJson(
  db: PrismaClient,
  phone: string,
): Promise<ProfileJson | null> {
  const p = await db.customerProfile.findUnique({
    where: { from: phone },
    select: {
      name: true,
      ageEstimate: true,
      occupation: true,
      budgetMin: true,
      budgetMax: true,
      budget: true,
      useCase: true,
      currentDevice: true,
      preference: true,
      updatedAt: true,
      customer: { select: { name: true } },
      facts: {
        where: { removedAt: null },
        select: {
          id: true,
          kind: true,
          value: true,
          source: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!p) return null;
  // What the bot learned before a Clear chat or a tester's /new is not shown
  // (2026-10-27) — the same reading the bot itself makes. The name stays:
  // it is how staff know who this is, so a cleared profile falls back to the
  // POS customer's own.
  const seen = visibleProfile(p, await resetPointFor(db, phone));
  const f = seen.fields;
  return {
    // Never a placeholder a model filed ("unknown", 2026-10-27).
    name: (f ? realName(p.name) : null) ?? realName(p.customer?.name),
    ageEstimate: f ? p.ageEstimate : null,
    occupation: f ? p.occupation : null,
    // A profile written before the range existed has only `budget`.
    budgetMin: f ? ((p.budgetMin ?? p.budget)?.toString() ?? null) : null,
    budgetMax: f ? ((p.budgetMax ?? p.budget)?.toString() ?? null) : null,
    useCase: f ? p.useCase : null,
    currentDevice: f ? p.currentDevice : null,
    preference: f ? p.preference : null,
    facts: seen.facts.map(({ id, kind, value, source }) => ({
      id,
      kind,
      value,
      source,
    })),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/**
 * The threads whose bot has answered (a live `AgentRun`) since their reset
 * point — so their `leadScore` is this conversation's. A thread never reset
 * counts whenever it has a score at all.
 */
async function scoredSince(
  db: PrismaClient,
  phones: readonly string[],
  resets: ReadonlyMap<string, Date | null>,
): Promise<Set<string>> {
  const reset = phones.filter((p) => resets.get(p));
  const out = new Set(phones.filter((p) => !resets.get(p)));
  if (reset.length === 0) return out;
  const runs = await db.agentRun.groupBy({
    by: ["from"],
    where: { from: { in: reset }, dryRun: false },
    _max: { createdAt: true },
  });
  for (const r of runs) {
    const at = resets.get(r.from);
    if (at && r._max.createdAt && r._max.createdAt > at) out.add(r.from);
  }
  return out;
}

/** The 🔥 tag on one thread. */
export async function leadJson(db: PrismaClient, phone: string) {
  const m = await db.waThreadMemory.findUnique({
    where: { from: phone },
    select: {
      leadAt: true,
      leadStaffAt: true,
      leadClearedAt: true,
      leadScore: true,
    },
  });
  const resetAt = await resetPointFor(db, phone);
  const on = isLead(m, resetAt);
  // The score is the bot's last turn's; one from before a Clear chat or a
  // /new is the old conversation's (2026-10-27), so none until it answers.
  const fresh = await scoredSince(db, [phone], new Map([[phone, resetAt]]));
  return {
    on,
    score: fresh.has(phone) ? (m?.leadScore ?? null) : null,
    by: on ? ("BOT" as const) : null,
  };
}

/** The open holds booked under this number — by the bot or at the counter. */
export async function reservationsFor(db: PrismaClient, phone: string) {
  const holds = await db.reservation.findMany({
    where: { phone: { in: phoneForms(phone) }, status: "TERJADWAL" },
    orderBy: { scheduledFor: "asc" },
    select: {
      code: true,
      scheduledFor: true,
      items: {
        where: { removedAt: null },
        orderBy: { sortOrder: "asc" },
        select: {
          unit: { select: { serial: true, sku: { select: { name: true } } } },
          sku: { select: { name: true } },
        },
      },
    },
  });
  return holds.map((h) => ({
    code: h.code,
    scheduledFor: h.scheduledFor?.toISOString() ?? null,
    status: "TERJADWAL" as const,
    units: h.items.map((i) => ({
      serial: i.unit?.serial ?? null,
      name: i.unit?.sku.name ?? i.sku?.name ?? "",
    })),
  }));
}

/**
 * "Tell me when it's in stock" (2026-10-27): this thread's watches, open ones
 * first, newest first within each. The bot writes them; staff only close one.
 */
export async function stockWatchesFor(db: PrismaClient, phone: string) {
  const rows = await db.stockWatch.findMany({
    where: { from: phone },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      query: true,
      budget: true,
      createdAt: true,
      notifiedAt: true,
      closedAt: true,
      model: { select: { name: true } },
      sku: { select: { name: true, variantLabel: true } },
    },
  });
  return rows
    .map((w) => ({
      id: w.id,
      query: w.query,
      label: w.sku
        ? [w.sku.name, w.sku.variantLabel].filter(Boolean).join(" ")
        : (w.model?.name ?? null),
      budget: w.budget?.toString() ?? null,
      createdAt: w.createdAt.toISOString(),
      notifiedAt: w.notifiedAt?.toISOString() ?? null,
      closedAt: w.closedAt?.toISOString() ?? null,
    }))
    .sort((a, b) => Number(a.closedAt !== null) - Number(b.closedAt !== null));
}

export type StockWatchJson = Awaited<
  ReturnType<typeof stockWatchesFor>
>[number];

/** The newest evaluation of each answered message, keyed by message id. */
export async function evaluationsFor(
  db: PrismaClient,
  messageIds: readonly string[],
) {
  if (messageIds.length === 0) return new Map();
  const rows = await db.agentEvaluation.findMany({
    where: { messageId: { in: [...messageIds] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, messageId: true, rating: true, status: true },
  });
  const out = new Map<
    string,
    { id: string; rating: "GOOD" | "BAD"; status: string }
  >();
  for (const r of rows)
    if (!out.has(r.messageId))
      out.set(r.messageId, { id: r.id, rating: r.rating, status: r.status });
  return out;
}

/**
 * Per thread for the list: unread count, the three tags' inputs and the best
 * name the shop has. One query each, for every thread at once.
 */
export async function listExtras(db: PrismaClient, phones: readonly string[]) {
  if (phones.length === 0) return new Map<string, ListExtra>();
  const [mems, unread, holds, customers, profiles] = await Promise.all([
    db.waThreadMemory.findMany({
      where: { from: { in: [...phones] } },
      select: {
        from: true,
        leadAt: true,
        leadStaffAt: true,
        leadClearedAt: true,
        leadScore: true,
      },
    }),
    // Unread: what came in after the marker. A thread nobody has opened since
    // the marker existed counts only what is still waiting on somebody, so the
    // first day of v2 is not every message the shop ever received.
    db.$queryRaw<{ from: string; unread: number }[]>(Prisma.sql`
      SELECT m."from", COUNT(*)::int AS "unread"
        FROM "WaMessage" m
        LEFT JOIN "WaThreadMemory" t ON t."from" = m."from"
       WHERE m."direction" = 'IN'
         AND m."from" IN (${Prisma.join([...phones])})
         AND ((t."readAt" IS NULL AND m."status" IN ('BARU', 'PERLU_STAF'))
              OR m."ts" > t."readAt")
         -- Nothing from before a Clear chat counts (2026-10-27).
         AND (t."clearedAt" IS NULL
              OR m."answeredAt" IS NULL
              OR m."answeredAt" > t."clearedAt")
       GROUP BY m."from"
    `),
    db.reservation.findMany({
      where: { status: "TERJADWAL", phone: { not: null } },
      select: { phone: true },
    }),
    db.customer.findMany({
      where: { phone: { in: phones.flatMap((p) => phoneForms(p)) } },
      select: { phone: true, name: true },
    }),
    db.customerProfile.findMany({
      where: { from: { in: [...phones] } },
      select: { from: true, name: true },
    }),
  ]);
  // A lead and a score from before the thread's reset point (Clear chat, a
  // tester's /new) belong to the conversation left behind (2026-10-27).
  const resets = await resetPointsFor(db, phones);
  const scored = await scoredSince(db, phones, resets);
  const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");
  const held = new Set(holds.map((h) => digits(h.phone)));
  const out = new Map<string, ListExtra>();
  for (const phone of phones) {
    const m = mems.find((x) => x.from === phone) ?? null;
    const customer = customers.find((c) => digits(c.phone) === phone);
    const profile = profiles.find((p) => p.from === phone);
    out.set(phone, {
      unread: unread.find((u) => u.from === phone)?.unread ?? 0,
      lead: isLead(m, resets.get(phone) ?? null),
      leadScore: scored.has(phone) ? (m?.leadScore ?? null) : null,
      reservation: held.has(phone),
      displayName: realName(customer?.name) ?? realName(profile?.name),
    });
  }
  return out;
}

export interface ListExtra {
  readonly unread: number;
  readonly lead: boolean;
  readonly leadScore: number | null;
  readonly reservation: boolean;
  readonly displayName: string | null;
}

const MEMORY_CREATE = (phone: string, now: Date) => ({
  from: phone,
  summaryTurns: 0,
  clarifyCount: 0,
  updatedAt: now,
});

/** The routes. Registered on the inbox router, after its own. */
export function registerInboxV2(router: Router, db: PrismaClient): void {
  const phoneOf = (raw: unknown) => {
    const p = phoneParam.safeParse(raw);
    if (!p.success)
      throw new ApiError(400, "VALIDASI", "Nomor WhatsApp tidak valid.");
    return p.data;
  };

  /** POST /api/inbox/:phone/read — everything up to now is read. */
  router.post("/:phone/read", async (req, res, next) => {
    try {
      const phone = phoneOf(req.params["phone"]);
      const now = new Date();
      await db.waThreadMemory.upsert({
        where: { from: phone },
        update: { readAt: now },
        create: { ...MEMORY_CREATE(phone, now), readAt: now },
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // No PUT /:phone/lead since 2026-10-21 (owner: "the user cannot choose /
  // determine the lead"). The bot's score sets the 🔥 and a sale clears it;
  // nobody at the inbox does either.

  /** PATCH /api/inbox/:phone/profile — a colleague corrects the profile. */
  router.patch("/:phone/profile", async (req, res, next) => {
    try {
      const phone = phoneOf(req.params["phone"]);
      const body = profileBody.safeParse(req.body);
      if (!body.success)
        throw new ApiError(400, "VALIDASI", "Profil tidak valid.");
      const b = body.data;
      const big = (v: string | null | undefined) =>
        v === undefined ? undefined : v === null ? null : BigInt(v);
      const min = big(b.budgetMin);
      const max = big(b.budgetMax);
      if (min && max && min > max)
        throw new ApiError(
          400,
          "VALIDASI",
          "Budget minimum lebih besar dari maksimum.",
        );
      if (min === 0n || max === 0n)
        throw new ApiError(400, "VALIDASI", "Budget harus lebih dari nol.");
      const blank = (v: string | null | undefined) =>
        v === undefined ? undefined : v === null || v === "" ? null : v;
      const fields = {
        ...(b.name !== undefined ? { name: blank(b.name) } : {}),
        ...(b.ageEstimate !== undefined
          ? { ageEstimate: blank(b.ageEstimate) }
          : {}),
        ...(b.occupation !== undefined
          ? { occupation: blank(b.occupation) }
          : {}),
        ...(min !== undefined ? { budgetMin: min } : {}),
        ...(max !== undefined ? { budgetMax: max, budget: max } : {}),
        ...(b.useCase !== undefined ? { useCase: blank(b.useCase) } : {}),
        ...(b.currentDevice !== undefined
          ? { currentDevice: blank(b.currentDevice) }
          : {}),
        ...(b.preference !== undefined
          ? { preference: blank(b.preference) }
          : {}),
      };
      const now = new Date();
      await db.customerProfile.upsert({
        where: { from: phone },
        update: { ...fields, updatedAt: now },
        create: { from: phone, ...fields, updatedAt: now },
      });
      res.json(await profileJson(db, phone));
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/inbox/:phone/profile/facts — a colleague adds a fact. */
  router.post("/:phone/profile/facts", async (req, res, next) => {
    try {
      const phone = phoneOf(req.params["phone"]);
      const body = factBody.safeParse(req.body);
      if (!body.success)
        throw new ApiError(400, "VALIDASI", "Fakta tidak valid.");
      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");
      const now = new Date();
      const profile = await db.customerProfile.upsert({
        where: { from: phone },
        update: { updatedAt: now },
        create: { from: phone, updatedAt: now },
        select: { id: true },
      });
      const fact = await db.customerProfileFact.create({
        data: {
          profileId: profile.id,
          kind: body.data.kind,
          value: body.data.value,
          source: "STAFF",
          createdById: staff.id,
          createdAt: now,
        },
        select: { id: true, kind: true, value: true, source: true },
      });
      res.status(201).json({ fact });
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/inbox/:phone/watches — what this customer wants back in stock. */
  router.get("/:phone/watches", async (req, res, next) => {
    try {
      const phone = phoneOf(req.params["phone"]);
      res.json({ watches: await stockWatchesFor(db, phone) });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/inbox/:phone/watches/:id/close — staff close a watch (the
   * customer bought elsewhere, or was told). `closedAt` is the one column
   * the app role may write on the table; nothing is deleted.
   */
  router.post("/:phone/watches/:id/close", async (req, res, next) => {
    try {
      const phone = phoneOf(req.params["phone"]);
      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");
      const id = String(req.params["id"]);
      const now = new Date();
      await db.$transaction(async (tx) => {
        const { count } = await tx.stockWatch.updateMany({
          where: { id, from: phone, closedAt: null },
          data: { closedAt: now },
        });
        if (count === 0) throw notFound("Permintaan stok");
        await tx.auditLog.create({
          data: {
            at: now,
            staffId: staff.id,
            entity: "StockWatch",
            entityId: id,
            action: "UPDATE",
            field: "closedAt",
            before: null,
            after: JSON.stringify(now.toISOString()),
            requestId: req.get("x-request-id") ?? null,
            ip: req.ip ?? null,
          },
        });
      });
      res.json({ watches: await stockWatchesFor(db, phone) });
    } catch (err) {
      next(err);
    }
  });

  /** DELETE /api/inbox/:phone/profile/facts/:id — taken back, never deleted. */
  router.delete("/:phone/profile/facts/:id", async (req, res, next) => {
    try {
      const phone = phoneOf(req.params["phone"]);
      const { count } = await db.customerProfileFact.updateMany({
        where: {
          id: String(req.params["id"]),
          removedAt: null,
          profile: { from: phone },
        },
        data: { removedAt: new Date() },
      });
      if (count === 0) throw notFound("Fakta");
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/inbox/:phone/media — "attach media": units' QC photos, as the
   * bot would send them (the same `unit_photos` rule — a sellable unit, at
   * most three each), queued after anything already waiting to go.
   *
   * Several units at once since 2026-10-23 (owner: *"they can choose, even
   * multiple … and if they send image, the chatbot will also automatically
   * send a text"*): `serials`, up to five, each one preceded by a line naming
   * it — "Berikut foto {unit} nya ya kak…" — so the customer can tell which
   * photos are which. `serial` alone is still read, for the build before.
   * A serial that has no photos to send is reported back, not refused, as
   * long as at least one other does.
   */
  router.post("/:phone/media", async (req, res, next) => {
    try {
      const phone = phoneOf(req.params["phone"]);
      const body = z
        .object({
          serial: z.string().trim().min(1).max(40).optional(),
          serials: z
            .array(z.string().trim().min(1).max(40))
            .min(1)
            .max(MAX_MEDIA_UNITS)
            .optional(),
        })
        .strict()
        .safeParse(req.body);
      const serials = body.success
        ? [
            ...new Set([
              ...(body.data.serials ?? []),
              ...(body.data.serial ? [body.data.serial] : []),
            ]),
          ]
        : [];
      if (serials.length === 0 || serials.length > MAX_MEDIA_UNITS)
        throw new ApiError(400, "VALIDASI", "Nomor seri tidak valid.");
      const last = await db.waMessage.findFirst({
        where: { from: phone, direction: "IN" },
        orderBy: { ts: "desc" },
        select: { id: true, ts: true },
      });
      if (!last) throw notFound("Percakapan");
      if (!isWithinWindow(last.ts))
        throw new ApiError(
          409,
          "KONFLIK",
          "Jendela 24 jam WhatsApp sudah tutup — foto tidak bisa dikirim.",
        );
      // Network-free lookups first, outside the transaction.
      const found: { serial: string; caption: string; ids: string[] }[] = [];
      const skipped: string[] = [];
      for (const serial of serials) {
        const out = (await dispatchTool(
          db,
          "unit_photos",
          { serial },
          { from: phone, now: new Date() },
        )) as { found?: boolean; photoIds?: unknown; caption?: unknown };
        const ids = Array.isArray(out.photoIds)
          ? out.photoIds.filter((x): x is string => typeof x === "string")
          : [];
        if (out.found === false || ids.length === 0) {
          skipped.push(serial);
          continue;
        }
        found.push({
          serial,
          caption: typeof out.caption === "string" ? out.caption : serial,
          ids,
        });
      }
      if (found.length === 0)
        throw new ApiError(
          404,
          "TIDAK_DITEMUKAN",
          "Unit itu tidak ada, tidak tersedia, atau belum punya foto.",
        );
      await db.$transaction(async (tx) => {
        for (const unit of found) {
          await enqueueOutbox(tx, {
            kind: "WA_REPLY",
            payload: {
              to: phone,
              body: photoCaption(unit.caption),
              inReplyTo: last.id,
            },
          });
          for (const photoId of unit.ids)
            await enqueueOutbox(tx, {
              kind: "WA_IMAGE",
              payload: { to: phone, photoId, inReplyTo: last.id },
            });
        }
      });
      res.json({
        queued: found.reduce((n, u) => n + u.ids.length, 0),
        units: found.length,
        skipped,
      });
    } catch (err) {
      next(err);
    }
  });
}
