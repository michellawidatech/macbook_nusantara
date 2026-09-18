"""
The catalogue: B2Soft product names → category, model and variant.

B2Soft held one flat list of product NAMES ('AIR 13" 2017 I5 8/128', 'MAGSAFE
TYPE C 60 WAT') under a group tree. The new catalogue is category → model →
variant, a variant's differences written as axes — the shape the till's
catalogue, Inventory's grouping and the recommender's `sameKind` read.

Macs are parsed into that shape, with the axis names the fixture uses (Chip,
RAM, SSD). Everything else — iPads, phones, chargers, spare parts — is one
model per product with no axes: there are a handful of each, and a wrong parse
is worse than none.

The variant CODE is the B2Soft name verbatim. It is unique, and it is what the
shop has typed and read for three years.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .reports import Product

# When a chip generation first shipped in a Mac. Pro/Max chips came a year later.
CHIP_YEAR = {"M1": 2020, "M2": 2022, "M3": 2023, "M4": 2024, "M5": 2025}

MAC = re.compile(
    r'^(?P<line>AIR|MBA|PRO|IMAC|MAC MINI|M\d (?:PRO MAX|PRO|MAX))\s*'
    r'(?:(?P<size>\d{2}(?:,\d)?)")?\s*'
    r'(?P<gen>\d{4}|M\d(?: PRO| MAX)?)?\s*'
    r'(?P<chip>I\d|M\d|CORE M)?\s*'
    r'(?P<ram>\d+)/(?P<ssd>\d+(?:,\d)?(?:TB)?)\s*'
    r'(?P<extra>[A-Z ]*)$'
)

SPARE_GROUPS = {"SPAREPART", "BATTERY", "SPEAKER", "LCD", "FLEXIBLE", "IC", "KEYBOARD", "SSD"}

# Products that are not things: a service fee and a shipping-box line.
NOT_PRODUCTS = {"JASA SERVICE": "biaya jasa, bukan barang", "KOLI": "tidak pernah dipakai"}


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def category_of(p: Product) -> str:
    n, g = p.name, p.group
    if n.startswith("LENOVO"):
        return "Laptop lain"
    for prefix, category in (
        ("STUDIO DISPLAY", "Studio Display"), ("MAC STUDIO", "Mac Studio"),
        ("MAC MINI", "Mac mini"), ("IMAC", "iMac"), ("IPAD", "iPad"),
        ("IPHONE", "iPhone"), ("APPLE WATCH", "Apple Watch"),
        ("APPLE PENCIL", "Apple Pencil"), ("AIR", "MacBook Air"),
        ("MBA", "MacBook Air"), ("NEO", "MacBook"),
    ):
        if n.startswith(prefix):
            return category
    if re.match(r"^(PRO|M\d (PRO|MAX))\b", n):
        return "MacBook Pro"
    if "MAGSAFE" in n or g.startswith("MAGSAFE"):
        return "Charger"
    if g == "BOX" or n.startswith("BOX"):
        return "Box"
    if g in ("ACCESORIES", "CASE"):
        return "Aksesoris"
    if g in SPARE_GROUPS:
        return "Sparepart"
    return "Lainnya"


@dataclass
class Catalogue:
    models: dict[str, dict] = field(default_factory=dict)
    # B2Soft product name → sku row (without price; `history` sets it).
    skus: dict[str, dict] = field(default_factory=dict)
    skipped: list[tuple[str, str]] = field(default_factory=list)
    unparsed_macs: list[str] = field(default_factory=list)


def _mac(p: Product, category: str) -> tuple[dict, list[tuple[str, str]]] | None:
    m = MAC.match(p.name)
    if m is None:
        return None
    line, size, gen, chip = m["line"], m["size"], m["gen"], m["chip"]
    ram, ssd, extra = m["ram"], m["ssd"], m["extra"].strip()
    size_inch = float(size.replace(",", ".")) if size else None
    silicon = re.fullmatch(r"(M\d) (PRO MAX|PRO|MAX)", line)
    if silicon:
        family, chip_name = "PRO", f"{silicon[1]} {silicon[2].title()}"
        year = CHIP_YEAR.get(silicon[1], 0) + 1
    else:
        family = "AIR" if line == "MBA" else line
        chip_name = None
        if gen and re.fullmatch(r"\d{4}", gen):
            year = int(gen)
        elif gen:
            chip_name = gen.title().replace("Pro", "Pro").replace("Max", "Max")
            year = CHIP_YEAR.get(gen[:2], 0) + (1 if " " in gen else 0)
        else:
            year = 0
    base = {"AIR": "MacBook Air", "PRO": "MacBook Pro", "IMAC": "iMac", "MAC MINI": "Mac mini"}[family]
    parts = [base]
    if size:
        parts.append(f'{size.replace(",", ".")}"')
    parts.append(chip_name if chip_name else (str(year) if year else ""))
    name = " ".join(x for x in parts if x)
    model = {
        "id": f"b2s-mdl-{slug(category + ' ' + name)}",
        "name": name,
        "category": category,
        "releaseYear": year,
        "line": family,
        **({"sizeInch": size_inch} if size_inch is not None else {}),
        "axes": [],
    }
    values: list[tuple[str, str]] = []
    if chip:
        # An Intel part, or a Core m in a 12" (2015–2017); an M chip after a
        # year is Apple silicon in an iMac.
        values.append(("Chip", "Core m" if chip == "CORE M" else chip.lower() if chip.startswith("I") or year <= 2019 else chip))
    values.append(("RAM", f"{ram}GB"))
    values.append(("SSD", ssd if ssd.endswith("TB") else f"{ssd}GB"))
    if extra:
        values.append(("Tipe", extra))
    return model, values


def build(products: list[Product]) -> Catalogue:
    cat = Catalogue()
    axis_values: dict[str, dict[str, list[str]]] = {}
    pending: list[tuple[Product, dict, list[tuple[str, str]]]] = []
    for p in products:
        if p.name in NOT_PRODUCTS:
            cat.skipped.append((p.name, NOT_PRODUCTS[p.name]))
            continue
        category = category_of(p)
        parsed = _mac(p, category) if category in ("MacBook Air", "MacBook Pro", "iMac", "Mac mini") else None
        if parsed is None:
            if category in ("MacBook Air", "MacBook Pro", "iMac", "Mac mini"):
                cat.unparsed_macs.append(p.name)
            model = {"id": f"b2s-mdl-{slug(category + ' ' + p.name)}", "name": p.name,
                     "category": category, "releaseYear": 0, "axes": []}
            values: list[tuple[str, str]] = []
        else:
            model, values = parsed
        cat.models.setdefault(model["id"], model)
        grid = axis_values.setdefault(model["id"], {})
        for axis, value in values:
            grid.setdefault(axis, [])
            if value not in grid[axis]:
                grid[axis].append(value)
        pending.append((p, model, values))

    order = ["Chip", "RAM", "SSD", "Tipe"]
    for model_id, grid in axis_values.items():
        cat.models[model_id]["axes"] = [{"name": a, "values": grid[a]} for a in order if a in grid]
    for p, model, values in pending:
        given = dict(values)
        grid = axis_values[model["id"]]
        # A model where some variants say NTB/TB/NEW and one says nothing:
        # the silent one is the standard machine, and it needs a value too.
        if "Tipe" in grid and "Tipe" not in given:
            given["Tipe"] = "Standar"
            if "Standar" not in grid["Tipe"]:
                grid["Tipe"].append("Standar")
                cat.models[model["id"]]["axes"] = [{"name": a, "values": grid[a]} for a in order if a in grid]
        ordered = [(a, given[a]) for a in order if a in given]
        cat.skus[p.name] = {
            "id": f"b2s-sku-{p.barcode}",
            "modelId": model["id"],
            "code": p.name,
            "name": model["name"],
            "variantLabel": " · ".join(v for _, v in ordered),
            **({"axisValues": dict(ordered)} if ordered else {}),
        }
    return cat
