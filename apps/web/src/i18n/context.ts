import { createContext } from "react";
import type { Language } from "./catalogue.js";
import type { TFunction } from "./translate.js";

export interface LocaleContextValue {
  /**
   * The language actually rendering.
   *
   * There is no `system` here, unlike `ColorSchemePreference`. `navigator.
   * language` is a poor guess for this shop's staff — the browser is usually
   * English whatever the reader prefers — so the choice is explicit or it is
   * the default.
   */
  language: Language;
  setLanguage: (language: Language) => void;
  /**
   * Bound to `language`. Its identity changes only when the language does, so
   * it is safe in a dependency list.
   */
  t: TFunction;
}

export const LocaleContext = createContext<LocaleContextValue | null>(null);
