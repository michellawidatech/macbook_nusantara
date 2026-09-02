# Pages & features

Every screen in the rebuilt SPA: what job it does, which ERD tables it reads and
writes, which endpoints it calls, and the interactions that define it.

**Gone from the current build.** *Marketplace* (`/katalog/marketplace`),
*Kompetitor* (`/katalog/kompetitor`), the Shopee import drawer, the market-price
panel inside Harga, *Nilai Produk* (`/inbound/grading`) and *Konfigurasi Grading*
(`/kontrol/grading`).

**New.** *Riwayat Serial* — the unit lifecycle timeline, and the screen this
rebuild is really for. Plus *Garansi*, *Lokasi*, *Retur Supplier* and *Jejak
Audit*, each of which is a real workflow that currently has no home.

---

## Information architecture

```
Laporan     /laporan              Arus Kas · Insight · Supplier
Inbound     /inbound              Purchase Order · Kedatangan · Retur Supplier
Katalog     /katalog              Master Katalog · Inventori · Riwayat Serial · Harga
Penjualan   /penjualan            Kasir · Riwayat · Pelanggan · Pengiriman ·
                                  Reservasi · Garansi · Pesan · Komentar
Kontrol     /kontrol              Log Transaksi · Log Harga · Diskon ·
                                  Stock Opname · Lokasi · Jejak Audit
```

Landing route is `/penjualan` (Kasir), not `/laporan` — the cashier opens this
app far more often than the owner does.

The shell carries: section nav, global search (`⌘K`), the unanswered-chat badge,
the staff/account menu, the ID/EN toggle, the current shift + location, and a
scanner-ready indicator.

---

## Penjualan

### Kasir — `/penjualan`

The screen that must be fastest. Sells specific **units**, never abstract SKUs.

| | |
|---|---|
| **Reads** | `Sku`, `Unit`, `CatalogModel`, `Category`, `CategoryAttribute`, `Location`, `Customer`, `Discount`, `Shift` |
| **Writes** | `Order`, `OrderItem`, `Payment`, `TradeIn`, `UnitEvent`, `Unit` (projection), `Discount.used`, `Shift` |
| **Endpoints** | `GET /api/penjualan/kasir`, `POST /api/penjualan/checkout`, `POST /api/penjualan/pembayaran`, `GET /api/penjualan/trade-in-options` |

Scan or search → serial-level picker → cart with editable price against the
category margin guide → trade-in capture → discount (manual or `Discount` rule) →
**payments** → fulfilment → receipt.

