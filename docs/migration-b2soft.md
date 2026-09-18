# Migrating the shop's B2Soft data

The shop's previous system is B2Soft (MS SQL Server). On 2026-09-10..13 it
exported 22 report workbooks and 6 stock PDFs to `~/Export Files/`. The owner
answered the migration questions on 2026-09-13, and `tools/b2soft/` now turns
an export into PostgreSQL rows through the store's own commit.

**Status 2026-09-13: built and rehearsed on `nusantara_store_dev` (§6).** The
export is TEST data. Production gets a fresh export, re-extracted and re-read
against the audit before it is imported; nothing below is hand-patched.

## 1. Running it

```bash
python3 tools/b2soft/extract.py "$HOME/Export Files" build/b2soft
APP_ENV=prod DATABASE_URL="$OWNER_URL" pnpm --filter @nusantara/db import:b2soft build/b2soft --master-only
```

The first command reads spreadsheets and touches no database; it writes monthly
changesets, `manifest.json`, `audit.xlsx` and `audit.md`. The second commits
them oldest first, skips what is already there, moves this month's SI/PI
numbering past the migrated codes, starts the Income & Expense balance at the
cutoff, and runs reconcile(). `tools/b2soft/README.md` explains the modules.

`APP_ENV` must name the database's environment: `resolveDatabaseUrl` refuses
`nusantara_pos_prod` under the default `dev`. `$OWNER_URL` reaches the Mac
mini's PostgreSQL through an ssh tunnel (`ssh -N -L 55432:127.0.0.1:5432
<admin>@<mini>`, then port 55432) — NOT `127.0.0.1:5432`, which on the laptop
is the laptop's own PostgreSQL.

**`--master-only` is what production gets while the shop runs B2Soft and this
app in parallel (owner, 2026-09-18):** the reference chunk alone — catalogue,
warehouses, suppliers, customers, salespeople — with no stock, no sales, no
purchases and no opening balances, because B2Soft stays the book of record
until the cutover. Without the flag the import brings the whole history, which
is what the cutover itself will want. After it, the logins and the chatbot's
answers are two more commands (docs/deploy-macmini.md §6):

```bash
sudo -u _nusantara /opt/nusantara/current/ops/run accounts --owner ersen
sudo -u _nusantara /opt/nusantara/current/ops/run knowledge /tmp/knowledge-2026-09-18.md --by ersen
```

## 2. What was exported

| file | used for |
|---|---|
| `Laporan Penjualan Detail` / `Laporan Pembelian Detil` | every invoice with its lines, Total Faktur, Total Bayar, Status and J. Tempo |
| `Laporan Penjualan` / `Laporan Pembelian` | the salesman and marketplace order number per sale; the supplier's invoice number |
| `IMEI Pembelian` / `Daftar IMEI Penjualan` | the serial ledger: each serial against the invoice it came in and went out on |
| `Laporan Retur Penjualan` / `Laporan Retur Pembelian` | returns, by product (no serials) |
| `Master Supplier with Credit` / `Master Pelanggan` / `Salesman List` / `Master Gudang` | the parties, their balances, the four warehouses |
| `Master Data Tanpa Gudang` | 371 products with group and barcode |
| `Persediaan Barang` | stock per product per warehouse on 2026-09-10 — the stock the migration lands |
| `Laporan Hutang Dagang` / `Laporan Piutang Dagang` | cross-checks in the audit |
| `Transaction history`, `Mutasi Persediaan`, `Master Data`, `Persediaan Barang Tanpa Harga`, `SKU & Porduct Grouping`, the PDFs | not read: duplicates, or snapshots the audit does not need |

Every reader checks the header it expects, so a different report under the same
name stops the extract instead of being misread.

## 3. The owner's decisions (2026-09-13)

| question | answer | what the tool does |
|---|---|---|
| Warehouse kinds | do not matter; 04 is returns & QC | 02 Kemang Sales is `TOKO`, the rest `GUDANG`; machines in 04 are in `QC` and their invoices stay open for grading |
| Sales channels | add Tokopedia, TikTok, Lainnya | `Platform` + `TOKOPEDIA`, `TIKTOK`, `LAINNYA`; Facebook, OLX, Carousell, Threads, Akulaku and Google Maps are `LAINNYA`; USER is a walk-in |
| Customer phones | none exist; staff fill them later | `Customer.phone` nullable, optional in the form |
| Salespeople | all still work there | 15 active `Salesperson` rows; every sale credits its B2Soft salesman |
| Which receivable | combine all | every open invoice, plus the customer's B2Soft balance above it as `Customer.openingBalance` |
| Marketplace money | pending vs due | open Shopee/Tokopedia/TikTok/Akulaku sales are `PENDING`; everyone else `DUE` at J. Tempo |
| Supplier balances | trust the payables report; the extra is investor money still owed | the balance above the open invoices is `Supplier.openingBalance` |
| Returns without serials | infer | an SR line takes the serial sold to that customer just before it; a serial sold twice with nothing between gets a return one second before the resale |
| The five non-Apple serials in stock | delete | not migrated; their purchase lines keep the money with no machine |
| Accessories | pseudo-serials | `AKS-<barcode>-<nnnn>`, first in first out, history included |
| Where machines are | Persediaan per gudang | stock per product per warehouse equals that report; serials it does not count are written off with a note |
| Prices | most recent sale | `Sku.price` = the product's last sale price |
| PEMAKAIAN TOKO | a correction | `KOREKSI_KELUAR`, never an order |
| Grades | not needed | none recorded |
| Trash | remove | zero-value invoices, `KOLI`, `JASA SERVICE` as a product (its lines are order fees) |

Serials are stored as `S` + Apple's serial — the string a scan of the barcode
produces — and the bare serial typed at the counter still finds the machine
(`resolveSerialQuery`). Historical payments carry the inactive `B2SOFT` method,
because B2Soft never recorded cash versus transfer.

## 4. What the test export becomes

| figure | value |
|---|---|
| purchase invoices / sales / returns | 885 / 3,550 / 94 |
| customers / suppliers / salespeople | 38 / 64 / 15 |
| models / variants | 159 / 369 |
| serialised units / accessory units / events | 4,328 / 4,572 / 26,851 |
| stock: Persediaan / migrated | 534 / 527 (66 in QC) |
| receivables: pending + due + opening | Rp421 754 164 + Rp1 162 550 416 + Rp211 445 420 = **Rp1 795 750 000** |
| payables: open invoices + opening | Rp6 888 565 743 + Rp222 190 000 = **Rp7 110 755 743** |

Against B2Soft:

- **Receivables.** Master Pelanggan totals Rp1 777 053 665. The
  Rp18 696 346 difference is five marketplace accounts whose open invoices
  exceed their master balance (SHOPEE NUSANTARA, both Tokopedia accounts,
  TikTok, Akulaku). They stay `PENDING` at the invoice figure. The remaining
  11 rupiah is PEMAKAIAN TOKO.
- **Payables.** Master Supplier totals Rp7 102 448 694. The
  difference is ATIO JKT (open invoices Rp16 800 000, master Rp9 200 001),
  APPLEFIX Rp704 250 and SNC Rp300 that the master had cleared, and GEO
  COMPUTER's Rp2 500 overpayment.
- **Stock.** 7 counted units have no machine: the five deleted serials, one
  PRO 15" 2016 I7 16/256 in warehouse 01 and one PRO 15" 2019 I9 16/512 in 02.

## 5. What the shop should check

Every row is on the audit's **Catatan** sheet.

- **138 serialised machines and 15 accessory units written off** at the cutoff
  because Persediaan does not count them — B2Soft recorded no document for
  their leaving. The oldest purchases went first. A Stock Opname finds any
  that are still on a shelf, and *Add to inventory* brings them back.
- **134 serials with an inferred return** — sold again with no return
  document between.
- **29 purchases typed after the sale** of their machine; the arrival is dated
  just before the sale.
- **21 historical serials that are not serials** (`YOUNGER001`, `REFUND001`,
  `AJUST1` and the like) — all sold long ago, kept for the invoices.
- **3 serials sold with no purchase**, **13 accessory units sold with none**,
  **7 machines bought back as a different product** (an upgrade), and one
  each of: a customer return with no matching sale (SR-2025/02-000003), a
  machine sold while B2Soft had it in stock, a machine bought twice without a
  sale.
- **No service bench.** No warehouse has kind `SERVIS`, so sending a machine to
  service keeps it where it is until one is added in Settings.
- Nine sales carry a customer name and phone in B2Soft's note field. Per the
  owner's answer nothing was copied; the audit keeps the invoice numbers.

## 6. Rehearsal, 2026-09-13

The test export into `nusantara_store_dev` (23 migrations, no rows):

| step | result |
|---|---|
| extract | 5 s — 42 chunks, 14 MB |
| import | 95 s, the largest month (2023-05, the opening stock) 7.6 s |
| reconcile() | 8 of 8 checks clean |
| SQL against the audit | sales Rp33 552 310 062 · purchases Rp28 488 628 690 · PENDING Rp421 754 164 · DUE Rp1 162 550 416 · customer openings Rp211 445 420 · supplier openings Rp222 190 000 · open payables Rp6 888 565 743 — each equal to `audit.xlsx` |
| stock | wh-01 65 · wh-02 213 · wh-03 183 · wh-04 66, all in QC |
| ledger | no unit whose status differs from its last event; no machine on two open receipts |
| numbering | `doccode_si_2026_09` at 30, `doccode_pi_2026_09` at 4 |
| a till's first load | `snapshotStore` 2.6–2.9 s on the laptop; 11.1 MB of JSON, 0.7 MB after Caddy's gzip; decoded by the browser schemas in under 0.1 s |
| running it again | every chunk skipped in 1 s, reconcile re-run |

The rehearsal changed two things in the app, both of which were wrong for live
use too:

- reconcile's `UNIT_YATIM` counted only `DITERIMA` as an arrival.
  `OPNAME_DITEMUKAN` — the stock take's *Add to inventory* — is the other
  genesis arrow, and the 17 migrated units that were sold or counted with no
  purchase invoice arrive that way.
- A customer return now closes only the receipts dated before it
  (`docs/store-on-postgres.md`), because a month's commit carries a return
  and the resale after it together.

## 7. Where the code is

`tools/b2soft/` (Python, reads the export), `packages/db/src/import-b2soft-cli.ts`
(the import), `packages/db/src/store/` (the commit it goes through). The
parsed intermediates of the first inspection lived in a session scratchpad and
are gone; the readers in `tools/b2soft/b2soft/reports.py` replace them.
