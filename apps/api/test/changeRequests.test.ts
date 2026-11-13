/**
 * Edit and delete approvals over HTTP (2026-11-13): the commit gate refuses a
 * non-approver's edit of money, the same edit filed as a request is committed
 * by the approver's Approve, a record that moved in between makes it STALE,
 * and only an approver decides.
 *
 *   TEST_DATABASE_URL=postgresql://nusantara@localhost:5432/nusantara_store_test \
 *     pnpm --filter @nusantara/api exec vitest run test/changeRequests.test.ts
 */
import { Writable } from "node:stream";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, truncateAll } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/auth/credentials.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_store_test";

const PASSWORD = "rahasia-sekali";
const NOW = new Date("2026-11-13T03:00:00.000Z");
const config = loadConfig({ NODE_ENV: "test", SESSION_COOKIE_INSECURE: "1" });
const sink = new Writable({ write: (_c, _e, cb) => cb() });

let db: PrismaClient;
let app: Express;
let kasir: string;
let ersen: string;

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();
  app = createApp({
    db,
    config,
    logger: createLogger({ app: "api", env: "test", destination: sink }),
  });
}, 60_000);

afterAll(async () => {
  await db.$disconnect();
});

async function person(
  id: string,
  username: string,
  canApprove: boolean,
): Promise<string> {
  await db.staff.create({
    data: {
      id,
      username,
      name: username,
      role: canApprove ? "OWNER" : "STAFF",
      canApprove,
      canViewFinance: true,
      active: true,
      passwordHash: await hashPassword(PASSWORD),
      createdAt: NOW,
    },
  });
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username, password: PASSWORD });
  return (res.headers["set-cookie"] as unknown as string[])[0]!;
}

beforeEach(async () => {
  await truncateAll(db);
  await db.paymentMethod.create({
    data: {
      id: "pm_tunai",
      code: "TUNAI",
      label: "Cash",
      builtIn: true,
      forPo: true,
      forSale: true,
      active: true,
      sortOrder: 0,
      createdAt: NOW,
    },
  });
  kasir = await person("s_kasir", "kasir_cr", false);
  ersen = await person("s_ersen", "ersen_cr", true);
}, 60_000);

const EXPENSE = {
  id: "exp_cr_1",
  kind: "OPERATIONAL",
  amount: "60200",
  date: "2026-11-12",
  method: "TUNAI",
  note: "Bensin",
};

const commit = (cookie: string, body: object) =>
  request(app).post("/api/store/commit").set("Cookie", cookie).send(body);

const one = (collection: string, row: object) => ({
  collections: { [collection]: { rows: [row] } },
  singletons: {},
});

/** The expense as the server now projects it — the base a browser holds. */
async function current(cookie: string): Promise<Record<string, unknown>> {
  const snap = await request(app).get("/api/store").set("Cookie", cookie);
  return (snap.body.db.expenses as Record<string, unknown>[]).find(
    (e) => e["id"] === EXPENSE.id,
  )!;
}

async function seedExpense(): Promise<Record<string, unknown>> {
  const res = await commit(
    kasir,
    one("expenses", { key: EXPENSE.id, next: EXPENSE }),
  );
  expect(res.status).toBe(200);
  return current(kasir);
}

const fileRequest = (cookie: string, body: object) =>
  request(app).post("/api/change-requests").set("Cookie", cookie).send(body);

describe("the commit gate", () => {
  it("lets a non-approver add an adjustment and refuses an edit or a delete", async () => {
    const base = await seedExpense();
    const edited = await commit(
      kasir,
      one("expenses", {
        key: EXPENSE.id,
        base,
        next: { ...base, amount: "6020" },
      }),
    );
    expect(edited.status).toBe(403);
    expect(edited.body.error.field).toBe("expenses");
    const removed = await commit(
      kasir,
      one("expenses", { key: EXPENSE.id, base }),
    );
    expect(removed.status).toBe(403);
    expect(
      (await db.expense.findUniqueOrThrow({ where: { id: EXPENSE.id } }))
        .amount,
    ).toBe(60_200n);

    // An approver's own edit goes straight through, unchanged.
    const theirs = await commit(
      ersen,
      one("expenses", {
        key: EXPENSE.id,
        base,
        next: { ...base, amount: "6020" },
      }),
    );
    expect(theirs.status).toBe(200);
  });
});

