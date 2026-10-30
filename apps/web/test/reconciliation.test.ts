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
  activeAsides,
  applyAmountEdit,
  canCloseMonth,
  confirmLines,
  changedSinceReconciled,
  closedReconciliationNaming,
  dailyOf,
  dailyStatus,
  deleteReconciliation,
  editBlock,
  editRows,
  heldSuggestions,
  ignoreLine,
  linesOf,
  matchedKeys,
  monthBlockers,
  monthCounts,
  monthlyOf,
  pairManually,
  posBalanceAt,
  potMovements,
  rejectSuggestion,
  rowRefKey,
  runMatching,
  setAside,
  toPosMovement,
  unreconciledPots,
  upsertDaily,
  uploadStatement,
  withdrawAside,
  withdrawPairedAsides,
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

describe("what a marketplace kept (owner 2026-10-30: keep it as an expense)", () => {
  function shopeeSale(db: MockDb) {
    const o = sale(db, "sp", "2026-09-04", 10_000_000, "MARKETPLACE");
    o.payments = o.payments!.map((p) => ({ ...p, channel: "SHOPEE" }));
    db.settlements = [
      {
        id: "stl-1",
        paymentId: "sp-p1",
        orderId: "sp",
        channel: "Shopee",
        gross: 10_000_000,
        fees: [
          { id: "f1", kind: "COMMISSION", label: "Komisi", amount: 1_000_000 },
          { id: "f2", kind: "OTHER", label: "Biaya layanan", amount: 150_000 },
        ],
        received: 8_850_000,
        at: at("2026-09-04"),
        staff: "Dina",
      },
    ];
    return o;
  }

  it("keeps the sale at what the customer paid and lists the deduction as a fee expense", () => {
    const db = shop();
    shopeeSale(db);
    const rows = rowsOf(db);
    const payment = rows.find((r) => r.key === "p-sp-sp-p1")!;
    expect(payment.amount).toBe(10_000_000);
    expect(payment.deducted).toBe(1_150_000);
    const fee = rows.find((r) => r.feeOf === "p-sp-sp-p1")!;
    expect(fee).toMatchObject({
      direction: "EXPENSE",
      category: "BIAYA_ADMIN",
      amount: 1_150_000,
      status: "SETTLED",
      orderCode: "SI-sp",
    });
    expect(fee.description).toBe("Kept by Shopee · Komisi, Biaya layanan");
  });

  it("moves the bank by what landed, and matches the statement's net credit exactly", () => {
    const db = shop();
    shopeeSale(db);
    const rows = rowsOf(db);
    expect(posBalanceAt(rows, db.settings, "BANK", "2026-09-04")).toBe(
      18_850_000,
    );
    const moves = potMovements(
      rows,
      db.settings,
      "BANK",
      "2026-09-04",
      "2026-09-04",
    )
      .filter((r) => r.feeOf === undefined)
      .map(toPosMovement);
    expect(moves).toEqual([
      { key: "p:sp-p1", date: "2026-09-04", amount: 8_850_000 },
    ]);
  });

  it("drops the deduction once the payment is corrected off the marketplace", () => {
    const db = shop();
    const o = shopeeSale(db);
    o.payments = [
      {
        id: "sp-p1",
        method: "TUNAI",
        amount: 10_000_000,
        state: "SETTLED",
        at: at("2026-09-04"),
      },
    ];
    const rows = rowsOf(db);
    expect(rows.some((r) => r.feeOf !== undefined)).toBe(false);
    expect(rows.find((r) => r.key === "p-sp-sp-p1")!.deducted).toBeUndefined();
  });

  it("files a payout above the fees as money in", () => {
    const db = shop();
    shopeeSale(db);
    db.settlements[0] = {
      ...db.settlements[0]!,
      fees: [],
      received: 10_050_000,
    };
    const fee = rowsOf(db).find((r) => r.feeOf !== undefined)!;
    expect(fee).toMatchObject({ direction: "INCOME", amount: 50_000 });
  });
});

