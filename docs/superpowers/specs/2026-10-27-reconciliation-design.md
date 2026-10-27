# Daily and monthly reconciliation — design

Owner ask 2026-10-27, answers "1B 2B 3B 4A" (owner: "build it all"). Example
statement: BCA *Rekening Tahapan* e-statement PDF, September 2026, 16 pages,
172 movements (119 CR, 53 DB), text-extractable (iText, WinAnsi fonts), with a
closing summary (SALDO AWAL / MUTASI CR / MUTASI DB / SALDO AKHIR + counts).

## Where

A new leaf **Financial & Report → Reconciliation** (`/finance/reconciliation`),
two tabs, **Daily** and **Monthly**, each a log. Finance access only
(`canViewFinance`, 4A) — the page is a `/finance/*` path, so `FinanceLocked`
and `financeScope` cover it; its collections join `FINANCE_COLLECTIONS`.
Income & Expense shows one line on top while today is not reconciled: *"Today
isn't reconciled — Reconcile"*.

"POS balance" everywhere means the **cash-basis** pot balance Income &
Expense's Cash and Bank cards compute (`balancesOf`): opening balance +
SETTLED, in-balance movements of that pot up to the end of the day (Asia/Jakarta).

## Daily (1B — bank AND cash)

- The Daily log: one row per day — date, then for Bank and for Cash: POS ·
  actual · difference; status; note; who; when.
- **Reconcile** (today by default, any past day allowed) asks the actual bank
  balance and the counted cash. Each pot that matches is MATCHED.
- A pot that does not match opens a dialog of THAT DAY's movements in that
  pot (the Income & Expense rows: sale payments, refunds, supplier payments,
  deposits, adjustments) — transaction number · Income/Expense · description /
  item · amount. Amounts are editable; a changed row is highlighted; the
  remaining difference updates live. **Add a transaction** opens the existing
  adjustment dialog for that day and pot. A note. Save → ADJUSTED (difference
  0) or OPEN (difference left, note required).
- An edit corrects the REAL record with the rules its own screen uses (a sale
  payment through `diffPayments`/`withOwed` and the payment log; an adjustment
  amount; a supplier payment — not a deposit-funded one; a refund). Refused
  inside a locked sale / closed book, with the reason. Every edit and every
  added transaction is logged on the reconciliation (`ReconciliationEdit`)
  so the dialog can show what changed, before → after, and who.
- A reconciled day can be reopened and edited.
- **2B:** a day whose POS balance today differs from the POS balance stored at
  reconciliation reads **Changed since reconciled** (derived, nothing stored).

## Monthly (3B — every line)

- **Upload** the bank's e-statement PDF. Parsed in the browser with
  `pdfjs-dist`, lazy-loaded on this page only (the one new dependency — a
  hand-written PDF reader is not realistic). `lib/bankStatement.ts` reads BCA's
  layout into lines: date, description (all its lines joined), signed amount
  (DB negative), running balance where printed; plus the summary. **The
  statement must add up** (SALDO AWAL + CR − DB = SALDO AKHIR, counts equal)
  or it is refused with what did not add up. A CSV of the same lines is also
  accepted (KlikBCA's mutasi download), same parser output.
- **Opening check:** SALDO AWAL vs the POS bank balance at the start of the
  month; a difference is shown first — it means an earlier month is off.
- **Matching** (`lib/bankMatch.ts`, pure, tested), against the month's POS bank
  movements:
  1. exact amount, same day → matched;
  2. exact amount, ±3 days → matched (bank posting lag, "TANGGAL :31/08");
  3. suggestions, each with the reason shown:
     - **Typo** — same day ±1, amounts differ by one digit or two swapped
       digits → "Correct the POS amount to Rp X";
     - **Deduction** — the bank got less than the POS recorded, within 5% →
       "Record Rp D as a fee (expense)";
     - **One bank line = several POS movements** (2–6, same day ±1, sum equal)
       — a marketplace payout, a supplier paid in parts;
     - **Several bank lines = one POS movement** — e.g. a cash deposit made in
       several CDM slips (SETORAN VIA CDM);
     - **Bank-only line** — suggests adding it, category pre-filled by keyword:
       BUNGA → income *Interest*; PAJAK BUNGA, BIAYA ADM → expense; "GAJI" →
       *Payroll*; SETORAN VIA CDM / tarik tunai → *Cash ↔ bank*; else unset;
     - **POS-only movement** — money the POS says moved that the bank never
       saw: open it to correct or delete.
  Each suggestion is Accept / Reject; manual pairing of any line with any
  movement is allowed. Accepting writes the real correction (same rules as
  daily) and records the match.
- The Monthly log: month · statement opening/closing · POS opening/closing ·
  lines matched / fixed / left · status (OPEN / RECONCILED) · who.
- Re-uploading a month replaces its statement lines (and their matches); the
  corrections already written stay.

## Schema — migration `20261027170000_reconciliation` (additive)

- `enum ReconKind { DAILY MONTHLY }`, `enum ReconPot { BANK CASH }`,
  `enum ReconStatus { OPEN MATCHED ADJUSTED RECONCILED }`,
  `enum StatementLineStatus { UNMATCHED MATCHED SUGGESTED IGNORED }`.
- `Reconciliation` — id, kind, pot, `periodStart` (YYYY-MM-DD), `periodEnd`
  (YYYY-MM-DD; = start for a day), `posBalance` BigInt, `actualBalance`
  BigInt, `statementOpening` BigInt?, `statementClosing` BigInt?,
  `statementFile` String? (file name only), status, note String?, staffId
  (FK Staff), createdAt, updatedAt. Unique (kind, pot, periodStart).
- `ReconciliationEdit` — id, reconciliationId (FK), `paymentId`?,
  `expenseId`?, `incomeId`?, `depositId`? (FKs → Payment, Expense,
  ManualIncome, SupplierDeposit; CHECK exactly one), `action` (EDITED |
  ADDED), `before` BigInt?, `after` BigInt, staffId, at.
- `BankStatementLine` — id, reconciliationId (FK, a MONTHLY one), lineNo,
  `date` (YYYY-MM-DD), description, `amount` BigInt (signed), `balance`
  BigInt?, status, note String?.
- `BankStatementMatch` — id, lineId (FK), `paymentId`? / `expenseId`? /
  `incomeId`? / `depositId`? (FKs, CHECK exactly one), `reason` String
  (EXACT, DATE_SHIFT, TYPO, DEDUCTION, SPLIT, MANUAL…).
- All FKs `onDelete: Restrict`. Grants: `nusantara_app` SELECT/INSERT/UPDATE
  on all four; DELETE on `BankStatementLine` and `BankStatementMatch` only
  (re-upload) — the eighth sanctioned hard delete, do not generalise it. A
  `ReconciliationEdit`/`BankStatementMatch` pointing at an Expense/ManualIncome
  must not block the existing adjustment delete: that delete is refused while
  a reconciliation names the row, with the reason ("reopen the reconciliation
  first").
- Store contract: collections `reconciliations` (with `edits`) and
  `statementLines` (with `matches`), in `FINANCE_COLLECTIONS`.

## Testing

Pure: the BCA parser on the real September file (committed as a fixture only
if the owner agrees — it holds names and amounts; otherwise a synthetic
statement in the same layout), the add-up check, every matching rule, the
2B derivation. Page tests: daily matched, daily adjusted with an edit and an
added transaction, reopen, changed-since-reconciled; monthly upload →
suggestions → accept each kind. db: round-trips and grants as `nusantara_app`.
