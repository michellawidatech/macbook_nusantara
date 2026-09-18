"""
The ledger: every machine's life, replayed from B2Soft's documents.

CLAUDE.md's one rule is that a serial changes state only by appending an
event. B2Soft kept no such history — only documents saying which serial came
in on which purchase invoice and left on which sale. This walks the documents
in time order and writes the events they imply, so every migrated machine
arrives with a gapless ledger whose last event is its status.

Where the documents contradict themselves the replay takes the default the
owner agreed to on 2026-09-13 and records a FLAG; `audit.py` lists them all.

- A serial sold twice with nothing between: a customer return is inferred just
  before the second sale.
- A serial bought back after a sale: the purchase is the return.
- Accessories have no serials in B2Soft. Each unit gets a pseudo-serial,
  `AKS-<barcode>-<n>`, bought and sold first-in first-out.
- `PEMAKAIAN TOKO` invoices are the shop using its own stock: a correction,
  never a sale.
- A serial whose shape is not Apple's and is still in stock is not migrated
  (owner answer 9, "delete it"); its purchase line keeps its money.
- Stock on the cutoff is what `Persediaan Barang` counts per warehouse
  (owner answer 11). Serials it does not count are written off with a note;
  counted units with no serial are flagged, never invented, for a serialised
  product; accessories are topped up. Warehouse 04 is returns & QC, so what
  sits there is in QC.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from itertools import count

from .reports import ExportError, Invoice, Line, Product, ReturnDoc, SerialRow

WIB = timezone(timedelta(hours=7))
SECOND = timedelta(seconds=1)
MINUTE = timedelta(minutes=1)
SERIAL_SHAPE = re.compile(r"^[A-Z0-9]{10,12}$")
SI_CODE = re.compile(r"^SI-\d{4}/\d{2}-\d{6}$")
USAGE_CUSTOMER = "PEMAKAIAN TOKO"
SERVICE_PRODUCT = "JASA SERVICE"
QC_WAREHOUSE = "04"


def local(text: str) -> datetime:
    return datetime.strptime(text[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=WIB)


def day_at(day: str, hour: int, minute: int = 0, second: int = 0) -> datetime:
    return datetime.strptime(day, "%Y-%m-%d").replace(hour=hour, minute=minute, second=second, tzinfo=WIB)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def wh(gd: str) -> str:
    return f"wh-{gd}"


def stored_serial(raw: str) -> str:
    """Apple's serial with its barcode marker — the string a scan produces (lib/serialScan.ts)."""
    return f"S{raw}" if SERIAL_SHAPE.fullmatch(raw) else raw


def is_trash(inv: Invoice) -> bool:
    return inv.party != USAGE_CUSTOMER and (inv.total == 0 or not SI_CODE.fullmatch(inv.code))


@dataclass
class Event:
    type: str
    at: datetime
    to: str
    loc: str
    note: str
    ref: str
    buy: int
    po: str | None
    product: str


@dataclass
class Unit:
    serial: str
    product: str
    pseudo: bool
    buy: int = 0
    po: str | None = None
    supplier: str = ""
    bought_at: datetime | None = None
    customer: str = ""
    sold_at: datetime | None = None
    events: list[Event] = field(default_factory=list)

    @property
    def status(self) -> str | None:
        return self.events[-1].to if self.events else None

    @property
    def loc(self) -> str:
        return self.events[-1].loc if self.events else wh("01")

    def add(self, type_: str, at: datetime, to: str, loc: str, note: str = "", ref: str = "") -> None:
        if self.events and at <= self.events[-1].at:
            at = self.events[-1].at + SECOND
        self.events.append(Event(type_, at, to, loc, note, ref, self.buy, self.po, self.product))


@dataclass
class Ledger:
    units: dict[str, Unit] = field(default_factory=dict)
    sale_lines: dict[str, list[tuple[str, int]]] = field(default_factory=lambda: defaultdict(list))
    purchase_lines: dict[str, list[tuple[str | None, int, str]]] = field(default_factory=lambda: defaultdict(list))
    returns: list[dict] = field(default_factory=list)
    flags: list[tuple[str, str, str]] = field(default_factory=list)
    trash: set[str] = field(default_factory=set)
    cutoff: datetime | None = None

    def flag(self, topic: str, subject: str, detail: str) -> None:
        self.flags.append((topic, subject, detail))