describe("a return's money is counted once (audit 2026-10-30)", () => {
  it("leaves out the Refund expense an older return desk wrote beside the sale's refund", () => {
    const db = shop();
    const o = sale(db, "rt", "2026-09-05", 5_000_000, "TUNAI");
    const when = at("2026-09-06", 11);
    o.refunds = [{ id: "rf1", method: "TUNAI", amount: 5_000_000, at: when }];
    db.expenses.push(
      // What the desk wrote in the same save — a duplicate.
      {
        id: "dup",
        kind: "REFUND",
        amount: 5_000_000,
        date: "2026-09-06",
        method: "TUNAI",
        note: "Return SG-1",
        createdAt: when,
      },
      // A refund somebody typed against a sale — real, and kept.
      {
        id: "typed",
        kind: "REFUND",
        amount: 5_000_000,
        date: "2026-09-06",
        method: "TUNAI",
        orderId: "rt",
        createdAt: when,
      },
    );
    const keys = rowsOf(db).map((r) => r.key);
    expect(keys).toContain("rf-rt-rf1");
    expect(keys).not.toContain("e-dup");
    expect(keys).toContain("e-typed");
  });

  it("leaves out the Refund income beside an exchange's top-up payment", () => {
    const db = shop();
    const o = sale(db, "ex", "2026-09-05", 5_000_000, "TRANSFER");
    const when = at("2026-09-06", 11);
    o.payments = [
      ...o.payments!,
      {
        id: "top",
        method: "TRANSFER",
        amount: 1_500_000,
        state: "SETTLED",
        at: when,
        note: "Exchange top-up (SG-2)",
      },
    ];
    db.incomes.push({
      id: "dup",
      reason: "REFUND",
      amount: 1_500_000,
      date: "2026-09-06",
      method: "TRANSFER",
      createdAt: when,
    });
    const rows = rowsOf(db);
    expect(rows.map((r) => r.key)).not.toContain("i-dup");
    expect(posBalanceAt(rows, db.settings, "BANK", "2026-09-06")).toBe(
      16_500_000,
    );
  });
});

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
    // The book close is retired (2026-10-27): a stored close locks nothing,
    // so a row inside it is editable and a finished sale is not locked.
    expect(editBlock(db, { kind: "expense", id: "old" })).toBeUndefined();
    expect(editBlock(db, { kind: "expense", id: "old" }, 0)).toBe(
      "NOT_POSITIVE",
    );
    sale(db, "s1", "2026-09-02", 2_000_000);
    expect(
      editBlock(db, { kind: "salePayment", orderId: "s1", paymentId: "s1-p1" }),
    ).toBeUndefined();
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
    expect(canCloseMonth(lines, [], db.reconciliations[0]!)).toBe(false);
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

