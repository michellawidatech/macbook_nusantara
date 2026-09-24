# Importing Shopee's payout into Receivables

**Status 2026-09-21: built** — *Upload a Shopee report* on Pending Payment
(`routes/finance/ShopeeSettlementImport.tsx`). Owner ask: *"the goal is to
upload this file and match it with the pending payment in the POS and to auto
calculate the amount that they get."* The file that does it turned out to be
neither of the two below but a third — see
[The seller balance report](#the-seller-balance-report-2026-09-21).

The file supplied with that ask was
`Order.completed.20260821_20260920.xlsx`. **It is the wrong export and cannot
do this job.** This document is why, what the right one is, and how it maps
onto tables that already exist.

The arithmetic behind every figure here is in
[shopee-fees.md](./shopee-fees.md).

## The wrong file

`Order.completed.*.xlsx` comes from **Pesanan → Export**. It has 49 columns and
**not one of them is a fee**. No `Biaya Administrasi`, no `Biaya Layanan`, no
`Premi` — none of the lines that appear on Shopee's own order detail screen.

Its only seller-facing money column is `Total Pembayaran`, and that is the
**buyer's bill**: subtotal, less Shopee's voucher subsidy, plus the buyer's
ongkir, plus a buyer-side handling fee of about Rp4.000 that never reaches the
shop.

Both orders the owner screenshotted are in the file, which makes the gap
measurable:

| Order | Subtotal | `Total Pembayaran` | Shopee actually paid | Error |
|---|---:|---:|---:|---:|
| `2609166VUDCU4M` | 6.800.000 | 6.267.000 | **6.313.750** | −46.750 |
| `260913W27KJ6EP` | 7.700.000 | 7.319.000 | **6.893.428** | **+425.572** |

**The error runs in both directions**, so no correction factor and no fixed
percentage rescues this file. It lands near the true payout only because
Shopee's voucher subsidy happens to be about the size of the fee load — which
is the most dangerous kind of wrong, because it looks plausible on a
spreadsheet.

## Why the payout cannot be computed either

Knowing every published rate is not enough. Of the seven fee lines, two are
conditional on facts the order export does not carry:

- **SPayLater XTRA 0%** (2,5% or 4,0%) applies only if the listing offers 0%
  instalments *and* the buyer takes them.
- **Komisi AMS** applies only if an affiliate made the sale.

The decisive evidence: **both sampled orders read `Metode Pembayaran:
SPayLater`, yet only one carries the extra Rp182.875.** The payment-method
column cannot distinguish a plain SPayLater sale from a 0%-instalment one. The
effective cost of a sale therefore ranges from about **6,9% to 12,0%** with
nothing in the export to say where a given order sits.

This is the same conclusion the owner reached on 2026-09-20 — *"the payment
pending is not always deducted as 10%, the user should be the one adding the
deduction"* — and the import is consistent with that rule so long as it
**reads Shopee's stated figures rather than guessing them**. An income report
is not a guess; it is Shopee's own statement of what it paid.

## The right file

**Seller Centre → Penghasilan Saya → choose the period → Export → Rincian
Penghasilan.** Article 16055's own closing section says exactly this. It lists
released orders with their fee lines and their `Total Penghasilan`.

It also solves two problems the order export creates:

- **Six of the 27 orders are still inside the buyer's return window**
  (`260913W27KJ6EP`, `260912SX04B006`, `2609069FJ48B50`, `2609142KT5WTXR`,
  `2609153FVWW6NY`, `2609166VUDCU4M`). Shopee has not released that money.
  Importing them as received would be wrong. The income report lists only
  released orders.
- **One order is a return** (`260912RGK2YKYU`, `Returned quantity` 1,
  `Total Pembayaran` 0, *Permintaan Disetujui*). That belongs on the returns
  and credit path from the 2026-09-19 brief, not on a settlement.

## The code that already exists

`apps/web/src/lib/xlsxRead.ts` and `apps/web/src/lib/shopeeIncome.ts` survive
the 2026-09-20 receivables rework, which deleted only `ShopeeIncomeImport.tsx`.
Their docblocks say they were written with no sample file to hand. Both were
run against a real Shopee workbook on 2026-09-20 and **they hold up**:

- Shopee's file puts its only sheet at `xl/worksheets/sheet2.xml`, reached by
  an **absolute** rel target (`/xl/worksheets/sheet2.xml`), and ships **no**
  `sharedStrings.xml`. `readXlsx` resolves it — it goes through the package
  relationships rather than guessing `sheet1.xml`, exactly as its docblock
  claims. 28 rows, sheet named `orders`.
- Every money cell is **text** with Indonesian thousands dots.
  `parseAmount("9.680.000")` → `9680000`. Correct.
- `detectIncomeLayout` on the wrong file **fails safe**: it finds `No. Pesanan`
  but returns `payoutScore: 0`, `payout: undefined`, `sure: false`. It refuses
  to guess a payout column.

⚠️ **One live foot-gun.** Because `sure: false` reveals the manual column
pickers, a person can hand-pick `Total Pembayaran` and the importer will parse
27 lines happily with wrong figures. Confirmed by running it.
`PAYOUT_HEADERS` has no pattern for `pembayaran`, so the fix is a **rejection**
rule that recognises the order export by its columns — not another payout
pattern, which would make the foot-gun automatic instead of manual.

## The mapping

The join key already exists. Shopee's `No. Pesanan` (`2609166VUDCU4M`) is what
`Payment.ref` holds, required for marketplace sales since 2026-09-19. The match
is 1:1 and needs no new column.

The target tables exist too — **no migration required**:

```
Settlement      { paymentId, orderId, channel, gross, received, reason, at, staffId }
SettlementFee   { kind, label, amount, sortOrder, removedAt }
SettlementLog   { action, beforeReceived, afterReceived, … }   append-only
```

`SettlementFeeKind` is `COMMISSION | SERVICE | TRANSFER | PROMOTION | OTHER`,
which carries Shopee's five buckets with the sub-line's own name in `label`:

| Shopee bucket | `kind` | `label` |
|---|---|---|
| Biaya Administrasi | `COMMISSION` | "Biaya Administrasi" |
| Biaya Proses Pesanan | `SERVICE` | "Biaya Proses Pesanan" |
| Biaya Gratis Ongkir XTRA | `SERVICE` | "Biaya Gratis Ongkir XTRA" |
| Biaya Layanan (each sub-line) | `SERVICE` | the sub-line's own name |
| Biaya Promosi | `PROMOTION` | "Komisi AMS", etc. |
| Biaya Lainnya | `OTHER` | "Premi" |

This lands exactly on the 2026-09-20 decision — *a deduction is free text and
it DRIVES what landed*. `label` is the free text and
`received = gross − Σ deductions` is already how the dialog computes. The
import fills in the table a person would otherwise type, and the existing
`SettlementLog` records that it did.

## Rates as a validator, not a calculator

The published rates in [shopee-fees.md](./shopee-fees.md) earn their keep
*after* the import, checking each row and flagging what does not fit:

- an admin line at 6,75% where 5,25% was expected → an accessory booked as a
  laptop, or the reverse
- no Promo XTRA line → the programme lapsed
- an ongkir line at the full 1% → the unexplained half-rate has ended
- a Gratis Ongkir XTRA line at 2,5% → the unit was charged as Ukuran Khusus,
  which is the 5 kg declared-weight problem

That catches a mis-mapped column instead of silently posting it, which is the
failure mode the order export would have produced.

## Before building

One **Rincian Penghasilan** export for the same period is still needed. Its
column names are the one thing that would otherwise be guessed, and guessing
them is how the importer ends up with the same class of bug as the file this
document is about.

With it: pin `PAYOUT_HEADERS` to the real headings, add the order-export
rejection rule, map the fee columns onto `SettlementFee`, and settle the four
open questions listed at the end of shopee-fees.md.

## The seller balance report (2026-09-21)

**Seller Centre → Saldo Penjual → Transaksi → Export** gives
`my_balance_transaction_report.shopee.<from>_<to>.xlsx`, and it is the file the
owner actually uses: *"the purpose of this file is to see what they actually
receive."* It is the ledger of the shop's Shopee balance, one row per
movement, with the table under a title block and a summary on row 18:

| Column | Holds |
|---|---|
| Tanggal Transaksi | when the money moved |
| Tipe Transaksi | Penghasilan dari Pesanan · Penyesuaian · Pembayaran dengan Saldo Penjual · Penarikan Dana |
| Deskripsi | "Penghasilan dari Pesanan #…", "Kompensasi Jasa Kirim", "Isi Ulang Saldo Iklan/Koin Penjual" |
| No. Pesanan | the order number — or `-` for a row about no order |
| Jenis Transaksi | Transaksi Masuk / Transaksi Keluar |
| **Jumlah** | the signed amount, a number cell ("5240002.00") — **the payout** |
| Status | Transaksi Selesai |
| Saldo Akhir | the running balance — ⚠️ never a payout |

**An order's payout is the sum of its rows' `Jumlah`.** Almost always that is
one "Penghasilan dari Pesanan" row, and it is exactly what the income report
would call `Total Penghasilan`. The one exception in the first file is a return
the courier compensated (`260912RGK2YKYU`): the order paid −53.625 and a
Kompensasi Jasa Kirim paid Rp10.000.000, netting 9.946.375.

What the upload does with it (`lib/shopeeIncome.ts`, `payoutRows`):

- **Recognises it by its columns** (`BALANCE_HEADERS`): an order number and
  `Jumlah` together with `Saldo Akhir` or `Tipe Transaksi`. `Jumlah` alone is
  never money — in the order export it is the QUANTITY.
- **Received is Shopee's figure.** The deduction is broken down by the
  published rates for the sale's category (shopee-fees.md), and whatever they
  do not explain is added as **Biaya Lainnya** — or, when Shopee paid more than
  they leave room for, **Pembayaran Tambahan**, a line below zero. Owner:
  *"if there is discrepancies that are not mentioned in the rule just add like
  Biaya lainnya / additional payment."* The lines always close on the payout,
  because the deductions dialog computes what landed from them.
- **Leaves for a person, unticked:** an order with more than one plain payout
  row, and a payout above the rates (usually a sale recorded below its Shopee
  price). An order that netted nothing or less is a refund or a return and
  cannot be recorded here at all.
- **Records none of the rest**, and says what it was: ad top-ups paid out of the
  balance and withdrawals to the bank. A row whose Status is not finished is
  left out and counted.

⚠️ Two things the balance report shows that the POS does not yet record:
**ad top-ups** paid out of the Shopee balance (Rp111.000 a day in September —
an expense this upload does not record), and **withdrawals** — the POS counts a payout as in
the bank when it is received, although it sits in the Shopee balance until the
next Penarikan Dana. Both are owner decisions, not import bugs.
