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
const UNDEFINED_COLUMN = "42703";
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
  // Payment.method became an FK to this table on 2026-08-24, so a fixture that
  // records a payment needs the method to exist first.
  await owner.query(
    `INSERT INTO "PaymentMethod" (id, code, label, "builtIn", "forPo", "forSale", active, "sortOrder", "createdAt")
     VALUES ('pm_tunai','TUNAI','Cash',true,true,true,true,1,now())`,
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
    await owner.query(`UPDATE "Unit" SET status = 'TERJUAL' WHERE id = $1`, [
      UNIT,
    ]);
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
          `INSERT INTO "Payment" (id, "orderId", direction, "methodId", amount, status, "staffId")
           VALUES ('p0',$1,'MASUK','pm_tunai',0,'LUNAS',$2)`,
          [ORDER, STAFF],
        ),
      CHECK_VIOLATION,
    );

    await owner.query(
      `INSERT INTO "Payment" (id, "orderId", direction, "methodId", amount, status, "staffId")
       VALUES ('p1',$1,'MASUK','pm_tunai',12000000,'LUNAS',$2)`,
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
        `INSERT INTO "Payment" (id, "orderId", "poId", direction, "methodId", amount, status, "staffId")
         VALUES ($1,$2,$3,'MASUK','pm_tunai',1000,'LUNAS',$4)`,
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

  it("7b. a payment against an opening balance names the customer, and flows the right way", async () => {
    // Owner answer 2026-09-22: a debt from before this app has no invoice or
    // sale, so the payment's one parent is the supplier or the customer.
    await owner.query(
      `INSERT INTO "Supplier" (id, name, active, "createdAt") VALUES ('sup1','Supplier A',true,now())`,
    );
    await owner.query(
      `INSERT INTO "Customer" (id, name, "createdAt") VALUES ('cus1','Pelanggan A',now())`,
    );
    /*
     * Three parents since 2026-09-24, not four: `Payment.supplierId` went with
     * `Supplier.openingBalance`, which was the only thing it carried. A
     * supplier is still paid — through `poId`, against an invoice.
     */
    const pay = (
      id: string,
      parents: { orderId?: string; poId?: string; customerId?: string },
      direction: "MASUK" | "KELUAR",
    ) =>
      owner.query(
        `INSERT INTO "Payment" (id, "orderId", "poId", "customerId", direction, "methodId", amount, status, "staffId")
         VALUES ($1,$2,$3,$4,$5,'pm_tunai',1000,'LUNAS',$6)`,
        [
          id,
          parents.orderId ?? null,
          parents.poId ?? null,
          parents.customerId ?? null,
          direction,
          STAFF,
        ],
      );

    // Two parents, each of which exists — the CHECK refuses, not a key.
    await rejectsWith(
      () => pay("two1", { orderId: ORDER, customerId: "cus1" }, "MASUK"),
      CHECK_VIOLATION,
    );
    // No parent at all is the same CHECK from the other side.
    await rejectsWith(() => pay("none1", {}, "MASUK"), CHECK_VIOLATION);
    // The shop is paid by a customer, never the reverse: that is a refund,
    // and a refund belongs to the sale it undoes.
    await rejectsWith(
      () => pay("wrong2", { customerId: "cus1" }, "KELUAR"),
      CHECK_VIOLATION,
    );
    // A party that does not exist is a foreign key failing.
    await rejectsWith(
      () => pay("ghost", { customerId: "nobody" }, "MASUK"),
      FOREIGN_KEY_VIOLATION,
    );
    // The column itself is gone (2026-09-24).
    await rejectsWith(
      () => owner.query(`SELECT "supplierId" FROM "Payment" LIMIT 1`),
      UNDEFINED_COLUMN,
    );

    await pay("cus_ok", { customerId: "cus1" }, "MASUK");
    // Money the owner paid personally still counts against the debt; the
    // switch defaults to "it went through the shop".
    const { rows } = await owner.query<{ inBalance: boolean }>(
      `SELECT "inBalance" FROM "Payment" WHERE id = 'cus_ok'`,
    );
    expect(rows.map((r) => r.inBalance)).toEqual([true]);
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
      `INSERT INTO "Discount" (id, code, type, pct, "usageLimit", used, active, scope)
       VALUES ('d1','LEBARAN','PCT',10,2,2,true,'SEMUA')`,
    );

    // The live mechanism: the WHERE is the lock, so the update simply misses.
    const res = await owner.query(
      `UPDATE "Discount" SET used = used + 1 WHERE id = 'd1' AND used < "usageLimit"`,
    );
    expect(res.rowCount).toBe(0);

    // And the backstop, if that statement is ever written wrongly.
    await rejectsWith(
      () =>
        owner.query(`UPDATE "Discount" SET used = used + 1 WHERE id = 'd1'`),
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
      () =>
        owner.query(`UPDATE "Order" SET code = $1 WHERE id = 'o2'`, [
          a.rows[0].code,
        ]),
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
      () =>
        agent.query(
          `UPDATE "WaThreadMemory" SET directive = 'hijacked' WHERE id = 'tm1'`,
        ),
      INSUFFICIENT_PRIVILEGE,
    );

    // And the guarantee is symmetric: staff own the directive, not the summary.
    await app.query(
      `UPDATE "WaThreadMemory" SET directive = 'jangan kasih diskon' WHERE id = 'tm1'`,
    );
    await rejectsWith(
      () =>
        app.query(
          `UPDATE "WaThreadMemory" SET summary = 'staff wrote this' WHERE id = 'tm1'`,
        ),
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
      () =>
        app.query(`UPDATE "AuditLog" SET action = 'CREATE' WHERE id = 'a1'`),
      INSUFFICIENT_PRIVILEGE,
    );
    await rejectsWith(
      () => app.query(`DELETE FROM "AuditLog" WHERE id = 'a1'`),
      INSUFFICIENT_PRIVILEGE,
    );
    await rejectsWith(
      () =>
        app.query(
          `UPDATE "UnitEvent" SET "toStatus" = 'HILANG' WHERE id = 'ue1'`,
        ),
      INSUFFICIENT_PRIVILEGE,
    );
    await rejectsWith(
      () => app.query(`DELETE FROM "UnitEvent" WHERE id = 'ue1'`),
      INSUFFICIENT_PRIVILEGE,
    );

    // The two edits the owner admitted on 2026-09-23, and the database's own
    // line around them (20260924130000): a row's serial may follow its unit
    // to a corrected one — that column and no other...
    await app.query(
      `UPDATE "UnitEvent" SET serial = 'SER-001X' WHERE id = 'ue1'`,
    );
    await rejectsWith(
      () => app.query(`UPDATE "UnitEvent" SET seq = 9 WHERE id = 'ue1'`),
      INSUFFICIENT_PRIVILEGE,
    );
    // ...and a unit's last rows may be taken back through the one function
    // that can, which refuses the last one standing and anything under the
    // top of the chain.
    await rejectsWith(
      () => app.query(`SELECT unit_event_drop_last(ARRAY['ue1'])`),
      CHECK_VIOLATION,
    );
    await owner.query(
      `INSERT INTO "UnitEvent" (id, "unitId", serial, seq, type, at, "toStatus", "costDelta", "staffId")
       VALUES ('ue2',$1,'SER-001X',2,'QC_SELESAI',now(),'TERSEDIA',0,$2),
              ('ue3',$1,'SER-001X',3,'TERJUAL',now(),'TERJUAL',0,$2)`,
      [UNIT, STAFF],
    );
    await rejectsWith(
      () => app.query(`SELECT unit_event_drop_last(ARRAY['ue2'])`),
      CHECK_VIOLATION,
    );
    const { rows } = await app.query<{ n: number }>(
      `SELECT unit_event_drop_last(ARRAY['ue3','ue2']) AS n`,
    );
    expect(rows[0]!.n).toBe(2);
    const { rows: left } = await owner.query<{ id: string }>(
      `SELECT id FROM "UnitEvent" WHERE "unitId" = $1 ORDER BY seq`,
      [UNIT],
    );
    expect(left.map((r) => r.id)).toEqual(["ue1"]);

    // Since 2026-10-22 any row may go (20261022140000) — from the middle too —
    // but never the last one standing.
    await owner.query(
      `INSERT INTO "UnitEvent" (id, "unitId", serial, seq, type, at, "toStatus", "costDelta", "staffId")
       VALUES ('ue4',$1,'SER-001X',4,'QC_SELESAI',now(),'TERSEDIA',0,$2),
              ('ue5',$1,'SER-001X',5,'DICATAT',now(),'TERSEDIA',0,$2)`,
      [UNIT, STAFF],
    );
    const { rows: mid } = await app.query<{ n: number }>(
      `SELECT unit_event_drop(ARRAY['ue4']) AS n`,
    );
    expect(mid[0]!.n).toBe(1);
    await rejectsWith(
      () => app.query(`SELECT unit_event_drop(ARRAY['ue1','ue5'])`),
      CHECK_VIOLATION,
    );
    const { rows: kept } = await owner.query<{ id: string }>(
      `SELECT id FROM "UnitEvent" WHERE "unitId" = $1 ORDER BY seq`,
      [UNIT],
    );
    expect(kept.map((r) => r.id)).toEqual(["ue1", "ue5"]);
  });

  it("15. a unit always has a location", async () => {
    await rejectsWith(
      () =>
        owner.query(`UPDATE "Unit" SET "locationId" = NULL WHERE id = $1`, [
          UNIT,
        ]),
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

describe("an unused discount can be deleted (2026-10-02)", () => {
  it("grants DELETE on the discount tables to the app alone", async () => {
    const { rows } = await owner.query(
      `SELECT has_table_privilege('nusantara_app','"Discount"','DELETE')      AS app_discount,
              has_table_privilege('nusantara_app','"DiscountSku"','DELETE')   AS app_sku,
              has_table_privilege('nusantara_agent','"Discount"','DELETE')    AS agent_discount,
              has_table_privilege('nusantara_app','"Discount"','TRUNCATE')    AS app_truncate`,
    );
    expect(rows[0]).toEqual({
      app_discount: true,
      app_sku: true,
      agent_discount: false,
      app_truncate: false,
    });
  });
});

describe("an unused supplier or customer can be deleted (2026-10-21)", () => {
  it("grants DELETE on the three tables to the app alone", async () => {
    const { rows } = await owner.query(
      `SELECT has_table_privilege('nusantara_app','"Supplier"','DELETE')        AS app_supplier,
              has_table_privilege('nusantara_app','"Customer"','DELETE')        AS app_customer,
              has_table_privilege('nusantara_app','"CustomerAddress"','DELETE') AS app_address,
              has_table_privilege('nusantara_agent','"Customer"','DELETE')      AS agent_customer,
              has_table_privilege('nusantara_app','"Customer"','TRUNCATE')      AS app_truncate`,
    );
    expect(rows[0]).toEqual({
      app_supplier: true,
      app_customer: true,
      app_address: true,
      agent_customer: false,
      app_truncate: false,
    });
  });
});

describe("an Income & Expense adjustment can be deleted (2026-10-24)", () => {
  it("grants DELETE on the two tables to the app alone", async () => {
    const { rows } = await owner.query(
      `SELECT has_table_privilege('nusantara_app','"Expense"','DELETE')         AS app_expense,
              has_table_privilege('nusantara_app','"ManualIncome"','DELETE')    AS app_income,
              has_table_privilege('nusantara_agent','"Expense"','DELETE')       AS agent_expense,
              has_table_privilege('nusantara_app','"Expense"','TRUNCATE')       AS app_truncate`,
    );
    expect(rows[0]).toEqual({
      app_expense: true,
      app_income: true,
      agent_expense: false,
      app_truncate: false,
    });
  });
});

describe("a service charge or visit can be deleted (2026-10-26)", () => {
  it("grants DELETE on the two service tables to the app alone, and nothing beside them", async () => {
    const { rows } = await owner.query(
      `SELECT has_table_privilege('nusantara_app','"ServiceVisit"','DELETE')   AS app_visit,
              has_table_privilege('nusantara_app','"ServiceFee"','DELETE')     AS app_fee,
              has_table_privilege('nusantara_agent','"ServiceFee"','DELETE')   AS agent_fee,
              has_table_privilege('nusantara_app','"ServiceFee"','TRUNCATE')   AS app_truncate,
              has_table_privilege('nusantara_app','"Unit"','DELETE')           AS app_unit,
              has_table_privilege('nusantara_app','"UnitEvent"','DELETE')      AS app_event,
              has_table_privilege('nusantara_app','"Payment"','DELETE')        AS app_payment,
              has_table_privilege('nusantara_app','"UnitReturn"','DELETE')     AS app_return,
              has_table_privilege('nusantara_app','"PurchaseOrder"','DELETE')  AS app_po`,
    );
    expect(rows[0]).toEqual({
      app_visit: true,
      app_fee: true,
      agent_fee: false,
      app_truncate: false,
      app_unit: false,
      app_event: false,
      app_payment: false,
      app_return: false,
      app_po: false,
    });
  });
});

// ---------------------------------------------------------------------------

describe("the ledger's two admitted edits (2026-09-23, in the database 2026-09-24)", () => {
  it("grants the serial column and the drop-last function, and nothing beside them", async () => {
    // Column grant and a definer function only, so the table-level UPDATE and
    // DELETE that the 20260913 self-check and the deploy's grant query read
    // stay false.
    const { rows } = await owner.query(
      `SELECT has_column_privilege('nusantara_app','"UnitEvent"','serial','UPDATE')   AS serial,
              has_column_privilege('nusantara_app','"UnitEvent"','toStatus','UPDATE') AS to_status,
              has_column_privilege('nusantara_app','"UnitEvent"','seq','UPDATE')      AS seq,
              has_table_privilege('nusantara_app','"UnitEvent"','UPDATE')             AS table_update,
              has_table_privilege('nusantara_app','"UnitEvent"','DELETE')             AS table_delete,
              has_function_privilege('nusantara_app','unit_event_drop_last(text[])','EXECUTE')   AS drop_last,
              has_function_privilege('nusantara_agent','unit_event_drop_last(text[])','EXECUTE') AS agent_drop_last`,
    );
    expect(rows[0]).toEqual({
      serial: true,
      to_status: false,
      seq: false,
      table_update: false,
      table_delete: false,
      drop_last: true,
      agent_drop_last: false,
    });
  });
});

describe("clearing the activity log (2026-10-22)", () => {
  it("is one definer function, and the table stays append-only", async () => {
    // No table-level DELETE, UPDATE or TRUNCATE: the only way the app empties
    // the log is audit_log_clear(), which takes EVERY row or none — there is
    // no form of it that edits the history by removing single lines.
    const { rows } = await owner.query(
      `SELECT has_function_privilege('nusantara_app','audit_log_clear()','EXECUTE')   AS app_clear,
              has_function_privilege('nusantara_agent','audit_log_clear()','EXECUTE') AS agent_clear,
              has_table_privilege('nusantara_app','"AuditLog"','DELETE')               AS app_delete,
              has_table_privilege('nusantara_app','"AuditLog"','UPDATE')               AS app_update,
              has_table_privilege('nusantara_app','"AuditLog"','TRUNCATE')             AS app_truncate`,
    );
    expect(rows[0]).toEqual({
      app_clear: true,
      agent_clear: false,
      app_delete: false,
      app_update: false,
      app_truncate: false,
    });

    await owner.query(
      `INSERT INTO "AuditLog" (id, at, entity, "entityId", action)
       VALUES ('clr1', now(),'Unit','x','CREATE'), ('clr2', now(),'Unit','y','UPDATE')`,
    );
    await rejectsWith(
      () => app.query(`DELETE FROM "AuditLog" WHERE id = 'clr1'`),
      INSUFFICIENT_PRIVILEGE,
    );
    const { rows: cleared } = await app.query<{ n: number }>(
      `SELECT audit_log_clear() AS n`,
    );
    expect(cleared[0]!.n).toBe(2);
    const { rows: left } = await owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM "AuditLog"`,
    );
    expect(left[0]!.n).toBe("0");
  });
});

describe("clearing and deleting a chat, taking a rating back (2026-10-27)", () => {
  it("gives the clear to the app role alone (invariant 13)", async () => {
    const { rows } = await owner.query(
      `SELECT has_column_privilege('nusantara_app','"WaThreadMemory"','clearedAt','UPDATE')     AS app_at,
              has_column_privilege('nusantara_app','"WaThreadMemory"','clearedById','UPDATE')   AS app_by,
              has_column_privilege('nusantara_agent','"WaThreadMemory"','clearedAt','UPDATE')   AS agent_at,
              has_column_privilege('nusantara_agent','"WaThreadMemory"','clearedById','UPDATE') AS agent_by,
              has_column_privilege('nusantara_agent','"WaThreadMemory"','clearedAt','INSERT')   AS agent_insert`,
    );
    expect(rows[0]).toEqual({
      app_at: true,
      app_by: true,
      agent_at: false,
      agent_by: false,
      agent_insert: false,
    });

    await owner.query(
      `INSERT INTO "WaThreadMemory" (id, "from", "summaryTurns", "clarifyCount", "updatedAt")
       VALUES ('tm_clr', '628111000777', 0, 0, now())`,
    );
    await rejectsWith(
      () =>
        agent.query(
          `UPDATE "WaThreadMemory" SET "clearedAt" = now(), "clearedById" = $1 WHERE id = 'tm_clr'`,
          [STAFF],
        ),
      INSUFFICIENT_PRIVILEGE,
    );
    // A clear names who; a name means a clear.
    await rejectsWith(
      () =>
        app.query(
          `UPDATE "WaThreadMemory" SET "clearedAt" = now() WHERE id = 'tm_clr'`,
        ),
      CHECK_VIOLATION,
    );
    await app.query(
      `UPDATE "WaThreadMemory" SET "clearedAt" = now(), "clearedById" = $1 WHERE id = 'tm_clr'`,
      [STAFF],
    );
  });

  it("deletes a conversation through one definer function the agent cannot call", async () => {
    const { rows } = await owner.query(
      `SELECT has_function_privilege('nusantara_app','wa_thread_delete(text, text, timestamp)','EXECUTE')   AS app_fn,
              has_function_privilege('nusantara_agent','wa_thread_delete(text, text, timestamp)','EXECUTE') AS agent_fn,
              has_table_privilege('nusantara_app','"WaMessage"','DELETE')        AS app_msg,
              has_table_privilege('nusantara_app','"AgentEvaluation"','DELETE')  AS app_eval,
              has_table_privilege('nusantara_agent','"AgentEvaluation"','DELETE') AS agent_eval,
              has_table_privilege('nusantara_app','"AgentCorrection"','DELETE')  AS app_corr`,
    );
    expect(rows[0]).toEqual({
      app_fn: true,
      agent_fn: false,
      app_msg: false,
      app_eval: true,
      agent_eval: false,
      app_corr: false,
    });

    const FROM = "628111000778";
    await owner.query(
      `INSERT INTO "WaMessage" (id, "waMessageId", "from", "msgType", ts, direction, status, entities, "answeredByAgent", "replyText", "answeredAt")
       VALUES ('wm_d1','wamid.d1',$1,'text',now(),'IN','DIJAWAB_AGEN','{}',true,'halo kak', now()),
              ('wm_d2','wamid.d2',$1,'text',now(),'IN','DIJAWAB_AGEN','{}',true,'ada kak', now())`,
      [FROM],
    );
    await owner.query(
      `INSERT INTO "AgentEvaluation" (id, "messageId", rating, "createdById", "createdAt")
       VALUES ('ev_d1','wm_d1','GOOD',$1, now())`,
      [STAFF],
    );
    await rejectsWith(
      () => app.query(`DELETE FROM "WaMessage" WHERE id = 'wm_d2'`),
      INSUFFICIENT_PRIVILEGE,
    );
    await rejectsWith(
      () =>
        agent.query(`SELECT wa_thread_delete($1, $2, now()::timestamp)`, [
          FROM,
          STAFF,
        ]),
      INSUFFICIENT_PRIVILEGE,
    );
    const { rows: n } = await app.query<{ n: number }>(
      `SELECT wa_thread_delete($1, $2, now()::timestamp) AS n`,
      [FROM, STAFF],
    );
    expect(n[0]!.n).toBe(1);
    // The rated message stays, hidden behind a fresh clear.
    const { rows: left } = await owner.query(
      `SELECT m.id, t."clearedById" FROM "WaMessage" m
         JOIN "WaThreadMemory" t ON t."from" = m."from"
        WHERE m."from" = $1`,
      [FROM],
    );
    expect(left).toEqual([{ id: "wm_d1", clearedById: STAFF }]);
    // And a rating can be taken back by the app role.
    await app.query(`DELETE FROM "AgentEvaluation" WHERE id = 'ev_d1'`);
  });
});

describe("a picture staff sent from their own device (2026-10-27)", () => {
  const FROM = "628111000779";
  const PNG = "\\x89504e470d0a1a0a";

  it("is written by the app, read by the agent, deleted by neither", async () => {
    const { rows } = await owner.query(
      `SELECT has_table_privilege('nusantara_app','"ChatMedia"','INSERT')     AS app_insert,
              has_table_privilege('nusantara_app','"ChatMedia"','SELECT')     AS app_select,
              has_table_privilege('nusantara_app','"ChatMedia"','UPDATE')     AS app_update,
              has_table_privilege('nusantara_app','"ChatMedia"','DELETE')     AS app_delete,
              has_table_privilege('nusantara_agent','"ChatMedia"','SELECT')   AS agent_select,
              has_table_privilege('nusantara_agent','"ChatMedia"','INSERT')   AS agent_insert,
              has_table_privilege('nusantara_agent','"ChatMedia"','DELETE')   AS agent_delete,
              has_table_privilege('nusantara_readonly','"ChatMedia"','SELECT') AS ro_select`,
    );
    expect(rows[0]).toEqual({
      app_insert: true,
      app_select: true,
      app_update: false,
      app_delete: false,
      agent_select: true,
      agent_insert: false,
      agent_delete: false,
      ro_select: true,
    });

    await app.query(
      `INSERT INTO "ChatMedia" (id, "from", data, "contentType", size, "uploadedById")
       VALUES ('cm_1', $1, $2::bytea, 'image/png', 8, $3)`,
      [FROM, PNG, STAFF],
    );
    const { rows: read } = await agent.query(
      `SELECT size FROM "ChatMedia" WHERE id = 'cm_1'`,
    );
    expect(read).toEqual([{ size: 8 }]);
    await rejectsWith(
      () => app.query(`DELETE FROM "ChatMedia" WHERE id = 'cm_1'`),
      INSUFFICIENT_PRIVILEGE,
    );
    await rejectsWith(
      () => app.query(`UPDATE "ChatMedia" SET size = 8 WHERE id = 'cm_1'`),
      INSUFFICIENT_PRIVILEGE,
    );
    await rejectsWith(
      () =>
        agent.query(
          `INSERT INTO "ChatMedia" (id, "from", data, "contentType", size, "uploadedById")
           VALUES ('cm_2', $1, $2::bytea, 'image/png', 8, $3)`,
          [FROM, PNG, STAFF],
        ),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("holds the route's rules: three types, a true size, 5 MB at most", async () => {
    const insert = (type: string, size: number, from = FROM) =>
      app.query(
        `INSERT INTO "ChatMedia" (id, "from", data, "contentType", size, "uploadedById")
         VALUES ('cm_' || md5(random()::text), $1, $2::bytea, $3, $4, $5)`,
        [from, PNG, type, size, STAFF],
      );
    await rejectsWith(() => insert("image/gif", 8), CHECK_VIOLATION);
    await rejectsWith(() => insert("image/png", 9), CHECK_VIOLATION);
    await rejectsWith(() => insert("image/png", 8, "+62811"), CHECK_VIOLATION);
    await insert("image/webp", 8);
  });

  it("goes with a deleted conversation, and only that one's", async () => {
    await owner.query(
      `INSERT INTO "WaMessage" (id, "waMessageId", "from", "msgType", ts, direction, status, entities, "answeredByAgent")
       VALUES ('wm_p1','wamid.p1',$1,'text',now(),'IN','BARU','{}',false)`,
      [FROM],
    );
    await owner.query(
      `INSERT INTO "ChatMedia" (id, "from", data, "contentType", size, "uploadedById")
       VALUES ('cm_mine', $1, $3::bytea, 'image/png', 8, $4),
              ('cm_theirs', $2, $3::bytea, 'image/png', 8, $4)`,
      [FROM, "628111000780", PNG, STAFF],
    );
    const { rows: n } = await app.query<{ n: number }>(
      `SELECT wa_thread_delete($1, $2, now()::timestamp) AS n`,
      [FROM, STAFF],
    );
    expect(n[0]!.n).toBe(2);
    const { rows: left } = await owner.query(
      `SELECT id FROM "ChatMedia" WHERE id IN ('cm_mine','cm_theirs')`,
    );
    expect(left).toEqual([{ id: "cm_theirs" }]);
  });
});

describe("the stock movement history (2026-09-24)", () => {
  it("is correctable per column and never as a ledger", async () => {
    // What a person can get wrong is granted; what the row IS is not. Column
    // grants only, so the table-level UPDATE that the 20260913 self-check and
    // the deploy's grant query read stays false.
    const { rows } = await owner.query(
      `SELECT has_column_privilege('nusantara_app','"StockAdjustment"','description','UPDATE') AS adj_description,
              has_column_privilege('nusantara_app','"StockAdjustment"','at','UPDATE')          AS adj_at,
              has_column_privilege('nusantara_app','"StockAdjustment"','unitId','UPDATE')      AS adj_unit,
              has_column_privilege('nusantara_app','"StockAdjustment"','kind','UPDATE')        AS adj_kind,
              has_column_privilege('nusantara_app','"StockMove"','note','UPDATE')              AS move_note,
              has_column_privilege('nusantara_app','"StockMove"','qty','UPDATE')               AS move_qty,
              has_table_privilege('nusantara_app','"StockMove"','UPDATE')                      AS move_table,
              has_table_privilege('nusantara_app','"StockAdjustment"','UPDATE')                AS adj_table,
              has_table_privilege('nusantara_app','"StockMove"','DELETE')                      AS move_delete`,
    );
    expect(rows[0]).toEqual({
      adj_description: true,
      adj_at: true,
      adj_unit: false,
      adj_kind: false,
      move_note: true,
      move_qty: false,
      move_table: false,
      adj_table: false,
      move_delete: false,
    });
  });
});
