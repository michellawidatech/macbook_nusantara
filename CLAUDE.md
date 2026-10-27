# Macbook Nusantara

Point-of-sale for a second-hand Apple device shop in Indonesia, with a WhatsApp +
Instagram chatbot. Rebuild of an earlier Next.js build. Staff-facing, ~3 users,
Indonesian UI.

## The one rule

The **serial number** is the subject of this database. Every state change of a
unit is an append-only `UnitEvent` row. `Unit.status` and `Unit.locationId` are
projections written in the SAME transaction as the event. Nothing is ever
hard-deleted, with exactly one sanctioned exception: **QC photos are purged —
row and file both — when the unit is sold** (owner decision 2026-08-24). The
`UnitEvent` ledger still records the sale, so the timeline stays intact; only
the image goes. Do not generalise this to anything else.

## Source of truth

**`packages/db/prisma/schema.prisma`.** The ERD was deleted 2026-08-15 and the
`docs/rebuild/` plan docs on 2026-08-20, both by owner decision. Where a
docblock and the schema disagree, the schema wins.

Decisions that outlived those documents:

- UI is antd 6, styled after `~/claudeproject/xinchuan-cms/frontend`. The
  `packages/ui` kit is shelved.
- Copy is English-first, and **fully bilingual**: every user-facing string
  goes through `t("key", "English")` and has Indonesian in
  `apps/web/src/i18n/locales/id.ts`. `test/i18n.test.ts` reads the source and
  fails if any call site lacks a translation — an untranslated string is
  invisible in English, so the test is the review.
- Nav is Stock / Product / Financial & Report / Chatbot / Customer / Settings
  (owner revision 2026-08-26). Reservation, Return and Discount are leaves
  under the section whose job they belong to, not top-level sections.
- **No breadcrumbs** (2026-08-26). A detail page passes `backTo` to
  `PageContainer` and gets a back arrow beside its title instead.
- Two merges, both 2026-08-26, and both keep the old paths as redirects:
  - **Inventory & Stock Movement** (`/stock/inventory`) is one screen and one
    table — a row per product with quantities, expanding to the serials behind
    it. `/stock/adjustment` redirects here. `?adjust=IN|OUT` opens the batch
    editor, which is how a posted stock opname records a late movement.
  - **Chatbot** (`/chat`) is the inbox and the knowledge base as two tabs.
    `/chat/knowledge` redirects here. ⚠️ Four tabs since 2026-10-15 — see
    "Chatbot v2" below.
- **Price is per variant, not per serial** (owner revision 2026-08-27, which
  reverses the 2026-08-15 decision). `Sku.price` is the only sellable price;
  `Unit.price` and its CHECK are gone. QC no longer asks for a price and shows
  the variant's instead; repricing is an edit on the Product. Grade is still
  recorded per unit and does **not** change what the shop asks. `Unit.buy` and
  `Unit.landed` stay per-serial — what one machine COST is a fact about the
  serial — and `OrderItem.price` is still the snapshot of what it sold for.
- **The chatbot answers per thread.** `WaThreadMemory.autoReply` (staff-owned,
  defaults true) decides whether the worker answers one customer unattended;
  the switch is in the conversation header on `/chat`. It gates the worker's
  draft pass and nothing else — the inbox, the "ask the bot to draft" button
  and the reply box behave the same either way, because none of them send
  without a person.
- **A reservation row does not expand** (owner revision 2026-08-27). The row
  lists its machines; picking among them is a dialog behind the row's button,
  which is also where "buy all" and the switch that releases the rest live. A
  hold's note belongs to the hold — `ReservationItem.note` still exists in the
  schema and is now written by nothing.
- **Inbound & QC, revised 2026-08-27.** Six owner changes to `/inbound/:id`:
  - An invoice can be **closed** (`Po.closedAt`) and reopened. Closing makes the
    whole page read-only and is the order's stage in the list; it warns about an
    outstanding balance or an ungraded machine but never refuses.
  - A supplier payment says which part of the invoice it settles — products,
    tax or shipping (`PoPayment.appliedTo`). Shipping is usually a different
    party, and one "Paid" figure could not say whether the ongkir was settled.
  - **A QC decision can be taken back.** Accept, Service and Return-to-supplier
    all get a *Reopen* on the row, which appends `KOREKSI` and puts the unit
    back in QC; a QC-raised supplier return is marked `CANCELLED`, not deleted.
    Blocked once the machine is reserved, sold or written off.
  - Serials & QC is **grouped by product**, one block per variant with its
    outstanding counts and asking price in the heading. Every column is typable
    before the serial is — the sticker is on the underside — and the required
    ones carry a star. A serial is at most 15 characters.
  - A description is a **list of phrases**, comma-joined in `Unit.description`
    and picked from `MockDb.qcDescriptions`, which a free-typed phrase joins.
  - All of it is in the schema as of migration
    `20260827160000_inbound_close_payment_target_qc_vocabulary`:
    `PurchaseOrder.closedAt`, `Payment.appliedTo` (enum `PayTarget`, default
    `BARANG`, existing rows backfilled), and the `QcDescription` table, seeded
    with the shop's fourteen phrases. The reopen writes `QC_DIBUKA`, a new
    `UnitEventType`; `packages/domain/unitState.ts` gained the two arrows back
    into QC and `RETUR_SUPPLIER` left `TERMINAL_STATUSES` to allow the second.
  - ⚠️ `QcDescription` has NO foreign key pointing at it, deliberately.
    `Unit.description` is free text and stays free text — a machine turns up
    with a mark nobody has seen before — and this is the suggestion list that
    field offers, joined with ", " into the sentence the column stores. Making
    it a controlled vocabulary (so Inventory could filter on "has a dent") is
    a separate owner decision.
- **New Transaction, rebuilt 2026-08-27 — and the wizard is gone the same
  day (owner revision): ONE screen, no steps.**
  - Left pane is a catalogue of **variants** with a count, category chips and
    a search that also matches serials. Tapping a row opens a chooser — grade,
    battery and the QC note per serial — because which second-hand machine
    goes out is a decision; **but a variant down to its last machine skips the
    chooser** and goes straight in the basket (owner revision 2026-08-27) — a
    dialog offering one option is a tap paid for nothing.
  - Right pane is the basket and ALL of the money: per-line price override with
    a live margin, discount, trade-in, extra charge, channel chips, payment
    chips, and a dark total panel with two buttons. **Bayar & selesaikan
    finishes the sale from there**; *Details* unfolds the details section
    below on the same page.
  - The details — customer, salesperson, referral, shipping address and the
    delivery fee — are a **folded section under the till**, not a second
    screen, and **nothing in it is required**. The salesperson stopped being
    required outright — a blocking dialog on a queue got whichever name was
    first in the list. The channel is the one thing every sale must answer,
    which is why it is on the basket.
  - The delivery fee IS the sale's `extra`/`extraNote`, prefilled "Delivery"
    when the sale is marked shipped. A sale needing two named charges would
    need an `OrderFee` table the way a PO has `PurchaseOrderFee`.
  - **Trade-in** is new (`TradeIn` in the schema, unused until now). With a
    serial the shop has bought the machine and it enters at QC with the
    allowance as its cost; without one it is only a credit off the bill.
  - `lib/pos.ts` holds the catalogue grouping and `saleTotals`, so the order
    the money is applied in — discount off the goods, extra on top, trade-in
    last, margin ignoring both — is somewhere a test can read it.
- **Grading is an inspection, not a typed letter (owner ask 2026-08-27).**
  Settings → Grading holds, **per product category**, the criteria QC checks
  (Screen, Body, Ports…), the dropdown of conditions each can be found in, and
  an ordered rule table of combinations per grade — first fit wins, a rule
  with no conditions is the catch-all and belongs last. The QC grid gained a
  Grade column whose button opens the checklist; the letter is computed,
  always overridable, optional (the description still gates acceptance, the
  grade never does), and a C suggests supplier return or service — suggests
  only. `lib/grading.ts` holds the semantics where a test reads them
  (`test/grading.test.ts`). ⚠️ Mock-only: prisma has no grading tables yet.
- **AppleDB import, revised 2026-08-27.** The modal is as wide as its columns
  need (viewport-capped); `RAM`/`Storage` arriving as a bare string is
  normalised rather than spread into characters (the "1, 6, G, B" bug); and
  every row gets a right-anchored **"Not selling"** mark — undoable, dimming
  the row, surviving a re-fetch — so next year's feed shows the deliberately
  skipped models as skipped and only the genuinely new ones stand out. A mark
  only; it blocks nothing. ⚠️ Mock-only (`MockDb.appleDbNotSelling`).
- **Income & Expense, reshaped 2026-08-27.** The top is two cards: a running
  **Balance** (opening balance + settled income − expenses; pending
  marketplace money deliberately excluded), which when nothing is recorded at
  all is a single "add the current balance" button; and a **period card** —
  today / 7 / 30 / 90 days / a calendar range. Pending money is a **table per
  channel**, because withdrawing is a per-channel errand. The chart, marketing
  scoring, expenses and movements are unchanged. ⚠️ `openingBalance` /
  `openingBalanceAt` live on the mock's `AppSettings`; the real `AppSetting`
  table has no such keys yet.
