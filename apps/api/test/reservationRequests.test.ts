/**
 * Approving and rejecting the bot's reservation requests (owner, 2026-10-27),
 * against a real database with the API logged in as `nusantara_app` — so the
 * grants the decision needs (UPDATE on the proposal, the reservation, the DP
 * payment, the ledger, the task close, the Outbox and the audit row) are
 * proved here and not on the shop's Mac mini. Fixtures go through the owner.
 */

import { Writable } from "node:stream";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, appendUnitEvent, truncateAll } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/auth/credentials.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";
const asRole = (role: string) => {
  const u = new globalThis.URL(URL);
  u.username = role;
  u.password = "";
  return u.toString();
};
const PASSWORD = "rahasia-sekali";
const FROM = "628980096001";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const sink = new Writable({ write: (_c, _e, cb) => cb() });

let owner: PrismaClient;
let appDb: PrismaClient;
let app: Express;
let cookie: string;
let staffId: string;

beforeAll(async () => {
  owner = new PrismaClient({ datasourceUrl: URL });
  appDb = new PrismaClient({ datasourceUrl: asRole("nusantara_app") });
  await owner.$connect();
  await appDb.$connect();
  app = createApp({
    db: appDb,
    config: loadConfig({ NODE_ENV: "test", SESSION_COOKIE_INSECURE: "1" }),
    logger: createLogger({ app: "api", env: "test", destination: sink }),
  });
});

afterAll(async () => {
  await truncateAll(owner);
  await appDb.$disconnect();
  await owner.$disconnect();
});

beforeEach(async () => {
  await truncateAll(owner);
  const staff = await owner.staff.create({
    data: {
      username: "req-staff",
      name: "Rina",
      role: "STAFF",
      passwordHash: await hashPassword(PASSWORD),
      active: true,
      canApprove: false,
      createdAt: new Date(),
    },
  });
  staffId = staff.id;
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username: "req-staff", password: PASSWORD })
    .expect(200);
  cookie = (res.headers["set-cookie"] as unknown as string[])[0]!;

  const now = new Date();
  await owner.location.create({
    data: {
      id: "loc_r",
      code: "01",
      name: "Toko",
      kind: "TOKO",
      active: true,
      sortOrder: 1,
    },
  });
  for (const [i, code] of ["TRANSFER", "TUNAI"].entries())
    await owner.paymentMethod.create({
      data: {
        code,
        label: code,
        builtIn: true,
        forPo: true,
        forSale: true,
        active: true,
        sortOrder: i,
        createdAt: now,
      },
    });
  await owner.category.create({
    data: {
      id: "cat_r",
      name: "MacBook",
      sortOrder: 1,
      marginMode: "PCT",
      marginMin: 5n,
      marginMax: 30n,
      createdAt: now,
    },
  });
  await owner.catalogModel.create({
    data: {
      id: "mdl_r",
      categoryId: "cat_r",
      name: "MacBook Air M2",
      archived: false,
      createdAt: now,
    },
  });
  await owner.sku.create({
    data: {
      id: "sku_r",
      modelId: "mdl_r",
      code: "SKU-R1",
      name: "MacBook Air M2",
      variantLabel: "8/256",
      grade: "A",
      price: 15_500_000n,
      landed: 12_000_000n,
      archived: false,
      createdAt: now,
    },
  });
  for (const serial of ["SREQ1", "SREQ2"]) {
    await owner.unit.create({
      data: {
        serial,
        skuId: "sku_r",
        status: "QC",
        locationId: "loc_r",
        buy: 12_000_000n,
        landed: 12_000_000n,
        grade: "A",
        intakeAt: now,
        version: 1,
      },
    });
    await owner.$transaction(async (tx) => {
      await appendUnitEvent(tx, {
        serial,
        type: "DITERIMA",
        staffId,
        toLocationId: "loc_r",
      });
      await appendUnitEvent(tx, { serial, type: "QC_SELESAI", staffId });
    });
  }
});

/** The customer's last line, `agoMs` ago — what opens the 24-hour window. */
async function inbound(agoMs = 10 * 60_000) {
  return owner.waMessage.create({
    data: {
      waMessageId: `wamid.REQ.${Math.random()}`,
      from: FROM,
      name: "Budi",
      text: "tolong di keep ya kak",
      msgType: "text",
      ts: new Date(Date.now() - agoMs),
      direction: "IN",
      status: "DIJAWAB_AGEN",
      entities: {},
      answeredByAgent: true,
    },
  });
}

