/**
 * What PRODUCT a model name is, and its name in full (owner decision
 * 2026-10-21: *"I personally think the full naming would be better"*).
 *
 * A product is the line, the screen size, and the year — or, on Apple
 * silicon, the chip instead of the year — plus anything that genuinely makes
 * it a different machine (`TB`, a Touch Bar Pro). An Intel processor is NOT
 * part of the product: `i3`, `i5` and `i7` are variants of one MacBook Air
 * 13" 2020, beside RAM and SSD. Until this, the catalogue held that one
 * product as `MacBook Air 13" 2020`, `AIR 13" 2020` and `AIR 13" 2020 I5`.
 *
 * The product NAME is the full form — `MacBook Air 13" 2020`; the SKU code
 * stays in the shop's short form (`skuCodeFor`, `AIR 13" 2020 I5 8/256`).
 *
 * A name this cannot place — an accessory, a spare part — has no identity and
 * is never grouped or renamed.
 */
import { isAppleSilicon } from "./productCode.js";

export interface ModelIdentity {
  /** `MacBook Air`, `iPad Pro`. */
  readonly family: string;
  readonly sizeInch?: number;
  /** The year, or on Apple silicon the chip: `2020`, `M2`, `M3 PRO`. */
  readonly era: string;
  /** An Intel processor named in the model name — a VARIANT, not the product. */
  readonly intelChip?: string;
  /** What else makes it a different product, as written: `TB`, `RETINA`. */
  readonly extra?: string;
}

/**
 * How a name STARTS; whatever follows the family and is not a size, year or
 * chip is the product's `extra` (`IPAD MINI 6 GEN 2021` → `6 GEN`). Longest
 * first, so `MACBOOK AIR` is tried before `MACBOOK`.
 */
const FAMILIES: readonly (readonly [RegExp, string])[] = [
  [/^(?:MACBOOK\s+)?AIR(?=\s|$)/, "MacBook Air"],
  [/^MACBOOK\s+PRO(?=\s|$)/, "MacBook Pro"],
  [/^PRO(?=\s|$)/, "MacBook Pro"],
  [/^MACBOOK(?=\s|$)/, "MacBook"],
  [/^IMAC\s+PRO(?=\s|$)/, "iMac Pro"],
  [/^IMAC(?=\s|$)/, "iMac"],
  [/^MAC\s+MINI(?=\s|$)/, "Mac mini"],
  [/^MAC\s+STUDIO(?=\s|$)/, "Mac Studio"],
  [/^MAC\s+PRO(?=\s|$)/, "Mac Pro"],
  [/^IPAD\s+AIR(?=\s|$)/, "iPad Air"],
  [/^IPAD\s+PRO(?=\s|$)/, "iPad Pro"],
  [/^IPAD\s+MINI(?=\s|$)/, "iPad mini"],
  [/^IPAD(?=\s|$)/, "iPad"],
];

// The unit is glued to its number, as in `productCode`'s CONFIG: `8/512 TB`
// is a 512GB Touch Bar machine and `2017 TB` a 2017 one, not a capacity.
const CONFIG_ANY = /\b\d{1,3}(?:GB)?\s*\/\s*\d{1,4}(?:[.,]\d)?(?:GB|TB)?\b/gi;
const CAPACITY = /\b\d{1,4}(?:[.,]\d)?(?:GB|TB)\b/gi;
const SIZE = /\b(\d{1,2}(?:[.,]\d)?)\s*(?:"|''|INCH\b|IN\b)/i;
const YEAR = /\b(20[0-3]\d)\b/;
const CHIP = /\b(I[3579]|M\d(?:\s+(?:PRO|MAX|ULTRA))*|CORE\s+M)\b/i;

/** Read a model name (and its release year, for a name without one). */
export function modelIdentity(
  name: string,
  releaseYear?: number | string,
): ModelIdentity | null {
  let text = name
    .toUpperCase()
    .replace(/[(),]/g, " ")
    .replace(CONFIG_ANY, " ")
    .replace(CAPACITY, " ")
    .replace(/\s+/g, " ")
    .trim();
  const found = FAMILIES.find(([re]) => re.test(text));
  if (found === undefined) return null;
  const [familyRe, family] = found;
  text = text.replace(familyRe, " ");
  const size = SIZE.exec(text);
  const year = YEAR.exec(text);
  const chip = CHIP.exec(text);
  for (const m of [size, year, chip]) {
    if (m) text = text.replace(m[0], " ");
  }
  // `PRO 13" 2017 TB 8/256 TB` says Touch Bar twice; it is still one.
  const extra = [...new Set(text.split(/\s+/).filter((w) => w !== ""))].join(
    " ",
  );
  const sizeInch = size ? Number(size[1]!.replace(",", ".")) : undefined;
  const yearText =
    year?.[1] ??
    (releaseYear === undefined || releaseYear === ""
      ? undefined
      : String(releaseYear));
  const chipText = chip?.[1]?.replace(/\s+/g, " ");
  const silicon = chipText !== undefined && isAppleSilicon(chipText, yearText);
  const era = silicon ? chipText! : yearText;
  if (era === undefined) return null;
  return {
    family,
    ...(sizeInch === undefined ? {} : { sizeInch }),
    era,
    ...(!silicon && chipText !== undefined
      ? { intelChip: chipText.toLowerCase() }
      : {}),
    ...(extra === "" ? {} : { extra }),
  };
}

/**
 * Two names are one product when this is equal. The size is compared by its
 * whole inches — the shop writes the 2017 Air as both `13"` and `13.3"`.
 */
export function identityKey(id: ModelIdentity): string {
  return [
    id.family.toUpperCase(),
    id.sizeInch === undefined ? "" : String(Math.floor(id.sizeInch)),
    id.era.toUpperCase(),
    id.extra ?? "",
  ].join("|");
}

/** `MacBook Air 13" 2020`, `MacBook Pro 14" M3 Pro`, `Mac mini M2`. */
export function fullModelName(id: ModelIdentity): string {
  const era = /^M\d/.test(id.era)
    ? id.era.replace(
        /\b(PRO|MAX|ULTRA)\b/g,
        (w) => w[0] + w.slice(1).toLowerCase(),
      )
    : id.era;
  return [
    id.family,
    id.sizeInch === undefined
      ? ""
      : `${String(id.sizeInch).replace(/\.0$/, "")}"`,
    era,
    id.extra ?? "",
  ]
    .filter((p) => p !== "")
    .join(" ");
}

/**
 * The products whose name can simply be written in full: recognised, not
 * carrying an Intel processor (that one is a mis-filed variant and needs a
 * person), and not sharing its identity with another product (renaming one of
 * two duplicates would only make them look alike).
 */
export function fullNameRenames(
  models: readonly { id: string; name: string; releaseYear: number }[],
): { id: string; from: string; to: string }[] {
  const ids = models.map((m) => ({
    m,
    id: modelIdentity(m.name, m.releaseYear),
  }));
  const count = new Map<string, number>();
  for (const { id } of ids) {
    if (id) count.set(identityKey(id), (count.get(identityKey(id)) ?? 0) + 1);
  }
  return ids.flatMap(({ m, id }) => {
    if (!id || id.intelChip || count.get(identityKey(id))! > 1) return [];
    const to = fullModelName(id);
    return to === m.name ? [] : [{ id: m.id, from: m.name, to }];
  });
}
