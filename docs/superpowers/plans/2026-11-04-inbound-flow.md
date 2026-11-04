# Inbound flow (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inbound nudges arrival instead of closing, closing locks only the money, units back from service are re-QC'd, the list is six tabs, and the unit popup saves once on Done.

**Architecture:** Pure rules go in `apps/web/src/lib` (each with a vitest file), and the pages call them. The browser store (`mock/store.ts`: `mutate`, `appendEvent`, `getDb`) is the only write path. There is no schema change.

**Tech Stack:** React 19, antd 6, react-i18next, vitest + Testing Library, pnpm workspace (`apps/web`).

**Spec:** `docs/superpowers/specs/2026-11-04-inbound-flow-design.md`

## Global Constraints

- Every user-facing string goes through `t("key", "English")` and gets an Indonesian entry in `apps/web/src/i18n/locales/id.ts`. `test/i18n.test.ts` fails otherwise.
- Copy says **"unit"**, never "machine" or "mesin".
- An empty cell is `fmtNone()` and a missing amount is `fmtRp(0)`. Never a dash.
- Every unit state change goes through `appendEvent` inside a `mutate`, so the event and the projection are written together.
- No schema change and no new store collection. `DICATAT` with `toStatus: "QC"` is a legal write.
- **Spec clarification:** photos keep uploading at once. An upload is a file sent to the server, not a field. The popup's draft holds grade, battery, description, never serviced and sell price.
- Test runs: one file with `npx vitest run test/<file>`. The whole suite with `npx vitest run --maxWorkers=2 --testTimeout=90000`. Both run from `apps/web`.
- `test/setup.ts` makes every test a phone layout. Call `useDesktopViewport()` (copy it from `test/inventoryToolbar.test.tsx`) when the desktop layout is needed, and press page actions with `test/pageActions.ts` `pressPageAction`.
- Commits are blocked for the agent in this repo. At each "Commit" step, stage the files by name and hand the user the exact `git add … && git commit -m …` line. Never `git add -A`.

## Review Focus

1. **A unit back from service with no invoice** (`poId` undefined, e.g. sent from Inventory). It must appear on *Back from service*, open a QC editor, and be acceptable. → Task 3, `backFromService` test; Task 6, page test.
2. **A unit listed in two tabs** (in QC, back from service, and `qcReady`). Each unit goes in exactly one tab. → Task 5, `inboundTabs` "a unit is in one tab" test.
3. **Closing the popup with ×, Esc or the mask after editing.** It must ask "Discard changes?" and leave the store untouched on Discard. → Task 8 test.
4. **A payment that settles an invoice whose units have NOT arrived.** It must ask "Mark all n units as arrived?" and never offer Close. → Task 1 page test.
5. **A reload in the middle of a popup.** The draft must come back on this device. A draft for a unit that has since left QC is dropped, not applied. → Task 8 test.

---

### Task 1: Arrival nudge and `readyToClose`

**Files:**
- Modify: `apps/web/src/lib/inbound.ts` (add `readyToClose`)
- Modify: `apps/web/src/routes/inbound/InboundDetailPage.tsx:4091-4112` (`offerToClose` → `offerAfterPayment`; call it after the last accept too)
- Test: `apps/web/test/inbound.test.ts` (unit), `apps/web/test/inboundQcPage.test.tsx` (page)

**Interfaces:**
- Produces: `readyToClose(po: Po, units: readonly Unit[], slotsWaiting: number): boolean`. It is true when `poTotals(po).fullyPaid` and no unit of `po` has `status === "QC"` and `slotsWaiting === 0`.
- Produces: `notArrivedCount(po: Po, units: readonly Unit[], slotsWaiting: number): number`. It is `slotsWaiting` when `po.status !== "RECEIVED"`, else 0.

