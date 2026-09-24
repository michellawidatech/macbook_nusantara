# Assumptions, 2026-09-21

Everything below is a judgement call I made overnight where the brief left room
for more than one reading. Each says what I chose, why, and what to change if
the answer is different. Correct any of them and the change is small — they are
each in one place.

---

## 1. Inbound step 1 — payment method

**Chosen.** `PaymentMethod.forPo` is now true for `TUNAI` and `TRANSFER` only.
The dropdown was already "every `forPo` method", so it now offers exactly Cash
and Bank transfer without the list being hard-coded in the page.

**Why not literally hard-code two strings.** Settings can add a payment method,
and three other screens read the same flag (the supplier deposit dialog, the
invoice expense dialog, the payment editor). Hard-coding the till's copy of the
list would have made those three disagree with this one.

**Consequence.** The supplier deposit dialog and the invoice expense dialog also
stop offering Marketplace escrow. That looked right — a deposit is money the
shop moved — but it is a change beyond Inbound, so it is worth a look.

`MARKETPLACE` is untouched as a SALE method; it is still what a Shopee or
Tokopedia sale is written with.

---

## 2. New Transaction — the Actual paid column

**Chosen, two parts.**

- Shopee and Tokopedia rows show the amount as text with "paid in full" beside
  it, and no input. Cash and Transfer keep theirs.
- The Cash/Transfer box starts **empty**, with the split amount as a grey
  placeholder. **Empty still means "the whole split was paid"** — which is what
  the field has always meant when nothing was typed into it.

**The judgement.** "Blank instead of prefilled" could have meant "blank means
zero paid", i.e. every sale starts as a debt. I read it as a complaint about
having to select and delete a number before typing, not as a change to what a
sale records — a cash sale defaulting to "nothing paid" would put a piutang on
every walk-in.

**If that is wrong** the change is one line in `tillRows`
(`apps/web/src/lib/tillPayments.ts`): treat an absent `paid` as `0`.

---

## 3. Barcodes

**Chosen, three parts.**

- **A scanned `I` becomes `1` and a scanned `O` becomes `0`**, everywhere a
  barcode is read. It is no longer a refusal. Applied to SCANS only: a person
  reading the case is the one witness who could legitimately key either.
- **Apple's shape — `S` + 10–12 — is enforced on a NEW unit only.** A row that
  is not graded New (which is nearly every row) may carry a serial of any
  length.
- **The marker (`S`) is still required on a SCAN, whatever the condition.** It
  is what tells the serial's barcode from the regulatory code and the part
  number printed beside it on the underside of a Mac; that does not depend on
  how worn the label is. A TYPED bare serial still gets the `S` added when it
  is 10–12 characters, and is otherwise left as typed.

**What is still refused on any unit:** an empty serial, anything that is not
capitals and digits, and a scan of 22+ characters (two scans with no Enter
between them — the one long read that really happens).

**The one I am least sure of.** The page-level scan — the one that arrives with
no row focused and drops into the next row waiting — cannot know the condition,
because nobody has said yet which machine it is about. I made it **lenient**,
on the grounds that an ungraded row is second-hand everywhere else in this app.
The alternative is to hold it strict and rely on the per-row box for messy
labels.

---

## 4. Payable & Receivable

**Chosen.** A new leaf under Financial & Report, `/finance/payable-receivable`,
with two tables.

- **Payable** is one row per SUPPLIER, expanding to the invoices behind it:
  supplier · transactions · amount. The owner's three columns are the row; the
  invoices are the expansion, because a flat table repeats the supplier's name
  down the page and gives "how much do we owe Apel Segar" no row of its own —
  which is the question somebody opens the page holding.
- **Receivable** is the same shape per CUSTOMER: name · transactions · amount.

**What counts as payable.** Every invoice with money outstanding, **including
closed ones** (closing was never a statement that an invoice was paid) and
**excluding drafts** (nobody has agreed to one). Plus each supplier's opening
balance.

**What counts as receivable.** What a PERSON has not paid. Money Shopee or
Tokopedia is holding is deliberately absent, per your instruction. Plus each
customer's opening balance.

**A bug I found while building it.** A sale written before the payment list
existed (2026-09-08) — which is every sale the B2Soft import brings over —
reads as one PENDING payment carrying the order's channel, so an unpaid
walk-in was filed as "a marketplace is holding this" and its debt came back
zero. `customerDebtOf` corrects that, the same way `holdsPendingMoney` corrects
it on the other screen. Without it this page would have reported nothing on the
day it is most needed.

**No buttons that move money.** Every row links to the screen that owns the
act. A fifth place to record a payment is a fifth place for the log to be
written differently.

---

## 5. The chatbot

**What was actually wrong.** `WaRawEvent` has **zero rows** — no delivery from
Meta has ever arrived. The webhook is running, healthy and correct; the
knowledge base has 31 answers; the worker is polling. There is simply no public
HTTPS address for Meta to POST to: the webhook is on `127.0.0.1:3001` and
`tailscale serve` publishes the POS over the **tailnet**, privately.

`docs/chatbot-runbook.md` is the fix. In short: `whatsapp-funnel up` publishes
`/webhook` and only `/webhook` on a public port, then Meta needs the URL, the
verify token, **and a subscription to the `messages` field** — a URL that
verifies with no subscription delivers nothing, for ever, with no error on
either side. `ops/run chatbot` walks the whole path and says which half is
broken.

**Chosen for the capability.** Everything you asked for is behind
`AGENT_CAPABILITIES=live`, and **it is off by default**. The reasoning: after
tomorrow's cutover the database has no units at all, so a bot reading the shelf
would tell every customer the shop has nothing. Set it once stock has been
taken in through Inbound & QC.

