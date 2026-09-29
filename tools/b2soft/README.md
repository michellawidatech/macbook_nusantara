# B2Soft → store import

Moves the shop's B2Soft history into PostgreSQL. Two steps, on purpose: the
first reads spreadsheets and touches no database, so it can be re-run on every
new export until the audit is signed; the second writes, once.

```bash
python3 tools/b2soft/extract.py "$HOME/Export Files" build/b2soft
APP_ENV=prod DATABASE_URL="$OWNER_URL" pnpm --filter @nusantara/db import:b2soft build/b2soft --master-only
```

`extract.py` needs Python 3.10+ and `openpyxl`. The import needs the OWNER
connection string, the one migrations run with, and `APP_ENV` naming the
database's environment. `--master-only` brings the reference data alone — no
stock, no history, no opening balances — which is what production takes while
B2Soft is still the shop's book of record (2026-09-18); leave it off for the
full history at cutover. `docs/migration-b2soft.md` has the findings, the
owner's decisions and the figures from the rehearsal.

## Master data from five workbooks only (2026-09-29)

```bash
python3 tools/b2soft/extract.py "$HOME/Export Files" build/b2soft-masters --masters-only --salesmen ERSEN,RIRIN,HARDI,DINA
APP_ENV=prod DATABASE_URL="$OWNER_URL" pnpm --filter @nusantara/db import:b2soft build/b2soft-masters --master-only
```

Reads `Master Data Tanpa Gudang`, `Master Gudang`, `Master Pelanggan`,
`Supplier List` and `Salesman List` and nothing else, and writes the reference
chunk plus `masters-audit.txt` (products left out, duplicates, missing
phones). `b2soft/masters.py` has the owner's rules; `docs/go-live.md` the
production run.

## What extract.py writes

| file                        | what                                                                             |
| --------------------------- | -------------------------------------------------------------------------------- |
| `chunks/000-reference.json` | warehouses, suppliers, customers, salespeople, the catalogue                     |
| `chunks/NNN-YYYY-MM.json`   | one month: purchase invoices, sales, returns, and every unit event of that month |
| `manifest.json`             | the chunk list, each chunk's probe row, the cutoff                               |
| `audit.xlsx`                | Ringkasan, Piutang, Faktur belum lunas, Hutang, Stok per gudang, Catatan         |
| `audit.md`                  | the summary figures and one example per flag                                     |

Each chunk is a changeset in the store's wire format — exactly what a till
sends to `POST /api/store/commit` — so the import is validated by the same
schemas and ledger checks as a sale at the counter.

## Reading order

| module                | job                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `b2soft/reports.py`   | one reader per workbook; each checks its header first and refuses an export it does not recognise |
| `b2soft/catalogue.py` | B2Soft product names → category, model, variant (Macs parsed into Chip/RAM/SSD axes)              |
| `b2soft/ledger.py`    | replays every serial's life from the documents, then places stock per `Persediaan Barang`         |
| `b2soft/documents.py` | suppliers, customers, invoices, sales, returns as wire rows; opening balances                     |
| `b2soft/emit.py`      | cuts it into monthly commits                                                                      |
| `b2soft/audit.py`     | the workbook the owner signs                                                                      |

## The rules the replay follows

Every one is an owner decision from 2026-09-13 and every exception is a row on
the audit's Catatan sheet.

- A serial is stored as `S` + Apple's serial, the string a scan produces; the
  bare serial typed at the counter still finds it. Anything else is kept verbatim.
- An accessory unit gets a pseudo-serial `AKS-<barcode>-<nnnn>`, first in first out — inside the
  replay only. Since 2026-09-19 the app counts accessories by quantity: products in the importer's
  accessory categories (`Aksesoris`, `Charger`, `Box`, `Sparepart` — `COUNTED_CATEGORIES` in
  `documents.py`) leave as `StockMove` rows, invoice and sale lines of a quantity, and no unit.
  Those categories are written with `tracksSerial: false`. A non-serialised product in any other
  category (an iPhone B2Soft never scanned) stays a pseudo-serial unit and is flagged.
- A serial sold twice with no return between gets an inferred customer return
  one second before the second sale.
- `PEMAKAIAN TOKO` invoices are corrections (`KOREKSI_KELUAR`), not sales.
- Stock at the cutoff is `Persediaan Barang` per warehouse. Warehouse 04 is
  returns & QC, so its machines are in QC and their invoices stay open.
- An open marketplace sale is PENDING, an open reseller sale DUE.
- A customer's or supplier's B2Soft balance above its open invoices becomes an
  opening balance.
- Historical payments carry the inactive `B2SOFT` method: B2Soft never recorded
  whether a payment was cash or transfer.

## Re-running

The extract is deterministic: the same export gives the same ids. The import
skips a chunk whose probe row exists, so a stopped import resumes. It refuses a
database holding sales it did not write, and `nusantara_pos_app` outright.
