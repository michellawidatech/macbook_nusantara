/**
 * S2 — one test per invariant in docs/rebuild/08-data-integrity.md §2.
 *
 * Every test attempts the violation directly against a real PostgreSQL and
 * asserts the SQLSTATE it comes back with. "A constraint nobody has seen
 * reject anything is not known to exist."
 *
 * These run against a real database, never a mock. Create it with:
 *
 *     createdb -U nusantara -h localhost nusantara_pos_test
 *     DATABASE_URL="postgresql://nusantara@localhost:5432/nusantara_pos_test" \
 *       pnpm --filter @nusantara/db exec prisma migrate deploy
 *
 * and run packages/db/prisma/roles.sql once per cluster, as a superuser.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";

const HOST = process.env.TEST_PGHOST ?? "localhost";
const PORT = process.env.TEST_PGPORT ?? "5432";
const DB = process.env.TEST_PGDATABASE ?? "nusantara_pos_test";

const url = (user: string) => `postgresql://${user}@${HOST}:${PORT}/${DB}`;

/** SQLSTATEs. Asserting the code, not a message, is the whole point. */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const NOT_NULL_VIOLATION = "23502";
const CHECK_VIOLATION = "23514";
const INSUFFICIENT_PRIVILEGE = "42501";

let owner: Client; // nusantara — owns the schema, writes the fixtures
let app: Client; // nusantara_app — the API
let agent: Client; // nusantara_agent — the webhook summarizer

/** Assert that `fn` fails, and fails with exactly this SQLSTATE. */
async function rejectsWith(fn: () => Promise<unknown>, sqlstate: string) {
  let err: unknown;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  if (err === undefined) {
    throw new Error(
      `expected SQLSTATE ${sqlstate}, but the write succeeded — the constraint is missing`,
    );
  }
  expect((err as { code?: string }).code).toBe(sqlstate);
}

// --- fixtures --------------------------------------------------------------

const LOC = "tst_loc";
const LOC2 = "tst_loc2";
const STAFF = "tst_staff";
const CAT = "tst_cat";
const MODEL = "tst_model";
const SKU = "tst_sku";
const UNIT = "tst_unit";
const UNIT2 = "tst_unit2";
const ORDER = "tst_order";

async function seed() {
  await owner.query(
    `INSERT INTO "Location" (id, code, name, kind, active, "sortOrder")
     VALUES ($1,'TOKO-1','Toko Utama','TOKO',true,1), ($2,'GDG-1','Gudang','GUDANG',true,2)`,
    [LOC, LOC2],
  );
  await owner.query(
    `INSERT INTO "Staff" (id, username, name, role, "canApprove", active, "passwordHash", "createdAt")
     VALUES ($1,'kasir','Kasir','STAFF',false,true,'x',now())`,
    [STAFF],
  );
  await owner.query(
    `INSERT INTO "Category" (id, name, "sortOrder", "marginMode", "marginMin", "marginMax", "createdAt")
     VALUES ($1,'Laptop',1,'PCT',10,50,now())`,
    [CAT],
  );
  await owner.query(
    `INSERT INTO "CatalogModel" (id, "categoryId", name, archived, "createdAt")
     VALUES ($1,$2,'MacBook Air M1',false,now())`,
    [MODEL, CAT],
  );
  await owner.query(
    `INSERT INTO "Sku" (id, "modelId", code, name, price, landed, archived, "createdAt")
     VALUES ($1,$2,'SKU-1','MacBook Air M1 8/256',12000000,9000000,false,now())`,
    [SKU, MODEL],
  );
  await owner.query(
    `INSERT INTO "Unit" (id, serial, "skuId", status, "locationId", buy, landed, "intakeAt", version)
     VALUES ($1,'SER-001',$3,'TERSEDIA',$4,9000000,9000000,now(),1),
            ($2,'SER-002',$3,'TERSEDIA',$4,9000000,9000000,now(),1)`,
    [UNIT, UNIT2, SKU, LOC],
  );
  // total = subtotal - discount + extra  →  12000000 - 0 + 0
  await owner.query(
    `INSERT INTO "Order" (id, ts, platform, fulfill, status, subtotal, discount, extra,
                          total, "paidTotal", cogs, "tradeCredit", "belowFloor", "soldById", "locationId")
     VALUES ($1, now(),'OFFLINE','PICKUP','LUNAS',12000000,0,0,12000000,12000000,9000000,0,false,$2,$3)`,
    [ORDER, STAFF, LOC],
  );
}

