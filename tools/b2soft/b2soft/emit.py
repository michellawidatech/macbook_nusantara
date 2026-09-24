"""
Changesets: the migrated shop cut into commits, a month at a time, oldest first.

The import goes through `commitStore` in import mode — the same door every till
uses — so every row is validated by the store's schemas and every unit's status
is checked against its ledger before anything is kept. One commit per month
keeps each transaction small, and replays history in the order it happened: a
machine is created in the month it arrived, updated in every month something
happened to it (the row carries the state it was in at the end of that month),
and sold on an order written in the month of the sale.

A document is placed in the earliest month anything refers to it. A purchase
invoice typed after the sale of its machine has its arrival moved earlier by
`ledger.py`, and the invoice has to exist before the machine that names it.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from .documents import Documents, doc_id
from .ledger import WIB, Ledger, iso

STAFF = "Migrasi B2Soft"
REFERENCE = ("paymentMethods", "warehouses", "suppliers", "salesmen", "customers", "categories", "models", "skus")
ON_SHELF = ("QC", "TERSEDIA", "DIRESERVASI")
# What put a counted piece ON the shelf, and what took it off, by the event the
# replay wrote for it. Anything else is a correction.
MOVE_IN = {"DITERIMA": "MASUK", "OPNAME_DITEMUKAN": "OPNAME", "RETUR_PELANGGAN": "RETUR_PELANGGAN"}
MOVE_OUT = {"TERJUAL": "TERJUAL"}


def counted_moves(docs: Documents, L: Ledger) -> dict[str, list[dict]]:
    """
    A counted product's pseudo units, as quantities on the stock ledger
    (2026-09-19), by month.

    The replay still walks them one piece at a time, first in first out —
    that is what gives every piece its cost and every sale its pieces. This
    only rewrites the result: each piece coming onto a shelf, leaving one, or
    moving between two is a ±1 at a location, and identical ±1s — the same
    product, place, document, cost and moment — are summed into one row.
    """
    sku_id = {s["code"]: s["id"] for s in docs.rows["skus"]}
    merged: dict[tuple, dict] = {}
    for u in L.units.values():
        if u.product not in docs.counted:
            continue
        on, loc = False, None
        for e in u.events:
            now_on = e.to in ON_SHELF
            steps: list[tuple[str, str, int, str]] = []
            if not on and now_on:
                steps.append((MOVE_IN.get(e.type, "KOREKSI"), e.loc, 1, e.note))
            elif on and not now_on:
                steps.append((MOVE_OUT.get(e.type, "KOREKSI"), loc, -1, e.note or e.type))
            elif on and now_on and e.loc != loc:
                steps.append(("KOREKSI", loc, -1, f"Pindah ke {e.loc}"))
                steps.append(("KOREKSI", e.loc, 1, f"Pindah dari {loc}"))
            for kind, where, qty, note in steps:
                po_item = docs.po_item.get((e.ref, u.product, e.buy)) if kind == "MASUK" else None
                order_line = docs.sale_line.get((e.ref, u.serial)) if kind == "TERJUAL" else None
                key = (month(e.at), iso(e.at), u.product, where, kind, e.ref, e.buy, po_item, order_line, note, qty > 0)
                row = merged.get(key)
                if row is None:
                    row = dict(skuId=sku_id[u.product], locationId=where, qty=0, cost=str(e.buy), type=kind,
                               at=iso(e.at), staff=STAFF)
                    if e.ref:
                        row["refCode"] = e.ref
                    if po_item:
                        row.update(poId=doc_id(e.ref), poItemId=po_item)
                    if order_line:
                        row.update(orderId=doc_id(e.ref), orderLineId=order_line)
                    if note:
                        row["note"] = note
                    merged[key] = row
                row["qty"] += qty
            on, loc = now_on, e.loc
    out: dict[str, list[dict]] = defaultdict(list)
    for n, (key, row) in enumerate(sorted(merged.items(), key=lambda kv: kv[0][:2] + (kv[1]["skuId"],))):
        row["id"] = f"b2s-sm-{n + 1:06d}"
        out[key[0]].append(row)
    return out


def month(dt: datetime) -> str:
    return dt.astimezone(WIB).strftime("%Y-%m")


def month_of_iso(text: str) -> str:
    return month(datetime.fromisoformat(text.replace("Z", "+00:00")))


def chunks(docs: Documents, L: Ledger) -> list[dict]:
    rows = docs.rows
    sku_id = {s["code"]: s["id"] for s in rows["skus"]}
    reference = {name: [dict(key=r["id"], next=r) for r in rows[name]] for name in REFERENCE if rows[name]}
    out = [dict(label="reference",
                probe=dict(collection="warehouses", key=rows["warehouses"][0]["id"]),
                changes=dict(collections={k: dict(rows=v) for k, v in reference.items()}, singletons={}))]

    first_ref: dict[str, str] = {}
    for u in L.units.values():
        for e in u.events:
            if e.ref:
                m = month(e.at)
                first_ref[e.ref] = min(first_ref.get(e.ref, m), m)

    months: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    for po in rows["pos"]:
        m = min(po["date"][:7], first_ref.get(po["code"], po["date"][:7]))
        months[m]["pos"].append(dict(key=po["id"], next=po))
    for o in rows["orders"]:
        months[month_of_iso(o["ts"])]["orders"].append(dict(key=o["id"], next=o))
    for r in rows["returns"]:
        months[first_ref[r["code"]]]["returns"].append(dict(key=r["id"], next=r))

    for m, moves in counted_moves(docs, L).items():
        months[m]["stockMoves"].extend(dict(key=r["id"], next=r) for r in moves)

    for u in L.units.values():
        # A counted product has no unit in the app — its history is the
        # stock moves above.
        if u.product in docs.counted:
            continue
        per_month: dict[str, list[int]] = defaultdict(list)
        for i, e in enumerate(u.events):
            per_month[month(e.at)].append(i)
        base = None
        for m in sorted(per_month):
            for i in per_month[m]:
                e = u.events[i]
                event = dict(id=f"b2s-ev-{u.serial}-{i + 1}", serial=u.serial, seq=i + 1, type=e.type, at=iso(e.at),
                             fromStatus=u.events[i - 1].to if i > 0 else "-", toStatus=e.to, locationId=e.loc,
                             staff=STAFF)
                if e.note:
                    event["note"] = e.note
                if e.ref:
                    event["refCode"] = e.ref
                months[m]["events"].append(dict(key=event["id"], next=event))
            last = u.events[per_month[m][-1]]
            unit = dict(serial=u.serial, skuId=sku_id[last.product], status=last.to, locationId=last.loc,
                        buy=str(last.buy), description="", poId=doc_id(last.po) if last.po else None)
            item = dict(key=u.serial, next=unit)
            if base is not None:
                item["base"] = base
            months[m]["units"].append(item)
            base = unit

    for m in sorted(months):
        c = months[m]
        probe = next((dict(collection=name, key=c[name][0]["key"])
                      for name in ("events", "stockMoves", "orders", "pos") if c[name]), None)
        out.append(dict(label=m, probe=probe,
                        changes=dict(collections={k: dict(rows=v) for k, v in c.items() if v}, singletons={})))
    return out


def balances_only(docs: Documents, L: Ledger, piutang: dict, hutang: dict) -> list[dict]:
    """
    Master data plus what is owed, and nothing else (owner ask 2026-09-21).

    > *"The data that I will migrate is probably only the master product and
    > piutang & utang (payable and receivable), so pls simple master data like
    > category, warehouse, etc, pls do not create a long list of migration data
    > from 2020."*

    One commit: the catalogue, the warehouses, the parties and the salespeople,
    with every customer's and every supplier's outstanding balance stated once
    as an OPENING BALANCE. No purchase orders, no sales, no units, no events,
    no stock. Three years of history become two numbers per party.

    ## Why the openings and not the invoices

    `--master-only` carries the master data with no balances; the full import
    carries three years of documents, which is what the owner asked not to
    have. What is missing between them is the shop's actual position, and it
    cannot be reached by importing a few invoices: the receivable is 1.78 bn
    across 38 customers and the payable 7.1 bn across 64 suppliers, spread over
    hundreds of documents from 2023 onwards.

    `Customer.openingBalance` and `Supplier.openingBalance` exist for exactly
    this (2026-09-08, 2026-09-13): *debt from before this app, stated once*.
    They are deliberately not fake invoices — an invented invoice would put
    phantom stock in the ledger and be counted by every report that walks
    documents — and they already appear on Customers, Suppliers, Receivables
    and the new Payable & Receivable screen.

    ## Where the figures come from

    `Laporan Piutang Dagang` and `Laporan Hutang Dagang`, which are the shop's
    OWN aged reports — the same two documents the audit reconciles against. Not
    the replayed ledger: the replay is a reconstruction, and for a migration
    that is carrying no documents the reconstruction has nothing to be checked
    against. What B2Soft says is owed is what the shop believes, and on the day
    of a cutover that is the number that matters.
    """
    rows = docs.rows
    reference = {name: [dict(key=r["id"], next=r) for r in rows[name]] for name in REFERENCE if rows[name]}
    at = iso(L.cutoff)

    def apply(collection: str, totals: dict[str, int]) -> int:
        """Put each party's outstanding balance on its own row. Returns the sum."""
        placed = 0
        for entry in reference.get(collection, []):
            owed = totals.get(entry["next"]["name"].strip().upper(), 0)
            # A party who owes nothing carries no opening balance at all,
            # rather than a zero: zero and absent read the same on every
            # screen, and absent is the truth.
            if owed <= 0:
                entry["next"].pop("openingBalance", None)
                entry["next"].pop("openingBalanceAt", None)
                continue
            entry["next"]["openingBalance"] = str(owed)
            entry["next"]["openingBalanceAt"] = at
            placed += owed
        return placed

    def by_party(items: dict) -> dict[str, int]:
        out: dict[str, int] = defaultdict(int)
        for party, owed in items.values():
            if owed:
                out[party.strip().upper()] += owed
        return out

    def unplaced(collection: str, totals: dict[str, int]) -> dict[str, int]:
        """Parties named in the aged report that this export has no row for."""
        known = {e["next"]["name"].strip().upper() for e in reference.get(collection, [])}
        return {name: owed for name, owed in totals.items() if name not in known}

    customers, suppliers = by_party(piutang), by_party(hutang)
    receivable = apply("customers", customers)
    payable = apply("suppliers", suppliers)
    return ([dict(label="reference",
                  probe=dict(collection="warehouses", key=rows["warehouses"][0]["id"]),
                  changes=dict(collections={k: dict(rows=v) for k, v in reference.items()}, singletons={}))],
            dict(receivable=receivable, payable=payable,
                 unplaced={**unplaced("customers", customers), **unplaced("suppliers", suppliers)}))
