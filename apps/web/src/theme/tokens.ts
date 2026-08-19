/**
 * Design primitives — the single source of truth for the CMS's visual language.
 *
 * Everything here is a *primitive*: a raw value with a name. Nothing in this
 * file knows about antd. `theme.ts` maps these onto antd's `ThemeConfig`, and
 * components read the result through `theme.useToken()` — never from this file
 * directly. The one exception is `LAYOUT`, whose dimensions describe the app
 * shell rather than any antd component, so the shell reads it by name.
 *
 * The values follow Ant Design v6's design language, with the app-shell
 * proportions taken from Ant Design Pro (measured from preview.pro.ant.design):
 * a 56px header rather than antd's default 64, and a 208/48 sider.
 *
 * Adding a value here is cheap. Hard-coding one at a call site is what this
 * file exists to prevent.
 */

/**
 * Spacing scale. Every gap, inset, and gutter in the app comes from here.
 *
 * Ant Design snaps spacing to a 4px grid; these are the six steps it defines.
 * `xxl` is our own extension for page-level rhythm, kept on the grid.
 */
export const SPACE = {
  /** 4px — the grid unit itself. Hairline gaps between adjacent glyphs. */
  xs: 4,
  /** 8px — inside a control: icon to label. */
  sm: 8,
  /** 16px — between controls in a group. */
  md: 16,
  /** 24px — card padding, and the gutter between stacked cards. */
  lg: 24,
  /** 32px — between major sections of a page. */
  xl: 32,
  /** 48px — page-level breathing room on wide screens. */
  xxl: 48,
} as const;

/**
 * Corner radii, by the *kind* of thing being rounded rather than by size.
 *
 * Ant Design's rule: controls are 6px, surfaces 8px, chips and tooltips 4px.
 * Mixing radii on nested elements reads as a mistake — a card at 8 should not
 * contain a button at 16 — so these are named by role to make the right choice
 * the obvious one.
 */
export const RADIUS = {
  /** 4px — tags, tooltips, and other small chips. */
  chip: 4,
  /** 6px — buttons, inputs, selects. antd's default. */
  control: 6,
  /** 8px — cards, modals, drawers, and the content surface. */
  surface: 8,
} as const;

/**
 * Type scale. antd's base is 14px, not 16 — enterprise consoles trade
 * legibility headroom for density, and 14px is what lets a sidebar, a header,
 * and an eight-column table share a 1440px window comfortably.
 *
 * Only two weights exist in product UI: 400 for body, 600 for anything
 * title-grade. Bold and italic are not part of the interface voice.
 */
export const TYPE = {
  /** 12px — captions, table meta, timestamps. */
  sm: 12,
  /** 14px — body copy, controls, menu items. The base. */
  md: 14,
  /** 16px — section headings, and the sider's product name. */
  lg: 16,
  /** 20px — the page title in PageContainer. */
  xl: 20,
} as const;

/** The two weights the interface uses. */
export const WEIGHT = {
  regular: 400,
  strong: 600,
} as const;

/**
 * App-shell dimensions.
 *
 * These are structural rather than thematic: they describe how much room the
 * chrome takes, not what colour it is. The shell reads them directly because
 * antd has no token for "how wide is my sidebar".
 */
export const LAYOUT = {
  /**
   * 56px header. Ant Design Pro's proportion — antd's own default is 64, which
   * on a dense console spends height that the content wants.
   */
  headerHeight: 56,
  /** 208px expanded sider — Pro's width, wide enough for a two-word nav label. */
  siderWidth: 208,
  /** 48px collapsed sider — icons only, matching Pro. */
  siderCollapsedWidth: 48,
  /** Width past which content stops stretching and starts centring. */
  contentMaxWidth: 1600,
  /** The sticky submit bar on long forms. */
  footerToolbarHeight: 64,
  /**
   * Content gutter, and the value FooterToolbar bleeds by to span the column.
   *
   * ONE constant for both. They have to agree — the toolbar's negative inline
   * margin is exactly the padding it is cancelling — and when they were two
   * literals in two files the phone layout was where they drifted.
   */
  contentPadding: { compact: 16, comfortable: 24 },
} as const;

/**
 * Stacking order for the app shell.
 *
 * These exist because the shell now has genuinely overlapping layers: a fixed
 * sider, a fixed header, and a sticky footer toolbar that scrolls under both.
 * Before, two files each carried a bare `zIndex: 1` and a comment explaining
 * why they could never meet — which stopped being true the moment the header
 * was pinned.
 *
 * Anchored on antd's own scale: `zIndexBase` is 0 and `zIndexPopupBase` is
 * 1000. Everything here — `fullscreen` included, which is a page's own
 * content rather than shell chrome — must stay well below 1000, which is
 * where Drawer, Modal, Dropdown and FloatButton live — the mobile nav Drawer
 * has to cover the sider, not fight it, and a `Modal` opened from a
 * full-screen list (an Adjust action, say) must still land on top of it.
 */
export const Z = {
  footerToolbar: 10,
  header: 20,
  sider: 30,
  /** `ListSurface`'s full-screen list overlay — above the sider/header it
   * has to cover, comfortably below antd's own popup layer. */
  fullscreen: 40,
} as const;

/**
 * Colour seeds.
 *
 * These are *seeds*, not a palette: antd expands each into a full gradient of
 * hover, active, border, and background steps. Overriding a derived step by
 * hand breaks that relationship, so change the seed and let the algorithm do
 * the rest.
 *
 * The neutrals are deliberately absent — antd derives text and surface colours
 * from `colorBgBase`/`colorTextBase`, and the dark algorithm needs to move them
 * together. Pinning them here would freeze dark mode into looking like light
 * mode with a black background.
 */
export const SEED = {
  /**
   * antd v6's blue. Ant Design Pro still ships v4's `#1890ff`; we take v6's
   * value so the CMS matches the component library it is actually built on.
   */
  primary: "#059669",
  success: "#52c41a",
  warning: "#faad14",
  error: "#ff4d4f",
  info: "#059669",
} as const;

/**
 * The font stack, OS-native first.
 *
 * Ant Design Pro loads AlibabaSans ahead of this; we don't, because a webfont
 * on the critical path buys nothing for an internal console and costs a flash
 * of unstyled text on every cold load.
 */
export const FONT_FAMILY = [
  "-apple-system",
  "BlinkMacSystemFont",
  "'Segoe UI'",
  "Roboto",
  "'Helvetica Neue'",
  "Arial",
  "'Noto Sans'",
  "sans-serif",
  "'Apple Color Emoji'",
  "'Segoe UI Emoji'",
].join(", ");

/** Monospace, for IDs, URLs, and anything the user might copy. */
export const FONT_FAMILY_CODE = [
  "'SFMono-Regular'",
  "Consolas",
  "'Liberation Mono'",
  "Menlo",
  "Courier",
  "monospace",
].join(", ");

/** The colour schemes the app can render in. `system` follows the OS. */
export type ColorSchemePreference = "light" | "dark" | "system";

/** The two schemes actually rendered — `system` resolves to one of these. */
export type ResolvedColorScheme = "light" | "dark";
