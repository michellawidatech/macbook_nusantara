# Stock in / stock out, reworked (2026-11-04) — DRAFT, three designs

Phase 3 of the owner's 2026-11-03 list: *"the stock in and stock out UI is
confusing especially when we switch between modals. Please fix. And then make
a plan and draft 3 design for each UI rework."* The owner picks one design;
this spec is then finished around it.

## What is confusing today (read 2026-11-04)

- The dialog opens on a row of reason buttons and **nothing else**. The
  serial table only appears after *Internal use* or *Stock transfer*.
- **Service** and the two **returns** close the dialog and open another one:
  `ServiceBatchModal`, `SupplierReturnModal`, or `CustomerReturnPanel`.
  - Serials typed so far travel along only if the user typed them under
    another reason first.
  - The customer return takes **only the first** serial.
  - The supplier return walks the serials one dialog at a time ("2 of 5").
- **There is no way back.** Closing the second dialog drops everything, and
  reopening Stock in/out starts empty.
- Each of the four dialogs asks for its warehouse, date and money in its own
  way and its own order.

## What must not change

- The rules each movement already follows:
  - `batchProblems` / `lineProblems` (stock in/out);
  - `planSendToService` and the courier split (service);
  - the supplier credit / refund rule C;
  - `planReturn` for a customer return.
- The writes: the same events, adjustments, expenses and payments.
- Stock in vs stock out stays the first choice (two buttons on Inventory).
- Duplicate serials and problems are flagged on the row as they are typed
  (shipped 2026-11-04).

---

## Design A — One dialog, the reason swaps the form below

The reason stays on top. Picking it swaps the lower half **in place**: no
second dialog, and the serial table is shared by every reason.

```
┌ Stock out ─────────────────────────────────────────────┐
│ Reason  [Internal use][Transfer][Service][To supplier] │
│ ─────────────────────────────────────────────────────── │
│ Units   ┌──────────────┬───────────────────┬─────────┐ │
│         │ FV0384…  02  │ Air 11" 2015 i5   │   🗑     │ │
│         │ + scan/type  │                   │         │ │
│         └──────────────┴───────────────────┴─────────┘ │
│ ── Service ──────────────────────────────────────────── │
│ Serviced at [03 · Servis ▾]  Courier Rp [ 40.000 ]      │
│ [✓] Split the courier into each unit's cost             │
│ ── Counted products ─────────────────────────────────── │
│                                   [Cancel] [Send 2 ▸]   │
└────────────────────────────────────────────────────────┘
```

- **Good:** the smallest change; one place to look; switching the reason
  never loses the units.
- **Cost:**
  - Each reason's fields must be lifted out of its own dialog into a panel.
  - The supplier return's per-unit credit becomes one table rather than "2
    of 5".
  - The dialog is tall for Service.

## Design B — Units first, then what happens to them (RECOMMENDED)

Step 1 is the units: scan or type them, and the list keeps them. Step 2 is
*what to do*, with the reason's details. **Back** returns to the list with
everything kept.

```
Step 1 of 2 — Units                       Step 2 of 2 — Send to service
┌───────────────────────────────┐         ┌────────────────────────────────┐
│ Stock out                     │         │ ◂ Back to units (3)            │
│ Scan or type serials…  [    ] │         │ Serviced at [03 · Servis ▾]     │
│ ┌───────────┬───────┬───────┐ │   ▸     │ Courier Rp [40.000] split [✓]  │
│ │FV0384… 02 │Air 11"│In stk │ │         │ ┌──────────┬──────────────────┐ │
│ │C02CK4… 01 │Pro 13"│In stk │ │         │ │FV0384…   │ what's wrong [ ] │ │
│ │FV1298… 02 │Air 11"│In QC  │ │         │ └──────────┴──────────────────┘ │
│ └───────────┴───────┴───────┘ │         │            [Cancel] [Send 3 ▸] │
│ What happens to them?         │         └────────────────────────────────┘
│ [Transfer] [Service]          │
│ [Write off] [To supplier]     │
└───────────────────────────────┘
```

- The action buttons are drawn **for what the list allows**. A unit in QC
  cannot be transferred, so *Transfer* is disabled with the reason on hover.
  A mixed list says which units block which action.
- **Good:**
  - It matches how the bench works: the units are in hand before the
    decision.
  - Nothing is retyped, and Back is always there.
  - One footer button names the act ("Send 3 to service").
- **Cost:**
  - A step more for a single-unit transfer, though Enter on the list goes
    straight to step 2 when only one action is possible.
  - The three child dialogs become step-2 panels.

## Design C — No reasons inside: one entry per movement

Stock in / Stock out become two **menus**, and each entry opens its own
focused dialog directly. Nothing hands off to anything else.

```
[Stock in ▾]                  [Stock out ▾]
 ├ Back from service           ├ Transfer to another warehouse
 ├ Return from customer        ├ Send to service
 ├ Written-off unit found      ├ Return to supplier
 └ Transfer in                 └ Write off (internal use)
```

- **Good:**
  - No switching at all; each dialog is what it says.
  - The existing dialogs stay nearly as they are.
- **Cost:**
  - Staff must decide before scanning.
  - Transfer appears under both menus, as today's dialog already allows.
  - Four dialogs still ask for things in four slightly different ways.

---

## Recommendation

**Design B.** The complaint is about switching dialogs and losing work, and B
removes both: one dialog, the units kept, and a Back button. A is the cheaper
build if the owner prefers to keep the reason on top.

## Open questions for the owner

1. Which design: A, B or C?
2. In B, may one list hold units headed for **different** actions (send two to
   service and write one off in one go)? Default: **no**. One action per
   list; units that do not fit the action are flagged and must be removed.
3. Should the supplier return keep one credit **per unit** (today), or one
   credit for the list with a per-unit split? Default: **per unit**, as a
   column in the step-2 table.
4. Should the customer return still be reachable from Stock in, or only from
   Returns? It is the one movement that starts from a **sale**, not a unit.
   Default: keep it, with the sale looked up from the first serial, as today.

## Testing (once a design is chosen)

- Every movement keeps its existing tests (stockTransfer, serviceBatchMany,
  supplierReturnModal, customerReturn).
- New tests:
  - Back keeps the list.
  - Switching the action keeps the list.
  - An action that the list blocks says why.
  - A mixed list cannot be logged.
