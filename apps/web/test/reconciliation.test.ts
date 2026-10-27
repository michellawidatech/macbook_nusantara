/**
 * Reconciliation's rules (owner ask 2026-10-27) — `lib/reconciliation.ts`:
 * the POS balance per pot per day, correcting a record the way its own screen
 * would, saving a count, "changed since reconciled", what blocks deleting a
 * record a reconciliation names, and the monthly statement's lines.
 */
import { describe, expect, it } from "vitest";
import dayjs from "dayjs";
import { buildSeed, type MockDb, type Order } from "../src/mock/seed.js";
import { cashflowRows } from "../src/lib/cashflowRows.js";
import { makeT } from "../src/i18n/translate.js";
import {
  adjustmentReconciliationBlock,
  deleteAdjustment,
} from "../src/lib/adjustmentDeletion.js";
import {
  applyAmountEdit,
  canCloseMonth,
  changedSinceReconciled,
  closedReconciliationNaming,
  dailyStatus,
  editBlock,
  editRows,
  heldSuggestions,
  linesOf,
  monthCounts,
  posBalanceAt,
  potMovements,
  rejectSuggestion,
  runMatching,
  toPosMovement,
  unreconciledPots,
  upsertDaily,
  uploadStatement,
  type EditContext,
} from "../src/lib/reconciliation.js";

const t = makeT("en");
let n = 0;
const ctx: EditContext = {
  at: "2026-09-30T10:00:00.000Z",
  staff: "Dina",
  nextId: (p) => `${p}-${++n}`,
};
/** A local instant on a day, at an hour. */
const at = (day: string, hour = 10) =>
  dayjs(`${day}T${String(hour).padStart(2, "0")}:00:00`).toISOString();

/** The demo shop with no money in it: opening Rp1jt cash, Rp10jt bank. */
function shop(): MockDb {
  const db = buildSeed();
  const sale = db.orders[0]!;
  db.orders = [];
  db.expenses = [];
  db.incomes = [];
  db.deposits = [];
  db.pos = db.pos.map((p) => ({ ...p, payments: [] }));
  db.customers = db.customers.map((c) => {
    const { openingPayments: _drop, ...rest } = c;
    return rest;
  });
  db.settings = {
    ...db.settings,
    openingCash: 1_000_000,
    openingBank: 10_000_000,
    openingBalanceAt: dayjs("2026-09-01").startOf("day").toISOString(),
  };
  // A template to copy sales from.
  (db as MockDb & { template: Order }).template = sale;
  return db;
}

function sale(
  db: MockDb,
  id: string,
  day: string,
  amount: number,
  method = "TRANSFER",
): Order {
  const tpl = (db as MockDb & { template: Order }).template;
  const o: Order = {
    ...tpl,
    id,
    code: `SI-${id}`,
    ts: at(day),
    serials: [],
    prices: {},
    listPrices: {},
    lines: [],
    discount: 0,
    total: amount,
    payMethod: method,
    settled: true,
    payments: [
      { id: `${id}-p1`, method, amount, state: "SETTLED", at: at(day) },
    ],
  };
  delete o.discountId;
  db.orders.push(o);
  return o;
}

const rowsOf = (db: MockDb) => cashflowRows(db, t);

