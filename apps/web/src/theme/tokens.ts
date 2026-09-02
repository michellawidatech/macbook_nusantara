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
  /**
   * 224px expanded sider.
   *
   * Was 208 — Ant Design Pro's width — until the brand mark landed beside the
   * product name on 2026-08-26 and left 125px for a wordmark that needs 153.
   * The extra 16px also un-truncates the longest nav leaf, "Inventory & Stock
   * Movement", which had been rendering as "Inventory & Stock…" since the
   * merge. `--nusantara-content-left` is published from this constant, so the
   * footer toolbar follows it without being told.
   */
  siderWidth: 224,
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
  /**
   * How wide a form is allowed to get, and the measure every one of them is
   * centred within.
   *
   * Owner decision 2026-08-26: "make all forms centered, don't stick to left".
   * Every form on this app was capped at some width between 420 and 720 and
   * then left flush against the left edge of a 1600px column, so on a shop
   * laptop a settings panel was a narrow strip in the corner with two thirds of
   * the screen empty beside it.
   *
   * 720 rather than the widest of the old values: a form is read top to bottom
   * and a line of input much past that is one the eye has to travel along. The
   * caps that were NARROWER than this stay narrow — this is a ceiling and a
   * centring rule, not a resize.
   *
   * Pair it with `FORM_CENTRE` below, which is what a caller actually spreads
   * onto a style. Both exist because a couple of callers need only the width.
   */
  formMaxWidth: 720,
} as const;

/**
 * The style that centres a form. Spread onto the `<Form>` or the `<Card>` that
 * wraps it.
 *
 * `width: 100%` matters as much as the auto margins: without it the box shrinks
 * to its content on a short form and the "centring" centres something that is
 * already only as wide as one field.
 */
export const FORM_CENTRE = {
  maxWidth: LAYOUT.formMaxWidth,
  width: "100%",
  marginInline: "auto",
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
   * Emerald 700.
   *
   * Was emerald 600 (`#059669`) until the owner asked for "a bit darker"
   * (2026-09-01). One step down the same ramp rather than a new hue: the
   * whole app's greens are derived from this seed, so moving it moves the
   * button, the tags, the links and the selected states together — which is
   * the point of it being a seed. It also buys contrast the old value did not
   * have: white on `#047857` measures 5.3:1, clearing AA for body text, where
   * emerald 600 sat at 3.9:1 and only ever cleared the large-text bar.
   */
  primary: "#047857",
  success: "#52c41a",
  warning: "#faad14",
  error: "#ff4d4f",
  info: "#047857",
} as const;

/**
 * The gold accent, and the two ends of the primary button's gradient.
 *
 * Deliberately NOT antd seeds. A seed is something antd derives eight steps
 * from, and neither of these is: the gradient is a decoration painted over
 * `colorPrimary` in global.css, and the gold is a spot colour, never a
 * surface. Feeding either to `ConfigProvider` would generate hover and border
 * steps nothing asks for.
 *
 * The gold is `#ffcd30` by owner decision (2026-08-24) and is only ever used
 * ON the green — as the focus ring on a primary button, where it clears 3:1
 * against the button beneath it. On the white page it measures about 1.7:1,
 * far under AA, which is why the owner's "never body text" rule is not just a
 * preference: there is no size at which gold text on this background is
 * readable.
 */
export const ACCENT = {
  gold: "#ffcd30",
  /** Emerald 600 → 800, so the gradient still runs through `SEED.primary`. */
  gradientFrom: "#059669",
  gradientTo: "#065f46",
} as const;

/**
 * The mark's own green. The browser chrome, the mark's ground — and, since
 * 2026-09-01, the nav column itself.
 */
export const BRAND_DEEP = "#0f5648";

/**
 * The surfaces, and the reason this app is not white-on-grey.
 *
 * Owner decision 2026-08-26: "make the UI less white-grey and add more of the
 * green, or make it very clean with a light grey background." These do both at
 * once rather than choosing, because the thing that made the old palette feel
 * flat was not the lightness — it was that every neutral was a pure grey with
 * no relation to the brand at all, so the only colour on screen was one green
 * button.
 *
 * Every value here is the SAME hue as the mark's green (about 165°), pulled
 * down to a saturation between 2% and 6%. That is low enough to read as a
 * neutral and high enough that the page feels warmed by the brand rather than
 * printed on newsprint. The green button and the gold mark now sit on ground
 * that belongs to them.
 *
 * `sider` is deliberately a shade DEEPER than `layout`, and content cards stay
 * pure white. That gives three tiers — chrome, page, content — where there
 * used to be two, so the nav reads as a frame instead of as more page.
 *
 * Dark mode is nudged, not rebuilt: antd's dark algorithm already produces the
 * depth, and these only tint its near-blacks the same 165° so the two schemes
 * are recognisably the same product.
 */
export const SURFACE = {
  light: {
    /** The page behind the cards. */
    layout: "#f1f5f3",
    /** The nav column. Dark green since 2026-09-01 — see NAV. */
    sider: BRAND_DEEP,
    /** Table headers and other "alternate row" fills. */
    alt: "#f4f8f6",
  },
  dark: {
    layout: "#0d1412",
    /** One step darker than the light sider, so the two schemes still differ. */
    sider: "#0b3f35",
    alt: "#16211d",
  },
} as const;

/**
 * The nav column's own colours (owner ask 2026-09-01).
 *
 * ## Why this exists as a separate block
 *
 * `theme.ts` used to argue against a dark sider, and the argument was about
 * blast radius rather than taste: "a Menu token changed for the sider is a
 * Menu token changed for every dropdown in the app". That is still true, and
 * it is why none of this reaches `buildTheme`'s component layer. `AppLayout`
 * wraps the nav `<Menu>` — that element alone, not the sider, and not the
 * account Dropdown hanging off it — in a nested `ConfigProvider` built from
 * these values. Everything else in the app keeps the light Menu.
 *
 * ## The values
 *
 * The ground is the mark's own green, so the sider finally carries the brand
 * rather than a 4%-saturation hint of it. The selected item inverts — white
 * pill, dark green label — which is the owner's ask and also the only
 * treatment that clears AA on this ground: `BRAND_DEEP` on white measures
 * 8.6:1, where a tinted pill with light text sat under 3:1.
 *
 * The idle label is white at 85%, not a grey: a neutral grey over a saturated
 * green reads as dirt. 85% on `BRAND_DEEP` is 7.2:1, comfortably AA.
 */
export const NAV = {
  /** Idle label and icon. */
  text: "rgba(255, 255, 255, 0.85)",
  /** Hover label, and the brand wordmark at the top of the column. */
  textStrong: "#ffffff",
  /** The line under the brand and above the account foot. */
  border: "rgba(255, 255, 255, 0.16)",
  /** Hover ground — a lift off the green rather than a second colour. */
  hoverBg: "rgba(255, 255, 255, 0.12)",
  /** The selected pill, and the New Transaction button beside the account. */
  selectedBg: "#ffffff",
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