- [ ] **Step 1: Write the failing unit tests** in `test/inbound.test.ts`: `readyToClose` is true for paid + every unit TERSEDIA + 0 slots; false for paid + one unit QC; false for unpaid + all accepted; false for paid + 1 slot waiting. Build each `Po` with the file's existing helpers.
- [ ] **Step 2: Run** `npx vitest run test/inbound.test.ts`. Expected: FAIL, `readyToClose` not exported.
- [ ] **Step 3: Implement** both functions in `lib/inbound.ts`.
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Write the failing page tests** in `inboundQcPage.test.tsx`:
  - (a) Pay an ORDERED invoice in full. The dialog reads "Mark all {{n}} units as arrived?". OK sets `status` to `RECEIVED` and shows no "Close it now?".
  - (b) Pay in full an invoice whose units are all TERSEDIA. The existing "This invoice is paid in full" dialog appears.
  - (c) Accept the last QC unit on a fully paid invoice. The close dialog appears.
- [ ] **Step 6: Implement** `offerAfterPayment()` in the page, reading `getDb()` after the payment as `offerToClose` does:
  - if `notArrivedCount > 0`, `modal.confirm` with title key `inbound.markAllArrivedTitle` ("Mark all {{n}} units as arrived?") and ok key `inbound.markAllArrivedOk` ("Mark arrived"), whose `onOk` is `markArrived`;
  - else if `readyToClose`, the existing close dialog.
  
  Call it where `offerToClose` was called (IDP:4078), and at the end of `acceptUnit` and `acceptAll` when the store says `readyToClose`.
- [ ] **Step 7: Run** `npx vitest run test/inboundQcPage.test.tsx`. Expected: PASS.
- [ ] **Step 8: Commit** with `feat(inbound): paying in full nudges arrival; close is offered once paid and every unit accepted`.

### Task 2: Close is a finance lock only

**Files:**
- Modify: `apps/web/src/routes/inbound/InboundDetailPage.tsx:1544-1545` and every use of `locked` (grep `locked`)
- Test: `apps/web/test/inboundQcPage.test.tsx`

**Interfaces:**
- Produces, inside the page:
  - `moneyLocked = closed || !editing`, which gates the invoice facts, lines, expenses, payments and *Add payment*.
  - `qcLocked = !editing && embedded === undefined`, which gates the popup cells, Accept, *Accept all*, Service, Return, Reopen QC, *Mark arrived* and the scanner (IDP:963–970).

- [ ] **Step 1: Write the failing test.** On a closed invoice, press *Edit invoice*, open a unit's popup, set the grade, and press Accept. The unit becomes TERSEDIA. The payment button and the line inputs stay disabled. A scan onto it is accepted, with no "closed" toast.
- [ ] **Step 2: Run** it. Expected: FAIL (Accept is disabled).
- [ ] **Step 3: Implement.** Replace `locked` with the two names, use by use. `rowOpen` and the scanner take `qcLocked`, and `moneyOpen` takes `moneyLocked`. *Edit invoice* stays available on a closed invoice. The closed banner stays and says what is frozen: key `inbound.closedBanner`, "Closed — its money and lines are read-only. QC still works."
- [ ] **Step 4: Run** `npx vitest run test/inboundQcPage.test.tsx`. Expected: PASS, and no existing test regresses.
- [ ] **Step 5: Commit** with `feat(inbound): a closed invoice freezes its money, not its QC`.

### Task 3: Back in stock returns a unit to QC

**Files:**
- Modify: `apps/web/src/components/ServiceBatchModal.tsx:323-335` (`toStatus: "QC"`)
- Modify: `apps/web/src/lib/service.ts` (add `backFromService`)
- Modify: `apps/web/src/lib/qcWaiting.ts` (`qcWaitingRows` skips back-from-service units)
- Modify: `apps/web/src/components/OrphanQcCard.tsx` (skips them too)
- Test: `apps/web/test/service.test.ts`, `apps/web/test/servicePage.test.tsx`

**Interfaces:**
- Produces: `backFromService(store: Pick<MockDb, "services" | "events" | "units">, serial: string): ServiceRec | undefined`. It returns the most recent CLOSED visit of `serial` when the unit's status is `QC` and its newest event is the `DICATAT` written at that visit's `closedAt` (same `at`). Otherwise undefined.

