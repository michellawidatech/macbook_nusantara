import { theme, type ThemeConfig } from "antd";
import {
  BRAND_DEEP,
  FONT_FAMILY,
  FONT_FAMILY_CODE,
  LAYOUT,
  NAV,
  RADIUS,
  SEED,
  SELECTION,
  SPACE,
  SURFACE,
  TYPE,
  WEIGHT,
  type ResolvedColorScheme,
} from "./tokens";

/**
 * Builds the antd theme for a colour scheme.
 *
 * This is where the primitives in `tokens.ts` become an antd `ThemeConfig`.
 * Two rules shape the file:
 *
 * 1. **Seeds only, never derived steps.** We set `colorPrimary`; we never set
 *    `colorPrimaryHover`. antd derives the hover, active, border, and tint
 *    steps from the seed, and hand-setting one of them desynchronises it from
 *    the other seven. ONE exception: the fill of a selected thing, whose
 *    derivation from this deep a seed is a mid green in light and invisible
 *    in dark (`SELECTION` in tokens.ts, owner report 2026-09-19).
 *
 * 2. **Component overrides read resolved tokens, not literals.** The sider
 *    needs "the container background", not `#ffffff` — otherwise dark mode is
 *    light mode with a black hole in it. We resolve the base theme first with
 *    `getDesignToken`, then feed those values into the component layer.
 */

/** Seeds and scale — everything the algorithm derives the rest from. */
function seedTokens(scheme: ResolvedColorScheme): ThemeConfig["token"] {
  // The dark scheme's own seed — see `SEED.primaryDark`. Info follows it,
  // because links take their colour from info.
  const primary = scheme === "dark" ? SEED.primaryDark : SEED.primary;
  const info = scheme === "dark" ? SEED.primaryDark : SEED.info;
  return {
    colorPrimary: primary,
    colorSuccess: SEED.success,
    colorWarning: SEED.warning,
    colorError: SEED.error,
    colorInfo: info,

    // What a selected thing is filled with. The exception to "seeds only" —
    // `SELECTION` in tokens.ts says why.
    colorPrimaryBg: SELECTION[scheme].bg,
    colorPrimaryBgHover: SELECTION[scheme].bgHover,
    controlItemBgActive: SELECTION[scheme].bg,
    controlItemBgActiveHover: SELECTION[scheme].bgHover,

    fontFamily: FONT_FAMILY,
    fontFamilyCode: FONT_FAMILY_CODE,
    fontSize: TYPE.md,
    fontWeightStrong: WEIGHT.strong,

    borderRadius: RADIUS.control,
    borderRadiusLG: RADIUS.surface,
    borderRadiusSM: RADIUS.chip,

    // antd's spacing derivation already lands on the 4px grid that SPACE
    // documents (padding 16 / paddingLG 24 / paddingXL 32), so we leave
    // `sizeUnit` and `sizeStep` alone rather than restating the defaults.
  };
}

/**
 * The antd theme for a scheme, ready for `ConfigProvider`.
 *
 * @param scheme Which of the two rendered schemes to build.
 */
