import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import dayjs from "dayjs";
// Registers the locale WITHOUT switching to it — a dayjs locale file ends in
// `dayjs.locale(locale, null, true)`, where the third argument means "define,
// do not activate". English is built in and needs no import.
import "dayjs/locale/id";
import { isLanguage, type Language } from "./catalogue.js";
import { LocaleContext, type LocaleContextValue } from "./context.js";
import { makeT } from "./translate.js";
import { setDateLocale } from "../lib/format.js";

/**
 * Its own key, not a `xinchuan-cms.` one. ThemeProvider's `STORAGE_KEY` still
 * carries the old product's name and renaming it would silently reset every
 * user's colour scheme, which is not worth the tidiness — but a new key gets
 * the right name from the start.
 */
const STORAGE_KEY = "nusantara-pos.language";

const DAYJS_LOCALE: Record<Language, string> = { en: "en", id: "id" };

/**
 * The stored language, or English if there isn't a usable one.
 *
 * Reads defensively, exactly as `ThemeProvider` does: Safari throws on
 * `localStorage` in private browsing, and a language preference is not worth
 * taking the whole app down for.
 */
function readStoredLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLanguage(stored) ? stored : "en";
  } catch {
    return "en";
  }
}

/**
 * Two globals React does not own have to track `language`: dayjs's active
 * locale, which is where antd's DatePicker gets its month and weekday names
 * (ConfigProvider cannot reach them), and `lib/format.ts`'s date locale.
 *
 * NOT called from an effect. An effect fires after the first paint and neither
 * of these re-renders anything on its own, so a picker or a date cell that
 * mounted in that paint would sit in English until something unrelated
 * happened to re-render it.
 *
 * Called instead from the provider's own body on every render, and once at
 * module scope below for anything that formats a date before the provider has
 * mounted at all. Applying it every render rather than only when the language
 * changes is what makes "the globals match the language being rendered" true by
 * construction instead of by discipline — a second provider mounting from a
 * different stored value cannot leave the previous one's locale behind. It is
 * an assignment of two module variables, so the cost is nil and StrictMode's
 * double invoke is a non-question.
 */
function applyGlobals(language: Language): void {
  dayjs.locale(DAYJS_LOCALE[language]);
  setDateLocale(language);
}

applyGlobals(readStoredLanguage());

/**
 * Holds the active language for the whole app, and nothing else.
 *
 * Deliberately NOT merged into `ThemeProvider`, even though the two are twins:
 * ThemeProvider *consumes* this one through `useAntdLocale`, and a provider
 * that both owned the language and rendered the ConfigProvider depending on it
 * would be one you cannot mount in a test without dragging antd's whole theme
 * along.
 *
 * Exports only the component — a value exported beside it would break Fast
 * Refresh, which is why `context.ts`, `translate.ts` and `useLanguage.ts` are
 * separate files.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);

  // Before the children render, not after — see `applyGlobals`.
  applyGlobals(language);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A preference that cannot be persisted still applies for this session.
    }
  }, []);

  // Screen readers pick a voice from this and CSS `:lang()` keys off it.
  // Genuinely an effect: nothing paints from it, so a frame late costs nothing.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const t = useMemo(() => makeT(language), [language]);

  const value = useMemo<LocaleContextValue>(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}
