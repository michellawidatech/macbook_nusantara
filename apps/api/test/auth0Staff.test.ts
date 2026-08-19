/**
 * Linking an Auth0 identity to a `Staff` row — apps/api/src/auth/auth0.ts.
 *
 * Driven against a real database, because every case here is about a unique
 * constraint, a transaction or a row that must NOT be created.
 *
 * The owner's decision (2026-08-19): a first-time Auth0 login provisions a
 * `STAFF` account that can approve.
 */

import { Writable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@nusantara/db";
import { createLogger } from "@nusantara/logging";
import { resolveStaff } from "../src/auth/auth0.js";

const URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://nusantara@localhost:5432/nusantara_pos_test";

let db: PrismaClient;

const sink = new Writable({
  write(_chunk, _enc, cb) {
    cb();
  },
});
const logger = createLogger({ app: "api", env: "test", destination: sink });

const claims = (
  over: Partial<{ sub: string; email: string; name: string }>,
) => ({
  sub: "auth0|abc123",
  ...over,
});

beforeAll(async () => {
  db = new PrismaClient({ datasourceUrl: URL });
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  const tables = await db.$queryRaw<{ t: string }[]>`
    SELECT quote_ident(tablename) AS t FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((r) => r.t).join(", ")} RESTART IDENTITY CASCADE`,
  );
});

describe("resolveStaff", () => {
  it("provisions a first-time login as STAFF that can approve", async () => {
    const staff = await resolveStaff(
      { db, logger },
      claims({ email: "kasir@toko.id", name: "Kasir Satu" }),
    );

    expect(staff.role).toBe("STAFF");
    expect(staff.canApprove).toBe(true);
    expect(staff.active).toBe(true);
    expect(staff.username).toBe("kasir@toko.id");
    expect(staff.name).toBe("Kasir Satu");
    expect(staff.auth0Sub).toBe("auth0|abc123");
  });

  // The password column is not nullable and this account has no password. The
  // stored value must be one that can never verify.
  it("stores a password that cannot be used to log in", async () => {
    const staff = await resolveStaff({ db, logger }, claims({}));
    const { verifyPassword } = await import("../src/auth/credentials.js");

    expect(await verifyPassword(staff.passwordHash, "")).toBe(false);
    expect(await verifyPassword(staff.passwordHash, staff.passwordHash)).toBe(
      false,
    );
  });

  it("records the new account in the audit log", async () => {
    const staff = await resolveStaff({ db, logger }, claims({}));
    const entries = await db.auditLog.findMany({
      where: { entity: "Staff", entityId: staff.id },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe("CREATE");
  });

  it("returns the same row on a second login, without creating another", async () => {
    const first = await resolveStaff(
      { db, logger },
      claims({ email: "a@b.id" }),
    );
    const second = await resolveStaff(
      { db, logger },
      claims({ email: "a@b.id" }),
    );

    expect(second.id).toBe(first.id);
    expect(await db.staff.count()).toBe(1);
  });

  // Without this an existing account is shadowed by a duplicate, and every row
  // already attributed to it — orders, unit events, audit — points at a staff
  // member who can no longer log in.
  it("adopts an existing account whose username is the email", async () => {
    const existing = await db.staff.create({
      data: {
        username: "pemilik@toko.id",
        name: "Pemilik",
        role: "OWNER",
        canApprove: true,
        active: true,
        passwordHash: "x",
        createdAt: new Date(),
      },
    });

    const staff = await resolveStaff(
      { db, logger },
      claims({ email: "pemilik@toko.id" }),
    );

    expect(staff.id).toBe(existing.id);
    // Adopted, not downgraded: the owner stays an owner.
    expect(staff.role).toBe("OWNER");
    expect(staff.auth0Sub).toBe("auth0|abc123");
    expect(await db.staff.count()).toBe(1);
  });

  it("falls back to the sub when the token carries no email", async () => {
    const staff = await resolveStaff({ db, logger }, claims({}));
    expect(staff.username).toBe("auth0|abc123");
    expect(staff.name).toBe("auth0|abc123");
  });

  // `active = false` is how this shop revokes access. A valid Auth0 login must
  // not undo it.
  it("refuses a deactivated linked account", async () => {
    await db.staff.create({
      data: {
        username: "mantan",
        name: "Mantan",
        role: "STAFF",
        canApprove: false,
        active: false,
        passwordHash: "x",
        auth0Sub: "auth0|abc123",
        createdAt: new Date(),
      },
    });

    await expect(resolveStaff({ db, logger }, claims({}))).rejects.toThrow(
      /dinonaktifkan/,
    );
  });

  it("refuses a deactivated account it would otherwise adopt", async () => {
    await db.staff.create({
      data: {
        username: "mantan@toko.id",
        name: "Mantan",
        role: "STAFF",
        canApprove: false,
        active: false,
        passwordHash: "x",
        createdAt: new Date(),
      },
    });

    await expect(
      resolveStaff({ db, logger }, claims({ email: "mantan@toko.id" })),
    ).rejects.toThrow(/dinonaktifkan/);
    // And no duplicate was created as a consolation prize.
    expect(await db.staff.count()).toBe(1);
  });

  it("keeps two different Auth0 identities apart", async () => {
    const one = await resolveStaff(
      { db, logger },
      claims({ email: "one@b.id" }),
    );
    const two = await resolveStaff(
      { db, logger },
      { sub: "auth0|zzz999", email: "two@b.id" },
    );

    expect(two.id).not.toBe(one.id);
    expect(await db.staff.count()).toBe(2);
  });
});
