# Reservations, one list (2026-11-04) — DRAFT for owner review

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
| **Waiting for verification** | the bot saw a DP proof | not held | **Verify**, Reject, Open chat |
| **Not paid yet** | staff made it, *Not paid yet* | soft (on sale, tagged) | Record DP, Cancel |
| **Held** | staff made it *Paid*, or a DP was verified or recorded | held (`DIRESERVASI`) | Sell, Cancel, ⋯ Undo verification |
| **DP to decide** | the hold time ran out (`expire.ts`) | released | Refund / Keep |
| **Done** | sold | — | — |
| **Cancelled** / **Expired** / **Rejected** | — | released | Delete (when allowed) |

- A chatbot request with **no** DP proof is not listed: it waits in the chat,
  where the bot keeps asking. Owner: *"for the appointment, maybe we don't
  have to record it first"*.
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

### 5. Delete

- A bin on **Cancelled / Expired / Rejected** rows, behind a confirm.
- **Refused** while a DP is kept (the money stays, and so does its record).
- **Allowed** when no DP was ever paid, or the DP was **refunded**.
- It takes the reservation, its items and the DP's two payment rows (in and
  refund, which net to zero) together.

⚠️ This is a **new sanctioned hard delete** and needs a migration:
`nusantara_app` DELETE on `Reservation` + `ReservationItem`, and a SECURITY
DEFINER function for the netted-to-zero payment pair (the
`reconciliation_delete` pattern), refused when the payment is on a
**reconciled** period.

## Open questions for the owner

1. **Deleting a refunded reservation removes its DP-in and refund-out rows
   from Income & Expense.** They add up to Rp 0, but the history of that day
   loses two lines. OK? The alternative is to keep refunded rows undeletable
   and delete only the never-paid ones.
2. A chatbot request **without** a DP proof: hide it as above, or list it as
   **Waiting for DP** so staff can see who promised? Default: hide it.
3. Should *Undo verification* also be possible after the customer was sent
   the "noted" WhatsApp message? Default: **yes**. Staff are told the
   customer already got the message.

## Testing

- **Status:** `reservationStatus` (new, `lib/reservations.ts`) puts each row
  in one status, using staff/bot origin, DP state, the hold and
  `requestStatus`.
- **Hand-made reservations:** Paid writes the hold + payment; Not paid yet is
  soft.
- **Chatbot:** Verify records the payment; Undo voids it and releases; Undo
  is refused after a sale.
- **Cancel:** keep vs refund; a reservation with no DP just cancels.
- **Delete:** refused with a kept DP or on a reconciled period; allowed for
  never-paid and refunded rows. The db suite runs the function as
  `nusantara_app`.
- **Page:** one list, the Active / History tabs, and the badge.