describe("POS entries the bank never saw (owner-approved 2026-10-27)", () => {
  /** September as `month` leaves it, with every statement line answered. */
  function answered(db: MockDb): string {
    sale(db, "s1", "2026-09-02", 2_000_000);
    sale(db, "s2", "2026-09-05", 1_250_000);
    // Paid to the shop's account and never seen on the statement.
    sale(db, "s4", "2026-09-09", 700_000);
    const id = uploadStatement(
      db,
      {
        month: "2026-09",
        file: "statement.pdf",
        opening: 10_000_000,
        closing: 13_250_000,
        posOpening: 10_000_000,
        posClosing: 13_950_000,
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
            amount: 1_250_000,
          },
          {
            lineNo: 3,
            date: "2026-09-30",
            description: "BUNGA",
            amount: 4_512,
          },
        ],
      },
      ctx,
    );
    runMatching(
      db,
      id,
      potMovements(rowsOf(db), db.settings, "BANK", "2026-09-01", "2026-09-30")
        .map(toPosMovement)
        .filter((m) => m !== undefined),
      ctx.nextId,
    );
    ignoreLine(db, linesOf(db, id)[2]!.id, "Interest, booked next month");
    return id;
  }
  const posOnlyKeys = (db: MockDb, id: string) => {
    const taken = matchedKeys(linesOf(db, id));
    return potMovements(
      rowsOf(db),
      db.settings,
      "BANK",
      "2026-09-01",
      "2026-09-30",
    )
      .map(rowRefKey)
      .filter((k) => k !== undefined && !taken.has(k)) as string[];
  };
  const recOf = (db: MockDb, id: string) =>
    db.reconciliations.find((r) => r.id === id)!;

  it("closes a month only once each one is paired or set aside, and not after Undo", () => {
    const db = shop();
    const id = answered(db);
    const keys = posOnlyKeys(db, id);
    expect(keys).toEqual(["p:s4-p1"]);
    expect(monthBlockers(linesOf(db, id), keys, recOf(db, id))).toEqual({
      noLines: false,
      lines: 0,
      posOnly: 1,
    });
    expect(canCloseMonth(linesOf(db, id), keys, recOf(db, id))).toBe(false);

    // A blank note explains nothing.
    setAside(db, id, "p:s4-p1", "   ", ctx);
    expect(recOf(db, id).asides).toEqual([]);

    setAside(db, id, "p:s4-p1", " Paid into the old account ", ctx);
    expect(recOf(db, id).asides).toMatchObject([
      { paymentId: "s4-p1", note: "Paid into the old account", staff: "Dina" },
    ]);
    expect(canCloseMonth(linesOf(db, id), keys, recOf(db, id))).toBe(true);
    // One active aside per movement.
    setAside(db, id, "p:s4-p1", "again", ctx);
    expect(recOf(db, id).asides).toHaveLength(1);

    // Undo withdraws it — kept, no longer counted.
    const aside = recOf(db, id).asides[0]!;
    withdrawAside(db, id, aside.id, "2026-10-01T00:00:00.000Z");
    expect(recOf(db, id).asides[0]!.withdrawnAt).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    expect(activeAsides(recOf(db, id))).toEqual([]);
    expect(canCloseMonth(linesOf(db, id), keys, recOf(db, id))).toBe(false);

    // Set aside again: a second row, the withdrawn one still there.
    setAside(db, id, "p:s4-p1", "Paid into the old account", ctx);
    expect(recOf(db, id).asides).toHaveLength(2);
    expect(canCloseMonth(linesOf(db, id), keys, recOf(db, id))).toBe(true);
  });

  it("reports both counts when lines and POS entries are both open", () => {
    const db = shop();
    const id = answered(db);
    const lines = linesOf(db, id);
    rejectSuggestion(db, [lines[0]!.id]);
    const after = linesOf(db, id);
    expect(after[0]!.status).toBe("UNMATCHED");
    const keys = posOnlyKeys(db, id);
    expect(monthBlockers(after, keys, recOf(db, id))).toEqual({
      noLines: false,
      lines: 1,
      posOnly: 2,
    });
    expect(monthBlockers([], [], recOf(db, id)).noLines).toBe(true);
    expect(canCloseMonth([], [], recOf(db, id))).toBe(false);
  });

  it("withdraws an aside by itself once the movement is paired, never for a suggestion", () => {
    const db = shop();
    const id = answered(db);
    setAside(db, id, "p:s4-p1", "Not on the statement", ctx);
    const bunga = linesOf(db, id)[2]!;
    // A suggestion naming it pairs nothing yet.
    bunga.status = "SUGGESTED";
    bunga.matches = [{ id: "sm-x", paymentId: "s4-p1", reason: "TYPO" }];
    withdrawPairedAsides(db, id, "2026-10-01T00:00:00.000Z");
    expect(activeAsides(recOf(db, id))).toHaveLength(1);
    // Paired by hand: the bank explains it, not the note.
    pairManually(db, [bunga.id], ["p:s4-p1"], ctx.nextId);
    withdrawPairedAsides(db, id, "2026-10-01T00:00:00.000Z");
    expect(activeAsides(recOf(db, id))).toEqual([]);
    expect(recOf(db, id).asides[0]!.withdrawnAt).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    confirmLines(db, [bunga.id]);
    expect(posOnlyKeys(db, id)).toEqual([]);
  });

  it("lets an adjustment it names be deleted: withdrawn never blocks, active blocks only a closed month", () => {
    const db = shop();
    const id = answered(db);
    db.expenses.push({
      id: "e-aside",
      kind: "OPERATIONAL",
      amount: 25_000,
      date: "2026-09-10",
      method: "TRANSFER",
    });
    setAside(db, id, "e:e-aside", "Paid from the owner's card", ctx);
    const rec = recOf(db, id);
    rec.status = "RECONCILED";
    expect(
      adjustmentReconciliationBlock(db, { kind: "expense", id: "e-aside" })?.id,
    ).toBe(id);

    // Withdrawn, it no longer says anything — even on a closed month.
    withdrawAside(db, id, rec.asides[0]!.id, "2026-10-01T00:00:00.000Z");
    expect(
      adjustmentReconciliationBlock(db, { kind: "expense", id: "e-aside" }),
    ).toBeUndefined();
    expect(deleteAdjustment(db, { kind: "expense", id: "e-aside" })).toBe(1);
    expect(rec.asides).toEqual([]);

    // Active on an OPEN month: it goes with the adjustment.
    db.expenses.push({
      id: "e-aside-2",
      kind: "OPERATIONAL",
      amount: 30_000,
      date: "2026-09-11",
      method: "TRANSFER",
    });
    rec.status = "OPEN";
    setAside(db, id, "e:e-aside-2", "Card", ctx);
    expect(
      adjustmentReconciliationBlock(db, { kind: "expense", id: "e-aside-2" }),
    ).toBeUndefined();
    expect(deleteAdjustment(db, { kind: "expense", id: "e-aside-2" })).toBe(1);
    expect(rec.asides).toEqual([]);
  });
});

