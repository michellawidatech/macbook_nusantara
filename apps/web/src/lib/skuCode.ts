import { parseProductName, shopProductName } from "./productCode.js";

/**
 * One variant's SKU CODE, in the shop's own naming convention (owner ask
 * 2026-09-21: *"in the SKU and product input, actually they use the naming
 * convention in stock persediaan"*).
 *
 * `AIR 13" 2020 I5 8/256` — B2Soft's `PERSEDIAAN BARANG` spelling, which the
 * shop has read its stock off for years and which the bookkeeper's sheets
 * start from. It replaces `nextId("SKU")`, which produced `SKU_17`: a code
 * nobody could look up, match against a supplier's quotation or find in the
 * old system.
 *
 * The MODEL NAME is read for its parts rather than trusted to be in the
 * convention (`parseProductName`), because a product added by hand or brought
 * in from AppleDB is named however whoever added it named it. A name the
 * convention cannot read — an accessory, a spare part — keeps its own words
 * and simply gains the variant, which is the honest answer: `KOLI` has no
 * chip, no size and nothing to configure.
 *
 * Deliberately NOT unique on its own. Two products genuinely named the same
 * thing are the same thing, and `Sku.code` is unique in the schema, so the
 * caller appends a discriminator when the shop really does hold two.
 */
export function skuCodeFor(
  modelName: string,
  year: number | string | undefined,
  variantLabel: string,
  axisNames?: readonly string[],
): string {
  const { chip: variantChip, ram, ssd } = variantParts(variantLabel, axisNames);
  /*
   * The model name and the variant read TOGETHER, as the convention prints
   * them: `MacBook Air 13" 2020` alone has no configuration, so the parser
   * cannot tell its line from its size and year, and printed
   * `MACBOOK AIR 13" 2020 2020 I7 8/128` (2026-10-21). RAM goes in as a bare
   * number, because `8GB/128GB` reads as storage only.
   */
  const config =
    ram && ssd ? `${ram.replace(/\s*GB$/i, "")}/${ssd}` : (ssd ?? ram ?? "");
  const parsed = parseProductName(
    [modelName, variantChip ?? "", config].filter((x) => x !== "").join(" "),
  );
  const name = shopProductName({
    // The convention's line is already short — `AIR`, `PRO`.
    line: parsed.line.replace(/^MACBOOK\s+/, ""),
    ...(parsed.sizeInch === undefined ? {} : { sizeInch: parsed.sizeInch }),
    year: parsed.year ?? (year === undefined ? null : String(year)),
    ...(parsed.chip === undefined ? {} : { chip: parsed.chip }),
    ...(parsed.ram === undefined ? {} : { ram: parsed.ram }),
    ...(parsed.ssd === undefined ? {} : { ssd: parsed.ssd }),
    ...(parsed.extra === undefined ? {} : { extra: parsed.extra }),
  });
  return name === "" ? modelName.trim().toUpperCase() : name;
}

/**
 * Which part of a variant label is the chip, the RAM and the storage.
 *
 * `combos` joins the model's axes in their own order — `8GB / 256GB` for
 * RAM × SSD, `i7 / 8GB / 128GB` for Chip × RAM × SSD (2026-10-21: a code
 * minted from the second shape lost its chip). The axis NAMES say which is
 * which when the caller has them; without them a size is RAM then storage and
 * anything else is the chip.
 */
export function variantParts(
  variantLabel: string,
  axisNames?: readonly string[],
): { chip?: string; ram?: string; ssd?: string } {
  const values = variantLabel.split(/\s*[/·]\s*/).map((v) => v.trim());
  const out: { chip?: string; ram?: string; ssd?: string } = {};
  values.forEach((v, i) => {
    if (v === "") return;
    const axis = axisNames?.[i]?.toUpperCase() ?? "";
    if (/CHIP|CPU|PROCESSOR/.test(axis)) out.chip = v;
    else if (/RAM|MEMORY/.test(axis)) out.ram = v;
    else if (/SSD|STORAGE/.test(axis)) out.ssd = v;
    else if (/^\d+\s*(GB|TB)$/i.test(v)) {
      if (out.ram === undefined) out.ram = v;
      else out.ssd = v;
    } else out.chip ??= v;
  });
  return out;
}

/** A SKU code minted before the convention: `SKU_17`, `SKU_HIBGR8C90134KEFC`. */
export function isMachineSkuCode(code: string): boolean {
  return /^SKU_/i.test(code);
}

/** A code nothing else in the catalogue is using. See `skuCodeFor`. */
export function freeSkuCode(
  taken: ReadonlySet<string>,
  wanted: string,
): string {
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; n < 100; n += 1) {
    const tried = `${wanted} (${n})`;
    if (!taken.has(tried)) return tried;
  }
  return `${wanted} ${Date.now()}`;
}
