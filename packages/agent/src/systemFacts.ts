/**
 * What the shop's own system knows that the bot may repeat — the "system"
 * half of the chatbot's retrieval (docs/chatbot-rag.md).
 *
 * The line is drawn by what production actually holds during the parallel
 * operation with B2Soft (owner, 2026-09-18): "what is going to be migrated to
 * production is only the master product data, store, warehouse, staff". So:
 *
 *  - **The store** — its name, the shop-floor addresses, how to reach it, and
 *    the opening hours. Settings → Shop identity and the TOKO locations.
 *  - **How a customer can pay** — the active payment methods offered at a sale.
 *  - **The catalogue** — which models and which configurations the shop deals
 *    in (`lookup_catalog`). A specification is a fact about the model and is
 *    true whatever is on the shelf.
 *
 * And NOT, however tempting the tables look: a unit, a price, a count, an
 * order, a customer, a reservation. Production's stock is whatever staff have
 * keyed in beside B2Soft, and a bot quoting it would be quoting the wrong
 * shelf. `Sku.price` is never selected here, and neither is a single `Unit`.
 */

import type { PrismaClient } from "@nusantara/db";
import { DP_SETTING_KEYS, dpRuleOf } from "@nusantara/domain";
import { STORE_HOURS } from "./hours.js";
import type { DpTerms } from "./policy.js";

export interface StoreFacts {
  readonly name: string | null;
  readonly contact: string | null;
  /** Shop-floor locations only (TOKO) — never a warehouse or the service bench. */
  readonly stores: ReadonlyArray<{ name: string; address: string | null }>;
  /** Customer-facing words for the active payment methods, in shop order. */
  readonly paymentMethods: readonly string[];
  /**
   * The DP rule (owner, 2026-10-27) — `sales.dpAmount` / `sales.dpDays`, or
   * Rp500.000 for 7 days. What the bot says when asked to keep a unit.
   */
  readonly dp: DpTerms;
}

/**
 * Methods a customer does not choose: credit terms for trade accounts, the
 * marketplace's own escrow, the import's placeholder. Offering "Tempo" to a
 * stranger on WhatsApp would be offering credit.
 */
/**
 * The shop's own name (owner, 2026-10-27: *"ofc it is macbook nusantara"*).
 * A customer asking "benar ini Macbook Nusantara?" was handed to a person
 * because the bot could not vouch for a name it was never given. Settings'
 * `shop.name` wins when it names the shop; empty — or demo text that does not
 * mention Nusantara — falls back to the shop's real name, the way the faktur's
 * address does (`SHOP_ADDRESS`).
 */
export const SHOP_NAME = "Macbook Nusantara";

export function shopName(setting: string | null | undefined): string {
  const v = setting?.trim() ?? "";
  return /nusantara/i.test(v) ? v : SHOP_NAME;
}

const NOT_CUSTOMER_FACING = new Set(["TEMPO", "MARKETPLACE", "B2SOFT"]);

/** The shop's own words for a method, by code. Unknown codes keep their label. */
const PAYMENT_WORDS: Readonly<Record<string, string>> = {
  TUNAI: "tunai (cash)",
  TRANSFER: "transfer bank",
  QRIS: "QRIS",
  DEBIT: "kartu debit",
  KARTU_KREDIT: "kartu kredit",
  CICILAN: "cicilan",
  COD: "COD (bayar di tempat)",
  BAYAR_TOKO: "bayar langsung di toko",
};

