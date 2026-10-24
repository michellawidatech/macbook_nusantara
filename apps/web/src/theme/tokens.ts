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
   * then left flush against the left edge of the content column, so on a shop
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
 * Column widths, by what the column HOLDS (owner ask 2026-09-25: *"for all
 * the table, make the width per column more equal, but adjust to the most
 * likely width"*).
 *
 * Every table in this app used to pick its own number. A survey on
 * 2026-09-25 found 44, 46, 48, 56, 60, 64, 76, 80, 88, 90, 96, 100, 110, 120,
 * 130, 140, 150, 160, 170, 180, 190, 200, 216, 220, 230, 240, 250, 260, 270,
 * 280, 300, 320 and 340 in use — so a date was 110px on one screen and 160 on
 * the next, and two lists of the same documents side by side lined up on
 * nothing. The cost is not only cosmetic: antd hands the leftover width to
 * the columns that declared none, so one over-wide neighbour squeezes the
 * column somebody is actually reading.
 *
 * The rule these encode is the owner's: **equal, adjusted to the most likely
 * content**. Columns holding the same KIND of thing get the same width
 * everywhere, and that width is what the longest realistic value needs —
 * `Rp 12.500.000` for money, `SC02740137JKM` at 12px monospace for a serial,
 * `21 Sep 2026` for a date.
 *
 * ⚠️ These are for columns whose content has a KNOWN shape. A column of
 * product names, addresses or free text still takes no width and absorbs the
 * slack — a table where every column is fixed either scrolls sideways or
 * leaves a gap at the end.
 *
 * **They are MINIMUMS, and tight ones** (owner ask 2026-09-28: *"each column
 * only have width that are necessary … have a minimum width per column so
 * when that's the minimum and still wider than the screen, it will have
 * scrollable table otherwise no"*). A table is as wide as the screen gives
 * it and scrolls sideways only when these, summed (`gridMinWidth` in
 * `components/tableCells.ts`), do not fit — which is also what makes a table
 * follow the browser's zoom: at 125% the same screen holds fewer CSS pixels
 * and the sum decides again. Each figure is the content plus antd's 16px cell
 * padding either side, and nothing more.
 */
export const COLUMN = {
  /** A tick, a radio, a drag handle. */
  tick: 48,
  /** One icon button. */
  action: 56,
  /** A count, a quantity stepper, or a short "n available" line. */
  qty: 96,
  /**
   * The condition: a NEW/A/B/C tag, or the Select that picks one. Sized for
   * the Select — a column that is a tag on one screen and a control on the
   * next has to fit the control, or the bench gets a box it cannot read.
   */
  grade: 120,
  /** Two icon buttons. */
  actions: 104,
  /** `21 Sep 2026`, and a second line under it. */
  date: 120,
  /** A tag carrying one word — a channel, "On hold", "Bought". */
  tag: 120,
  /** A tag carrying a phrase — "Partially paid", "From customer". */
  status: 144,
  /** `Rp 12.500.000`, right-aligned, under a heading of its own. */
  money: 136,
  /** A money INPUT: the box, its thousands separators and its padding. */
  moneyInput: 144,
  /** A `Select`: a reason, a method, a warehouse. */
  choice: 160,
  /** `SI-2026/09-0042`, a supplier's invoice number, a phone number. */
  code: 148,
  /** One button carrying its word, or a word beside an icon. */
  actionsPair: 188,
  /** Two buttons that both carry a phrase — *Set price* / *Print barcode*. */
  actionsWide: 248,
  /** `SC02740137JKM` at 12px monospace. */
  serial: 140,
  /**
   * What a column that declares NO width is counted at when a table sums its
   * minimum — a name, an address, a count, free text. Only the scroll
   * decision reads it: the browser still gives such a column at least its
   * longest word, and the slack above that.
   */
  flex: 120,
  /** A tick or an expand chevron antd draws itself, as it draws them. */
  antdControl: 32,
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
  /**
   * Emerald 500 — the seed in the DARK scheme (owner report 2026-09-19:
   * *"when something is selected it might be highlighted as dark green which
   * is hard to see"*).
   *
   * antd's dark algorithm mixes the seed toward the background, and emerald
   * 700 came out `#06694d`: 2.75:1 on a dark card, so every green label, link,
   * active tab and page number was hard to read. Emerald 500 comes out
   * `#11a071`, 5.5:1. Filled primary buttons are unaffected — they carry the
   * gradient (`ACCENT`), not this.
   */
  primaryDark: "#10b981",
  success: "#52c41a",
  warning: "#faad14",
  error: "#ff4d4f",
  info: "#047857",
} as const;

/**
 * What a SELECTED thing is filled with — a picked option, a selected row, the
 * chosen item of a menu, a conversation that is open — per scheme (owner
 * report 2026-09-19, as above).
 *
 * The one place this file hands antd a DERIVED step rather than a seed, and
 * on purpose: for a seed as deep as emerald 700, antd's derivation goes wrong
 * in both schemes. Its light "pale" tint came out `#a5b8af` with a `#72ab93`
 * hover — a mid green under dark text, which is the "dark green, hard to see"
 * — and its dark tint came out `#0f3228`, 1.3:1 against the card, which is to
 * say invisible. These are real tints of the brand hue: pale behind dark text
 * in light, a clearly lifted green behind white text in dark (10:1).
 */
export const SELECTION = {
  light: { bg: "#e7f4ee", bgHover: "#d3ebdf" },
  dark: { bg: "#1b4a3b", bgHover: "#225b48" },
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
  /** The hairline around a glass panel, and inside one. */
  border: "rgba(255, 255, 255, 0.18)",
  /** Hover ground — a lift off the green rather than a second colour. */
  hoverBg: "rgba(255, 255, 255, 0.14)",
  /** The selected pill, and the New Transaction button beside the account. */
  selectedBg: "#ffffff",

  /*
   * The glass treatment (owner ask 2026-09-09).
   *
   * > *"Glass-like design, still the same colour palette or even more
   * > vibrant … please don't revamp a lot, just the navbar."*
   *
   * Two floating panels — the menu, and the account foot — on a column that is
   * no longer a flat fill but a gradient running from the mark's own
   * `BRAND_DEEP` through a brighter emerald. That gradient is the whole reason
   * the glass reads as glass: a translucent panel over a FLAT colour is just a
   * slightly different flat colour, and the blur has nothing to blur. It is
   * also the "more vibrant" half of the ask, taken as more saturation rather
   * than a new hue, so every other green in the app still belongs to it.
   *
   * ## Why the values are what they are
   *
   * `panelBg` is white at 10%: enough to lift the panel off the gradient,
   * light enough that the gradient still shows through and moves down the
   * column. Combined with `blur`, what sits behind the panel is legible as
   * colour and not as shape, which is the effect.
   *
   * Contrast is unchanged and had to be: white at 85% over the LIGHTEST point
   * of the gradient plus a 10% white veil is 6.9:1, still comfortably AA, and
   * the selected pill is still white-on-`BRAND_DEEP` at 8.6:1. A glass panel
   * that costs a grade of legibility is a worse nav than a flat one.
   *
   * ⚠️ `backdrop-filter` is not universal. Where it is unsupported the panel
   * is simply a 10% white overlay on the gradient — no blur, same colours,
   * same contrast. That is a fair degradation and not a broken layout, which
   * is why this is done with a translucent fill rather than with an image.
   */
  /** The floating panels: the menu, and the account foot. */
  panelBg: "rgba(255, 255, 255, 0.10)",
  /** How far the panel blurs what is behind it. */
  blur: "14px",
  /** Lifts the panels off the column. Soft and low-contrast, not a drop. */
  panelShadow: "0 8px 24px rgba(0, 0, 0, 0.14)",
  /** The panels' own radius — one step above a card, so they read as glass. */
  panelRadius: 16,
  /** Breathing room between the panels and the column's edges. */
  gutter: 10,
} as const;

/**
 * The nav column's ground, per scheme.
 *
 * A gradient rather than `SURFACE[x].sider`, which stays as the flat fallback
 * for anything that needs one colour (antd's own `siderBg` token, the phone
 * drawer's ground). Both ends are the same hue as the mark; the second is the
 * "more vibrant" the owner asked for.
 */
export const NAV_GRADIENT = {
  light: `linear-gradient(160deg, ${BRAND_DEEP} 0%, #0c6b55 55%, #0a7d61 100%)`,
  dark: "linear-gradient(160deg, #08312a 0%, #0a4438 55%, #0b5546 100%)",
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
