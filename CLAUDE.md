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
- `printf '%s' '<password>' | pnpm --filter @nusantara/api staff --username <u> --name '<n>' --role OWNER`
  — create a staff login, or reset one. The seed writes an unusable hash for
  every account, so this is the only way into a fresh database. Password on
  stdin, never argv.
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