describe("/api/change-requests", () => {
  it("files an edit, lists it to its author and the approver, and commits it on Approve", async () => {
    const base = await seedExpense();
    const changeset = one("expenses", {
      key: EXPENSE.id,
      base,
      next: { ...base, amount: "6020" },
    });
    const filed = await fileRequest(kasir, {
      kind: "EDIT",
      target: { expenseId: EXPENSE.id },
      label: "Bensin",
      summary: "Amount: Rp 60.200 → Rp 6.020",
      note: "Typed one zero too many",
      changeset,
    });
    expect(filed.status).toBe(201);
    expect(filed.body.request).toMatchObject({
      kind: "EDIT",
      status: "PENDING",
      target: { expenseId: EXPENSE.id, orderId: null },
      requestedBy: { id: "s_kasir" },
      note: "Typed one zero too many",
    });
    expect(filed.body.request.code).toMatch(/^CR-\d{4}\/\d{2}-\d{6}$/);
    expect(filed.body.request.changeset).toBeUndefined();

    const mine = await request(app)
      .get("/api/change-requests?status=pending")
      .set("Cookie", kasir);
    expect(mine.body.requests).toHaveLength(1);
    const all = await request(app)
      .get("/api/change-requests")
      .set("Cookie", ersen);
    expect(all.body.requests).toHaveLength(1);

    const id = filed.body.request.id as string;
    const refused = await request(app)
      .post(`/api/change-requests/${id}/approve`)
      .set("Cookie", kasir);
    expect(refused.status).toBe(403);

    const approved = await request(app)
      .post(`/api/change-requests/${id}/approve`)
      .set("Cookie", ersen);
    expect(approved.status).toBe(200);
    expect(approved.body.request).toMatchObject({
      status: "APPROVED",
      decidedBy: { id: "s_ersen" },
    });
    expect(
      (await db.expense.findUniqueOrThrow({ where: { id: EXPENSE.id } }))
        .amount,
    ).toBe(6_020n);
    const audit = await db.auditLog.findMany({
      where: { entity: "ChangeRequest", entityId: id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ staffId: "s_ersen", before: "PENDING" });

    const again = await request(app)
      .post(`/api/change-requests/${id}/approve`)
      .set("Cookie", ersen);
    expect(again.status).toBe(409);
    const history = await request(app)
      .get("/api/change-requests?status=history")
      .set("Cookie", kasir);
    expect(history.body.requests.map((r: { id: string }) => r.id)).toEqual([
      id,
    ]);
  });

  it("marks a request STALE when the record changed after it was made", async () => {
    const base = await seedExpense();
    const filed = await fileRequest(kasir, {
      kind: "EDIT",
      target: { expenseId: EXPENSE.id },
      label: "Bensin",
      summary: "",
      note: "Wrong amount",
      changeset: one("expenses", {
        key: EXPENSE.id,
        base,
        next: { ...base, amount: "6020" },
      }),
    });
    // The approver corrects it differently in the meantime.
    await commit(
      ersen,
      one("expenses", {
        key: EXPENSE.id,
        base,
        next: { ...base, amount: "60000" },
      }),
    );
    const res = await request(app)
      .post(`/api/change-requests/${filed.body.request.id as string}/approve`)
      .set("Cookie", ersen);
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe("STALE");
    expect(res.body.request.decisionNote).toMatch(/berubah/);
    expect(
      (await db.expense.findUniqueOrThrow({ where: { id: EXPENSE.id } }))
        .amount,
    ).toBe(60_000n);
  });

  it("deletes on an approved delete request, and keeps the request when the row goes", async () => {
    const base = await seedExpense();
    const filed = await fileRequest(kasir, {
      kind: "DELETE",
      target: { expenseId: EXPENSE.id },
      label: "Bensin — Rp 60.200",
      summary: "Delete",
      note: "Recorded twice",
      changeset: one("expenses", { key: EXPENSE.id, base }),
    });
    expect(filed.status).toBe(201);
    const res = await request(app)
      .post(`/api/change-requests/${filed.body.request.id as string}/approve`)
      .set("Cookie", ersen);
    expect(res.body.request.status).toBe("APPROVED");
    expect(await db.expense.count()).toBe(0);
    const row = await db.changeRequest.findUniqueOrThrow({
      where: { id: filed.body.request.id as string },
    });
    expect(row.expenseId).toBeNull();
    expect(row.label).toBe("Bensin — Rp 60.200");
  });

  it("rejects with an optional reason, approver only", async () => {
    const base = await seedExpense();
    const filed = await fileRequest(kasir, {
      kind: "DELETE",
      target: { expenseId: EXPENSE.id },
      label: "Bensin",
      note: "Not ours",
      changeset: one("expenses", { key: EXPENSE.id, base }),
    });
    const id = filed.body.request.id as string;
    expect(
      (
        await request(app)
          .post(`/api/change-requests/${id}/reject`)
          .set("Cookie", kasir)
          .send({})
      ).status,
    ).toBe(403);
    const res = await request(app)
      .post(`/api/change-requests/${id}/reject`)
      .set("Cookie", ersen)
      .send({ reason: "It is ours" });
    expect(res.body.request).toMatchObject({
      status: "REJECTED",
      decisionNote: "It is ours",
    });
    expect(await db.expense.count()).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entity: "ChangeRequest", entityId: id },
    });
    expect(audit.after).toContain("It is ours");
  });

  it("refuses a request without a note, about nothing, or that does not touch its target", async () => {
    const base = await seedExpense();
    const changeset = one("expenses", { key: EXPENSE.id, base });
    const noNote = await fileRequest(kasir, {
      kind: "DELETE",
      target: { expenseId: EXPENSE.id },
      label: "Bensin",
      note: "  ",
      changeset,
    });
    expect(noNote.status).toBe(400);
    expect(noNote.body.error.field).toBe("note");
    const missing = await fileRequest(kasir, {
      kind: "DELETE",
      target: { expenseId: "exp_nope" },
      label: "x",
      note: "x",
      changeset,
    });
    expect(missing.status).toBe(404);
    const two = await fileRequest(kasir, {
      kind: "DELETE",
      target: { expenseId: EXPENSE.id, orderId: "o-1" },
      label: "x",
      note: "x",
      changeset,
    });
    expect(two.status).toBe(400);
    const elsewhere = await fileRequest(kasir, {
      kind: "EDIT",
      target: { expenseId: EXPENSE.id },
      label: "x",
      note: "x",
      changeset,
    });
    expect(elsewhere.status).toBe(400);
    expect(await db.changeRequest.count()).toBe(0);
  });
});
