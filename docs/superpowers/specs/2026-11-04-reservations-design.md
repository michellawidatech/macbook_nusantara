# Reservations, one list (2026-11-04) — owner answers in

Phase 4 of the owner's 2026-11-03 list: *"Why is there a requests,
reservation and requests should be the same no?"*, *"Cannot delete
reservation row"*. Owner answers (chat, 2026-11-04):

- **Every reservation is for a DP**, default **Rp 500.000**, overridable.
- **Staff-made:** staff choose **Paid** or **Not paid yet**. No verification.
- **Chatbot:** when the bot detects a DP sent, the reservation waits for a
  person to **Verify**. Verifying records the payment on Income & Expense.
  **Undo** (⋯) takes it back.
- **Cancel** keeps the money by default, with an option to refund it.
- **Delete** only a cancelled or expired row whose DP was refunded or never
  paid.
- **Visit-only chats are not recorded.**

## What is true today (read 2026-11-04)

- `/reservations` has two tabs: **Reservations** (holds) and **Requests**
  (chatbot `ReservationProposal`s, status derived by `requestStatus`: Pending
  / Approved / Rejected / Replaced / Expired).
- **Add reservation** asks phone, name, units, source, expected date and
  note. **No DP.** It makes a soft hold. A DP is added later with **Record
  DP** (`RecordDpModal`, default from `dpRule(settings)`, Rp 500k / 7 days).
  `recordDp` holds the units (`DIRESERVASI`, `heldUntil`).
- A chatbot request is **Approved** in a dialog (units, time, "DP received",
  amount, method, day, message). The server's `approveRequest` creates the
  reservation and, with a DP, the `Payment` (MASUK, `reservationId`).
- **Decide DP** — refund (`refundDp`) or keep (`keepDp`) — ends a hold whose
  DP time ran out. Income & Expense lists *DP received*, *DP hangus* and the
  refund (`dpRows`).
- **Nothing deletes a reservation.** Prisma relations to `Reservation` are
  `onDelete: Restrict`.

## Design

### 1. One list, statuses that say what to do

The Requests tab goes. Every row is a reservation, and the **Status** column
says where it stands. The filter chips are status facets.

| Status | How it gets there | Units | Row actions |
|---|---|---|---|
| **Waiting for DP** | the bot filed a request, no DP proof yet | not held | Record DP, Reject, Open chat |
| **Waiting for verification** | the bot saw a DP proof | not held | **Verify**, Reject, Open chat |
| **Not paid yet** | staff made it, *Not paid yet* | soft (on sale, tagged) | Record DP, Cancel |
| **Held** | staff made it *Paid*, or a DP was verified or recorded | held (`DIRESERVASI`) | Sell, Cancel, ⋯ Undo verification |
| **DP to decide** | the hold time ran out (`expire.ts`) | released | Refund / Keep |
| **Done** | sold | — | — |
| **Cancelled** / **Expired** / **Rejected** | — | released | Delete (when allowed) |

- A chatbot request with **no** DP proof is listed as **Waiting for DP**
  (owner, 2026-11-04): no hold, Open chat / Record DP / Reject.
- *Show finished* becomes tabs, as on the Service page: **Active**
  (Waiting, Not paid yet, Held, DP to decide) and **History** (the rest).
- The nav badge counts **Waiting for verification** + **DP to decide**.

### 2. Making a reservation by hand

*Add reservation* gains:
- a **DP** box (default `dpRule(settings).amount`, Rp 500.000, editable);
- a **Paid / Not paid yet** switch;
- when Paid, the **method** and **day**.

Paid writes the hold and the DP payment in one mutation (`recordDp`, as
today). Not paid yet is today's soft hold. No verification step.

### 3. Verify and Undo (chatbot)

- **Verify** is today's Approve dialog, with "DP received" ticked and
  required. It records the `Payment`, which Income & Expense lists as *DP
  received*, and holds the units. *Reject* is unchanged.
- **⋯ → Undo verification** (only while the hold is untouched: not sold, no
  unit moved on):
  - **voids** that DP payment (not deleted), so Income & Expense stops
    counting it;
  - releases the units (`RESERVASI_BATAL`);
  - returns the row to *Waiting for verification*.
  
  One server transaction, with an `AuditLog` row.

### 4. Cancel

**Cancel** asks **Keep the DP** (default) or **Refund it** (method + day).
Keep is today's `keepDp` (*DP hangus*); refund is `refundDp`. Either way the
units are released. A row with no DP just cancels.

### 5. Delete (owner, 2026-11-04)

- A bin on **Cancelled / Expired / Rejected** rows (and any row with no DP).
- The confirm asks **"Was the DP refunded?"** — **No** by default — when the
  reservation holds a DP.
  - **No**: the DP stays the shop's money.
  - **Yes**: the refund is recorded as its own **expense line** (method +
    day), the ordinary kind Income & Expense lets a person delete.
- Either way the DP's money moves OFF the reservation before it goes, so
  Income & Expense keeps its lines: the DP-in becomes a `ManualIncome`
  ("DP received — {customer}", same amount, day, method) and its `Payment`
  row leaves with the reservation. Nothing about the money disappears.
- ⚠️ A **new sanctioned hard delete** and a migration: `nusantara_app` DELETE
  on `Reservation` + `ReservationItem`, and a SECURITY DEFINER
  `reservation_delete(id)` that moves the DP to a `ManualIncome`, removes its
  `Payment`, and refuses a row on a **reconciled** period or one a sale has
  adopted (the DP is part of a receipt).

## Settled questions (owner, 2026-11-04)

1. Deleting asks whether the DP was refunded (default No); a refund is a
   separate, deletable expense line. The DP-in stays on Income & Expense.
2. A chatbot request without a DP proof is listed as **Waiting for DP**.
3. Undo verification stays allowed after the "noted" message (default kept).

## Testing

- **Status:** `reservationStatus` (new, `lib/reservations.ts`) puts each row
  in one status, using staff/bot origin, DP state, the hold and
  `requestStatus`.
- **Hand-made reservations:** Paid writes the hold + payment; Not paid yet is
  soft.
- **Chatbot:** Verify records the payment; Undo voids it and releases; Undo
  is refused after a sale.
- **Cancel:** keep vs refund; a reservation with no DP just cancels.
- **Delete:** asks about the refund (default No); Yes writes one expense line;
  the DP-in survives as a `ManualIncome`; refused on a reconciled period or
  an adopted DP. The db suite runs `reservation_delete` as `nusantara_app`.
- **Page:** one list, the Active / History tabs, and the badge.