export async function loadStoreFacts(db: PrismaClient): Promise<StoreFacts> {
  const [settings, stores, methods] = await Promise.all([
    db.appSetting.findMany({
      where: {
        key: {
          in: [
            "shop.name",
            "shop.contact",
            DP_SETTING_KEYS.amount,
            DP_SETTING_KEYS.days,
          ],
        },
      },
      select: { key: true, value: true },
    }),
    db.location.findMany({
      where: { active: true, kind: "TOKO" },
      select: { name: true, address: true },
      orderBy: { sortOrder: "asc" },
    }),
    db.paymentMethod.findMany({
      where: { active: true, forSale: true },
      select: { code: true, label: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);
  const setting = (key: string) =>
    settings.find((s) => s.key === key)?.value.trim() || null;
  return {
    name: shopName(setting("shop.name")),
    contact: setting("shop.contact"),
    stores,
    paymentMethods: methods
      .filter((m) => !NOT_CUSTOMER_FACING.has(m.code))
      .map((m) => PAYMENT_WORDS[m.code] ?? m.label),
    dp: dpRuleOf({
      amount: setting(DP_SETTING_KEYS.amount),
      days: setting(DP_SETTING_KEYS.days),
    }),
  };
}

/**
 * The facts as the prompt carries them — plain sentences, because a small
 * model copies the shape of what it reads, and a bulleted block comes back as
 * a bulleted WhatsApp message.
 *
 * Stable for a whole day and more, so it sits in the cached part of the
 * prompt; whether the shop is open RIGHT NOW is per turn and lives elsewhere.
 */
export function renderStoreFacts(facts: StoreFacts): string {
  const lines: string[] = [];
  if (facts.name) lines.push(`The shop is called ${facts.name}.`);
  const withAddress = facts.stores.filter((s) => s.address);
  if (withAddress.length > 0) {
    for (const s of withAddress)
      lines.push(`The shop at ${s.name} is at ${s.address}.`);
  } else {
    lines.push(
      "The shop's street address is not recorded in the system. Use the approved answer about the location if there is one; otherwise hand over.",
    );
  }
  lines.push(
    `It is open every day from ${String(STORE_HOURS.openHour).padStart(2, "0")}.00 to ${STORE_HOURS.closeHour}.00 WIB (Jakarta time).`,
  );
  if (facts.contact) lines.push(`The shop's contact: ${facts.contact}.`);
  if (facts.paymentMethods.length > 0)
    lines.push(
      `At the shop a customer can pay by ${facts.paymentMethods.join(", ")}.`,
    );
  lines.push(
    `To keep a unit for a customer, the shop asks a DP of Rp ${String(facts.dp.amount).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} and holds the unit ${facts.dp.days} days; the customer sends the transfer proof and a colleague checks it before anything is held. Without a DP nothing is held.`,
  );
  return lines.join("\n");
}

// --- the catalogue -------------------------------------------------------------

/** How many models one lookup may return. Past this the customer should narrow. */
const CATALOG_LIMIT = 5;

/** Words that are in every model name and so pick nothing out. */
const CATALOG_NOISE = new Set([
  "macbook",
  "apple",
  "laptop",
  "yang",
  "kak",
  "ka",
  "ada",
  "ga",
  "gak",
  "ya",
  "berapa",
  "brp",
  "apa",
  "aja",
  "saja",
  "spek",
  "spec",
  "varian",
  "tipe",
  "type",
  "nya",
  "yg",
  "dan",
  "atau",
  "ram",
  "ssd",
  "storage",
]);

function catalogWords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[%_\\]/g, " ")
    .split(/[^\p{L}\p{N}.]+/u)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !CATALOG_NOISE.has(w))
    .slice(0, 6);
}

/**
 * Which models and configurations match a customer's words — specifications
 * only.
 *
 * Every word must match the model's name, line, year, size, identifier or
 * category, or one of its variant labels, so "air m2" does not return every
 * Air. No price is selected, no unit is read, and the result says so, because
 * a model that sees a list of machines will otherwise assume they are for sale.
 */
export async function lookupCatalog(
  db: PrismaClient,
  args: Record<string, unknown>,
): Promise<unknown> {
  const words = catalogWords(String(args["query"] ?? ""));
  if (words.length === 0)
    return {
      found: false,
      guidance: "Say which model you mean, e.g. 'air m2' or 'pro 14 m3'.",
    };

  const models = await db.catalogModel.findMany({
    where: {
      archived: false,
      AND: words.map((w) => ({
        OR: [
          { name: { contains: w, mode: "insensitive" as const } },
          { line: { contains: w, mode: "insensitive" as const } },
          { year: { contains: w, mode: "insensitive" as const } },
          { identifier: { contains: w, mode: "insensitive" as const } },
          { category: { name: { contains: w, mode: "insensitive" as const } } },
          {
            skus: {
              some: {
                archived: false,
                OR: [
                  { name: { contains: w, mode: "insensitive" as const } },
                  {
                    variantLabel: { contains: w, mode: "insensitive" as const },
                  },
                ],
              },
            },
          },
        ],
      })),
    },
    select: {
      name: true,
      year: true,
      sizeInch: true,
      category: { select: { name: true } },
      axes: {
        where: { removedAt: null },
        orderBy: { sortOrder: "asc" },
        select: {
          name: true,
          values: {
            where: { removedAt: null },
            orderBy: { sortOrder: "asc" },
            select: { value: true },
          },
        },
      },
      skus: {
        where: { archived: false },
        orderBy: { name: "asc" },
        // Never `price`, never `landed`, never a unit: see the file's docblock.
        select: { variantLabel: true, name: true },
        take: 12,
      },
    },
    orderBy: [{ year: "desc" }, { name: "asc" }],
    take: CATALOG_LIMIT,
  });

  if (models.length === 0) {
    return {
      found: false,
      guidance:
        "No model in the shop's catalogue matches. Do not describe one from memory; hand over.",
    };
  }

  return {
    found: true,
    models: models.map((m) => ({
      model: m.name,
      category: m.category.name,
      ...(m.year ? { year: m.year } : {}),
      ...(m.sizeInch !== null ? { sizeInch: m.sizeInch.toString() } : {}),
      ...(m.axes.length > 0
        ? {
            options: Object.fromEntries(
              m.axes.map((a) => [a.name, a.values.map((v) => v.value)]),
            ),
          }
        : {}),
      configurations: [
        ...new Set(m.skus.map((s) => s.variantLabel ?? s.name).filter(Boolean)),
      ],
    })),
    guidance:
      "These are the configurations the shop deals in, NOT what is in stock today and NOT a price. " +
      "You may say which configurations a model comes in. Never say one is available, and hand " +
      "over for stock, price or condition.",
  };
}
