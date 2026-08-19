import { theme, type ThemeConfig } from "antd";
import {
  FONT_FAMILY,
  FONT_FAMILY_CODE,
  LAYOUT,
  RADIUS,
  SEED,
  SPACE,
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
 *    the other seven.
 *
 * 2. **Component overrides read resolved tokens, not literals.** The sider
 *    needs "the container background", not `#ffffff` — otherwise dark mode is
 *    light mode with a black hole in it. We resolve the base theme first with
 *    `getDesignToken`, then feed those values into the component layer.
 */

/** Seeds and scale — everything the algorithm derives the rest from. */
function seedTokens(): ThemeConfig["token"] {
  return {
    colorPrimary: SEED.primary,
    colorSuccess: SEED.success,
    colorWarning: SEED.warning,
    colorError: SEED.error,
    colorInfo: SEED.info,

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
  const base: ThemeConfig = { token: seedTokens(), algorithm };

  // Resolve the base theme so the component layer below can refer to derived
  // colours by role. `getDesignToken` is antd's supported way to read tokens
  // outside React, which is exactly where we are.
  const t = theme.getDesignToken(base);

  return {
    ...base,
    components: {
      /**
       * The shell. Ant Design Pro puts the nav on the same surface as the
       * content and separates them with a hairline rather than a colour
       * change — calmer than antd's default navy sider, and it survives the
       * flip to dark mode without a second set of colours.
       */
      Layout: {
        headerHeight: LAYOUT.headerHeight,
        headerBg: t.colorBgContainer,
        headerPadding: 0,
        siderBg: t.colorBgContainer,
        lightSiderBg: t.colorBgContainer,
        bodyBg: t.colorBgLayout,
        triggerBg: t.colorBgContainer,
        triggerColor: t.colorText,
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
