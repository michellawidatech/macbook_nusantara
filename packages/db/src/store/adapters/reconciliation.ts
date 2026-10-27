/**
 * Reconciliation (owner ask 2026-10-27, docs/superpowers/specs/
 * 2026-10-27-reconciliation-design.md): a DAILY count of the bank or the
 * drawer, and a MONTHLY match of the bank against its e-statement.
 *
 * Two collections:
 *
 * - `reconciliations` — `Reconciliation` with its `ReconciliationEdit`s. A
 *   reconciliation is rewritten as it is reopened and saved again, but WHAT
 *   it is (kind, pot, period) never moves, and an edit is written once: it is
 *   the record of a correction to somebody else's figure. An edit leaves only
 *   through `reconciliation_edit_drop` (20261027170000), which refuses one
 *   whose reconciliation is not OPEN — the one case is an adjustment it added
 *   being deleted after the reconciliation was reopened.
 * - `statementLines` — `BankStatementLine` with its `BankStatementMatch`es.
 *   The bank's words and figures are fixed; the status, the note and the
 *   pairings are the shop's. Re-uploading a month DELETES its lines and their
 *   matches (the eighth sanctioned hard delete — do not generalise it), and
 *   is refused on a RECONCILED month, which is reopened first.
 *
 * `releaseReconciliationRefs` is the rule every deletion of an `Expense` or a
 * `ManualIncome` asks first: refused while a reconciliation that is not OPEN
 * names the row, and otherwise the edits and matches naming it go with it,
 * because their foreign keys would stop the delete.
 */
import type { Tx } from "../../client.js";
import { StoreValidationError } from "../errors.js";
import {
  type Adapter,
  type RowOf,
  type WriteContext,
  blankToNull,
  instantOf,
  isoOf,
  lockRows,
  refuseEdit,
  refuseRemoval,
} from "../context.js";
import { deepEqual } from "@nusantara/store";

const byId = (keys?: readonly string[]) =>
  keys === undefined ? {} : { id: { in: [...keys] } };

/** The four money references both child tables carry, exactly one set. */
interface MoneyRefRow {
  readonly paymentId?: string | undefined;
  readonly expenseId?: string | undefined;
  readonly incomeId?: string | undefined;
  readonly depositId?: string | undefined;
}

const refColumns = (r: MoneyRefRow) => ({
  paymentId: r.paymentId ?? null,
  expenseId: r.expenseId ?? null,
  incomeId: r.incomeId ?? null,
  depositId: r.depositId ?? null,
});

const refOfRow = (r: {
  paymentId: string | null;
  expenseId: string | null;
  incomeId: string | null;
  depositId: string | null;
}) => ({
  paymentId: r.paymentId ?? undefined,
  expenseId: r.expenseId ?? undefined,
  incomeId: r.incomeId ?? undefined,
  depositId: r.depositId ?? undefined,
});

const POT_WORD = { BANK: "Bank", CASH: "Kas" } as const;

/**
 * The money row a reference names must exist. A sale recorded before
 * payments were a list has one IMPLIED payment (`legacyPayments`, id
 * `<order>-legacy`) and no `Payment` row; reconciling it writes that row now,
 * live and settled — the reading the browser already had of it — so the edit
 * or the match has something to point at. The orders adapter, earlier in the
 * same commit, may already have written it.
 */
async function ensureRef(
  ctx: WriteContext,
  ref: MoneyRefRow,
  collection: "reconciliations" | "statementLines",
  key: string,
): Promise<void> {
  const { tx } = ctx;
  const missing = (what: string) =>
    new StoreValidationError(
      `${what} yang dirujuk rekonsiliasi tidak ditemukan.`,
      collection,
      key,
    );
  if (ref.expenseId !== undefined) {
    const e = await tx.expense.findUnique({
      where: { id: ref.expenseId },
      select: { id: true },
    });
    if (e === null) throw missing(`Pengeluaran ${ref.expenseId}`);
    return;
  }
  if (ref.incomeId !== undefined) {
    const i = await tx.manualIncome.findUnique({
      where: { id: ref.incomeId },
      select: { id: true },
    });
    if (i === null) throw missing(`Pemasukan ${ref.incomeId}`);
    return;
  }
  if (ref.depositId !== undefined) {
    const d = await tx.supplierDeposit.findUnique({
      where: { id: ref.depositId },
      select: { id: true },
    });
    if (d === null) throw missing(`Deposit ${ref.depositId}`);
    return;
  }
  if (ref.paymentId === undefined) {
    throw new StoreValidationError(
      "Rekonsiliasi harus merujuk tepat satu transaksi.",
      collection,
      key,
    );
  }
  const p = await tx.payment.findUnique({
    where: { id: ref.paymentId },
    select: { id: true },
  });
  if (p !== null) return;
  const orderId = ref.paymentId.endsWith("-legacy")
    ? ref.paymentId.slice(0, -"-legacy".length)
    : undefined;
  const order =
    orderId === undefined
      ? null
      : await tx.order.findUnique({
          where: { id: orderId },
          select: { id: true, payMethodId: true, total: true, ts: true },
        });
  if (order === null) throw missing(`Pembayaran ${ref.paymentId}`);
  await tx.payment.create({
    data: {
      id: ref.paymentId,
      orderId: order.id,
      direction: "MASUK",
      methodId: order.payMethodId ?? (await ctx.paymentMethodId("TUNAI")),
      amount: order.total > 0n ? order.total : 1n,
      status: "LUNAS",
      paidAt: order.ts,
      recordedAt: order.ts,
      staffId: ctx.staffId,
    },
  });
  ctx.touch("orders", order.id);
}

