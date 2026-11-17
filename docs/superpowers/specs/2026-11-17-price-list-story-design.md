> **Revised 2026-11-17, same day (owner):** *"Use the design E, change the
> laptop to be more realistic, and make the user can customize the text as
> well."* Only **E · Modern** is built; A and F stay as mockups. Every word on
> the picture is an editable field. As built, the rows follow the **same unit
> rule as the price list to copy** in the same dialog (on sale — `TERSEDIA` or
> `DIRESERVASI` — with an own sell price), so the two never disagree; and the
> entry point is a **Make a story image** button in Export stock rather than a
> third file format. Pages are cut by card HEIGHT (`paginate`), not a fixed
> row count. Code: `lib/priceStory.ts`, `lib/priceStoryLayout.ts`,
> `lib/priceStoryPaint.ts`, `components/PriceStoryModal.tsx`.

# Price list story — design

**Date:** 2026-11-17 · **Branch:** `michellawidatech/price-list-story` (from `v2026.11.16.8`)
**Mockups:** `.context/poster-designs/design-A.png`, `design-E.png`, `design-F.png`
(throwaway HTML in `gen.mjs` beside them — reference only, not product code).

## What the owner asked

> *"Make a feature to generate images exactly like this based on the stock. For
> all stock, can be multiple."* — then: *"they will generate the picture
> manually when doing the export stock. And no it is not for chatbot."*

Choices made in chat, all by the owner:

- **Rows:** one per variant, NOW shows the price **range** of its units.
- **BEFORE:** typed per row by staff — *"essentially the markup price to make it
  look better"* — and can be left empty, in which case only the normal sell
  price shows (no strikethrough).
- **Which stock:** all in stock by default, filterable.
- **Styles:** three — **A · Nusantara Emas** (the reference poster, cleaned
  up), **E · Modern** (light bento), **F · Persediaan** (the shop's own dark
  gradient template, a little darker). The owner approved all three.
- **Logo:** the owner's `Logo Horizontal.png`, exactly as given (gold mark,
  white lettering). No "100% Original" badge. No "Pasti Ori | Pasti Resmi".
  No bottom tagline line on A. Location is **Serpong**.

## Where it lives

`StockExportModal` (Inventory → Export stock). The format choice gains a
third option, **Story image (PNG)**, beside .xlsx / .pdf. The dialog's
existing three filters — warehouse, category, product (empty means all) —
drive the story too; the column choices are hidden while Story is picked,
because the story's columns are fixed by its style.

With Story picked the dialog widens (viewport-capped) and shows:

- left: **style** (A / E / F, a Segmented), the **texts** (below), and the
  **rows** table — tick (include), product · spec, NOW (read-only range),
  BEFORE (money box, optional), NEW (switch);
- right: a live **preview** of one page with page tabs `1 / n`;
- footer: **Download page**, **Download all (n)**, and **Share** where the
  browser can share files (`navigator.canShare({ files })` — a phone hands the
  images straight to Instagram / WhatsApp).

Not kept with the export's column choices: the story's own state is kept on
this device (below).

## The rows (`lib/priceStory/rows.ts`, pure)

