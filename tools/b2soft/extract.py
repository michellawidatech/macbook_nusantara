#!/usr/bin/env python3
"""
Turn a B2Soft export into import changesets for the store.

    python3 tools/b2soft/extract.py "$HOME/Export Files" build/b2soft

Reads the report workbooks, replays the history (b2soft/ledger.py), and writes:

    chunks/NNN-<label>.json   one commit each: the reference lists, then a month at a time
    manifest.json             the chunk list and the cutoff
    audit.xlsx, audit.md      the figures to sign against B2Soft, and every flag

Nothing here touches a database. Load the result with

    pnpm --filter @nusantara/db import:b2soft build/b2soft

Needs Python 3.10+ and openpyxl.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from b2soft import audit, catalogue, documents, emit, ledger, masters, reports as R  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="the folder holding the B2Soft .xlsx exports")
    ap.add_argument("out", help="where to write chunks/, manifest.json and the audit")
    ap.add_argument("--balances-only", action="store_true",
                    help="master data plus what is owed, as opening balances, and no history at all "
                         "(owner ask 2026-09-21). One chunk. See b2soft/emit.py balances_only().")
    ap.add_argument("--masters-only", action="store_true",
                    help="read ONLY the five master workbooks (products, warehouses, customers, suppliers, "
                         "salesmen) and write the reference chunk: no history, no stock, no prices, no balances "
                         "(owner ask 2026-09-29). See b2soft/masters.py.")
    ap.add_argument("--salesmen", default="",
                    help="with --masters-only: comma-separated names to import, e.g. ERSEN,RIRIN,HARDI,DINA")
    args = ap.parse_args()
    src, out = Path(args.source).expanduser(), Path(args.out)
    if args.masters_only:
        return masters_only(src, out, [n for n in args.salesmen.split(",") if n.strip()])

    si = R.detail(src / "Laporan Penjualan Detail.xlsx", "SI")
    pi = R.detail(src / "Laporan Pembelian Detil.xlsx", "PI")
    buys, sells = R.serials(src / "IMEI Pembelian.xlsx"), R.serials(src / "Daftar IMEI Penjualan.xlsx")
    srs, prs = R.returns(src / "Laporan Retur Penjualan.xlsx", "SR"), R.returns(src / "Laporan Retur Pembelian.xlsx", "PR")
    products, stock = R.products(src / "Master Data Tanpa Gudang.xlsx"), R.stock(src / "Persediaan Barang.xlsx")
    suppliers, customers = R.parties(src / "Master Supplier with Credit.xlsx"), R.parties(src / "Master Pelanggan.xlsx")

    cat = catalogue.build(products)
    L = ledger.replay(pi, si, buys, sells, srs, prs, products, stock, set(cat.skus))
    for name in cat.unparsed_macs:
        L.flag("Nama Mac tidak terbaca", name, "dibuat sebagai satu model tanpa varian")
    docs = documents.build(si, pi, R.sales_summary(src / "Laporan Penjualan.xlsx"), R.purchase_refs(src / "Laporan Pembelian.xlsx"),
                           suppliers, customers, R.warehouses(src / "Master Gudang.xlsx"), R.salesmen(src / "Salesman List.xlsx"), cat, L)
    piutang = R.open_items(src / "Laporan Piutang Dagang.xlsx", "SI")
    hutang = R.open_items(src / "Laporan Hutang Dagang.xlsx", "PI")
    if args.balances_only:
        parts, balances = emit.balances_only(docs, L, piutang, hutang)
    else:
        parts = emit.chunks(docs, L)

    folder = out / "chunks"
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("*.json"):
        old.unlink()
    manifest = dict(source=str(src), generatedAt=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    cutoff=ledger.iso(L.cutoff), staffName=emit.STAFF, chunks=[])
    for i, part in enumerate(parts):
        name = f"{i:03d}-{part['label']}.json"
        (folder / name).write_text(json.dumps(part, ensure_ascii=False, separators=(",", ":")))
        manifest["chunks"].append(dict(file=f"chunks/{name}", label=part["label"], probe=part["probe"],
                                       rows={k: len(v["rows"]) for k, v in part["changes"]["collections"].items()}))
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    report_piutang = sum(v for _, v in piutang.values())
    report_hutang = sum(v for _, v in hutang.values())
    if args.balances_only:
        # No audit workbook: there is nothing to reconcile. What was written is
        # the two aged reports, so the check is that every rupiah in them found
        # a party — and a shortfall means a name in the report that matches no
        # customer or supplier, which is the one failure worth stopping for.
        print(f"1 chunk → {folder}  (master data and balances only, no history)")
        print(f"  {'Piutang ditempatkan':40s} {balances['receivable']:>16,}")
        print(f"  {'Laporan Piutang Dagang B2Soft':40s} {report_piutang:>16,}")
        print(f"  {'Utang ditempatkan':40s} {balances['payable']:>16,}")
        print(f"  {'Laporan Hutang Dagang B2Soft':40s} {report_hutang:>16,}")
        # Named rather than summed. A shortfall is always one of two things —
        # an internal pseudo-account, or a party the master list is missing —
        # and only the name says which, so the name is what is printed.
        if balances["unplaced"]:
            print("\n  NOT imported, no such customer or supplier in the master list:")
            for name, owed in sorted(balances["unplaced"].items(), key=lambda kv: -kv[1]):
                print(f"    {name:38s} {owed:>16,}")
        return 0

    report = audit.write(out / "audit.xlsx", out / "audit.md", docs=docs, L=L, stock=stock, customers=customers,
                         suppliers=suppliers, report_piutang=report_piutang, report_hutang=report_hutang)
    print(f"{len(parts)} chunks → {folder}")
    for k, v in report["figures"].items():
        print(f"  {k:40s} {v:>16,}")
    print("flags:", ", ".join(f"{t} {n}" for t, n in sorted(report["topics"].items(), key=lambda x: -x[1])))
    return 0


def masters_only(src: Path, out: Path, salesmen: list[str]) -> int:
    if not salesmen:
        print("--masters-only needs --salesmen NAME,NAME,…", file=sys.stderr)
        return 2
    now = datetime.now(timezone.utc)
    chunk, notes = masters.build(src, salesmen, now.strftime("%Y-%m-%dT%H:%M:%S.000Z"))
    folder = out / "chunks"
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("*.json"):
        old.unlink()
    name = "000-reference.json"
    (folder / name).write_text(json.dumps(chunk, ensure_ascii=False, separators=(",", ":")))
    rows = {k: len(v["rows"]) for k, v in chunk["changes"]["collections"].items()}
    manifest = dict(source=str(src), generatedAt=now.isoformat(timespec="seconds"),
                    cutoff=now.strftime("%Y-%m-%dT%H:%M:%S.000Z"), staffName=emit.STAFF,
                    chunks=[dict(file=f"chunks/{name}", label="reference", probe=chunk["probe"], rows=rows)])
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    (out / "masters-audit.txt").write_text("".join(f"{line}\n" for line in notes))
    print(f"wrote {out / 'manifest.json'}: " + ", ".join(f"{k} {n}" for k, n in rows.items()))
    print(f"{len(notes)} notes in {out / 'masters-audit.txt'} — read them before importing")
    return 0


if __name__ == "__main__":
    sys.exit(main())