// ---------------------------------------------------------------------------
// Reconciliations
// ---------------------------------------------------------------------------

type Recon = RowOf<"reconciliations">;
type ReconEditRow = Recon["edits"][number];

/** Drop edits through the one door, after saying in words why it would refuse. */
async function dropEdits(
  ctx: WriteContext,
  ids: readonly string[],
  collection: "reconciliations" | "expenses" | "incomes",
  key: string,
): Promise<void> {
  if (ids.length === 0) return;
  const { tx } = ctx;
  const held = await tx.reconciliationEdit.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true,
      reconciliation: { select: { status: true } },
    },
  });
  if (held.length === 0) return;
  if (held.some((e) => e.reconciliation.status !== "OPEN")) {
    throw new StoreValidationError(
      "Rekonsiliasi ini sudah ditutup — buka kembali dulu.",
      collection,
      key,
    );
  }
  await tx.$queryRaw`SELECT reconciliation_edit_drop(${held.map((e) => e.id)}::text[]) AS removed`;
}

async function writeEdits(
  ctx: WriteContext,
  recId: string,
  base: readonly ReconEditRow[],
  next: readonly ReconEditRow[],
): Promise<void> {
  const was = new Map(base.map((e) => [e.id, e]));
  const now = new Map(next.map((e) => [e.id, e]));
  for (const e of next) {
    const old = was.get(e.id);
    if (old !== undefined) {
      if (!deepEqual(old, e)) throw refuseEdit("reconciliations", recId);
      continue;
    }
    await ensureRef(ctx, e, "reconciliations", recId);
    await ctx.tx.reconciliationEdit.create({
      data: {
        id: e.id,
        reconciliationId: recId,
        ...refColumns(e),
        action: e.action,
        before: e.action === "ADDED" ? null : (e.before ?? null),
        after: e.after,
        staffId: await ctx.staffFor(e.staff),
        at: instantOf(e.at),
      },
    });
  }
  const gone = base.filter((e) => !now.has(e.id)).map((e) => e.id);
  await dropEdits(ctx, gone, "reconciliations", recId);
}