beforeAll(async () => {
  owner = new Client({ connectionString: url("nusantara") });
  app = new Client({ connectionString: url("nusantara_app") });
  agent = new Client({ connectionString: url("nusantara_agent") });
  await Promise.all([owner.connect(), app.connect(), agent.connect()]);
});

afterAll(async () => {
  await Promise.all([owner.end(), app.end(), agent.end()]);
});

beforeEach(async () => {
  const { rows } = await owner.query<{ t: string }>(
    `SELECT quote_ident(tablename) AS t FROM pg_tables
      WHERE schemaname='public' AND tablename <> '_prisma_migrations'`,
  );
  await owner.query(
    `TRUNCATE TABLE ${rows.map((r) => r.t).join(", ")} RESTART IDENTITY CASCADE`,
  );
  await seed();
});

// ---------------------------------------------------------------------------

describe("08 §2 — the fifteen invariants", () => {
  it("1. a serial exists at most once", async () => {
    await rejectsWith(
      () =>
        owner.query(
          `INSERT INTO "Unit" (id, serial, "skuId", status, "locationId", buy, landed, "intakeAt", version)
           VALUES ('dupe','SER-001',$1,'TERSEDIA',$2,1,1,now(),1)`,
          [SKU, LOC],
        ),
      UNIQUE_VIOLATION,
    );
  });

  it("2. a unit's events are ordered — (unitId, seq) is unique and seq is positive", async () => {
    const ev = (id: string, seq: number) =>
      owner.query(
        `INSERT INTO "UnitEvent" (id, "unitId", serial, seq, type, at, "toStatus", "costDelta", "staffId")
         VALUES ($1,$2,'SER-001',$3,'DITERIMA',now(),'TERSEDIA',0,$4)`,
        [id, UNIT, seq, STAFF],
      );

    await ev("e1", 1);
    await rejectsWith(() => ev("e2", 1), UNIQUE_VIOLATION);
    await rejectsWith(() => ev("e3", 0), CHECK_VIOLATION);
  });

  it("3. a unit is sold at most once at a time — and a return releases it", async () => {
    const line = (id: string, returnedAt: string | null) =>
      owner.query(
        `INSERT INTO "OrderItem" (id, "orderId", "unitId", "skuId", name, qty, price, sub, cogs, "returnedQty", "returnedAt")
         VALUES ($1,$2,$3,$4,'MacBook',1,12000000,12000000,9000000,0,$5)`,
        [id, ORDER, UNIT, SKU, returnedAt],
      );

    await line("li1", null);
    await rejectsWith(() => line("li2", null), UNIQUE_VIOLATION);

    // Returning the first line frees the serial for a genuine re-sale.
    await owner.query(
      `UPDATE "OrderItem" SET "returnedAt" = now(), "returnedQty" = 1 WHERE id = 'li1'`,
    );
    await line("li3", null);
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM "OrderItem" WHERE "unitId" = $1 AND "returnedAt" IS NULL`,
      [UNIT],
    );
    expect(rows[0].n).toBe(1);
  });

  it("4. a sold unit cannot be sold again — asserted under the unit's row lock", async () => {
    await owner.query("BEGIN");
    const { rows } = await owner.query(
      `SELECT status FROM "Unit" WHERE id = $1 FOR UPDATE`,
      [UNIT],
    );
    expect(rows[0].status).toBe("TERSEDIA");
    await owner.query(
      `INSERT INTO "OrderItem" (id, "orderId", "unitId", "skuId", name, qty, price, sub, cogs, "returnedQty")
       VALUES ('sold1',$1,$2,$3,'MacBook',1,12000000,12000000,9000000,0)`,
      [ORDER, UNIT, SKU],
    );
    await owner.query(
      `UPDATE "Unit" SET status = 'TERJUAL' WHERE id = $1`,
      [UNIT],
    );
    await owner.query("COMMIT");

    // A second cashier reaching the same serial is stopped by the database,
    // not merely by the status check in front of it.
    await rejectsWith(
      () =>
        owner.query(
          `INSERT INTO "OrderItem" (id, "orderId", "unitId", "skuId", name, qty, price, sub, cogs, "returnedQty")
           VALUES ('sold2',$1,$2,$3,'MacBook',1,12000000,12000000,9000000,0)`,
          [ORDER, UNIT, SKU],
        ),
      UNIQUE_VIOLATION,
    );
  });

  it("5. order total = subtotal − discount + extra", async () => {
    await rejectsWith(
      () =>
        owner.query(
          `INSERT INTO "Order" (id, ts, platform, fulfill, status, subtotal, discount, extra,
                                total, "paidTotal", cogs, "tradeCredit", "belowFloor", "soldById", "locationId")
           VALUES ('bad', now(),'OFFLINE','PICKUP','LUNAS',12000000,1000000,0,
                   12000000,0,9000000,0,false,$1,$2)`,
          [STAFF, LOC],
        ),
      CHECK_VIOLATION,
    );
  });

  it("6. payments are positive, and Σ payments is asserted against the order total", async () => {
    await rejectsWith(
      () =>
        owner.query(
          `INSERT INTO "Payment" (id, "orderId", direction, method, amount, status, "staffId")
           VALUES ('p0',$1,'MASUK','TUNAI',0,'LUNAS',$2)`,
          [ORDER, STAFF],
        ),
      CHECK_VIOLATION,
    );

    await owner.query(
      `INSERT INTO "Payment" (id, "orderId", direction, method, amount, status, "staffId")
       VALUES ('p1',$1,'MASUK','TUNAI',12000000,'LUNAS',$2)`,
      [ORDER, STAFF],
    );
    // The txn-level half of invariant 6: overpayment is detectable in the same
    // transaction that would create it.
    const { rows } = await owner.query(
      `SELECT (SELECT COALESCE(sum(amount),0) FROM "Payment"
                WHERE "orderId" = $1 AND status = 'LUNAS') > (SELECT total FROM "Order" WHERE id = $1) AS over`,
      [ORDER],
    );
    expect(rows[0].over).toBe(false);
  });

  it("7. a payment belongs to exactly one parent", async () => {
    const pay = (id: string, orderId: string | null, poId: string | null) =>
      owner.query(
        `INSERT INTO "Payment" (id, "orderId", "poId", direction, method, amount, status, "staffId")
         VALUES ($1,$2,$3,'MASUK','TUNAI',1000,'LUNAS',$4)`,
        [id, orderId, poId, STAFF],
      );

    // Neither parent.
    await rejectsWith(() => pay("np", null, null), CHECK_VIOLATION);

    // Both parents — and both genuinely exist, so it is the CHECK that rejects
    // this and not a foreign key failing incidentally.
    await owner.query(
      `INSERT INTO "Supplier" (id, name, active, "createdAt") VALUES ('sup1','Supplier A',true,now())`,
    );
    await owner.query(
      `INSERT INTO "PurchaseOrder" (id, "supplierId", "noInvoice", status, "orderedAt", subtotal,
                                    "feesTaxPct", "feesTotal", total, "locationId", "staffId", "createdAt")
       VALUES ('po1','sup1',false,'DRAF',now(),0,0,0,0,$1,$2,now())`,
      [LOC, STAFF],
    );
    await rejectsWith(() => pay("bp", ORDER, "po1"), CHECK_VIOLATION);

    // Exactly one parent is accepted, in either direction.
    await pay("ok1", ORDER, null);
    await pay("ok2", null, "po1");
  });

  it("8. money is never negative where it cannot be, and quantities are positive", async () => {
    const line = (id: string, qty: number, price: number) =>
      owner.query(
        `INSERT INTO "OrderItem" (id, "orderId", "skuId", name, qty, price, sub, cogs, "returnedQty")
         VALUES ($1,$2,$3,'MacBook',$4,$5,0,0,0)`,
        [id, ORDER, SKU, qty, price],
      );

    await rejectsWith(() => line("q0", 0, 1000), CHECK_VIOLATION);
    await rejectsWith(() => line("pneg", 1, -1), CHECK_VIOLATION);

    // A signed column stays signed: petty cash records money leaving the till.
    await owner.query(
      `INSERT INTO "PettyCashEntry" (id, ts, category, amount, "staffId")
       VALUES ('pc1', now(),'Makan',-50000,$1)`,
      [STAFF],
    );
  });

  it("9. a discount cannot be used past its limit", async () => {
    await owner.query(
      `INSERT INTO "Discount" (id, code, pct, "usageLimit", used, active, scope)
       VALUES ('d1','LEBARAN',10,2,2,true,'SEMUA')`,
    );

    // The live mechanism: the WHERE is the lock, so the update simply misses.
    const res = await owner.query(
      `UPDATE "Discount" SET used = used + 1 WHERE id = 'd1' AND used < "usageLimit"`,
    );
    expect(res.rowCount).toBe(0);

    // And the backstop, if that statement is ever written wrongly.
    await rejectsWith(
      () => owner.query(`UPDATE "Discount" SET used = used + 1 WHERE id = 'd1'`),
      CHECK_VIOLATION,
    );
  });

  it("10. codes are unique and generated by the database, not the app", async () => {
    const mk = (id: string) =>
      owner.query(
        `INSERT INTO "Order" (id, ts, platform, fulfill, status, subtotal, discount, extra,
                              total, "paidTotal", cogs, "tradeCredit", "belowFloor", "soldById", "locationId")
         VALUES ($1, now(),'OFFLINE','PICKUP','LUNAS',0,0,0,0,0,0,0,false,$2,$3)
         RETURNING code`,
        [id, STAFF, LOC],
      );

    const a = await mk("o1");
    const b = await mk("o2");

    // SI-2026/07-000094 — the 94th sales invoice of July 2026.
    expect(a.rows[0].code).toMatch(/^SI-\d{4}\/\d{2}-\d{6}$/);
    expect(b.rows[0].code).not.toBe(a.rows[0].code);

    const seqA = Number(a.rows[0].code.slice(-6));
    const seqB = Number(b.rows[0].code.slice(-6));
    expect(seqB).toBe(seqA + 1);

    // Each document type counts independently.
    await owner.query(
      `INSERT INTO "Supplier" (id, name, active, "createdAt") VALUES ('s1','Supplier A',true,now())`,
    );
    const po = await owner.query(
      `INSERT INTO "PurchaseOrder" (id, "supplierId", "noInvoice", status, "orderedAt", subtotal,
                                    "feesTaxPct", "feesTotal", total, "locationId", "staffId", "createdAt")
       VALUES ('po1','s1',false,'DRAF',now(),0,0,0,0,$1,$2,now()) RETURNING code`,
      [LOC, STAFF],
    );
    expect(po.rows[0].code).toMatch(/^PI-\d{4}\/\d{2}-\d{6}$/);

    await rejectsWith(
      () => owner.query(`UPDATE "Order" SET code = $1 WHERE id = 'o2'`, [a.rows[0].code]),
      UNIQUE_VIOLATION,
    );
  });

  it("11. an opname session counts each serial once", async () => {
    await owner.query(
      `INSERT INTO "OpnameSession" (id, "locationId", status, "startedAt", "staffId")
       VALUES ('os1',$1,'BERJALAN',now(),$2)`,
      [LOC, STAFF],
    );
    const scan = (id: string) =>
      owner.query(
        `INSERT INTO "OpnameScan" (id, "sessionId", serial, result, at)
         VALUES ($1,'os1','SER-001','COCOK',now())`,
        [id],
      );

    await scan("sc1");
    await rejectsWith(() => scan("sc2"), UNIQUE_VIOLATION);
  });

  it("12. a webhook event is processed once", async () => {
    const wa = (id: string) =>
      owner.query(
        `INSERT INTO "WaMessage" (id, "waMessageId", "from", "msgType", ts, direction, status, entities, "answeredByAgent")
         VALUES ($1,'wamid.X','628123','text',now(),'IN','BARU','{}'::jsonb,false)`,
        [id],
      );
    await wa("m1");
    await rejectsWith(() => wa("m2"), UNIQUE_VIOLATION);

    await owner.query(
      `INSERT INTO "IgMedia" (id, "igMediaId", "fetchedAt") VALUES ('ig1','media_1',now())`,
    );
    const ig = (id: string) =>
      owner.query(
        `INSERT INTO "IgComment" (id, "igCommentId", "mediaId", "fromId", ts, status, "repliedByAgent")
         VALUES ($1,'comment_1','ig1','igsid_1',now(),'NEW',false)`,
        [id],
      );
    await ig("c1");
    await rejectsWith(() => ig("c2"), UNIQUE_VIOLATION);
  });

  it("13. the agent can never overwrite a staff directive", async () => {
    await owner.query(
      `INSERT INTO "WaThreadMemory" (id, "from", "summaryTurns", "clarifyCount", "updatedAt")
       VALUES ('tm1','628123',0,0,now())`,
    );

    // The agent may summarise...
    await agent.query(
      `UPDATE "WaThreadMemory" SET summary = 'ringkasan', "summaryAt" = now() WHERE id = 'tm1'`,
    );
    // ...but the directive column is not its to write.
    await rejectsWith(
      () => agent.query(`UPDATE "WaThreadMemory" SET directive = 'hijacked' WHERE id = 'tm1'`),
      INSUFFICIENT_PRIVILEGE,
    );

    // And the guarantee is symmetric: staff own the directive, not the summary.
    await app.query(
      `UPDATE "WaThreadMemory" SET directive = 'jangan kasih diskon' WHERE id = 'tm1'`,
    );
    await rejectsWith(
      () => app.query(`UPDATE "WaThreadMemory" SET summary = 'staff wrote this' WHERE id = 'tm1'`),
      INSUFFICIENT_PRIVILEGE,
    );

    const { rows } = await owner.query(
      `SELECT directive, summary FROM "WaThreadMemory" WHERE id = 'tm1'`,
    );
    expect(rows[0].directive).toBe("jangan kasih diskon");
    expect(rows[0].summary).toBe("ringkasan");
  });

  it("14. an audit row is never edited, and the ledger is append-only", async () => {
    await owner.query(
      `INSERT INTO "AuditLog" (id, at, entity, "entityId", action)
       VALUES ('a1', now(),'Unit',$1,'CREATE')`,
      [UNIT],
    );
    await owner.query(
      `INSERT INTO "UnitEvent" (id, "unitId", serial, seq, type, at, "toStatus", "costDelta", "staffId")
       VALUES ('ue1',$1,'SER-001',1,'DITERIMA',now(),'TERSEDIA',0,$2)`,
      [UNIT, STAFF],
    );

    // The app can append...
    await app.query(
      `INSERT INTO "AuditLog" (id, at, entity, "entityId", action)
       VALUES ('a2', now(),'Unit',$1,'UPDATE')`,
      [UNIT],
    );

    // ...and can do nothing else. "We can't", not "we don't".
    await rejectsWith(
      () => app.query(`UPDATE "AuditLog" SET action = 'CREATE' WHERE id = 'a1'`),
      INSUFFICIENT_PRIVILEGE,
    );
    await rejectsWith(
      () => app.query(`DELETE FROM "AuditLog" WHERE id = 'a1'`),
      INSUFFICIENT_PRIVILEGE,
    );
    await rejectsWith(
      () => app.query(`UPDATE "UnitEvent" SET "toStatus" = 'HILANG' WHERE id = 'ue1'`),
      INSUFFICIENT_PRIVILEGE,
    );
    await rejectsWith(
      () => app.query(`DELETE FROM "UnitEvent" WHERE id = 'ue1'`),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("15. a unit always has a location", async () => {
    await rejectsWith(
      () => owner.query(`UPDATE "Unit" SET "locationId" = NULL WHERE id = $1`, [UNIT]),
      NOT_NULL_VIOLATION,
    );
    // ON DELETE RESTRICT: a location in use cannot be removed from under a unit.
    await rejectsWith(
      () => owner.query(`DELETE FROM "Location" WHERE id = $1`, [LOC]),
      FOREIGN_KEY_VIOLATION,
    );
  });
});

describe("the app role has no DELETE anywhere", () => {
  it("cannot delete a business row either", async () => {
    await rejectsWith(
      () => app.query(`DELETE FROM "Unit" WHERE id = $1`, [UNIT]),
      INSUFFICIENT_PRIVILEGE,
    );
  });
});