- **New or second, 2026-08-28.** A machine is sealed stock or it is
  second-hand, and the QC grid has a toggle per row that says which. Second
  needs a description and offers the grading checklist; New needs neither —
  there is nothing to inspect in an unopened box — so the description stops
  being required and the Grade button is not drawn at all.
  **The condition IS `Unit.grade`**: prisma's `Grade` enum gained `NEW` in
  migration `20260824004737_grade_new_for_sealed_stock` — whose name says
  what it was for — and the seed has been handing it to sealed accessories
  ever since, so "if it's new, the grade is new" (the owner's own words) needs
  no new column and no migration. `lib/condition.ts` is that
  reading written down, and `components/GradeTag` is the one place that draws
  it — Inventory's serial expansion, S/N tracking, the till's chooser and
  catalogue chips, the reservation dialog and the return desk all show the
  grade now.
- **A returned machine is second-hand, 2026-08-28.** `/returns` no longer
  restocks in one click: the row's *Receive* opens a QC panel — condition,
  description, and the same grading checklist QC uses (lifted into
  `components/GradingModal`, which `/inbound/:id` now shares). A unit that went
  out `NEW` says so in a banner, because the box has been opened and the shop
  must stop advertising it as sealed. The description, the regrade and the
  `RETUR_PELANGGAN` are one transaction — a moment in which the machine is back
  on the shelf still graded New is the moment somebody sells it.
- **Serials carry their supplier, 2026-08-28.** Every supplier has a two-letter
  origin code (`AS` for Apel Segar), and a scanned barcode becomes
  `AS` + Apple's serial: `SBJ347203KLM` is stored and printed as
  `ASBJ347203KLM`. The five scanner rules — Code 128, 12–13 characters,
  `^S?[A-Z0-9]{11,12}$`, no `I` or `O`, strip the leading `S` — are in
  `lib/serialScan.ts` and run **against the barcode, not the field**: a serial
  somebody types is untouched, because the rules exist to catch a misread and a
  person keying one in can see the machine. ⚠️ Schema gap: prisma's `Supplier`
  has no `code`; it wants a nullable two-character column with a unique index.
- **The label is a square QR, and the page is a setting (2026-08-28).** The
  Code 128 constraint in the scanner rules is about the supplier's barcode on
  the way IN, not about what the shop prints; read the other way round for one
  revision, and the owner corrected it. The sticker carries a **QR** — the shop
  reads its own labels with its own phones, and a QR survives creasing and a
  thumb over half of it because it carries error correction, which a row of
  bars does not. Code 128 stays selectable (`lib/code128.ts`, written out
  rather than installed) for a desk with a 1-D handheld, but it is a choice.
  **Every serial is checked before it can be printed** (`inspectStoredSerial`):
  an empty or unencodable one refuses the whole run — silently dropping it
  prints 35 stickers where 36 were asked for, and the machine with no label is
  found by somebody hunting a shelf — while a serial that merely looks wrong
  (an `I` for a `1`, an odd length) is named and printed, because it will scan
  back perfectly and the doubt is about the serial, not the sticker.
  The print dialog also asks what it is printing on: a **sheet** of paper the
  shop buys (A4, F4, Letter, Legal, A5) with the tiling DERIVED from the paper
  and the sticker rather than taken on trust, or a **thermal roll**, where the
  label is the page. `lib/labelPaper.ts` holds it; the setup is per-desk, so it
  lives in `localStorage` beside the scanner's.
  ⚠️ **2026-10-22: the page is no longer a setting** (owner: *"remove the
  customization"*). Every print is one **50 × 30 mm** sticker per page
  (`@page label-sheet { size: 50mm 30mm; margin: 0 }`, a break after each):
  a 26 mm QR of the stored serial on the left, the product name and the SKU
  code (`Sku.code`) on the right, each clamped to three lines, and **no serial
  text**. `lib/labelPaper.ts`, `lib/code128.ts` and the `nusantara.labels`
  setup are gone; the serial checks before printing are unchanged.
- **AppleDB import hides, 2026-08-28.** "Not selling" was a mark that dimmed a
  row and left it in a table of thousands. Hidden models leave the list, and a
  switch above it shows them so one can be brought back. `MockDb.appleDbHidden`
  replaces `appleDbNotSelling`. ⚠️ Still mock-only.
- **The scan rules, revised 2026-08-31.** Three owner changes, all in
  `lib/serialScan.ts`:
  - **The floor is ten characters AFTER the marker**, not twelve including it.
    The owner's own example — `SDQXFPXWCK7`, eleven characters — failed the
    old rules. A scan is now 11–13 with the `S`, the base 10–12, and the
    stored serial 12–14.
  - **The `S` is compulsory at Inbound & QC and nowhere else**
    (`parseScannedSerial(…, { requirePrefix: true })`). The owner's reason:
    the underside of a Mac carries several barcodes of much the same shape,
    and the marker is what tells the serial's from its neighbours — at the one
    desk where a wrong read MINTS a unit. Elsewhere the scan is usually the
    shop's own label, which carries no marker, so demanding one would refuse
    every scan on the sales floor.
  - **A TYPED serial at intake must be at least twelve** (`SERIAL_MIN_LENGTH`
    in `lib/inboundQc.ts`) — the two-letter code plus the ten. Deliberately
    NOT the same number as `STORED_MIN_LENGTH`, which is ten and guards LABEL
    PRINTING: every machine taken in before 2026-08-28 has a bare Apple serial
    and none of them is wrong.
  - Sales and Stock Opname resolve a scan through `resolveScannedSerial`,
    which answers with a serial the database already holds or hands the scan
    back untouched. It exists because a machine carries both labels and the
    counter reads whichever faces them; it invents nothing, and refuses to
    choose when a base matches two stored serials.
- **A stock take has a scope, 2026-08-31.** Four axes — warehouse, rack,
  product category, condition — each multi-select, and **empty means all**
  (the owner's example: "Warehouse 1 and not choosing which rack, so assume
  it's all rack in warehouse 1"). They are ANDed. `lib/opnameScope.ts` is the
  grammar; a count with all four empty is the whole shop, which is what a
  count with no scope always was. Naming racks leaves out machines still in
  QC, which are on no shelf. Without this a Tuesday recount of one rack
  reported the rest of the warehouse as lost.
  ⚠️ Schema gap: prisma's `OpnameSession` holds a single `locationId` and
  nothing about racks, categories or condition. Carrying this to the API needs
  an owner decision plus a migration — and, because JSON columns are
  forbidden, two join tables rather than array columns.
- **A stock take can take a machine into stock, 2026-08-31.** An unregistered
  serial gets an *Add to inventory* button: product, a searchable-and-typable
  reason off the `ADJUSTMENT` list, condition, and a warehouse when the count
  spans more than one. A unit that merely belongs elsewhere is NOT offered it
  — that machine exists and needs moving.
  - **It writes at POST, never before** (owner decision). A draft touches no
    unit, and a button that minted one mid-count would also make it
    *expected*, moving the missing and counted figures under the hands of
    somebody still walking the racks.
  - **It lands in QC, not on the shelf** (owner decision), with a notification
    saying so. A machine found with no paperwork has no grade, no description
    and no cost. `packages/domain/unitState.ts` gained the second genesis
    arrow for it — `{ from: null, type: "OPNAME_DITEMUKAN", to: "QC" }`; the
    same event from `HILANG` still goes to `TERSEDIA`, which is why
    `statusAfter` matches on (from, type).
  - ⚠️ `components/OrphanQcCard.tsx` on `/inbound` is the **other door into
    QC**, and it is load-bearing rather than decorative: `/inbound/:id` builds
    its grid from `poId === order.id`, so before this a unit with no order
    could never be graded and could never be sold. It renders nothing when
    nothing is waiting. No supplier return from it — there is no supplier.
- **The barcode rules, restated 2026-09-01 — this OVERWRITES 2026-08-28 and
  2026-08-31.** The owner rewrote them and said so (*"get this right, if I
  have said something differently pls overwrite it"*).

  | | shape | length |
  |---|---|---|
  | original | `S` + 10–12 | 11–13 |
  | store | two letters + `S` + 10–12 | 13–15 |

  - **`Unit.serial` is Apple's own barcode.** Nothing is prefixed at intake —
    the store barcode is DERIVED (`storeBarcodeOf`) for the sticker and for the
    "Store QR: XXSXXX…" line under the serial field. The old scheme stripped
    the `S` and stored `II` + base; keeping the `S` inside the store form means
    the two windows can never both match one read, so the ambiguity and the
    tie-break that went with it are gone.
  - **Membership, not shape, still makes a marker.** Two capitals are an origin
    code only if the shop issued them; otherwise a regulatory barcode would
    have two characters bitten off its front.
  - **Validation is absolute, and now applies to TYPED serials too**
    (`validateSerial`): *"if any barcode is not adhering to this rule then do
    not accept"*. The one scan-only rule left is `I`/`O`, which is about a
    scanner misreading a `1` or a `0` — a person looking at the machine can
    legitimately key either, so it is a print-time warning instead.
  - **The FIELD takes either barcode too, not just the scanner.** Somebody
    re-keying a machine reads whichever label faces them, and on a graded one
    that is the shop's sticker; a store barcode typed in is converted to the
    serial inside it, and `maxLength` is the store window so a pasted one is
    not truncated into a length failure.
  - **A shape fault does NOT clear the box.** `commitSerial` fires on blur, so
    clearing it meant clicking away mid-serial erased what had been typed.
    `revert()` is still right for the "belongs to another unit" collision —
    that one can never be fixed by editing — but a typo has to survive being
    looked at.
  - The seed generates `S`-prefixed serials, and the sticker (QR and text)
    carries the store form. ⚠️ `Supplier.code` is still a schema gap.
- **The marker is the SCANNER's rule, not the keyboard's — 2026-09-01, later
  the same day, and this REVISES the entry above.** *"If it is scanned (know it
  by the typing speed), then validate with S. If the barcode is typed and is
  10–12 digit, auto-add S."*
  - The `S` is printed under the bars, **not on the case**. Somebody copying
    the serial off the underside of a Mac has no marker to copy, so demanding
    one made the field refuse the number the machine actually shows. A typed
    bare serial of 10–12 gets the marker put back on it (`markTypedSerial`).
  - A **scan** is still refused without one, and that asymmetry is the point: a
    barcode carries its marker, so a burst that arrives without one was aimed
    at the regulatory code or the part number beside the serial's.
  - Speed is the only evidence there is — a keyboard-wedge scanner sends
    keystrokes and nothing else — so `lib/scanner.ts` records the last burst
    and `wasScannedText` answers the question. Inbound & QC asks it; the
    trade-in dialog does not, because it registers no scan target and a scanned
    barcode carries its own `S` anyway, so marking it is a no-op.
  - **A serial that is already valid is never re-marked.** `SBJ347203KL` is
    eleven characters, so it is both a legal marked serial and a legal bare
    one; marking it twice would file the machine under `SSBJ347203KL`.
  - `OLDER_MODEL_PATTERN` is the owner's regex verbatim —
    `^[A-HJ-NP-TV-Z0-9]{11,12}$`, eleven characters for a pre-2010 Mac and
    twelve since, no `I`, `O` or `U`. It **gates nothing on its own**: it is the
    shape `markTypedSerial` exists to catch, and it is deliberately narrower
    than the 10–12 window. The floor stays **10**, not 11 (owner decision) —
    `SDQXFPXWCK7` is an `S` and then ten, and moving the floor would refuse
    every machine already taken in under one. A typed serial that carries its
    own `S` keeps the looser alphabet, so the 2026-09-01 `I`/`O` decision is
    unchanged (owner decision).
  - **Both serial fields type in capitals** whatever the keyboard is doing. The
    value was upper-cased on commit either way; a box showing `sc02aa` while
    `SC02AA` gets filed is a field disagreeing with itself.
  - **A refused serial outlines its own box in red**, with a short reason under
    it, and the toast keeps the long sentence (owner report 2026-09-01: a toast
    is gone in four seconds and the bench has already picked up the next
    machine). Only shape faults — a collision reverts the box to what the store
    holds, and outlining THAT would accuse the wrong string. The trade-in
    dialog's serial rules moved off its `Alert` and onto the field for the same
    reason, validating on blur so a half-typed serial is not red from its first
    character.
- **The nav is dark green, 2026-09-01.** The sider carries the mark's own
  `BRAND_DEEP`, the selected item inverts to a white pill with dark green text,
  and a white **New Transaction** button sits above the account foot — a
  duplicate of the Stock leaf, deliberately, because the till is the one screen
  you *do* rather than go to. `SEED.primary` went one step darker at the same
  ask (emerald 600 → 700), which moves every green in the app together.
  ⚠️ The Menu tokens are scoped by the TREE, not by the token: `AppLayout`
  wraps the nav `<Menu>` alone in a nested `ConfigProvider` built from
  `navTheme()`. Do not lift them into `buildTheme` — a Menu token set there is
  a Menu token set for every Dropdown and Select in the app, all of which sit
  on white. The sider foot, the drawer and the phone header get their greys
  repainted by `.nusantara-nav-foot` in global.css instead.
- **Add adjustment replaces Add expense, 2026-09-01.** One modal (not a
  drawer), asking direction first: income (Sales, Account transfer) or expense
  (the six categories). An expense writes an `Expense` exactly as before, so the
  marketing scorecard is untouched; income writes a `ManualIncome`, because a
  bank transfer is not a sale and inventing an `Order` for one would put a
  receipt in Transaction History for a transaction that never happened. The
  "Money over time" chart is gone, and pending marketplace money is ONE card
  with a channel dropdown rather than a card per channel.
  ⚠️ Mock-only: `MockDb.incomes`, and `Expense.label` is now optional.
- **The till's two steps, settled 2026-09-01.** Step one ends in **Continue
  and nothing else** — *Pay & finish* used to sit on both steps, so a sale
  could be recorded from the catalogue without the payment page ever being
  seen, and the channel and the payment method are on that page. Step two
  carries *Go back to products* and *Pay & finish*, and finishing asks: one
  modal restating total, channel, payment method and any below-cost line, then
  a `Result` naming the order code with *Print the invoice* / *Next sale*. The
  old two-press "press again to confirm a loss" dance is folded into that
  dialog — a toast is the one thing on this screen that vanishes by itself.
  ⚠️ Layout: step two's panel takes the SAME `flex: 1 1 520px` the catalogue
  has. It was `width: 100%`, which is what made it full-screen — a flex item
  at 100% leaves nothing for the pane beside it, so the sale wrapped underneath
  the page it is about. The row `wrap`s only when `compact`; unconditional
  wrapping dropped the basket under the catalogue at ~125% browser zoom on a
  screen physically wide enough for both.
- **The till on a phone, 2026-09-01.** Below `md` there is no room for two
  columns, so the page is ONE: *Add product* and *Reservations* at the top, the
  basket, the suggestions, and the money **anchored to the bottom of the
  screen**. The catalogue moves into a full-width dialog behind *Add product* —
  the same component the desktop column renders, so the search, the chips and
  the "one machine left skips the chooser" rule cannot drift between them.
  ⚠️ The panel is anchored by being the last child of a `fill` flex column, NOT
  by `position: fixed`: a fixed bar needs the scrolling content padded by
  exactly its own height, which nothing can know without measuring, and a few
  pixels out either hides the last card or leaves a gap.
  ⚠️ `test/setup.ts` stubs `matchMedia` to answer "no" to everything, so
  `compact` is TRUE in every test — the whole till suite exercises the phone
  layout unless a test calls `useDesktopViewport()` first.
- **The till, reshaped 2026-09-01 — TWO STEPS, not an accordion.** The right
  pane is `position: sticky`, holds the sale and nothing else (basket, the top
  3 recommendations with *See more*, and a totals panel pinned to the bottom),
  and is on BOTH steps. The left half swaps: the catalogue on step one,
  every remaining field on step two — all open, no collapsing — with *Continue*
  and *Go back to products* between them. The sale can be finished from either.
  The accordion this replaces was the first cut of the same ask; the owner's
  verdict was that six sections you have to open is five decisions too many.
  - **An additional fee can be more than one** (`Order.fees`, ⚠️ mock-only —
    the `OrderFee` table CLAUDE.md predicted). `Order.extra`/`extraNote` stay
    as the denormalised total and its label, because that is what prisma has
    and what the invoice prints.
  - **The trade-in dialog asks what Inbound & QC asks**, all required and
    starred: product, category, serial, condition, grading, description, price.
    The serial is validated with `validateSerial`, so a trade-in cannot mint a
    malformed unit. ⚠️ A trade-in with NO serial can no longer be recorded —
    the owner made it required, and the "credit off the bill, nothing enters
    stock" case went with it.
  - **`GradingModal` reopens on the answers it was left with**
    (`initialSelection`) when the caller kept them. It still opens blank when
    given only a stored letter — a grade is a conclusion and the checklist
    behind it was never written down, so prefilling from one would show
    somebody a checklist nobody filled in.
  - "We list it at" and "We have paid" are clickable and open the unit-by-unit
    detail: which machine, what grade, what it cost.
  - **A negotiated price is a bargain, not a discount.** The subtotal is the
    LIST price and what was knocked off is its own line; above list is an
    `upsell`, credited to the salesperson in Settings → Salespeople. Both
    derive from `Order.listPrices`, a snapshot — `Sku.price` is what the shop
    asks TODAY, so deriving it later would invent bargains from a repricing.
    The free percentage and free amount left the discount picker with this: a
    discount is a code with a name, a window and a limit.
  - Margin left the basket line for a dialog behind an eye button — it is the
    shop's cost, and it was on screen whenever a customer could lean over.
  - The serial chooser stays open until every machine is taken; the trade-in
    dialog is the Inbound & QC questions in one flow (product, category,
    serial, the shared `GradingModal`, condition, and what the shop pays for
    that variant); an extra charge picks from a category list it can still be
    typed into; a customer's addresses are remembered and offered.
  - ⚠️ Mock-only: `Order.listPrices`, `Customer.addresses`, and the extra
    fields on `TradeInRec`.
- **The recommender is a scored ranking, 2026-09-01.** `lib/recommend.ts` mines
  association rules over past receipts — confidence and lift, backed off from
  the catalogue model to the category at `CATEGORY_BACKOFF` — and combines them
  with margin, stock age, price fit and bundle completion under named
  `WEIGHTS`. Every row publishes its `signals` and their contributions, which
  sum to the score. It is not machine learning: nothing is trained or stored,
  and a sale recorded a minute ago is already moving the next one.
  ⚠️ `sameKind` is what keeps a laptop off the ADD-ON list for a laptop, and
  exact grid equality was NOT enough — a 2015 Air is Chip x RAM x SSD and an
  M2 Air is RAM x SSD. It is now "one grid contains the other, or same
  category", both floored at two axes so the accessory shelf survives.
- **Stock opname, revised 2026-09-01.** The list shows the batch name first and
  the reference under it; the scope is editable mid-count on a DRAFT (nothing
  already scanned is lost — a serial outside the new scope moves to the unknown
  list rather than vanishing); and *Review & finish* now lands on an
  **expected-in-this-scope** step, per product with counted-vs-expected, before
  the confirmation. A draft can be deleted behind a two-layer confirm — the
  dialog, then typing the count's own reference. A posted count cannot be, and
  its button is not drawn.
  ⚠️ This is the app's **second hard delete**, and the reason it is allowed is
  narrow: a draft count writes to no unit and appends no event, so it is litter
  rather than history. Do not generalise it. Prisma has no soft-delete column
  and `OpnameStatus` has a `BATAL` this could map onto instead — which of the
  two the API does is an owner decision.
- **Inbound & QC, 2026-09-01.** An *Accept all (n)* button left of Print labels
  takes every row whose own Accept is enabled, in one mutation, behind a
  confirm. Same `qcReady` gate, so a row still owing a description is neither
  counted nor touched. "Battery" is "Battery Health".
- **One shop, two projections — `packages/fixture`, 2026-09-07.** The demo data
  is defined ONCE, in `@nusantara/fixture`, and both seeds project it:
  `apps/web/src/mock/seed.ts` renders it in the browser and
  `packages/db/src/seed.ts` writes it into Postgres. Before this each invented
  its own, and the deployed app therefore disagreed with itself — 26 of the 31
  screens read the browser mock and 3 read the API, so Inventory listed
  `SC02…` serials that S/N Tracking had never heard of. The Postgres side was
  also nonsense on its own terms: `NUS0000001` fails the app's `validateSerial`,
  and "MacBook Air M1 129GB · 24/180" is a machine Apple never made.
  - The fixture is pure — no Prisma, no React, no I/O, no clock (`buildShop`
    takes `now`) — the same rule `packages/domain` follows. `productCode` moved
    to `packages/domain` so both seeds derive a SKU code the same way;
    `apps/web/src/lib/productCode.ts` re-exports it.
  - **The id spaces now agree**, which is the blocker the mock→API migration
    named: a SKU is `m-air-m2-v1` on both sides, a machine is one serial, a
    purchase order is `po-1`. A page can now be moved onto the API without its
    neighbours, which was impossible while `sku_0` and `m-air-m2-v1` were the
    same variant.
  - **`test/shop.test.ts` is the seed's own review.** Every serial passes the
    shape rule, every description is phrases from the QC vocabulary, a grade
    agrees with the words beside it, a "Baterai lemah" machine reads under the
    76% floor, every sold serial is on exactly one receipt, and every total is
    `subtotal - discount + extra`. A seed that produces incoherent data is
    worse than none: every screen built on it inherits the incoherence and the
    bug reads as a bug in the screen.
  - **`seedVolume` is the old generator, renamed and demoted.** It exists only
    for the load tests that assert on five thousand rows, it now builds them
    out of the fixture's real catalogue with serials the app would accept, and
    it writes no invoices, holds or returns. It is a pile, not a shop. Never
    point a demo or a deployment at it.
  - Dates are offsets from "now", so the shop is always a shop that traded this
    week, and document numbers are derived from each document's own date.
  - What stays mock-only is what prisma has no table for — grading rules, the
    chat inbox, expenses, opname, the AppleDB import list, adjustment reasons,
    racks, `Supplier.code`. Each is marked ⚠️ where it is declared.
- **A read may not migrate ahead of its writes, 2026-09-07.** S/N Tracking was
  moved onto `GET /api/katalog/unit` while every screen that WRITES a unit —
  Inbound & QC above all — still wrote the browser store. So a machine accepted
  at QC never appeared in the tracker: not late, never (owner report: *"when I
  accept a product into the inventory it did not load immediately in the serial
  tracker"*). It reads the store again, and it goes back over with Inbound & QC,
  which is the same rule the three inbound pages were reverted under.
  - `lib/unitsApi.ts`, `GET /api/katalog/unit(/:serial)` and `packages/db`'s
    `unitTimeline` all STAY, tested and dormant. Nothing about them was wrong.
  - The timeline's context now resolves through **`UnitEvent.refCode`**, the
    document code every screen that appends an event already passes. A code is
    unique across SI/RV/PI/SP, so a machine held, released and held again by a
    different customer narrates the right person on all three rows — the
    mis-narration the server-side join was built to fix, fixed the same way on
    this side. An event naming no document falls back to its location.
  - Four things improve by being on the store, all of them visible at the
    counter: the rack (no `Rack` model in prisma), the QC description, the
    store barcode on a reprint (no `Supplier.code` in prisma), and a machine
    appearing the moment it is accepted.
  - **`/reservations` came back the same way on 2026-09-08, and it was worse
    than a stale read.** A hold booked there marked a POSTGRES unit
    `DIRESERVASI` while the store's copy of that machine stayed `TERSEDIA` —
    so the till sold it out from under the customer it was being held for. A
    hold that does not hold anything is worse than a hold nobody can see.
    Create, release and cancel are one `mutate` each now, writing the header,
    the `DIRESERVASI`/`RESERVASI_BATAL` ledger rows and the projection
    together, exactly as the till does.
    ⚠️ The cost: a hold the WhatsApp agent books is a real `Reservation` row
    and the page cannot see it. That is theoretical today —
    `packages/agent`'s `reserve` capability has ONE caller, the worker, and the
    worker is not deployed; `apps/api`'s chat route withholds the capability on
    purpose. When the worker ships, this page and the till move over together.
- **A battery has two eras, 2026-09-08.** A machine released in **2020 or
  earlier** is recorded as a **cycle count** and a **full charge capacity**;
  **2021 and later** as a **health percentage**. Not a preference — a change of
  question. macOS has always printed cycles and FCC in System Information; the
  single "Battery Health: 91%" figure is a modern reading, and on an older Mac
  the bench would have to divide FCC by a design capacity nobody has to hand.
  Three people doing that arithmetic is three answers about one battery.
  - `lib/battery.ts` holds both halves, function for function: two thresholds
    per era (the health pair are FLOORS, the cycle pair are CEILINGS — fewer
    cycles is better), and `readBattery` is the one function every column,
    filter and QC box goes through. `components/BatteryFields.tsx` draws the
    right boxes for an era; four desks use it.
  - Inventory keeps **ONE battery facet** over a mixed shelf, because the band
    NAME is the shared vocabulary — a "Good (80%+)" option beside a "Good (400
    cycles or fewer)" one would split every search.
  - **No migration needed on the Postgres side**, and finding that out fixed a
    silent bug. A battery is a `CategoryAttribute` there, not a `Unit` column —
    which is exactly the right shape for two eras, because a category spans
    both. Each unit writes the pair its era reports: `siklus` + `kapasitas`, or
    `baterai`. ⚠️ Until 2026-09-08 `packages/db`'s seed looked that attribute
    up by the key `baterai` while the fixture's categories declared `siklus`,
    so the query matched nothing and **every unit got no reading at all**. Both
    sides now name all three.
  - ⚠️ The BROWSER store still holds `cycleCount`/`fcc` on `Unit`, which prisma
    has no column for — the same shape `batteryHealth` is in.
- **Price is per serial again, 2026-09-08 — this REVERSES 2026-08-27.** *"Each
  unit will have different price (store price and marketplace price)."* Two
  2017 Airs off one pallet differ by a dented lid, a tired battery and
  Rp1.500.000, and a shop quoting one price for both gives the good one away.
  - `Sku.price` does not go away: it becomes the **asking price**, what a
    machine starts from and what an unpriced one quotes. `Unit.price` is what
    THIS machine asks, decided at QC — the grid has a price column again.
  - **The marketplace price is derived until it is overridden.**
    `Unit.marketPrice` absent means "store price + `marketplaceMarkupPct`", so
    a repricing over the counter moves it and an overridden one stays. Stored
    as the number rather than a flag beside one: a unit either carries its own
    marketplace price or it does not, and that is one fact.
  - Inventory expands **product → grade → serial** (⚠️ flat since
    2026-09-19 — see that entry), and the price is a RANGE
    per variant-grade (owner ask). Grade is the axis that MAKES them differ; the
    spread WITHIN a grade is a tired battery, and that is what the range is for.
  - `components/PriceEditorModal.tsx` reprices a whole shelf at once, with a
    fill-down per column — repricing eleven machines one dialog at a time is
    the thing that stops anybody repricing.
  - ⚠️ Schema gap: prisma's `Unit.price` and its CHECK were dropped by the
    2026-08-27 migration; `marketPrice` never existed.
- **The serial rule is one module and every field uses it, 2026-09-08.** The
  scanned/typed asymmetry was settled on 2026-09-01 and applied at exactly ONE
  desk, written inline in `InboundDetailPage`'s `commitSerial`. Every other
  serial box was stricter or looser than the bench: S/N Tracking matched
  exactly, the till and Stock Opname used `resolveScannedSerial` (which strips
  a store prefix and never ADDS a marker), and the trade-in dialog marked a
  scan unconditionally — silently repairing the misread the marker exists to
  catch.
  - `lib/serialInput.ts` is that rule, once. `readSerialInput` judges a field
    (a scan must carry its `S`, a typed serial has one added);
    `resolveSerialQuery` is the SEARCH counterpart — it invents nothing and
    refuses nothing, and tries the marked reading, which is the case
    `resolveScannedSerial` never covered: the case prints `C02740137JKM` and
    the store holds `SC02740137JKM`.
  - `components/SerialInput.tsx` is the field. ⚠️ The refusal COPY lives at the
    call sites as literal `t()` calls, not in a table — `test/i18n.test.ts`
    finds copy by reading the source, and a table indexed by a variable is
    invisible to it.
  - ⚠️ `test/tillPage.test.tsx` pins the scanner clock so every keystroke is a
    second apart. `userEvent` types faster than any person, so without it the
    file's typing is a burst and the tests pass alone and fail in the suite.
- **A sale is a LIST of payments, 2026-09-08.** *"Customer can do a split
  payment … 5jt in cash and 5jt more in tokopedia."* One method and one flag
  could not say that: the cash is in the till today and the PayLater money is
  with Shopee, and which half is which is the only question the finance screens
  ask. `Order.payments` is that list and `Order.settled` is a projection over
  it, written in the same mutation — the rule `Unit.status` follows.
  - **Three states, and merging any two is the bug this replaces.** SETTLED is
    the shop's money; PENDING is money a MARKETPLACE holds — the customer HAS
    paid; DUE is a customer debt and the only state with a date. A Shopee sale
    awaiting withdrawal used to look exactly like a customer four weeks late.
  - **Editable, and logged.** `components/PaymentsModal.tsx` corrects a sale's
    money and `lib/paymentEdits.ts` diffs it; an amount change demands a
    reason, because the number BEFORE the edit is what answers a customer
    disputing a balance next month. A state change does not — training people
    to type "x" is worse than not asking.
  - `customerBalance` rolls it up per person for Customer management. `pending`
    is reported and is NOT part of `owed`: a shop that rings a customer about
    Shopee's payout loses the customer.
  - ⚠️ Mock-only as a list, but prisma's `Payment` already has `orderId`,
    `amount`, `status`, `paidAt` and `dueAt`. What it cannot carry is
    `channel` — which marketplace holds one part.
- **A withdrawal is a document, 2026-09-08.** *"The existing system don't keep
  track of which fee is which and what the adjustment is for."* A Rp10jt sale
  paying out Rp8.850.000 has a commission, a service fee and often a bank
  charge inside that Rp1.150.000, and `Order.netReceived` lost all three.
  - `lib/marketplace.ts`: gross − itemised fees = **expected**; what the bank
    statement says is **received**, and it is the truth, because it is the only
    figure anybody can check. The difference is a **discrepancy**, shown and
    never absorbed, and it asks for a sentence — pre-filled with
    "Marketplace fee adjustment" so the common case is still one press.
  - `/finance/receivables` is the screen, and it is TWO tables because there
    are two debtors: a marketplace you press a button at, and a person you
    telephone. Grouped by channel, because withdrawing is a per-channel errand.
  - `apportion` splits a payout back across its sales largest-remainder, so no
    rupiah goes missing from every later reconciliation.
  - ⚠️ Mock-only: `MockDb.settlements`, `settlementLog`, and
    `AppSettings.marketplaceFees`.
- **Service is a place, and it costs money, 2026-09-08.** `Unit.status = SERVIS`
  said a machine was being repaired and nothing about where it was, so `wh-4`
  — `Meja Servis`, in the fixture since the beginning — held nothing, ever.
  - Sending a machine to service now MOVES it there, in the same transaction as
    the status. Found by `Location.kind`, not by id: `wh-4` is this shop's
    bench and the next shop's will not be.
  - `/stock/service` is the bench: what each machine is costing, how long it
    has been gone, and a *back in stock* that asks for the destination and one
    last fee (the courier back).
  - **`costOfUnit` = `Unit.buy` + every repair, and it is what every margin is
    now computed against.** `Unit.buy` is untouched — it is on a supplier's
    invoice, and rewriting it would make the two disagree forever. A machine
    bought at Rp4jt and repaired for Rp800k is a Rp4.8jt machine.
  - The QC grid gained a **Service fee** column, filled in before the machine
    is sent, because the courier's number is on the desk at that moment and
    never again.
  - ⚠️ Mock-only: `MockDb.services`. Prisma has the PLACE and no table for a
    visit or its fees.
- **Suppliers left Settings, 2026-09-08.** *"One supplier sending 2-3 invoices a
  month … then they will make a deposit, but they have not decided where the
  deposit money should go."* Settings held a name, a phone and a code, which is
  what a supplier was to this app: a label on a purchase order.
  - `/suppliers` owns the money. Settings keeps the address book — a phone
    number changes once a year, and a Rp30jt deposit is checked before every
    transfer.
  - **A deposit is money held against the SUPPLIER, not against an invoice.**
    `PoPayment` hangs off one order, which is exactly what a deposit is not:
    forcing the choice at the moment the money moves means guessing, and a
    guess in a ledger is worse than an unallocated balance because it looks
    like a fact. Allocating later writes an ordinary `PoPayment` with
    `method: DEPOSIT` — what that method has always been for.
  - **`Supplier.openingBalance` is debt from before this system**, stated once.
    Deliberately NOT a fake purchase order: an invented invoice would put
    phantom stock in the ledger and be counted by every report that walks
    orders.
  - ⚠️ Mock-only: `MockDb.deposits`. Prisma's `Payment` has a nullable `poId`
    so a deposit is ALMOST expressible, but nothing records which supplier it
    was paid to, or an allocation. ~~`Supplier.openingBalance`~~ became a
    column on 2026-09-13 and was **dropped again on 2026-09-24** — the owner
    stopped tracking a supplier's debt from before this app — and
    `Payment.supplierId` went with it.
- **The balance is two pots, 2026-09-09.** *"We need to separate the cash
  balance and the bank balance. So for the payment method for both income and
  expense, it is: Cash, transfer (bank), and credit card."* One figure could
  not answer the question asked every morning, which is not how much money the
  shop has but how much is in the drawer.
  - `lib/accounts.ts` is the mapping and the arithmetic: cash is the drawer, a
    transfer / card / QRIS is the bank, and a method nobody has mapped is
    reported separately rather than joining one silently. An adjustment now
    asks how the money moved (`Expense.method`, `ManualIncome.method`), and
    `AppSettings.openingBalance` became `openingCash` + `openingBank`.
  - **The balance is built from PAYMENTS, not from order totals.** A sale has
    been a list since 2026-09-08, and a customer paying half cash and half by
    transfer fills both pots off one receipt. It also drops escrow for free: a
    marketplace's money is a PENDING payment and never becomes a movement, so
    "not in the bank yet" needs no special case. The period card follows the
    same rule, or it would contradict the balance above it.
  - **Deposit is the RESULT of a payment, not a payment method** (owner's
    words). `pm_deposit` is gone from both seeds; allocating a deposit writes a
    `PoPayment` carrying the deposit's own method plus `fromDepositId`, which
    is what stops the balance spending the money twice. `TRANSFER` became
    `forPo` at the same time — the deposit dialog defaulted to a method its own
    list did not offer.
  - ⚠️ **`Order.payMethod` and `SalePayment.method` hold CODES again.** The
    till and the mock seed wrote LABELS ("Bank transfer"), which read fine on a
    receipt and made the field a different type from the one the fixture,
    prisma and every other reader use. Every screen that SHOWS a method looks
    its label up now — `Invoice`, Transaction History, the till's own summary —
    and `PaymentsPanel.methods` takes `{value, label}` rather than a flat list
    of labels. ~~Supplier payments are still not in the balance at all.~~
    **They are since 2026-09-22** — see "Paying off debts" below.
- **Serials & QC, loosened 2026-09-09.** *"The spacing now is a bit odd (too
  dense, spacing and fields are not aligned). Specifically, in setting price,
  we should not stack the store and marketplace field without specifying which
  is which."* `.qc-table` goes back to 10px with `vertical-align: middle` — the
  cell default is `baseline`, which lined up the first LINE of each cell, so a
  one-input column sat level with the first of a two-input one and every row
  stepped down to the right. `PriceFields` labels each box, and the Service fee
  COLUMN is gone: the same number is asked for in the send-to-service dialog
  below, and asking twice is what made the grid a wall.
- **A machine does not arrive by being sent, 2026-09-09.** *"When the staff
  press the service button, asks a confirmation modal that this unit will be
  sent/not to warehouse 4 for service, then add a field so that they can add
  additional fee like shipping fee from warehouse 1 to warehouse 4 … the user
  need to confirm that it has arrived in warehouse 4."*
  - The QC Service button opens a FORM: does it travel, what did the courier
    cost, what is the repair quoted at, and what is wrong with it. The status
    goes to `SERVIS` at once — a machine promised to a repairer is not sellable
    from the moment it is promised — but `Unit.locationId` does not move.
  - `ServiceRec.arrivedAt` is the confirmation. `/stock/service` is two tables:
    **Expected at the bench** (sent, not signed for) and **On the bench**, and
    *Arrived — start service* is what writes the location. Before this, sending
    a machine put it in `wh-4` instantly and the bench had a list of machines
    it could not find. A repair needing no journey opens already arrived.
  - **Every charge is editable** (`editFee`) — *"not only add but also
    reduce"*. There is no remove: nothing here is hard-deleted, and a charge
    edited to zero says "quoted and not paid". Both figures go on the machine's
    timeline.
  - The Inventory adjustment door into service follows the same rule, and a QC
    reopen CLOSES the open visit — otherwise the bench waits forever for a
    machine that is back on the grid.
  - ⚠️ `MockDb.services` is still seeded empty: a fixture machine with a SERVIS
    fate would need `packages/fixture` and the Postgres seed to agree about it,
    and the bench fills the first time a machine is sent from QC.
- **Suppliers own their whole account, 2026-09-09.** *"In supplier tab, we
  should be able to add supplier and how much we owe them, and all the
  transaction history (now is deposit)."*
  - **Add supplier here, with the old debt in the same form.** Settings can add
    one and keeps the address book; it cannot state a debt, so a supplier the
    shop already owed money to had to be created in one screen and corrected in
    another.
  - **`supplierHistory` is the account, not the deposits** — invoices,
    payments, deposits, allocations and the opening balance in one list. An
    allocation is NEUTRAL and a deposit-funded `PoPayment` is skipped, or the
    history would say the shop paid twice.
  - **A deposit may name an invoice when it is recorded** (optional — that is
    the point), and allocating one afterwards is a LIST of invoices with a box
    per row, so one transfer covering three bills is one dialog.
  - The invoice tables show `Po.invoice` under `PI-XXX`: the shop's number says
    where a link goes, the supplier's is the one quoted on the telephone.
- **A customer's payment belongs to a sale, 2026-09-09.** *"We can add payment
  (the user pay for the product, and the payment can link to specific
  transaction history), and add a due date of payment."* The customer drawer's
  order rows gained a Record-payment button opening the same `PaymentsModal`
  Transaction History uses — deliberately the same dialog, because a payment
  recorded from either place is the same event. The due date comes with it:
  `PaymentsPanel` asks for one on any part marked DUE.
- **The nav is glass, 2026-09-09.** *"Glass-inspired, but please don't revamp a
  lot, just the navbar."* The sider is a gradient — `BRAND_DEEP` through a
  brighter emerald, which is the "more vibrant" half — carrying two floating
  translucent panels: the mark and the menu, then the account foot, as the
  owner's reference shows them. The gradient is what makes the glass read: a
  translucent panel over a FLAT colour is just another flat colour and the blur
  has nothing to blur.
  ⚠️ The Menu tokens are still scoped by the tree (`navTheme()`), unchanged.
  Contrast is unchanged too and had to be — white at 85% over the lightest
  point plus the veil is 6.9:1, the selected pill still 8.6:1. Where
  `backdrop-filter` is unsupported the panel is a 10% white overlay on the
  gradient: same colours, no blur, nothing broken. The phone drawer takes the
  gradient and NOT the panels — a drawer is already a floating pane, and panels
  inside one are two frames saying the same thing.
- **Every POS screen reads PostgreSQL, 2026-09-13.** *"Make all the POS
  screen read the Postgres not Mock."* `mock/store.ts` keeps the `MockDb`
  shape and its API — `useDb`, `mutate`, `appendEvent` — and became a client of
  `/api/store`: a mutation shows at once, is diffed into a changeset and sent to
  `POST /api/store/commit`; what other tills wrote arrives by polling
  `GET /api/store/changes`. `packages/db/src/store/adapters` maps each collection
  onto the schema, `packages/store` holds the Zod contract (money as strings),
  and the commit refuses a stale base (409), an edit to the ledger (400) and a
  unit whose status disagrees with its last event. `docs/store-on-postgres.md`
  is the design.
  - Tests still run the store on the demo seed (`MODE === "test"`);
    `test/remoteStore.test.ts` drives it against a fake server.
  - The ⚠️ Mock-only gaps in the entries above — racks, grading, expenses,
    settlements, service visits, deposits, opname scope, `Supplier.code`,
    per-serial price, `OrderFee` — are columns and tables now, in migrations
    `20260913120000_store_on_postgres` and `20260913120100_store_on_postgres_checks`.
  - ⚠️ Anything else in `packages/db` that writes a row the store projects must
    call `recordStoreChanges` in the same transaction, or no till sees it until
    a reload. `appendUnitEvent` and the hold writers do.
  - ⚠️ A document number made in the browser is provisional (`SI-2026/09-T` and
    seven characters) until the commit answers with the real one.
- **The B2Soft history, 2026-09-13.** `tools/b2soft/extract.py` reads the
  export and writes monthly changesets plus `audit.xlsx`;
  `pnpm --filter @nusantara/db import:b2soft` commits them through the store in
  import mode. `docs/migration-b2soft.md` has the owner's answers; the ones
  that shaped the app:
  - `Platform` gained `TOKOPEDIA`, `TIKTOK` and `LAINNYA` ("Other" at the till).
  - B2Soft had no phone numbers, so a customer's phone is optional in the form.
  - Receivables "need to combine all": `Customer.openingBalance` is a debt from
    before this app, shown on Customers and as its own row on Receivables. A
    supplier's investor money is `Supplier.openingBalance`.
  - ⚠️ Income & Expense's balance counts only money that moved after
    `openingBalanceAt`. The import sets it to the cutoff; without it three
    years of B2Soft takings read as money in the drawer.
  - ⚠️ A customer return closes only receipts dated before it (the `events`
    adapter): a monthly import commits a return and the resale together.
- **Six revisions and three shell changes, 2026-09-15.**
  - **An invoice has a payment status, not a stage** (`poPaymentStatus`):
    OPEN is nothing paid, CLOSED is part paid, PAID IN FULL is settled. It
    replaces the Stage column on `/inbound` and on the order's own header —
    how far the GOODS have got is answered by the Products count beside it and
    by Serials & QC below it, while the question staff bring to the list is who
    is still owed money. `unitStage` stays: that is what the QC grid tags.
  - **Everything on the invoice header is editable** — supplier, invoice
    number, date, warehouse and `Po.status` (`PO_STATUS_LABEL`; leaving
    RECEIVED warns, because Serials & QC is built from it). They write on
    change, not through a Save: each field is one fact, and a page with a Save
    button is a page somebody leaves without pressing it.
  - **A supplier payment can be corrected and taken back.** One dialog for
    both; an amount without a method is refused (`lib/accounts.ts` has nowhere
    to put money whose movement nobody stated) though the box may be emptied
    while somebody thinks. A payment funded from a DEPOSIT is not editable
    here — unpicking it has to give the money back to the deposit, which is
    `/suppliers`' job.
  - **An invoice is deletable** by right-click on the list, which means
    CANCELLING: `cancelPo` sends the header to `BATAL`, marks its lines removed
    and voids its payments. `poDeletion` is the rule — it takes the machines
    still in QC with it and is REFUSED by one that has left QC, because an
    invoice is the only record of what a machine cost.
  - **Shipping and tax reach the COGS** (`lib/landedCost.ts`, owner ask): split
    evenly over the invoice's machines, because a courier charges by the box.
    `costOfUnit` is buy + that share + repairs, and every margin is against it.
  - ~~A battery reading is switchable per unit.~~ **Reversed 2026-09-19:**
    *"the system is the one that must determine."* `defaultBatteryMode` — Apple
    silicon or 2021+ is health, Intel is cycle count + FCC — is the only
    answer; the switch and `BatteryDraft.mode` are gone, and a unit's own
    numbers never override it either — the deployment starts on a fresh
    database, so there is no legacy reading to keep (owner, same day). The
    fixture follows the same rule (`recordsBatteryHealth`): a 2020 M1 is
    health.
  - **The order form saves itself** (`lib/inboundDraft.ts`), and *Save draft*
    is on every step. The two are different nets and the difference matters:
    auto-save is `localStorage` on this device and nobody else can see it;
    a draft is a real `Po` with `status: "DRAFT"`, on the Inbound list.
  - **Accessories are counted, not tracked** — `Category.tracksSerial`
    (migration `20260915140000`), false for the Accessory category.
    ⚠️ The per-item `Unit` and `QTY-` handle below are GONE since 2026-09-19 —
    see "Counted products are quantities". `lib/serialTracking.ts` is the
    reading. A `Unit` row still exists per item
    and still carries a serial, because that is what a `UnitEvent` names and
    what `Unit.buy` is the cost of; what changes is that nothing ASKS for one.
    QC's Serial column says "Counted — no serial" and a *Take in* button mints
    the handle (`countedSerial`, prefixed `QTY-` so anybody who meets one can
    see it was not read off a machine). Stock opname answers those shelves with
    a NUMBER — `OpnameSession.counts`, `OpnameCount` in the schema (migration
    `20260915141000`) — where absent means "not reached" and **zero means
    somebody looked**. A shortfall marks that many lost; a surplus mints that
    many into QC. Settings → Product categories is the switch; it is per
    category and not the category being NAMED "Accessory", for the reason
    `wh-4` records.
  - **The nav collapses by hand, and the bubbles are gone.** `openKeys` is the
    person's answer and is kept (`hooks/usePersistentState.ts`); the accordion
    that kept `keys.slice(-1)` is gone, and so is the effect that ASSIGNED
    `[openSection]` on every navigation — the same accordion by a second door.
    A fold button rails the whole column to `siderCollapsedWidth`. The two
    floating glass panels of 2026-09-09 are gone with them; the gradient stays,
    because flattening it would be the revamp the owner asked twice not to
    have.
  - ~~**The app has tabs**~~ (`layouts/tabs.ts`, `layouts/AppTabs.tsx`) —
    **removed 2026-09-21** (owner ask), files deleted; `git show 4832efe:apps/web/src/layouts/AppTabs.tsx`
    has them. See "Tabs out, drafts in" below.
  - **The keyboard is wired, not just written.** `lib/keyboardNav.ts` was the
    kit; now `EditableTable` takes the grid arrows **in the CAPTURE phase**
    (antd's `InputNumber` calls `preventDefault` on ↑ ↓ to step its value, so
    on bubble every arrow arrives already claimed and Qty was the one column
    they could not leave), `DataTable` takes `keyboardRows` to put a row that
    opens something into the tab order with ↑ ↓ Home End and Enter/Space, and
    `ProTable` marks its search box for `/`. `?` lists the lot.
    ⚠️ `keyboardRows` is opt-in: a row that opens nothing must not become a
    focus stop, or forty read-only rows are forty presses of Tab.
- **A `v*` tag deploys to the Mac mini, 2026-09-18.** Render and Netlify are
  retired (their files are gone; `git show f6f5f3c:docs/deploy.md`), and the
  shop's Mac mini behind Tailscale is the only deployment.
  `docs/deploy-pipeline.md` is the runbook.
  - **The release is built on GitHub's `macos-15` runner, never on the Mac
    mini** — `build-release.mjs` exists so the shop's machine holds no source,
    and a runner that checked the repo out there would undo it.
  - **The deploy job joins the tailnet as an ephemeral `tag:ci` node** and SSHes
    in as `nusantara-deploy`, whose key has a forced command:
    `ops/nusantara-deploy`, root-owned at `/usr/local/libexec/`, with four
    verbs (status, backup, install, rollback). ⚠️ A release ships a copy but can
    NEVER replace the installed one — a change to it reaches the Mac mini only
    through `ops/setup-deploy-access`, and the job warns when the two copies'
    `INSTALLER_VERSION` differ.
  - Migrations run from CI through the ssh tunnel as the owner, after a
    `predeploy-<version>` pg_dump, and are verified by QUERY: every migration
    the tag carries applied, none half-done, grants `t|f|t|f|t`. The installer
    then refuses any switch whose `/api/health` does not name the new release
    (`ApiConfig.release`, exported by `ops/run`), and switches back by itself.
    The database is never rolled back automatically — which is why a
    migration must never break the release before it.
  - Every credential is in the GitHub Environment `prod`, which admits only
    `v*` tags.
  - ⚠️ CI had been red since 2026-08-19 for two reasons neither of which was a
    code bug: turbo 2's strict env mode never passed `TEST_DATABASE_URL` to a
    suite (it is in `turbo.json`'s `passThroughEnv` now), and the role tests
    log in without a password, which the CI container refused until it was
    set to trust (`POSTGRES_HOST_AUTH_METHOD`). CI now runs on every push to
    every branch, and no longer on `pull_request` as well.
- **Sign-in is the app's own, 2026-09-18 — Auth0 is gone.** *"Make a secure
  login system … seed the account and the password, initially all will be
  'password', then in the first time login need to change their password and
  Ersen can manage all the password account."* The password login under Auth0
  was already sound (Argon2id, session tokens stored as SHA-256, per-username
  and per-address progressive delay, `LOGIN_GAGAL` audit); what changed:
  - `apps/api/src/auth/auth0.ts`, its two tests, `express-openid-connect` and
    the `/auth` proxy and Caddy route are gone. `LoginPage` is a form again.
  - **`Staff.mustChangePassword`** (migration `20260918120000`, additive,
    default false — the one new column, owner-asked). A session of such an
    account gets 403 `GANTI_SANDI` from every business route
    (`requirePasswordChanged`) and `App` shows `ChangePasswordPage` and nothing
    else. `POST /api/auth/password` asks for the current password even then,
    and on success revokes EVERY session of the account and opens a new one
    in the same transaction (08 §9: rotate on a credential change).
  - What a password may be is `passwordProblem` in `packages/domain`
    (credentials.ts): 8+ characters, not the initial one, not containing the
    username, not on a short local blocklist. The form and the API run the
    same function. `INITIAL_PASSWORD` is `password`, public by the owner's
    choice, which is exactly why an account on it can do nothing else.
  - **Settings → Staff accounts** (`/api/staff`, owner-only per endpoint):
    add, rename, role, can-approve, switch off (ends every session), reset to
    the initial password. Never shows or sets a password; never lists or
    touches a service account (`agent`, `system`, `migrasi-b2soft` —
    `SERVICE_ACCOUNT_USERNAMES` in `packages/db`); nobody may demote or switch
    off themselves.
  - **`pnpm --filter @nusantara/api accounts --owner ersen`** gives every
    active salesperson a login (username from the first name) and every human
    account still on the seed's unusable hash the initial password; the seed
    itself stays locked on purpose. `staff … --initial` does one account.
    Both ship in the release (`ops/run accounts|staff`).
  - `TRUST_PROXY` (default `loopback`): with `trust proxy 1`, req.ip behind
    tailscale serve + Caddy was 127.0.0.1 for every client, so one person's
    typos throttled the whole shop.
  - A request whose body names a password is never fingerprinted by the
    idempotency middleware — the fingerprint is an unsalted SHA-256 of the
    body, stored in a table the app reads.
  - ⚠️ `Staff.auth0Sub` is dead and kept for ONE release, so the release before
    this one still finds the column it selects during a deploy. Drop it after.
- **The chatbot answers from the owner's sheet and hands over the rest,
  2026-09-18.** *"For stock, price, negotiation, and other questions that are
  not in the documents RAG, we should escalate it to human"* — because the
  shop runs this app in PARALLEL with B2Soft and production holds only the
  master data. `docs/chatbot-rag.md` is the design; in short:
  - Two sources only: the owner's approved answers (`AgentKnowledge`, first
    loaded from `docs/chatbot/knowledge-2026-09-18.md`) and the system's master
    data (store, hours, payment methods, catalogue configurations —
    `systemFacts.ts`). No unit, price, order or customer is read. The stock and
    booking tools still exist, tested, but `toolsFor` offers only
    `CUSTOMER_TOOLS`.
  - Retrieval is BM25 over normalised Indonesian chat spelling
    (`retrieval.ts`); the whole base rides in the CACHED half of the prompt
    (`buildAgentPrompt`) with `K` handles the model must cite.
  - Every turn ends in `reply(message, sources)` or `handoff_to_staff` under
    `tool_choice: any`. `routeMessage` sends a named machine's stock / price /
    condition, battery health, payments, bookings, budgets and photos to a
    person before the model sees them; `checkReply` turns a reply with no
    source, or with a figure or a "ready" its source does not contain, into a
    hand-over with `holdingMessage`.
  - A hand-over is PERLU_STAF + `intent: staf:<topic>` + `entities.handoff`,
    and the worker HOLDS the thread (no more bot replies) until a staff reply
    or `POST /api/inbox/:phone/handled`. Derived from the rows, not from
    `autoReply`, which the agent's role cannot write by design.
  - `sanitiseReply`, not `stripFormatting`, for these replies: the old one
    rewrote "1–3 hari" to "1, 3 hari" and dropped the owner's brackets.
  - The persona now sounds like the owner's answers (kak, 😊, 🙏) and no longer
    sells from a shelf it cannot see.
  - `import:b2soft … --master-only` imports the reference chunk alone, without
    opening balances — what production takes during the parallel operation.
    `pnpm --filter @nusantara/api knowledge <file>` / `ops/run knowledge`
    loads an answer sheet; /chat → Knowledge → Import from a document pastes
    one. Both read it with `parseQaText` and skip what is there.
- **Leftovers cleared before the next deploy, 2026-09-18.** Nothing on disk
  blocked the pipeline; what did is that the good work was UNCOMMITTED (a tag
  would ship `f6f5f3c`), `v2026.09.18` was already pushed at `f6f5f3c` with a
  failed run, and the `prod` environment has no secrets yet. The Docker +
  Cloudflare route (`deploy/docker/`, `docs/deploy-docker.md`, the root
  `Dockerfile`, `.dockerignore`), the TEST-export extract (`build/b2soft`) and
  the 2026-09-11 hand-built release were moved to
  `~/projects/macbook_nusantara-archive-2026-09-18/` (README there); build
  outputs (`packages/db/build`, `apps/web/dist`, `build/macmini/stage`,
  `.turbo`) were deleted. The 2026-09-13 release and its maps stay in
  `build/macmini/` — it is what the Mac mini runs until a CI release does.
- **Inbound, the flow put right — 2026-09-18, late.** *"You do not get the
  flow of the inbound right."* This REPLACES the same day's one-table
  "receiving" rework (never committed; its summary band, progress bar, Details
  drawer and add bar are gone). `/inbound/:id` is four blocks, in the order
  the work is done:
  - **The invoice's facts**, editable in place. *No invoice* is a checkbox
    worded like the order form's — the switch said "No invoice" on and off.
  - **Inbound**, folded by default (open only while the invoice has no lines):
    the invoice as entered, grouped back into product × qty × unit price
    (`lib/invoiceLines.ts`, `InvoiceSection`). Qty up adds machines at the
    product's last price; qty down takes only machines nobody has scanned;
    correcting the product moves every machine still in QC that followed it.
  - **Units**, one row per machine: product, serial, unit price with its
    **COGS** under it, sell price, a **QC** button (needs the serial) and the
    two row decisions, Service and Return. No status column (owner). A row
    whose product changed says *Previously X*; **what differs from the invoice
    is listed under the table, NET of swaps** (`invoiceChanges`): *"they might
    just be inputting the price wrong … and then they might swap the unit name.
    That is a price correction … you should not flag it, but should still
    display the prev unit."* Only rows in a real difference are tinted.
  - **Purchase**: goods, every expense, and the payments.
  - **QC is a centered dialog** (`QcModal`) — ⚠️ REPLACED 2026-09-19 by
    columns on the row; see that entry. Order: condition → Enter →
    battery (health for Apple silicon or 2021+, otherwise **FCC** and **CC**,
    decided by the model, no switch since 2026-09-19) → grade (a typed A/B/C
    select) → Enter → description → Enter on an empty box → photo; Tab from the
    grade reaches *Configure grade*, which folds the category's checklist
    (`components/GradingChecklist`, shared with `GradingModal`) open inside
    the dialog. Answers write as given; ONE `DICATAT` line for the inspection
    is appended when the dialog closes. **Done = QC passed (`QC_SELESAI`)**,
    still gated by `qcReady`; Service and Reject are the other two decisions.
  - **Expenses are rows** (`ExpenseModal`) — migration
    `20260918180000_po_fee_cogs_and_payment_link`, owner-approved:
    `PurchaseOrderFee.inCogs` (default true), `.removedAt`, and
    `Payment.poFeeId`. The store's `Po.shippingFee`/`taxFee` became
    `Po.fees[]` and a payment carries `feeId`; `byFeeOrder` (packages/store) is
    the one order both sides list them in. *Split into COGS* feeds
    `invoiceCharges`; *Paid* records a payment for what is unpaid, tied to the
    expense, and un-ticking or lowering the expense takes it back. A payment
    from before names only a bucket and `poTotals` spreads it over that
    bucket's expenses; the migration links the unambiguous ones.
  - ⚠️ `tools/b2soft` now writes `fees=[]`. A changeset extracted before
    this change is refused by the store's strict schema — extract again.
  - Payment status reads **Open / Partially paid / Fully paid** (codes
    `OPEN`/`PARTIALLY_PAID`/`FULLY_PAID`); "Closed" said the opposite of what
    it meant. The app's active tab was the brand green (`.nusantara-app-tabs`,
    gone with the tabs on 2026-09-21),
    and Knowledge pins Updated, Active and the pencil to the right.
- **The redesign brief, 2026-09-19** (`Redesign Plan & Changes.pdf`, twelve
  pages, plus four asks in chat). What it changed, screen by screen:
  - **"Unit", never "machine"** — in every string the app shows, English
    and Indonesian ("unit", never "mesin"). Owner: *"remove the machine
    dictionary from this app, it is supposed to be unit."* Write new copy
    that way; say it that way to the user too.
  - ⚠️ **The PDF's page-1 layout notes are NOT applied.** It asks for
    left-aligned forms and Next/Back "right below the form"; that shipped
    and was reverted within the hour — *"it is wrong… it will be centered
    aligned and the button will be sticky to the bottom"*. `FORM_CENTRE` and
    the fixed `FooterToolbar` stand. Page 1's accordion note was already
    done (2026-09-15).
  - **A product can be added from the Units card** (2026-09-19) —
    `AddUnitsBar`, the same `addLines` the Inbound section calls, so it is
    an invoice line either way; the caret lands on the new row's serial.
  - **A filter lists words, not codes.** A `facet` column whose `sortValue`
    is an index or an enum needs a `facetValue` giving the label, or the
    header filter offers `0`/`INCOME` (Inbound's payment status, Income &
    Expense's Type — both fixed 2026-09-19).
  - **Nothing waits for anything (inputs, not decisions).** *"I don't need to
    input serial first, I could input in whatever order I want."*
    - Inbound: QC is COLUMNS again, the PDF's order — Unit | Serial | Battery
      | Unit price | COGS | Description | Grade | Sell price | actions. The
      2026-09-18 `QcModal` is gone. Battery, description, grade and photos
      typed on a row with no serial yet are held in `qcDrafts` and written
      onto the unit by `identify` in the mutation that mints it
      (`applyQcDraft`); a serial typed before the product waits in its box.
      **Grade is the condition**: the dropdown is New / A / B / C
      (`lib/condition.ts`); the checklist opens beside it (`GradingModal`).
      Photos sit behind the row's camera button (`UnitPhotos` has a `draft`
      mode). Accept / Service / Return still need the serial — they are
      decisions about a particular unit — and say so on a disabled button.
    - Trade-in: the category is its own box (the checklist needs only that),
      the grade is a hand-picked letter, the product is ENFORCED (the store
      refuses a unit without one, which refused the whole sale).
  - **Price is per unit, from the first box** (PDF p3): the Inbound section
    and the order wizard take a product and a quantity and make that many
    UNPRICED rows; nothing copies a price across units. A product is never
    one price anywhere: *"when qty is 2 there will be 2 input rows"* (user,
    later the same day), so the order page's Inbound section gives each unit
    of a product its own price box, numbered as the Units list numbers its
    rows — the same number, typed in either place (`InvoiceGroup.units`,
    `components/CommitMoneyInput`).
  - **Inbound list** (p2): Order | Supplier | Date | Payment status (the
    unpaid amount under *Partially paid*) | Total price | Total paid |
    *Add payment* (opens the order with its payment dialog, via navigation
    STATE — nothing navigates from an effect) and *Delete*.
  - **Marketplace price is per VARIANT** (p3): the highest per-unit
    marketplace price among its units on sale (`variantMarketPrice`); no
    per-unit box anywhere. `Unit.marketPrice` still exists and still counts.
  - **Inventory is flat** (p4): one line per variant × grade × warehouse,
    unit price and sell price as ranges, *Set price* / *Print barcode*; a line
    opens a popup of its units (⚠️ nested under the line since 2026-10-02) with an "i" per unit breaking down the COGS
    (`components/CostBreakdown`). **Export stock** (p5) writes .xlsx after
    B2Soft's PERSEDIAAN BARANG, with `lib/xlsxWrite.ts` — no dependency.
  - **S/N Tracking** (p6) lists every serial (filters: category / product /
    unit tree, last-movement dates); *Check history* opens the old view.
  - **Stock opname** (p8): one live table of every expected unit from the
    start; scans move to the top in green, the rest red. This REVERSES the
    blind count the page's own comments argued for. *Add to inventory* still
    writes at POST.
  - **The till's payment** (chat ask 4 + p11): four chips — Transfer, Cash,
    Shopee, Tokopedia (**only the four**, owner answer; TikTok stays a
    channel) — any number of them; each picked method is a row with a split
    amount (the last row takes the rest) and an actual-paid amount (less
    than the split is a debt, piutang, with an optional due date).
    `lib/tillPayments.ts`. A **payment reference** (the marketplace's order
    number) is required when the channel or a method is a marketplace;
    stored on `Payment.ref`, now in the store contract. Payments are written
    against what is COLLECTED — they used to cover the bill before the
    trade-in, putting the trade-in's value in the drawer as cash.
  - **Trade-Ins dialog** (chat ask 2): title *Trade-Ins*, one star (the
    dialog drew its own beside the app's), nothing at all to grade on a New
    unit, the *We list it at* / *We have paid* cards gone. An accessory
    (counted category) has no serial box; the till mints its `QTY-` handle.
  - **Returns & exchange** (p9–10, `lib/returns.ts`): a return CREDITS the
    sale — full price by default, overridable (owner answer), less a per-unit
    "additional expense" — as an `OrderAdjustment` RETUR carrying the SG
    code, and the credit cancels what the customer still owes, then what a
    marketplace holds, then is handed back as a refund (`Order.refunds` →
    `Payment` with direction KELUAR). Unpaid → a return; paid → a buy-back;
    one rule. An exchange puts the replacement on the SAME sale at its price.
    Several units per form; a serial finds its sale (`saleOfSerial`).
    `orderBalance` / `billAfterReturns` are what every money screen asks.
  - **Receivables** (p11): the sales a payout covers are ticked; the note
    says where the money really landed (*"one step + note"*, owner answer:
    a friend's account is recorded as received, with a note); a Shopee
    income report (.xlsx, read by `lib/xlsxRead.ts`) marks sales received by
    their payment reference. ⚠️ Fixed: settling wrote comma-joined ids into
    `Settlement.paymentId`, so any payout of two or more sales was refused by
    Postgres — one `Settlement` per payment now.
  - **Transaction History** (p12): Order number / reference | Unit | Status
    (Returned / Partly returned) | Payment status | Received | actions.
  - **"Selected is dark green and hard to see"** (chat ask 3): antd derived
    the selected fill from this deep a seed as a mid green (`#a5b8af`,
    `#72ab93` on hover) in light and an invisible one in dark. `SELECTION`
    in tokens.ts states real tints; the dark scheme seeds emerald 500
    (`SEED.primaryDark`, primary text 5.5:1); the till's total panel and the
    active app tab use `BRAND_DEEP`, and the panel's main button is white.
    `test/theme.test.ts` checks the contrast.
  - ⚠️ Schema gaps still open: ~~`Location.code` is not in the store~~ (it
    is since 2026-10-08 — see "Four asks"), and a settlement's note lives on
    the payments because `Settlement` has only `reason`.
- **Counted products are quantities, in the database too — 2026-09-19.**
  *"For accessories literally don't record any individual measurements like
  code, no need, that should purely be by qty"* — and, asked how far: the
  database as well, with arrival confirmed per product. A category with
  `tracksSerial = false` has **no `Unit` rows at all**.
  - **`StockMove`** (migration `20260919120000_stock_move_counted_products`,
    owner-approved): an append-only ledger — sku, location, signed `qty`,
    `unitCost` per piece, `type` (`MASUK`, `MASUK_BATAL`, `TERJUAL`,
    `RETUR_PELANGGAN`, `TUKAR_TAMBAH`, `OPNAME`, `KOREKSI`), links to the
    invoice line, order line, stock take and reason. On-hand is `SUM(qty)` and
    nothing stores it. The app role has INSERT and SELECT only. The store
    collection is `stockMoves`; `adapters/stock.ts` refuses a move of a
    tracked variant and, on a till, a shelf below zero.
  - **Cost is a moving average per variant** (`lib/stock.ts` `averageCost`):
    an arrival adds its pieces at the line's price plus their share of the
    invoice's COGS expenses (the same `poRowShares` split units get — a
    counted line's pieces were always rows of the parcel); a sale snapshots
    the average onto its `TERJUAL` move, and the adapter adds it to
    `OrderItem.cogs`/`Order.cogs`.
  - **Inbound**: a counted product is ONE line of a quantity at one price —
    never rows in the Units table. The Units card lists it under *Counted
    products* with **Confirm arrived (n)** (a `MASUK`, marks the order
    arrived) and *Undo arrival* (`MASUK_BATAL`, refused once pieces have been
    sold or moved). Qty cannot go below what arrived.
  - **The till** lists counted variants off the ledger; a tap adds a piece
    (no chooser), the basket line has a qty and a per-piece price, and the
    sale writes `Order.lines` (an `OrderItem` with `unitId` null) plus
    `TERJUAL` moves, the till's warehouse first (`takeFrom`). Bundles count
    pieces: a `BasketLine` is one piece, by serial or by `skuId`.
  - **Everywhere else**: Inventory lines and popup (the moves), the
    adjustment batch (a *Counted products* list), stock opname (expected is
    the ledger in scope; posting writes `OPNAME` moves — nothing marked lost,
    nothing minted; a rack scope leaves counted stock out, it sits on none),
    customer returns (a qty per line → `RETUR_PELANGGAN` straight to stock and
    `returnedQty`), trade-ins (`TUKAR_TAMBAH`), recommendations, invoice,
    Transaction History. Settings refuses to flip a category's
    `tracksSerial` while it holds stock of the old kind.
  - **A counted product goes back to its supplier by quantity** (owner ask,
    same day). Returns → To supplier has a *Counted product* mode: product,
    warehouse, qty, the invoice it came in on, reason. It writes ONE
    `RETUR_SUPPLIER` move (migration `20260919150000`, one enum value) with
    the SP code in `refCode` — **a move, not a `UnitReturn`** (owner
    decision), so the invoice is what names the supplier and there is no
    expected credit. It shares the supplier-return history table.
  - **A customer's counted piece skips QC** (owner, same day): it goes
    straight back on the shelf; a damaged one comes off with an adjustment.
  - ⚠️ Not covered: a counted product cannot be RESERVED.
  - **B2Soft**: `tools/b2soft` still replays accessories as pseudo-serials
    (FIFO gives every piece its cost) and turns them into moves and quantity
    lines on the way out; `COUNTED_CATEGORIES` is `Aksesoris`, `Charger`,
    `Box`, `Sparepart`. Verified end to end on a throwaway database
    2026-09-19: 4,511 moves, no negative shelf, every control OK.
  - ⚠️ `OpnameCount` had no grant for `nusantara_app` since `20260915141000`;
    the new migration grants it.
- **Receivables, reshaped 2026-09-20.** Both tables were rebuilt to the owner's
  own column lists, and the screen is `ProTable` on both halves now — so each
  gets the search box, the header filters and the phone cards every other list
  has.
  - **The marketplace table is FLAT and holds both halves.** No expansion, no
    tick-boxes: one row is one marketplace payment, pending rows first (oldest
    sale first, the one nobody has chased) and received ones underneath
    (newest payout first). Channel · Order number · Date · Amount · Received ·
    the action. The order number cell is the shop's SI code with the
    marketplace's own number under it, and the search reads both — *"a search
    button for the order reference"*.
  - **`Receive` records THAT row's payout**, alone. ⚠️ The consequence: a bank
    transfer covering five sales is five presses. `splitPayout` and `payoutsOf`
    are untouched and still used (a settlement of one is what they make of a
    single part), so the grouped form is recoverable; the database always held
    one `Settlement` per `Payment` and still does.
  - **A deduction is free text and it DRIVES what landed.** The dialog's kind
    dropdown is gone — a statement does not arrive in five kinds and the name
    beside it was the part anybody read — and the received box now follows
    `gross − Σ deductions` as they are typed. It was seeded once on open and
    then sat still, so every deduction added after that had to be subtracted by
    hand. `FeeKind` survives in the data (the seeded line is `COMMISSION`, a
    typed one `OTHER`) because that is what `Settlement.fees` and the schema's
    enum hold. Typing a figure detaches it — a bank statement outranks
    arithmetic, which is the 2026-09-08 discrepancy-and-reason machinery,
    unchanged — and *Follow the deductions again* re-attaches it.
  - **The Shopee income-report upload is gone** (owner ask), with the
    `shopeeImport.*` copy. `lib/shopeeIncome.ts` and `lib/xlsxRead.ts` stay,
    tested and dormant; `ShopeeIncomeImport.tsx` does not. The separate
    "Withdrawals recorded" card went with it, because the received rows are in
    the table above now.
  - **Owed by customers answers a telephone call**: transaction number (with
    the promise date under it) · item · customer · telephone number · amount ·
    received, and two buttons — the receipt (`InvoiceModal`) and the payment
    history (`PaymentsModal`, full CRUD with its log). Deliberately the same
    two dialogs Transaction History and the customer drawer open: a payment
    recorded from any of them is the same event and must write the same log.
    A debt from before this app still has neither, and keeps its link to
    Customers.
  - **Waiting money is Shopee and Tokopedia, hard-coded** (`holdsPendingMoney`
    in `lib/channels.ts`, owner ask later the same day). It was every payment
    in PENDING, and `legacyPayments` reads an unsettled order written before
    the payment list as ONE pending payment carrying the ORDER's channel — so
    an unpaid walk-in or WhatsApp sale sat on the marketplace table. Money a
    person owes and money a platform holds are the two things this screen
    exists to keep apart. ⚠️ Deliberately NOT `holdsFunds`, which is also true
    of TikTok: that asks "did this SALE settle at the till", this asks "can
    money be waiting HERE", and the till's four payment methods do not include
    TikTok. **Income & Expense's pending card reads the same function**, and
    it was wrong the same way plus one more — it summed each sale's whole
    `total`, so a bill half cash and half Shopee reported all of it as sitting
    at Shopee. Its column is *Awaiting withdrawal* now, per payment.
  - **Nothing is seeded and nothing is guessed** (owner: *"the payment pending
    is not always deducted as 10%, the user should be the one adding the
    deduction"*). The dialog opens with an EMPTY table, the row's Received
    cell says only "Waiting", and `seedFees`/`commissionPctOf`/
    `AppSettings.marketplaceFees` are no longer read by any screen.
  - **The dialog is the deductions table and nothing else.** The "Deducted /
    Amount received" block, the typable override, the discrepancy alert and
    its reason, and the where-it-landed Note all went (owner ask). What landed
    is `gross − Σ deductions`, computed in one place and shown on the row. A
    payout that came up short is a deduction nobody has named yet, which is a
    row in the table. ⚠️ This retires the 2026-09-19 "one step + note"
    decision; `SalePayment.note` still exists and Transaction History still
    edits it.
  - **Both row actions are icon buttons, and every row has the payment
    history** — waiting or not (*"don't put receive on 1 and then symbol on
    the other"*). Transaction History matches: its **Status column is gone**
    (the per-unit Returned tag on the line is what somebody actually needs,
    and the CSV export still carries the whole-sale word), and its two buttons
    are the same pair, same icons, same order, same words.
  - **The marketing card is four columns**: channel, spent, customers, sales.
    Revenue, cost per customer and return on spend left together (owner ask) —
    each turned a self-reported referral into a hard-looking rupiah figure.
- **FCC and CC share a row, 2026-09-20.** *"For the inbound battery section in
  FCC and CC, make it in 1 row not separate row."* They are one reading off one
  screen in System Information, and stacking them made one battery look like
  two questions and cost the QC grid a row's height per unit.
  `components/BatteryFields` is horizontal now, so all four desks follow.
  ⚠️ Two things make the pair fit: the capacity box gets half again the cycle
  box's share (`GROW`) because it holds four digits and the longer suffix, and
  the stepper arrows are off — nobody nudges a measured battery by one, and the
  arrows were eating the width the fourth digit needed ("7538" rendered as
  "75… mAh"). The battery columns went 150 → 230 at Inbound & QC and in the
  Inventory batch editor.
- **Inbound is a line and a popup, 2026-09-20 — and this REVERSES the per-unit
  price rows of 2026-09-19.** *"User will input: unit, qty, price. It will not
  automatically expand the unit below it. Input product name > QTY > price >
  discount > display total (+ COGS based on the tax + shipping fee displayed
  before). When the user clicks tab, then it will display a modal popup for the
  user to fill: Serial, grade, battery, sell price."*
  - **One table, drawn by ONE component on both screens**
    (`routes/inbound/PurchaseLinesTable.tsx`), because the owner asked for
    exactly that: *"either seeing inbound detail and adding new inbound will
    have the same display for the unit and it should only have that."* The
    order form's step 2 and `/inbound/:id` are the same rows —
    Unit | Qty | Unit price | Discount | Total | COGS | Units (n/qty).
  - **Everything per unit is in the popup** (`components/UnitDetailsModal.tsx`):
    serial, grade, battery, description, sell price, photos and the row's
    decisions. Tab off the discount box opens it; the button is drawn too.
    Description is in it although the owner listed four fields — a second-hand
    unit cannot be accepted without one (`qcReady`), so a popup that never
    asked would be a popup after which nothing could be shelved (owner answer,
    same day). The popup's order is what moves the caret: an empty description
    on Enter now hands on to the SELL PRICE, not back to the grade.
  - **What went**: the collapsed *Inbound* section (`InvoiceSection.tsx`,
    deleted), the list of one row per unit, the per-row product picker, and
    the discrepancy panel — *"the user will handle it manually (add new
    product, changed product no need to flag, mark as not arrived, and remove
    the line)"*. A product is a fact about the LINE now, and correcting one
    relabels every unit of it still in QC. ⚠️ `invoiceChanges` in
    `lib/inboundRows.ts` stays, tested and dormant.
  - **One price per line.** Asked, and answered: *"if 2 same unit have
    different price, they would manually input 2 times."* So two prices are two
    lines, and `lib/invoiceLines.ts` groups on **product AND price** — lines of
    one product at one price are one row however they were typed.
  - ⚠️ **The storage did not change.** A `PoItem` is still ONE piece: that is
    what pins a unit to its line (`PoItem.serial`), what `lib/landedCost.ts`
    spreads the expenses over, and what `receivingRows` builds the bench's rows
    from. Only the READING is per line. Which is why a writer must find a
    line's pieces by (skuId, unitCost) INSIDE the mutation (`piecesOf`) and
    never by the ids the last render saw: `editOrder` runs `normaliseLines`
    first, which gives pieces 1…n new ids, so an id filter finds one piece of
    three and every quantity change adds the difference twice.
  - **A line discount is a column**, owner-approved: `PurchaseOrderItem.discount`
    (migration `20260920120000_po_item_line_discount`, BIGINT default 0, CHECK
    `0 <= discount <= qty * unitCost`), in the store contract as optional so a
    changeset extracted before it still commits. `Po.discount` is unchanged and
    is still the one negotiated off the WHOLE order.
    ⚠️ It lowers what each unit COST: `pieceCosts` spreads it largest-remainder
    over the line's pieces and `Unit.buy` is written net, so every margin behind
    it is right rather than only the invoice total. `normaliseLines` splits it
    with the pieces for the same reason.
  - **The order form now mints units.** Serials typed into its popup become
    real units in QC at Save, with their `DITERIMA` in the same mutation — the
    same thing `identify` does on the order page. A *draft* mints nothing.
    Auto-save carries them, at `nusantara.inbound.draft.v2`.
  - **Grading configuration is hidden** (owner ask, same day): Settings →
    Grading is gone, and so is every *Configure grade* / checklist button —
    Inbound & QC, `OrphanQcCard`, the return desk and the trade-in dialog all
    pick a letter by hand now. ⚠️ `lib/grading.ts`, `GradingModal`,
    `GradingChecklist` and `GradingSettings` are untouched on disk and still
    tested; the Settings tab is one line to bring back, and each call site says
    where its button was.
- **Nine asks, 2026-09-21** — `docs/assumptions-2026-09-21.md` is what was
  decided where the brief left room, and it is the file to correct first.
  - **A supplier is paid in cash or by transfer**, and nothing else
    (`PaymentMethod.forPo`, migration
    `20260921090000_po_payment_methods_cash_and_transfer`). MARKETPLACE left
    the supplier side; it is still what a marketplace SALE is written with.
    ⚠️ The supplier deposit dialog and the invoice expense dialog read the same
    flag, so they stop offering it too.
  - **The till's Actual paid is cash and transfer only** (`canPayInPart`), and
    the box starts **empty** with the split as its placeholder. Empty still
    means "the whole split", which is what an absent `paid` has always meant —
    a cash sale must not default to a piutang. A Shopee or Tokopedia part is
    paid in full by construction and shows the amount as text.
  - ⚠️ The next two bullets are SUPERSEDED by "The serial, restated
    2026-09-21 (evening)" below.
  - **A scanned `I` becomes `1` and a scanned `O` becomes `0`**
    (`correctScanConfusables`), everywhere a barcode is read. It is no longer a
    refusal: Apple prints neither, so there is exactly one thing each can have
    been, and refusing sent the bench back to the same imager and the same worn
    label. SCANS only — a person looking at the machine could legitimately key
    either.
  - **Apple's SHAPE is enforced on a NEW unit only** (`validateSerial(s,
    {strict})`, `readSerialInput({grade})`). A second-hand label has been
    through however many owners and the number the shop can read off it is the
    only number there is. What survives on every unit: not empty, capitals and
    digits, the `S` marker on a SCAN (it tells the serial's barcode from the
    regulatory one, which is a fact about the case), and a ceiling that still
    catches two scans with no Enter between them (`LENIENT_BASE_*`). The field
    takes `SERIAL_FIELD_MAX_LENGTH` now, not the store barcode's fifteen.
    ⚠️ The page-level loose scan is LENIENT: it arrives with no row focused, so
    nothing has said yet which machine it is about.
  - **Payable & Receivable** (`/finance/payable-receivable`,
    `lib/payableReceivable.ts`): utang and piutang side by side, one row per
    party expanding to its documents. Closed invoices count, drafts do not.
    ⚠️ `customerDebtOf` exists because `legacyPayments` reads an unsettled
    pre-2026-09-08 sale as one PENDING payment on the ORDER's channel — so
    every sale the B2Soft import brings over would have reported zero debt.
  - **The chatbot had never received a message.** `WaRawEvent` was empty: the
    webhook is on loopback and `tailscale serve` publishes the POS over the
    TAILNET, so Meta had nowhere to POST to. `ops/whatsapp-funnel` publishes
    `/webhook` and only `/webhook`; `ops/run chatbot` walks the whole path and
    says which half is broken. `docs/chatbot-runbook.md`.
  - **`AGENT_CAPABILITIES`** (`agentCapabilities`, packages/agent policy.ts) is
    the switch between the 2026-09-18 bot and the 2026-09-21 one: stock,
    prices, unit condition, the shop's own photos and ONE write —
    `create_reservation`. **Unset is the cautious reading and is the default**,
    because after a cutover the shelf is empty and a bot reading it would tell
    every customer the shop has nothing. Negotiation, payments, complaints, a
    photo the CUSTOMER sent and CANCELLING a hold still go to a person.
    Photos go by handle through a `WA_IMAGE` outbox row (migration
    `20260921100000_outbox_image_send`); the model never sees an image and only
    handles `unit_photos` gave it this turn are accepted.
  - **The Shopee cost structure is code** (`lib/shopeeFees.ts`), and the two
    worked examples in `docs/shopee-fees.md` are its tests. The upload takes
    either export: a Rincian Penghasilan's stated payout WINS and the rates
    only itemise it; an order export is estimated and says so. `Total
    Pembayaran` is refused as a payout column — the foot-gun
    `docs/shopee-settlement-import.md` named.
  - **Stock exports as .xlsx, .pdf or both.** `lib/pdfWrite.ts` is written out
    rather than installed, for the reason `xlsxWrite` and `code128` already
    record.
  - **The shop's product naming convention is `shopProductName`**
    (packages/domain): `AIR 13" 2020 I5 8/256`, from B2Soft's PERSEDIAAN
    BARANG. An Apple-silicon machine prints its CHIP where an Intel one prints
    its YEAR — ⚠️ except before 2020, where `M3` is an Intel Core m3.
    `Sku.code` is this now instead of `SKU_17`. `productCode` is unchanged:
    that is the sticker, and labels are already on machines.
  - **The cutover is `docs/cutover.md`**, and its extract-and-import half was
    run against a throwaway database on the real export:
    `extract.py … --balances-only` then `import:b2soft … --master-only
    --with-balances` gives 159 models, 369 SKUs, 64 suppliers, 38 customers,
    Rp1,560,030,931 receivable, Rp6,887,861,193 payable and **zero units**.
    Three years of documents become two numbers per party, taken from B2Soft's
    own aged reports rather than from a replay.
- **The Shopee upload reads the seller balance report, 2026-09-21, later.**
  *"The purpose of this file is to see what they actually receive … if there
  is discrepancies that are not mentioned in the rule just add like Biaya
  lainnya / additional payment."* The file is
  `my_balance_transaction_report.shopee.*.xlsx` (Saldo Penjual → Export), and
  `docs/shopee-settlement-import.md` has its columns.
  - An order's payout is the sum of its rows' `Jumlah`, and that is what
    lands. ⚠️ `Jumlah` counts as money ONLY with the whole signature
    (`BALANCE_HEADERS`) — in the order export it is the quantity — and
    `Saldo Akhir`, the running balance, never does.
  - The deduction is itemised by the published rates, then closed on
    Shopee's figure by `closeOnPayout`: the rest is **Biaya Lainnya**, or
    **Pembayaran Tambahan** as a line BELOW ZERO when Shopee paid more.
    `settlementTotals`, `mergeFees` and `splitPayout` net a negative line now
    instead of clamping it. A person cannot start one (a new box in
    `SettleModal` stops at zero); the box drops its `min` only for a line
    already negative, or the first blur would clamp it and rewrite what landed.
  - Not ticked, with the reason beside it: an order with more than one
    balance row (a return the courier compensated Rp10.000.000) and a
    payout above the rates. A payout of zero or less cannot be recorded here.
  - Ad top-ups and withdrawals in the file are listed, never recorded. ⚠️ The
    POS has no home for either yet (owner decision): the top-ups are an
    expense, and a received payout counts as in the bank although it sits in
    the Shopee balance until a Penarikan Dana.
  - Run against the real file and the order export: 12 of 16 orders reconcile
    to the rupiah (docs/shopee-fees.md, "What the balance report settled"). It
    also showed Komisi AMS carries 11% PPN (`PPN_PCT`) and that the 5 kg
    listings pay Rp60.000 of Ukuran Khusus ongkir.
- **Tabs out, drafts in, 2026-09-21.** *"Remove the tab view but the user
  must be able to drag the feature and open it in another tab and all the
  things of the user input will be saved locally."*
  - `AppLayout` renders `<Outlet />` again; `AppTabs`, `tabs.ts`,
    `tabScope.ts` and their test are deleted. **Every nav row is a real
    `<Link>`** (antd stretches it over the row), and the New Transaction
    button is an `href` — so a place can be dragged onto the browser's tab
    bar, cmd- or middle-clicked. The menu's `onClick` navigates only for the
    keyboard and a click on the icon; a click on the link is the router's.
  - **Work in progress is kept on this device** by `usePersistentState`
    (`draftKey("…")` names it). It now follows a key that changes under a
    live page (`/inbound/po-1` → `po-2`), syncs between browser tabs of the
    same page (`storage` event), removes a key whose value is `undefined`
    rather than writing it, and takes a `null` key as plain state. What comes
    back is read through `lib/draftGuards.ts`; a shape an older build wrote is
    dropped, not rendered. `useFormDraft` is the same for an antd `Form`.
  - **What is kept:** the till's whole sale (basket, customer, channel,
    payments and references, fees, trade-ins, step) — a restored unit that has
    since been sold is taken off with a warning, and `?serial=` JOINS the kept
    basket; Inventory's adjustment batch (the dialog reopens with it); the
    customer return form (a PICKED date only — "today" is not stored); the new
    discount form; the chat reply, per thread; an inbound order's unsaved row
    input (typed serials, prices, QC answers before a serial), per order; and
    every page list's search, filters and sort (`ProTable persistKey`, 24
    lists — never a list inside a dialog) plus S/N Tracking's own search.
    Short modal forms (products, suppliers, customers, settings…) are not
    kept: each saves on submit, and a half-typed one is a click to redo.
  - ⚠️ **Stock opname lost its last scans on leaving the page.** The autosave
    waits 1.2 s and the unmount cleared the wait; the tabs had hidden it. It
    flushes on unmount now (`opnameSurplus.test.tsx` fails without it).
- **The till's payment is a table, 2026-09-21.** *"Cash/transfer → amount and
  actual paid; Shopee, Tokopedia → the amount & reference number (1 for
  shopee 1 for tokopedia)."* Payment method | Amount paid | Actual paid /
  Reference number. **The reference lives on the part** (`TillPart.ref`) and
  is written on that part's payment, so a Shopee + Tokopedia sale carries two.
  The sale-level box shows only when the channel is a marketplace and no part
  is paid through one (`saleRefNeeded` — TikTok, or Shopee taken in cash).
  `paymentRefOf` lists every distinct reference, so Transaction History shows
  both.
- **The Shopee upload's view, 2026-09-21.** Reference number | Order nominal |
  → | Receivable ⓘ, over EVERY waiting Shopee sale. **Yellow and on top means
  "does not match"**: what Shopee paid differs from the published fees (a
  Biaya Lainnya or Pembayaran Tambahan), or the row is not plain — nothing
  paid, a compensation beside the payout, a number two sales share. A sale
  the file does not mention is dimmed at the bottom, not yellow: Shopee has
  simply not released it. The ⓘ is a popover with the lines and their rates.
  A Biaya Lainnya row is still ticked (the owner's rule is to name it and
  record it); the unusual ones are not.
- **The serial, restated 2026-09-21 (evening) — this OVERWRITES 2026-09-01,
  2026-09-08 and the morning's two serial bullets above.** *"New item, scan:
  validated against the S and 10–12 characters and 1 and 0 instead of I or O.
  After that the S will be removed. New item, typed: validated against 10–12
  and 1 and 0. Second, scanned: no validation. Second, typed: no
  validation."* — and the same afternoon: *"Delete the supplier auto-append in
  serial number. It turns out we do not record that at all."*

  | | new (`NEW`) | second-hand (A/B/C) |
  |---|---|---|
  | scanned | `S` + 10–12, `I`/`O` → `1`/`0`, the `S` dropped | as read |
  | typed | 10–12, `I`/`O` → `1`/`0` | as read |

  - **A new unit is filed under Apple's serial WITHOUT the barcode's `S`**:
    `SC02740137JK` is stored as `C02740137JK`. A typed string that is exactly
    a barcode (`S` + 10–12) is read as one and loses its `S` too — a scanner
    too slow for `wasScannedText`, or somebody copying the line under the bars
    — while a ten-character serial that starts with an `S` keeps it, because
    without it it is nine. "As read" is trimmed, upper-cased, blanks removed,
    and nothing else: no length, no alphabet, no marker check on a scan.
    `lib/serialScan.ts` owns the shapes, `lib/serialInput.ts` the decision.
  - **No supplier code anywhere.** `storeBarcodeOf`, `components/StoreLabelTag`
    ("Store QR:") and the derived sticker are gone; a sticker prints the stored
    serial (`lib/labels.ts`). `Supplier.code` is still a field in Settings that
    nothing reads — retiring it is a separate decision. `resolveSerialQuery`
    still reads a 2026-09-01 store sticker back to its unit, should one exist.
  - **The serial waits for the grade (owner answer).** The rule depends on the
    condition and the bench reaches the serial box first, so a serial read
    before its row has a grade is HELD in its box (amber, "Pick the grade to
    record it") with a note of whether it arrived as a scan (`heldScan`, kept
    on this device — `wasScannedText` remembers five seconds), and judged the
    moment a grade is picked. Nothing is minted in between: a unit filed as
    second-hand and then graded New would be a sealed unit nobody checked. A
    loose scan onto an ungraded row is held the same way and focus stays put,
    so a run of scans still lands row after row; Enter in the box still moves
    to the next waiting row. The order form holds it in `UnitDraft.pending`
    and refuses to PLACE an order around an unjudged or refused serial (a
    draft is not asked). A unit graded New AFTER its serial was filed is
    warned about, not renamed — a unit's serial is its name in the ledger.
  - **Read-only boxes validate nothing** (owner: *"for read only
    scanning/typing, there should not be any validation"*). The till, S/N
    Tracking, stock opname and the return desk go through
    `resolveSerialQuery`: the input, without an `S`, with one, and with
    `I`/`O` read as `1`/`0` — never a guess between two units — so a unit filed
    either way is found from its barcode or its case.
  - Units filed before this — every intake from 2026-09-01 to the afternoon of
    2026-09-21, and the whole demo seed (`packages/fixture` `serialAt`) — keep
    their `S`. Nothing rewrites them.
  - ⚠️ `/api/inbound` (unused by the web) still enforces the 2026-09-01
    `S`-form. `katalog` and `reservations` take serials up to 23 characters,
    the field's width, since a second-hand serial has no length.
- **The till takes a typed serial straight into the basket, 2026-09-21.**
  *"When we type in serial number, we should automatically add the unit instead
  of showing the unit name and choosing it manually."* The catalogue's search
  box is a serial box too: the moment its text names one unit outright —
  whole, and not the head of a longer serial the shop also holds
  (`serialNamedBy`) — a sellable unit goes on the sale and the box empties for
  the next; one that cannot go (sold, in QC, already on the sale) says so under
  the box. Enter does the same for a serial that is the head of a longer one. A
  tapped catalogue row still opens the chooser.
- **Returns & exchange, reworked 2026-09-21.** *"The user can add multiple
  product in exchange. Either they input the serial or the transaction; only
  then show the unit for replacement in the inventory. If the unit they
  exchange for is cheaper than the one they purchase, the money will not
  return."* — and, asked how far: one unit back for two out, and units back
  from TWO transactions at once, mixed, exchanged for one, two or three.
  - **The form holds a list of sales.** A serial adds the sale it is CURRENTLY
    out on (a unit sold, returned and resold can only come back on its newest
    receipt — `returnableSerials`), the transaction picker adds one by hand;
    each sale is a block of its own with its units ticked. *Exchange for* is
    a search over the shelf (TERSEDIA units and counted stock) that a whole
    serial drops straight into — the till's `serialNamedBy` rule — with a
    price per replacement. Several sales and a replacement: *Put the
    replacements on* picks the sale they go out on (the newest by default).
  - **The screenshot's section is gone**: the *Refund value* box, its hint,
    the Return/Buy-back tag and the "cancels … a marketplace is holding"
    sentence. The credit is not overridable — a unit is worth what it sold
    for, less its additional expense. What is left on screen is what somebody
    must act on: *Hand back Rp X* on a plain return, *Customer pays Rp X* on a
    dearer exchange, each with Cash/Transfer.
  - **The money is `planReturn`** (lib/returns.ts, `test/returns.test.ts`). A
    plain return is `applyReturnCredit` per sale, unchanged. An exchange: each
    other sale cancels its own debt first; what the customer PAID on it
    (settled or held by a marketplace) can move to the sale taking the
    replacements, and moves as a copy of the payment — same method, state,
    channel, reference and `at` — so no rupiah is counted twice and the
    balance's history does not change; the replacements are paid from that
    pool, the customer pays any shortfall now, and a pool bigger than the
    replacements cancels debt and is otherwise the shop's: **nothing is ever
    handed back in an exchange**. A sale's RETUR is only what was USED of its
    credit (it can be zero).
  - **Several replacements, no schema change.** Each replacement unit's
    `TERJUAL` names the exchange's first unit-return SG code, which on
    Postgres is the event's foreign key to that `UnitReturn`
    (`unitReturnId`); counted replacements carry it on their `StockMove`.
    Every return row of the exchange gets `exchangeSerial` = the first
    replacement, which groups them, and the history's Replacement column
    lists them all. S/N Tracking resolves such an event to its sale.
  - **A RETUR's reason names the marketplace order** it undid ("… (Shopee
    260912RGK2YKYU)", `marketplaceRefs`): a return that cancels what Shopee
    held removes the payment and its reference with it.
  - **Check a Shopee file** (Return history → `ShopeeRefundCheck`,
    `lib/shopeeRefunds.ts`). The seller balance report — or the order export
    — lists each REFUNDED order against its sale: a refund is an order whose
    OWN "Penghasilan dari Pesanan" row is zero or less (−Rp53.625 on
    260912RGK2YKYU), never the order's net — the same order's Rp10.000.000
    "Kompensasi Jasa Kirim" makes it net positive. Matched by payment
    reference, then by a RETUR naming the number (`returnNamesOrder`), which
    is also what makes it read *Return recorded*. *Record return* opens the
    ordinary form on that sale with everything still out ticked; the dialog
    itself writes nothing. ⚠️ Neither the fees Shopee kept on a refunded order
    nor a courier's compensation is recorded anywhere — the same owner
    decision as ad top-ups.
  - ⚠️ **`paymentsOf` reads a sale with a RETUR by its own list, even an empty
    one.** An empty list used to fall back to `legacyPayments` — one payment
    for the whole ORIGINAL total — so a fully returned sale put money nobody
    received into the balance. The return form writes every involved sale's
    list out, changed or not, so the rule holds; Postgres projects "no rows"
    as no list, which is why the rule keys on the adjustment.
  - ⚠️ A unit added to a sale already in Postgres adds its cost to
    `Order.cogs` (`syncSaleLines`); it used to be counted only when the sale
    was created, so every exchanged-out unit was missing from the sale's cost.
    `packages/db/test/store.test.ts` covers both halves.
- **Returns simplified, serials open popups, no dashes — 2026-09-21,
  evening.** Three owner asks in one message.
  - **The return history is three columns**: transaction number / reference
    (the SI code, its marketplace `Ref`, then the SG codes and date) · every
    product that came back, one per line, with its Receive button · the
    exchange units with name, condition and serial — empty when nothing went
    out. One row per RETURN, not per unit: a press of *Record return* is
    grouped by its RETUR adjustments' shared `at`, older rows by
    `exchangeSerial`, then by code (a B2Soft document's lines share one).
    Counted pieces come from their `RETUR_PELANGGAN` moves. The payment-status
    and reason columns and the top-up `fee` left the table.
  - **The return form is two tables in a 1360px modal**: reason and date on
    top, *Return* on the left (every listed sale's units in one table, the
    sale's code spanning its rows), *Exchange for* on the right. They stack
    below `xl`.
  - **A clickable serial opens `SerialHistory` in a popup** (`SerialLink`),
    never navigates. The dialog is mounted ONCE by `SerialHistoryHost` in
    `AppLayout` — a dialog inside a table cell would have its keystrokes and
    clicks bubble (React bubbles through portals) into `EditableTable`'s
    capture handler and row `onClick`s. S/N Tracking keeps `?serial=` in place.
  - **No "—" for missing data, anywhere**: a number says 0 (`fmtRp(null)` is
    `Rp 0` now) and a word says **`fmtNone()`** — "None" / "Tidak ada",
    following the language like `fmtDate`. The one exception is a battery with
    no reading, which says None rather than 0%/0 mAh: 0 is a dead battery. An
    input box shows no dash placeholder either. Write new empty cells this way.
- **Four screens reshaped, 2026-09-21 evening.** The morning's grouped
  Payable & Receivable, the four-card Income & Expense, the return dialog and
  its history all changed under one ask.
  - **Payable & Receivable is TWO TABS** (⚠️ two nav leaves since
    2026-09-22 — see "Paying off debts") and each table is FLAT — one row per
    document. Payable: Supplier · Date · Inbound number · Total · Paid · Owed.
    Receivable: Customer · Date · Phone · Transaction ID · Total · Paid ·
    Owed, with a *View invoice* button on every row. **Owed prints red**
    (`#cf1322`) on both. Both carry an *Export .xlsx* / *Export .pdf* pair
    (`lib/tableExport.ts`, on top of the existing `xlsxWrite`/`pdfWrite`) —
    plain text at the top for the shop's name and the printed-at line, the
    columns as their headings, and a grand-total row at the foot. The
    2026-09-21 morning grouping is still readable in `payableGroups` /
    `receivableGroups` — this page now flattens their rows.
  - **Income & Expense is ONE table.** The balance card, the period card,
    the pending marketplace card, the marketing scorecard and the adjustment
    history are all gone. Every movement is one row: Date | Type · Method |
    Description | Transaction ID | Amount | Status | Latest balance. Rows
    come from `Order.payments` (SETTLED / PENDING / DUE), `Order.refunds`,
    `db.incomes` and `db.expenses` — the SAME sources the old page read, but
    projected one row per event rather than one lump per sale. **Latest
    balance is a running sum of SETTLED rows only**, walked oldest-first and
    indexed by key, so PENDING and DUE do not move it. `AdjustmentPanel`
    still owns the write path but takes a new `showHistory={false}` — the
    modal alone is drawn here, because the same rows are already in the main
    table.
  - **Returns write a Refund adjustment.** `EXPENSE_KIND` and `IncomeReason`
    gained a `REFUND` value (migration `20260921180000_refund_adjustment_categories`,
    `packages/store/src/schemas.ts` too). A return with a refund out writes an
    `Expense` with `kind: REFUND` **in the same mutation** as the RETUR
    adjustment; a dearer exchange writes a `ManualIncome` with `reason: REFUND`.
    Description is the payment reference the form asks for, empty falling back
    to the return's SG codes. The `Order.adjustments[type=RETUR]` on the sale
    is unchanged and still says a unit came back — this pair records where the
    rupiah went.
  - **The return dialog** gained an EDITABLE Condition column on the left
    table (grade select per unit — the `after` grade the shelf reflects on
    receive-QC), and a Payment reference input under the money row, drawn
    only when money will move. `Pick.grade` is the new field; the mutation
    updates the unit's grade only when it differs from what is stored.
  - **The return history is five columns** — Transaction number/reference,
    Product (serial, name), Condition (before → after), Exchange unit,
    Adjustment (signed rupiah). `ReturnRec` gained three optional fields —
    `beforeGrade`, `afterGrade`, `adjustment` — snapshotted at write time so
    the history reads them off the row rather than inferring from the
    timeline. Only the FIRST unit of a press carries the adjustment amount,
    so a return with three units back does not add its refund up three times.
  - ⚠️ Prisma's enums (`ExpenseKind`, `IncomeReason`) hold `REFUND` too as of
    migration `20260921180000`; regenerate the client (`prisma generate`)
    before typechecking `packages/db`.
- **Paying off debts, 2026-09-22.** *"The receivable and the payable supposed
  to be different navigation tab … In each table, add a button to add payment
  … the system will automatically select the 5 mil paid in full, 2 mil paid in
  full, then 4 mil paid only 3mil."* Four owner answers shaped it.
  - **Two leaves**, `/finance/receivable` then `/finance/payable`;
    `/finance/payable-receivable` redirects to Receivable. Customer, date,
    phone and transaction ID filter in their headers (Receivable); supplier,
    date and inbound number (Payable). The date filter is new in `ProTable`:
    `dateRange: true` on a column — a RangePicker in the header, local days,
    bounds included, a dateless row filtered out while a range is set.
  - **One dialog, `routes/finance/DebtPaymentModal.tsx`**, behind *Add
    payment* (nobody chosen) and every row's *Record payment* (that party,
    that row ticked). Party, amount, Cash/Transfer, date, note, the balance
    switch, and the party's documents oldest first — old debt, then by date —
    with "n selected · Rp X" above them; green is paid in full, yellow in
    part (`.debt-row-full`/`-partial` on the CELLS, because antd's selected
    tint is on the cells too).
  - **Only the total is typed** (owner answer). `lib/allocatePayment.ts`:
    with no amount the ticked rows are paid in full and the box shows their
    sum; with one, the money goes to hand-ticked rows first, oldest first
    (so lowering it cuts the newest), then spills over every row nobody
    unticked, oldest first. `skipped` exists so unticking a spill-filled row
    sticks.
  - **The balance switch is `Payment.inBalance`** (and
    `SupplierDeposit.inBalance`), default true, absent-means-true in the
    store: off settles the debt and moves no pot — the owner paid from their
    own account. It is on this dialog, the invoice's payment dialog and the
    deposit dialog. **Supplier payments, deposits and old-debt payments are on
    Income & Expense now** and move its balance; a deposit-funded payment is
    not (the deposit was the day the money left). An out-of-balance row is
    listed with a *Not in balance* tag and never counted. ⚠️ On the demo seed
    the running balance goes deeply negative: it has supplier payments and no
    opening cash or bank.
  - **The old debt is the oldest row and is paid first** (owner answer).
    `Customer.openingPayments` are `Payment` rows naming the customer
    (`Payment.customerId`); the opening figure is never rewritten, and
    `openingOwed` is the difference — every reader (Receivable,
    `customerBalance`) nets it. ⚠️ The SUPPLIER half went on 2026-09-24 with
    `Supplier.openingBalance`, so `supplierAccount` and `supplierHistory` read
    invoices, payments and deposits and nothing else.
  - **What the money becomes** is `lib/debtPayments.ts`: an invoice takes it
    on the goods, then each unpaid expense by `feeId`; a sale shrinks its
    promises (`DUE`, and pending on a channel that holds no money), records
    one `SETTLED` payment and logs it through `diffPayments`; a marketplace's
    money is never touched.
  - **More than is owed** (owner answer): a supplier's remainder becomes an
    unallocated deposit; a customer's is refused — there is no customer
    credit. A walk-in row offers only itself, since "Walk-in customers" is
    strangers.
  - Migration `20260922090000_payment_balance_switch_and_opening_payments`
    (owner-approved): the three columns, two FKs, and invariant 7 widened to
    exactly one of `orderId`/`poId`/`supplierId`/`customerId`, a supplier's
    payment KELUAR and a customer's MASUK. ⚠️ The SUPPLIER half of all of
    this was reversed on 2026-09-24 (`20260924160000`): invariant 7 is three
    parents again and `Payment.supplierId` is gone. The customer half stands. ⚠️ `comparable()` in
    `packages/store/src/wire.ts` treats `false` as empty, so two tills
    flipping the same switch at once are not reported as a conflict.
- **The money screens, reshaped 2026-09-23.** Seven owner asks, and two of
  them overturn rules this file has held since the beginning.
  - **A payment row says three things**: method (the till's four — Transfer,
    Cash, Shopee, Tokopedia) · status (Pending or Settled) · amount. *"The owe
    should automatically be calculated."* What a customer still owes is the
    bill less what is recorded against it, and it is no longer typed. It is
    still STORED — `owedRow`/`withOwed` in `lib/salePayments.ts` derive ONE
    `DUE` row on save, the projection rule `Order.settled` follows — because
    Receivable, `customerBalance`, `DebtPaymentModal` and the overdue tag all
    read one, and it is the only row that carries a promise date. The date is
    asked for below the grid and only while something is owed; the Note column
    is gone. A marketplace row carries its reference under the method.
  - **The payment edit log is folded shut**, not deleted (`Collapse` at the
    foot of `PaymentsModal`), and no longer demands a sentence before saving.
    The "why is this being corrected?" box, the unaccounted-money alert and
    the three-figure summary went with it.
  - ⚠️ **The ledger is no longer strictly append-only** (owner decision, taken
    against the alternative of appending a correction). Transaction History's
    *Edit transaction* can swap the unit on a recorded sale, and the owner
    asked for that to leave no trace of the unit it replaced. So
    `packages/db`'s events adapter now permits exactly two things: **removing
    the LAST event of a unit** (`removeLastEvents` — never one in the middle,
    never the only one) and **renaming the denormalised `serial` on rows that
    still belong to the same unit** (`renameEvents`). Every other edit is
    still refused, `verifyLedger` still checks the projection against whatever
    is now the last row, and `commit.ts` locks a unit named only by a REMOVED
    event. `mock/store.ts` gained `removeLastEvent` for the same reason.
    ⚠️ Neither edit reached PostgreSQL until 2026-09-24 — see "The ledger's
    two edits actually land" below.
  - **Transaction History** is Order number | Reference ID | Date | Channel |
    Customer | Unit | Serial number | Payment status | Received | Download
    invoice · Edit transaction. The page's own range picker is gone — the Date
    column carries a `dateRange` header filter. *Edit transaction*
    (`EditTransactionModal`) corrects the reference, the date, the channel, the
    customer, the units (a serial fills the product in; changing the product
    empties the serial) and the payments. Ticking rows offers **Mark as
    settled**, which turns what a marketplace was holding into the shop's
    money; a payout whose fees somebody wants itemised is still `Receive` on
    Pending Payment, which keeps a settlement document.
    ⚠️ "Last updated" was asked for and withdrawn — `Order` has no such column
    in the mock or in prisma.
  - **Pending Payment is marketplace money alone**: Channel | Transaction
    number | Reference number | Customer | Date | Amount | Received (0, not
    "Waiting"). The "Owed by customers" table is gone — `/finance/receivable`
    is where a customer's debt is read, and two lists of the same debts drifted.
  - **A filter is a chip per value** (`ProTable`), each with its own ×, plus
    *Clear all* once more than one is on. *"So that I can cancel out one of the
    filter"* — a count told you how many were on and left you opening funnels
    to find which.
  - **Income & Expense is Type · Category · Method**, and the categories are
    the owner's own list, declared in `mock/seed.ts` beside the enum values
    with `retired` and `needsTransaction` flags. Income: Sales transaction,
    Account transfer, Refund received, Interest, Balance mismatch. Expense:
    Operational, Payroll, Marketing & Advertisement, Rent and Facilities,
    Balance mismatch, Customer compensation, Refund to customer, Supplier
    payment, Bank transfer, Interest. Professional Services and Software &
    Technology are `retired`: still read back, no longer offered. The same
    values name the DERIVED rows, so the column and the dialog share one
    vocabulary. A **Cash basis / Accrual** switch decides whether PENDING and
    DUE rows are listed; the running balance counts SETTLED rows either way
    (*"still the real balance until the payment is settled"*).
  - **An adjustment can name its transaction** — `Expense.orderId` and
    `ManualIncome.orderId`, nullable FKs (migration `20260923090000`), asked
    for by the categories that mean nothing without a receipt. The picker
    searches an order number, a marketplace reference, a customer or a serial
    (*"we can either put a serial number or a transaction"*).
  - **`TRANSFER_LUAR` — "Transfer from another bank"** settles a debt and moves
    neither pot. `accountOfMethod` answers `undefined` for it BY NAME rather
    than by falling through to the default, which means "a method nobody has
    mapped". `forPo` true, `forSale` false, and on the adjustment list.
    ⚠️ It overlaps `Payment.inBalance` (2026-09-22) — both mean "this settled
    and the balance did not move". The method is the standard way now; the
    switch is untouched.
  - Migration `20260923090000_money_categories` carries all of it: seven enum
    values, the two `orderId` columns with their FKs and indexes, and the
    `PaymentMethod` row. ⚠️ Run `prisma generate` before typechecking
    `packages/db`.
- **Inventory, returns and the adjustment dialog, 2026-09-23.**
  - The nav leaf and the page are **"Inventory"** — the old name described the
    2026-08-26 merge rather than the screen.
  - **The unit popup is wider (1440) and tighter** (`.unit-popup-table` in
    global.css). Widening it alone spreads eight cells across the dialog and
    puts the serial a hand's width from the price on its own row.
  - **The per-unit actions are Price change and Edit unit.**
    `UnitEditModal` corrects serial, grade, battery, warehouse, rack,
    description and unit price — which retires the page's old warehouse-and-note
    adjust form. Renaming carries the history across (see the ledger note
    above). Both dialogs sit at `zIndex 1100`, because they open from inside
    another modal in a different part of the tree.
  - **The adjustment dialog has no In/Out toggle**: Inventory opens it from
    *Stock in* or *Stock out*, so it is already answered. It starts on **one**
    blank line, not three, and the counted half is now the same kind of grid as
    the serial half rather than a bare row of controls.
  - **Returns are ONE table** (`ReturnHistoryTable`): Type (From customer / To
    supplier) | Transaction / inbound | Date | Supplier / customer | Reason,
    with the units behind the row in a popup (product, serial, condition; None
    on a counted product). The Segmented that swapped the whole page is gone;
    two Add buttons remain, because the two forms genuinely ask different
    things.
  - **A customer return is received as it is recorded** — no *Receive* step,
    no QC panel. The form already asks the condition per unit, which was all
    that step added, so the `RETUR_PELANGGAN`, the regrade and the row go in
    one mutation and the unit is back on the shelf at once.
    ⚠️ `ReturnRec.status` is written `ARRIVED` from the start.
  - **Copy pass**: the sentences that explained what a thing IS are gone —
    Inventory's "each unit becomes sellable in…", the price editor's variant
    explanation, the supplier deposit and opening-balance hints, the AppleDB
    blurb, the adjustment dialog's two tooltips. Sentences that warn about a
    consequence stay.
- **The stock movement history is editable, 2026-09-24.** *"Make the movement
  log editable … each row is editable."* Inventory's second tab is **Stock
  Movement History**, and every row carries an Edit: when, reason, description
  and the battery reading on a unit's row; when, reason and the note on a
  counted product's. What a row IS — the unit, the direction, the quantity,
  the batch, whose hand — is not editable, and a wrong quantity is another
  adjustment. `lib/stockHistory.ts` builds the rows and applies the edit; the
  unit's own description and reading follow the correction only while they
  still say what that adjustment wrote (`test/stockHistory.test.ts`). The
  unit's `KOREKSI` event keeps the note it was written with — the ledger is
  untouched.
  ⚠️ On Postgres this is the store's one "written once and correctable"
  collection pair: `commit.ts` has a `CORRECTABLE` set beside `APPEND_ONLY`,
  the two adapters accept an edit that touches only those columns
  (`sameApartFrom`), and migration
  `20260924090000_stock_movement_history_editable` grants `nusantara_app`
  UPDATE on exactly those columns — table-level UPDATE stays revoked, so the
  20260913 self-check and the deploy's grant query read as before. Do not
  generalise it.
- **A counted product is priced before it is shelved, 2026-09-24.** *"The
  accessories at the moment do not have a field to input the price."* A
  counted line on the inbound table (both screens) carries a **Sell price**
  box in the cell a tracked line keeps its Units button in, writing
  `Sku.price` — the variant's asking price, the one price an accessory has and
  what the till quotes — and *Confirm arrived* is disabled until it is above
  zero, because a piece confirmed without one reaches the till at Rp 0.
  - **The inbound table is one row of equal boxes** (owner ask later the same
    day: *"every input field will have the same size and is in 1 row"*).
    Sell price is a column of its own — a tracked line reads its units'
    price or range there — and Qty, Unit price, Discount and Sell price share
    one width (`INPUT_COLUMN_WIDTH` in `PurchaseLinesTable.tsx`), every box
    filling its column. Cells align to the TOP (`.purchase-lines` in
    global.css): the product's name and a line's "n received" are second
    lines under their boxes, and centring a two-line cell beside a one-line
    one is what put the Qty box half a line above Unit price. The order
    form's products card lost its 1180px cap. `editableTable.test.tsx` pins
    the widths. The button reads **See all units (n/qty)** (2026-09-28).
- **The ledger's two edits actually land, 2026-09-24.** *"Why I cannot edit
  the serial number in the inbound."* Because the 2026-09-23 change never
  worked: the append-only gate in `packages/db/src/store/commit.ts` refused
  every changed or removed `events` row before the adapter's `renameEvents`
  / `removeLastEvents` ran, so a serial corrected at Inbound & QC or in
  Inventory's Edit unit, and a unit swapped in Transaction History, showed
  for a moment and came back "Not saved — Riwayat unit tidak bisa diubah
  atau dihapus." Verified by committing each against the store test database
  before the fix and after.
  - **The gate admits exactly the two shapes** — a row whose `serial` is the
    only field that changed, and a removal — and the adapter still judges
    both in full. `renamesIn` reads the corrections (old → new) off those
    rows into `WriteContext.serialRenames`.
  - **A unit is renamed in PLACE.** `units` is keyed by serial in the store
    contract, so a correction arrives as the old key removed and the new one
    inserted; the units adapter used to archive the one and mint the other,
    after which `renameEvents` refused to move the history onto a different
    `Unit.id`. `renameUnit` (units.ts) updates the same row, carries
    `UnitNote.serial` and `PurchaseOrderItemSerial.serial` with it, and
    touches the unit's notes, invoice, intake and adjustment rows so every
    till redraws them. A note the browser renames itself resolves to the same
    unit; renamed on its own it is refused.
  - **The database holds the line** (migration
    `20260924130000_ledger_serial_rename_and_last_event`): `nusantara_app`
    gets UPDATE on `UnitEvent.serial` — that column alone, so the deploy's
    `t|f|t|f|t` grant check and the 20260913 self-check read as before — and
    `unit_event_drop_last(text[])`, a SECURITY DEFINER function that is its
    one door to a DELETE on the ledger and refuses any row that is not the
    top of its unit's chain or is the last one standing. Table-level DELETE
    stays revoked; `removeLastEvents` calls the function.
  - `removeLastEvents` now expects the unit's location to be the newest
    surviving row that moved it — what the browser reads off that row — not
    the unit's own column, which still said where the dropped row sent it.
  - What still names the unit by its OLD serial after a correction: an
    opname scan or surplus row and a trade-in record (denormalised, history
    of what was read), and in the browser any collection `renameUnit` /
    `UnitEditModal` do not rewrite (adjustments, services, returns, holds,
    sales) until the page reloads — those project through the unit on
    Postgres and read right after one.
  - `packages/db/test/store.test.ts` commits a rename, a move onto another
    unit (refused), a serial another unit holds (conflict), a last-event
    removal, a middle one (refused) and the last one standing (refused);
    `invariants.test.ts` checks the grants and the function as
    `nusantara_app`.
- **A debt names its debtor, 2026-09-24.** *"When we record a new transaction
  and the user owe something, they need to add names or phone number (either
  is fine)."* — and, the same hour: *"When adding receivables payment, they
  can start from transaction instead of the customer."*
  - **The till refuses a sale that leaves something owed against nobody.**
    `tillProblems` reports `NO_DEBTOR` (last, after the payment table's own
    problems) whenever `owed > 0` and the sale names no customer with a name
    or a phone number; the customer box goes red with the sentence under it,
    the star on it appears only while something is owed, and *Pay & finish*
    scrolls to that card. A sale paid in full still needs nobody — the
    walk-in-paying-cash test is unchanged.
  - **A customer is a name OR a number** (`lib/customers.ts`: `hasContact`,
    `customerLabel`, `customerLine`). The till's *Add customer* demanded both;
    it and Settings → Customers now take either, and `packages/store` refuses
    a customer with neither (`name` may be empty; it was `min(1)`). Prisma's
    `Customer.name` is NOT NULL and unchanged — empty means "recorded by
    number". Every screen that printed `customer.name` prints
    `customerLabel` now: the number stands in where there is no name, on the
    invoice, Transaction History, Receivable, S/N Tracking, reservations,
    returns and the chat list. ⚠️ Write new customer copy through it; a bare
    `.name` is blank for a phone-only customer.
  - **The debt dialog has a second door** (`DebtPaymentModal`): beside the
    party's box, a finder over every document with money owed — the shop's
    code, the marketplace order number and the customer, or the supplier's
    invoice number on Payable — picks the party and ticks that row. A second
    document of the same party adds to the ticks; another party's starts
    over. It is also the only way into a walk-in sale's debt from *Add
    payment*, since the walk-in heading is not on the party list. Amount
    moved to the second row to make room.
  - ⚠️ `EditTransactionModal` is NOT gated: editing a recorded sale can still
    leave a debt against nobody. Same rule, different door — not asked for.
- **Five asks, 2026-09-24 (later).** Two of them change the schema.
  - **A unit's row owns Not arrived and Delete** — *"the delete row button,
    not arrived button should be on unit level and not item SKU level"*. Both
    were on the LINE, where they were a decision about every piece of a
    product at once. On the row they are drawn buttons, not menu items, and
    delete is ONE press: `deleteUnitRow` takes the unit, its events, its held
    QC answers and its piece of the invoice together, because *"the flow is no
    longer delete serial → delete row"*. `removeSerial` and `removeFromInvoice`
    are gone. Offered only while the row is open (waiting, not arrived, in
    QC) — a unit that has left QC is not deletable anywhere, the rule
    `poDeletion` already holds a whole order to.
    - ⚠️ They stay on the LINE for a **counted product**, which has no units to
      put them on: an accessory line IS the quantity.
    - Not arrived is `components/InboxSlashIcon` now, not `StopOutlined`
      (owner ask). A circle with a bar says "forbidden"; a unit the supplier
      never sent is not forbidden, it did not turn up. Drawn from antd's own
      `InboxOutlined` path with a masked diagonal, because the mask draws its
      own hole and a slash painted in the page colour works in one theme only.
  - **An inbound opens read-only** — *"when viewing an inbound it should be
    display only first, and add an 'Edit Invoice' button to edit it next to
    Close invoice."* One `locked = closed || !editing` replaces every
    `closed` that gated an EDIT; `closed` still means closed. Every field on
    the page writes on change (2026-09-15), which is right while somebody
    works and wrong the rest of the time. ⚠️ The **scanner** is gated too and
    explicitly: it listens at the document, so no `disabled` prop reaches it,
    and a bench scanning onto a page nobody had unlocked would mint units
    invisibly. Per visit, never stored.
  - **Paying an invoice off offers to close it.** `offerToClose` reads the
    STORE after the payment — `totals` is the render before it — and asks;
    it never closes by itself, because an invoice can be settled with a unit
    still waiting for a serial.
  - **The book closes** (`lib/bookClose.ts`, `AppSetting`
    `finance.booksClosedAt`, no column) — *"for the transaction, add a close
    book button to close and lock all the transaction."* The parallel is
    `Po.closedAt`: that makes one purchase read-only, this makes a PERIOD of
    sales read-only. A sale on or before the closing instant takes no edit
    **and no new payment** (owner answer), so `DebtPaymentModal` drops it from
    what it offers and `PaymentsModal` opens read-only. Reopenable by one
    button, for the reason the closed invoice's banner gives.
    ⚠️ `endOfDay` is LOCAL: closing "the 30th" in Jakarta is 16:59 UTC, and
    taking the date at face value would leave seven hours of it open.
  - **A line can arrive outside the invoice** — *"add a button called 'Add
    outside invoice' / 'Tambahkan diluar invoice' and mark that row as
    yellow"*. `PurchaseOrderItem.outsideInvoice` (migration
    `20260924160000`, owner-approved) is the mirror of `notReceived`: that one
    is billed and never sent, this one is sent and never billed. A **MARK
    only** (owner answer): the line keeps its price, so its units still cost
    what they cost and the invoice's COGS is still the whole delivery. Yellow
    row; a line with pieces that never came is red, and red wins where a line
    is both. `InvoiceExceptions` under the table lists both, product and a
    count — **no serials**, which is the point: it is what somebody reads down
    the telephone to a supplier.
    ⚠️ The mark is a **grouping axis**, so `piecesOf` matches on it as well as
    on product and price. Without that, an edit to the billed row would reach
    the unbilled one.
    ⚠️ Off on the order FORM: that screen IS the invoice being typed, so
    nothing on it can have arrived outside itself.
  - **`Supplier.openingBalance` is gone, and `Payment.supplierId` with it** —
    *"remove the column 'Utang lama' or the amount from previous app, we don't
    track it anymore (remove from database schema)"*, and the owner asked for
    the whole feature rather than two orphaned columns. Invariant 7 is back to
    three parents; the supplier direction CHECK went with it. What the shop
    owes a supplier is its open inbound invoices and nothing before them.
    `Customer.openingBalance` is untouched — the ask was the supplier side.
    ⚠️ The B2Soft cutover loaded Rp6.89 bn of payable this way
    (`--with-balances`). It has nowhere to land now: `emit.py` reports
    `payable: 0` rather than claiming an import, and `documents.py` flags each
    supplier's uncarried balance in the audit. The receivable half is
    unchanged.
  - **Payable and Receivable are grouped per party again** — *"make it a
    expandable column per supplier, and the inbound is listed per the earliest
    date … the total next to 'Add payment' should be representative."* antd
    TREE data, not an expanded panel, because the ticks have to add up:
    `ProTable`'s new `treeData` sets `checkStrictly: false`, so ticking a
    supplier ticks its invoices and the page totals the LEAVES. `extra` may be
    a function of what is ticked, which is how the figure beside *Add payment*
    follows the selection and falls back to the whole page.
    - **Two Record-payment buttons**: a party's hands `DebtPaymentTarget`
      every document under it, a document's hands its own —
      *"it will autofill the transaction detail accordingly."*
    - ⚠️ `treeData` also forces `cards: false`, for the reason `DataTable`
      already keeps the grid for an `expandable` table: a child row has
      nowhere to go in a card, and hiding it is worse than scrolling sideways.
    - ⚠️ A test that wants a document row has to open the chevron first
      (`.ant-table-row-expand-icon`); `openingBalances.test.tsx` does.
- **Three screens pared back, 2026-09-25.**
  - **Check a Shopee file is a page action.** It sat loose under the Returns
    table, which put the thing you DO about a refund below every refund
    already dealt with. It is in the header now beside *From customer* and
    *To supplier*; the dialog stays in `CustomerReturnPanel` and `checkOpen`
    is a prop `ReturnsPage` owns. Not kept on this device — it opens a file
    picker, and reopening to ask for a file nobody has chosen again is wrong.
  - **The read-only inbound banner is gone.** *Edit invoice* is in the header
    beside *Close invoice*, which is where the page's other decisions are;
    a paragraph under the title announcing that a page is a page was a line to
    scroll past on every visit. Everything the banner gated is unchanged — the
    fields are still disabled, the scanner is still off, and the toast on a
    scan still says to press Edit invoice. A **closed** invoice keeps its
    banner: that one reports a state somebody chose and has to undo.
    ⚠️ It was drawn on EVERY viewport, and the header action is not: below
    `md` a `PageContainer` action is a `FloatButton` fan behind a neutral
    glyph, and its members are not in the DOM until the fan is opened. Since
    `test/setup.ts` answers "no" to every media query, that is every test —
    which is why `inboundQcPage.test.tsx` pressed the BANNER's button and why
    62 of its tests failed the moment the banner went. `test/pageActions.ts`
    (`pressPageAction`) is the one way a test presses a page action now.
    The float buttons gained `aria-label` with it: a tooltip is not a name on
    a device with no hover, and every page action there is icon-only.
  - **The service bench is ONE table** — *Serial | Problem | Sent from |
    Quoted | actions* — where it was two (Expected, On the bench). Add a
    charge is a money icon, back in stock an inbox icon.
    ⚠️ Signing a unit in did NOT go: it is the tick drawn only on rows that
    have not had it, and it is still what moves `Unit.locationId` to the
    bench. Without it warehouse 4 lists units that are in a van.
    `splitBench` stays — the Bench card still reports "n on the way" — and the
    charges are still behind the row, which is the one door to correcting one.
    ⚠️ Three columns went with the split and nothing replaced them: **Grade**,
    **Away** (days gone, amber past a fortnight) and **Cost now**
    (`costOfUnit`). The money is still recorded and still reaches every
    margin; this screen stopped printing the total. `BenchRow` still carries
    `days`, `total`, `buy`, `shippingTax` and `earlierRepair`, so any of them
    is a column away from coming back.
- **Three more, 2026-09-25 (later).**
  - **A return row can be corrected and taken back.** *Correct it* changes the
    return's own facts — when, why, and the condition each unit was recorded
    at — and nothing else: which units came back and what they were worth are
    what the money was computed from, so changing one of those is a take-back
    and a fresh return. *Delete* is a **cancel**, not a delete:
    `ReturnRec.status` has carried `CANCELLED` since the beginning for the QC
    rejection that named the wrong unit, and this is the same thing. The
    document stays in the history marked Withdrawn.
    - **The undo restores the BILL and lets the debt re-derive.** Removing the
      sale's `RETUR` adjustment puts the bill back up, and since 2026-09-23
      the DUE row is derived (`withOwed`), so the debt the return cancelled
      comes back by itself — nothing has to remember what was cut.
    - ⚠️ **The refund STAYS**, deliberately. A customer handed Rp5jt who then
      has the return taken back holds the unit AND the shop's money, so they
      owe Rp5jt more than the original bill — which is what `saleBalance`
      computes, because it subtracts `refunded` from what is settled. Deleting
      the refund row would claim the money never left the drawer.
    - **What it refuses**, each because it cannot be proved rather than out of
      caution: a unit that has moved on (`UNIT_MOVED`); a sale on a
      marketplace channel or still holding a PENDING part (`MARKETPLACE` —
      `applyReturnCredit` records nothing about which pending part it cut); an
      exchange (`EXCHANGE` — `planReturn` moves money between sales as copies);
      a closed period (`BOOKS_CLOSED`). `lib/returnUndo.ts` is the rule,
      `test/returnUndo.test.ts` and `test/returnUndoPage.test.tsx` the review.
    - A counted piece is reversed by an OPPOSITE `KOREKSI` move, never by
      removing the `RETUR_PELANGGAN` one: that ledger is append-only.
  - **The service bench has no arrival step** — *"no need to mark as
    'received' first, so action button is only '+ Charge' and 'Back in
    stock'"*. This REVERSES 2026-09-09, and what that decision protected had
    to move rather than go: sending a unit to service now MOVES it to the
    bench in the same transaction (`sendToService` on `/inbound/:id`, and the
    Inventory adjustment), and `ServiceRec.arrivedAt` is set when the visit
    opens. Without that `wh-4` would hold nothing again, which is the
    2026-09-08 bug. The row's two actions are labelled buttons now, not icons.
    ⚠️ `splitBench` is dormant and still tested — an old row with no
    `arrivedAt` still lists, and the rule is where a test can read it.
    ⚠️ The visit's `fromLocationId` must be read BEFORE `appendEvent`, which
    writes the projection: read after, it is the bench, and *Back in stock*
    then offers to return the unit to the warehouse it is already in.
    `InventoryPage`'s adjustment already read its `cameFrom` that way; the
    inbound one did not have to until the unit started moving at send.
  - **The calls to action are green.** *Add payment* (inbound list and the
    debt rows), *Edit invoice*, *Print labels* (inbound and Inventory's bulk
    action), *Add expense*, *Record payment*, the till's *Add*,
    *Reservations (n)* and *Add customer*, and *Stock in* beside *Stock out*.
    The rule where the owner's list ran out: a button that OPENS a form or
    performs its card's own action is primary; a secondary alternative beside
    one is not — which is why *Close invoice*, *To supplier*, *Check a Shopee
    file* and *Import from AppleDB* stay white, and the till's money panel is
    untouched (its dark panel already owns the one button that finishes a
    sale). A `disabled` primary still renders grey, so a locked invoice reads
    as locked.
- **Five asks, 2026-09-25 (later still).** Four of them are the return desk;
  one is every table in the app.
  - **An invoice being edited says so, and says it wherever you have scrolled
    to.** *"When editing an inbound, make the transaction number and the 'save
    invoice', 'close invoice', add a yellow sticky alert 'You're editing this
    invoice'."* `PageContainer` gained `banner` — a strip pinned under the
    title row, inside the block `stickyHeader` pins — and `/inbound/:id`
    passes both while `editing`. Serials & QC is a long grid and the bench
    works down it; the moment the button that ends the edit scrolls away is
    the moment somebody leaves the page open and writable behind them.
    *Done editing* is **Save invoice** now, the owner's own word. Nothing is
    saved BY it — every field on the page still writes on change (2026-09-15)
    — but the button that ends an edit is the one staff look for to save.
    ⚠️ `banner` is not a place for prose: a line that merely describes the
    screen is what came off every page earlier the same day.
  - **Column widths are a token table** (`COLUMN` in theme/tokens.ts), by what
    the column HOLDS: a date is 136 everywhere, money 168, a code 180, a
    serial 200, a status tag 150, a grade 120, a quantity 104, one icon button
    56, two 104, a labelled button 188, two labelled ones 248. A survey that
    morning found thirty-three different pixel widths in use, so a date was
    110 on one screen and 160 on the next and two lists of the same documents
    lined up on nothing. It is not only cosmetic: antd hands the leftover
    width to the columns that declared none, so one over-wide neighbour
    squeezes the column somebody is reading. 74 columns across 28 files.
    ⚠️ Only for columns whose content has a KNOWN shape. A product name, an
    address or free text still takes no width and absorbs the slack — a table
    where every column is fixed either scrolls sideways or ends in a gap.
    ⚠️ The `width` on a `tableExport` column is a CHARACTER count for the
    .xlsx/.pdf writers, not pixels. Those are untouched and must stay so.
  - **They are MINIMUMS, and a table scrolls only below their sum**
    (2026-09-28: *"have a minimum width per column so when that's the minimum
    and still wider than the screen, it will have scrollable table otherwise
    no"*). `gridMinWidth` (components/tableCells.ts) sums every leaf column —
    its `width`, else `COLUMN.flex` (120), plus `COLUMN.antdControl` (32) for
    a tick or chevron antd draws — and `DataTable` and `EditableTable`
    hand that to antd as `scroll.x`, which rc-table draws as `width: x;
    min-width: 100%`: the table fills the screen and scrolls only when the
    screen (or the zoom) leaves less than the sum. `max-content` is gone — it
    sized a list to its content UNWRAPPED, so one long name scrolled a list
    that fitted. A plain antd `<Table>` gets the same rule from
    `.ant-table-content { overflow-x: auto }` in global.css. The tokens were
    cut to content + padding the same day (money 136, date 120, code 148,
    serial 140, status 144, money input 144, choice 160, qty 96, and a new
    `tag` 120 for a one-word tag). Checked in a browser at 1440 with the
    sider open (1120px of card): every list fits except **Transaction
    History**, whose eleven columns sum to 1332 and scroll by design. The
    inbound lines table sums to exactly 1120 with 6px cell padding
    (`.purchase-lines`) — which is what fits a nine-digit price in its box —
    and its actions column is drawn only while an unlocked invoice holds a
    counted line. **See all units** is back at the row's end. Receivable's
    two row buttons stack at the column's floor rather than widening it.
  - **The return row's two buttons carry their words** — *Edit* and *Delete* —
    where they were a pencil and a bin on a row that also opens something.
  - **Recording a return is one transaction and a picker.** *"Make it simpler,
    the user only need to fill: Transaction number (only 1 transaction at a
    time). When we typed & enter, it will open up a popup modal, showing all
    the unit (unit name, serial, price, grade), if lots of unit make it
    scrollable, and a select button on each product, by default is select all,
    then 'Select {n} unit'. Then it will add the units to the table. For each
    row, display: Unit name | Unit serial | Additional price."*
    - The box takes the shop's transaction number, the marketplace order
      number the customer quotes, or a serial — one question asked three ways
      — and Enter opens the picker. antd's own `rowSelection` draws the ticks,
      which is also where the select-all comes from.
    - **A second number REPLACES the first**, with its ticks: the list of
      sales is gone, and a return spanning two transactions is two returns.
      `planReturn` still takes a list and still moves money between sales —
      `test/returns.test.ts` covers that — so this is the UI narrowing, not
      the rule.
    - ⚠️ **The per-row Condition Select went with the price column**, four days
      after it arrived: the owner's list for the row is three cells. Nothing
      sets `Pick.grade` now, so a returned unit comes back at
      `gradeForCondition("SECOND", …)` — what the shelf said before
      2026-09-21 — and the history's *Edit* dialog is where a condition is
      corrected. The field, the write path and the draft guard all stay.
    - A counted line comes back WHOLE: the picker is a list of things, not a
      list of numbers, and a part-returned accessory is a second return.
  - **The exchange is asked for, not assumed.** *"Add '+ Exchange unit' and it
    will show another table below it, but do not show all the unit first —
    make it like a dropdown showing the serial & name. The table shows: Unit
    name | Serial Unit | price."* Under the return table, hidden behind one
    button, and the always-open list of the whole shelf is gone — it was the
    tallest thing on a dialog most of whose returns exchange for nothing. The
    dropdown searches the same fields and takes a scanned serial the same way,
    because a Select's search box is an input like any other. The two-column
    layout went with it, so the dialog is 900px rather than 1360.
    ⚠️ `defaultActiveFirstOption={false}` on the transaction AutoComplete:
    Enter belongs to the box, or a serial typed in full would open the picker
    on whichever sale was highlighted.
- **The return's charge, moved 2026-09-26.** *"The additional price is per
  exchange unit, and if no exchange, we can add 1 additional fee per return
  (not per product). Make the exchange unit price read only in that return
  window."* It was a money box on every row of the return table, which asked
  the bench how one restocking charge divides over three units coming back on
  one receipt.
  - **The return table is Unit name | Unit serial** and the row's delete. A
    plain return asks for ONE **Additional fee** under it; with something
    going out the exchange table asks per row instead, in an **Additional
    price** column, and the return-level box is not drawn — two boxes both
    meaning "and this much on top" is a sale charged twice. The kept value
    comes back if the exchange is closed again.
  - **The exchange unit's price is read-only** — a replacement goes out at the
    shop's asking price, and repricing is done where prices are done.
  - **Either way it is one number off the CREDIT** (`feeTotal`, `creditOf`),
    not added to the replacement's price. The two readings move the refund and
    the top-up by exactly the same amount, and taking it off the credit leaves
    `Order.prices` saying what the shop asks — so a swap fee invents neither a
    bargain nor an upsell out of `Order.listPrices`.
  - `worthOn` is GROSS now, because it is also the weight `splitByWeight`
    divides the credit back over: netting the fee there as well would subtract
    it twice. `Pick.expense`, `QtyPick.expense` and `Back.expense` are gone;
    `Replacement.price` became `Replacement.extra` (an older draft is dropped
    by `parseReplacements`, which is what the guard is for).
  - ⚠️ Nothing new is stored. The charge shows up only as a smaller RETUR
    adjustment — money the shop kept never moved, so there is no row for it —
    which is exactly what the per-unit expense did. `ReturnRec.fee` still
    holds the exchange top-up and is still read by nothing.
- **Photos are shown per serial, 2026-09-29.** Inventory's unit popup (tracked
  lines only), the S/N Tracking list and the unit card in `SerialHistory` each
  draw the serial's QC photos through `UnitPhotos`, **read-only** — they are
  taken at Inbound & QC and at a stock count, and nowhere else. A serial with
  no photos says None, and a sold unit always does: its photos were purged at
  the sale.
- **The chatbot's four switches, action items and profile, 2026-09-29.**
  *"Create a toggle for stock, price, make/check/edit/cancel reservation and
  send image. If off, escalate to a human with an action item and a summary."*
  An audit the same day found three ways a false reply got past `checkReply`.
  - **The switches are `AppSetting` rows** (`chatbot.stock`, `.price`,
    `.reservation`, `.photos`), on /chat above the inbox, owner-only to change
    (`PUT /api/chat/capabilities`), read by the worker every pass.
    `AGENT_CAPABILITIES` is now only the answer for a switch nobody pressed.
    Price, Reservations and Photos each need Stock (`effectiveCapabilities`):
    every one is about a unit on the shelf.
  - **Reservations is the whole lifecycle**: make, check, move
    (`rescheduleHold`, packages/db — no UnitEvent, the unit stays held) and
    cancel, each scoped to the sender's phone. This REVERSES 2026-09-21's
    "the only write is making a reservation".
  - **Price is the unit's** (`askingPrice` = `Unit.price ?? Sku.price`); the
    bot quoted `Sku.price` since 2026-09-08. A price of null or 0 is shown to
    the model as "no price — hand over", and with the price switch off no
    figure (and no budget filter) reaches it at all.
  - **`checkReply` checks FACTS, not words** (`StockFact`,
    `stockFactsOf`). It used to search the stock JSON for "available", which
    `{"available": false}` contains; it matched a price against every price
    of the turn, so one unit's price could be quoted for another; and "ada kak
    Air M3" passed because "ada" was not a claim. Now: a price must be an
    AVAILABLE unit's, of the unit the words beside it name (`modelTokens`); an
    availability claim naming a unit needs that unit on the shelf; "ada" next
    to a named unit is a claim, "ada varian" is not. `test/switches.test.ts`.
  - **A booking is always told.** A hold commits mid-turn; if the reply is
    then refused the fixed booking line (with the code) is prepended, and if a
    staff reply beats the draft the worker files a RESERVATION action saying
    the customer was not told.
  - **Photos by model** (`find_unit_photos`): the most expensive matching
    unit with photos, its price if the switch allows, and an offer to show
    another unit when there are more (owner's rule).
  - **Every hand-over leaves a `ChatAction`** (migration
    `20260929090000_chat_actions_and_customer_profile`, owner-approved): one
    OPEN row per (thread, kind) — a partial unique index — with the bot's
    summary, the unit, the POS price and, for a NEGOTIATION, the customer's
    offer read by CODE (`parseAskPrice`). `refreshOffers` upserts a newer
    offer while the thread is held. ⚠️ (UI below REMOVED 2026-10-15 — see
    "A hand-over is an outline".) /chat draws open tasks above the messages
    and opens each one's dialog once by itself; the negotiation dialog shows
    our price, the cost (`Unit.landed`, "modal") and the offer, and *Send
    offer* records `staffPrice`, closes the task, answers the chat and lifts
    the hold in one transaction. Mark handled closes every open task.
  - An offer ("kalau 7jt boleh?", "7,5jt aja") is negotiation even without
    the word "nego", and always goes to a person.
  - **`CustomerProfile`** holds what the customer told the bot about
    themselves (`remember_customer`: name, use, budget, current device,
    preference), keyed by wa_id; a name also creates the `Customer` row.
    Shown under "What they told the bot" on /chat. The prompt asks for these
    first, in both modes.
  - Grants: `nusantara_agent` and `nusantara_app` get SELECT/INSERT/UPDATE on
    both tables and no DELETE.
- **Go-live: a fresh database, master data only — 2026-09-29.** *"We just
  want the master product, category/grouping, supplier, salesman, and customer
  data."* The Mac mini's `nusantara_pos_prod` held a full B2Soft history
  import nobody wanted; `docs/go-live.md` dumps it, DROPS it (owner decision
  — the dump is the only copy) and builds a fresh one under the same pinned
  name, because `environment.ts`, `ops/backup` and the pipeline all guard on
  it.
  - `extract.py --masters-only --salesmen A,B,…` (`b2soft/masters.py`) reads
    FIVE workbooks and writes one `reference` chunk for `import:b2soft
    --master-only`. `Supplier List.xlsx` is the supplier file (same layout as
    Master Supplier with Credit). The owner's eight categories — MacBook Air,
    MacBook Pro, iPad, Mac mini, Accessories, Charger, Box, Sparepart, the
    last four counted — plus one per kind they do not cover (iMac, iPhone,
    Apple Watch, …; owner: "new categories"). B2Soft's sales channels filed as
    customers (SHOPEE…, TOKPED…, INSTAGRAM…, `CHANNEL_CUSTOMERS`) are skipped
    and listed in `masters-audit.txt`. No prices (every variant
    Rp 0), no stock, no balances. Warehouse 04 (Gudang Masuk Belum QC) is the
    service bench (`SERVIS`), 02 the shop.
- **The chatbot, tried out locally — three changes, 2026-10-14.**
  - **`tools/wa-local/` answers a real WhatsApp chat on a laptop**, through
    Baileys (WhatsApp Web's protocol — unofficial, so a spare number and LOCAL
    TESTING ONLY; production is the Cloud API). `up` / `down` run the POS, the
    real webhook with a secret made up for that laptop, and the real worker
    loop with its Graph calls answered through `TickDeps.fetchImpl`. On the
    sandbox database `nusantara_pos_chatbot`; the shop's Meta token is never
    loaded. ⚠️ Deliberately OUTSIDE the pnpm workspace (its own
    `pnpm install --ignore-workspace`), so Baileys is in no lockfile CI or a
    release installs. ⚠️ An allow-list gates both directions: a linked account
    receives every chat that account receives. ⚠️ Never `pnpm dev` beside it —
    the ordinary worker loads the real token and drains the same Outbox.
  - **The knowledge base is a spreadsheet** — *"1 column for questions and 1
    column for answer"*. /chat → Knowledge has *Download .xlsx* and *Import
    from a file* (.xlsx or .csv); the pasted `Q:`/`A:` dialog is gone, though
    `parseQaText` still reads that format for the `knowledge` CLI.
    `packages/domain/qaSheet.ts` reads rows (column A/B, or wherever a
    "Question"/"Answer" header row says; a `;`-separated CSV is what Excel
    writes on an Indonesian machine). **An upload UPDATES an answer the file
    changed** (owner answer) — the sheet is the source of truth, where a paste
    only ever added — and the dialog shows new / changed / unchanged, with
    today's answer under the one replacing it. A question the file leaves out
    is left alone, and an update never touches the Active switch.
  - **`/new` starts a tester's chat over** — *"start a new chat and retrieve no
    context of the user"*. `packages/agent/reset.ts` is the rule,
    `apps/worker/reset.ts` the write. Three owner answers:
    **tester numbers only** (`AppSetting` `chatbot.testers`, the *Testers*
    button beside the switches, owner-only) — a reset has to lift a hand-over
    hold or the bot stays silent after it, and a customer must not be able to
    dismiss a colleague's task; from anybody else `/new` is an ordinary
    message. **The conversation only** — earlier turns, the summary and open
    tasks are left behind; a customer record the POS holds under that phone is
    still found. **Nothing is deleted** — the `/new` row is stamped
    `intent: sistem:reset` and every reader of a thread's past
    (`resetPointFor`: the draft pass, the summary cursor, *Write it for me*)
    reads only what was answered after it.
    ⚠️ It is its own pass AHEAD of the draft pass and outside its candidate
    query: that query skips a held thread and one with `autoReply` off, which
    are exactly the threads a reset is for.

- **Chatbot v2, started 2026-10-14** — `docs/chatbot-v2-design.md` is the
  design and the build order; read it before touching the bot. *"Around 50
  customers a day, 10–25 at once."* Three agents in code, not n8n — Router
  (Sonnet 5.5, structured, no prose), Operations (Haiku 4.5, POS REST only)
  and the Sales Advisor (Sonnet 5.5), who writes every reply. Owner answers:
  the POS is reached through REST (`/api/agent/v1/*`) with a per-turn token
  that carries the sender's wa_id — **no route takes a phone**, which is what
  "a customer can only write to their own data" means; photos stay WhatsApp
  uploads; 10 s is fine; an appointment is a reservation with a visit time
  (`Reservation.scheduledFor`); a lead is set by the bot or staff and clears at
  a sale; one persona per agent; tabs are Chat · Knowledge Base · Evaluation ·
  Settings, and Settings holds the personas, the simulator, the switches and
  Testers.
  - ⚠️ **A Claude Pro/Max (Claude Code) login cannot run the bot.** Anthropic
    refuses those tokens outside Claude Code and claude.ai. Production needs a
    Console API key or Console OAuth (`ant auth login`).
  - **Step 1 is in:** migration
    `20261014120000_chatbot_v2_threads_profiles_and_evaluation` (additive; owner
    approved the schema). `WaThreadMemory` gains the lease (agent-owned), the
    lead in two halves — `leadAt`/`leadScore` the bot's, `leadStaffAt` and
    `leadClearedAt` staff's — and `readAt`; the column grants keep invariant
    13 disjoint. `CustomerProfile` gains `budgetMin`/`budgetMax` (backfilled),
    `ageEstimate`, `occupation` and `CustomerProfileFact` rows.
    `ReservationProposal(+Item)`, `AgentRun(+Step)`, `AgentEvaluation` and
    `Persona.agent` (unique) are new. ⚠️ `CustomerProfile.budget` is
    superseded and kept ONE release for the reader before; drop it after.
    ⚠️ `prisma migrate diff` wants to drop `Expense_orderId_idx` and
    `ManualIncome_orderId_idx` (hand-written, never declared) — strip that
    from any generated migration.
  - **The app is full width** (owner, 2026-10-14): `LAYOUT.contentMaxWidth`
    (1600) is gone, so a zoomed-out screen no longer leaves its right third
    empty. Forms are still capped by `formMaxWidth`.
  - **Step 2 is in (2026-10-15): threads in parallel.** The draft pass answers
    up to `WORKER_DRAFT_CONCURRENCY` (8) threads at once, 16 a tick, each under
    a **lease** (`apps/worker/src/lease.ts`): one INSERT … ON CONFLICT that
    takes `WaThreadMemory.leaseUntil/leasedBy` only when nobody holds an
    unexpired one (120 s), released when the turn ends. Two lanes or two worker
    processes never answer one customer; the commit's compare-and-swap stays as
    the second guard. `draftPass` without `concurrency` is still sequential —
    tests that script one model across threads depend on it.
    `test/lease.test.ts` proves one call per thread under overlap, each reply
    carrying only its own customer's words, and the claim as both roles.
    Waits are now 3 s / 6 s / ~11 s / 20 s (`debounce.ts`, was 4/10/18/45).
    ⚠️ **The worker logs in as `nusantara_agent`, and the roles stay
    separate** (owner, 2026-10-15). The Mac mini's worker had inherited
    common.env's `DATABASE_URL` (`nusantara_app`); `docs/worker-agent-role.md`
    is the step-by-step switch, done on the Mac mini BEFORE the chatbot v2 tag.
    From that release the worker **refuses to start in prod as any other
    role** (`apps/worker/src/role.ts`, exit 78). The lease is the agent's
    alone. `apps/worker/test/agentRole.test.ts` runs every pass as
    nusantara_agent — no worker test did before, and it found that the agent
    role could never CREATE a memory row: Prisma sent `autoReply`'s
    `@default(true)` in every INSERT and the role holds no INSERT on that
    staff-owned column. It is `@default(dbgenerated("true"))` now (same DB
    default, no migration); ⚠️ `prisma migrate diff` therefore also emits a
    no-op `ALTER COLUMN "autoReply" SET DEFAULT true` — strip it like the two
    index drops.
    The webhook does NOT refuse a non-numeric `from` (the design's first draft
    did): WhatsApp usernames may send a sender id that is not a phone number.
  - **Step 3 is in (2026-10-15): the POS behind `/api/agent/v1`.** The POS
    tools (stock, serials, photos, catalogue, and the customer's own profile,
    orders and bookings) run in the API behind a per-turn token the worker
    signs (`AGENT_API_SECRET`, in api.env AND worker.env, nowhere else); the
    worker's `converse` sends them there through `agentApiDispatch` when
    `AGENT_API_URL` + the secret are set, and runs them locally otherwise.
    `packages/agent/src/agentApi.ts` is the contract (route table, token,
    client, `argsFromRequest`); `apps/api/src/routes/agent.ts` the route,
    mounted BEFORE `requireAuth` because its caller holds no staff session.
    ⚠️ **No route takes a phone** — `/me` is the token's `waId`, and that is
    what "a customer can only write to their own data" means here. Keep it
    so: a new route that reads a customer from a path, query or body undoes
    the whole boundary. A switched-off tool is 403 (`toolsFor`), a lookup
    that found nothing 404. `search_knowledge`, `store_info`,
    `lookup_catalog` and the hand-over stay in the worker.
    ⚠️ The agent client uses the real `fetch`, never the tick's `fetchImpl` —
    that one is the Graph stub in tools/wa-local.

  - **Steps 4–6 are in (2026-10-15).** ⚠️ v2 is behind `AppSetting
    chatbot.pipeline` and stays **v1 until the owner switches it** in /chat →
    Settings; both pipelines write an `AgentRun` per turn.
    - **The Sales Advisor IS `converse`** — with `model`, `forcedToolUse:
      false` (Sonnet 5.5 refuses `tool_choice: any`; plain text is read as a
      reply citing `greeting`, which `checkReply` still holds to),
      `excludeTools` (no POS tools) and `preloaded` (Operations' facts,
      photos, bookings). Do not fork the loop: the v1 checks are the v2
      checks because it is one loop.
    - **A booking is two steps and the second is code.** Operations has
      `propose_reservation` (holds nothing, 30 min, `assertSchedule` exported
      from `packages/db` so it is refused for a hold's reasons);
      `confirm_reservation` is in `CODE_ONLY_TOOLS`, never in a model's tool
      list, and `runPipeline` calls it only on the router's `confirm` with a
      proposal open. `/api/agent/v1` lets it through on the booking switch +
      `writes`, not on `toolsFor`.
    - ⚠️ **No model array reaches a query** (`tools.schema.test.ts`): the
      new list arguments — `remember_customer`'s usage/apps/preferences/about
      and `propose_reservation`'s serials — are comma-separated strings.
    - The lead: router score ≥ threshold sets `leadAt` (agent role); staff's
      `leadStaffAt`/`leadClearedAt` on the profile; a sale writes
      `leadClearedAt` in the orders adapter. `isLead` is the one reading.
    - **The /chat screen is four tabs** — Chat · Knowledge Base · Evaluation ·
      Settings — and this REPLACES the 2026-08-26 "inbox and knowledge base as
      two tabs". Chat is three columns (`ThreadList`, the conversation with
      `ReplyRating` 👍/👎, `CustomerProfilePanel`); Settings holds the switches,
      Testers, the pipeline, the lead threshold, the three agents' personas and
      the `Simulator` (a dry run: no reserve, no profile, no run row). The old
      "Fix this", the Context panel, the banners and stacked task cards are
      gone; an open task is one line under the header (`ActionItems`).
      ⚠️ Removed with them: the staff **directive** box (the column and the
      worker's use of it are unchanged — nothing on the screen writes it now)
      and the "customer since / orders" block.
    - Server side: `apps/api/src/routes/inboxV2.ts` (read, lead, profile,
      facts, media) and `chatV2.ts` (evaluations, agents, settings,
      simulate); `.context/chatbot-v2-api-contract.md` was the contract.
    - ⏳ **Step 7 (measure) needs a Console API key** —
      `docs/chatbot-v2-design.md` §10 has the procedure and the SQL.
  - ⚠️ `apps/web/test/transactionsPage.test.tsx` hard-coded `SI-2026/09-…`
    codes and broke on 1 October: the demo seed numbers documents by their
    month, relative to today. It finds seed sales by number now
    (`seedCode`); write new seed-code assertions that way.

- **Rules first, AI last — 2026-10-15 (later), and this is the DEFAULT bot.**
  *"If the process can be rule based or automated, do not use AI. Use AI only
  to do something that the rule base cannot do. But keep the interface."*
  `AppSetting chatbot.pipeline` is now `rules` | `v1` | `v2`, and **absent
  means `rules`** (`loadChatbotSettings`). v1 and v2 are unchanged and one
  click away in /chat → Settings.
  - `packages/agent/src/rules/`: `understand.ts` reads intent, product query,
    budget range (incl. "12-15jt"), serial, "yang kedua", name ("atas nama
    Budi"), visit time ("besok jam 2" → 14:00, a weekday, "20/10"), usage,
    apps, preferences and occupation — pure, `test/rulesUnderstand.test.ts`.
    `replies.ts` are templates that print only what a lookup returned (so no
    `checkReply` is needed). `run.ts` (`runRules`) is the bot: `routeMessage`
    hand-overs as before → remember profile facts → greeting / thanks /
    stock list / price / photos / booking proposal / code-confirm / decline
    by template → a STRONG knowledge-base match sent word for word → the AI
    fallback (`converse`, v1) only if a credential exists → else a person.
  - ⚠️ **The worker answers with NO credential in rules mode.** `draftPass`
    loads the settings before its dormancy check, and only v1/v2 go dormant
    without a key. The simulator likewise needs one only for v1/v2.
  - What a reply showed is kept on the answered row (`entities.units`) and
    read back by `lastShownUnits` — that is what "yang pertama berapa?" and
    "minta fotonya" resolve against. The trace records the router as model
    `rules`, the reply as `template` (or the fallback's real model), cost 0.
  - The Settings agent list shows each seat's `inRules` job while `rules` is
    selected; the simulator says "No AI used" and sends `lastShown` back.
  - ⚠️ Tests that exercise the AI agents pin `chatbot.pipeline = v1`
    (`pinPipelineV1` in four worker test files) — the default moved under them.
  - ⚠️ **One Claude Code subscription still cannot run the AI fallback** —
    Anthropic refuses subscription OAuth outside Claude Code. Without a
    Console key the rules bot runs and the fallback is simply a person.

- **A hand-over is an outline, not a pop-up — 2026-10-15.** *"Do not
  display [the task dialog], instead just highlight the unanswered chat (add a
  shadow / outline, not a popup modal)"*, and, asked: remove the dialog AND the
  one-line task strip. This REVERSES the 2026-09-29 "opens each one's dialog
  once by itself" and its negotiation form.
  - `ChatPage` outlines (2px `colorWarning` + a soft glow, no layout shift) a
    customer bubble waiting on a PERSON: `PERLU_STAF`, or `BARU` while the bot
    is off for that chat — not a BARU row with the bot on, which the bot
    answers in seconds. One caption under it: "Needs your reply · {topic}".
    `data-waiting` marks it for tests. ⚠️ Read the STATUS, not `m.handoff`:
    the server keeps the note on rows staff have since answered.
  - **Mark handled** moved into the conversation header, drawn only while a
    hand-over or an OPEN task exists.
  - **A staff reply now closes the thread's OPEN `ChatAction`s** in its own
    transaction (`POST /api/inbox/:phone/reply`) — with Mark done gone they
    would otherwise never close, and the 🧑 tag reads them.
  - `ActionItems.tsx` keeps only `ActionKindTag`, `actionKindLabel` and
    `budgetText` (the profile panel uses them). The offer/done API routes stay,
    dormant; their web clients went.

- **The bot always asks what the customer needs — 2026-10-15.** *"The goal of
  the bot is to always ask about what the user wants/needs … if they have not
  figured out the preferences, usage, they need to always ask."* In the rules
  bot every reply that is not a hand-over, a booking read-back or a "what does
  your booking still need" ends with ONE question about the first thing the
  profile lacks — usage → preferences → budget → apps (`replies.nextQuestion`,
  appended in `run.ts` `done()`, so no template can forget it) — asked a
  second way when the bot's previous reply (`lastReply`) already asked it the
  first way. `profileKnown` now reports `preferences`. Two new intents keep
  answers to those questions off a colleague's desk: **`tell`** (only about
  themselves — "buat kuliah desain", saved and thanked) and **`ack`** ("ok
  kak" with no booking open). ⚠️ A QUESTION that mentions a fact
  ("garansinya berapa lama?") stays a question (`QUESTION` in understand.ts).
  The simulator derives what is "known" from the earlier turns of its
  made-up conversation.

- **Inventory's units are nested again, 2026-10-02.** *"Instead of showing
  popup in the UI when a row is clicked, use nested column."* A click on a line
  (or its chevron) opens its units UNDER it, several lines at once; the lines
  themselves stay flat — one level, never the product → grade → serial tree
  of 2026-09-08. The nested table dropped Grade and the warehouse (a line IS
  one grade in one warehouse, so the row above says both) and its Where
  became Rack, which is what lets it fit a 1440px screen with the nav open
  together with `.inventory-lines` in global.css stripping antd's padding and
  40px indent from the expanded row. The per-unit buttons are pinned right.
  ⚠️ An expanding table keeps its grid on a phone (DataTable), so Inventory
  is no longer cards there.
- **A discount nobody has used can be deleted, 2026-10-02** (owner decision,
  chosen over hiding one or a Delete that only switched it off). The row's
  *Delete* sits beside *Edit*, behind a Popconfirm; one a sale has redeemed —
  `used > 0` OR any order carrying its id, because the two can disagree — is
  drawn disabled and points at the On switch. ⚠️ This is the app's **third
  hard delete**, and on Postgres the first real one through the store (a
  draft stock count is cancelled to `BATAL` there). `removeUnusedDiscount` in
  `adapters/reference.ts` asks the DATABASE, not the browser's copy, and takes
  the `DiscountSku` rows with it; `Order.discountId` is ON DELETE RESTRICT, so
  a redemption racing the commit fails the DELETE rather than orphaning a
  sale. Migration `20261002090000_discount_delete_unused` grants
  `nusantara_app` DELETE on `Discount` and `DiscountSku` and nothing else. Do
  not generalise it.
- **Staging is a second install on the Mac mini, 2026-10-06.** *"Create
  staging env … staging.pos.macbooknusantara.com."* It is
  **`staging-pos.macbooknusantara.com`** (owner's choice once told why): the
  zone's free certificate is `*.macbooknusantara.com`, one level, and a
  two-level name needs Advanced Certificate Manager. `docs/staging.md` is the
  runbook.
  - `/opt/nusantara-stage`, API `:4001`, Caddy `:8081`, launchd
    `local.nusantara-stage.{api,caddy}`, database `nusantara_pos_stage`, a
    route on the same tunnel. A push to `main` deploys it; Run workflow on any
    branch deploys that branch (`stage-release` needs `static`, not `test`).
  - **Its data is a copy of the shop's** — `nusantara-deploy --stage refresh`,
    as the cluster's superuser over the socket, which is the one login that
    may drop and create a database. The workflow's `refresh_staging_data`
    input runs it BEFORE migrating, because staging's code may be ahead of the
    shop's schema.
  - **One Caddyfile, one `ops/`, two installs.** The Caddyfile reads
    `{$NUSANTARA_HOME|CADDY_PORT|API_PORT|CADDY_ADMIN}` with prod's values as
    defaults (prod's parse is unchanged), and `ops/run` finds its install from
    the `releases/` it sits in.
  - ⚠️ **Staging never runs the worker or the webhook.** The copy carries
    every customer's number and the shop's unsent Outbox. The installer loads
    only api and caddy for it, and `ops/run` refuses both unless
    `APP_ENV=prod`. Do not weaken either.
  - ⚠️ **Staging refuses to go up without the shop-password gate file** — the
    shop's own address does not, and on 2026-10-06 answered 200 without one.
  - The `stage` key is pinned to `nusantara-deploy --stage` (installer 2,
    `setup-deploy-access --stage`), so the key a branch can reach cannot name
    the shop. Roles are cluster-wide, though: staging's owner password IS the
    shop's.
- **Four asks, 2026-10-08.**
  - **The till's catalogue is one row per variant AND grade** — *"per row is
    per unit with same grade and same spec, then the grade is on the left
    next to the unit."* This REVISES 2026-08-27's one-row-per-variant: a row
    with a New, an A and a C quoted three shelves' prices in one range.
    `shelfRows` groups on (sku, grade) and a row carries `key` and `grade`
    (`grades` is gone); the grade sits in a fixed-width slot left of the name
    (`.pos-shelf-grade`) so the names line up, counted products included. The
    "last one skips the chooser" rule now applies per grade row, so more taps
    go straight into the basket. The chooser has a **serial search**
    (`serialMatchesQuery`, the search-box readings as a substring) focused on
    open, and Enter takes the unit once it has narrowed to one.
    ⚠️ It is focused by a `setTimeout` after open, not `autoFocus` (the
    Modal's focus trap takes the caret to its first button) and not
    `afterOpenChange` (it waits for an animation frame a background tab never
    draws).
  - **A discount applies to all, a category or a product**, asked as two
    questions: a Segmented, then which one. `Discount.scope` is still the one
    string the store and `scopeOf` read; `scopeKindOf` reads it back in
    Postgres's order (category first). The list prints "Category: …" /
    "Product: …".
  - **The trade-in's product box is `SkuPicker`** — the shop code
    (`AIR 13" 2020 I5 8/256`) in the box and the model under it, as Inbound
    picks one. Tests pick by `sku.code`.
  - **A warehouse prints its number: "01 · Gudang Utama"** — the shop has
    used 01–04 for six years. `lib/warehouses.ts` (`warehouseLabel`) is the
    one place; every screen that named a warehouse goes through it. The
    number is `Location.code`, which already existed: the store contract
    gained an optional `code`, the adapter projects and writes it, and
    Settings → Warehouses edits it (a new one is offered the next free
    number, a duplicate is refused). The adapter used to fill the column with
    the id, so the go-live import left `wh-01`…`wh-04`; data-only migration
    `20261008090000_location_code_is_the_shop_number` takes the number back
    out of every code that is still that id copy. The importer
    (`masters.py`, `documents.py`) now writes `code` itself, and the fixture's
    codes are `01`–`04`. A code equal to the id prints as the name alone.
- **Financial & Report is per person, 2026-10-16.** *"In the financial data
  management, only Ersen and Dina is allowed."* `Staff.canViewFinance`
  (migration `20261016090000_staff_can_view_finance`, owner-approved,
  default false; the migration switches it on for every active OWNER and for
  the login `dina`). **Not implied by OWNER** — Dina is staff, and making her
  an owner would hand her everybody's passwords. Settings → Staff accounts has
  the switch (audited per change); `staff --finance` is the CLI's.
  - **The API is the control, not the menu.** The store sends the whole shop
    to every browser, so `apps/api/src/auth/financeScope.ts` empties
    `FINANCE_COLLECTIONS` (packages/store: expenses, incomes, settlements,
    settlementLog, paymentLog) in the snapshot, strips them from every
    change-feed and commit answer, and refuses (403) an edit, removal or
    reorder of them. **An insert passes** — the return desk writes a refund
    `Expense` and the customer drawer a `paymentLog` line for everybody.
  - Sale payments live on the ORDER and are not withheld: the till and the
    return desk cannot work without them. Supplier deposits and invoice
    payments are not either (`/suppliers` and Inbound are not in the section).
  - The menu leaves the section out (`navSectionsFor`) and every `/finance/*`
    page answers `FinanceLocked` (`isFinancePath`, App.tsx).
    `test/financeAccess.test.tsx` fails if a new finance leaf escapes it.
- **A fresh start keeps the master data, 2026-10-16.** *"Empty the inbound &
  its unit serial history, transaction, stock opname, service, discount,
  pending payment, receivable, payable, income & expense so only the master
  data is in."* `deploy/macmini/ops/reset-transactions` (`--dry-run` first)
  TRUNCATEs every transaction table — units and their ledger and counted
  stock included, plus reservations, returns, customers' B2Soft debts and the
  opening cash/bank — and keeps products, suppliers, customers, staff,
  settings, the audit log and all chatbot data. ⚠️ A one-off owner decision,
  not a tool and not a precedent for the never-delete rule. It backs up first,
  asks for the database's name, runs as one transaction, and uses no CASCADE —
  a table it forgot that still points at one it empties makes PostgreSQL
  refuse the lot. `ChatAction.unitId` is the one kept reference into it: the
  script nulls it and lifts/restores that constraint, since TRUNCATE refuses a
  referenced table whatever the values. Rehearsed on a seeded throwaway
  database: FK restored byte-identical, no schema drift, the store loads and
  commits after it, and every open till reloads (StoreChange restarts at 1).
- **The faktur is B2Soft's, 2026-10-21.** *"Make the bill exactly like this
  structure, with no extra text … other info could be misleading."*
  `components/Invoice.tsx` is laid out after B2Soft's FAKTUR PENJUALAN: title
  and shop / date and *Kepada Yth.*; No Faktur · Salesman · Tgl · JTp; No ·
  Perincian · Qty · Harga · Diskon · Jumlah; print stamp, Ref, Keterangan
  beside Total · Diskon · Ongkos · PPN · Lain · Netto; four signatures.
  Figures print as `5,700,000.00`, the template's own format.
  - **Gone**: the warranty and "sold as described" paragraphs, channel,
    payment-method and salesperson lines, the pending / balance-due warnings,
    and every unit's QC description. Do not add prose back to the paper.
  - **The address and phone are constants** (`SHOP_ADDRESS`, `SHOP_PHONE`),
    given by the owner; Settings' address and contact still hold seeded demo
    text and no longer reach the faktur. The tagline (the opening hours) and
    the name still come from Settings.
  - Harga is the LIST price and Diskon the bargain off it, so Jumlah is what
    was charged; Ongkos is a fee whose label reads as delivery, Lain the rest;
    PPN is always 0. The serial stays beside the product — the template has
    none, but a warranty claim is checked against it. *Cetak* and *Hal* are
    not printed: nothing counts prints, and the browser cannot number pages.
- **Set price regrades too, 2026-10-21.** *"Make them able to change the
  grade in bulk together when they change the price."* Inventory's Set price
  dialog (`PriceEditorModal`) has a Grade select per unit with its own Fill
  down; Save writes price and grade in one mutation and one `DICATAT` per
  unit naming what moved ("Grade A → C"). A regraded unit moves to that
  grade's line, since a line is one grade. A grade-only edit leaves the price
  — and a hand-typed marketplace price — untouched.
- **One agent, and the bot decides the lead — 2026-10-21.** *"Keep it a
  single agent on the chatbot and the user cannot choose / determine the
  lead."*
  - **No pipeline setting.** `chatbotSettings(hasCredential)` (packages/agent
    v2context.ts) replaces `loadChatbotSettings`: the single AI agent (`v1`)
    answers whenever there is an Anthropic credential, the rules without one —
    a missing key degrades the bot instead of silencing it, so the worker is
    never `dormant`. A stored `chatbot.pipeline` is ignored; `PUT
    /api/chat/settings` is gone and GET is read-only. The three-agent pipeline
    (`pipeline.ts`) is dormant, tested in packages/agent; its worker tests went.
  - **The agent's voice is the Advisor seat's persona** — the one card left in
    Settings → Agent. The worker used the active `Persona` for v1 and ignored
    an edited Advisor; it reads `personaFor("ADVISOR", …)` now.
  - **The lead is the bot's.** The staff switch on the profile, `PUT
    /api/inbox/:phone/lead`, `setLead` and the lead threshold box are gone; the
    threshold is `DEFAULT_LEAD_THRESHOLD` (60). `isLead` reads `leadAt` alone,
    so a `leadStaffAt` left by an earlier build no longer counts. A single-agent
    turn is scored by code — `leadScoreOf(understand(text))`, no model call —
    and written with the reply, as the rules and v2 always were. A sale still
    clears it. The 👎 dialog lost its "which agent" picker.
- **A supplier or customer nobody's paperwork names can be deleted,
  2026-10-21** (*"hard delete it as long as there are no transaction
  linked"*). A bin on the /suppliers and /customers rows; disabled with a
  reason once something names the party (`lib/partyLinks.ts`).
  `removeUnusedSupplier` / `removeUnusedCustomer` in `adapters/reference.ts`
  re-check against the DATABASE — a customer with a chat thread counts as
  linked too — and migration `20261021120000` grants `nusantara_app` DELETE
  on `Supplier`, `Customer`, `CustomerAddress` only. The fourth hard delete;
  do not generalise it.
- **A product is described, not named — 2026-10-21.** *"The current product
  making flow is very confusing."* The catalogue held one MacBook Air as
  `MacBook Air 13" 2020`, `AIR 13" 2020` and `AIR 13" 2020 I5`: Add product
  took a free-typed short name and had no processor field, so `i5` went into
  the name and became a product.
  - **Product names are in full** (owner decision): `MacBook Air 13" 2020`,
    `MacBook Air 13" M2`. **SKU codes stay short** (`AIR 13" 2020 I5 8/256`,
    `lib/skuCode.ts`). `lib/modelName.ts` reads any name to its identity —
    line, size, year or (Apple silicon) chip, plus extras like `TB` — and
    an **Intel processor is a variant, never part of the product**.
  - **Add product** (`lib/newProduct.ts`) asks category (line for iPads),
    size, year, Apple chip OR Intel processor options, RAM, SSD, and builds
    the name. A category with no line (accessories) keeps a name box and one
    variant. **The same product already there gets the missing variants**,
    and is renamed to the full name; the dialog says which before Save.
  - **Delete product** (row bin) archives the product and its variants, and
    only while nothing has ever been recorded against them — units, counted
    moves, invoice or sale lines, trade-ins (`productInUse`,
    `variantInUse`). "Stock is 0" is not enough: an archived variant is not
    projected, so a past receipt naming it would name nothing. The server
    checks the same in the skus adapter; the model archive waits in
    `ctx.later` because models are written before skus.
  - *Use full product names (n)* renames what is safe to rename; a name with
    a processor in it, or a product that has a duplicate, is left for a person.
  - `ops/fix-skus` (2026-10-21) archives same-product duplicate VARIANTS.
- **Sell prices from a price list, 2026-10-21.** Inventory → *Import sell
  prices* reads the shop's own *Export stock* sheet with a price column
  ("Harga IG"), matches each row by the text the export wrote (`Sku.name` +
  variant label) in the same warehouse, against the LIVE store, and previews
  (`lib/priceImport.ts`). Only units past QC (`TERSEDIA`, `DIRESERVASI`,
  `SERVIS`) get `Unit.price`, with a `DICATAT` naming the file; **a unit in QC
  is never repriced** — its price is its inbound invoice's. `Sku.price`,
  costs, invoices and the ledger are untouched (`priceImportPage.test.tsx`).
- **Photos**: a row's photos are a thumbnail stack (`PhotoStackButton` —
  first photo, second behind it, never more than two). S/N history takes new
  photos for a unit the shop still holds; a sold unit's were purged by design.
- **Opening balance on Income & Expense, 2026-10-21** (`OpeningBalanceModal`):
  bank, cash and an "as of" day, into `AppSettings.openingCash/openingBank/
  openingBalanceAt`. The running balance starts there and counts only money
  settled ON or AFTER that day — the figure already holds what came before.
- **The catalogue is facts, not names — 2026-10-21** (owner approved the plan
  and its schema). Migration `20261021150000_catalogue_product_identity`,
  ADDITIVE ONLY, nothing backfilled:
  - `CatalogModel.family/chip/extra/productKey`, `Sku.mergedIntoId/variantKey`,
    `ModelIdentifier` (AppleDB links), `ModelNotDuplicate` (pairs a person
    said differ). Partial unique indexes on LIVE non-null keys.
  - **Keys refuse a NEW duplicate and never an edit of an old one.**
    `freeProductKey` / `freeVariantKey` (adapters/catalogue.ts): creating a
    product or variant another live row already IS is refused; an existing
    duplicate saves keyless. Import mode lets one through keyless. The
    identity rules are `packages/domain/catalogIdentity.ts` — one copy for
    browser and server.
  - **Merge** (`lib/catalogMerge.ts`, Master Product → *Review duplicates*):
    a variant the kept product lacks MOVES (same id — its units, invoice
    lines and receipts follow); one it has JOINS: held units move with a
    `DICATAT`, counted stock by a KOREKSI pair, and the variant is KEPT,
    archived and `mergedIntoId`, because receipts name it. Never used →
    removed. One variant that cannot be placed stops the whole merge.
    "These are different" is remembered.
  - ⚠️ **A merged variant is still in `db.skus`** (projected for history).
    Every picker or list of variants filters with `isLiveSku`; a lookup by id
    must not. New code listing variants must do the same.
  - **AppleDB links instead of copying** (`matchAppleDb`): already linked →
    skipped; the same product here (by facts or name, AppleDB's own wording
    ignored) → identifier linked, missing RAM × SSD added; two candidates →
    "Possible match", left for a person; else a new product named in full.
  - Inbound creates no products (Master Product is the only door), so the
    matcher and the server refusal cover it. ⚠️ The B2Soft importer runs in
    import mode and is NOT matched — a re-import can still add a keyless
    duplicate, which *Review duplicates* will then list.
- **The bot runs on Haiku 5.5 and remembers more, 2026-10-22** (owner
  decisions). Two halves: the model, and what the single agent can see.
  - **`claude-haiku-5-5`** for the replies (`AGENT_MODEL`) and the summary
    (`SUMMARY_MODEL`), overridable WITHOUT a release by `CHATBOT_MODEL` /
    `CHATBOT_SUMMARY_MODEL` (worker.env; api.env takes `CHATBOT_MODEL` for
    Draft and the simulator) — env only, no Settings switch. `costMicros`
    prices it at $0.10 / $0.50 per MTok (cache reads 0.1×, writes 1.25×), and
    at $0.50 / $2.50 for a prompt over 100K tokens.
  - **`tool_choice: any` is kept** (Haiku 5.5 accepts it; a forced call skips
    thinking). "Every turn ends in reply or handoff_to_staff" stays a
    guarantee of the API rather than of the prompt, and the facts come from
    the sources and `checkReply`, not from reasoning. Every call sends
    `output_config.effort: "low"` and no `temperature` (a non-default one is a
    400); `MAX_TOKENS` is 4,096 because thinking counts toward it; content is
    read by `type` and the assistant turn goes back with its thinking blocks
    unmodified; a `refusal` is a hand-over. ⚠️ No prefill, no `budget_tokens`
    — both are 400s on this model.
  - ⚠️ **The same text is ~30% more tokens** on Haiku 5.5's tokenizer. An
    `AgentRun` token count after the switch is not comparable with one
    before it; compare `costMicros`.
  - **A burst is one turn** (`packages/agent/turns.ts`). A reply lands on one
    row, so the history and the summariser used to read only the last line
    of "halo / mau tanya / Air M2 ada?". Lines are tied to their reply by
    `answeredAt` — every claim writes one instant onto all the rows it
    answers — and walked in `(ts, id)` order within it. `recentTurns` (the
    8-turn window) and the summary pass both read whole turns now.
  - **The single agent reads the profile** (`profileLine`) and any open
    booking proposal; only v2 did. Both ride in the prompt's VOLATILE half,
    never the cached one.
  - **The summary keeps what it knew**: 1,500 characters (was 700), and the
    summariser is told to keep the name, budget, units quoted with their
    prices, promises and bookings from the previous note and to drop small
    talk, instead of rewriting from the last dozen turns.
  - **Recall: `ChatMemoryChunk`** (migration `20261022120000`, owner-approved,
    additive): one row per answered turn — `from` (the thread key; the
    brief's `waId`), `fromMessageId` / `toMessageId` (FKs to `WaMessage`,
    RESTRICT: the chunk is a copy of their words, so a purge must take it
    too), `text`, and `embedding` BYTEA / `model` / `dims` / `embeddedAt`,
    all four or none (CHECK). Written by `memoryPass` (apps/worker), after
    the summary pass, never inside a transaction. At draft time, ONCE the
    8-turn window is full, the 3 older turns closest to the customer's
    message — after the thread's `/new` (`resetPointFor`) — go into the
    volatile prompt as "Earlier with this customer (may be outdated)", dated.
  - **Embeddings are Voyage AI through MongoDB Atlas** (`voyage-4-lite`, 512
    dimensions, `int8`, `POST ai.mongodb.com/v1/embeddings`, plain `fetch`).
    **BYTEA and cosine in JS, not pgvector**: pgvector is not on the Mac mini,
    `CREATE EXTENSION` needs a superuser, and recall only ever scores ONE
    customer's own chunks — dozens of rows. The query embedding has a 1.5 s
    deadline; no key, an error or a timeout falls back to BM25 (retrieval.ts)
    over the same chunks, so Voyage can delay a reply by the deadline at most
    and never stop one. The knowledge base itself stays on BM25.
  - ⚠️ **`VOYAGE_API_KEY` lives in worker.env and nowhere else** — never
    api.env, a doc, a log or a test. `VoyageError` carries the HTTP status,
    never the request. Unset, chunks stay text and recall is by keywords.
  - ⚠️ Grants: `nusantara_agent` has SELECT, INSERT and UPDATE on the four
    embedding columns only — it cannot rewrite a chunk's words or delete one;
    `nusantara_app` has nothing (the API never reads the table). The deploy's
    `t|f|t|f|t` query is untouched. `apps/worker/test/memory.test.ts` runs the
    pass and recall AS nusantara_agent.
  - ⚠️ **A test that deletes `WaMessage` rows must delete `ChatMemoryChunk`
    first** (RESTRICT). Every existing cleanup does; `truncateAll` CASCADEs.
  - ⚠️ `RECALL_MIN_SIMILARITY` (0.5) is a starting point, not a measurement —
    no Voyage call was made building this. Tune it on real threads.
  - `/new` is unchanged: it forgets the conversation (recall included, via
    the reset point) and leaves the profile and the POS customer alone.
  - **A Console login runs the bot** (owner, 2026-10-22): `ant auth login`,
    run once as `_nusantara` with `HOME=/opt/nusantara/var`, leaves a profile
    the SDK refreshes by itself; `antProfileOf` (packages/agent anthropic.ts)
    finds it from the PASSED env and the client is built with `{ profile }`.
    A key or token in the env still wins. `CHANGE_ME` (the env templates'
    placeholder) is no credential — it used to count as one, so a worker.env
    copied from the example sent every turn to a 401 and a hand-over.
    ⚠️ **The owner runs it on an OAuth token** (`ANTHROPIC_AUTH_TOKEN` from
    `claude setup-token`, 2026-10-22), and that token is a 429 on
    `claude-haiku-5-5` while `claude-haiku-4-5` answers. So an OAuth token
    defaults both models to `OAUTH_MODEL` (Haiku 4.5) unless `CHATBOT_MODEL`
    says otherwise, and `effortConfig` sends `effort` only to a model that
    takes it — Haiku 4.5 answers it with a 400.

- **WhatsApp through a linked device, 2026-10-22** (owner decision): the
  chatbot runs on WhatsApp via **Baileys** in production, linked by scanning a
  QR inside the POS. This REVERSES the 2026-10-14 "Baileys is local testing
  only; production is the Cloud API" — for the transport, not for
  `tools/wa-local`, which stays a laptop tool outside the workspace.
  `docs/whatsapp-baileys.md` is the runbook.
  - **`apps/wa-gateway`** is one Baileys socket on `127.0.0.1:3002` behind a
    shared secret (`x-wa-gateway-secret`): `GET /status`, `POST /link`,
    `POST /logout`, and `POST /graph/{v}/{id}/messages|media` answering in
    Graph's shapes. Inbound 1:1 messages (never groups, status, channels or
    the number's own) are re-shaped into Meta's delivery and POSTed to the
    REAL webhook, signed with its `APP_SECRET`. Only `baileysSocket.ts`
    imports Baileys; the rules are in `session.ts` / `delivery.ts`, tested
    with a fake socket and the real Graph client.
  - **The worker is not forked.** `WHATSAPP_TRANSPORT=baileys` (+
    `WA_GATEWAY_URL`, `WA_GATEWAY_SECRET`) hands the send pass
    `gatewayFetch` (`@nusantara/whatsapp`) through the existing `fetchImpl`
    seam: same request, origin moved, bearer token dropped, secret added. No
    `WHATSAPP_TOKEN` is read in that mode. Unset or anything else is the
    Cloud API, unchanged. Baileys mode half-configured is DORMANT, never a
    fall-back to Meta.
  - **ONE session.** Link is refused (409) while a session is connected or
    connecting, rationed to **3 attempts an hour** (429, reported on the
    card), and a session opened elsewhere (440) is left DISCONNECTED rather
    than fought over. The POS card (Chatbot → Settings, **owner-only**) shows
    a permanent warning: unofficial, can be banned, do not link/unlink
    repeatedly, prefer a dedicated number, keep the phone online (~14 days).
    `/api/whatsapp/connection` audits a link request as CREATE and an unlink
    as DELETE (entity `WhatsApp`), after the gateway answered — no network
    inside a transaction.
  - ⚠️ **The QR is never logged**, anywhere. For its minute it IS the number.
  - ⚠️ **SIGTERM does not unlink.** A deploy restarts the gateway; the session
    is in `WA_GATEWAY_STATE_DIR` (`/opt/nusantara/var/wa-gateway`), outside
    the release. Unlinking is the owner's Disconnect button or the phone.
  - ⚠️ **Prod only**, twice: the gateway refuses `APP_ENV` other than `prod`
    unless `WA_GATEWAY_ALLOW_NONPROD=1`, and `ops/run wa-gateway` refuses
    before starting it. Staging must never run it — it would be a second
    device on the shop's number.
  - ⚠️ **An inbound photo's bytes are not downloaded.** It arrives as
    `type: "image"` with its caption, exactly as from Meta, and the webhook
    stores type and text only — no table holds customer media, and a
    customer's photo is a hand-over anyway. Baileys' optional sharp/jimp are
    left out of the release (`BAILEYS_OPTIONAL`), so a sent photo carries no
    thumbnail.
  - ⚠️ **Installer 3.** `nusantara-deploy` restarts, reloads and
    health-checks `local.nusantara.wa-gateway`; a release cannot replace the
    installed copy, so the owner must re-run `setup-deploy-access` on the Mac
    mini once. The gateway, like the worker and webhook, is LOADED by hand
    the first time (`docs/whatsapp-baileys.md` step 7).
- **The activity log can be cleared, 2026-10-22** (*"a button to clear all
  the activity history"*). Settings → Activity has an owner-only *Clear all
  activity* behind a two-layer confirm — the dialog, then typing the word
  shown (`CLEAR` / `HAPUS`), the draft-opname pattern. `DELETE
  /api/kontrol/audit` (`requireOwner`) empties the table and writes ONE fresh
  `AuditLog` row — entity `AuditLog`, action `DELETE`, who, when and
  `{"rows": n}` — in the same transaction, so a cleared log always says who
  cleared it. ⚠️ `AuditLog` stays append-only: no table-level DELETE, UPDATE
  or TRUNCATE is granted; the one door is `audit_log_clear()`, a SECURITY
  DEFINER function (migration `20261022150000_audit_log_clear`, the
  `unit_event_drop_last` pattern) that takes EVERY row or none — there is no
  form of it that removes single lines. Only `nusantara_app` may execute it.
  Do not generalise it.
- **Mistakes are corrected, not appended around — 2026-10-22.** *"The
  transaction history should be editable … Do not implement append only. This
  is an environment where they input amount / product / channel wrongly. So
  all things should be recoverable and a mistake should not cost lots of
  additional steps."* Four changes, owner-asked.
  - **Edit transaction takes accessories and prices** (the owner's bug: a
    MagSafe could not be added). A counted product is a line — product, qty,
    price per piece — and a unit's price is a box on its line; the sale's
    total is re-derived from the lines on save. More pieces is a `TERJUAL`
    from the shelf, fewer (or the line gone) a `KOREKSI` putting them back at
    the cost they went out at; a positive KOREKSI naming an order line takes
    its cost off `OrderItem.cogs`/`Order.cogs` (adapters/stock.ts, and
    `lineCost`). On Postgres a line taken off is CLOSED with `returnReason =
    "Dikoreksi"` (`CORRECTED` in documents.ts) and projected nowhere; a unit
    taken off has its `soldOrderItemId` cleared and its cost leaves the sale.
    ⚠️ Filter with `NOT_CORRECTED` (an OR with null), never `NOT: {
    returnReason }` — SQL's NOT drops every null-reason line with it.
  - **A sale can be deleted** (Transaction History, a bin per row) — *"gone
    completely"* (owner answer). `lib/saleDeletion.ts` is the rule: refused
    in a closed month, after a return, with a trade-in, when a unit moved on,
    with a marketplace payout or an Income & Expense line naming it. Units go
    back to what their previous row says, counted pieces back by a KOREKSI,
    a redeemed discount is freed. On Postgres it is `cancelSale`: `BATAL`
    (projected nowhere), payments voided, lines closed — a deleted invoice's
    footing. Checked server-side too, book close included.
  - **The book closes a MONTH at a time** (`endOfMonth`, a month picker) —
    *"close transaction monthly so before that all the transaction can be
    deleted"*. What is open can be edited and deleted; what is closed neither.
  - **A unit's history row can be deleted** from S/N history's ⋯ menu — *"some
    of the history is irrelevant"*. Any row (`removeEvent`), never the last
    one standing, never the sold row of a sale that still carries the unit
    (`historyRowBlock`) — that goes by deleting the transaction. The newest
    row going restores the row before it; a middle row leaves the unit as it
    is. The database's door is `unit_event_drop(text[])` (migration
    `20261022140000`, SECURITY DEFINER, refuses only to empty a unit;
    `unit_event_drop_last` kept for the release before). ⚠️ New rows number
    from the highest `seq` + 1, not the count — a gap is normal now.
  - Inbound's Purchase card shows **Total units purchased** (every line's
    qty).
- **One page for a sale's money — 2026-10-22, later.** *"Combine the
  transaction history and the pending payment … it should just be transaction
  history + upload the shopee balance"*, *"below the payment method Shopee, we
  should be able to add deduction immediately"*, and four owner answers.
  - **Pending Payment is gone.** Its nav leaf is removed and
    `/finance/receivables` redirects to Transaction History; a sale waiting
    on a payout is that list's *With a marketplace* payment status. The Shopee
    upload is a button on Transaction History. `ReceivablesPage` and
    `SettleModal` are deleted; their writer is `lib/payouts.ts`
    (`recordPayouts` for the upload, `upsertSettlement` for one payment,
    `netOfOrder` re-deriving `grossTotal`/`netReceived`).
  - **Edit transaction holds the payout — in the payment grid itself**
    (revised the same evening: *"add directly deduction on the rightmost … a
    '−' button … a nested row below the Shopee row"*). `PaymentsPanel` takes
    `deductions` / `onDeductionsChange` (Edit transaction only): a "−" on a
    marketplace row nests a name + amount row under it, with "amount − kept =
    received". The row's own Status IS the payout landing — Pending → Settled
    dates it now. The reference sits BESIDE the method on one line. Deductions may be typed while it is still pending, so a
    `Settlement` can now exist beside a PENDING payment; nothing reads a
    settlement as "landed" any more. A payout no longer stops a sale from
    being deleted.
  - **The reference ID follows the channel** (owner answer: Shopee, Tokopedia
    or TikTok). A marketplace payment keeps its own under its method; the
    sale-level box is drawn only for a marketplace channel with no
    marketplace payment (TikTok, or Shopee taken in cash); any other sale
    keeps no reference — Shopee → Instagram + transfer strips it.
  - **Additional charges are rows** in the dialog (`Order.fees`; `extra` and
    `extraNote` re-derived), and the total follows.
  - **A closed month locks only what is finished** — *"close book to all the
    payment that already settled (need to get X, received X, no pending),
    and we can still add received amount even if it is closed"*.
    `isSaleLocked` (bookClose.ts): inside the closed month AND fully settled,
    nothing pending, nothing owed. Every door asks it — Transaction History,
    Edit transaction, `PaymentsModal`, `DebtPaymentModal`, sale deletion,
    return undo — and `cancelSale` on Postgres reads `Order.status = LUNAS`
    the same way.
- **Cash ↔ bank, and the two balances, 2026-10-22.** *"Take 2mil in bank to
  cash, use the cash, and return the money again."* The adjustment dialog's
  third type is **Cash ↔ bank**: *Pencairan Dana Bank* (bank → cash) or
  *Setor Tunai ke Bank* (cash → bank), written as an `Expense` (kind
  `TRANSFER`, from one pot) plus a `ManualIncome` (reason `TRANSFER`, into the
  other) in one save — no schema change, each pot moves and the total does
  not. Income & Expense shows a **Cash** and a **Bank** card (`balancesOf`,
  from the opening balance on), following the Cash basis / Accrual switch —
  accrual adds a pending payout to the bank — and both read **Rp ••••••**
  until the eye is pressed (per visit, never remembered).
- **Income & Expense's top row is the latest balance, and an adjustment can
  be deleted — 2026-10-24.** Owner report: Transaction History said Rp
  21.722.500 came in, two expenses (Rp 60.200 + Rp 40.100) were typed, and the
  top row's Latest balance still read Rp 21.722.500 — so the shop counted
  Rp 100.300 missing. The figures were right; the ORDER was not. A typed
  adjustment carried a date and no time (it sat at noon UTC), so a day's
  typed rows tied, and a stable newest-first sort kept them oldest on top.
  - **Every row shows its hour and minute.** A typed row sits on the day
    somebody picked at the clock time they typed it (`typedAt`, from
    `createdAt`); noon only when there is no `createdAt`.
  - `chronological` (CashflowPage) is a TOTAL order — instant, then when the
    row was typed (`createdAt`), then key — and the Date column sorts on each
    row's position in it (`ProColumn.dateValue` keeps the date filter on the
    date). The running balance walks the same order backwards, so the view and
    the walk cannot disagree again.
  - `createdAt` is in the store contract for `expenses` and `incomes` now
    (optional; the column always existed). The till stamps it and the server
    keeps it — it orders a day's typed rows and nothing else.
  - **Delete** is a bin on a typed row (`lib/adjustmentDeletion.ts`), behind a
    confirm. A cash ↔ bank move goes as BOTH halves (matched by day, amount
    and note — nothing links them). Refused inside a closed book, in the
    browser and in the adapter. Migration `20261024090000_adjustment_delete`
    grants `nusantara_app` DELETE on `Expense` and `ManualIncome` only —
    nothing points at either table. The fifth hard delete; do not generalise
    it.
- **Edit transaction is ONE Items table, 2026-10-22** — *"item name first,
  then serial or qty"*. Item (every live variant) · Serial / Qty · Price ·
  remove, and one *Add an item*. The product picked decides the row: a
  tracked one asks its serial, a counted one (`skuTracksSerial` false) a
  quantity with a price per piece. ⚠️ A unit row with a product and no serial
  is REFUSED on save ("Type the serial of …"); it used to be dropped without a
  word, which is how an added MagSafe vanished in the owner's report.
- **What was sent can be seen, edited and unsent — 2026-10-23.** *"Display
  the photo that we sent as well. Can we edit or unsend from the web? I would
  want to do that in case the AI is wrong."* Owner answers: add the columns;
  ANY signed-in staff may do it, each action audit-logged with who.
  - **`Outbox.providerMessageId`, `.retractedAt`, `.editedAt`** (migration
    `20261023090000_outbox_sent_message_edit_unsend`, additive). The worker
    keeps the id WhatsApp returned when it marks a row SENT (`markOutboxSent`
    used to log it and throw it away), text and photo alike. No GRANT: both
    writer roles already held table-level UPDATE on `Outbox`, and the
    migration's DO block refuses if that is not so, or if either can DELETE.
    The deploy's `t|f|t|f|t` reads no `Outbox` privilege and is unchanged.
  - **`GET /api/inbox/:phone` carries `sent`** — the thread's newest 100
    WA_REPLY / WA_IMAGE rows by `payload.to`, with `canEdit` / `canUnsend`
    decided server-side (`routes/inboxSent.ts`). A reply bubble names its row
    by `reply.outboxId`: the newest WA_REPLY whose `inReplyTo` is that message
    and whose body is exactly its `replyText` (an edit rewrites both, so the
    pair still matches). Every sent item no reply claims — a photo, the
    "Berikut foto…" line, a bot reply a later staff reply overwrote on the
    same row — is drawn as its own bubble at its time. A reply with no row
    has no menu.
  - **The limits are WhatsApp's**: unsend within 48 h of `sentAt`, edit a
    TEXT within 15 min. Also refused: another phone's row (404), not SENT, no
    id (sent before this release — and a `wamid.` Cloud API id or the
    gateway's `wa-gateway-…` stand-in counts as none), already unsent, and
    **any transport but Baileys** (409; the API reads that as
    `config.waGateway` being set). Order: validate → `POST /messages/revoke`
    or `/messages/edit` on the gateway (`gatewayClient.ts`, shared with
    `/api/whatsapp/connection`) → ONE transaction stamping the row (an edit
    also rewrites `payload.body`, and `WaMessage.replyText` only while it
    still holds the old text) and an `AuditLog` row, entity `Outbox`, DELETE
    or UPDATE with before/after.
  - **The gateway addresses the chat the send went to** (`jidFor`: the LID a
    customer wrote from, else `<n>@s.whatsapp.net`) — a delete aimed at the
    other chat finds nothing.
  - `/chat` draws a sent photo from `GET /api/inbox/:phone/sent/:id/photo`
    (click for larger; "Photo no longer stored" on a 404 — a sold unit's
    photos are purged by design), "Unsent" in place of an unsent item,
    "Edited" beside an edited one, and a ⋯ (`SentItems.tsx`) with Edit and
    Unsend (behind a confirm) only while the server says each is possible.
  - ⚠️ An unsent row keeps `replyText` and its outbox row — nothing is
    deleted, and *Write it for me* leaves unsent lines out of the turns.
- **Service, supplier refunds, unpaid returns and the QC finder — 2026-10-26.**
  Spec `docs/superpowers/specs/2026-10-26-service-returns-qc-design.md`, owner-
  approved; migration `20261026090000_service_charges_and_supplier_refunds`.
  - **Nothing finds "the bench" by `Location.kind` any more** — in the shop, 04
    is *Gudang Masuk Belum QC*, and *Back in stock* defaulting to it while
    excluding it is what drew a raw `wh-04`. `components/SendToServiceModal`
    is the ONE dialog (QC row, an accepted row's ⋯, Inventory's unit ⋯): *Where
    is it serviced?* (its own warehouse by default), courier fee only when it
    travels, and per charge **Paid with** Bank / Other bank / Cash / Not paid
    yet. QC and TERSEDIA only. Stock out is write-offs only, and its counted
    picker lists variants with stock.
  - **A paid charge is an `Expense` of kind `UNIT`** ("Unit expense",
    `Expense.serviceFeeId`, unique; `automatic`, so Add adjustment never offers
    it). It is already in `costOfUnit`, so P&L keeps it out of
    `OPERATING_KINDS`. ⚠️ The CHARGE owns its expense ON THE SERVER: removing a
    fee or its visit deletes it, an amount edit moves it — an account without
    finance access is sent no expenses. `fees[].paid` is DERIVED (no column).
  - **A charge, or a whole visit (dialog + serial typed back), can be
    deleted** with the history rows it wrote (`lib/serviceActions.ts`, matched
    by shared instants — `appendEvent` takes `at`). Refused once the unit
    moved on, and in a closed book judged by the Jakarta day. ⚠️ The sixth
    sanctioned hard delete: `nusantara_app` holds DELETE on
    `ServiceVisit`/`ServiceFee` only. Do not generalise it.
  - **A supplier return carries its money** (`components/SupplierReturnModal`,
    `lib/supplierReturn.ts`, rule C — owner answer). The credit (`Unit.buy`,
    editable, + the service charges on a button) first comes off what the
    invoice's GOODS still owe, as a `RETUR_SUPPLIER` PoPayment (`inBalance:
    false`, `returnId`; no pot by name, in no picker, not on Income & Expense);
    the rest is a REFUND `ManualIncome` naming the return, or *Awaiting refund*
    until **Mark received**. Undo removes the credit and KEEPS a received
    refund. `returns[].refundReceived` is derived server-side for the same
    finance-access reason.
  - **"Unpaid, returned" / "Partly paid, returned"** (`salePaymentStatus`,
    `returnedDebt` in lib/saleStatus.ts) replace a misleading Settled; Income &
    Expense (Accrual) keeps one struck-through row that never counts. ⚠️ Reads
    0 — the old word — for an exchange and wherever a marketplace was involved:
    a cut held payment leaves no row to tell it from a debt.
  - **Waiting for QC** on `/inbound` (`lib/qcWaiting.ts`): units in QC on an
    invoice plus serial-less slots on an ARRIVED invoice; one search answers
    "which invoice has this product" and "what is left on this invoice". The
    list gained **To QC**, its search reads the invoice number, and the nav
    leaf carries the count (`NavBadge`).
  - **`ops/purge-unit SERIAL`** (dry run; `--apply` backs up and asks for the
    serial back) removed the test unit FV29837462 and every row naming it,
    audit lines included, writing no trace; the invoice line stays waiting for
    a serial. A one-off like `reset-transactions`; do not generalise it.
- **A chat can be cleared, or deleted for good — 2026-10-27** (migration
  `20261027090000_chat_clear_and_delete`). **Clear chat** (any staff, the
  header's ⋯) closes what waited and the open tasks — the Mark-handled close —
  and writes `WaThreadMemory.clearedAt`/`clearedById`, staff-owned, UPDATE to
  `nusantara_app` only (invariant 13). Nothing is deleted: `resetPointFor` is
  the LATER of `/new` and the clear, so draft, recall, the summary and memory
  passes and *Write it for me* forget it (`summarySince` hides the old note
  the app cannot blank); /chat shows a row only if answered after the clear or
  still waiting (`visibleAfter`), never by `ts`. **Delete conversation** (owner,
  the number typed back) is `wa_thread_delete`, SECURITY DEFINER, EXECUTE to
  `nusantara_app` only; it keeps the profile, the customer, every rating and
  correction and exactly the messages/runs they name, behind a fresh clear.
  ⚠️ The seventh sanctioned hard delete; do not generalise it. A sent bubble
  says "Edited by / Unsent by {name}" from the `Outbox` audit rows. A 👍/👎 is
  taken back by pressing it again (`DELETE /api/chat/evaluations/:id`, author
  or owner, OPEN only); `nusantara_app` gained DELETE on `AgentEvaluation`.
- **A picture from staff's own device, 2026-10-27** (migration
  `20261027120000_chat_media`, owner-approved). The /chat 📎 offers a unit's
  QC photos or a picture from this device (`SendPictureModal`: JPG/PNG/WebP,
  ≤ 5 MB, refused before upload, preview, optional caption).
  `POST /api/inbox/:phone/picture` checks type, bytes and the 24-hour window,
  then writes **`ChatMedia`** (keyed by wa_id like `ChatMemoryChunk.from`),
  the WA_IMAGE naming it (`chatMediaId`, exactly one of that or `photoId`) and
  an `Outbox` CREATE audit line in ONE transaction; the worker sends it like a
  QC photo. "Sent by {name}", Unsend works, Edit stays text-only. App SELECT +
  INSERT, agent SELECT, DELETE for neither: `wa_thread_delete` removes them.
  ⚠️ The Cloud API sends JPEG/PNG images only — WebP works through Baileys.
- **The POS is the bot's source of truth; a hand-over no longer silences the
  chat — 2026-10-27.** An UNSET switch now reads stock, price and photos ON
  (`SHOP_CAPABILITIES`, bookings off; `AGENT_CAPABILITIES=parallel` is the old
  default). ⚠️ This REVERSES 2026-09-18's "the worker HOLDS the thread": the
  message needing a person stays PERLU_STAF with its task, newer ones are
  drafted with the OPEN tasks named (`waitingTasks`) so the bot neither answers
  nor contradicts them; only a staff reply by hand in the last 15 min
  (`STAFF_ACTIVE_MS`) or `autoReply` off holds a thread. An empty
  `search_stock` returns ≤3 in-stock `alternatives` (same category, nearest
  price, within budget) plus a fitting `accessory`, and any pick may carry ONE
  `stepUp` (≤30% dearer) — all `StockFact`s. ⚠️ As `nusantara_agent` (no agent
  API) `StockMove` is unreadable, so no accessory. Tasks read
  `Perlu cek harga — Air 15" M2 8/256` + a quote (`tasks.ts`); /chat maps old
  `Balasan bot ditahan (CODE)` notes the same way (`lib/taskSummary.ts`).
- **Sell, don't hold — 2026-10-27** (migration
  `20261027150000_chat_sales_visits_and_stock_watch`, owner-approved). ⚠️ This
  REVERSES bot holds: *"if reservation makes the stock decrease and reduce
  sale, it is bad."* The bot books a VISIT — `book_visit` / the proposal
  confirm → `createVisit`, a `Reservation` with no items, no `DIRESERVASI`;
  the units to see ride on its confirmed `ReservationProposal`.
  `create_reservation` is gone from every tool list; visits default ON. A
  keep / DP / "saya ambil" / how-to-pay routes to a CLOSING task (new
  `ChatActionKind`, `closingTask`); the bot never names a DP. It asks briefly
  (usage → budget, then stops), recommends best fit + cheaper + one step up
  with battery, says "tinggal 1 unit" only from `left` (`checkReply` refuses
  any other count) and ends on one yes-question. `followUp.ts` reminds a visit
  once (09:00, or 2 h before one before 11:00; past the window only on
  Baileys) and nudges a quiet 🔥 lead once a week, both marked `payload.followUp`;
  the reply to a reminder is read by code (`visitReplyTurn`). **`StockWatch`**:
  agent S/I/U, app SELECT + UPDATE("closedAt"), in `wa_thread_delete`; `watchPass`
  leaves one "Perlu kabari" task. Agent reads `StockMove`; Evaluation has a funnel.
- **Reconciliation, daily and monthly — 2026-10-27** (owner "1B 2B 3B 4A";
  `docs/superpowers/specs/2026-10-27-reconciliation-design.md`, migration
  `20261027170000_reconciliation`), finance access only. "POS balance" IS the
  Cash and Bank cards: Income & Expense's row projection moved to
  `lib/cashflowRows.ts` so both screens read one (`balancesOfRows`).
  **Daily** counts bank and cash; a pot that differs lists that day's
  movements with editable amounts, and an edit corrects the REAL record by its
  own screen's rules (`applyAmountEdit`/`editBlock`), logged before → after on
  `ReconciliationEdit`. "Changed since reconciled" is derived; Income & Expense
  says "Today isn't reconciled" until both pots are. **Monthly** reads BCA's
  PDF (`pdfjs-dist`, lazy-loaded) or KlikBCA's CSV by position and refuses one
  that does not add up in SEN (`lib/bankStatement.ts`). ⚠️ A line stores the
  rupiah as printed (truncated); sen are checked and shown, never carried.
  `lib/bankMatch.ts`: EXACT and DATE_SHIFT ±3 match at once; SPLIT, MERGE,
  TYPO, DEDUCTION (≤5%) are held SUGGESTED for Accept/Reject. ⚠️ Eighth hard
  delete: statement lines and matches (re-upload). A non-OPEN reconciliation
  blocks deleting an adjustment it names; reopened, `reconciliation_edit_drop`
  takes the edit with it. Do not generalise either.
- ⚠️ **The web suite needs room.** `apps/web` has 69 test files of rendered React
  and the till's split-payment test alone takes ~45s (a 180 s budget, for CI's
  2-vCPU runner); at full parallelism on a laptop several time out and look
  like failures. `npx vitest run --maxWorkers=2 --testTimeout=90000` is the
  honest run.
- Lists paginate with a page size the user picks, and a filterable column puts
  its filter in the **column header**. `ProTable` holds the filter/sort state
  and does the work itself — the header control only reports clicks — because
  `DataTable` draws cards instead of a header on a phone, and because a
  `sorter` left to antd would sort one page.
- Forms are centred, capped at `LAYOUT.formMaxWidth`; spread `FORM_CENTRE`.
- Light and dark are both shipped. The account menu at the foot of the sider
  owns both per-person preferences — appearance and language.

Docblocks across the codebase still cite the deleted plan by section — "06 §11",
"08 §5", "01 §7". Those are not dead ends; the files are archived in git:

```
git show archive/plan-docs:docs/rebuild/06-webhook-integration.md
git checkout archive/plan-docs -- docs reference   # bring it all back
```

The same tag holds `reference/`, the previous build's source. It was deleted
2026-08-20 but is worth retrieving before building Instagram — `instagram.ts`
there is the comment/DM ingest this build has not written yet.

## Non-negotiables

- **Never invent schema.** Column names come from `schema.prisma`. If something
  is missing, stop and ask — do not add a field.
- **No JSON columns** except: `WaRawEvent.payload`, `IgRawEvent.payload`,
  `WaMessage.entities`, `AgentCache.value`, `AppleDbCache.models`,
  `Outbox.payload` (a send intent's shape varies by `OutboxKind`). Everything
  else gets a table.
- **No loose string links.** Every relation is a declared FK with an explicit
  `onDelete`.
- **Money is `BigInt` whole rupiah**, serialized as a JSON string. Never `number`,
  never `parseFloat`.
- **Every unit state change is a transaction** that writes the event and the
  projection together.
- **No network I/O inside a database transaction.** Write an `Outbox` row; the
  worker sends.
- `packages/domain` imports neither Prisma, Express nor React.

## Commands

- `pnpm dev` — all apps
- `pnpm -r test` — everything
- `pnpm -r typecheck` — types
- `pnpm --filter @nusantara/db migrate` — apply migrations
- `python3 tools/b2soft/extract.py "$HOME/Export Files" build/b2soft` then
  `APP_ENV=prod DATABASE_URL="$OWNER_URL" pnpm --filter @nusantara/db import:b2soft build/b2soft --master-only`
  — the B2Soft migration: read the export (no database), then import it.
  For master data from just the five master workbooks:
  `python3 tools/b2soft/extract.py "$HOME/Export Files" build/b2soft-masters --masters-only --salesmen ERSEN,RIRIN,HARDI,DINA`
  (docs/go-live.md phase 5).
  `--master-only` is the reference data alone (production, during the parallel
  operation); leave it off at cutover for the whole history
- `TEST_DATABASE_URL=… pnpm --filter @nusantara/db test` — the db suite. It is
  `TEST_DATABASE_URL`, not `DATABASE_URL`, and a database missing a migration
  fails 35 tests with errors that read like code bugs ("The column
  `Staff.defaultLocationId` does not exist").
- `pnpm --filter @nusantara/api accounts --owner ersen` — a login for every
  salesperson, on the initial password `password` with a forced change; Ersen
  the owner. `… staff --username <u> --name '<n>' --role OWNER --initial` does
  one account (or a password on stdin instead of `--initial`). The seed writes
  an unusable hash for every account, so one of these is the way into a fresh
  database. On the Mac mini: `sudo -u _nusantara /opt/nusantara/current/ops/run accounts|staff …`
- `pnpm --filter @nusantara/api knowledge docs/chatbot/knowledge-2026-09-18.md --by ersen`
  — load the owner's answer sheet into the chatbot (skips what is there)
- `git tag v2026.09.18.2 && git push origin v2026.09.18.2` — deploy that
  commit to the Mac mini (`docs/deploy-pipeline.md`). `v2026.09.18` itself is
  taken (a failed run at `f6f5f3c`). Rollback in seconds, on the Mac mini:
  `sudo /usr/local/libexec/nusantara-deploy rollback`
- `gh workflow run CI --ref <branch>` — deploy a branch to staging
  (`-f refresh_staging_data=true` for a fresh copy of the shop's data first);
  a push to `main` does it by itself (`docs/staging.md`)
- Ports: web 3000, api 4000, webhook 3001, wa-gateway 3002 (loopback), monitor
  4100; on the Mac mini,
  staging's api 4001 and Caddy 8081 beside the shop's 4000 and 8080
- Database: `nusantara_pos_rebuild` on `localhost:5432`, role `nusantara`
- Meta: App ID `2157052578394015`, WABA `1701973881546032`,
  `PHONE_NUMBER_ID` `1200651716467039`, Graph **v25.0** (one constant, both
  channels — never two env fallbacks)

## Gotchas that have already cost time

- `prisma migrate status` **lies** in this project — a recorded-but-unapplied
  migration reports clean while the table is missing. Verify with a real query.
- `nusantara_pos_app` is the **previous build's** database and is still live and
  being written to. Never migrate, reset or drop it — the rebuild targets
  `nusantara_pos_rebuild`, and the old one stays read-only for a quarter.
- Neighbouring projects squat on :3000 and :4000. A "missing route" is usually
  the wrong server answering. Probe the port before debugging the router.
- Never call a toast inside a React state updater or during render.
- `BigInt` does not survive `JSON.stringify` — serialize money as a string.
- In raw SQL, Prisma stores `DateTime` as `timestamp` **without** time zone
  (holding UTC) but binds a JS `Date` as `timestamptz`. A bare `::timestamp`
  cast renders it as Asia/Jakarta wall clock — a silent 7-hour shift. Write
  `(${d}::timestamptz AT TIME ZONE 'UTC')`; convert the parameter, never the
  column, so the index still applies.
- Fail-closed webhook tests must NOT read a developer `.env`. Inject config.
- Secrets live in `secrets/webhook-credentials.env` (gitignored, 600). Never
  print one, never commit one, never put one in a doc.
