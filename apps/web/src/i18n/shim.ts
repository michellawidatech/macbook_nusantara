/**
 * Stand-in for react-i18next, aliased in `vite.config.ts`, `vitest.config.ts`
 * and `tsconfig.json`. The real package is not installed and does not need to
 * be: this app has two languages, no lazy-loaded namespaces and no plural
 * rules beyond what a template handles.
 *
 * This file is now only the react-i18next-shaped surface. The lookup lives in
 * `translate.ts` and the active language in `LocaleProvider.tsx`.
 */
import { useContext, useMemo } from "react";
import { LocaleContext, type LocaleContextValue } from "./context.js";
import { makeT } from "./translate.js";

/**
 * What `useTranslation` returns when there is no provider above it.
 *
 * It falls back rather than throwing, unlike `useLanguage` and
 * `useColorScheme`. Every test that renders one shared component on its own —
 * PageContainer, DeleteAction, EntitySelect, FillGuideModal — would otherwise
 * have to wrap it in a provider just to get back the English copy it was going
 * to get anyway. A read path whose failure mode is "the default language"
 * should not be able to fail the build. `setLanguage` is a no-op here for the
 * same reason: there is nothing above to tell.
 */
const FALLBACK: LocaleContextValue = {
  language: "en",
  setLanguage: () => undefined,
  t: makeT("en"),
};

export function useTranslation() {
  const { language, setLanguage, t } = useContext(LocaleContext) ?? FALLBACK;
  // Rebuilt only when the language actually moves, so a component that lists
  // `i18n` in a dependency array does not loop.
  return useMemo(
    () => ({ t, i18n: { language, changeLanguage: setLanguage } }),
    [t, language, setLanguage],
  );
}
