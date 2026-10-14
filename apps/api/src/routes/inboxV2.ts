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
import { dispatchTool, isLead, phoneForms } from "@nusantara/agent";
import { ApiError, notFound } from "../errors.js";

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
      facts: {
        where: { removedAt: null },
        select: { id: true, kind: true, value: true, source: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!p) return null;
  return {
    name: p.name,
    ageEstimate: p.ageEstimate,
    occupation: p.occupation,
    // A profile written before the range existed has only `budget`.
    budgetMin: (p.budgetMin ?? p.budget)?.toString() ?? null,
    budgetMax: (p.budgetMax ?? p.budget)?.toString() ?? null,
    useCase: p.useCase,
    currentDevice: p.currentDevice,
    preference: p.preference,
    facts: p.facts,
    updatedAt: p.updatedAt.toISOString(),
  };
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
  const on = isLead(m);
  return {
    on,
    score: m?.leadScore ?? null,
    by: !on
      ? null
      : (m?.leadStaffAt?.getTime() ?? 0) >= (m?.leadAt?.getTime() ?? 0)
        ? ("STAFF" as const)
        : ("BOT" as const),
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
  const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");
  const held = new Set(holds.map((h) => digits(h.phone)));
  const out = new Map<string, ListExtra>();
  for (const phone of phones) {
    const m = mems.find((x) => x.from === phone) ?? null;
    const customer = customers.find((c) => digits(c.phone) === phone);
    const profile = profiles.find((p) => p.from === phone);
    out.set(phone, {
      unread: unread.find((u) => u.from === phone)?.unread ?? 0,
      lead: isLead(m),
      leadScore: m?.leadScore ?? null,
      reservation: held.has(phone),
      displayName: customer?.name?.trim() || profile?.name?.trim() || null,
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

  /**
   * PUT /api/inbox/:phone/lead — staff's half of the 🔥. On writes the staff
   * half; off clears BOTH halves, the same clear a sale writes.
   */
  router.put("/:phone/lead", async (req, res, next) => {
    try {
      const phone = phoneOf(req.params["phone"]);
      const body = z.object({ lead: z.boolean() }).strict().safeParse(req.body);
      if (!body.success)
        throw new ApiError(400, "VALIDASI", "Nilai lead tidak valid.");
      const staff = req.staff;
      if (!staff) throw new ApiError(401, "TIDAK_LOGIN", "Sesi tidak valid.");
      const now = new Date();
      const data = body.data.lead
        ? { leadStaffAt: now, leadStaffById: staff.id }
        : { leadClearedAt: now };
      await db.waThreadMemory.upsert({
        where: { from: phone },
        update: data,
        create: { ...MEMORY_CREATE(phone, now), ...data },
      });
      res.json({ lead: (await leadJson(db, phone)).on });
    } catch (err) {
      next(err);
    }
  });

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
   * POST /api/inbox/:phone/media — "attach media": the unit's QC photos, as
   * the bot would send them (the same `unit_photos` rule — a sellable unit,
   * at most three), queued after anything already waiting to go.
   */
  router.post("/:phone/media", async (req, res, next) => {
    try {
      const phone = phoneOf(req.params["phone"]);
      const body = z
        .object({ serial: z.string().trim().min(1).max(40) })
        .strict()
        .safeParse(req.body);
      if (!body.success)
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
      const out = (await dispatchTool(
        db,
        "unit_photos",
        { serial: body.data.serial },
        { from: phone, now: new Date() },
      )) as { found?: boolean; photoIds?: unknown };
      const ids = Array.isArray(out.photoIds)
        ? out.photoIds.filter((x): x is string => typeof x === "string")
        : [];
      if (out.found === false || ids.length === 0)
        throw new ApiError(
          404,
          "TIDAK_DITEMUKAN",
          "Unit itu tidak ada, tidak tersedia, atau belum punya foto.",
        );
      await db.$transaction(async (tx) => {
        for (const photoId of ids)
          await enqueueOutbox(tx, {
            kind: "WA_IMAGE",
            payload: { to: phone, photoId, inReplyTo: last.id },
          });
      });
      res.json({ queued: ids.length });
    } catch (err) {
      next(err);
    }
  });
}
