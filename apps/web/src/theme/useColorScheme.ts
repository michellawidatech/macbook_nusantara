import { useContext } from "react";
import { ColorSchemeContext, type ColorSchemeContextValue } from "./context";

/** Reads the colour scheme context. Throws if used outside ThemeProvider. */
export function useColorScheme(): ColorSchemeContextValue {
  const value = useContext(ColorSchemeContext);
  if (value === null) {
    throw new Error("useColorScheme must be used inside <ThemeProvider>");
  }
  return value;
}
