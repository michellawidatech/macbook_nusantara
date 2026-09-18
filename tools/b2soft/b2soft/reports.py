"""
Readers for the B2Soft report exports.

Every workbook B2Soft exported is a REPORT, not a table: title rows, grouped
headers, subtotal rows, and a column layout that differs per report. Each
reader checks the header it expects before reading a row, so an export from
another B2Soft version, or the wrong report under the right name, stops the
run instead of being misread into plausible numbers.

Reading only. What a row MEANS for the new system is decided in `history.py`.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import openpyxl


class ExportError(Exception):
    """The export is not shaped the way these readers expect."""


def _s(x: object) -> str:
    if x is None:
        return ""
    if isinstance(x, datetime):
        return x.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(x, float) and x.is_integer():
        return str(int(x))
    return str(x).strip()


def _rows(path: Path) -> list[list[str]]:
    if not path.exists():
        raise ExportError(f"missing export: {path.name}")
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        return [[_s(c) for c in r] for r in wb.worksheets[0].iter_rows(values_only=True)]
    finally:
        wb.close()


def _c(row: list[str], i: int) -> str:
    return row[i] if i < len(row) else ""


def _num(x: str) -> int | None:
    t = x.replace(",", "").strip()
    if t == "":
        return None
    try:
        return int(round(float(t)))
    except ValueError:
        return None


def _expect(rows: list[list[str]], text: str, path: Path, within: int = 12) -> None:
    """Refuse a workbook whose first rows do not carry `text` somewhere."""
    for r in rows[:within]:
        if any(text.lower() in c.lower() for c in r):
            return
    raise ExportError(f"{path.name}: expected {text!r} in the first {within} rows")


def _day(ddmmyyyy: str) -> str:
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", ddmmyyyy)
    if m is None:
        raise ExportError(f"not a dd/mm/yyyy date: {ddmmyyyy!r}")
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"


@dataclass
class Line:
    product: str
    gd: str
    qty: int
    price: int
    amount: int


@dataclass
class Invoice:
    code: str
    party: str
    at: str  # "YYYY-MM-DD HH:MM:SS", the shop's wall clock
    due: str
    total: int = 0
    paid: int = 0
    status: str = ""
    lines: list[Line] = field(default_factory=list)
    salesman: str = ""
    ref: str = ""
    note: str = ""


@dataclass
class SerialRow:
    doc: str
    party: str
    at: str
    product: str
    serial: str


@dataclass
class ReturnDoc:
    code: str
    day: str
    party: str
    lines: list[Line] = field(default_factory=list)
    salesman: str = ""


@dataclass
class Party:
    code: str
    name: str
    contact: str
    address: str
    phone: str
    balance: int  # B2Soft's "Batas Kredit": negative = owed


@dataclass
class Product:
    group: str
    name: str
    barcode: str


def detail(path: Path, prefix: str) -> dict[str, Invoice]:
    """`Laporan Penjualan Detail` (SI) or `Laporan Pembelian Detil` (PI)."""
    rows = _rows(path)
    _expect(rows, "No Faktur", path)
    out: dict[str, Invoice] = {}
    party: str | None = None
    cur: Invoice | None = None
    for r in rows[9:]:
        c = [_c(r, i) for i in range(15)]
        if re.match(rf"^{prefix}-", c[1]):
            if c[1] in out:
                raise ExportError(f"{path.name}: {c[1]} appears twice")
            due = c[4] if prefix == "SI" else c[3]
            cur = Invoice(code=c[1], party=party or "", at=c[2], due=due or c[2],
                          note=c[7] if prefix == "SI" else "")
            out[cur.code] = cur
            continue
        if cur is None:
            if c[0] and not any(c[1:]):
                party = c[0]
            continue
        joined = " ".join(c)
        figures = [x for x in c if x]
        if "Total Faktur" in joined:
            cur.total = _num(figures[-1]) or 0
        elif "Total Bayar" in joined:
            cur.paid = _num(figures[-1]) or 0
        elif "Status" in joined:
            cur.status = figures[-1]
            cur = None
        elif c[0] and prefix == "SI" and _num(c[6]) is not None:
            cur.lines.append(Line(c[0], c[4], _num(c[6]) or 0, _num(c[9]) or 0, _num(c[11]) or 0))
        elif c[0] and prefix == "PI" and _num(c[6]) is not None:
            cur.lines.append(Line(c[0], c[3], _num(c[6]) or 0, _num(c[8]) or 0, _num(c[13]) or 0))
    unfinished = [k for k, v in out.items() if v.status == ""]
    if unfinished:
        raise ExportError(f"{path.name}: no Status row for {unfinished[:5]}")
    return out


def sales_summary(path: Path) -> dict[str, tuple[str, str, str]]:
    """`Laporan Penjualan`: the salesman, the marketplace reference and the note per SI."""
    rows = _rows(path)
    _expect(rows, "Perincian", path)
    out: dict[str, list[str]] = {}
    cur: str | None = None
    for r in rows[7:]:
        if re.match(r"^SI-", _c(r, 1)):
            cur = _c(r, 1)
            out.setdefault(cur, ["", "", ""])
        if cur is None:
            continue
        if "Ref." in _c(r, 7):
            out[cur][0] = _c(r, 4)
            out[cur][1] = _c(r, 7).split(":", 1)[-1].strip()
        elif _c(r, 7).startswith("Ket."):
            out[cur][2] = _c(r, 7).split(":", 1)[-1].strip()
    return {k: (v[0], v[1], v[2]) for k, v in out.items()}


def purchase_refs(path: Path) -> dict[str, str]:
    """`Laporan Pembelian`: the supplier's own invoice number, where typed."""
    rows = _rows(path)
    _expect(rows, "Faktur", path)
    out: dict[str, str] = {}
    cur: str | None = None
    for r in rows[7:]:
        if re.match(r"^PI-", _c(r, 2)):
            cur = _c(r, 2)
        if cur is not None and "Ref." in _c(r, 6):
            out[cur] = _c(r, 6).split(":", 1)[-1].strip()
    return out