describe("the POS balance per pot per day", () => {
  it("is the opening plus the settled movements of that pot up to the end of the day", () => {
    const db = shop();
    sale(db, "s1", "2026-09-02", 2_000_000, "TRANSFER");
    sale(db, "s2", "2026-09-02", 300_000, "TUNAI");
    sale(db, "s3", "2026-09-03", 1_000_000, "TRANSFER");
    db.expenses.push({
      id: "e1",
      kind: "OPERATIONAL",
      amount: 50_000,
      date: "2026-09-02",
      method: "TUNAI",
      createdAt: at("2026-09-02", 15),
    });
    const rows = rowsOf(db);
    expect(posBalanceAt(rows, db.settings, "BANK", "2026-09-01")).toBe(
      10_000_000,
    );
    expect(posBalanceAt(rows, db.settings, "BANK", "2026-09-02")).toBe(
      12_000_000,
    );
    expect(posBalanceAt(rows, db.settings, "CASH", "2026-09-02")).toBe(
      1_250_000,
    );
    expect(posBalanceAt(rows, db.settings, "BANK", "2026-09-03")).toBe(
      13_000_000,
    );
    expect(
      potMovements(rows, db.settings, "CASH", "2026-09-02", "2026-09-02").map(
        (r) => r.key,
      ),
    ).toEqual(["p-s2-s2-p1", "e-e1"]);
  });

  it("leaves out pending money and money that passed through no pot", () => {
    const db = shop();
    const o = sale(db, "s1", "2026-09-02", 2_000_000, "TRANSFER");
    o.payments = [
      {
        id: "x",
        method: "MARKETPLACE",
        amount: 2_000_000,
        state: "PENDING",
        at: at("2026-09-02"),
      },
    ];
    db.expenses.push({
      id: "e1",
      kind: "SUPPLIER",
      amount: 500_000,
      date: "2026-09-02",
      method: "TRANSFER_LUAR",
    });
    const rows = rowsOf(db);
    expect(posBalanceAt(rows, db.settings, "BANK", "2026-09-02")).toBe(
      10_000_000,
    );
    expect(
      potMovements(rows, db.settings, "BANK", "2026-09-02", "2026-09-02"),
    ).toEqual([]);
  });
});

describe("correcting a record's amount", () => {
  it("corrects a sale payment the way Transaction History does — the shortfall becomes owed, and it is logged", () => {
    const db = shop();
    sale(db, "s1", "2026-09-02", 2_000_000);
    const edits = applyAmountEdit(
      db,
      { kind: "salePayment", orderId: "s1", paymentId: "s1-p1" },
      1_900_000,
      ctx,
    );
    expect(edits).toEqual([
      { ref: { paymentId: "s1-p1" }, before: 2_000_000, after: 1_900_000 },
    ]);
    const o = db.orders.find((x) => x.id === "s1")!;
    expect(o.payments!.map((p) => [p.state, p.amount])).toEqual([
      ["SETTLED", 1_900_000],
      ["DUE", 100_000],
    ]);
    expect(o.settled).toBe(false);
    expect(db.paymentLog.map((l) => l.action).sort()).toEqual([
      "ADDED",
      "AMENDED",
    ]);
    expect(db.paymentLog.every((l) => l.reason === "Rekonsiliasi")).toBe(true);
  });

  it("corrects both halves of a cash ↔ bank move", () => {
    const db = shop();
    db.expenses.push({
      id: "out",
      kind: "TRANSFER",
      label: "Pencairan",
      amount: 2_000_000,
      date: "2026-09-02",
      method: "TRANSFER",
    });
    db.incomes.push({
      id: "in",
      reason: "TRANSFER",
      amount: 2_000_000,
      date: "2026-09-02",
      method: "TUNAI",
      note: "Pencairan",
    });
    const edits = applyAmountEdit(
      db,
      { kind: "expense", id: "out" },
      1_500_000,
      ctx,
    );
    expect(edits.map((e) => e.ref)).toEqual([
      { expenseId: "out" },
      { incomeId: "in" },
    ]);
    expect(db.incomes[0]!.amount).toBe(1_500_000);
  });

  it("refuses where the record's own screen would", () => {
    const db = shop();
    db.expenses.push({
      id: "svc",
      kind: "UNIT",
      amount: 100_000,
      date: "2026-09-02",
      method: "TRANSFER",
      serviceFeeId: "sf-1",
    });
    expect(editBlock(db, { kind: "expense", id: "svc" })).toBe(
      "SERVICE_CHARGE",
    );
    expect(editBlock(db, { kind: "expense", id: "nope" })).toBe("NOT_FOUND");
    db.expenses.push({
      id: "old",
      kind: "OPERATIONAL",
      amount: 100_000,
      date: "2026-09-02",
      method: "TRANSFER",
    });
    db.settings = {
      ...db.settings,
      booksClosedAt: dayjs("2026-09-30").endOf("day").toISOString(),
    };
    expect(editBlock(db, { kind: "expense", id: "old" })).toBe("BOOKS_CLOSED");
    expect(editBlock(db, { kind: "expense", id: "old" }, 0)).toBe(
      "NOT_POSITIVE",
    );
    // A finished sale inside the closed month.
    sale(db, "s1", "2026-09-02", 2_000_000);
    expect(
      editBlock(db, { kind: "salePayment", orderId: "s1", paymentId: "s1-p1" }),
    ).toBe("SALE_LOCKED");
    // A deposit below what was allocated out of it.
    const seeded = buildSeed().deposits[0]!;
    db.deposits = [{ ...seeded, at: at("2026-10-05") }];
    expect(
      editBlock(db, { kind: "deposit", depositId: seeded.id }, 1_000),
    ).toBe("BELOW_ALLOCATED");
    // A closed supplier invoice.
    const po = db.pos[0]!;
    po.payments = [
      { id: "pp", method: "TRANSFER", amount: 10, at: at("2026-10-05") },
    ];
    po.closedAt = at("2026-10-06");
    expect(
      editBlock(db, { kind: "poPayment", poId: po.id, paymentId: "pp" }),
    ).toBe("INVOICE_CLOSED");
  });
});

