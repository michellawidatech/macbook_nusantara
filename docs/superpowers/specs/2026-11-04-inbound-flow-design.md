# Inbound flow: arrival, closing, six tabs, saving on Done (2026-11-04)

Phase 2 of the owner's 2026-11-03 fixes list (`.context/fixes-2026-11-03.md`).
Approved in chat 2026-11-04 with the defaults below.

## Why

Staff miss *Mark arrived* and *Accept*. Units sit in QC after the invoice is
paid, and paying in full offers to *close* the invoice. Closing then locks QC
on it. And every keystroke in the unit popup writes to the store, so the
activity log reads "grade None → A", then "A → None".

## What is true today (read 2026-11-04)

- `Po.status` is `DRAFT | ORDERED | RECEIVED`, and RECEIVED means arrived.
  `markArrived` (InboundDetailPage), the first serial scan (`noteArrival`) and
  a counted line's `confirmArrival` set it. `PoItem.notReceived` marks a piece
  that never came.
- Accept is `acceptUnit`: `QC_SELESAI` → TERSEDIA, gated by `qcReady`
  (`lib/inboundQc.ts`). *Accept all (n)* exists (`readyToAccept`, `acceptAll`).
- Closing is `Po.closedAt` (`closeInvoice` / `reopenInvoice`). `offerToClose`
  runs after a payment when the invoice is `fullyPaid`. The page has
  `locked = closed || !editing`, so a closed invoice blocks QC, Accept and the
  scanner.
- The unit popup (`UnitDetailsModal`) is layout only. Each cell writes through
  `mutate` on change, and a grade change appends `DICATAT`. Done only closes
  the popup. Answers given before a serial exists sit in `qcDrafts`.
- The Inbound list has two tabs, Invoices and Trade-in, plus the *Waiting for
  QC* card (`lib/qcWaiting.ts`), which opens the popup in place through
  `InboundDetailPage embedded`.
- *Back in stock* on the service bench sends a unit straight to TERSEDIA. No
  re-check, and no marker that it came back.
- No shared "nothing changed" helper exists.

## Design

### 1. Arrival and closing

- **Paying in full nudges arrival, not closing.** After a payment that leaves
  the invoice fully paid:
  - if any line has not arrived (no `RECEIVED`, or slots still waiting), ask
    *"Mark all n units as arrived?"*, which runs `markArrived`;
  - offer to close only when the invoice is fully paid AND no unit on it is
    still in QC AND no slot waits for a serial (`readyToClose`, new, in
    `lib/inbound.ts`).
- The same `readyToClose` check runs after the last Accept on the invoice, so
  the offer also comes when QC finishes after the money.
- **The Close button never refuses** (owner default, 2026-08-27 unchanged). It
  keeps listing what is still open.
- **Close is a finance lock only.** On a closed invoice the facts (supplier,
  number, date, warehouse, status), the lines, the expenses and the payments
  are read-only, as today. QC stays open: the unit popup, Accept, *Accept
  all*, Service and Return, and the scanner. `locked` splits into `moneyLocked
  = closed || !editing` and `qcLocked = !editing && !embedded`. A closed
  invoice no longer sets `qcLocked`.

### 2. Back from service → re-QC

- *Back in stock* (ServiceBatchModal, `single` and batch) appends `DICATAT`
  with `toStatus: "QC"` instead of TERSEDIA, for every visit (owner default).
  The visit closes as today.
- `ServiceRec.closedAt` + `toLocationId` stay, so the most recent closed visit
  of a unit in QC identifies "back from service". This is derived (no new
  field): `backFromService(db, serial)` in `lib/service.ts`.
- **Accepting it again** is the ordinary Accept (`QC_SELESAI` → TERSEDIA). A
  unit with no `poId` (bought outside an invoice) is accepted from the same
  tab, because the popup is opened from its row, not from an invoice page.
  `OrphanQcCard` stays for any other unit with no invoice.

### 3. Six tabs on Inbound

They replace the *Waiting for QC* card. *Trade-in* stays as the seventh tab.

