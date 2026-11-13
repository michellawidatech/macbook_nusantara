# Approvals, Today, the marketplace pot and five smaller asks — 2026-11-13

Owner/user ask (chat, 2026-11-13), answered in the same conversation; "go fix
then deploy". Built on `v2026.11.13` (branch `michellawidatech/approvals-today`).

## Why

Money that has already moved must not be quietly rewritten by whoever is at
the till. Edits and deletes of money records become **requests** that one
approver decides. The owner also wants one morning screen, a marketplace
balance that matches how Shopee actually pays out (one lump withdrawal, not per
order), and a handful of screen fixes.

## Part A — the marketplace pot (Shopee / Tokopedia) and finance screens

**How Shopee pays, in the owner's words:** staff learn each ORDER's deduction
(from the Shopee report or Shopee's site), but money reaches the bank as
withdrawals of any amount the staff choose on Shopee's site — no withdrawal
names an order. So matching payouts to orders cannot work.

1. **Adding a deduction releases the payment.** In Edit transaction, adding a
   deduction row under a marketplace payment flips that payment's Status from
   Pending to Settled *in the form*; nothing is written until Save. The Shopee
   upload does the same thing: it only records each order's deductions, and
   the payment counts as released.
2. **A released marketplace payment is in the MARKETPLACE pot, not the bank.**
   Its net (amount − deductions) sits in that channel's seller balance until
   withdrawn. Cash and Bank cards, the running balance, daily and monthly
   reconciliation stop counting it (and its derived fee row) as bank.
3. **"Pending in marketplace" per channel** = Σ (amount − deductions) over that
   channel's marketplace payments (pending ones count gross: their deduction
   is not known yet) − Σ withdrawals. Shown on Income & Expense as a card per
   channel, split into *awaiting release* and *in seller balance*.
4. **A withdrawal is an income adjustment**: Add adjustment → Income →
   *Shopee withdrawal* / *Tokopedia withdrawal* (new `IncomeReason` values
   `PENARIKAN_SHOPEE`, `PENARIKAN_TOKOPEDIA`), method Transfer → into the
   bank, out of that marketplace pot. It is NOT revenue: Profit & Loss leaves
   it out (the sale already counted).
5. **Cutoff (builder's call, flagged to the user):** marketplace payments
   settled BEFORE the release keep counting as bank, as they always did — the
   bank balance the shop has reconciled since 2026-10-27 must not move by
   itself. `AppSettings.marketplacePotFrom` (AppSetting key
   `finance.marketplacePotFrom`, no column) holds the instant; a data
   migration sets it to the migration time. Absent = the new rule applies to
   everything (tests, demo seed).
6. **Transaction History's export follows the page's search and filters.**
7. **Profit & Loss gets a per-invoice tab**: transaction number (click opens
   the invoice — `InvoiceModal`), date, customer, revenue, COGS, profit,
   margin. Beside the existing per-product tab.
8. **The faktur prints landscape** (A4, rotated 90° from today's portrait).

## Part B — edit/delete approvals

- **Who approves:** `Staff.canApprove` (already exists). It is no longer
  forced on by role OWNER. Only the account with username **`widatech`** may
  change anybody's switch (Settings → Staff accounts; server-enforced). The UI
  never says "Ersen only" — it is a switch named *Can approve edits*.
- **What needs approval** (for an account without `canApprove`):
  - past sales — Transaction History's *Edit transaction* and *Delete*;
  - inbound money — a purchase invoice's line unit price / discount, its
    expenses (amounts, removal), its payments (edit, removal), and deleting
    (cancelling) the invoice. **QC stays open to everyone**: grade, battery,
    description, serial, sell price, arrival, Accept, Service, Return, the
    invoice's facts (supplier, number, date, warehouse) and ADDING lines,
    expenses and payments;
  - Income & Expense — editing or deleting a typed adjustment.
- **The request is the normal flow.** In place of Edit / Delete, a ⋯ menu with
  *Request edit* / *Request delete*. Request edit opens the SAME dialog the
  approver uses; its Save reads *Send request* and asks a note (why). Request
  delete asks the note. The browser computes the store changeset the edit
  would commit (same `mutate` function, run on a copy, `diffStore`, encoded)
  and POSTs it with the note.
- **`ChangeRequest`** (new table, taken under the user's go-ahead of 2026-11-13, including
  ONE JSON column, `changeset`, the proposed store changeset in wire form —
  the seventh JSON exception): `code` (CR-…), `kind` EDIT|DELETE, `status`
  PENDING|APPROVED|REJECTED|STALE, nullable FKs `orderId`, `purchaseOrderId`,
  `expenseId`, `manualIncomeId` (at most one; expense/income `SetNull` because
  those rows can be hard-deleted), `label` (what it is about, as shown),
  `summary` (the change in words, before → after), `note` (why),
  `requestedById/At`, `decidedById/At`, `decisionNote`.
- **Approve = commit the stored changeset as the approver** through
  `commitStore`. The row versions inside it are the request's base: if the
  record changed since, the commit answers 409 and the request becomes STALE
  ("changed since the request — ask again"). Reject asks an optional reason.
  One `AuditLog` line per decision.
- **Server gate:** `/api/store/commit` refuses (403) a non-approver's
  changeset that removes an order, changes an existing order's date, channel,
  customer, reference, discount, fees or an existing line's price/unit, or
  removes a line; edits an existing PO line's unit price/discount or removes
  one, edits/removes a PO expense or PO payment, cancels a PO; edits or
  removes an existing `expenses` / `incomes` row. Payments added to a sale
  (debt payments, returns, exchanges adding items) still pass.
- **Approvals page** — Financial & Report → *Approvals* (`/finance/approvals`),
  only for `canApprove`, with a count badge. Tabs *To approve* (pending only)
  and *History* (approved, rejected, stale). A row: code, when, who, what,
  Edit/Delete, note, summary; *Approve* / *Reject*.

## Part C — stock, service, reservations, Today

- **Service → *Add back in stock*** (page button): scan or type serials; each
  must be on SERVIS with an open visit (refused on its row otherwise); a fee
  per unit; one press puts them all back in stock (existing back-from-service
  rule). The bench table is just: Batch name · Total units · Warehouse · Cost ·
  Action.
- **Add reservation (staff)**: name or phone, date (visit/collect date + time),
  unit picked by PRODUCT (variant) — the picker shows the product name and its
  stock count, no serial — and DP amount prefilled from the DP setting
  (Rp 500.000), editable. A DP above zero is recorded as the reservation's DP
  payment the way *Record DP* does.
- **Today** (first nav item, only for `canApprove`): top row — *Needs
  restock* (variants sold in the last 30 days whose stock on hand is below
  what sold — builder's call), *Bank balance today* with *Reconciled* /
  *Not reconciled* for today, and *Waiting for your approval* (pending change
  requests, linking to Approvals). Below: every unit in stock as a normal
  table — product, serial, grade, warehouse, category, status, sell price,
  COGS, days in stock — filterable by warehouse and category, sortable;
  counted products as quantity rows.