- A unit counts while it is **`TERSEDIA`** and passes the dialog's filter
  (`inStockExport` — the export's own grammar). `DIRESERVASI` is left out: a
  held unit (a DP above all) is not on offer.
- Price is the unit's **own sell price, `Unit.price`** — the rule the chatbot
  has followed since 2026-11-05 (`Sku.price` is not a price the shop stands
  behind). A unit with none is left off, and the dialog says how many
  (*"3 units have no sell price and are left out"*).
- One row per **variant** (`skuId`): `product` = `Sku.name` in full
  (`MacBook Air 13" M2`), `spec` = the variant label with `|` between axes
  (`8GB | 256GB`, `i5 | 16GB | 512GB`), `lo`/`hi` = min/max of its units'
  prices, `qty`.
- Rows are grouped by product, products ordered by the catalogue's own
  order, variants by price.
- **NEW** defaults on when every counted unit of the variant is grade `NEW`
  (`lib/condition.ts`); staff can switch it either way.
- **Counted products (accessories) are not on it** — Export stock has never
  listed them either. A later ask, not this one.
- Merged variants are skipped (`isLiveSku`).

## Pages (`lib/priceStory/paginate.ts`, pure)

Each style has a fixed row capacity at 1080 × 1920: **A 13**, **E 9** (cards),
**F 16**. Products are never split across pages unless one product alone has
more rows than a page holds. Every page repeats the header and footer and is
numbered `1 / n` (no number when there is one page). Unticked rows are
dropped before paging.

## The three styles

All 1080 × 1920 (Instagram story), Indonesian copy whatever the UI language.

- **A · Nusantara Emas** — deep green radial background; the logo centred;
  "Best Price **{Bulan YYYY}**" (serif, the month in gold); the subtitle
  between two fading gold rules; gold arch, two soft clouds (no inner lines),
  podium and the hero picture; the period pill; the cream table — fixed
  columns PRODUK · SPESIFIKASI · BEFORE Rp · NOW Rp, one row height,
  right-aligned tabular prices, product cell spanning its rows, alternate
  product shading, NEW as a small pill beside the spec; the three features
  as text with gold dividers; footer Instagram · WhatsApp · location.
- **E · Modern** — light page with a faint dot grid; a rounded green hero
  card holding the logo, a promo chip (`PROMO · 17–30 NOV 2026`), the big
  sans "Best **Price.**", the subtitle, the hero picture and two chips
  (Tukar tambah, Garansi toko); "Daftar harga" and the page number; one white
  card per product, specs as chips, the struck BEFORE beside the NOW on one
  line; a dark pill footer.
- **F · Persediaan** — black-to-green gradient, darker than the shop's
  template; "Persediaan Barang" and yellow "Per {d MMM yyyy}" on the left, the
  logo on the right; yellow headings **Unit · Harga terendah · Harga
  tertinggi** over a white rule; numbered rows, the spec in grey under the
  name, BEFORE struck small above the lowest price; a single price prints in
  both columns; thin footer.

When no row on a page has a BEFORE, style A drops that column and gives the
width to NOW; E and F simply print nothing there.

## Texts (editable, prefilled, kept on this device)

| field | default |
|---|---|
| title (A) | `Best Price` + `{Bulan YYYY}` (Indonesian month) |
| subtitle (A, E) | `Lebih Hemat dengan Tukar Tambah` |
| period (A, E) | today → today + 13 days, `Periode 17 Nov – 30 Nov 2026` |
| features (A) | `Produk Berkualitas`, `Tukar Tambah Mudah`, `Garansi Toko` |
| chips (E) | `Tukar tambah`, `Garansi toko` |
| heading (F) | `Persediaan Barang`, `Per {today}` |
| Instagram | `macbooknusantara` |
| WhatsApp | `SHOP_PHONE` (packages/domain) |
| location | `Serpong` |

## Rendering

**Canvas 2D, not SVG or HTML.** The pipeline is
`rows → pages → layout(style, page, texts, measure) → draw ops → paint(ctx)`.

- `layout-a.ts`, `layout-e.ts`, `layout-f.ts` are pure: they return a list of
  draw operations (rect, rounded rect, gradient, text with font/size/weight/
  align, image) in poster pixels. Text that is too wide **wraps to two lines
  then ellipsises**, measured through an injected `measure(text, font)` — the
  real one is `ctx.measureText`, tests pass a fixed-width fake.
- `paint.ts` is the only file that touches a canvas.
- The preview is the same canvas, CSS-scaled; export is `canvas.toBlob`
  (`image/png`). One code path, so the preview is the file.
- Why not SVG → image → canvas: text in SVG does not wrap, and an SVG drawn
  as an image may load no external font or picture. Why not HTML
  `foreignObject`: Safari taints the canvas, and the shop posts from phones.
- Soft glows are radial gradients, not `ctx.filter` blur (Safari before 18
  ignores it).

### Assets

- **Logo:** the owner's PNG, downscaled to 1600 px wide, in
  `apps/web/src/assets/story/logo-horizontal.png`.
- **Fonts (SIL OFL, bundled, licences beside them):** Playfair Display (A's
  title), Plus Jakarta Sans (A and E body, E headline), Nunito (F — the
  template's own face). Loaded with the `FontFace` API before the first
  paint; the preview waits on `document.fonts`.
- **Hero picture (A, E):** a drawn laptop (vector paths in `layout-*`) by
  default — no licence to clear — and a **Change picture** button that takes
  a photo from the device, downscaled to 1200 px JPEG and kept on this device.
  Random images from the web are not used: they are mostly copyrighted and
  this is published on the shop's Instagram.

## Kept on this device (`usePersistentState`, `draftKey`)

Style, texts, the hero picture, and **per variant**: BEFORE price, NEW
override, and unticked. So next week's story starts from last week's markup.
A BEFORE at or below the variant's current lowest price is shown with a
warning in the editor (*"lower than the price now"*) and printed anyway —
the staff decide.

## Copy and i18n

Every string of the **dialog** goes through `t()` with Indonesian in
`id.ts`. The **poster's** words are Indonesian marketing copy, editable, and
not translated.

## Testing

- `test/priceStoryRows.test.ts` — which units count (status, filter, no
  price), range, grouping and order, the NEW default, merged variants.
- `test/priceStoryPaginate.test.ts` — capacity per style, products kept
  whole, a product longer than a page, numbering, unticked rows.
- `test/priceStoryLayout.test.ts` — per style with a fake `measure`: every
  row on the page is drawn, long names wrap then ellipsise, A's BEFORE column
  disappears when empty, F prints a single price twice, nothing is drawn
  outside 1080 × 1920.
- `test/stockExportStory.test.tsx` — picking Story shows the rows and a page
  count; a BEFORE typed is kept; Download builds `n` PNG blobs
  (`HTMLCanvasElement` is stubbed in jsdom; the painter is exercised by the
  layout tests, not here).
- Checked by eye in a real browser on each style before release.

## Out of scope

Counted products; scheduling or auto-posting; CPU/GPU core counts (no such
data — the spec column is the variant's axes); any change to the chatbot.