With it on: stock, price, a unit's grade and condition, the shop's own photos,
booking a hold, and picking something for a stated budget.

**Still to a person, capability or not:** negotiation and discounts (a discount
is yours to give, and a bot with the price in front of it is one message away
from giving one), payments already made, order status, trade-in and buy-back
quotes, shipping quotes, complaints and warranty, a photo the CUSTOMER sent,
and **cancelling a booking**.

**The one I read into your words.** *"The only write operation is to make a
reservation"* — so `create_reservation` is offered and `cancel_reservation` is
not. It still exists and still works; a customer asking to cancel goes to a
person, which is also where somebody can ask them why before the unit goes back
on the shelf.

**Photos** are sent by handle, never by URL: the model never sees an image, and
only handles it was actually given this turn are accepted. The bytes are
uploaded to Meta at send time. Three per answer, and only for a unit that is
still sellable — a sold machine's pictures are a record of what the shop
shipped, not a listing. It needs a migration (`WA_IMAGE` on `OutboxKind`),
which is additive.

**The voice** now asks what the machine is for, what they have now and roughly
what they want to spend; says why something fits; offers **one** step up; and
mentions an accessory once. What I did not bring back is the closing pressure
of the pre-2026-09-18 voice — "mau aku pegangin dulu?" on every machine reads
as a funnel, and your own approved answers do not sound like that.

---

## 6. Shopee upload

**Chosen.** *Upload a Shopee report* on the marketplace card. It takes either
export and says which it got:

- **Rincian Penghasilan** (Penghasilan Saya → Export) carries Shopee's own
  payout. That figure wins; the rates only say how the deduction breaks down,
  and anything they cannot explain becomes its own named line rather than being
  spread over the lines they can.
- **Order.completed.*.xlsx** carries no fee at all, so every figure is
  **estimated** from the published rates and the screen says so in a banner.
  Its `Total Pembayaran` column is refused as a payout — it is the buyer's
  bill, out by −46.750 on one of your sampled orders and +425.572 on the other.

**The rates are `docs/shopee-fees.md` made executable**, and the two worked
examples in that document are the tests.

**The two I have to ask about.** SPayLater XTRA and Komisi AMS depend on facts
no export states, and they are the difference between a sale costing 6,9% and
one costing 12,0%. They are switches on the dialog, **off by default**, rather
than guessed.

Every row lands in the existing `Settlement` shape, so the pencil on the
Receivables row opens the same deductions dialog a hand-typed withdrawal opens.

---

## 7. Deployment, cutover and the naming convention

### The cutover

`docs/cutover.md` is the ordered checklist. **I ran the whole extract-and-import
half of it against a throwaway database tonight**, on your real export:

| | |
|---|---|
| models / variants / categories / warehouses | 159 / 369 / 16 / 4 |
| suppliers / customers / salespeople | 64 / 38 / 15 |
| owed by customers | Rp1.560.030.931 across 9 |
| owed to suppliers | Rp6.887.861.193 across 10 |
| units, sales, purchase orders | **0** |

**Chosen: the balances are opening balances, not invoices.** Three years of
documents become two numbers per party, taken from B2Soft's **own aged
reports** rather than from a replay. That is what
`Customer.openingBalance` / `Supplier.openingBalance` were added for, and it is
the only reading of "only the master product and piutang & utang, please do not
create a long list of migration data from 2020" that produces the right totals.

The full-history import still exists and still works — same command without the
two new flags. It writes 4,328 units and 26,851 events. It is not what you
asked for.

**Rp11 is left behind**, on `PEMAKAIAN TOKO`, an internal pseudo-account in the
aged report that is in no customer list. The extractor names it rather than
absorbing it.

### The naming convention

`AIR 13" 2020 I5 8/256`, read off all 371 rows of `Master Data Tanpa
Gudang.xlsx`. Three rules: everything upper case; **an Apple-silicon machine
prints its CHIP where an Intel one prints its YEAR, and not both**; RAM and
storage are one part with GB implied and TB spelled.

275 of the 371 real names decompose and rebuild to themselves exactly. The
other 96 are accessories, spare parts and iPads, which follow no convention —
those keep their own words verbatim.

**Chosen.** `Sku.code` is now this instead of `SKU_17`, and the Add-product
form shows what a product's codes will read as while you type its name.

**What I did NOT change:** `productCode`, which is what goes on a printed
sticker. Its order and its lower-case `i5` are your own example from
2026-08-24, and labels are already on machines.

**One collision worth knowing about.** The 12" MacBook of 2016 shipped with an
Intel Core m3, written `M3` in the export exactly as an M3 Air is. Apple
silicon starts in 2020, so a pre-2020 `M3` keeps its year.

### Cleanup

Modest, deliberately: one genuinely dead module (`hooks/useFormSteps.ts`, 220
lines, no importers) and an empty `.turbo`. I did **not** delete
`build/macmini/` — it is what the Mac mini runs until tomorrow's CI release
replaces it.

---

## 8. Stock export

Excel, PDF, or both — a checkbox group, because "both" is one of the three
answers and a radio cannot say it. Excel is ticked to start with: it is what
the export was until today.

Same report either way. They answer different questions about one document: the
spreadsheet is for a bookkeeper who sorts a column and sums it; the PDF is for
a shelf, a supplier or a WhatsApp message, where what matters is that it looks
the same on every screen and cannot be edited on the way.

The PDF is written by hand (`lib/pdfWrite.ts`), the same answer
`lib/xlsxWrite.ts` and `lib/code128.ts` already give: pdfmake is ~1MB shipped
to every till for one button. I rendered one through macOS's own PDF engine to
check it opens.