def serials(path: Path) -> list[SerialRow]:
    """`IMEI Pembelian` / `Daftar IMEI Penjualan`: every serial against its invoice."""
    rows = _rows(path)
    out: list[SerialRow] = []
    head: tuple[str, str, str] | None = None
    product: str | None = None
    for r in rows[9:]:
        c0, c1 = _c(r, 0), _c(r, 1)
        if re.match(r"^(SI|PI)-", _c(r, 2)):
            head = (_c(r, 2), c0, _c(r, 4))
            product = None
        elif c0.isdigit() and c1:
            product = c1
        elif c0 == "" and c1 and head is not None and product is not None:
            for token in c1.split():
                out.append(SerialRow(head[0], head[1], head[2], product, token))
    if not out:
        raise ExportError(f"{path.name}: no serial rows found")
    return out


def returns(path: Path, prefix: str) -> list[ReturnDoc]:
    """`Laporan Retur Penjualan` (SR) or `Laporan Retur Pembelian` (PR)."""
    rows = _rows(path)
    _expect(rows, "No Faktur", path)
    out: list[ReturnDoc] = []
    cur: ReturnDoc | None = None
    for r in rows[7:]:
        if _c(r, 1).startswith(f"{prefix}-"):
            cur = ReturnDoc(_c(r, 1), _day(_c(r, 2)), _c(r, 3))
            out.append(cur)
        if cur is None:
            continue
        if prefix == "SR":
            if "Ref." in _c(r, 7):
                cur.salesman = _c(r, 4)
            elif _c(r, 6) and _num(_c(r, 9)) is not None:
                cur.lines.append(Line(_c(r, 6), _c(r, 8), _num(_c(r, 9)) or 0,
                                      _num(_c(r, 10)) or 0, _num(_c(r, 13)) or 0))
        elif _c(r, 5) and not _c(r, 5).startswith("Ref") and _num(_c(r, 7)) is not None:
            qty, price = _num(_c(r, 7)) or 0, _num(_c(r, 8)) or 0
            cur.lines.append(Line(_c(r, 5), _c(r, 6), qty, price, qty * price))
    return out


def parties(path: Path) -> list[Party]:
    """`Master Supplier with Credit` / `Master Pelanggan`."""
    rows = _rows(path)
    _expect(rows, "Batas Kredit", path)
    return [Party(_c(r, 1), _c(r, 2), _c(r, 4), _c(r, 5), _c(r, 7), _num(_c(r, 10)) or 0)
            for r in rows[3:] if _c(r, 0).isdigit() and _c(r, 2)]


def warehouses(path: Path) -> list[tuple[str, str]]:
    rows = _rows(path)
    _expect(rows, "MASTER GUDANG", path)
    return [(_c(r, 1), _c(r, 2)) for r in rows[3:] if _c(r, 0).isdigit()]


def salesmen(path: Path) -> list[str]:
    rows = _rows(path)
    _expect(rows, "Salesman", path)
    return [_c(r, 0) for r in rows[3:] if _c(r, 0)]


def products(path: Path) -> list[Product]:
    """`Master Data Tanpa Gudang`: every product with its group and barcode."""
    rows = _rows(path)
    out = [Product(_c(r, 1), _c(r, 2), _c(r, 4)) for r in rows[5:] if _c(r, 0).isdigit() and _c(r, 2)]
    if len({p.barcode for p in out}) != len(out) or len({p.name for p in out}) != len(out):
        raise ExportError(f"{path.name}: product names or barcodes are not unique")
    return out


def stock(path: Path) -> dict[tuple[str, str], tuple[int, float]]:
    """`Persediaan Barang`: (product, warehouse) → (quantity, average cost)."""
    rows = _rows(path)
    _expect(rows, "PERSEDIAAN", path)
    out: dict[tuple[str, str], tuple[int, float]] = {}
    wh: str | None = None
    for r in rows[9:]:
        if re.match(r"^\d\d - ", _c(r, 0)):
            wh = _c(r, 0)[:2]
        elif wh and _c(r, 0) and _num(_c(r, 4)) is not None and _c(r, 6) == "01":
            out[(_c(r, 0), wh)] = (_num(_c(r, 4)) or 0, float(_c(r, 7) or 0))
    return out


def open_items(path: Path, prefix: str) -> dict[str, tuple[str, int]]:
    """`Laporan Hutang Dagang` (PI) / `Laporan Piutang Dagang` (SI): code → (party, open)."""
    rows = _rows(path)
    out: dict[str, tuple[str, int]] = {}
    for r in rows[9:]:
        if prefix == "PI" and _c(r, 0).startswith("PI-"):
            out[_c(r, 0)] = (_c(r, 2), _num(_c(r, 10)) or 0)
        elif prefix == "SI" and _c(r, 0).startswith("SI-"):
            out[_c(r, 0)] = (_c(r, 3), _num(_c(r, 12)) or 0)
    return out
