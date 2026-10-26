/**
 * The shell: nav + header + content, after xinchuan's AppLayout but trimmed —
 * accordion menu, user dropdown.
 *
 * The nav is the same `<Menu>` in both layouts, mounted in a Sider on a
 * desktop and in a Drawer on a phone. One menu, two containers: a second copy
 * of the item list is how a mobile nav ends up one route behind the real one.
 * `useLayoutMode` owns the breakpoint — see that file for why it is `lg` and
 * not a rail.
 */
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Link,
  Outlet,
  useHref,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  Avatar,
  Button,
  ConfigProvider,
  Drawer,
  Dropdown,
  Flex,
  Layout,
  Menu,
  Tooltip,
  Typography,
} from "antd";
import {
  CheckOutlined,
  DesktopOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  PlusOutlined,
  SunOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { matchLeaf, navSectionsFor } from "./navigation.js";
import { NavBadge } from "./NavBadge.js";
import { useLayoutMode } from "./useLayoutMode.js";
import { ScannerChip } from "../components/ScannerChip.js";
import { BrandMark } from "../components/BrandMark.js";
import { ErrorBoundary } from "../components/ErrorBoundary.js";
import { StoreGate } from "../components/StoreGate.js";
import { SerialHistoryHost } from "../components/SerialLink";
import {
  BRAND_DEEP,
  LAYOUT,
  NAV,
  NAV_GRADIENT,
  SPACE,
  TYPE,
  WEIGHT,
  Z,
} from "../theme/tokens";
import { navTheme } from "../theme/theme";
import { useLogout, type Staff } from "../lib/session.js";
import { LANGUAGES } from "../i18n/catalogue.js";
import { useLanguage } from "../i18n/useLanguage.js";
import { useColorScheme } from "../theme/useColorScheme";
import { usePersistentState } from "../hooks/usePersistentState";
import type { ColorSchemePreference } from "../theme/tokens";

export function AppLayout({ staff }: { staff: Staff }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const logout = useLogout();
  const { nav, compact } = useLayoutMode();
  // The read path, as in every other component...
  const { t } = useTranslation();
  // ...and the write path, which only this control has.
  const { language, setLanguage } = useLanguage();
  // Same shape as the language control, and deliberately so: both are
  // preferences that belong to the person rather than to the shop, so both
  // live in the account menu and neither gets a settings page of its own.
  const { preference, resolved, setPreference } = useColorScheme();
  /*
   * The nav ground is `NAV_GRADIENT[resolved]` since 2026-09-09, and both the
   * Sider and the Drawer are told it directly — antd's `siderBg` token takes
   * one colour, and this is two. The token still holds the flat green and is
   * still the right answer for anything that needs a single value; nothing in
   * this component does any more, which is why `SURFACE` is no longer read
   * here.
   */
  /**
   * One region of the nav column.
   *
   * It carried the glass treatment from 2026-09-09 until 2026-09-15, when the
   * owner asked for it to go — *"you can remove the bubble UI"*. Two floating
   * translucent cards inside a coloured column is a lot of frame for a list of
   * eleven links, and the frame was competing with the selected pill, which is
   * the one thing in the column that has to read instantly.
   *
   * The gradient stays. It was there to give the glass something to blur, but
   * it is also just what the column looks like, and flattening it to one green
   * would be the revamp the owner asked twice not to have.
   */
  const navRegion: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };
  /**
   * The till, one click from anywhere (owner ask 2026-09-01).
   *
   * It is a leaf in the Stock section as well, and that is not a duplicate
   * worth removing: the menu entry is where you look for it when you are
   * reading the nav, and this is the thing you hit when you are not — a queue
   * forming while you are three levels into Settings. Every other screen in
   * the app is somewhere you go; this is the one you do.
   */
  const TILL_PATH = "/stock/out";
  /** The till's address as the browser needs it — under the router's base. */
  const tillHref = useHref(TILL_PATH);

  const match = matchLeaf(pathname);
  const selectedKey = match?.leaf?.path ?? match?.section.path ?? "";
  /**
   * Which sections are open — the person's answer, kept (owner ask
   * 2026-09-15: *"Make the navigation bar have to be collapsible manually
   * instead of dynamic accordion"*).
   *
   * It was an accordion: `onOpenChange` kept only the last key, so opening
   * Financial closed Stock, and walking between two sections meant reopening
   * one of them every time. Now a section stays as it was left, on this
   * device, and the only thing that opens one by itself is arriving at a route
   * inside it.
   */
  const [openKeys, setOpenKeys] = usePersistentState<string[]>(
    "nusantara.nav.open",
    () => (match?.section.children ? [match.section.key] : []),
    (stored) =>
      Array.isArray(stored) && stored.every((k) => typeof k === "string")
        ? (stored as string[])
        : undefined,
  );
  /**
   * The whole column, collapsed to its icons — also the person's answer, and
   * also kept.
   *
   * The other half of "collapsible manually". A shop laptop at 1280px wants
   * the 240px back when somebody is reading a wide table, and wants the labels
   * again when they are not.
   */
  const [railed, setRailed] = usePersistentState<boolean>(
    "nusantara.nav.railed",
    false,
    (stored) => (typeof stored === "boolean" ? stored : undefined),
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  /**
   * Open the section the current route lives in, however the route got here.
   *
   * Seeding `openKeys` at mount is not enough, because plenty of navigation
   * never goes through `onOpenChange`: the New Transaction button above the
   * account foot, every `<Navigate>` redirect in App.tsx, browser back and
   * forward, and any in-page `navigate()` such as opening an inbound order.
   * Without this the submenu owning the selected item stays collapsed and
   * `selectedKeys` points at a row nobody can see — the nav shows nothing
   * highlighted at all.
   *
   * Additive rather than assigning: a person who opened a second section by
   * hand keeps it open, and the accordion in `onOpenChange` is still the thing
   * that decides how many stay that way.
   */
  const openSection = match?.section.children ? match.section.key : undefined;
  useEffect(() => {
    if (openSection === undefined) return;
    // Additive, which the docblock above has always claimed and the code did
    // not do: it assigned `[openSection]`, so every navigation closed every
    // other section — the accordion again, by a second door.
    setOpenKeys((keys) =>
      keys.includes(openSection) ? keys : [...keys, openSection],
    );
  }, [openSection, setOpenKeys]);

  // Closing on navigation is not enough: the drawer must also go away when the
  // viewport grows past `lg`, or a rotated tablet keeps a scrim over a sider
  // that is now visible behind it.
  useEffect(() => {
    if (nav === "sider") setDrawerOpen(false);
  }, [nav]);

  // Translated HERE, not in `NAV_SECTIONS`. Those labels stay English because
  // they are the catalogue keys — see i18n/catalogue.ts — and
  // navigation.test.tsx asserts on them.
  //
  // Every place is a real link (owner ask 2026-09-21: *"the user must be able
  // to drag the feature and open it in another tab"*). An `<a href>` is what a
  // browser lets somebody drag onto its tab bar, cmd- or ctrl-click, or
  // middle-click; a menu row that only called `navigate()` was none of those.
  // antd stretches a link in a menu item over the whole row, so the row is
  // still one target.
  const items = useMemo(
    () =>
      navSectionsFor(staff).map((s) => ({
        key: s.children ? s.key : (s.path ?? s.key),
        icon: s.icon,
        label: s.path ? <Link to={s.path}>{t(s.label)}</Link> : t(s.label),
        children: s.children?.map((c) => ({
          key: c.path,
          label: (
            <Link to={c.path}>
              {t(c.label)}
              {c.badge !== undefined && <NavBadge kind={c.badge} />}
            </Link>
          ),
        })),
      })),
    [t, staff],
  );

  const brand = (
    <Flex align="center" gap={SPACE.sm} style={{ minWidth: 0 }}>
      {/* The mark carries its own green tile, which is what lets gold appear
          on a light sidebar at all — see BrandMark. */}
      <BrandMark size={24} />
      {/*
       * White, since the column went dark green (2026-09-01).
       *
       * The note this replaces was about the same problem read the other way
       * round: on the old pale sider the wordmark was `colorPrimary` and
       * measured 3.1:1, so it was changed to body text. Body text on
       * `BRAND_DEEP` is 1.4:1 — worse — so the fix moves with the ground.
       * White here is 12.6:1, and the mark beside it still carries the brand.
       */}
      <Typography.Text
        ellipsis
        style={{
          fontSize: TYPE.lg,
          fontWeight: WEIGHT.strong,
          color: NAV.textStrong,
        }}
      >
        {t("app.name", "Macbook Nusantara")}
      </Typography.Text>
    </Flex>
  );

  /**
   * The nav itself, in its own theme.
   *
   * The `ConfigProvider` wraps THIS ELEMENT and nothing else — see
   * `navTheme()`. Wrapping the Sider instead would put the account Dropdown's
   * own Menu inside the same override, and that one renders on a white popup
   * where a white selected pill is invisible.
   */
  const menu = (
    <ConfigProvider theme={navTheme()}>
      <Menu
        mode="inline"
        style={{ borderInlineEnd: "none", background: "transparent" }}
        items={items}
        selectedKeys={selectedKey ? [selectedKey] : []}
        // A railed menu opens its sections as flyouts and manages their keys
        // itself; handing it a controlled `openKeys` freezes every flyout shut.
        {...(railed ? {} : { openKeys })}
        inlineCollapsed={railed}
        // Every section the person left open stays open (owner ask
        // 2026-09-15). The accordion this replaces kept `keys.slice(-1)`.
        onOpenChange={setOpenKeys}
        onClick={({ key, domEvent }) => {
          if (!key.startsWith("/")) return;
          // A click that landed on the link has been dealt with already: a
          // plain one by the router, a modified one by the browser (a new
          // tab). What is left is the keyboard — Enter on a focused row — and
          // a click on the icon beside the label.
          const onLink =
            domEvent.target instanceof Element &&
            domEvent.target.closest("a[href]") !== null;
          const modified =
            "metaKey" in domEvent &&
            (domEvent.metaKey ||
              domEvent.ctrlKey ||
              domEvent.shiftKey ||
              domEvent.altKey);
          if (!onLink && !modified) navigate(key);
          if (!modified) setDrawerOpen(false);
        }}
      />
    </ConfigProvider>
  );

  /**
   * The till, as a button rather than a menu row (owner ask 2026-09-01).
   *
   * White on the green, which is the same inversion the selected nav pill
   * uses — and deliberately so: those are the two things on this column that
   * are not "a place in the list", and reading alike is how the eye learns
   * that. It sits directly above the account foot, which is as far from the
   * scrolling menu as the column goes.
   *
   * NOT antd's `type="primary"`: the primary button carries the app's green
   * gradient, which on a green column is a button-shaped nothing.
   */
  /**
   * `railed` is the sider only. The drawer is never a rail — it is the phone's
   * whole nav — so it asks for the full-width button by passing nothing.
   */
  const newTransactionButton = (rail: boolean) => (
    <Tooltip
      title={rail ? t("nav.newTransaction", "New Transaction") : ""}
      placement="right"
    >
      <Button
        block
        icon={<PlusOutlined />}
        aria-label={t("nav.newTransaction", "New Transaction")}
        // A link too, for the same reason as the menu: the till is the page
        // most worth dragging into a tab of its own.
        href={tillHref}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          navigate(TILL_PATH);
          setDrawerOpen(false);
        }}
        style={{
          background: NAV.selectedBg,
          borderColor: NAV.selectedBg,
          color: BRAND_DEEP,
          fontWeight: WEIGHT.strong,
        }}
      >
        {/* The label goes in a rail and the tooltip takes over. The button
            stays, because it is the one control in this column somebody
            presses in a hurry. */}
        {rail ? null : t("nav.newTransaction", "New Transaction")}
      </Button>
    </Tooltip>
  );
  const newTransaction = newTransactionButton(false);

  /**
   * One row of a "pick exactly one" group in the account menu.
   *
   * Both groups below need the same thing: a label, and a tick that is
   * RESERVED rather than conditionally rendered — so the menu keeps one width
   * and does not resize under the thumb as the selection moves. Colour alone
   * would not carry the choice for a colour-blind reader.
   *
   * The tick is hidden from assistive tech only while it is the invisible
   * spacer. When it IS the mark it carries a real word, because antd 6 puts no
   * `aria-selected` on a Dropdown's items — verified in the browser — so this
   * glyph is the ONLY signal of what is active. Same argument
   * `RequiredAsterisk` makes about the `*`.
   */
  const choiceRow = (label: ReactNode, active: boolean, icon?: ReactNode) => (
    <Flex align="center" justify="space-between" gap={SPACE.lg}>
      <Flex align="center" gap={SPACE.sm}>
        {icon}
        <span>{label}</span>
      </Flex>
      <CheckOutlined
        style={{ fontSize: TYPE.sm, visibility: active ? "visible" : "hidden" }}
        aria-hidden={!active}
        aria-label={active ? t("account.languageActive", "Active") : undefined}
      />
    </Flex>
  );

  /**
   * The three appearance choices.
   *
   * `system` is offered and is not the default — `ThemeProvider` starts on
   * `light`. A shop console is read on a counter under fluorescent light for
   * most of its life and the OS setting of a shared machine is nobody's
   * deliberate choice, so following it silently is the wrong opening move.
   * Offering it means the one person who does keep their Mac on auto can say
   * so once.
   */
  const SCHEMES: {
    value: ColorSchemePreference;
    label: string;
    icon: ReactNode;
  }[] = [
    {
      value: "light",
      label: t("account.themeLight", "Light"),
      icon: <SunOutlined />,
    },
    {
      value: "dark",
      label: t("account.themeDark", "Dark"),
      icon: <MoonOutlined />,
    },
    {
      value: "system",
      label: t("account.themeSystem", "System"),
      icon: <DesktopOutlined />,
    },
  ];

  /**
   * The account menu.
   *
   * Moved out of the header on 2026-08-24 (owner decision): on a desktop it
   * was a 56px bar holding one avatar, and the page below wanted the height
   * more than the chrome did. It now sits at the foot of the sider, which is
   * where a console's account control conventionally lives and where it stops
   * competing with the page title for the top of the screen.
   *
   * Still one definition, rendered in two places: the sider foot on a desktop
   * and the drawer foot on a phone, where there is no sider to put it in.
   *
   * It holds both per-person preferences — language and appearance — because
   * neither is a property of the shop. Settings is where the shop is
   * configured; this is where the person is.
   */
  const account = (
    <Dropdown
      // Click, not antd's default hover. The trigger below is a
      // `role="button"` with `aria-haspopup="menu"`, and ARIA promises such a
      // control opens on Enter or Space — which a hover-only Dropdown never
      // does, leaving the keyboard path this change was supposed to open still
      // closed. Click is also the honest gesture on the phone half of this
      // app, where "hover" is a tap that a drifting thumb can undo.
      trigger={["click"]}
      menu={{
        // Controlled selection, not a bare `selectable`. Left to track its
        // own, rc-menu would keep Sign out highlighted after it was clicked —
        // and a logout that failed would leave it that way. Passing the array
        // means only a preference row can ever paint as selected.
        selectable: true,
        selectedKeys: [`language:${language}`, `theme:${preference}`],
        items: [
          {
            key: "theme",
            type: "group",
            label: t("account.appearance", "Appearance"),
            // Flat rows rather than a submenu, for the reason the language
            // group below records: antd opens a submenu on hover, and on a
            // touch screen that is an emulated hover flying out sideways from
            // a trigger already at the screen edge.
            children: SCHEMES.map(({ value, label, icon }) => ({
              key: `theme:${value}`,
              label: choiceRow(label, value === preference, icon),
              onClick: () => setPreference(value),
            })),
          },
          { type: "divider" },
          {
            key: "language",
            type: "group",
            label: t("account.language", "Language"),
            // Two flat rows rather than a submenu. antd opens a submenu on
            // hover, which on a touch screen is an emulated hover flying out
            // sideways from a trigger already at the right edge — and it
            // collapses if a thumb drifts. A choice between two does not
            // deserve a flyout.
            children: LANGUAGES.map(({ value, label }) => ({
              key: `language:${value}`,
              // Endonyms, never translated — catalogue.ts says why.
              label: choiceRow(label, value === language),
              onClick: () => setLanguage(value),
            })),
          },
          { type: "divider" },
          {
            key: "logout",
            icon: <LogoutOutlined />,
            label: t("account.signOut", "Sign out"),
            onClick: () => logout.mutate(),
          },
        ],
      }}
    >
      {/* Was a bare `<Flex>`: a div with a cursor, unreachable by keyboard and
          announced as nothing. Now that the account menu is the only route to
          the language and the theme, leaving it that way is not defensible. */}
      <Flex
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-label={t("account.menu", "Account menu")}
        align="center"
        justify={railed ? "center" : "flex-start"}
        gap={SPACE.sm}
        // `minWidth: 0` so the label can actually shrink. A flex item refuses
        // to go narrower than its content by default, and a sign-in address is
        // wider than a 208px sider — which is what pushed the scanner chip out
        // of the foot entirely.
        style={{ cursor: "pointer", minWidth: 0, flex: 1 }}
      >
        <Avatar
          size="small"
          icon={<UserOutlined />}
          // antd's default avatar grey is a mid-tone that reads as a smudge on
          // the green. A translucent white keeps it as a shape rather than a
          // second colour.
          style={{
            flexShrink: 0,
            background: NAV.hoverBg,
            color: NAV.textStrong,
          }}
        />
        {/* One line, truncated, with the full value on hover and to a screen
            reader. Letting it wrap turned the sider foot into two rows — and
            in a rail there is no room for one at all, so the avatar stands
            alone and `aria-label` still names the control. */}
        {!railed && (
          <Typography.Text
            ellipsis={{ tooltip: staff.name }}
            style={{ color: NAV.text }}
          >
            {staff.name}
          </Typography.Text>
        )}
      </Flex>
    </Dropdown>
  );

  return (
    // `height`, not `minHeight`. With minHeight the shell grows to whatever
    // its content needs and the BROWSER window scrolls, which is why a page
    // that wanted its own scrolling panes could never get them: an inner
    // `overflow: auto` does nothing when every ancestor is free to grow. A
    // fixed shell moves the scrollbar from the window into Content, where a
    // page can opt out of it and manage its own.
    <Layout
      style={
        {
          height: "100vh",
          overflow: "hidden",
          /**
           * Where the content column starts, published for `FooterToolbar`.
           *
           * That bar is `position: fixed` and has to span the content column
           * without overlapping the sider. This is NOT a second description of
           * the layout — it is the same one, exported: the value is the very
           * constant the Sider below is sized by, so the two cannot disagree.
           * On a phone there is no sider and the bar spans the full width.
           */
          "--nusantara-content-left":
            nav === "sider"
              ? `${railed ? LAYOUT.siderCollapsedWidth : LAYOUT.siderWidth}px`
              : "0px",
        } as CSSProperties
      }
    >
      {nav === "sider" && (
        <Layout.Sider
          width={LAYOUT.siderWidth}
          // antd's own collapse, so the Menu, the width and the CSS variable
          // above all follow one flag. `trigger={null}` because the control is
          // the button in the brand row — antd's default trigger is a bar
          // pinned across the bottom of the column, exactly where the account
          // foot already is.
          collapsed={railed}
          collapsedWidth={LAYOUT.siderCollapsedWidth}
          trigger={null}
          style={{
            /*
             * A gradient, and no edge (owner ask 2026-09-09).
             *
             * `background` is set here again after being deliberately absent:
             * antd's `siderBg` token takes one colour and this needs two, so
             * the inline style is the only place a gradient can go. The token
             * still holds the flat green and is still what the phone drawer
             * and any single-colour reader get — see `siderBg` below.
             *
             * The 1px right edge is gone with it. It was there to stop a flat
             * green column bleeding into a nearly-white page; a column whose
             * panels float clear of its own edges already has a margin of
             * colour doing that job, and a hairline over a gradient reads as
             * a seam.
             */
            background: NAV_GRADIENT[resolved],
            position: "sticky",
            top: 0,
            height: "100vh",
            overflow: "hidden",
            zIndex: Z.sider,
          }}
          /**
           * The column lives HERE, on antd's own children wrapper, and that is
           * the whole fix for a foot that used to sit directly under the last
           * menu item instead of at the bottom of the sider.
           *
           * `Layout.Sider` renders `<aside>` and puts every child inside one
           * `.ant-layout-sider-children` div. `style` lands on the aside — so
           * a `display: flex` there was a flex container with exactly ONE
           * child, and the brand/menu/foot inside that child stacked as
           * ordinary blocks. `flex: 1` on the menu had nothing to grow
           * against, so the foot simply followed the last item up the page.
           *
           * antd 6's `styles.body` slot targets that inner div, which is the
           * element that actually needs to be the column. `height: 100%` is
           * antd's own and is restated because setting `styles.body` replaces
           * nothing — it merges — but the intent is easier to read stated.
           */
          styles={{
            body: {
              height: "100%",
              display: "flex",
              flexDirection: "column",
              // The menu scrolls and the account foot stays put. `overflow:
              // auto` on the wrapper itself would scroll the foot away with
              // it, which is the one thing a pinned control must not do.
              overflow: "hidden",
              // The column's own inset. It was the gutter the two glass
              // panels floated inside until 2026-09-15; with the panels gone
              // it is simply the space the list is not pressed against, and
              // the horizontal half goes when the column is a rail so the
              // icons stay centred under a 56px width.
              padding: railed ? `${NAV.gutter}px 0` : NAV.gutter,
              gap: NAV.gutter,
            },
          }}
        >
          {/*
           * Panel one: the mark and the menu.
           *
           * The brand moved INSIDE it. It used to sit above the sider's own
           * hairline, which is the composition a flat column wants; a floating
           * panel wants its own heading, or the mark is a caption for the
           * whole window rather than for the nav.
           */}
          <div style={{ ...navRegion, flex: 1, minHeight: 0 }}>
            <Flex
              align="center"
              justify={railed ? "center" : "space-between"}
              gap={SPACE.sm}
              style={{
                height: LAYOUT.headerHeight,
                // One step tighter than the 24 the rest of the sider uses: the
                // mark reads as the sider's own edge marker, and 24 on both
                // sides of it left the wordmark no room to sit unabbreviated.
                paddingInline: railed ? 0 : SPACE.md,
                flex: "0 0 auto",
              }}
            >
              {/* The mark goes when the column is a rail. 56px of width is
                  one icon wide, and a mark plus a toggle in it is two things
                  fighting for the same square — the toggle wins, because it is
                  the only way back. */}
              {!railed && brand}
              <Button
                type="text"
                aria-label={
                  railed
                    ? t("nav.expand", "Expand the menu")
                    : t("nav.collapse", "Collapse the menu")
                }
                // Pressed state said out loud, because the icon alone is a
                // chevron and a chevron is not a state.
                aria-expanded={!railed}
                icon={railed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setRailed((on) => !on)}
                style={{ color: NAV.textStrong, flex: "0 0 auto" }}
              />
            </Flex>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              {menu}
            </div>
          </div>
          {/*
           * Panel two: the account foot (owner ask 2026-09-09 — the reference
           * shows it as a card of its own).
           *
           * Stacked, not side by side. Both want the full width: "Scanner
           * ready" is a fixed-width phrase and a sign-in address is longer
           * than the sider, so on one row the chip held its size and squeezed
           * the address down to a single character. Two rows give each the
           * whole width, and put the scanner status above the account because
           * it is the line that changes while someone is working.
           */}
          <Flex
            vertical
            gap={SPACE.sm}
            // Repaints antd's own greys — the scanner chip's type helpers, a
            // text button's colour — for the dark ground. See global.css.
            className="nusantara-nav-foot"
            style={{
              ...navRegion,
              flex: "0 0 auto",
              padding: SPACE.sm,
              // Clears the home indicator when the console is run full-screen
              // on a tablet.
              paddingBottom: `calc(${SPACE.sm}px + env(safe-area-inset-bottom))`,
            }}
          >
            {/* Above the account, which is the owner's placement (2026-09-01)
                and also the right one: it is the only thing in this column
                somebody presses in a hurry, so it sits where the hand already
                is rather than at the end of a scrolling list. */}
            {newTransactionButton(railed)}
            {/* The chip is a phrase — "Scanner ready" — and a rail has no
                room for one. It is the account menu's own line in that state:
                nothing is lost, it is one click further away. */}
            {!railed && <ScannerChip />}
            {account}
          </Flex>
        </Layout.Sider>
      )}

      <Drawer
        placement="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        // Not full-width: leaving a strip of the page visible is what tells a
        // first-time user the drawer is a layer they can dismiss by tapping
        // beside it. 280 is wide enough for the longest leaf label.
        width={280}
        title={brand}
        // The drawer IS the nav on a phone, so it takes the nav's ground. A
        // white drawer holding a menu themed for dark green would be the one
        // place the treatment inverted itself.
        className="nusantara-nav-foot"
        styles={{
          // The gradient, so the phone's nav is the same surface as the
          // desktop's (2026-09-09). Not the glass panels: a drawer is already
          // a floating pane over the page, and panels inside one would be
          // glass on glass — two frames saying the same thing on a screen with
          // no room for either.
          header: {
            background: "transparent",
            borderBottom: `1px solid ${NAV.border}`,
          },
          body: {
            padding: 0,
            display: "flex",
            flexDirection: "column",
            background: "transparent",
          },
          // `section`, not `content`: antd 6 renamed the slot and warns on the
          // old name. This is the element the header and body sit inside, so
          // painting it here is what lets both of them be transparent.
          section: { background: NAV_GRADIENT[resolved] },
        }}
      >
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{menu}</div>
        {/* The till, and then the account. The scanner chip is not here: on a
            phone it already sits in the header, visible without opening the
            nav — which is the point of a status indicator. */}
        <Flex
          vertical
          gap={SPACE.sm}
          style={{
            flex: "0 0 auto",
            padding: SPACE.md,
            borderTop: `1px solid ${NAV.border}`,
          }}
        >
          {newTransaction}
          {account}
        </Flex>
      </Drawer>

      {/* minWidth/minHeight 0: a flex child's default `min-*: auto` refuses to
          shrink below its content, so without these the column below cannot
          bound Content and the fixed shell above would be undone. */}
      <Layout style={{ minWidth: 0, minHeight: 0 }}>
        {/*
         * No header on a desktop at all.
         *
         * Once the account menu moved to the foot of the sider, the bar was
         * 56px of chrome holding a single scanner chip — and the owner asked
         * for that height back. The brand already lives at the top of the
         * sider and the page title is the page's own, so nothing here was
         * load-bearing. On a phone it stays: there is no sider to hold the
         * hamburger or the brand.
         */}
        {nav === "drawer" && (
          <Layout.Header
            style={{
              // Same reasoning as the sider above: `headerBg` comes from the
              // theme so the phone header and the desktop nav share one
              // surface definition.
              borderBottom: `1px solid ${NAV.border}`,
              height: LAYOUT.headerHeight,
              paddingInline: LAYOUT.contentPadding.compact,
              display: "flex",
              alignItems: "center",
              gap: SPACE.sm,
              position: "sticky",
              top: 0,
              zIndex: Z.header,
            }}
          >
            {/* The phone header shares the nav's ground, so it shares the
                repaint that makes antd's greys legible on it. */}
            <Flex align="center" gap={SPACE.sm} className="nusantara-nav-foot">
              <Button
                type="text"
                icon={<MenuOutlined />}
                aria-label={t("nav.open", "Open navigation")}
                style={{ color: NAV.text }}
                onClick={() => setDrawerOpen(true)}
              />
              {brand}
              <ScannerChip />
            </Flex>
          </Layout.Header>
        )}

        <Layout.Content
          style={{
            display: "flex",
            flexDirection: "column",
            // Content is now the scroll container for an ordinary page: the
            // window no longer scrolls, this does. A page that wants to own
            // its scrolling passes `fill` to PageContainer and sizes itself to
            // exactly this box, so nothing overflows and no bar appears.
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            // The same constant FooterToolbar bleeds by, so the two cannot
            // drift — and 16px rather than 32 on a phone, where a 375px screen
            // cannot spend a fifth of its width on gutters.
            padding: compact
              ? LAYOUT.contentPadding.compact
              : LAYOUT.contentPadding.comfortable,
            // Room for the bottom-right float button to clear the last row of
            // content, and for the home indicator on a notched phone.
            paddingBottom: `calc(${
              compact
                ? LAYOUT.contentPadding.compact
                : LAYOUT.contentPadding.comfortable
            }px + env(safe-area-inset-bottom))`,
            // No max width: content fills the screen however far it is zoomed
            // out (owner, 2026-10-14). It used to stop at 1600px and leave
            // the right of a wide monitor empty.
            width: "100%",
            // Without this, a wide table inside a fixed-width flex child
            // refuses to shrink and the whole document scrolls sideways —
            // the classic min-content floor on a flex item.
            minWidth: 0,
          }}
        >
          {/* The boundary sits HERE, around the page and inside the shell, so
              a throw on one screen leaves the sidebar, the account menu and
              the router standing. `resetKey` is the pathname: navigating away
              from a broken page clears the latch, which is the difference
              between a recoverable error and a dead tab. */}
          <ErrorBoundary resetKey={pathname}>
            {/* Inside the shell for the same reason as the boundary: the
                sidebar and sign-out stay usable while the shop loads, or
                when it cannot. */}
            <StoreGate staffName={staff.name}>
              {/* One page at a time again (owner ask 2026-09-21: "remove
                  the tab view"). The in-app tab strip of 2026-09-15 kept
                  every visited page mounted; the browser's own tabs do that
                  job now — every nav entry is a real link, so it can be
                  dragged or cmd-clicked into another tab — and work in
                  progress is kept on this device instead (`useDraft`). */}
              {/* Every clickable serial's history dialog, once, over the
                  page (2026-09-21) — `SerialLink` says why it lives here. */}
              <SerialHistoryHost>
                <Outlet />
              </SerialHistoryHost>
            </StoreGate>
          </ErrorBoundary>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