describe("deleting a reconciliation (owner ask 2026-10-27)", () => {
  it("takes a day with its log; the correction it made stays, and the day is not done again", () => {
    const db = shop();
    db.expenses.push({
      id: "e-del-1",
      kind: "OPERATIONAL",
      label: "Courier",
      amount: 400_000,
      date: "2026-09-02",
      method: "TRANSFER",
    });
    const rec = upsertDaily(
      db,
      {
        pot: "BANK",
        day: "2026-09-02",
        posBalance: 1,
        actualBalance: 1,
        status: "ADJUSTED",
        edits: editRows(
          [{ ref: { expenseId: "e-del-1" }, before: 500_000, after: 400_000 }],
          [],
          ctx,
        ),
      },
      ctx,
    );
    expect(unreconciledPots(db, "2026-09-02")).not.toContain("BANK");
    expect(deleteReconciliation(db, rec.id)).toBe(true);
    expect(dailyOf(db, "BANK", "2026-09-02")).toBeUndefined();
    expect(unreconciledPots(db, "2026-09-02")).toContain("BANK");
    expect(db.expenses.find((e) => e.id === "e-del-1")!.amount).toBe(400_000);
    expect(deleteReconciliation(db, rec.id)).toBe(false);
  });

  it("takes a month with its lines, matches and asides; another month is untouched", () => {
    const db = shop();
    sale(db, "s1", "2026-09-02", 2_000_000);
    sale(db, "s2", "2026-09-05", 700_000);
    const upload = (month: string, day: string) =>
      uploadStatement(
        db,
        {
          month,
          file: `${month}.pdf`,
          opening: 0,
          closing: 2_000_000,
          posOpening: 0,
          posClosing: 0,
          lines: [
            { lineNo: 1, date: day, description: "TRSF CR", amount: 2_000_000 },
          ],
        },
        ctx,
      );
    const sep = upload("2026-09", "2026-09-02");
    const aug = upload("2026-08", "2026-08-02");
    runMatching(
      db,
      sep,
      potMovements(rowsOf(db), db.settings, "BANK", "2026-09-01", "2026-09-30")
        .map(toPosMovement)
        .filter((m) => m !== undefined),
      ctx.nextId,
    );
    expect(linesOf(db, sep)[0]!.matches).toHaveLength(1);
    setAside(db, sep, "p:s2-p1", "Paid to the owner", ctx);
    expect(monthlyOf(db, "2026-09")!.asides).toHaveLength(1);

    expect(deleteReconciliation(db, sep)).toBe(true);
    expect(monthlyOf(db, "2026-09")).toBeUndefined();
    expect(linesOf(db, sep)).toEqual([]);
    expect(monthlyOf(db, "2026-08")!.id).toBe(aug);
    expect(linesOf(db, aug)).toHaveLength(1);
    expect(db.orders.find((o) => o.id === "s2")!.payments).toHaveLength(1);
  });
});
