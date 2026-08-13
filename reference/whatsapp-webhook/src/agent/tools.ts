/**
 * Whitelisted tools the conversational agent (`converse.ts`) may call. Each tool
 * runs a fixed, parameterized Prisma query — the LLM only supplies entity
 * *values*, never a query. There is deliberately no path from model output to
 * raw SQL.
 *
 * Tools return STRUCTURED data (plain JSON-safe objects, prices pre-formatted to
 * strings) — Claude phrases the reply itself. Data is re-queried LIVE on every
 * call (no data caching), so stock and price are never stale. An ambiguous match
 * (multiple candidate models) returns `candidates` so the agent asks the
 * customer which model rather than guessing.
 */

import { prisma, type Prisma } from "@nusantara/db";
import { formatRp, STORE, STORE_CHANNELS } from "@nusantara/domain";
import { skuWhere, type CatalogQuery } from "./catalog.js";
import {
  cancelReservation,
  createReservation,
  listReservations,
  type CancelArgs,
  type ReservationArgs,
  type ReservationCtx,
} from "./reservation.js";

/** Payment methods the store accepts — surfaced by `store_info`. */
export const STORE_PAYMENT =
  "tunai, transfer bank, QRIS, kartu debit/kredit, dan cicilan";

/**
 * Store warranty policy (static). Served as a tool so the agent can quote it.
 *
 * The static blurbs in this file are written the way the agent must SPEAK (see
 * `AGENT_PERSONA`): plain sentences, no bullets, and none of the print
 * punctuation the persona bans — the model copies whatever a tool hands it.
 */
export const WARRANTY_POLICY =
  "Semua unit bergaransi toko 1 bulan untuk kerusakan yang bukan kelalaian pemakaian, " +
  "mis. mesin atau logic board. Kerusakan fisik, cairan, dan software tidak termasuk. " +
  "Simpan nota pembelian sebagai bukti garansi.";

/**
 * What the unit grades mean (static). Grounded in how the store's own admin
 * explains it: cosmetic dents drop a unit from Grade A to Grade B.
 */
export const GRADE_GUIDE =
  "Grade A mulus, tanpa dent atau lecet berarti, jadi kondisinya paling bagus. " +
  "Grade B ada dent atau lecet ringan yang sifatnya kosmetik, fungsi tetap normal, " +
  "harganya lebih miring. Grade C minus kosmetiknya lebih kelihatan. " +
  "Umumnya yang ready di toko Grade A.";

/**
 * Anti-theft / authenticity reassurance (static). Grounded in the admin's own
 * explanation: a stolen/bypassed unit re-locks on reset, and Activation Lock
 * status can be checked.
 */
export const AUTHENTICITY_INFO =
  "Semua unit dijamin bukan barang curian atau bypass. Cara mastiinnya cek status " +
  "Activation Lock, kalau disabled berarti aman dan clear, tidak ada akun atau data " +
  "yang tersangkut. Unit curian atau bypass pasti kekunci lagi waktu direset ulang, " +
  "jadi bisa dites reset. Resetnya bisa dibantu langsung di toko.";

/**
 * Trade-in / buyback intake fields the customer fills before a human quotes.
 * One plain line per field, no bullet characters and no parenthetical examples,
 * because the agent forwards this almost verbatim.
 */
export const TRADEIN_TEMPLATE = [
  "Boleh dibantu info detail unitnya ya kak 🙏",
  "",
  "Produknya apa, mis. MacBook Pro 13 inch 2020",
  "Seri atau modelnya, mis. A2338 M1 8GB 256GB",
  "Garansinya masih on atau off, kalau on aktif sampai tanggal berapa",
  "Kondisinya gimana, mis. mulus 95 persen dan normal semua",
  "Kelengkapannya apa saja, mis. charger ori, box, kabel, invoice",
  "Ada minusnya atau tidak, mis. lecet tipis di pojok atau battery service",
].join("\n");

/** A SKU joined with its model name and available (TERSEDIA) units. */
type MatchedSku = Prisma.SkuGetPayload<{
  include: { model: { select: { name: true; category: true } }; units: { select: { id: true } } };
}>;

/**
 * Live catalog match from tool arguments. The filter itself lives in
 * ./catalog.ts and is shared with the reservation write path — that is what
 * stops "stok 4 unit" from being followed by a failed booking of the same unit.
 * Units counted are only the ones actually available.
 */