| Tab | Rows | Grouping | Actions |
|---|---|---|---|
| **Needs QC** (default) | units in QC on an arrived invoice, not yet `qcReady`, plus serial-less slots | invoice × product, with Qty | QC (opens the popup in place), Add payment |
| **Back from service** | units in QC whose newest event is the *Back in stock* `DICATAT` of a closed visit (`backFromService`) | one row per unit: serial, product, the visit's description (`note`) and charges | QC |
| **Ready to accept** | units in QC that pass `qcReady` (serial, grade, a description when second-hand) | invoice × product | Accept (per group), **Accept all (n)** |
| **Arrived, not paid** | invoices RECEIVED with a balance owed (`poTotals`) | one row per invoice | QC, Add payment |
| **All invoices** | today's Invoices list, unchanged | per invoice | as today |
| **Closed** | invoices with `closedAt` | per invoice: payment status, units QC'd / total | open |

- A unit counts once: *Ready to accept* takes it out of *Needs QC*, and *Back
  from service* takes it out of both.
- Tab labels carry a count, like *Trade-in (n)*. The nav badge keeps counting
  *Needs QC* + *Back from service*.
- QC from any tab opens `InboundDetailPage embedded` over the list, as the
  card does now, so the bench's rules exist once.
- The tab is remembered per device (`usePersistentState`), and the default
  is *Needs QC*.
- Code: `lib/inboundTabs.ts` holds the six row builders, pure and tested,
  reusing `qcWaitingRows`, `qcReady`, `poTotals` and `poClosed`.
  `InboundPage.tsx` renders them. `QcWaitingCard` becomes the *Needs QC* tab's
  body.

### 4. The unit popup saves on Done

- The popup edits a **local draft**: grade, battery, description, never
  serviced, sell price and photos. Nothing reaches the store until Done.
- **The serial still commits at once.** The scan desk depends on it: a run of
  scans lands row after row, and the scan is the arrival record. Answers typed
  before the serial ride on the draft and are applied by the same mutation
  (the `qcDrafts` path, unchanged).
- With n units that pass `qcReady` and are still in QC after the draft, the
  button reads **Done & accept n units**: one `mutate` writes the draft and
  accepts those n. Units that do not pass are saved and stay in QC.
- With n = 0 it reads **Done**, and it is grey while the draft equals what the
  popup opened with. *Done & accept n* is never grey, even with nothing
  edited, because accepting is itself the change.
- **One timeline line per unit** on Done: a single `DICATAT` naming what
  moved ("Grade A · Battery 89% · Description …"), and none for a unit
  nothing changed on. On Postgres this is one commit, so one batch of
  AuditLog rows instead of one per keystroke.
- **Closing with changes** (×, Esc, the mask) asks *Discard changes?*.
- **The draft is kept on this device** under the order's existing draft key,
  so a reload does not lose a half-done popup. It is dropped on Done or
  Discard.

### 5. Grey when nothing changed

- `hooks/useUnchanged.ts`: `useUnchanged(initial, current)` compares
  structurally and is true while equal. An antd `Form` gets the same through
  `Form.useWatch` + the initial values.
- The rule: a button that SAVES or CHANGES state is `disabled` while nothing
  changed. A button that creates something new from an empty form is NOT,
  because there is nothing to compare with, and its required-field checks
  already guard it.
- Applied in this phase to the inbound popup, Edit unit, Edit stock movement,
  Set price, Listing links, Edit transaction, the payments dialog, and the
  Settings forms. The implementation plan lists each file; the rest follow
  in the phases that touch them.

## Not in this phase

- Stock in / out rework (Phase 3), reservations (Phase 4), phone layouts
  (Phase 5).
- No schema change: everything above is derived or uses existing
  events and fields. `DICATAT` with `toStatus: QC` is already a legal write
  (`reopenQc` uses `QC_DIBUKA`; the store checks only that status matches
  the last event).

## Testing

- `lib/inboundTabs.ts`: each tab's membership, a unit in exactly one tab, and
  the counts.
- `readyToClose`: paid + all accepted → true; paid + one in QC → false;
  accepted + owed → false.
- Payment flow: the full payment of an unarrived invoice asks *Mark all
  arrived*, and of an arrived, fully accepted one offers Close.
- A closed invoice: QC, Accept and the scanner work; payments and lines stay
  read-only.
- Popup:
  - nothing written before Done;
  - one `DICATAT` per changed unit;
  - *Done & accept n* accepts exactly the ready ones;
  - Discard leaves the store untouched;
  - a reload restores the draft.
- Back in stock → status QC; the unit is listed on *Back from service* with
  its charges; Accept → TERSEDIA.
- `useUnchanged`, and one disabled-Save assertion per dialog converted.
- The full web suite (`--maxWorkers=2 --testTimeout=90000`).
