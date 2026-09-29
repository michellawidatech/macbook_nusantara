"""
Master data alone, from five workbooks (owner, 2026-09-29).

*"We just want the master product, category/grouping, supplier, salesman, and
customer data."* The history importer (`extract.py` without flags) replays
three years of sales and purchases to build the same reference chunk, and so
needs fifteen workbooks the shop does not want to hand over. This reads only:

    Master Data Tanpa Gudang.xlsx   the catalogue
    Master Gudang.xlsx              the warehouses
    Master Pelanggan.xlsx           the customers
    Supplier List.xlsx              the suppliers (same layout as
                                    Master Supplier with Credit.xlsx)
    Salesman List.xlsx              the salespeople

and writes ONE chunk labelled `reference`, which
`import:b2soft … --master-only` commits. The owner's answers that shape it:

- Eight categories and nothing else. A product whose category is not one of
  them is left out and listed in `masters-audit.txt`, never filed under a
  guess.
- No price (`Std. Jual` / `Std. Beli` ignored): every variant starts at Rp 0
  and is priced unit by unit at Inbound & QC.
- No stock (`Persediaan` ignored), no opening balances, no credit terms.
- Warehouse 04 (GUDANG MASUK BELUM QC) is the service bench.
- Only the named salespeople.
"""
from __future__ import annotations

from pathlib import Path

from . import catalogue as C
from . import reports as R
from .documents import USAGE_CUSTOMER, WALK_IN, phone_of

CATEGORIES = ("MacBook Air", "MacBook Pro", "iPad", "Mac mini", "Accessories", "Charger", "Box", "Sparepart")
COUNTED = {"Accessories", "Charger", "Box", "Sparepart"}
# `catalogue.category_of` speaks the history importer's names; two of its
# categories are these under another name.
RENAMED = {"Aksesoris": "Accessories"}
SERVICE_WAREHOUSE = "04"
SHOP_WAREHOUSE = "02"

FILES = dict(products="Master Data Tanpa Gudang.xlsx", warehouses="Master Gudang.xlsx",
             customers="Master Pelanggan.xlsx", suppliers="Supplier List.xlsx", salesmen="Salesman List.xlsx")


def build(src: Path, salesmen: list[str], created_at: str) -> tuple[dict, list[str]]:
    """The reference changeset, and the audit lines a person should read before importing it."""
    audit: list[str] = []
    rows: dict[str, list[dict]] = {k: [] for k in ("warehouses", "salesmen", "suppliers", "customers",
                                                  "categories", "models", "skus")}

    for code, name in R.warehouses(src / FILES["warehouses"]):
        kind = "SERVIS" if code == SERVICE_WAREHOUSE else "TOKO" if code == SHOP_WAREHOUSE else "GUDANG"
        rows["warehouses"].append(dict(id=f"wh-{code}", name=name.title().replace("Qc", "QC"), active=True, kind=kind))

    listed = {n.strip().upper() for n in R.salesmen(src / FILES["salesmen"])}
    for name in salesmen:
        key = name.strip().upper()
        if key not in listed:
            audit.append(f"salesman {key!r} is not in {FILES['salesmen']} — imported anyway")
        rows["salesmen"].append(dict(id=f"b2s-sls-{C.slug(key)}", name=key.title(), active=True))

    seen: dict[str, str] = {}
    for p in R.parties(src / FILES["suppliers"]):
        name = p.name.strip()
        if name.upper() in seen:
            audit.append(f"supplier {name!r} appears again (code {p.code}); kept the first (code {seen[name.upper()]})")
            continue
        seen[name.upper()] = p.code
        row = dict(id=f"b2s-sup-{p.code}", name=name)
        if phone_of(p):
            row["phone"] = phone_of(p)
        if p.address.strip():
            row["address"] = p.address.strip()
        rows["suppliers"].append(row)

    seen = {}
    for p in R.parties(src / FILES["customers"]):
        name = p.name.strip()
        if name in (WALK_IN, USAGE_CUSTOMER):
            audit.append(f"customer {name!r} skipped — the walk-in / the shop itself, not a person")
            continue
        if name.upper() in seen:
            audit.append(f"customer {name!r} appears again (code {p.code}); kept the first (code {seen[name.upper()]})")
            continue
        seen[name.upper()] = p.code
        row = dict(id=f"b2s-cus-{p.code}", name=name, phone=phone_of(p), createdAt=created_at)
        if p.address.strip():
            row["address"] = p.address.strip()
        if not row["phone"]:
            audit.append(f"customer {name!r} has no usable phone number")
        rows["customers"].append(row)

    products = R.products(src / FILES["products"])
    cat = C.build(products)
    for name, reason in cat.skipped:
        audit.append(f"product {name!r} skipped — {reason}")
    for name in cat.unparsed_macs:
        audit.append(f"product {name!r}: Mac name not parsed — imported as one model with no variants")
    kept_models: set[str] = set()
    for p in products:
        sku = cat.skus.get(p.name)
        if sku is None:
            continue
        model = cat.models[sku["modelId"]]
        category = RENAMED.get(model["category"], model["category"])
        if category not in CATEGORIES:
            audit.append(f"product {p.name!r} skipped — category {model['category']!r} is not one of the eight")
            continue
        if model["id"] not in kept_models:
            kept_models.add(model["id"])
            rows["models"].append({**model, "category": category})
        rows["skus"].append({**sku, "price": "0"})
    used = {m["category"] for m in rows["models"]}
    for c in CATEGORIES:
        if c in used:
            rows["categories"].append(dict(id=f"b2s-cat-{C.slug(c)}", name=c, tracksSerial=c not in COUNTED))

    order = ("warehouses", "salesmen", "suppliers", "customers", "categories", "models", "skus")
    changes = dict(collections={k: dict(rows=[dict(key=r["id"], next=r) for r in rows[k]]) for k in order if rows[k]},
                   singletons={})
    probe = dict(collection="warehouses", key=rows["warehouses"][0]["id"])
    return dict(label="reference", probe=probe, changes=changes), audit
