# Unit details, the offer ladder, listing links — design

Owner, 2026-10-28, approved in chat the same day. Five parts: what the bot
knows about a unit, how it offers, the keep → DP → confirmation flow, a name
on every staff bubble, and the data and screens behind them.

## 1. What the bot knows about a unit

Every stock result (`search_stock`, `check_serial`, `find_unit_photos`, the
alternatives / stepUp / grade ladder — `shelfUnit` in packages/agent
tools.ts, local and through `/api/agent/v1`) carries, beside today's grade,
battery, price, `left` and `photos`:

- **`condition`** — the QC description phrases (`Unit.description` split on
  ", "), split by code into two lists:
  - `faults` — functional faults and missing items, SAID UPFRONT: Layar ada
    garis, Keyboard aus, Engsel longgar, Baterai lemah, Tanpa charger, Unit
    only (owner accepted this assumption).
  - `marks` — everything else (Lecet halus, Lecet di casing bawah, Dent di
    sudut, Mulus, Normal, Fullset dus, Charger original, Sudah ganti SSD, any
    free-typed phrase). Said only when the customer asks about condition,
    minus, dents or completeness.
  The fault list is `UNIT_FAULT_PHRASES` in packages/domain, matched
  case-insensitively; a phrase nobody listed is a mark.
- **`serviced`** — `"never"` when `Unit.neverServiced = true` AND the unit has
  no `ServiceVisit`; `"yes"` when it has a visit or `neverServiced = false`;
  absent when QC left the box blank (unknown is never a promise).
  `servicedState` in packages/domain is the rule.
  - The bot says "belum pernah servis" whenever it describes a `"never"`
    unit; mentions a `"yes"` only when asked; says nothing for unknown.
- **`links`** — the variant's `{ shopee?, tokopedia?, instagram? }`.

`checkReply` gains one check: every URL in a reply must be one the turn's
stock facts returned (or a shop fact). A URL nobody returned is refused like
an invented price (`LINK_INVENTED`).

## 2. How it offers

- **The ladder** (`offerLadder`, packages/domain, pure): for the variant that
  fits — the one named, or the best fit for the budget / usage — the lead is
  its CHEAPEST unit: lowest grade first (C → B → A → NEW), cheapest within a
  grade. Then one line per other grade in stock (cheapest unit of each, with
  its price). Then at most ONE upgrade to another variant (today's `stepUp`,
  ≤30% dearer), offered only when what the customer said calls for it or the
  budget allows. Grade options when the variant has >1 grade in stock; an
  upgrade when there is a reason; both when both; neither otherwise.
  `search_stock` returns `grades: [{ grade, from, count, unit }]` per lead
  variant so the model reads the order instead of sorting.
- **Photos go with the recommendation.** With the photos switch on and the
  lead unit photographed, the reply carries its photos — no "Mau lihat
  fotonya?". `find_unit_photos` picks the cheapest / lowest-grade unit with
  photos (REVERSES 2026-09-29's "most expensive").
- **After photos**: "Gimana kakk? Kakak juga bisa lihat unitnya langsung di
  toko kita 😊". No visit-time question yet. If they want to see it in
  person, the bot gives the address and opening hours (shop facts).
  `withoutPhotoOffer` stays as the guard for a unit with no photos.
- **Tone**: filler words — Okayy, Okee, Ohh, Baikk, Siapp — open a reply
  naturally, varied, not every message (persona + rules templates).
  Needs-questions only BEFORE the first recommendation: the rules bot stops
  appending `nextQuestion` once a recommendation has been given in the
  thread, and the "ladder of yes-questions" in the prompt is replaced by the
  after-photo line.
- **Chip & spec guide**: ~15 Q&A rows in the owner's tone (M1 vs M2, M1 vs
  M3, Intel vs Apple silicon, 8 vs 16GB, 256 vs 512GB, Air vs Pro, 13" vs
  15", Pro vs Max, which for editing / design / coding / college / office,
  older Intel worth it?) delivered as `docs/chatbot/chip-guide-2026-10-28.xlsx`
  for the owner to review and import (/chat → Knowledge → Import). Beyond
  the guide the AI may explain in general terms with no numbers (existing
  GROUNDING rule).