Interaction requirements:
- Scan-to-cart under 150 ms, focus returned after every add ([02 §2](02-interaction.md#barcode-scanners)).
- A line shows the **serial**. Two units of one SKU are two lines.
- Price edit shows margin and COGS live; below-margin needs a reason, below-COGS
  needs approval; both land in `PriceLog` with `belowFloor` / `ovReason`.
- Payments are rows with a running remaining balance ([02 §10](02-interaction.md#10-payments)).
- Cart survives reload. `⌘Enter` checks out; bare `Enter` never does.
- Trade-in picks from the catalog by dropdown, and creates an incoming `Unit`
  with its `DITERIMA` event in the same transaction.
- Customer is optional — an anonymous sale must not require a form.
- Checkout is the reference implementation of [08 §3](08-data-integrity.md#3-transaction-boundaries).

### Riwayat Transaksi — `/penjualan/riwayat`

| **Reads** | `Order`, `OrderItem`, `Payment`, `OrderAdjustment`, `Customer`, `Staff` |
| **Writes** | `Order.status`, `OrderItem.returned*`, `OrderAdjustment`, `Payment` (reversing), `UnitEvent` |
| **Endpoints** | `GET /api/penjualan/riwayat`, `POST /api/penjualan/:code/retur`, `/void`, `/refund` |

Filter by date range, status, platform, payment method, cashier, location. Row
expands to items **with their serials, each linking to its timeline**. Full and
partial returns restock the exact units and write `RETUR_PELANGGAN` events.
Reprint receipt. CSV export is owner-only and writes an `AuditLog` row.

### Pelanggan — `/penjualan/pelanggan`

`Customer` CRUD with order history, total spend, open claims, and the link to
their WhatsApp thread. Phone is the unique key and **is the join between POS and
chatbot** — surface it.

### Pengiriman — `/penjualan/pengiriman`

| **Reads/Writes** | `Shipment`, `ShipmentItem`, `ShipmentEvent`, `PostalCode`, `Order` |
| **Endpoints** | `GET/POST /api/penjualan/pengiriman`, `GET /api/wilayah/:zip` |

Queue by `ShipmentStatus`, `PERLU_RESI` first — it is the actionable one. Zip
entry autocompletes province/city/district. `resi` accepts a scan.
`ShipmentEvent` renders as a timeline.

### Reservasi — `/penjualan/reservasi`

`Reservation` + `ReservationItem`, filtered by status. `source` shows whether
staff or the **agent** created it, because an agent-made booking may need
confirming. Reserving a specific unit writes `DIRESERVASI`; expiry releases it
and writes `RESERVASI_BATAL`.

### Garansi — `/penjualan/garansi` *(new)*

| **Reads/Writes** | `WarrantyClaim`, `Unit`, `UnitEvent`, `OrderItem`, `Supplier`, `Payment` |

Open-claims queue. Look up by **scanning the serial**. Resolution is `STOK` /
`RETUR` / `REFUND`, each with its stock consequence written as an event. Shows
the original order, the warranty expiry from `OrderItem.garansiUntil`, and the
supplier for a `RETUR_SUPPLIER`.

### Pesan — `/penjualan/pesan` (WhatsApp)

| **Reads** | `WaMessage`, `WaThreadMemory`, `Customer` |
| **Writes** | `WaMessage` (OUT rows), `WaMessage.status`, `WaThreadMemory.directive*`, `Outbox` |
| **Endpoints** | `GET /api/pesan/threads`, `GET /api/pesan/threads/:from`, `POST /api/pesan/threads/:from/reply`, `POST /api/pesan/:id/status`, `PUT /api/pesan/threads/:from/catatan` |

Thread list keyed by `WaMessage.from`, default-filtered to `PERLU_STAF`, oldest
first. Thread view interleaves customer messages, agent auto-replies (which live
in `replyText` on the inbound row) and staff OUT rows — each labelled. Side panel
holds the agent's rolling summary (read-only, machine-written) and the staff
directive (editable, never agent-writable — enforced by column ownership,
[08 §7](08-data-integrity.md#7-column-ownership-the-structural-guarantee)).
The **24-hour send window** is shown per thread. See [02 §13](02-interaction.md#13-chat-inbox-interaction).

### Komentar — `/penjualan/komentar` (Instagram)

| **Reads/Writes** | `IgComment`, `IgMedia`, `IgSettings`, `Outbox` |
| **Endpoints** | `GET /api/komentar`, `POST /api/komentar/:id/reply`, `/dm`, `POST /api/komentar/sync`, `PUT /api/komentar/settings` |

Comments grouped by post. Public reply, private DM, hide, mark done. The 7-day DM
window is derived from `IgComment.ts` and shown as remaining time; after it
expires the control is disabled **with the reason stated**, not just greyed out.
Auto-reply toggle and templates live here.

---

## Katalog

### Master Katalog — `/katalog`

| **Reads/Writes** | `Category`, `CategoryAttribute`, `CategoryAttributeOption`, `CategoryVariantAxis`, `CatalogModel`, `ModelAxis`, `ModelAxisValue`, `ModelPhoto`, `Sku` |
| **Endpoints** | `GET /api/katalog`, `POST /api/katalog/models/:id`, `/generate-skus`, `GET/POST /api/katalog/categories`, `/category-attributes` |

Models grouped by category (drag to reorder). Per-category settings drawer edits
the **attribute table** (per-unit fields such as Battery Health), the variant axes
and the margin guide — all real rows now, not a JSON editor.

The variant matrix is the hard part: show which combinations already have SKUs,
which have stock, and generate only the missing ones. **Never silently create
hundreds of SKUs.**

### Inventori — `/katalog/inventori`

The densest table in the app, and the one that most needs [§8](02-interaction.md#8-tables--where-this-app-lives).

| **Reads** | `Sku`, `Unit`, `UnitAttribute`, `CatalogModel`, `Category`, `Location` |
| **Writes** | `Sku` (bulk price), `UnitEvent` (transfers), `Sku.archived` |
| **Endpoints** | `GET /api/katalog/inventori`, `POST /api/katalog/inventori/bulk-update`, `POST /api/katalog/transfer` |

Multi-select filters on grade, category, **location** and any category attribute.
Columns come from `CategoryAttribute`, not hardcoded. Bulk actions: *Edit harga*,
*Pindah lokasi*, *Lihat unit*. **No delete.** The unit drawer lists every serial
with status, location, intake date, buy and landed cost, and its latest notes —
each row linking to the full timeline.

### Riwayat Serial — `/katalog/unit/:serial` *(new — the centrepiece)*

| **Reads** | `Unit`, `UnitEvent`, `UnitNote`, `UnitNotePhoto`, `UnitAttribute`, `Sku`, `Location`, `Staff` and every linked document |
| **Writes** | `UnitNote`, `UnitNotePhoto` |
| **Endpoints** | `GET /api/katalog/unit/:serial`, `POST /api/katalog/unit/:serial/catatan` |

One scan, and a staff member holding a device knows everything that ever happened
to it: arrival with its PO, free-text notes, transfers, reservation, sale with its
order, return, warranty claim and resolution, opname findings. Full interaction
contract in [02 §11](02-interaction.md#11-the-serial-timeline).

**Notes are deliberately unstructured** — free text, an optional free-text tag,
photos. No score, no criteria, no computed grade. That was the grading engine and
it is out of scope; staff record what they actually observed.

### Harga — `/katalog/harga`

| **Reads/Writes** | `Sku.price`, `Sku.landed`, `PriceLog`, `PriceReq`, `Category` margin fields |
| **Endpoints** | `GET /api/katalog/harga`, `POST /api/katalog/harga/update`, `/request` |

Price list with margin against landed cost, coloured against the category guide.
Below-floor changes create a `PriceReq` for owner approval rather than applying.
Every change writes `PriceLog` in the same transaction as the update.

---

## Inbound

### Purchase Order — `/inbound`

| **Reads/Writes** | `PurchaseOrder`, `PurchaseOrderItem`, `PurchaseOrderItemSerial`, `PurchaseOrderFee`, `PurchaseOrderPackage`, `Supplier`, `Payment` |
| **Endpoints** | `GET/POST /api/inbound/purchase-order` |

Header (supplier, invoice, date, destination location) → line items from the
catalog → fee rows → packages → landed total. A sub-drawer captures serials per
line with scanner autofocus. Supplier payments (`FULL` / `DP` / `TEMPO`) are
`Payment` rows with `direction = KELUAR`.

This is a 20–90 minute session: autosave every change, show the saved-at time,
and provide `⌘S` anyway. Excel import maps to the same line shape.

### Kedatangan — `/inbound/kedatangan`

| **Writes** | `Unit`, `UnitEvent(DITERIMA)`, `ArrivalPhoto`, `PurchaseOrder.status`, `PurchaseOrderItemSerial.unitId` |

Receiving against an open PO: confirm quantities, capture arrival photos, mark
received. Creates every `Unit` and allocates PO fees across lines into
`Unit.landed` — **in one transaction**. Any discrepancy against the PO is shown
as a diff, never swallowed. A serial already in stock is rejected at entry,
naming where it already is.

### Retur Supplier — `/inbound/retur` *(new)*

`SupplierReturn` + `SupplierReturnItem`. Select units (typically from a warranty
resolution or a bad batch), pick the supplier, record the reason and expected
credit. Moves each unit to `RETUR_SUPPLIER` with an event.

---

## Kontrol

| Page | Route | Tables | Notes |
|---|---|---|---|
| Log Transaksi | `/kontrol` | `Order`, `OrderAdjustment`, `Payment`, `Shift` | Filter by cashier, date, type, location; drill into the order |
| Log Harga | `/kontrol/logharga` | `PriceLog`, `PriceReq` | Approval queue; a request cannot be self-approved |
| Diskon | `/kontrol/diskon` | `Discount`, `DiscountSku` | Scope (all/category/SKU), window, usage limit and count |
| Stock Opname | `/kontrol/opname` | `OpnameSession`, `OpnameScan`, `Unit`, `UnitEvent` | Scan-driven count per location; system vs counted vs missing vs unknown vs found; posting is confirmed with the variance in the dialog and is one serializable transaction |
| Lokasi | `/kontrol/lokasi` | `Location` | CRUD; a location with stock cannot be deleted, only deactivated |
| Jejak Audit | `/kontrol/audit` | `AuditLog` | Owner-only search by staff, entity, date. Reading it is itself an audit event |

Opname is the second scanner-heavy screen: continuous scanning with a running
tally, no dialog between scans, unknown serials collected into a review list
rather than interrupting.

---

## Laporan

| Page | Route | Tables | Notes |
|---|---|---|---|
| Arus Kas | `/laporan` | `FinSettings`, `OpexItem`, `PettyCash`, `PettyCashEntry`, `Payment`, `Shift` | Cash position from actual payment rows, opex, petty cash |
| Insight | `/laporan/insight` | `Order`, `OrderItem`, `Unit`, `UnitEvent`, `Sku` | Revenue, margin, COGS, aging stock (from arrival events), movers |
| Supplier | `/laporan/supplier` | `Supplier`, `PurchaseOrder`, `SupplierReturn`, `WarrantyClaim` | Spend, return rate, claim rate |

**Every figure drills through to the rows behind it.** A number in a report that
cannot be traced to records will be disbelieved, and rightly.

---

## Cross-cutting

### Auth & shell
`Staff` with `Role` (`OWNER` / `STAFF`) and `canApprove`; `StaffSession` for
revocation and "log out everywhere". JWT in an HttpOnly cookie. Owner-only:
Diskon, price approval, Laporan, Jejak Audit, Lokasi, opname posting, exports.
Authorisation is checked **server-side per endpoint** — a hidden button is an
affordance, not a control. `GET /api/bootstrap` supplies the shell payload
(staff, locations, counters) in one request.

### Global search (`⌘K`)
Serial (`Unit.serial`), order code, SKU name, customer name/phone, PO code, plus
page navigation. **Serial lookup is the single most valuable one**: a staff member
holding a device is one scan from its full history.

### Notifications
Shell badges: unanswered WhatsApp threads, new IG comments, open warranty claims,
pending price requests, outbox backlog. Polled, never pushed into a modal.

### Bilingual
Indonesian is the source; English is a label map. Routes and data stay
Indonesian. Toggle in the account menu, persisted per user.

---

## Table-to-screen coverage

Every table has an owning screen. Anything without one is dead weight.

| Tables | Owning screen |
|---|---|
| `Staff`, `StaffSession` | Account menu, Kontrol |
| `Customer` | Pelanggan |
| `Supplier` | Purchase Order, Laporan Supplier |
| `Location` | Lokasi |
| `Category`, `CategoryAttribute`, `CategoryAttributeOption`, `CategoryVariantAxis` | Master Katalog (settings drawer) |
| `CatalogModel`, `ModelAxis`, `ModelAxisValue`, `ModelPhoto`, `Sku` | Master Katalog |
| `Unit`, `UnitAttribute` | Inventori |
| `UnitEvent`, `UnitNote`, `UnitNotePhoto` | **Riwayat Serial** |
| `PurchaseOrder`, `PurchaseOrderItem`, `PurchaseOrderItemSerial`, `PurchaseOrderFee`, `PurchaseOrderPackage` | Purchase Order |
| `ArrivalPhoto` | Kedatangan |
| `SupplierReturn`, `SupplierReturnItem` | Retur Supplier |
| `Order`, `OrderItem`, `TradeIn` | Kasir, Riwayat |
| `Payment` | Kasir, Purchase Order, Arus Kas |
| `OrderAdjustment` | Riwayat, Log Transaksi |
| `Reservation`, `ReservationItem` | Reservasi |
| `Shipment`, `ShipmentItem`, `ShipmentEvent` | Pengiriman |
| `WarrantyClaim` | Garansi |
| `Discount`, `DiscountSku` | Diskon, Kasir |
| `PriceLog`, `PriceReq` | Log Harga |
| `AuditLog` | Jejak Audit |
| `OpnameSession`, `OpnameScan` | Stock Opname |
| `Shift` | Kasir (open/close), Log Transaksi |
| `FinSettings`, `OpexItem`, `PettyCash`, `PettyCashEntry` | Arus Kas |
| `PostalCode` | Pengiriman, Pelanggan (lookup) |
| `DailyQuota` | — internal rate limiting only |
| `AppleDbCache` | Master Katalog (model import) |
| `Outbox` | Monitor app |
| `WaRawEvent`, `WaMessage`, `WaThreadMemory`, `AgentCache` | Pesan |
| `IgRawEvent`, `IgMedia`, `IgComment`, `IgSettings` | Komentar |