def expand(lines: list[Line], product: str) -> list[tuple[int, str]]:
    """One product's lines on one invoice as (amount, warehouse) per unit, exact to the rupiah."""
    out: list[tuple[int, str]] = []
    for line in lines:
        if line.product != product or line.qty <= 0:
            continue
        base, rem = divmod(line.amount, line.qty)
        out += [(base + (1 if i < rem else 0), line.gd) for i in range(line.qty)]
    return out


def _match_customer_returns(srs, serialised, sales_of, L):
    """Which sold serial each SR line brought back, and when, decided before the replay."""
    by_party_product = defaultdict(list)
    for raw, sales in sales_of.items():
        for at, _doc, party, product in sales:
            by_party_product[(party, product)].append((at, raw))
    taken, out = set(), []
    for d in srs:
        start, end, noon = day_at(d.day, 0), day_at(d.day, 23, 59, 59), day_at(d.day, 12)
        for line in d.lines:
            if line.product not in serialised:
                continue
            found = 0
            for at, raw in sorted(by_party_product[(d.party, line.product)], reverse=True):
                if found >= line.qty:
                    break
                if at > end or (raw, at) in taken:
                    continue
                later = [s[0] for s in sales_of[raw] if s[0] > at]
                nxt = min(later) if later else None
                if nxt is not None and nxt < start:
                    continue
                t = max(noon, at + MINUTE)
                if nxt is not None:
                    t = max(min(t, nxt - MINUTE), at + SECOND)
                taken.add((raw, at))
                out.append((t, d, line, raw))
                found += 1
            if found < line.qty:
                L.flag("Retur pelanggan tanpa unit", d.code, f"{d.party}: {line.product} ×{line.qty - found}")
    return out


def _match_supplier_returns(prs, serialised, sales_of, buys_of, L):
    by_party_product = defaultdict(list)
    for raw, buys in buys_of.items():
        for at, _doc, party, product in buys:
            by_party_product[(party, product)].append((at, raw))
    taken, out = set(), []
    for d in prs:
        start, end, noon = day_at(d.day, 0), day_at(d.day, 23, 59, 59), day_at(d.day, 12)
        for line in d.lines:
            if line.product not in serialised:
                continue
            ranked = []
            for at, raw in by_party_product[(d.party, line.product)]:
                if at > end or raw in taken:
                    continue
                later = [s[0] for s in sales_of[raw] if s[0] > at] + [b[0] for b in buys_of[raw] if b[0] > at]
                nxt = min(later) if later else None
                if nxt is not None and nxt < start:
                    continue
                ranked.append((nxt is None, at, raw, nxt))
            ranked.sort(reverse=True)
            for _stayed, at, raw, nxt in ranked[: line.qty]:
                t = max(noon, at + MINUTE)
                if nxt is not None:
                    t = max(min(t, nxt - MINUTE), at + SECOND)
                taken.add(raw)
                out.append((t, d, line, raw))
            if len(ranked) < line.qty:
                L.flag("Retur supplier tanpa unit", d.code, f"{d.party}: {line.product} ×{line.qty - len(ranked)}")
    return out