describe("saving a daily count", () => {
  it("lands on MATCHED, ADJUSTED or OPEN", () => {
    expect(dailyStatus(0, false)).toBe("MATCHED");
    expect(dailyStatus(0, true)).toBe("ADJUSTED");
    expect(dailyStatus(-5_000, true)).toBe("OPEN");
  });

  it("is one row per pot and day, its log growing", () => {
    const db = shop();
    upsertDaily(
      db,
      {
        pot: "BANK",
        day: "2026-09-02",
        posBalance: 1,
        actualBalance: 2,
        status: "OPEN",
        note: "short",
        edits: [],
      },
      ctx,
    );
    upsertDaily(
      db,
      {
        pot: "BANK",
        day: "2026-09-02",
        posBalance: 2,
        actualBalance: 2,
        status: "ADJUSTED",
        edits: editRows(
          [{ ref: { expenseId: "e" }, before: 5, after: 4 }],
          [],
          ctx,
        ),
      },
      ctx,
    );
    expect(db.reconciliations).toHaveLength(1);
    expect(db.reconciliations[0]).toMatchObject({
      kind: "DAILY",
      pot: "BANK",
      periodStart: "2026-09-02",
      periodEnd: "2026-09-02",
      status: "ADJUSTED",
      posBalance: 2,
    });
    expect(db.reconciliations[0]!.note).toBeUndefined();
    expect(db.reconciliations[0]!.edits).toHaveLength(1);
  });

  it("reads 'changed since reconciled' off today's POS balance (2B)", () => {
    const db = shop();
    sale(db, "s1", "2026-09-02", 2_000_000);
    const rec = upsertDaily(
      db,
      {
        pot: "BANK",
        day: "2026-09-02",
        posBalance: posBalanceAt(rowsOf(db), db.settings, "BANK", "2026-09-02"),
        actualBalance: 12_000_000,
        status: "MATCHED",
        edits: [],
      },
      ctx,
    );
    const now = () =>
      posBalanceAt(rowsOf(db), db.settings, "BANK", "2026-09-02");
    expect(changedSinceReconciled(rec, now())).toBe(false);
    const setPaid = (amount: number) => {
      const o = db.orders[0]!;
      o.payments = o.payments!.map((p) => ({ ...p, amount }));
    };
    setPaid(1_800_000);
    expect(changedSinceReconciled(rec, now())).toBe(true);
    // A movement AFTER the day does not move that day.
    setPaid(2_000_000);
    sale(db, "s2", "2026-09-03", 500_000);
    expect(changedSinceReconciled(rec, now())).toBe(false);
  });

  it("asks today's pots until they are counted", () => {
    const db = shop();
    expect(unreconciledPots(db, "2026-09-02")).toEqual(["BANK", "CASH"]);
    upsertDaily(
      db,
      {
        pot: "BANK",
        day: "2026-09-02",
        posBalance: 0,
        actualBalance: 0,
        status: "MATCHED",
        edits: [],
      },
      ctx,
    );
    upsertDaily(
      db,
      {
        pot: "CASH",
        day: "2026-09-02",
        posBalance: 0,
        actualBalance: 5,
        status: "OPEN",
        note: "x",
        edits: [],
      },
      ctx,
    );
    expect(unreconciledPots(db, "2026-09-02")).toEqual(["CASH"]);
  });
});

