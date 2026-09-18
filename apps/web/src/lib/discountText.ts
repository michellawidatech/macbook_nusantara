/**
 * The one phrasing of a discount, shared by the three screens that show one.
 *
 * `describeDiscount` in `lib/pricing.ts` answers WHAT a discount offers as a
 * tagged `DiscountShape`; this turns that into a sentence. It is a separate
 * file rather than a function in pricing.ts because it needs a `t`, and
 * pricing.ts is deliberately free of React and of i18n — a pure module a test
 * can read without a provider.
 *
 * The `t` is passed IN rather than pulled from a hook, so this stays callable
 * from a table column's `render`, from a Descriptions item and from a Select
 * option, none of which is a component. The key-and-English pairs are written
 * out below, which is what lets `test/i18n.test.ts` see them: the sweep reads
 * the source for that two-argument call shape, so a string assembled anywhere
 * else is a string it cannot check. (This paragraph deliberately does not
 * spell an example one out — the sweep would read it as a real call site, the
 * way `lib/condition.ts` records for the same reason.)
 */
import type { TFunction } from "../i18n/translate.js";
import { fmtRp } from "./format.js";
import type { DiscountShape } from "./pricing.js";

export function describeDiscountText(
  shape: DiscountShape,
  t: TFunction,
): string {
  if (shape.kind === "PCT") {
    return shape.maxRp === undefined
      ? t("discounts.shapePct", "{{pct}}%", { pct: shape.pct })
      : t("discounts.shapePctCapped", "{{pct}}% up to {{max}}", {
          pct: shape.pct,
          max: fmtRp(shape.maxRp),
        });
  }
  if (shape.kind === "NOMINAL") {
    return t("discounts.shapeNominal", "{{amount}} off", {
      amount: fmtRp(shape.amountRp),
    });
  }
  return t("discounts.shapeBundle", "Any {{qty}} for {{price}}", {
    qty: shape.qty,
    price: fmtRp(shape.priceRp),
  });
}
