import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { App as AntdApp, ConfigProvider, theme as antdTheme } from "antd";
import { useAntdLocale } from "../i18n/antdLocale";
import { ColorSchemeContext, type ColorSchemeContextValue } from "./context";
import { renderRequiredMark } from "./requiredMark";
import { buildTheme } from "./theme";
import { ACCENT, BRAND_DEEP, NAV } from "./tokens";
import type { ColorSchemePreference, ResolvedColorScheme } from "./tokens";

const STORAGE_KEY = "xinchuan-cms.color-scheme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function isPreference(value: string | null): value is ColorSchemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * The stored preference, or `system` if there isn't a usable one.
 *
 * Reads defensively: Safari throws on `localStorage` in private browsing, and
 * a theme preference is not worth taking the whole app down for.
 */
function readStoredPreference(): ColorSchemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isPreference(stored) ? stored : "light";
  } catch {
    return "light";
  }
}

function systemScheme(): ResolvedColorScheme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Supplies the design system to the tree: antd's theme, the control variant,
 * the locale, and the `App` context that `App.useApp()` reads.
 *
 * `AntdApp` lives here rather than in `main.tsx` because it has to sit *inside*
 * `ConfigProvider` to pick up the theme — message and modal instances created
 * outside it render unthemed.
 *
 * ⚠️ DO NOT put `variant` on a `<Form>` to get borderless fields. antd resolves
 * a control's variant as: own prop → the enclosing Form's VariantContext →
 * ConfigProvider's per-component value → ConfigProvider's global value. `Card`
 * reads that same chain, and both stock pages nest their Cards INSIDE the Form
 * — so `<Form variant="filled">` would resolve Card's variant to `filled`,
 * which is not `borderless`, and the cards would silently keep their hairline
 * despite the `card` setting below. Leaving Form's variant undefined lets the
 * chain fall through correctly.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const [preference, setPreferenceState] =
    useState<ColorSchemePreference>(readStoredPreference);
  const [system, setSystem] = useState<ResolvedColorScheme>(systemScheme);
  // The app has exactly one ConfigProvider, and it is below. i18next holds the
  // language and this hook hands antd's bundle over rather than rendering a
  // second ConfigProvider that would own half the configuration.
  const antdLocale = useAntdLocale();

  // Track the OS setting even when the preference is not `system`, so
  // switching back to `system` lands on the right scheme immediately.
  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      setSystem(event.matches ? "dark" : "light");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const setPreference = useCallback((next: ColorSchemePreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A preference that cannot be persisted still applies for this session.
    }
  }, []);

  const resolved: ResolvedColorScheme =
    preference === "system" ? system : preference;

  // Lets the browser theme form controls, scrollbars, and the address bar to
  // match. Without it, a dark app still gets white native scrollbars.
  useEffect(() => {
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  /**
   * Publishes the spot colours that global.css needs.
   *
   * They are not antd tokens — the gradient is painted over `colorPrimary` and
   * the gold is never a surface — so `ConfigProvider` has no way to expose
   * them, and writing the hexes into the stylesheet would fork them from
   * `tokens.ts`.
   *
   * No CSS fallbacks are needed for the frame before this runs: a
   * `linear-gradient()` referring to an undefined custom property is an
   * invalid declaration, so the browser drops it and the button keeps antd's
   * solid primary. It degrades to the old design rather than to nothing.
   */
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--nusantara-gold", ACCENT.gold);
    root.style.setProperty("--nusantara-gradient-from", ACCENT.gradientFrom);
    root.style.setProperty("--nusantara-gradient-to", ACCENT.gradientTo);
    // The nav column's own colours, for the `.nusantara-nav-foot` rules in
    // global.css. Same argument as the gold: they are not antd tokens — the
    // nav Menu gets them through a nested ConfigProvider — so nothing else
    // could publish them, and a literal in the stylesheet would be a second
    // definition of the same three values.
    root.style.setProperty("--nusantara-nav-text", NAV.text);
    root.style.setProperty("--nusantara-nav-text-strong", NAV.textStrong);
    root.style.setProperty("--nusantara-nav-hover", NAV.hoverBg);
    // The mark's deep green, for the two surfaces that carry white text in
    // both schemes: the till's total panel and the app's active tab. The
    // primary itself is too light for white text in the dark scheme (see
    // `SEED.primaryDark`), so neither may borrow it.
    root.style.setProperty("--nusantara-brand-deep", BRAND_DEEP);
  }, []);

  const themeConfig = useMemo(() => buildTheme(resolved), [resolved]);

  /**
   * The two colours `global.css` mixes the "over quota" row tint from.
   *
   * Published rather than written into the stylesheet for the same reason the
   * gold above is: they are theme tokens, and a literal `#fff1f0` in the CSS
   * would be a second definition that does not follow the algorithm — and, in
   * dark mode, a near-white block with white text on it. They are re-published
   * whenever the scheme changes, which is what makes the tint follow the flip.
   *
   * Deliberately not antd's own `--ant-*` variables: those exist only while
   * `cssVar` is on, which is a ConfigProvider setting this app does not set and
   * could turn off tomorrow without anyone connecting it to a table row going
   * transparent.
   */
  useEffect(() => {
    const t = antdTheme.getDesignToken(themeConfig);
    const root = document.documentElement;
    root.style.setProperty("--nusantara-error", t.colorError);
    // The receiving table's "arrived as a different product" accent.
    root.style.setProperty("--nusantara-warning", t.colorWarning);
    // Add payment's "paid in full" rows (2026-09-22), beside the warning's
    // "paid in part".
    root.style.setProperty("--nusantara-success", t.colorSuccess);
    root.style.setProperty("--nusantara-surface", t.colorBgContainer);
    // Published for the till's total panel and the catalogue's hover, both of
    // which tint with the brand colour rather than picking a green of their
    // own — see `.pos-total` and `.pos-shelf-row` in global.css.
    root.style.setProperty("--nusantara-primary", t.colorPrimary);
  }, [themeConfig]);

  const value = useMemo<ColorSchemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return (
    <ColorSchemeContext.Provider value={value}>
      <ConfigProvider
        locale={antdLocale}
        theme={themeConfig}
        // Every data-entry control, app-wide, in one place — inputs, selects,
        // number fields, date pickers, cascaders, mentions.
        //
        // `filled`, not `borderless`. Borderless is literally
        // `background: transparent; border: none`, which on the stock forms
        // renders a line as five invisible controls on a white card: no hit
        // target until focus, and no way to see that a Qty cell is empty
        // rather than absent. `filled` drops the outline — which is what was
        // asked for — and keeps a tinted shape that still reads as "type
        // here". Its error state is a tinted field rather than a red outline,
        // so validation stays in the same visual language.
        variant="filled"
        // Cards lose their hairline separately. `variant` is the v6 prop;
        // `bordered` still exists but is deprecated and dev-warns.
        card={{ variant: "borderless" }}
        // Every form's required marker, app-wide. `requiredMark` is a
        // Form-level setting that no `Form.Item` can override, so a global
        // renderer is the only way to say "* after the label" once — see
        // `requiredMark.tsx` for what it renders and which forms opt out.
        form={{ requiredMark: renderRequiredMark }}
      >
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </ColorSchemeContext.Provider>
  );
}
