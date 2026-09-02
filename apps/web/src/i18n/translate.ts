/**
 * The lookup itself. No React here, so it can be unit-tested without rendering
 * and reused by both the provider and the shim's no-provider fallback.
 */
import { CATALOGUES, type Language } from "./catalogue.js";

export type Vars = Record<string, unknown>;

/**
 * react-i18next's `t`, narrowed to the call shapes this codebase actually uses:
 *
 *   t("Stock")
 *   t("common.delete", "Delete")
 *   t("deleteAction.aria", "Delete {{entity}}", { entity })
 *   t("fill.guide.progress", { defaultValue: "{{current}} of {{total}}", ... })
 *
 * Identical to the signature the shim already had, which is what lets a
 * catalogue arrive without touching a single call site.
 */
export type TFunction = (
  key: string,
  defaultValue?: string | Vars,
  options?: Vars,
) => string;

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (m, name) =>
    name in vars ? String(vars[name]) : m,
  );
}

/**
 * Builds the `t` for one language.
 *
 * The chain is `catalogue[key] ?? catalogue[def] ?? def`, and the middle term is
 * the one that earns its keep. A page body translated later as
 * `t("stockOut.title", "Stock Out")` resolves through the NAV entry "Stock Out"
 * before anyone has added `stockOut.title` to `id.ts` — the nav block doubles as
 * a glossary. `catalogue.ts` records what that costs.
 */
export function makeT(language: Language): TFunction {
  const catalogue = CATALOGUES[language];
  return function t(key, defaultValue, options) {
    const def =
      typeof defaultValue === "string"
        ? defaultValue
        : ((defaultValue?.defaultValue as string | undefined) ?? key);
    const vars =
      typeof defaultValue === "string"
        ? options
        : (defaultValue as Vars | undefined);
    return interpolate(catalogue[key] ?? catalogue[def] ?? def, vars);
  };
}