def replay(
    pi: dict[str, Invoice],
    si: dict[str, Invoice],
    buys: list[SerialRow],
    sells: list[SerialRow],
    srs: list[ReturnDoc],
    prs: list[ReturnDoc],
    products: list[Product],
    stock: dict[tuple[str, str], tuple[int, float]],
    known: set[str],
) -> Ledger:
    L = Ledger()
    barcode = {p.name: p.barcode for p in products}
    serialised = {r.product for r in buys} | {r.product for r in sells}
    L.trash = {c for c, v in si.items() if is_trash(v)}
    for c in sorted(L.trash):
        L.flag("Faktur sampah", c, f"{si[c].party}, total Rp{si[c].total:,} — tidak dimigrasikan")

    buy_rows, sell_rows = defaultdict(list), defaultdict(list)
    sales_of, buys_of = defaultdict(list), defaultdict(list)
    for r in buys:
        buy_rows[(r.doc, r.product)].append(r.serial)
        buys_of[r.serial].append((local(r.at), r.doc, r.party, r.product))
    for r in sells:
        if r.doc in L.trash:
            continue
        sell_rows[(r.doc, r.product)].append(r.serial)
        sales_of[r.serial].append((local(r.at), r.doc, r.party, r.product))

    bought = Counter(r.serial for r in buys)
    sold = Counter(r.serial for r in sells if r.doc not in L.trash)
    deleted = {s for s in bought if not SERIAL_SHAPE.fullmatch(s) and bought[s] > sold[s] and sold[s] == 0}
    for s in sorted(deleted):
        L.flag("Dihapus (keputusan pemilik)", s, f"{buys_of[s][-1][3]} — {buys_of[s][-1][1]}")
    stored = {raw: stored_serial(raw) for raw in set(bought) | set(sold)}
    if len(set(stored.values())) != len(stored):
        raise ExportError("two B2Soft serials map to one stored serial")

    # A purchase invoice keyed AFTER the sale of the machine it brought in.
    # Replayed in document order that reads as stock found with no paperwork
    # and then bought back from the customer; within a month it is the same
    # invoice typed late, so the arrival is moved to just before the sale.
    early: dict[tuple[str, str], datetime] = {}
    for raw, sales in sales_of.items():
        own = sorted(buys_of.get(raw, []))
        first_sale = min(sales)
        if own and first_sale[0] < own[0][0] <= first_sale[0] + timedelta(days=31):
            early[(own[0][1], raw)] = first_sale[0] - 2 * MINUTE
            L.flag("Pembelian dicatat setelah penjualan", stored_serial(raw),
                   f"{own[0][1]} {own[0][0]:%d-%m-%Y %H:%M}, terjual di {first_sale[1]} {first_sale[0]:%d-%m-%Y %H:%M}")

    seq = count()
    occ: list[tuple] = []
    for inv in pi.values():
        at = local(inv.at)
        for product in dict.fromkeys(l.product for l in inv.lines):
            if product not in known:
                L.flag("Produk tidak dikenal", inv.code, product)
                continue
            units = expand(inv.lines, product)
            raws = buy_rows.get((inv.code, product), []) if product in serialised else [None] * len(units)
            if len(raws) != len(units):
                raise ExportError(f"{inv.code} {product}: {len(units)} on the invoice, {len(raws)} serials")
            for raw, (cost, gd) in zip(raws, units):
                occ.append((early.get((inv.code, raw), at), 0, next(seq), "buy", dict(doc=inv.code, product=product, gd=gd, cost=cost, party=inv.party, raw=raw)))
    for inv in si.values():
        if inv.code in L.trash:
            continue
        at, usage = local(inv.at), inv.party == USAGE_CUSTOMER
        for product in dict.fromkeys(l.product for l in inv.lines):
            if product == SERVICE_PRODUCT:
                continue
            if product not in known:
                L.flag("Produk tidak dikenal", inv.code, product)
                continue
            units = expand(inv.lines, product)
            raws = sell_rows.get((inv.code, product), []) if product in serialised else [None] * len(units)
            if len(raws) != len(units):
                raise ExportError(f"{inv.code} {product}: {len(units)} on the invoice, {len(raws)} serials")
            for raw, (price, gd) in zip(raws, units):
                occ.append((at, 4 if usage else 3, next(seq), "use" if usage else "sell",
                            dict(doc=inv.code, product=product, gd=gd, price=price, party=inv.party, raw=raw)))
    for t, d, line, raw in _match_customer_returns(srs, serialised, sales_of, L):
        occ.append((t, 1, next(seq), "sr", dict(doc=d, line=line, product=line.product, raw=raw)))
    for t, d, line, raw in _match_supplier_returns(prs, serialised, sales_of, buys_of, L):
        occ.append((t, 2, next(seq), "pr", dict(doc=d, line=line, product=line.product, raw=raw)))
    for kind, prio, docs in (("sr", 1, srs), ("pr", 2, prs)):
        for d in docs:
            for line in d.lines:
                if line.product not in serialised and line.product in known:
                    for _ in range(line.qty):
                        occ.append((day_at(d.day, 12), prio, next(seq), kind, dict(doc=d, line=line, product=line.product, raw=None)))
    occ.sort(key=lambda o: (o[0], o[1], o[2]))

    minted, pool, last_cost, ret_seq = Counter(), defaultdict(list), {}, Counter()

    def mint(product: str, cost: int) -> Unit:
        minted[product] += 1
        u = Unit(f"AKS-{barcode[product]}-{minted[product]:04d}", product, True, buy=cost)
        L.units[u.serial] = u
        pool[product].append(u)
        return u

    def sellable(u: Unit, at: datetime, doc: str) -> None:
        if u.status == "QC":
            u.add("QC_SELESAI", at - SECOND, "TERSEDIA", u.loc)
        elif u.status == "TERJUAL":
            u.add("RETUR_PELANGGAN", at - SECOND, "TERSEDIA", u.loc, note=f"Retur tanpa dokumen di B2Soft — dijual lagi di {doc}")
            L.flag("Retur disimpulkan", u.serial, f"{u.product}: dijual lagi di {doc} tanpa retur")
        elif u.status != "TERSEDIA":
            u.add("DICATAT", at - SECOND, "TERSEDIA", u.loc, note=f"Keluar lagi di B2Soft ({doc}) setelah {u.status}")
            L.flag("Riwayat tidak runtut", u.serial, f"keluar di {doc} setelah {u.status}")

    def return_code(code: str) -> str:
        ret_seq[code] += 1
        return code if ret_seq[code] == 1 else f"{code}-{ret_seq[code]}"

    for at, _prio, _n, kind, k in occ:
        product = k["product"]
        if kind == "buy":
            if k["raw"] in deleted:
                L.purchase_lines[k["doc"]].append((None, k["cost"], product))
                continue
            if k["raw"] is None:
                u = mint(product, k["cost"])
            else:
                u = L.units.setdefault(stored[k["raw"]], Unit(stored[k["raw"]], product, False))
            if u.product != product:
                L.flag("Produk berubah", u.serial, f"{u.product} → {product} di {k['doc']}")
            prior, loc = u.status, wh(k["gd"])
            u.product, u.buy, u.po, u.supplier, u.bought_at = product, k["cost"], k["doc"], k["party"], at
            last_cost[product] = k["cost"]
            if prior is None:
                u.add("DITERIMA", at, "QC", loc, ref=k["doc"])
                u.add("QC_SELESAI", at, "TERSEDIA", loc, note="QC di B2Soft")
            elif prior == "TERJUAL":
                u.add("RETUR_PELANGGAN", at, "TERSEDIA", loc, note=f"Dibeli kembali — {k['doc']}", ref=k["doc"])
            elif prior == "RETUR_SUPPLIER":
                u.add("QC_DIBUKA", at, "QC", loc, note="Dibeli lagi setelah diretur ke supplier", ref=k["doc"])
                u.add("QC_SELESAI", at, "TERSEDIA", loc)
            else:
                u.add("DICATAT", at, "TERSEDIA", loc, note=f"Faktur pembelian lagi ({k['doc']}) tanpa penjualan di antaranya", ref=k["doc"])
                L.flag("Dibeli dua kali", u.serial, f"{k['doc']} saat status {prior}")
            L.purchase_lines[k["doc"]].append((u.serial, k["cost"], product))
        elif kind in ("sell", "use"):
            doc = k["doc"]
            if k["raw"] is None:
                ready = [u for u in pool[product] if u.status == "TERSEDIA"]
                if ready:
                    u = min(ready, key=lambda x: (x.bought_at, x.serial))
                else:
                    u = mint(product, last_cost.get(product, 0))
                    u.add("OPNAME_DITEMUKAN", at - 2 * SECOND, "QC", wh(k["gd"]), note=f"Keluar di B2Soft ({doc}) tanpa faktur pembelian")
                    L.flag("Aksesoris tanpa faktur pembelian", u.serial, f"{product} keluar di {doc}")
            else:
                serial = stored[k["raw"]]
                u = L.units.get(serial)
                if u is None:
                    u = L.units[serial] = Unit(serial, product, False)
                    u.add("OPNAME_DITEMUKAN", at - 2 * SECOND, "QC", wh(k["gd"]), note=f"Terjual di B2Soft ({doc}) tanpa faktur pembelian")
                    L.flag("Serial tanpa faktur pembelian", serial, f"{product} terjual di {doc}")
            sellable(u, at, doc)
            if kind == "sell":
                u.add("TERJUAL", at, "TERJUAL", wh(k["gd"]), ref=doc)
                u.customer, u.sold_at = k["party"], at
                L.sale_lines[doc].append((u.serial, k["price"]))
            else:
                u.add("KOREKSI", at, "KOREKSI_KELUAR", u.loc, note=f"Pemakaian toko — {doc}")
        else:
            d, line = k["doc"], k["line"]
            if k["raw"] is not None:
                u = L.units.get(stored[k["raw"]])
                ok = u is not None and (u.status == "TERJUAL" if kind == "sr" else u.status in ("TERSEDIA", "QC"))
                if not ok:
                    L.flag("Retur tidak cocok", d.code, f"{k['raw']} berstatus {u.status if u else 'tidak ada'}")
                    continue
            elif kind == "sr":
                cands = [x for x in pool[product] if x.status == "TERJUAL" and x.customer == d.party]
                if not cands:
                    L.flag("Retur pelanggan tanpa unit", d.code, f"{d.party}: {product}")
                    continue
                u = max(cands, key=lambda x: x.sold_at)
            else:
                cands = [x for x in pool[product] if x.status == "TERSEDIA"]
                mine = [x for x in cands if x.supplier == d.party]
                if not cands:
                    L.flag("Retur supplier tanpa unit", d.code, f"{d.party}: {product}")
                    continue
                u = max(mine or cands, key=lambda x: x.bought_at)
            code = return_code(d.code)
            if kind == "sr":
                u.add("RETUR_PELANGGAN", at, "TERSEDIA", wh(line.gd) if line.gd else u.loc, note="Retur pelanggan di B2Soft", ref=code)
            else:
                u.add("RETUR_SUPPLIER", at, "RETUR_SUPPLIER", u.loc, note="Retur ke supplier di B2Soft", ref=code)
            L.returns.append(dict(code=code, kind="CUSTOMER" if kind == "sr" else "SUPPLIER", serial=u.serial,
                                  day=d.day, party=d.party, product=product))

    _place(L, stock, known, serialised, deleted, buys_of, mint)
    return L