- **Links**: sent only when the customer asks how to buy, about checking out
  on Shopee / Tokopedia, or about buying online (`asksBuyOnline`,
  packages/agent policy.ts — not a hand-over). The platform they named, else
  every link the variant has; a variant with none → "bisa order langsung
  lewat WA ini kak". "Cara belinya gimana?" gets the ways to buy plus the
  link. A keep / DP / "saya ambil" still routes as today.

## 3. Keep → DP → confirmation

- "Mau keep unit ini dong kak" → "Siapp kak 😊 rencananya mau ke toko kapan
  kak?" → a time → the reservation request is filed (as today,
  `propose_reservation`) and the DP rule said (`dpKeepLine`) → "Mau DP
  sekarang kak?" → a proof → hand-over `Perlu verifikasi DP` (as today).
- **The approval message is the owner's template** (`approvalMessage`,
  packages/domain reservationRequest.ts):
  > Okeyy kak noted, kak {name} nanti akan kita siapkan {unit} nya yaa untuk
  > {day} jam {time}. Toko kita ada di {address}, buka {hours}.
  - No name → "Okeyy kak noted, nanti akan kita siapkan …" (`realName`).
  - The address / hours sentence only when no earlier sent text in the
    thread contains the address, or the customer's last message asked where.
    The API route decides (`addressAlreadySent`) and passes a flag.
  - A visit with no unit: "… nanti kita tunggu kedatangannya yaa di {day}
    jam {time}."
  - The old "DP … sudah kami terima, unit kami tahan sampai …" line is
    dropped (owner accepted).

## 4. A name on every staff bubble

A second staff reply to the same customer message overwrites the first on
that `WaMessage`, so the first was drawn from the outbox with no name.
`POST /api/inbox/:phone/reply` now writes an `Outbox` CREATE `AuditLog` row
naming the staff member in the same transaction (the picture route's
pattern), and `uploadersFor` (inboxSent.ts) reads it for WA_REPLY as well as
WA_IMAGE. An outbox text with no staff attribution and no requestId (the
worker's) is drawn as **Bot**. Older staff replies stay "Sent".

## 5. Data and screens

Migration `20261028090000_unit_never_serviced_and_listing_links`, additive,
owner-approved:

- `Unit.neverServiced BOOLEAN NULL` — null = not answered at QC.
- `Sku.shopeeUrl`, `Sku.tokopediaUrl`, `Sku.instagramUrl` `TEXT NULL`, each
  CHECK `IS NULL OR ~ '^https://'`, ≤ 500 characters.
- Grants: `nusantara_app` keeps its table grants (UPDATE on both tables);
  `nusantara_agent` gets SELECT on the four columns if it reads by column.

Store contract (packages/store): `units[].neverServiced?: boolean`,
`skus[].shopeeUrl? / tokopediaUrl? / instagramUrl?` (optional so an older
changeset still commits); the units and skus adapters project and write them.

Screens:
- **QC**: a "Never serviced / opened" Yes / No / blank in `UnitDetailsModal`
  (inbound), `OrphanQcCard`, and Inventory's `UnitEditModal`. Held in the QC
  draft before a serial exists like the other answers.
- **Inventory**: a line's actions gain *Listing links* — a dialog editing the
  variant's three links, saying it applies to every line of that variant.
  `https://` only, validated in the form.
- **Import listing links** (Inventory header, beside *Import sell prices*):
  reads an .xlsx/.csv with a product column (the *Export stock* text:
  `Sku.name` + variant label, or `Sku.code`) and Shopee / Tokopedia /
  Instagram columns; previews matched / unmatched / unchanged; Save writes
  the variants in one mutation. `lib/listingImport.ts` reuses priceImport's
  matching. A blank cell leaves a link alone.

## Testing

- packages/domain: `servicedState`, the fault/mark split, `offerLadder`,
  `approvalMessage` variants (100% coverage rule).
- packages/agent: `shelfUnit` carries the new fields; `checkReply` refuses an
  invented URL; `asksBuyOnline` on real lines; the rules bot's keep flow,
  "cara belinya", no question after a recommendation, faults upfront.
- apps/api: the reply route's audit row; `sent` names each bubble; the
  approval route's address flag.
- apps/web: the QC field, the links dialog, the import preview; i18n test.
- packages/db: the adapters round-trip the new columns.