async function matchSkus(q: CatalogQuery): Promise<MatchedSku[]> {
  if (!q.product?.trim()) return [];
  return prisma.sku.findMany({
    where: skuWhere(q),
    include: {
      model: { select: { name: true, category: true } },
      units: { where: { status: "TERSEDIA" }, select: { id: true } },
    },
    orderBy: [{ price: "asc" }],
    take: 25,
  });
}

/** Distinct model names among matched SKUs — used to detect ambiguity. */
const distinctModels = (skus: MatchedSku[]): string[] => [
  ...new Set(skus.map((s) => s.model?.name ?? s.name)),
];

/**
 * How a variant is spoken: "M2 256GB Grade A". Space-joined, never with a middle
 * dot — the agent quotes this label straight into a sentence, and "M2 · 256GB"
 * is exactly the machine-punctuation the persona forbids.
 */
const variantLabel = (s: MatchedSku): string =>
  [s.chip, s.storage, `Grade ${s.grade}`].filter(Boolean).join(" ");

// ---------- Tool implementations (return JSON-safe structured data) ----------

/** Stock for a model: per-variant available counts and prices. */
async function stockLookup(q: CatalogQuery): Promise<object> {
  if (!q.product?.trim()) return { needProduct: true };
  const skus = await matchSkus(q);
  if (skus.length === 0) return { empty: true, query: q.product };
  const candidates = distinctModels(skus);
  if (candidates.length > 1) return { ambiguous: true, candidates };

  const model = skus[0]!.model?.name ?? skus[0]!.name;
  const totalAvailable = skus.reduce((n, s) => n + s.units.length, 0);
  const variants = skus.map((s) => ({
    variant: variantLabel(s),
    chip: s.chip,
    storage: s.storage,
    grade: s.grade,
    price: formatRp(s.price),
    available: s.units.length,
  }));
  return { model, totalAvailable, variants };
}

/** Prices for a model's variants (up to 5). */
async function priceLookup(q: CatalogQuery): Promise<object> {
  if (!q.product?.trim()) return { needProduct: true };
  const skus = await matchSkus(q);
  if (skus.length === 0) return { empty: true, query: q.product };
  const candidates = distinctModels(skus);
  if (candidates.length > 1) return { ambiguous: true, candidates };

  const model = skus[0]!.model?.name ?? skus[0]!.name;
  const variants = skus.slice(0, 5).map((s) => ({
    variant: variantLabel(s),
    chip: s.chip,
    storage: s.storage,
    grade: s.grade,
    price: formatRp(s.price),
    available: s.units.length,
  }));
  return { model, variants };
}

/**
 * Budget-based recommendation: available units at or under a rupiah ceiling,
 * priciest first (best value the customer can afford), optionally narrowed by
 * product. Powers the "budget 10 juta-an ada apa?" flow.
 */
async function budgetRecommend(q: CatalogQuery): Promise<object> {
  const budget = q.budget;
  if (!budget || budget <= 0) return { needBudget: true };
  const ceiling = BigInt(Math.floor(budget));
  const product = q.product?.trim();
  const skus = await prisma.sku.findMany({
    where: {
      // Narrowed by product → the shared matcher (see ./catalog.ts). Without a
      // product, any non-archived SKU with available stock.
      ...(product ? skuWhere(q) : { archived: false, model: { is: { archived: false } } }),
      price: { lte: ceiling },
      units: { some: { status: "TERSEDIA" } },
    },
    include: {
      model: { select: { name: true, category: true } },
      units: { where: { status: "TERSEDIA" }, select: { id: true } },
    },
    orderBy: [{ price: "desc" }],
    take: 5,
  });
  const options = skus.map((s) => ({
    model: s.model?.name ?? s.name,
    variant: variantLabel(s),
    price: formatRp(s.price),
    available: s.units.length,
  }));
  return { budget: formatRp(ceiling), options };
}

/** Static store info (hours / location / payment). */
function storeInfo(): object {
  return { name: STORE.name, hours: STORE.hours, address: STORE.addr, payment: STORE_PAYMENT };
}

/** Static warranty policy. */
function warrantyInfo(): object {
  return { policy: WARRANTY_POLICY };
}

