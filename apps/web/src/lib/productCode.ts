/**
 * The printed product code, re-exported.
 *
 * It moved to `@nusantara/domain` on 2026-09-07 because the SKU code is
 * DERIVED, and once the browser mock and the Postgres seed had to agree about
 * which SKUs exist (see `@nusantara/fixture`), the derivation had to be
 * somewhere both can import. `packages/domain` is where a pure rule lives; a
 * second copy in `apps/web` would be a second answer to "what is this SKU
 * called", printed on a sticker that outlives the disagreement.
 *
 * This file stays so that the ~dozen web modules importing `lib/productCode`
 * keep working, and because a label component has no business knowing which
 * package a formatting rule ended up in.
 */
export {
  productCode,
  productCodeLines,
  // The shop's own naming convention — B2Soft's `PERSEDIAAN BARANG` spelling
  // (owner ask 2026-09-21). What the SKU code and the product input use;
  // `productCode` is still what goes on a sticker.
  isAppleSilicon,
  parseProductName,
  shopProductName,
  type CodeParts,
  type ParsedProductName,
} from "@nusantara/domain";
