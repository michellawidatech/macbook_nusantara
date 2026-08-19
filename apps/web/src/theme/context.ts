import { createContext } from "react";
import type { ColorSchemePreference, ResolvedColorScheme } from "./tokens";

export interface ColorSchemeContextValue {
  /** What the user chose. `system` means "follow the OS". */
  preference: ColorSchemePreference;
  /**
   * What is actually on screen. `preference` of `system` resolves to whichever
   * the OS currently reports, so this is the value UI should branch on — a
   * moon icon should track what is rendered, not what was picked.
   */
  resolved: ResolvedColorScheme;
  setPreference: (preference: ColorSchemePreference) => void;
}

export const ColorSchemeContext = createContext<ColorSchemeContextValue | null>(
  null,
);