/**
 * Promos & fresh stock for proactive selling: active discounts within their
 * date window plus the newest available units. Both live-queried.
 */
async function promoFeatured(): Promise<object> {
  const now = new Date();
  const [discounts, units] = await Promise.all([
    prisma.discount.findMany({
      where: {
        active: true,
        AND: [
          { OR: [{ fromDate: null }, { fromDate: { lte: now } }] },
          { OR: [{ toDate: null }, { toDate: { gte: now } }] },
        ],
      },
      take: 10,
    }),
    prisma.unit.findMany({
      where: { status: "TERSEDIA", sku: { archived: false, model: { archived: false } } },
      include: { sku: { include: { model: { select: { name: true } } } } },
      orderBy: { intakeAt: "desc" },
      take: 5,
    }),
  ]);

  const promos = discounts.map((d) => ({
    description: d.description ?? undefined,
    pct: d.pct || undefined,
    scope: d.scope,
    category: d.scopeCat ?? undefined,
  }));
  const newArrivals = units.map((u) => ({
    model: u.sku.model?.name ?? u.sku.name,
    variant: [u.sku.chip, u.sku.storage, `Grade ${u.sku.grade}`].filter(Boolean).join(" "),
    price: formatRp(u.sku.price),
  }));
  return { promos, newArrivals };
}

/** Static grade guide (A/B/C meaning). */
function gradeInfo(): object {
  return { guide: GRADE_GUIDE };
}

/** Static anti-theft / authenticity reassurance. */
function authenticityInfo(): object {
  return { info: AUTHENTICITY_INFO };
}

/**
 * Official marketplace storefronts + the price/fee/insurance logic the store
 * uses, plus the offline option. Static — links live in `STORE_CHANNELS`.
 */
function channelLinks(): object {
  return {
    shopee: STORE_CHANNELS.shopee,
    tokopedia: STORE_CHANNELS.tokopedia,
    note:
      "Harga di marketplace sama dengan harga toko, hanya ada tambahan fee dari platform. " +
      "Harga di marketplace sudah termasuk asuransi pengiriman.",
    offline: `Bisa juga lihat langsung ke toko ya, alamatnya ${STORE.addr}, bukanya ${STORE.hours}.`,
  };
}

/** Trade-in intake template. Agent collects the fields, then escalates. */
function tradeinIntake(): object {
  return {
    template: TRADEIN_TEMPLATE,
    sendAsIs:
      "Kirim template ini apa adanya, baris per baris, jangan digabung jadi satu paragraf " +
      "dan jangan diubah kalimatnya. Pelanggan mengisinya baris per baris.",
    next: "Setelah pelanggan mengisi detail unit, panggil escalate_to_staff untuk penawaran harga.",
  };
}

// ---------- Anthropic tool registry + dispatcher ----------

/** Result of dispatching a tool: structured data for Claude, or an escalation. */
export type DispatchResult = { result: object } | { escalate: string } | { clarify: string };