describe("deleting a record a reconciliation names", () => {
  it("is refused while the reconciliation is closed, and takes the edit once it is open", () => {
    const db = shop();
    db.expenses.push({
      id: "e1",
      kind: "OPERATIONAL",
      amount: 60_000,
      date: "2026-09-02",
      method: "TUNAI",
    });
    const rec = upsertDaily(
      db,
      {
        pot: "CASH",
        day: "2026-09-02",
        posBalance: 0,
        actualBalance: 0,
        status: "ADJUSTED",
        edits: editRows(
          [],
          [{ ref: { expenseId: "e1" }, amount: 60_000 }],
          ctx,
        ),
      },
      ctx,
    );
    expect(closedReconciliationNaming(db, { expenseId: "e1" })?.id).toBe(
      rec.id,
    );
    expect(
      adjustmentReconciliationBlock(db, { kind: "expense", id: "e1" })?.id,
    ).toBe(rec.id);
    rec.status = "OPEN";
    expect(
      adjustmentReconciliationBlock(db, { kind: "expense", id: "e1" }),
    ).toBeUndefined();
    expect(deleteAdjustment(db, { kind: "expense", id: "e1" })).toBe(1);
    expect(rec.edits).toEqual([]);
  });
});

describe("the monthly statement", () => {
  function month(db: MockDb) {
    sale(db, "s1", "2026-09-02", 2_000_000);
    sale(db, "s2", "2026-09-05", 1_250_000);
    sale(db, "s3", "2026-09-08", 10_000_000);
    sale(db, "s4", "2026-09-09", 700_000);
    const id = uploadStatement(
      db,
      {
        month: "2026-09",
        file: "statement.pdf",
        opening: 10_000_000,
        closing: 23_674_512,
        posOpening: 10_000_000,
        posClosing: 23_950_000,
        lines: [
          {
            lineNo: 1,
            date: "2026-09-02",
            description: "TRSF CR",
            amount: 2_000_000,
          },
          {
            lineNo: 2,
            date: "2026-09-05",
            description: "TRSF CR",
            amount: 1_520_000,
          },
          {
            lineNo: 3,
            date: "2026-09-09",
            description: "SHOPEE",
            amount: 9_700_000,
          },
          {
            lineNo: 4,
            date: "2026-09-30",
            description: "BUNGA",
            amount: 4_512,
          },
        ],
      },
      ctx,
    );
    const rows = rowsOf(db);
    runMatching(
      db,
      id,
      potMovements(rows, db.settings, "BANK", "2026-09-01", "2026-09-30")
        .map(toPosMovement)
        .filter((m) => m !== undefined),
      ctx.nextId,
    );
    return id;
  }

  it("matches at once what is exact and holds the rest as suggestions", () => {
    const db = shop();
    const id = month(db);
    const lines = linesOf(db, id);
    expect(lines.map((l) => l.status)).toEqual([
      "MATCHED",
      "SUGGESTED",
      "SUGGESTED",
      "UNMATCHED",
    ]);
    expect(heldSuggestions(lines).map((s) => s.reason)).toEqual([
      "TYPO",
      "DEDUCTION",
    ]);
    expect(monthCounts(lines)).toEqual({
      matched: 1,
      fixed: 0,
      left: 3,
      ignored: 0,
    });
    expect(canCloseMonth(lines)).toBe(false);
    rejectSuggestion(db, [lines[1]!.id]);
    expect(linesOf(db, id)[1]).toMatchObject({
      status: "UNMATCHED",
      matches: [],
    });
  });

  it("replaces a month's lines on re-upload and keeps one reconciliation", () => {
    const db = shop();
    const id = month(db);
    const again = uploadStatement(
      db,
      {
        month: "2026-09",
        file: "statement-2.pdf",
        opening: 10_000_000,
        closing: 12_000_000,
        posOpening: 10_000_000,
        posClosing: 23_950_000,
        lines: [
          {
            lineNo: 1,
            date: "2026-09-02",
            description: "TRSF CR",
            amount: 2_000_000,
          },
        ],
      },
      ctx,
    );
    expect(again).toBe(id);
    expect(db.reconciliations.filter((r) => r.kind === "MONTHLY")).toHaveLength(
      1,
    );
    expect(linesOf(db, id).map((l) => [l.lineNo, l.status])).toEqual([
      [1, "UNMATCHED"],
    ]);
  });
});