def _place(L, stock, known, serialised, deleted, buys_of, mint) -> None:
    last = max(e.at for u in L.units.values() for e in u.events)
    L.cutoff = cutoff = (last.astimezone(WIB) + timedelta(days=1)).replace(hour=8, minute=0, second=0, microsecond=0)
    stamp = cutoff.strftime("%d-%m-%Y")
    targets, avg_cost = defaultdict(dict), {}
    for (product, gd), (qty, cost) in stock.items():
        if qty > 0:
            targets[product][gd] = qty
            avg_cost[product] = max(avg_cost.get(product, 0), round(cost))
    live = defaultdict(list)
    for u in L.units.values():
        if u.status in ("TERSEDIA", "QC"):
            live[u.product].append(u)
    gone = Counter(buys_of[s][-1][3] for s in deleted)
    for product in sorted(set(live) | set(targets)):
        if product not in known:
            L.flag("Produk tidak dikenal", "Persediaan Barang", product)
            continue
        want = targets.get(product, {})
        total = sum(want.values())
        units = sorted(live.get(product, []), key=lambda x: x.bought_at or cutoff, reverse=True)
        if len(units) > total:
            for u in units[total:]:
                u.add("KOREKSI", cutoff, "KOREKSI_KELUAR", u.loc, note=f"Tidak dihitung di Persediaan Barang B2Soft per {stamp}")
                L.flag("Ditutup: tidak ada di persediaan", u.serial, f"{product}, pembelian terakhir {u.po}")
            units = units[:total]
        elif len(units) < total:
            short = total - len(units)
            if product in serialised:
                why = f"; {gone[product]} di antaranya serial yang dihapus" if gone[product] else ""
                L.flag("Persediaan tanpa serial", product, f"dihitung {total}, ada serial {len(units)}{why}")
            else:
                for _ in range(short):
                    u = mint(product, avg_cost.get(product, 0))
                    u.bought_at = cutoff
                    u.add("OPNAME_DITEMUKAN", cutoff, "QC", wh(max(want, key=want.get)), note=f"Dihitung di Persediaan Barang B2Soft per {stamp} tanpa faktur pembelian")
                    units.append(u)
                L.flag("Aksesoris ditambahkan", product, f"{short} unit dihitung tanpa faktur pembelian")
        left, place = dict(want), {}
        for u in units:
            gd = u.loc[3:]
            if left.get(gd, 0) > 0:
                place[u.serial], left[gd] = gd, left[gd] - 1
        for gd in [QC_WAREHOUSE] + sorted(g for g in left if g != QC_WAREHOUSE):
            for u in units:
                if left.get(gd, 0) <= 0:
                    break
                if u.serial not in place:
                    place[u.serial], left[gd] = gd, left[gd] - 1
        note = f"Penempatan menurut Persediaan Barang B2Soft per {stamp}"
        for u in units:
            gd = place.get(u.serial)
            if gd is None:
                continue
            status = "QC" if gd == QC_WAREHOUSE else "TERSEDIA"
            if u.status == status and u.loc == wh(gd):
                continue
            if status == "QC" and u.status != "QC":
                u.add("QC_DIBUKA", cutoff, "QC", wh(gd), note=note)
            elif status == "TERSEDIA" and u.status == "QC":
                u.add("QC_SELESAI", cutoff, "TERSEDIA", wh(gd), note=note)
            else:
                u.add("DIPINDAH", cutoff, u.status, wh(gd), note=note)
