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
    `/chat/knowledge` redirects here.
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
  - Inventory expands **product → grade → serial**, and the price is a RANGE
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
  - ⚠️ Mock-only: `MockDb.deposits`, `Supplier.openingBalance`. Prisma's
    `Payment` has a nullable `poId` so a deposit is ALMOST expressible, but
    nothing records which supplier it was paid to, or an allocation.
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
    of labels. Supplier payments are still not in the balance at all; that
    predates this and is an owner decision.
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
  - **A battery reading is switchable per machine.** `defaultBatteryMode` picks
    the starting reading from the CHIP and the year — Apple silicon or 2021+
    starts on health — and the Segmented control in `BatteryFields` overrides
    it for one machine. `BatteryDraft.mode` carries the choice, so
    `batteryPatch` writes the right pair of columns without being told.
  - **The order form saves itself** (`lib/inboundDraft.ts`), and *Save draft*
    is on every step. The two are different nets and the difference matters:
    auto-save is `localStorage` on this device and nobody else can see it;
    a draft is a real `Po` with `status: "DRAFT"`, on the Inbound list.
  - **Accessories are counted, not tracked** — `Category.tracksSerial`
    (migration `20260915140000`), false for the Accessory category.
    `lib/serialTracking.ts` is the reading. A `Unit` row still exists per item
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
  - **The app has tabs** (`layouts/tabs.ts`, `layouts/AppTabs.tsx`). One tab
    per nav LEAF, so `/inbound/po-1` is the Inbound tab showing an order and
    never a second one. Every open tab stays MOUNTED — a half-built sale
    survives a glance at Inventory — capped at `MAX_TABS`, least-recently-used
    evicted. The ROUTER still owns the URL and this layer follows it, which is
    why browser back works and why no existing page had to be touched.
    ⚠️ Each panel renders inside `UNSAFE_LocationContext` and a reset
    `UNSAFE_RouteContext`, or a hidden page reads the ACTIVE tab's params.
    Resetting the route context is also what stops React Router warning about
    a descendant `<Routes>`. `src/pages.tsx` is the one table both `App.tsx`
    and `AppTabs` read; redirects stay in `App.tsx` and get no tab.
    ⚠️ `moveTab` is tested and dormant: nothing in this app navigates from an
    effect, so a hidden tab never navigates. It is the answer if one ever does.
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
- ⚠️ **The web suite needs room.** `apps/web` has 47 files of rendered React
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
- Ports: web 3000, api 4000, webhook 3001, monitor 4100
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