- [ ] **Step 1: Write the failing tests.**
  - `service.test.ts`: a unit with a closed visit whose newest event is the back event → returns that visit. The same unit after a later `QC_SELESAI` → undefined. A unit with an open visit → undefined. A unit with no `poId` → still returns the visit.
  - `servicePage.test.tsx`: *Back in stock* leaves the unit at status `QC` at the chosen warehouse. Find the existing tests that expect TERSEDIA (grep `TERSEDIA` in `servicePage.test.tsx` and `stockTransfer.test.tsx`) and change them to `QC`.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Change `toStatus` to `"QC"`.
  - Write `backFromService`.
  - In `qcWaitingRows` and `OrphanQcCard`, drop any unit for which `backFromService` is defined, because Task 5's tab owns it.
- [ ] **Step 4: Run** both files plus `test/qcWaiting.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(service): a unit back from service is re-QC'd, not shelved`.

### Task 4: A charge on the visit a unit came back from

**Files:**
- Modify: `apps/web/src/lib/serviceActions.ts` (add `canAddCharge`)
- Create: `apps/web/src/components/ServiceChargeModal.tsx` (extracted from `routes/stock/ServicePage.tsx`'s charge dialog and `saveFee`, around lines 239–300 and 845)
- Modify: `apps/web/src/routes/stock/ServicePage.tsx` (use the component)
- Test: `apps/web/test/serviceActions.test.ts`, `apps/web/test/servicePage.test.tsx`

**Interfaces:**
- Produces: `canAddCharge(rec: ServiceRec, unit: Pick<Unit, "status"> | undefined, backFrom: ServiceRec | undefined): boolean`. It is true when the visit is open (`!rec.closedAt`), or when `unit?.status === "QC" && backFrom?.id === rec.id`.
- Produces: `<ServiceChargeModal visitId={string | null} feeId?={string} onClose={() => void} />`. Its writes are the Service page's own: a `ServiceFee` on `d.services[i].fees`, plus a `chargeExpense` when paid. It applies to an open visit or a back-from-service one.

- [ ] **Step 1: Write the failing tests.**
  - `canAddCharge`: open visit → true; closed visit while the unit is QC and the visit is `backFrom` → true; closed visit with the unit TERSEDIA → false.
  - Page: the Service page's *+ Charge* on an open visit still adds a fee (the existing test keeps passing).
- [ ] **Step 2: Run** them. Expected: the `canAddCharge` test fails.
- [ ] **Step 3: Implement** `canAddCharge`. Move the dialog into `ServiceChargeModal`, with no behaviour change, and render it from `ServicePage`.
- [ ] **Step 4: Run** `npx vitest run test/serviceActions.test.ts test/servicePage.test.tsx test/supplierReturnModal.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** with `refactor(service): the charge dialog is a component; a charge may land on the visit a unit came back from`.

### Task 5: The six tabs' rows

**Files:**
- Create: `apps/web/src/lib/inboundTabs.ts`
- Test: `apps/web/test/inboundTabs.test.ts`

**Interfaces:**
- Consumes: `qcWaitingRows`, `qcReady` (`lib/inboundQc.ts`), `poTotals`, `poClosed`, `poPaymentStatus`, `backFromService` (Task 3).
- Produces:
  ```ts
  export type InboundTab = "NEEDS_QC" | "BACK_FROM_SERVICE" | "READY" | "UNPAID" | "ALL" | "CLOSED";
  export interface InvoiceTabRow { poId: string; poCode: string; invoice: string | null; supplier: string; date: string; toQc: number; total: number; paid: number; owed: number; status: PoPaymentStatus; qcd: number; units: number }
  export interface SerialTabRow { serial: string; skuId: string; product: string; poId?: string; poCode?: string; grade?: Grade; battery: string; sellPrice?: number; visit?: { id: string; note: string; charges: number } }
  export function inboundTabs(store: MockDb, now: number): { NEEDS_QC: InvoiceTabRow[]; BACK_FROM_SERVICE: SerialTabRow[]; READY: SerialTabRow[]; UNPAID: InvoiceTabRow[]; ALL: InvoiceTabRow[]; CLOSED: InvoiceTabRow[] }
  ```
  - **NEEDS_QC:** invoices with at least one `qcWaitingRows` row whose unit is NOT `qcReady`, or a slot.
  - **BACK_FROM_SERVICE:** units where `backFromService` is defined.
  - **READY:** units in QC that are `qcReady`, are on an invoice or have no invoice, and are not back from service.
  - **UNPAID:** `status === "RECEIVED"`, `owed > 0`, not closed.
  - **ALL:** every non-draft, non-`BATAL` invoice.
  - **CLOSED:** `poClosed`.
  - `battery` is `readUnitBattery(...).text`, and `charges` is `visitCost(visit)`.

- [ ] **Step 1: Write the failing tests** on a `structuredClone(getDb())` store:
  - each tab's membership for one hand-made unit per case;
  - **a unit is in one tab**: for every serial in QC, exactly one of NEEDS_QC (through its invoice's `toQc`), BACK_FROM_SERVICE or READY counts it;
  - an invoice with all units accepted and paid appears in ALL, not in NEEDS_QC or UNPAID;
  - `toQc` counts the units not ready plus the slots.
- [ ] **Step 2: Run** `npx vitest run test/inboundTabs.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement** `inboundTabs`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(inbound): the six tabs' rows as one pure function`.

### Task 6: The Inbound page's tabs

**Files:**
- Modify: `apps/web/src/routes/inbound/InboundPage.tsx` (the tab `items` at :506, and the `QcWaitingCard` mount at :460 goes)
- Modify: `apps/web/src/routes/inbound/QcWaitingCard.tsx` (remove `groupQcWaiting` and its test, and keep the embedded-popup opener as `openQc(target: InboundUnitTarget)`)
- Modify: `apps/web/src/layouts/NavBadge.tsx` (count `NEEDS_QC` toQc plus `BACK_FROM_SERVICE` length)
- Test: `apps/web/test/inboundPage.test.tsx` (create it if it doesn't exist; copy its harness from `test/inventoryToolbar.test.tsx`)

**Interfaces:**
- Consumes: `inboundTabs` (Task 5), `<ServiceChargeModal>` (Task 4), and `InboundDetailPage embedded` (`InboundUnitTarget` at IDP:371).
- Tab keys and English labels, each with " ({{n}})":
  - `inbound.tab.needsQc` "Needs QC"
  - `inbound.tab.backFromService` "Back from service"
  - `inbound.tab.ready` "Ready to accept"
  - `inbound.tab.unpaid` "Arrived, not paid"
  - `inbound.tab.all` "All invoices"
  - `inbound.tab.closed` "Closed"
  - the existing `tradeIns` tab last.
  
  The active tab is `usePersistentState(draftKey("inbound.tab"), "NEEDS_QC")`.
- Invoice tabs are `ProTable` with `lazy`. Columns: Order (code with the supplier's number under it), Supplier, Date, To QC, Total, Paid, Payment status, then actions *QC* (opens `embedded` with `{poId, rowKeys: all its waiting keys, serials: its QC serials}`) and *Add payment* (navigates as today's button does).
- Serial tabs are `ProTable`:
  - BACK_FROM_SERVICE: Serial (`SerialLink`), Product, Description, Charges, then *QC* and *+ Charge*.
  - READY: Serial, Product, Invoice, Grade (`GradeTag`), Battery, Sell price, *Accept*, plus the page action **Accept all (n)** behind a `modal.confirm`. It writes `QC_SELESAI` → TERSEDIA for each row in one `mutate`.
  - *QC* on a unit with a `poId` opens `embedded` with `serials: [serial]`. Without one, it opens the same editor `OrphanQcCard` uses for that unit.

- [ ] **Step 1: Write the failing page tests:**
  - the default tab is Needs QC and lists an arrived invoice with a unit in QC;
  - *Back from service* lists a unit after *Back in stock*, with its visit's note and charges;
  - *+ Charge* there adds a fee, and `costOfUnit` grows by it;
  - *Ready to accept* → *Accept all (n)* → confirm makes every listed unit TERSEDIA;
  - *Closed* lists a closed invoice;
  - the tab choice survives a remount.
- [ ] **Step 2: Run** `npx vitest run test/inboundPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it, plus `test/qcWaiting.test.ts test/i18n.test.ts test/inboundQcPage.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(inbound): six tabs replace the Waiting-for-QC card`.

### Task 7: `useUnchanged`

**Files:**
- Create: `apps/web/src/hooks/useUnchanged.ts`
- Test: `apps/web/test/useUnchanged.test.tsx`

**Interfaces:**
- Produces: `useUnchanged<T>(initial: T, current: T): boolean`. It is a structural comparison: arrays by order, objects by key, `undefined` equal to an absent key. `initial` is captured on the first render, and again whenever the `resetKey` changes. Signature with the key: `useUnchanged<T>(initial: T, current: T, resetKey?: string | number): boolean`.
- Produces: `sameValue(a: unknown, b: unknown): boolean`, exported for tests and non-hook callers.

- [ ] **Step 1: Write the failing tests.**
  - `sameValue({a:1,b:undefined},{a:1})` is true.
  - `sameValue([1,2],[2,1])` is false.
  - The hook is true on mount, false after `current` changes, true again when it changes back, and true after a new `resetKey` with new values.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** it with `useRef` for the captured initial value.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** with `feat: useUnchanged — the shared "nothing changed" test`.

### Task 8: The unit popup saves on Done

**Files:**
- Create: `apps/web/src/lib/popupDraft.ts`
- Modify: `apps/web/src/routes/inbound/InboundDetailPage.tsx` (the popup cell renderers at about IDP:3247–3290, `commitGrade` at about :1359, and the description, battery, serviced and sell-price commits; grep `mutate(` inside those renderers)
- Modify: `apps/web/src/components/UnitDetailsModal.tsx` (add `onDone`, `doneLabel`, `doneDisabled` and `dirty` props; × / Esc / mask call `onRequestClose`)
- Test: `apps/web/test/popupDraft.test.ts`, `apps/web/test/inboundQcPage.test.tsx`

**Interfaces:**
- Produces, in `lib/popupDraft.ts`:
  ```ts
  export interface UnitAnswers { grade?: Grade; batteryHealth?: number; cycleCount?: number; fcc?: number; description?: string; neverServiced?: boolean; price?: number }
  export type PopupDraft = Record<string /* serial */, UnitAnswers>;
  export function answersOf(unit: Unit): UnitAnswers;
  export function changedFields(unit: Unit, a: UnitAnswers): (keyof UnitAnswers)[];
  export function applyPopupDraft(d: MockDb, draft: PopupDraft, opts: { at: string; staff: string; accept: readonly string[] }): void;
  export function readyAfter(unit: Unit, a: UnitAnswers): boolean; // qcReady on the merged unit
  export function parsePopupDraft(raw: unknown, units: readonly Unit[]): PopupDraft; // drops serials not in QC
  ```
- `applyPopupDraft` works per serial:
  - write the changed fields onto the unit;
  - append ONE `DICATAT` whose note lists what moved, joined with " · ", using the labels the page uses today ("Grade A → B", "Battery 89%", "Description …");
  - skip a serial with no change;
  - then, for each serial in `accept`, append `QC_SELESAI` with `toStatus: "TERSEDIA"`.
  
  All of it runs in the caller's one `mutate`.
- Page behaviour:
  - The page holds `usePersistentState(draftKey(\`inbound.popup.${poId}\`), {})`, read through `parsePopupDraft`.
  - Cells read `draft[serial] ?? answersOf(unit)` and write to the draft. The serial cell still commits at once, and photos stay immediate.
  - `n` is the number of popup serials, still in QC, where `readyAfter` is true.
  - The button reads `inbound.doneAccept` "Done & accept {{n}} units" when `n > 0`, otherwise `inbound.done` "Done", disabled while `useUnchanged(…)` is true.
  - Done runs `mutate(d => applyPopupDraft(d, draft, {at, staff, accept}))`, then clears the draft, closes the popup and calls `offerAfterPayment`'s close check from Task 1.
  - × / Esc / mask with a dirty draft opens `modal.confirm` titled `inbound.discardTitle` "Discard changes?", with OK `inbound.discard` "Discard", which clears the draft and closes the popup.

- [ ] **Step 1: Write the failing unit tests** in `popupDraft.test.ts`:
  - two changed serials → each gets one `DICATAT` and its fields;
  - an unchanged serial → nothing appended;
  - `accept: [s]` → `QC_SELESAI` and TERSEDIA after the DICATAT;
  - `parsePopupDraft` drops a serial that is TERSEDIA.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** `lib/popupDraft.ts`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Write the failing page tests:**
  - after changing a grade, `getDb()` still holds the old grade until Done;
  - Done appends exactly one event for that unit;
  - with two units complete, the button reads "Done & accept 2 units" and both end TERSEDIA;
  - an unchanged popup's *Done* is disabled;
  - × after an edit asks "Discard changes?", and Discard leaves the store unchanged;
  - remounting the page brings the draft back.
- [ ] **Step 6: Implement** the page and modal changes. Update existing popup tests that expected an immediate write: they press Done first now.
- [ ] **Step 7: Run** `npx vitest run test/inboundQcPage.test.tsx test/popupDraft.test.ts`. Expected: PASS.
- [ ] **Step 8: Commit** with `feat(inbound): the unit popup saves once on Done, and can accept what is ready`.

### Task 9: Grey Save buttons in the dialogs that edit

**Files (each gains `disabled={unchanged}` on its Save, from `useUnchanged`):**
- `apps/web/src/routes/stock/UnitEditModal.tsx`
- `apps/web/src/routes/stock/StockMovementEditModal.tsx`
- `apps/web/src/components/PriceEditorModal.tsx`
- `apps/web/src/routes/stock/ListingLinksModal.tsx` (grep `Listing links` for the actual file)
- `apps/web/src/routes/finance/EditTransactionModal.tsx`
- `apps/web/src/components/PaymentsModal.tsx`
- the Settings forms that edit an existing record (grep `Settings` routes for `okText`/`Save` on an edit dialog; a create form is excluded per the spec)
- Test: one assertion per dialog in its existing test file. Where none exists, add it to `test/useUnchangedDialogs.test.tsx`.

- [ ] **Step 1: Write the failing assertions.** Each dialog opened on a record has a disabled Save, which is enabled after one field changes and disabled again when the change is reverted.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement**, passing each dialog's open value as `initial` and its record id as `resetKey`.
- [ ] **Step 4: Run** the touched test files. Expected: PASS.
- [ ] **Step 5: Commit** with `feat: a Save button is grey until something changed`.

### Task 10: Copy, docs and the whole suite

**Files:**
- Modify: `apps/web/src/i18n/locales/id.ts` (every key added in Tasks 1–9)
- Modify: `CLAUDE.md` (one entry "Inbound flow, phase 2 — 2026-11-0x": arrival nudge, finance-only close, re-QC from service, the six tabs, save-on-Done, photos immediate, `useUnchanged`)

- [ ] **Step 1: Run** `npx vitest run test/i18n.test.ts`. Expected: PASS. If it fails, add the missing Indonesian entries it names.
- [ ] **Step 2: Run** `npx tsc --noEmit -p .`. Expected: no output.
- [ ] **Step 3: Run** `npx vitest run --maxWorkers=2 --testTimeout=90000`. Expected: every file passes. Report any failure by name.
- [ ] **Step 4: Commit** with `docs: inbound flow phase 2`.
