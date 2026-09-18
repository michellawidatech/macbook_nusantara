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

from b2soft import audit, catalogue, documents, emit, ledger, reports as R  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="the folder holding the B2Soft .xlsx exports")
    ap.add_argument("out", help="where to write chunks/, manifest.json and the audit")
    args = ap.parse_args()
    src, out = Path(args.source).expanduser(), Path(args.out)

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

    report = audit.write(out / "audit.xlsx", out / "audit.md", docs=docs, L=L, stock=stock, customers=customers,
                         suppliers=suppliers,
                         report_piutang=sum(v for _, v in R.open_items(src / "Laporan Piutang Dagang.xlsx", "SI").values()),
                         report_hutang=sum(v for _, v in R.open_items(src / "Laporan Hutang Dagang.xlsx", "PI").values()))
    print(f"{len(parts)} chunks → {folder}")
    for k, v in report["figures"].items():
        print(f"  {k:40s} {v:>16,}")
    print("flags:", ", ".join(f"{t} {n}" for t, n in sorted(report["topics"].items(), key=lambda x: -x[1])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
