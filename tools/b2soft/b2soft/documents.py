"""
The documents as the store's wire rows — money as decimal strings, times as
UTC instants — for the reference lists, the catalogue, purchase invoices,
sales and returns.

The money rules the owner set on 2026-09-13:

- An open sale on a MARKETPLACE account is PENDING — the platform holds the
  money. On anyone else it is DUE, dated at B2Soft's J. Tempo (answer 6).
- A customer's B2Soft balance above what their open invoices explain is an
  opening balance: receivables "need to combine all" (answer 5). Below it —
  marketplace residuals the master had already let go — the invoices win and
  the gap is flagged.
- A supplier's balance above the payables report is an opening balance: the
  early investors' money, still owed (answer 7).
- B2Soft recorded no payment method, so every historical payment carries the
  inactive `B2SOFT` method rather than a guess at cash or transfer; a
  marketplace account's carries `MARKETPLACE`.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field

from .catalogue import Catalogue, slug
from .ledger import SERVICE_PRODUCT, USAGE_CUSTOMER, Ledger, iso, local, wh
from .reports import ExportError, Invoice, Party

WALK_IN = "USER"
METHOD = "B2SOFT"
MARKETPLACES = ("SHOPEE", "TOKPED", "TOKOPEDIA", "TIKTOK", "AKULAKU")
OTHER_CHANNELS = ("FACEBOOK", "OLX", "CAROUSELL", "THREADS", "AKULAKU", "GOOGLE MAPS")
# The importer's own accessory groups (`catalogue.category_of`), which the app
# counts by quantity rather than by serial.
COUNTED_CATEGORIES = ("Aksesoris", "Charger", "Box", "Sparepart")


def source_of(name: str) -> str:
    n = name.upper()
    for prefix, source in (("SHOPEE", "SHOPEE"), ("TOKPED", "TOKOPEDIA"), ("TOKOPEDIA", "TOKOPEDIA"),
                           ("TIKTOK", "TIKTOK"), ("INSTAGRAM", "INSTAGRAM"), ("WHATSAPP", "WHATSAPP")):
        if n.startswith(prefix):
            return source
    return "LAINNYA" if n.startswith(OTHER_CHANNELS) else "OFFLINE"


def holds_funds(name: str) -> bool:
    return name.upper().startswith(MARKETPLACES)


def money(n: int) -> str:
    return str(int(n))


def doc_id(code: str) -> str:
    return "b2s-" + slug(code)


def phone_of(p: Party) -> str:
    for text in (p.phone, p.contact):
        cleaned = re.sub(r"[^0-9+]", "", text)
        if len(re.sub(r"\D", "", cleaned)) >= 8:
            return cleaned
    return ""


@dataclass
class Documents:
    rows: dict[str, list[dict]] = field(default_factory=lambda: defaultdict(list))
    balances: list[dict] = field(default_factory=list)
    open_sales: list[dict] = field(default_factory=list)
    # Counted products (2026-09-19): B2Soft product names whose category holds
    # no serialised product. They have no units in the app — their pseudo
    # units become quantities on the stock ledger (`emit.py`).
    counted: set[str] = field(default_factory=set)
    # (invoice code, product, cost) → the quantity line a counted purchase is on.
    po_item: dict[tuple[str, str, int], str] = field(default_factory=dict)
    # (sale code, pseudo serial) → the quantity line a counted piece sold on.
    sale_line: dict[tuple[str, str], str] = field(default_factory=dict)


def build(si: dict[str, Invoice], pi: dict[str, Invoice], summary: dict[str, tuple[str, str, str]],
          refs: dict[str, str], suppliers: list[Party], customers: list[Party],
          warehouses: list[tuple[str, str]], salesmen: list[str], cat: Catalogue, L: Ledger) -> Documents:
    out = Documents()
    rows, flag = out.rows, L.flag
    opened = iso(L.cutoff)
    live_sales = [v for v in sorted(si.values(), key=lambda v: v.at)
                  if v.code not in L.trash and v.party != USAGE_CUSTOMER]

    rows["paymentMethods"].append(dict(id="pm_b2soft", code=METHOD, label="B2Soft (metode tidak tercatat)",
                                       builtIn=False, forPo=True, forSale=True, active=False))
    for code, name in warehouses:
        rows["warehouses"].append(dict(id=wh(code), code=code, name=name.title().replace("Qc", "QC"), active=True,
                                       kind="TOKO" if code == "02" else "GUDANG"))
    sales_id = {}
    for name in salesmen:
        sales_id[name] = f"b2s-sls-{slug(name)}"
        rows["salesmen"].append(dict(id=sales_id[name], name=name.title(), active=True))

    # Suppliers — B2Soft kept ERSEN four times; the name is unique here.
    open_pay: dict[str, int] = defaultdict(int)
    for inv in pi.values():
        gap = inv.total - inv.paid
        if gap > 0:
            open_pay[inv.party] += gap
        elif gap < 0:
            flag("Pembayaran supplier lebih", inv.code, f"{inv.party}: Rp{-gap:,} lebih dari faktur")
    grouped: dict[str, list[Party]] = defaultdict(list)
    for p in suppliers:
        grouped[p.name].append(p)
    sup_id = {}
    for name, ps in grouped.items():
        sup_id[name] = f"b2s-sup-{ps[0].code}"
        owes, invoiced = -sum(p.balance for p in ps), open_pay.get(name, 0)
        row = dict(id=sup_id[name], name=name)
        phone = next((phone_of(p) for p in ps if phone_of(p)), "")
        address = next((p.address for p in ps if p.address.strip()), "").strip()
        if phone:
            row["phone"] = phone
        if address:
            row["address"] = address
        # Supplier.openingBalance went on 2026-09-24 ("we don't track it
        # anymore"). What B2Soft says is still owed above the open invoices is
        # reported in the audit and carried nowhere: a supplier's payable in
        # this app is its inbound invoices and nothing else.
        opening = owes - invoiced
        if opening > 0:
            flag("Saldo awal supplier tidak dibawa", name,
                 f"B2Soft Rp{owes:,} − faktur terbuka Rp{invoiced:,} = Rp{opening:,} tidak diimpor")
        elif opening < 0:
            flag("Saldo supplier di bawah faktur", name, f"B2Soft Rp{owes:,}, faktur terbuka Rp{invoiced:,}")
        if len(ps) > 1:
            flag("Supplier ganda digabung", name, f"{len(ps)} baris di Master Supplier")
        if owes or invoiced:
            out.balances.append(dict(kind="supplier", name=name, master=owes, invoices=invoiced, opening=max(opening, 0)))
        rows["suppliers"].append(row)
    for inv in pi.values():
        if inv.party not in sup_id:
            raise ExportError(f"{inv.code}: supplier {inv.party!r} is not in Master Supplier")

    # Customers — USER is the walk-in and PEMAKAIAN TOKO the shop itself.
    open_sale: dict[str, list[Invoice]] = defaultdict(list)
    first_at: dict[str, str] = {}
    for inv in live_sales:
        first_at.setdefault(inv.party, inv.at)
        if inv.total > inv.paid:
            open_sale[inv.party].append(inv)
    cus_id = {}
    for p in customers:
        if p.name in (WALK_IN, USAGE_CUSTOMER):
            continue
        if p.name in cus_id:
            raise ExportError(f"customer {p.name!r} appears twice in Master Pelanggan")
        cus_id[p.name] = f"b2s-cus-{p.code}"
        owes = -p.balance
        invoiced = sum(v.total - v.paid for v in open_sale.get(p.name, []))
        row = dict(id=cus_id[p.name], name=p.name, phone=phone_of(p),
                   createdAt=iso(local(first_at[p.name])) if p.name in first_at else opened)
        if p.address.strip():
            row["address"] = p.address.strip()
        opening = owes - invoiced
        if opening > 0:
            row.update(openingBalance=money(opening), openingBalanceAt=opened)
            flag("Saldo awal pelanggan", p.name, f"B2Soft Rp{owes:,} − faktur terbuka Rp{invoiced:,} = Rp{opening:,}")
        elif opening < 0:
            flag("Saldo pelanggan di bawah faktur", p.name, f"B2Soft Rp{owes:,}, faktur terbuka Rp{invoiced:,} — faktur dipakai")
        if owes or invoiced:
            pending = invoiced if holds_funds(p.name) else 0
            out.balances.append(dict(kind="customer", name=p.name, master=owes, invoices=invoiced,
                                     opening=max(opening, 0), pending=pending, due=invoiced - pending))
        rows["customers"].append(row)
    for inv in live_sales:
        if inv.party != WALK_IN and inv.party not in cus_id:
            raise ExportError(f"{inv.code}: customer {inv.party!r} is not in Master Pelanggan")
    if open_sale.get(WALK_IN):
        flag("Piutang tanpa pelanggan", WALK_IN, f"{len(open_sale[WALK_IN])} faktur USER belum lunas")

    # Counted categories (owner decision 2026-09-19): the accessory groups this
    # importer files B2Soft's products under (`catalogue.category_of`) — and
    # only while none of their products was ever sold by serial. Their products
    # are quantities, never units. A device category B2Soft merely never
    # scanned (an iPhone, a Pencil) is NOT made counted: that would stop the
    # app asking for the serial of every one sold from now on. Its pieces stay
    # pseudo-serial units, flagged, for the owner to decide.
    serialised = {u.product for u in L.units.values() if not u.pseudo}
    category_of = {name: cat.models[s["modelId"]]["category"] for name, s in cat.skus.items()}
    tracked_categories = {category_of[p] for p in serialised if p in category_of}
    counted_categories = sorted(c for c in COUNTED_CATEGORIES
                                if c in category_of.values() and c not in tracked_categories)
    out.counted = {p for p, c in category_of.items() if c in counted_categories}
    for c in counted_categories:
        rows["categories"].append(dict(id=f"b2s-cat-{slug(c)}", name=c, tracksSerial=False))
    for p in sorted({u.product for u in L.units.values() if u.pseudo} - out.counted):
        flag("Aksesoris di kategori berserial", p, f"{category_of.get(p, '?')} — tetap unit dengan serial semu")

    # The catalogue, priced at each product's most recent sale (answer 12).
    last_price: dict[str, int] = {}
    for inv in live_sales:
        for line in inv.lines:
            if line.price > 0:
                last_price[line.product] = line.price
    rows["models"].extend(cat.models.values())
    sku_id = {}
    for name, s in cat.skus.items():
        sku_id[name] = s["id"]
        rows["skus"].append({**s, "price": money(last_price.get(name, 0))})

    # Purchase invoices. One still waiting on QC stays open, or nobody can grade its machines.
    waiting = {u.po for u in L.units.values() if u.status == "QC" and u.po}
    for inv in sorted(pi.values(), key=lambda v: v.at):
        lines = L.purchase_lines.get(inv.code, [])
        if not lines:
            flag("Faktur pembelian tanpa barang", inv.code, f"{inv.party}, Rp{inv.total:,}")
            continue
        if sum(c for _, c, _ in lines) != inv.total:
            flag("Total faktur pembelian beda", inv.code, f"barang Rp{sum(c for _, c, _ in lines):,}, faktur Rp{inv.total:,}")
        oid, at = doc_id(inv.code), iso(local(inv.at))
        ref = refs.get(inv.code, "")
        # A unit is a line of one; a counted product is ONE line per price, of
        # however many came (2026-09-19).
        items: list[dict] = []
        qty_line: dict[tuple[str, int], dict] = {}
        for serial, cost, product in lines:
            if product in out.counted:
                held = qty_line.get((product, cost))
                if held is None:
                    held = dict(id=f"{oid}-{len(items) + 1}", skuId=sku_id[product], serial=None, qty=0,
                                unitCost=money(cost))
                    qty_line[(product, cost)] = held
                    items.append(held)
                    out.po_item[(inv.code, product, cost)] = held["id"]
                held["qty"] += 1
            else:
                items.append(dict(id=f"{oid}-{len(items) + 1}", skuId=sku_id[product], serial=serial, qty=1,
                                  unitCost=money(cost)))
        po = dict(id=oid, code=inv.code, supplierId=sup_id[inv.party], invoice="" if ref in ("", ".") else ref,
                  date=inv.at[:10], locationId=wh(inv.lines[0].gd),
                  items=items,
                  payments=[dict(id=f"{oid}-pay-1", method=METHOD, amount=money(inv.paid), at=at)] if inv.paid > 0 else [],
                  fees=[], discount="0", status="RECEIVED")
        if inv.status == "LUNAS" and inv.code not in waiting:
            po["closedAt"] = at
        rows["pos"].append(po)

    # Sales.
    for inv in live_sales:
        salesman, ref, _note = summary.get(inv.code, ("", "", ""))
        lines = L.sale_lines.get(inv.code, [])
        fees = [dict(label="Jasa service", amount=l.amount) for l in inv.lines if l.product == SERVICE_PRODUCT and l.amount > 0]
        subtotal = sum(p for _, p in lines)
        discount = subtotal + sum(f["amount"] for f in fees) - inv.total
        if discount < 0:
            fees.append(dict(label="Selisih faktur B2Soft", amount=-discount))
            flag("Faktur penjualan di atas barangnya", inv.code, f"Rp{-discount:,} dicatat sebagai biaya")
            discount = 0
        if not lines and not fees:
            flag("Penjualan tanpa barang", inv.code, f"{inv.party}, Rp{inv.total:,}")
            continue
        oid, at = doc_id(inv.code), iso(local(inv.at))
        marketplace, source = holds_funds(inv.party), source_of(inv.party)
        method = "MARKETPLACE" if marketplace else METHOD
        note = {"note": f"Pesanan {ref}"} if ref else {}
        payments = []
        if inv.paid > 0:
            payments.append(dict(id=f"{oid}-pay-1", method=method, amount=money(inv.paid), state="SETTLED", at=at, **note))
        gap = inv.total - inv.paid
        if gap > 0:
            part = dict(id=f"{oid}-pay-2", method=method, amount=money(gap), state="PENDING" if marketplace else "DUE", at=at, **note)
            if marketplace:
                part["channel"] = source if source != "OFFLINE" else "LAINNYA"
            else:
                part["dueAt"] = iso(local(inv.due))
            payments.append(part)
            out.open_sales.append(dict(code=inv.code, party=inv.party, at=inv.at, total=inv.total, paid=inv.paid,
                                       open=gap, state=part["state"], due=inv.due))
        product_of = {u.serial: u.product for u in L.units.values()}
        units = [(s, p) for s, p in lines if product_of.get(s) not in out.counted]
        qty_lines: dict[tuple[str, int], dict] = {}
        for s, p in lines:
            product = product_of.get(s)
            if product not in out.counted:
                continue
            held = qty_lines.get((product, p))
            if held is None:
                held = dict(id=f"{oid}-q-{len(qty_lines) + 1}", skuId=sku_id[product], qty=0, price=money(p))
                qty_lines[(product, p)] = held
            held["qty"] += 1
            out.sale_line[(inv.code, s)] = held["id"]
        order = dict(id=oid, code=inv.code, ts=at, customerId=None if inv.party == WALK_IN else cus_id[inv.party],
                     serials=[s for s, _ in units], prices={s: money(p) for s, p in units}, discount=money(discount),
                     source=source, payMethod=method, settled=gap <= 0, total=money(inv.total))
        if qty_lines:
            order["lines"] = list(qty_lines.values())
        if payments:
            order["payments"] = payments
        if salesman in sales_id:
            order["salesmanId"] = sales_id[salesman]
        elif salesman:
            flag("Salesman tidak dikenal", inv.code, salesman)
        if fees:
            order["fees"] = [dict(id=f"{oid}-fee-{i + 1}", label=f["label"], amount=money(f["amount"])) for i, f in enumerate(fees)]
            order["extra"] = money(sum(f["amount"] for f in fees))
            order["extraNote"] = fees[0]["label"]
        rows["orders"].append(order)

    counted_serials = {u.serial for u in L.units.values() if u.product in out.counted}
    for r in L.returns:
        # A counted piece's return is a quantity back on the shelf — a stock
        # move (`emit.py`) — not a unit's return document.
        if r["serial"] in counted_serials:
            continue
        row = dict(id=f"b2s-ret-{slug(r['code'])}", code=r["code"], kind=r["kind"], serial=r["serial"],
                   reason="Retur pelanggan (B2Soft)" if r["kind"] == "CUSTOMER" else "Retur ke supplier (B2Soft)",
                   date=r["day"], status="DONE")
        if r["kind"] == "SUPPLIER" and r["party"] in sup_id:
            row["supplierId"] = sup_id[r["party"]]
        rows["returns"].append(row)
    return out
