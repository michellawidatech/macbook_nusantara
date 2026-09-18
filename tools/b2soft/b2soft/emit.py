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
REFERENCE = ("paymentMethods", "warehouses", "suppliers", "salesmen", "customers", "models", "skus")


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

    for u in L.units.values():
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
        probe = next((dict(collection=name, key=c[name][0]["key"]) for name in ("events", "orders", "pos") if c[name]), None)
        out.append(dict(label=m, probe=probe,
                        changes=dict(collections={k: dict(rows=v) for k, v in c.items() if v}, singletons={})))
    return out