/** Tool definitions passed to the Anthropic Messages API (`tools`). */
export const ANTHROPIC_TOOLS = [
  {
    name: "stock_lookup",
    description:
      "Cek stok unit yang tersedia untuk sebuah produk Apple apa pun (MacBook, iPad, iPhone, dll). " +
      "Sebutkan `product` (nama model, mis. 'iPad Air', 'MacBook Air M2'), opsional dipersempit dengan " +
      "chip/storage/grade. Kembalikan varian + jumlah unit tersedia + harga. Selalu panggil tool ini " +
      "sebelum bilang sesuatu tidak tersedia — jangan berasumsi toko hanya jual MacBook.",
    input_schema: {
      type: "object",
      properties: {
        product: { type: "string", description: "Nama model, mis. 'MacBook Air M2'" },
        chip: { type: "string" },
        storage: { type: "string", description: "RAM/SSD, mis. '256GB'" },
        grade: { type: "string", description: "A, B, atau C" },
      },
      required: ["product"],
      additionalProperties: false,
    },
  },
  {
    name: "price_lookup",
    description:
      "Cek harga varian sebuah model. Sebutkan `product`; opsional chip/storage/grade untuk mempersempit.",
    input_schema: {
      type: "object",
      properties: {
        product: { type: "string", description: "Nama model, mis. 'MacBook Pro 14'" },
        chip: { type: "string" },
        storage: { type: "string" },
        grade: { type: "string" },
      },
      required: ["product"],
      additionalProperties: false,
    },
  },
  {
    name: "budget_recommend",
    description:
      "Rekomendasikan unit tersedia dengan harga <= `budget` (rupiah, angka polos, mis. 10 juta => 10000000), " +
      "termahal dulu. Opsional dipersempit dengan `product`. Untuk pertanyaan 'budget sekian ada apa?'.",
    input_schema: {
      type: "object",
      properties: {
        budget: { type: "number", description: "Batas atas harga dalam rupiah, mis. 10000000" },
        product: { type: "string" },
      },
      required: ["budget"],
      additionalProperties: false,
    },
  },
  {
    name: "store_info",
    description: "Info toko: nama, jam buka, lokasi/alamat, dan metode pembayaran yang diterima.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "warranty_info",
    description: "Kebijakan garansi toko (statis). Panggil kalau pelanggan tanya soal garansi.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "promo_featured",
    description:
      "Promo/diskon yang sedang aktif dan unit terbaru yang baru masuk. Panggil untuk menawarkan " +
      "penawaran menarik atau saat pelanggan tanya 'ada promo?'.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "grade_info",
    description:
      "Arti Grade A/B/C (statis). Panggil kalau pelanggan tanya beda grade atau kondisi unit.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "authenticity_info",
    description:
      "Jaminan unit bukan curian/bypass + cara ceknya (Activation Lock, reset). Panggil kalau " +
      "pelanggan ragu soal keaslian/keamanan unit atau tanya 'ini bukan curian kan?'.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "channel_links",
    description:
      "Link toko online resmi (Shopee/Tokopedia) + info harga/fee/asuransi dan opsi ke toko offline. " +
      "Panggil kalau pelanggan mau beli online atau minta link Shopee/Tokopedia.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "tradein_intake",
    description:
      "Kirim template detail unit untuk jual/tukar tambah (trade-in). Panggil kalau pelanggan mau " +
      "menjual atau tukar tambah MacBook-nya. Setelah pelanggan mengisi, escalate_to_staff.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "create_reservation",
    description:
      "BUAT reservasi (booking) dan tahan 1 unit untuk pelanggan. Panggil HANYA setelah " +
      "pelanggan setuju dan detail lengkap: `product` (NAMA MODEL saja, mis. 'MacBook Air 13\"' — " +
      "jangan digabung dengan chip/storage/grade), `custName` (nama), " +
      "dan `date` (tanggal kunjungan/ambil, format YYYY-MM-DD). Opsional: `time` (jam, mis. '14:00'), " +
      "`email`, `note`, dan chip/storage/grade untuk mempersempit varian. Nomor WhatsApp diambil " +
      "otomatis — JANGAN minta atau kirim nomor. Kalau balasan tool 'ambiguous', tanyakan varian " +
      "mana; kalau 'unavailable', ikuti `note`-nya dan tawarkan `alternatives` — JANGAN mengarang " +
      "alasan seperti 'baru sold'; kalau butuh data (needName/needDate), tanyakan dulu. " +
      "Kalau sukses, sampaikan kode reservasinya ke pelanggan.",
    input_schema: {
      type: "object",
      properties: {
        product: { type: "string", description: "NAMA MODEL saja, mis. 'MacBook Air 13\"'" },
        chip: { type: "string", description: "mis. 'M2'" },
        storage: { type: "string", description: "RAM/SSD, mis. '16GB/512GB'" },
        grade: { type: "string", description: "A, B, atau C" },
        custName: { type: "string", description: "Nama pelanggan" },
        date: {
          type: "string",
          description:
            "Tanggal kunjungan, WAJIB format YYYY-MM-DD. Ubah dulu kata relatif " +
            "('hari ini', 'besok', 'sabtu') memakai acuan tanggal hari ini di prompt sistem.",
        },
        time: { type: "string", description: "Jam, mis. '14:00'" },
        email: { type: "string" },
        note: { type: "string", description: "Catatan tambahan" },
      },
      required: ["product", "custName", "date"],
      additionalProperties: false,
    },
  },
  {
    name: "my_reservations",
    description:
      "Lihat reservasi milik pelanggan ini (berdasarkan nomor WhatsApp-nya). Panggil kalau " +
      "pelanggan tanya 'reservasi saya', status booking, atau kode reservasinya.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "cancel_reservation",
    description:
      "BATALKAN reservasi milik pelanggan ini (booking-nya sendiri). Panggil kalau pelanggan " +
      "minta membatalkan/menghapus reservasinya. Opsional `code` (mis. 'RSV-XXXX') kalau pelanggan " +
      "menyebutkannya; kalau tidak dan cuma ada satu reservasi aktif, otomatis dibatalkan. Kalau " +
      "hasilnya 'ambiguous', tanyakan kode mana; 'none' → belum ada reservasi aktif; 'notFound' → " +
      "kode tidak ditemukan. Ini HANYA membatalkan (BATAL) — JANGAN dipakai untuk menandai selesai.",
    input_schema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Kode reservasi, mis. 'RSV-XXXX'" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ask_clarification",
    description:
      "Panggil kalau pesan pelanggan benar-benar ambigu atau tidak kamu mengerti: typo berat, " +
      "kalimat kepotong, kode unit yang tidak dikenal, atau dua maksud yang bertabrakan. Isi " +
      "`reason` dengan bagian mana yang tidak jelas. Sesudah tool ini, tanyakan SATU pertanyaan " +
      "pendek untuk memperjelas — jangan menebak. JANGAN dipakai untuk pertanyaan lanjutan biasa " +
      "saat kamu sudah paham maksud pelanggan, dan JANGAN dipakai kalau yang ambigu adalah HASIL " +
      "TOOL; untuk itu langsung tanyakan varian mana yang dimaksud.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
      additionalProperties: false,
    },
  },
  {
    name: "escalate_to_staff",
    description:
      "Serahkan percakapan ke staf manusia. Untuk komplain, klaim/retur garansi, sengketa " +
      "pembayaran, penawaran harga trade-in, nego harga/diskon khusus, syarat cicilan, " +
      "servis/perbaikan, estimasi restok, saat pelanggan minta bicara dengan orang, ATAU " +
      "saat kamu tidak tahu jawabannya dan tidak ada tool yang menjawabnya — jangan mengarang. " +
      "WAJIB dipanggil kalau kamu memberi tahu pelanggan bahwa tim/staf/admin akan lanjut " +
      "membantu. Berikan `reason` singkat.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
      additionalProperties: false,
    },
  },
] as const;