/** A request as the bot files it. */
async function filed(over: { serials?: string[]; expiresAt?: Date } = {}) {
  const now = new Date();
  const units = await owner.unit.findMany({
    where: { serial: { in: over.serials ?? ["SREQ1"] } },
  });
  return owner.reservationProposal.create({
    data: {
      from: FROM,
      custName: "Budi",
      scheduledFor: new Date(now.getTime() + DAY),
      // The CHECK wants expiresAt after createdAt: a lapsed one was filed
      // three days before it lapsed.
      createdAt: over.expiresAt
        ? new Date(over.expiresAt.getTime() - 3 * DAY)
        : now,
      expiresAt: over.expiresAt ?? new Date(now.getTime() + 3 * DAY),
      items: {
        create: units.map((u, i) => ({ unitId: u.id, sortOrder: i })),
      },
    },
  });
}

const approve = (id: string, body: Record<string, unknown>) =>
  request(app)
    .post(`/api/reservations/requests/${id}/approve`)
    .set("Cookie", cookie)
    .send(body);
const reject = (id: string, body: Record<string, unknown>) =>
  request(app)
    .post(`/api/reservations/requests/${id}/reject`)
    .set("Cookie", cookie)
    .send(body);

describe("approving a request", () => {
  it("books it without a DP: a soft hold, the task closed and the customer told — one transaction", async () => {
    await inbound();
    const p = await filed();
    await owner.chatAction.create({
      data: {
        from: FROM,
        kind: "RESERVATION",
        topic: "reservation",
        summary: "Perlu konfirmasi reservasi",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const when = new Date(Date.now() + DAY);
    const res = await approve(p.id, {
      serials: ["SREQ1"],
      scheduledFor: when.toISOString(),
      tell: true,
    }).expect(201);
    expect(res.body.told).toBe(true);
    expect(res.body.heldUntil).toBeNull();

    const r = await owner.reservation.findFirstOrThrow({
      include: { items: true, payments: true },
    });
    expect(r).toMatchObject({
      source: "STAF",
      status: "TERJADWAL",
      phone: `+${FROM}`,
      custName: "Budi",
      heldUntil: null,
    });
    expect(r.items).toHaveLength(1);
    expect(r.payments).toHaveLength(0);
    // Without a DP nothing is held: the unit stays on sale.
    expect(
      (await owner.unit.findUniqueOrThrow({ where: { serial: "SREQ1" } }))
        .status,
    ).toBe("TERSEDIA");
    expect(
      await owner.reservationProposal.findUniqueOrThrow({
        where: { id: p.id },
      }),
    ).toMatchObject({ reservationId: r.id });
    expect((await owner.chatAction.findFirstOrThrow()).status).toBe("DONE");
    const out = await owner.outbox.findFirstOrThrow();
    expect(out.kind).toBe("WA_REPLY");
    // The owner's template (2026-10-28), with the name the request is under.
    expect((out.payload as { body: string }).body).toMatch(
      /^Okeyy kak noted, kak Budi nanti akan kita siapkan MacBook Air M2 8\/256 nya yaa untuk .+ jam \d\d\.\d\d\.$/,
    );
    expect(
      await owner.auditLog.count({
        where: { entity: "ReservationProposal", entityId: p.id },
      }),
    ).toBe(1);
    for (const collection of ["reservations", "reservationRequests"])
      expect(
        await owner.storeChange.count({ where: { collection } }),
      ).toBeGreaterThan(0);
  });

  it("with a DP: the payment, a firm hold until DP + 7 days, and the DP proof task closed", async () => {
    await inbound();
    const p = await filed();
    await owner.chatAction.create({
      data: {
        from: FROM,
        kind: "OTHER",
        topic: "order_payment",
        summary: "Perlu verifikasi DP — Budi kirim bukti transfer Rp 500rb",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const paidAt = new Date();
    const res = await approve(p.id, {
      serials: ["SREQ1"],
      scheduledFor: new Date(Date.now() + DAY).toISOString(),
      dp: {
        amount: "500000",
        method: "TRANSFER",
        paidAt: paidAt.toISOString(),
      },
      tell: true,
    }).expect(201);
    expect(new Date(res.body.heldUntil).getTime()).toBe(
      paidAt.getTime() + 7 * DAY,
    );
    const r = await owner.reservation.findFirstOrThrow({
      include: { payments: { include: { method: true } } },
    });
    expect(r.payments).toHaveLength(1);
    expect(r.payments[0]).toMatchObject({
      direction: "MASUK",
      amount: 500_000n,
      status: "LUNAS",
      orderId: null,
    });
    expect(r.payments[0]!.method.code).toBe("TRANSFER");
    expect(
      (await owner.unit.findUniqueOrThrow({ where: { serial: "SREQ1" } }))
        .status,
    ).toBe("DIRESERVASI");
    expect(
      await owner.unitEvent.count({
        where: { type: "DIRESERVASI", reservationId: r.id },
      }),
    ).toBe(1);
    expect((await owner.chatAction.findFirstOrThrow()).status).toBe("DONE");
    const out = await owner.outbox.findFirstOrThrow();
    // The template is the whole message: no DP line (owner, 2026-10-28).
    expect((out.payload as { body: string }).body).toMatch(/^Okeyy kak noted/);
    expect((out.payload as { body: string }).body).not.toContain("DP");
  });

  it("says where the shop is once, and not again when the chat already has it (2026-10-28)", async () => {
    await owner.location.update({
      where: { id: "loc_r" },
      data: { address: "Jl. Mangga Dua Raya 12" },
    });
    await inbound();
    const first = await filed();
    await approve(first.id, {
      serials: [],
      scheduledFor: new Date(Date.now() + DAY).toISOString(),
      tell: true,
    }).expect(201);
    const bodies = async () =>
      (await owner.outbox.findMany({ orderBy: { createdAt: "asc" } })).map(
        (o) => (o.payload as { body: string }).body,
      );
    expect((await bodies())[0]).toContain(
      "Toko kita ada di Jl. Mangga Dua Raya 12, buka setiap hari 10.00–20.00 WIB.",
    );
    const second = await filed({ serials: ["SREQ2"] });
    await approve(second.id, {
      serials: [],
      scheduledFor: new Date(Date.now() + 2 * DAY).toISOString(),
      tell: true,
    }).expect(201);
    expect((await bodies())[1]).not.toContain("Toko kita ada di");
  });

  it("approves once — a second press is refused", async () => {
    await inbound();
    const p = await filed();
    const body = {
      serials: ["SREQ1"],
      scheduledFor: new Date(Date.now() + DAY).toISOString(),
      tell: false,
    };
    await approve(p.id, body).expect(201);
    const again = await approve(p.id, body).expect(409);
    expect(again.body.error.message).toContain("sudah disetujui");
    expect(await owner.reservation.count()).toBe(1);
    // Not told: nothing queued.
    expect(await owner.outbox.count()).toBe(0);
  });

  it("refuses a unit sold meanwhile and writes nothing", async () => {
    await inbound();
    const p = await filed();
    await owner.$transaction((tx) =>
      appendUnitEvent(tx, { serial: "SREQ1", type: "TERJUAL", staffId }),
    );
    await approve(p.id, {
      serials: ["SREQ1"],
      scheduledFor: new Date(Date.now() + DAY).toISOString(),
    }).expect(409);
    expect(await owner.reservation.count()).toBe(0);
    expect(
      (
        await owner.reservationProposal.findUniqueOrThrow({
          where: { id: p.id },
        })
      ).confirmedAt,
    ).toBeNull();
  });

  it("books a visit when the person took every unit off", async () => {
    await inbound();
    const p = await filed();
    await approve(p.id, {
      serials: [],
      scheduledFor: new Date(Date.now() + DAY).toISOString(),
      tell: true,
    }).expect(201);
    const r = await owner.reservation.findFirstOrThrow({
      include: { items: true },
    });
    expect(r.items).toHaveLength(0);
    expect(r.status).toBe("TERJADWAL");
    const out = await owner.outbox.findFirstOrThrow();
    expect((out.payload as { body: string }).body).toMatch(
      /^Okeyy kak noted, kak Budi nanti kita tunggu kedatangannya yaa di /,
    );
  });

  it("does not queue a line the 24-hour window would refuse", async () => {
    await inbound(2 * DAY);
    const p = await filed();
    const res = await approve(p.id, {
      serials: ["SREQ1"],
      scheduledFor: new Date(Date.now() + DAY).toISOString(),
      tell: true,
    }).expect(201);
    expect(res.body).toMatchObject({ told: false, windowClosed: true });
    expect(await owner.outbox.count()).toBe(0);
    expect(await owner.reservation.count()).toBe(1);
  });

  it("refuses a request that has lapsed", async () => {
    const p = await filed({ expiresAt: new Date(Date.now() - 60_000) });
    const res = await approve(p.id, {
      serials: ["SREQ1"],
      scheduledFor: new Date(Date.now() + DAY).toISOString(),
    }).expect(409);
    expect(res.body.error.message).toContain("kedaluwarsa");
    await reject(p.id, { reason: "x" }).expect(409);
  });

  it("is for signed-in staff only", async () => {
    const p = await filed();
    await request(app)
      .post(`/api/reservations/requests/${p.id}/approve`)
      .send({ serials: [], scheduledFor: new Date().toISOString() })
      .expect(401);
    await request(app)
      .post(`/api/reservations/requests/${p.id}/reject`)
      .send({ reason: "x" })
      .expect(401);
  });
});

describe("rejecting a request", () => {
  it("needs a reason, then cancels it and tells the customer why", async () => {
    await inbound();
    const p = await filed();
    await reject(p.id, { reason: "  " }).expect(400);
    const res = await reject(p.id, {
      reason: "Unitnya sudah terjual.",
      tell: true,
    }).expect(200);
    expect(res.body.told).toBe(true);
    const after = await owner.reservationProposal.findUniqueOrThrow({
      where: { id: p.id },
    });
    expect(after.cancelledAt).not.toBeNull();
    expect(after.reservationId).toBeNull();
    const out = await owner.outbox.findFirstOrThrow();
    expect((out.payload as { body: string }).body).toBe(
      "Maaf kak, untuk reservasinya belum bisa kami proses ya 🙏 Unitnya sudah terjual.",
    );
    const audit = await owner.auditLog.findFirstOrThrow({
      where: { entity: "ReservationProposal" },
    });
    expect(audit.after).toContain("Unitnya sudah terjual.");
    // Already rejected: neither door opens again.
    await reject(p.id, { reason: "lagi" }).expect(409);
    await approve(p.id, {
      serials: [],
      scheduledFor: new Date().toISOString(),
    }).expect(409);
  });

  it("can stay silent", async () => {
    await inbound();
    const p = await filed();
    await reject(p.id, { reason: "Duplikat", tell: false }).expect(200);
    expect(await owner.outbox.count()).toBe(0);
  });
});

describe("the Requests tab's feed", () => {
  it("reaches every till through the store, replaced and DP-proof read off the rows", async () => {
    const first = await filed();
    // The customer asked again: the bot cancels the first at the instant it
    // files the second.
    const at = new Date(first.createdAt.getTime() + 60_000);
    await owner.reservationProposal.update({
      where: { id: first.id },
      data: { cancelledAt: at },
    });
    const second = await owner.reservationProposal.create({
      data: {
        from: FROM,
        custName: "Budi",
        scheduledFor: new Date(at.getTime() + DAY),
        createdAt: at,
        expiresAt: new Date(at.getTime() + 3 * DAY),
      },
    });
    await owner.chatAction.create({
      data: {
        from: FROM,
        kind: "OTHER",
        topic: "order_payment",
        summary: "Perlu verifikasi DP — Budi kirim bukti transfer",
        createdAt: new Date(at.getTime() + 120_000),
        updatedAt: new Date(at.getTime() + 120_000),
      },
    });
    const res = await request(app)
      .get("/api/store")
      .set("Cookie", cookie)
      .expect(200);
    const rows = res.body.db.reservationRequests as Array<
      Record<string, unknown>
    >;
    const a = rows.find((r) => r["id"] === first.id)!;
    const b = rows.find((r) => r["id"] === second.id)!;
    expect(a).toMatchObject({ phone: FROM, replaced: true });
    expect(a["items"]).toEqual([expect.objectContaining({ serial: "SREQ1" })]);
    expect(b).toMatchObject({ replaced: false });
    expect(b["dpProofAt"]).toBeTruthy();
    expect(b["items"]).toEqual([]);
  });
});
