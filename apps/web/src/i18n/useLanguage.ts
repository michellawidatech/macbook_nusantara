import { useContext } from "react";
import { LocaleContext, type LocaleContextValue } from "./context.js";

/**
 * Reads the locale context. Throws outside `<LocaleProvider>` — deliberately
 * unlike `useTranslation`, which falls back to English instead.
 *
 * The difference is what failing costs. `useTranslation` is the READ path, with
 * call sites in components a test may render on their own; a missing provider
 * there means English copy, which is the default anyway, so throwing would turn
 * a cosmetic gap into a failed suite. This is the WRITE path, used by exactly
 * one control — the switch in the header — and a switch that silently does
 * nothing is worse than a crash in the one place a developer will see it. Same
 * argument `useColorScheme` makes.
 */
export function useLanguage(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (value === null) {
    throw new Error("useLanguage must be used inside <LocaleProvider>");
  }
  return value;
}