export const reconciliations: Adapter<"reconciliations"> = {
  collection: "reconciliations",
  async project(tx, _ctx, keys) {
    const rows = await tx.reconciliation.findMany({
      where: byId(keys),
      orderBy: [{ periodStart: "desc" }, { kind: "asc" }, { pot: "asc" }],
      include: {
        staff: { select: { name: true } },
        edits: {
          orderBy: [{ at: "asc" }, { id: "asc" }],
          include: { staff: { select: { name: true } } },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      pot: r.pot,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      posBalance: r.posBalance,
      actualBalance: r.actualBalance,
      statementOpening: r.statementOpening ?? undefined,
      statementClosing: r.statementClosing ?? undefined,
      statementFile: r.statementFile ?? undefined,
      status: r.status,
      note: r.note ?? undefined,
      staff: r.staff.name,
      createdAt: isoOf(r.createdAt),
      updatedAt: isoOf(r.updatedAt),
      edits: r.edits.map((e) => ({
        id: e.id,
        ...refOfRow(e),
        action: e.action,
        before: e.before ?? undefined,
        after: e.after,
        staff: e.staff.name,
        at: isoOf(e.at),
      })),
    }));
  },
  lock: (tx, keys) => lockRows(tx, "Reconciliation", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    for (const r of rows) {
      const n = r.next;
      if (n === undefined) throw refuseRemoval("reconciliations", r.key);
      const fields = {
        posBalance: n.posBalance,
        actualBalance: n.actualBalance,
        statementOpening: n.statementOpening ?? null,
        statementClosing: n.statementClosing ?? null,
        statementFile: blankToNull(n.statementFile),
        status: n.status,
        note: blankToNull(n.note),
      };
      if (r.base === undefined) {
        const taken = await tx.reconciliation.findUnique({
          where: {
            kind_pot_periodStart: {
              kind: n.kind,
              pot: n.pot,
              periodStart: n.periodStart,
            },
          },
          select: { id: true },
        });
        if (taken !== null && taken.id !== n.id) {
          throw new StoreValidationError(
            `${POT_WORD[n.pot]} ${n.periodStart} sudah direkonsiliasi di perangkat lain — muat ulang halaman ini.`,
            "reconciliations",
            n.id,
          );
        }
        await tx.reconciliation.create({
          data: {
            id: n.id,
            kind: n.kind,
            pot: n.pot,
            periodStart: n.periodStart,
            periodEnd: n.periodEnd,
            ...fields,
            staffId: await ctx.staffFor(n.staff),
            createdAt: ctx.mode === "import" ? instantOf(n.createdAt) : ctx.now,
            updatedAt: ctx.mode === "import" ? instantOf(n.updatedAt) : ctx.now,
          },
        });
        await writeEdits(ctx, n.id, [], n.edits);
      } else {
        const b = r.base;
        if (
          b.kind !== n.kind ||
          b.pot !== n.pot ||
          b.periodStart !== n.periodStart ||
          b.periodEnd !== n.periodEnd
        ) {
          throw new StoreValidationError(
            "Jenis, kas/bank dan periode rekonsiliasi tidak bisa diubah.",
            "reconciliations",
            n.id,
          );
        }
        await tx.reconciliation.update({
          where: { id: n.id },
          data: {
            ...fields,
            staffId: await ctx.staffFor(n.staff),
            updatedAt: ctx.mode === "import" ? instantOf(n.updatedAt) : ctx.now,
          },
        });
        await writeEdits(ctx, n.id, b.edits, n.edits);
      }
      ctx.touch("reconciliations", n.id);
    }
  },
};

// ---------------------------------------------------------------------------
// Statement lines
// ---------------------------------------------------------------------------

type Line = RowOf<"statementLines">;
type MatchRow = Line["matches"][number];

async function createMatches(
  ctx: WriteContext,
  lineId: string,
  matches: readonly MatchRow[],
): Promise<void> {
  for (const m of matches) {
    await ensureRef(ctx, m, "statementLines", lineId);
    await ctx.tx.bankStatementMatch.create({
      data: { id: m.id, lineId, ...refColumns(m), reason: m.reason },
    });
  }
}

async function reconciliationOf(
  tx: Tx,
  id: string,
): Promise<{ kind: string; status: string } | null> {
  return tx.reconciliation.findUnique({
    where: { id },
    select: { kind: true, status: true },
  });
}

export const statementLines: Adapter<"statementLines"> = {
  collection: "statementLines",
  async project(tx, _ctx, keys) {
    const rows = await tx.bankStatementLine.findMany({
      where: byId(keys),
      orderBy: [{ reconciliationId: "asc" }, { lineNo: "asc" }],
      include: { matches: { orderBy: { id: "asc" } } },
    });
    return rows.map((l) => ({
      id: l.id,
      reconciliationId: l.reconciliationId,
      lineNo: l.lineNo,
      date: l.date,
      description: l.description,
      amount: l.amount,
      balance: l.balance ?? undefined,
      status: l.status,
      note: l.note ?? undefined,
      matches: l.matches.map((m) => ({
        id: m.id,
        ...refOfRow(m),
        reason: m.reason,
      })),
    }));
  },
  lock: (tx, keys) => lockRows(tx, "BankStatementLine", "id", keys),
  async write(ctx, rows) {
    const { tx } = ctx;
    // Removals first: a re-upload removes a month's old lines and inserts the
    // new ones in one changeset, numbered 1…n again, and the unique
    // (reconciliationId, lineNo) would collide in any other order.
    const ordered = [
      ...rows.filter((r) => r.next === undefined),
      ...rows.filter((r) => r.next !== undefined),
    ];
    for (const r of ordered) {
      const n = r.next;
      if (n === undefined) {
        const line = await tx.bankStatementLine.findUnique({
          where: { id: r.key },
          select: { reconciliationId: true },
        });
        if (line === null) continue;
        const rec = await reconciliationOf(tx, line.reconciliationId);
        if (rec?.status === "RECONCILED") {
          throw new StoreValidationError(
            "Bulan ini sudah direkonsiliasi — buka kembali dulu sebelum mengunggah ulang mutasinya.",
            "statementLines",
            r.key,
          );
        }
        await tx.bankStatementMatch.deleteMany({ where: { lineId: r.key } });
        await tx.bankStatementLine.delete({ where: { id: r.key } });
        ctx.touch("statementLines", r.key);
        continue;
      }
      if (r.base === undefined) {
        const rec = await reconciliationOf(tx, n.reconciliationId);
        if (rec === null || rec.kind !== "MONTHLY") {
          throw new StoreValidationError(
            "Baris mutasi bank harus milik rekonsiliasi bulanan.",
            "statementLines",
            n.id,
          );
        }
        await tx.bankStatementLine.create({
          data: {
            id: n.id,
            reconciliationId: n.reconciliationId,
            lineNo: n.lineNo,
            date: n.date,
            description: n.description,
            amount: n.amount,
            balance: n.balance ?? null,
            status: n.status,
            note: blankToNull(n.note),
          },
        });
        await createMatches(ctx, n.id, n.matches);
      } else {
        const b = r.base;
        if (
          b.reconciliationId !== n.reconciliationId ||
          b.lineNo !== n.lineNo ||
          b.date !== n.date ||
          b.description !== n.description ||
          b.amount !== n.amount ||
          b.balance !== n.balance
        ) {
          throw new StoreValidationError(
            "Isi baris mutasi adalah milik bank dan tidak bisa diubah.",
            "statementLines",
            n.id,
          );
        }
        await tx.bankStatementLine.update({
          where: { id: n.id },
          data: { status: n.status, note: blankToNull(n.note) },
        });
        const was = new Map(b.matches.map((m) => [m.id, m]));
        const now = new Set(n.matches.map((m) => m.id));
        const added: MatchRow[] = [];
        for (const m of n.matches) {
          const old = was.get(m.id);
          if (old === undefined) added.push(m);
          else if (!deepEqual(old, m)) throw refuseEdit("statementLines", n.id);
        }
        const gone = b.matches.filter((m) => !now.has(m.id)).map((m) => m.id);
        if (gone.length > 0) {
          await tx.bankStatementMatch.deleteMany({
            where: { id: { in: gone }, lineId: n.id },
          });
        }
        await createMatches(ctx, n.id, added);
      }
      ctx.touch("statementLines", n.id);
    }
  },
};

// ---------------------------------------------------------------------------
// Deleting a row a reconciliation names
// ---------------------------------------------------------------------------

/**
 * Before an `Expense` or a `ManualIncome` is deleted: refused while a
 * reconciliation that is not OPEN names it (spec: "reopen the reconciliation
 * first"); otherwise the edits naming it are dropped through
 * `reconciliation_edit_drop`, and the matches deleted — a line left with none
 * goes back to UNMATCHED.
 */
export async function releaseReconciliationRefs(
  ctx: WriteContext,
  field: "expenseId" | "incomeId",
  ids: readonly string[],
  collection: "expenses" | "incomes" | "services",
  key: string,
): Promise<void> {
  if (ids.length === 0) return;
  const { tx } = ctx;
  const where = { [field]: { in: [...ids] } };
  const edits = await tx.reconciliationEdit.findMany({
    where,
    select: {
      id: true,
      reconciliation: {
        select: { id: true, status: true, pot: true, periodStart: true },
      },
    },
  });
  const matches = await tx.bankStatementMatch.findMany({
    where,
    select: {
      id: true,
      line: {
        select: {
          id: true,
          reconciliation: {
            select: { id: true, status: true, pot: true, periodStart: true },
          },
        },
      },
    },
  });
  const closed = [
    ...edits.map((e) => e.reconciliation),
    ...matches.map((m) => m.line.reconciliation),
  ].find((rec) => rec.status !== "OPEN");
  if (closed !== undefined) {
    throw new StoreValidationError(
      `Rekonsiliasi ${POT_WORD[closed.pot]} ${closed.periodStart} mencatat baris ini — buka kembali rekonsiliasinya dulu.`,
      collection,
      key,
    );
  }
  if (edits.length > 0) {
    await dropEdits(
      ctx,
      edits.map((e) => e.id),
      collection === "services" ? "expenses" : collection,
      key,
    );
    for (const e of edits) ctx.touch("reconciliations", e.reconciliation.id);
  }
  if (matches.length > 0) {
    await tx.bankStatementMatch.deleteMany({
      where: { id: { in: matches.map((m) => m.id) } },
    });
    for (const lineId of new Set(matches.map((m) => m.line.id))) {
      const left = await tx.bankStatementMatch.count({ where: { lineId } });
      if (left === 0) {
        await tx.bankStatementLine.updateMany({
          where: { id: lineId, status: { in: ["MATCHED", "SUGGESTED"] } },
          data: { status: "UNMATCHED" },
        });
      }
      ctx.touch("statementLines", lineId);
    }
  }
}
