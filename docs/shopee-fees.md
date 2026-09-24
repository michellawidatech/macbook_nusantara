# What a Shopee sale costs this shop

**Status 2026-09-21: reference, verified against sixteen orders.** Derived
from Shopee's own rate tables plus two `Rincian Pesanan` screenshots the owner
supplied, cross-checked against
`Order.completed.20260821_20260920.xlsx` (27 orders, 21 Aug – 20 Sep 2026) —
and then against what those orders actually paid, from the seller balance
report (see [What the balance report settled](#what-the-balance-report-settled-2026-09-21)).

Companion: [shopee-settlement-import.md](./shopee-settlement-import.md), which
is how these figures get into the POS. This document is only the arithmetic and
where each number comes from.

Sources, all read 2026-09-20:

| Article | What it gives |
|---|---|
| [16055](https://seller.shopee.co.id/edu/article/16055) | The five fee buckets, and where the income export lives |
| [3489](https://seller.shopee.co.id/edu/article/3489) | Rates per seller tier, caps, SPayLater XTRA tenors |
| [15965](https://seller.shopee.co.id/edu/article/15965) | Biaya Administrasi per product category |
| [7216](https://seller.shopee.co.id/edu/article/7216) | Gratis Ongkir XTRA per category and size band |

## The store's profile

Shopee's storefront needs a login, so this is derived from the export and the
rate tables rather than read off the shop page.

| | |
|---|---|
| Seller type | **Star+** — corroborated: 5,25% sits in the `STAR/STAR+` admin column |
| First upload | **before 1 Aug 2026**, so article 3489's older rate table applies |
| Category | **Komputer & Aksesoris → Laptop** = **Kategori A**, the cheapest band |
| Size band | Ukuran Biasa on 24 of 27 orders; three declared at exactly 5.000 gr |
| Programmes joined | Gratis Ongkir XTRA, Promo XTRA, SPayLater XTRA 0%, AMS affiliate, shipping insurance |
| Payment mix | SPayLater 17/27 (63%), Kartu Kredit/Debit 3, Online Payment 3, Cicilan KK 2, QRIS 2 |
| Own discounts | **none** — every seller-borne discount column is zero across all 27 rows |
| AOV | Rp10.290.556 |

## The formula

```
Total Penghasilan = Subtotal Pesanan + net ongkir − Σ fees
```

Net ongkir was **exactly zero** on both samples — the buyer's ongkir plus
Shopee's subsidy less what went to the courier (7.000 + 55.000 − 62.000, and
0 + 12.000 − 12.000). Shipping does not move the payout, so the POS can ignore
it. Every fee is PPN-inclusive: store the figure as stated, never gross it up.

The buckets stack additively — Shopee says so itself: Promo XTRA *"belum
termasuk Biaya Proses Pesanan, Biaya Administrasi Star/Star+, dan Biaya Layanan
program lain."* Both samples sum to their stated payout to the rupiah, which is
the check that the model is complete.

## The rates

| Line | Rate | Basis |
|---|---|---|
| Biaya Administrasi | **5,25%** | Laptop, Star/Star+ (article 15965) |
| Biaya Proses Pesanan | **Rp1.250** | flat, per completed order |
| Promo XTRA | **min(4,5% × base, Rp60.000 × qty)** | base = Harga Asli less *seller-borne* discounts only |
| Premi (asuransi) | **0,5%** | observed on both samples; not published |
| Gratis Ongkir XTRA | published **1%** cap Rp40.000 · **observed 0,5%** | Kategori A, Ukuran Biasa |
| SPayLater XTRA 0% | **2,5%** (3 bln) / **4,0%** (6 bln) | on the **financed amount**, not the list price |
| Komisi AMS | ~1% + PPN | on price after Shopee's voucher; only when an affiliate sold it |

⚠️ **The admin fee is per product CATEGORY, not one shop rate.** Laptop,
Desktop, Monitor, Penyimpanan Data, Komponen and Printer are all 5,25%, but
**Aksesoris Desktop & Laptop — which includes Charger & Adaptor Laptop —
is 6,75%**, as are Keyboard & Mouse and Komponen Network. A single hard-coded
rate would silently mis-validate every accessory the shop ever lists.

⚠️ **The Promo XTRA cap always binds here.** Breakeven is Rp1.333.333 per unit
(60.000 ÷ 4,5%) and the cheapest unit across 27 orders is Rp3.300.000, so for
laptops it is a flat Rp60.000 × qty and the 4,5% never applies. It *would*
apply to accessories — a Rp500.000 charger pays Rp22.500 — so implement the
rule, do not hard-code the cap.

## Worked example: the second screenshot, line by line

Order `260913W27KJ6EP`, the variation named `splitayment` — a listing set up
for 0% instalments, which is what the SPayLater line is paying for.

```
Subtotal                                    7.700.000
  Biaya Administrasi  5,25% × 7.700.000      −404.250
  Biaya Proses Pesanan                         −1.250
  Gratis Ongkir XTRA  0,5%                    −38.500
  Promo XTRA          min(4,5%, 60k)          −60.000
  SPayLater XTRA 0%   2,5% × 7.315.000       −182.875   ← 3-month tenor, on the financed amount
  Komisi AMS                                  −81.197
  Premi               0,5%                    −38.500
                                            ──────────
  Total Penghasilan                          6.893.428   ✓ as stated
```

The financed amount is the subtotal less Shopee's own voucher
(7.700.000 − 385.000), because SPayLater finances what the buyer actually owes.
That base is what makes the line come out exact; 2,5% of the list price would
be Rp192.500 and the total would not reconcile.

The first screenshot (`2609166VUDCU4M`) has neither the SPayLater line nor the
affiliate commission, and reconciles the same way:
6.800.000 − 357.000 − 1.250 − 34.000 − 60.000 − 34.000 = **6.313.750**.

## The effective cost band

At the Rp10,3jt AOV:

| Scenario | Cost of the sale |
|---|---|
| Floor — no instalment, no affiliate | **6,85%** |
| + SPayLater 0%, 3 months | 9,35% |
| + SPayLater 0%, 6 months | 10,85% |
| Ceiling — 6 months + affiliate | **11,96%** |

**A Shopee sale costs between roughly 6,9% and 12,0%**, and which end it lands
at depends on facts no order export carries. That spread is the whole argument
for reading the payout rather than computing it — see the companion document.

## Two anomalies worth money

**1. The shop pays exactly half the published ongkir rate.** Kategori A Ukuran
Biasa is 1% capped at Rp40.000; both samples show 0,5% uncapped, three weeks
apart — Rp34.000 where the published rule says Rp40.000. It is in the shop's
favour so it is not urgent, but it is unexplained and it may have an end date.
Worth checking Pengelolaan Program Saya. Either way it is a standing reason to
read the fee rather than derive it.

**2. Three orders are declared at exactly 5.000 gr, and ≥5 kg is the expensive
band.** Ukuran Khusus is 2,5% capped Rp60.000 instead of 1% capped Rp40.000
(the band also trips on any side ≥60 cm or volume ≥20.000 cm³):

| Order | Unit | Declared |
|---|---|---|
| `260907D8P582R1` | MB Air 2017 13" | 5.000 gr |
| `260912SX04B006` | MB Air 2017 13" | 5.000 gr |
| `2609142KT5WTXR` | MB Air 2017 13" | 5.000 gr |

A boxed MacBook Air 13" is nowhere near 5 kg. Dropping the listing weight to
4.900 gr moves all three into Ukuran Biasa. At published rates that is
Rp20.000–24.000 per order; at the half-rate the shop actually pays, about half
that. Small per order, but free, permanent, and one edit per listing.

## What the balance report settled (2026-09-21)

The owner supplied `my_balance_transaction_report.shopee.20260901_20260921.xlsx`
(Saldo Penjual → Transaksi → Export): the ledger of the shop's Shopee balance,
where every order's payout is a row of its own. Joined by `No. Pesanan` to the
order export's `Subtotal Pesanan`, **16 orders** have both a price and what
they actually paid, and the five lines every order pays (admin, proses,
ongkir, Promo XTRA, premi) were run against each:

| Result | Orders |
|---|---|
| Reconciles to the rupiah with the five lines alone | `2609166VUDCU4M`, `2609069FJ48B50`, `260906B16P0CKC`, `260910NAWBP9DJ` |
| Leftover is exactly rate × 1,11 of the financed amount — an affiliate, with PPN | `260906ACX9TNU1` (1%), `2609153FVWW6NY`, `260913UCUQA1CN` (2%) |
| Leftover is exactly the Ukuran Khusus ongkir | `2609142KT5WTXR` (+42.000), `260907D8P582R1` (+36.250) |
| Both of the above | `260912SX04B006` (+42.000 ongkir, +74.326 = 2,22% × 3.348.000) |
| SPayLater 3 months + affiliate 1% | `260913W27KJ6EP` (the worked example — now exact) |
| Leftover is exactly the published ongkir, 1% capped Rp40.000 | `260825AEUJMHND` (+13.500) |
| Not explained by any published rate | `2609045WRHUPRV` (+859.267 on Rp27,5jt), `260830P5TWDBJH` (+202.666 on Rp4jt), `260907DD75SWQC` (+64.700 on Rp55jt, Cicilan Kartu Kredit) |
| A return, then courier compensation: −53.625 and Kompensasi Jasa Kirim +10.000.000 | `260912RGK2YKYU` |

What that settles:

- **Ukuran Khusus is real and costs Rp60.000.** Both clean 5.000 gr orders
  paid the 2,5% band at its Rp60.000 cap — the FULL published rate, not the
  half the shop pays on ordinary listings. Against the 0,5% a 4.900 gr listing
  would pay, that is **Rp36.000–42.000 per order** at these prices. The
  declared-weight fix in "Two anomalies worth money" is worth doing.
- **Komisi AMS is the affiliate's rate plus 11% PPN**, on the financed amount.
  Five sales fit exactly, two at 1% and three at 2% — so the rate is the campaign's, and
  `AMS_PCT` gained its PPN (`PPN_PCT`). The worked example above now
  reconciles to the rupiah with every line traced to a rate.
- **The half-rate on Gratis Ongkir XTRA is recent.** The one late-August order
  paid the published 1% capped Rp40.000; every September order paid 0,5%.
- **Premi at 0,5%** is inside every order that reconciles — 12 of the 16.

Three orders keep a remainder no published rate explains, and that is the
case the upload names **Biaya Lainnya** rather than guesses at
(`OTHER_FEES_LABEL`). The rest of the balance report — 21 ad top-ups
(Rp111.000 each) and 5 withdrawals to the bank — belongs to no order and is
not a payout.

## What is still unconfirmed

- **The half-rate on Gratis Ongkir XTRA** — the cause, and whether it ends.
- **The three unexplained remainders** above. A Rincian Penghasilan for the
  same period would name them.