export function buildTheme(scheme: ResolvedColorScheme): ThemeConfig {
  const algorithm =
    scheme === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm;
  const surface = SURFACE[scheme];
  const base: ThemeConfig = {
    token: {
      ...seedTokens(scheme),
      // The page behind the cards, tinted to the mark's hue — see SURFACE.
      // Set on the SEED layer rather than as a Layout component override so
      // that everything antd derives from it (the alternate fill a table
      // header composites, Empty's illustration ground) follows it.
      colorBgLayout: surface.layout,
    },
    algorithm,
  };

  // Resolve the base theme so the component layer below can refer to derived
  // colours by role. `getDesignToken` is antd's supported way to read tokens
  // outside React, which is exactly where we are.
  const t = theme.getDesignToken(base);

  return {
    ...base,
    components: {
      /**
       * The shell, in three tiers: nav, page, content.
       *
       * The nav is the mark's own dark green (owner ask 2026-09-01). It was a
       * 4%-saturation tint of that green from 2026-08-26, and the note here
       * used to argue against going the whole way: "a Menu token changed for
       * the sider is a Menu token changed for every dropdown in the app". That
       * hazard is real and is still respected — it is simply not solved here.
       * `AppLayout` wraps the nav `<Menu>` alone in a nested `ConfigProvider`
       * built from `NAV` in tokens.ts, so the dark treatment reaches that one
       * element and nothing else. This block only paints the ground.
       *
       * `triggerColor` follows the ground rather than `colorText`: on a dark
       * sider the body colour is near-black on near-black.
       */
      Layout: {
        headerHeight: LAYOUT.headerHeight,
        headerBg: surface.sider,
        headerPadding: 0,
        siderBg: surface.sider,
        lightSiderBg: surface.sider,
        bodyBg: surface.layout,
        triggerBg: surface.sider,
        triggerColor: NAV.text,
      },

      /**
       * Nav items sit inset from the sider edge with a rounded selected pill,
       * the Pro treatment. `activeBarWidth: 0` removes antd's right-edge
       * indicator bar, which would double up with the pill.
       *
       * `itemSelectedColor` is deliberately `colorText` rather than the
       * primary that antd defaults to. antd pairs primary text with the pale
       * primary background, and that pairing does not reach WCAG AA in either
       * scheme — 3.66:1 in light, 2.47:1 in dark, where no primary step clears
       * 4.5:1 at all. The tinted pill is a strong enough "you are here" on its
       * own, so the label keeps the body text colour and stays legible.
       */
      Menu: {
        itemBg: "transparent",
        subMenuItemBg: "transparent",
        itemBorderRadius: RADIUS.control,
        itemMarginInline: SPACE.sm,
        itemHeight: 40,
        collapsedWidth: LAYOUT.siderCollapsedWidth,
        activeBarWidth: 0,
        iconSize: TYPE.md,
        itemSelectedBg: t.colorPrimaryBg,
        itemSelectedColor: t.colorText,
        itemHoverBg: t.colorFillTertiary,
      },

      /** Flat cards with a hairline edge — Pro shows no shadow at rest. */
      Card: {
        borderRadiusLG: RADIUS.surface,
      },

      /**
       * 600-weight header on the alternate fill, matching Pro's tables.
       *
       * No `headerBg` here — antd's own default already computes it as
       * `colorFillAlterSolid`, the "alternate fill" `colorFillAlter`
       * composited onto `colorBgContainer`, which is the exact colour this
       * block used to set by hand via `t.colorFillAlter`. The difference is
       * that antd's version is opaque and the hand-set one was the raw
       * translucent alias.
       *
       * That translucency was invisible until the variant table grew
       * `fixed: 'left'`/`fixed: 'right'` columns. `.ant-table-thead > tr >
       * th` (the rule carrying `headerBg`) outspecifies `.ant-table-cell-fix-*`
       * (the rule that otherwise paints fixed cells opaque with `tableBg`),
       * so a translucent `headerBg` makes every fixed column's header
       * see-through — the header of whatever column had scrolled underneath
       * read through it, "SKU" bleeding into "Photo". Deleting the override
       * restores the opaque composite and fixes that without changing the
       * rendered colour.
       */
      Table: {
        headerSplitColor: "transparent",
        borderRadiusLG: RADIUS.surface,
      },
    },
  };
}

/**
 * The nav Menu's theme, for the nested `ConfigProvider` around it alone.
 *
 * The owner asked for a dark green nav with a white selected pill and dark
 * green text in it (2026-09-01). Every value it takes is a Menu token, and
 * that is exactly the hazard `buildTheme` warns about: a Menu token set in the
 * app theme is a Menu token set for every Dropdown, Select and context menu in
 * the app, all of which sit on white cards where light-on-green would be
 * invisible.
 *
 * So the override is scoped by the tree instead of by the token. `AppLayout`
 * puts this on a `ConfigProvider` wrapping the nav `<Menu>` element and
 * nothing else — deliberately not the whole Sider, because the account
 * Dropdown that lives in the sider's foot renders a Menu of its own on a
 * white popup surface, and it must keep the app theme.
 *
 * Returned as a whole `ThemeConfig` rather than merged into the caller's:
 * antd's nested ConfigProvider already inherits everything not restated, so
 * the component layer here is the entire delta.
 */
export function navTheme(): ThemeConfig {
  return {
    components: {
      Menu: {
        itemBg: "transparent",
        subMenuItemBg: "transparent",
        itemBorderRadius: RADIUS.control,
        itemMarginInline: SPACE.sm,
        itemHeight: 40,
        collapsedWidth: LAYOUT.siderCollapsedWidth,
        activeBarWidth: 0,
        iconSize: TYPE.md,

        // The inversion the owner asked for: a white pill with the mark's
        // green on it. 8.6:1 — the highest-contrast pairing in the app, which
        // is right for the one control that says where you are.
        itemSelectedBg: NAV.selectedBg,
        itemSelectedColor: BRAND_DEEP,

        // White at 85% rather than a neutral grey. A grey over a saturated
        // green reads as dirt; this reads as "not selected".
        itemColor: NAV.text,
        itemHoverBg: NAV.hoverBg,
        itemHoverColor: NAV.textStrong,

        // A collapsed section whose child is the current page. antd would
        // paint it `colorPrimary`, which on this ground is green on green.
        subMenuItemSelectedColor: NAV.textStrong,

        // The expand/collapse chevron, and the ground behind an open section's
        // children. Left to the app theme, both are drawn for a light sider.
        itemDisabledColor: "rgba(255, 255, 255, 0.35)",
        popupBg: BRAND_DEEP,
      },
    },
  };
}