/** Names the agent may call (for validation / tests). */
export const TOOL_NAMES = new Set(ANTHROPIC_TOOLS.map((t) => t.name));

/**
 * Execute a whitelisted tool by name with the model-supplied arguments. `ctx`
 * carries the conversation identity (sender phone / profile name) for tools that
 * need it — the phone is authoritative and never taken from model input. Unknown
 * names return an error result (never throws for a bad name); `escalate_to_staff`
 * returns an `escalate` signal the loop records, and `ask_clarification` a
 * `clarify` one.
 */
export async function dispatchTool(
  name: string,
  input: unknown,
  ctx: ReservationCtx,
): Promise<DispatchResult> {
  const args = (input ?? {}) as CatalogQuery & ReservationArgs & CancelArgs & { reason?: string };
  switch (name) {
    case "stock_lookup":
      return { result: await stockLookup(args) };
    case "price_lookup":
      return { result: await priceLookup(args) };
    case "budget_recommend":
      return { result: await budgetRecommend(args) };
    case "store_info":
      return { result: storeInfo() };
    case "warranty_info":
      return { result: warrantyInfo() };
    case "promo_featured":
      return { result: await promoFeatured() };
    case "grade_info":
      return { result: gradeInfo() };
    case "authenticity_info":
      return { result: authenticityInfo() };
    case "channel_links":
      return { result: channelLinks() };
    case "tradein_intake":
      return { result: tradeinIntake() };
    case "create_reservation":
      return { result: await createReservation(ctx, args) };
    case "my_reservations":
      return { result: await listReservations(ctx) };
    case "cancel_reservation":
      return { result: await cancelReservation(ctx, args) };
    case "escalate_to_staff":
      return { escalate: args.reason?.trim() || "customer-request" };
    // Not an escalation: the FIRST ambiguous turn must still be answered with a
    // question. The pipeline counts these and hands over on the second strike.
    case "ask_clarification":
      return { clarify: args.reason?.trim() || "unclear" };
    default:
      return { result: { error: `unknown tool: ${name}` } };
  }
}
