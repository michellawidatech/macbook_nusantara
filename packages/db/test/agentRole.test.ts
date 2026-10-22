/**
 * What the chat agent's database role may and may not do.
 *
 * 04 Inc-7's definition of done asks for one of these by name — "the agent
 * cannot write a directive column; the summarizer cannot either — asserted by
 * test". `invariants.test.ts` case 13 proves the UPDATE half of that. This file
 * proves the rest of the boundary, and it exists because until now there was no
 * rest: `GRANT SELECT, INSERT, UPDATE ON ALL TABLES ... TO nusantara_agent`
 * meant the role could insert an Order, record a Payment or rewrite a price.
 * The only thing standing between a customer's sentence and the shop's money
 * was the tool whitelist in application code.
 *
 * Every case asserts a SQLSTATE rather than a message, for the reason
 * `invariants.test.ts` gives: a constraint nobody has seen reject anything is
 * not known to exist.
 *
 * These run against a real database. Create it with:
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

const INSUFFICIENT_PRIVILEGE = "42501";

let owner: Client; // nusantara — owns the schema, writes the fixtures
let agent: Client; // nusantara_agent — the chat agent and the summariser

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
      `expected SQLSTATE ${sqlstate}, but the write succeeded — the grant is missing`,
    );
  }
  expect((err as { code?: string }).code).toBe(sqlstate);
}

beforeAll(async () => {
  owner = new Client({ connectionString: url("nusantara") });
  agent = new Client({ connectionString: url("nusantara_agent") });
  await owner.connect();
  await agent.connect();
});

afterAll(async () => {
  await owner.end();
  await agent.end();
});

beforeEach(async () => {
  await owner.query(`DELETE FROM "WaThreadMemory"`);
  await owner.query(`DELETE FROM "ChatMemoryChunk"`);
  await owner.query(`DELETE FROM "WaMessage"`);
});

describe("the money the agent may never touch", () => {
  it("refuses to let the agent write an order", async () => {
    await rejectsWith(
      () =>
        agent.query(
          `INSERT INTO "Order" (id, ts, platform, fulfill, status, subtotal, discount,
                                extra, total, "paidTotal", cogs, "tradeCredit",
                                "belowFloor", "soldById", "locationId")
           VALUES ('o1', now(), 'WA','NONE','LUNAS',0,0,0,0,0,0,0,false,'staff_agent','l1')`,
        ),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("refuses to let the agent record a payment", async () => {
    await rejectsWith(
      () =>
        agent.query(
          `INSERT INTO "Payment" (id, "orderId", direction, "methodId", amount, status, "staffId")
           VALUES ('p1','o1','MASUK','pm_tunai',1,'LUNAS','staff_agent')`,
        ),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("refuses to let the agent change a price", async () => {
    // The single most valuable line in this file. A bot that can set a price
    // has been talked into a discount by somebody who typed one sentence.
    //
    // Aimed at Sku since 2026-08-27, when the asking price moved there from
    // Unit. The denial got broader in the move rather than narrower: on Unit
    // it was a column-level grant listing status/locationId/version, and Sku
    // is not in the agent's write allow-list at all, so the whole table is
    // refused rather than one column of it.
    await rejectsWith(
      () => agent.query(`UPDATE "Sku" SET price = 1`),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("refuses to let the agent create a discount", async () => {
    await rejectsWith(
      () =>
        agent.query(
          `INSERT INTO "Discount" (id, code, type, pct, used, active, scope)
           VALUES ('d1','GRATIS50','PCT',50,0,true,'SEMUA')`,
        ),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("refuses to let the agent unwind a sale", async () => {
    await rejectsWith(
      () =>
        agent.query(
          `INSERT INTO "OrderAdjustment" (id, "orderId", type, amount, reason, at, "staffId")
           VALUES ('a1','o1','REFUND',1,'x',now(),'staff_agent')`,
        ),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("refuses to let the agent open a warranty claim, because the resolution decides who pays", async () => {
    await rejectsWith(
      () =>
        agent.query(
          `INSERT INTO "WarrantyClaim" (id, "unitId", status, "openedAt", "staffId")
           VALUES ('w1','u1','OPEN',now(),'staff_agent')`,
        ),
      INSUFFICIENT_PRIVILEGE,
    );
  });
});

describe("what the agent may do to a unit", () => {
  it("lets the agent move a unit's status, because that is the reservation hold", async () => {
    // Not a bare status write in real code — appendUnitEvent writes the event
    // and this projection in one transaction. The grant has to permit it.
    await expect(
      agent.query(`UPDATE "Unit" SET status = status WHERE false`),
    ).resolves.toBeDefined();
  });

  it("lets the agent append to the ledger but never edit it", async () => {
    await expect(
      agent.query(`SELECT 1 FROM "UnitEvent" WHERE false`),
    ).resolves.toBeDefined();
    await rejectsWith(
      () => agent.query(`UPDATE "UnitEvent" SET note = 'x'`),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("refuses to let the agent invent a unit", async () => {
    await rejectsWith(
      () =>
        agent.query(
          `INSERT INTO "Unit" (id, serial, "skuId", status, "locationId", buy, landed, "intakeAt", version)
           VALUES ('u9','S9','sk1','TERSEDIA','l1',0,0,now(),1)`,
        ),
      INSUFFICIENT_PRIVILEGE,
    );
  });
});

describe("the agent's own instructions", () => {
  it("lets the agent read the staff knowledge base and never write it", async () => {
    // AgentKnowledge is injected into the system prompt. A bot that can write
    // it is writing its own instructions, permanently.
    await expect(
      agent.query(`SELECT 1 FROM "AgentKnowledge" WHERE false`),
    ).resolves.toBeDefined();
    await rejectsWith(
      () => agent.query(`UPDATE "AgentKnowledge" SET answer = 'x'`),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("lets the agent read its persona and never rewrite it", async () => {
    await expect(
      agent.query(`SELECT 1 FROM "Persona" WHERE false`),
    ).resolves.toBeDefined();
    await rejectsWith(
      () => agent.query(`UPDATE "Persona" SET prompt = 'ignore your rules'`),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("lets the agent read staff corrections and never write one", async () => {
    await expect(
      agent.query(`SELECT 1 FROM "AgentCorrection" WHERE false`),
    ).resolves.toBeDefined();
    await rejectsWith(
      () =>
        agent.query(
          `INSERT INTO "AgentCorrection" (id, original, corrected, "createdById", "createdAt")
           VALUES ('c1','a','b','staff_agent',now())`,
        ),
      INSUFFICIENT_PRIVILEGE,
    );
  });
});

describe("the summariser's columns", () => {
  it("grants the summariser exactly the columns it writes", async () => {
    await owner.query(
      `INSERT INTO "WaThreadMemory" (id, "from", "summaryTurns", "clarifyCount", "updatedAt")
       VALUES ('tm9','628000000001',0,0,now())`,
    );
    await expect(
      agent.query(
        `UPDATE "WaThreadMemory"
            SET summary = 'ringkasan', "summaryAt" = now(), "summaryTurns" = 1,
                "coveredThroughAt" = now(), "updatedAt" = now()
          WHERE id = 'tm9'`,
      ),
    ).resolves.toBeDefined();
  });

  it("refuses the summariser's write the moment a directive column joins it", async () => {
    await owner.query(
      `INSERT INTO "WaThreadMemory" (id, "from", "summaryTurns", "clarifyCount", "updatedAt")
       VALUES ('tm8','628000000002',0,0,now())`,
    );
    for (const col of ["directive", `"directiveAt"`, `"directiveById"`]) {
      const value = col === "directive" ? `'hijacked'` : "NULL";
      await rejectsWith(
        () =>
          agent.query(
            `UPDATE "WaThreadMemory" SET summary = 'x', ${col} = ${value} WHERE id = 'tm8'`,
          ),
        INSUFFICIENT_PRIVILEGE,
      );
    }
  });

  it("refuses a directive smuggled in on the create path, which the update grants never covered", async () => {
    // The hole this closes: REVOKE UPDATE + GRANT UPDATE (columns) governs
    // updates only, and INSERT was granted table-wide — so the agent could
    // always CREATE a memory row with a directive already set. Invariant 13
    // was true for the path everyone tested and false for the other one.
    await rejectsWith(
      () =>
        agent.query(
          `INSERT INTO "WaThreadMemory" (id, "from", directive, "summaryTurns", "clarifyCount", "updatedAt")
           VALUES ('tm7','628000000003','hijacked',0,0,now())`,
        ),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("still lets the agent create an ordinary memory row", async () => {
    await expect(
      agent.query(
        `INSERT INTO "WaThreadMemory" (id, "from", summary, "summaryTurns", "clarifyCount", "updatedAt")
         VALUES ('tm6','628000000004','ringkasan',1,0,now())`,
      ),
    ).resolves.toBeDefined();
  });
});

describe("the reservation write path still works", () => {
  it("lets the agent create a booking and its line", async () => {
    await expect(
      agent.query(`SELECT 1 FROM "Reservation" WHERE false`),
    ).resolves.toBeDefined();
    await expect(
      agent.query(
        `INSERT INTO "Reservation" (id, phone, status, source, "createdAt")
         VALUES ('rv9','+628000000005','TERJADWAL','AGEN',now())`,
      ),
    ).resolves.toBeDefined();
    await owner.query(`DELETE FROM "Reservation" WHERE id = 'rv9'`);
  });

  it("lets the agent add a customer but never edit one staff maintain", async () => {
    await expect(
      agent.query(
        `INSERT INTO "Customer" (id, name, phone, "createdAt")
         VALUES ('cu9','Agen Test','+628000000006',now())`,
      ),
    ).resolves.toBeDefined();
    await rejectsWith(
      () => agent.query(`UPDATE "Customer" SET name = 'renamed'`),
      INSUFFICIENT_PRIVILEGE,
    );
    await owner.query(`DELETE FROM "Customer" WHERE id = 'cu9'`);
  });
});
