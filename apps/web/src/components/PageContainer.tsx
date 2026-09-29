import type { CSSProperties, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button, FloatButton, Flex, Space, Typography, theme } from "antd";
import { ArrowLeftOutlined, MoreOutlined } from "@ant-design/icons";
import type { ButtonProps } from "antd";
import { useTranslation } from "react-i18next";
import { LAYOUT, SPACE, TYPE, WEIGHT, Z } from "../theme/tokens";
import { useLayoutMode } from "../layouts/useLayoutMode";

/**
 * A page-level action.
 *
 * Declared as data rather than passed as rendered buttons, because where it
 * renders depends on the viewport: the header on a desktop, a float button
 * bottom-right on a phone. A caller handing over `<Button>`s could not be
 * moved between the two.
 */
export interface PageAction {
  key: string;
  label: string;
  /** From `@ant-design/icons`. Required — a float button is icon-only. */
  icon: ReactNode;
  onClick: () => void;
  type?: ButtonProps["type"];
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
}

export interface PageContainerProps {
  /** The page title. The only heading a page renders. */
  title: string;
  /**
   * Primary page actions.
   *
   * Rendered in the header on a wide viewport and as a bottom-right
   * `FloatButton` when compact, where a thumb can reach them.
   *
   * ⚠️ Do NOT pass these on a page that also renders a `FooterToolbar`. antd
   * puts FloatButton at `zIndexPopupBase` (1000) and the toolbar sits at
   * `Z.footerToolbar` (10), so the two would overlap on a phone. A form's
   * primary action belongs in its footer toolbar, which is already the
   * mobile-correct place for it — this prop is for list and detail pages.
   *
   * ⚠️ On a page built from `ResourceList`/`ListToolbar`, the desktop half of
   * this has moved: `ListToolbar` has its own `primaryAction` prop, grouped
   * with its refresh/full-screen/columns controls, and a list page passes
   * the SAME `PageAction` there unconditionally. Passing it here too on a
   * wide viewport would render the button twice. The fix such a page uses is
   * to gate what reaches this prop to compact only —
   * `actions={compact ? [action] : undefined}` — so this component's own
   * `hasActions && !compact` branch below never has anything to render, and
   * only the `hasActions && compact` `FloatButton` branch ever fires. Pages
   * that do not use `ListToolbar` are unaffected and keep passing `actions`
   * unconditionally, exactly as this doc already describes.
   */
  actions?: PageAction[];
  /**
   * Escape hatch for anything `actions` cannot express. Header only.
   *
   * Rendered to the right of the title, after `actions`. This is where a page
   * puts a header affordance that is not a button — a record's copyable code,
   * say. It is NOT a place for explanatory prose: the header carries the title
   * and things you can act on, nothing else.
   */
  extra?: ReactNode;
  /**
   * A strip pinned under the title row, inside the sticky block.
   *
   * For a state the page is IN that somebody has to leave again — an invoice
   * being edited, a count still open. It rides along when `stickyHeader` is
   * set, so scrolling to the bottom of a long grid does not scroll away the
   * only sign that the page is unlocked.
   *
   * ⚠️ Not a place for prose. A banner that merely describes the screen is
   * the line under the title that was taken off every page on 2026-09-25;
   * this is for something that is temporarily true and can be turned off.
   */
  banner?: ReactNode;
  /**
   * Where the back arrow beside the title goes. Omit on a page the sidebar
   * itself can reach.
   *
   * This replaces what the breadcrumb used to do for the three detail pages —
   * an inbound order, an opname session, a discount — that sit below a route
   * the nav knows about. Those pages are reached by clicking a row, so
   * without a crumb there was no way back up except the browser button, and a
   * console that needs the browser chrome to be navigable is not navigable.
   * An arrow says the same thing in one glyph instead of a line of text.
   */
  backTo?: string;
  children: ReactNode;
  /**
   * Fill the viewport instead of growing with content.
   *
   * For a page that manages its own scrolling — the Chat Inbox, where three
   * panes scroll independently and the window must not. It sets `minHeight: 0`
   * so this flex column can actually be bounded by Content, and
   * `overflow: hidden` so nothing escapes it. A page passing this is
   * responsible for giving its own children `flex: 1` and `minHeight: 0` the
   * rest of the way down.
   *
   * Ordinary pages leave it off and scroll inside Content as before.
   */
  fill?: boolean;
  /**
   * Pin the title row to the top of the scroll area (owner ask 2026-09-01,
   * for Income & Expense's *Add adjustment*).
   *
   * Opt-in rather than the default, because it costs something on every page
   * that does not need it: a sticky bar eats the top of a long table's
   * viewport, and most pages here put their primary action in a toolbar or a
   * footer that is already reachable. It earns its place on a page you scroll
   * a long way down and then want to add a row to — which is this one.
   *
   * The bar paints `colorBgLayout` and bleeds into the content gutter, so
   * cards pass UNDER it rather than showing through a transparent strip.
   * ⚠️ Ignored when `fill` is set: a fill page owns its own scrolling and this
   * column never scrolls, so `position: sticky` here would have nothing to
   * stick to.
   */
  stickyHeader?: boolean;
}

/**
 * The standard frame for a page: title, actions, then content.
 *
 * Modelled on Ant Design Pro's PageContainer, and the reason pages don't each
 * invent their own heading. A page that renders a bare `<Typography.Title>` is
 * a page whose title drifts a few pixels from every other page's.
 *
 * There is deliberately no subtitle slot. It used to render a grey line under
 * the title, which meant every page in the app opened with a sentence restating
 * what its own title and content already said. Anything genuinely useful goes
 * in `extra` (an affordance) or in the content itself (data) — not in prose
 * above the fold.
 *
 * The header sits directly on the layout background rather than in a card —
 * Pro's arrangement, and it keeps the white surfaces for content that is
 * actually content.
 *
 * The desktop/mobile decision for `actions` lives HERE rather than in each
 * page, so a page cannot forget it.
 */
export function PageContainer({
  title,
  actions,
  extra,
  banner,
  backTo,
  children,
  fill = false,
  stickyHeader = false,
}: PageContainerProps) {
  const navigate = useNavigate();
  const { compact } = useLayoutMode();
  const { t } = useTranslation();
  const {
    token: { lineHeightHeading3, colorBgLayout },
  } = theme.useToken();
  const gutter = compact
    ? LAYOUT.contentPadding.compact
    : LAYOUT.contentPadding.comfortable;
  /**
   * The pinned title row.
   *
   * `top: -gutter` rather than `0`: Content's own padding is INSIDE the scroll
   * box, so an element stuck at 0 leaves that padding-worth of page scrolling
   * visibly above it. Pulling the stick point up by the gutter and paying the
   * same amount back as padding puts the bar flush against the top edge.
   *
   * The negative inline margin is the same trick `FooterToolbar` uses and for
   * the same reason — the bar has to span the full column, gutters included,
   * or a card scrolling under it shows through at the sides.
   */
  const stickyStyle: CSSProperties | undefined =
    stickyHeader && !fill
      ? {
          position: "sticky",
          top: -gutter,
          zIndex: Z.footerToolbar,
          background: colorBgLayout,
          marginInline: -gutter,
          paddingInline: gutter,
          paddingBlock: gutter,
          marginBlockStart: -gutter,
        }
      : undefined;

  const hasActions = actions !== undefined && actions.length > 0;

  return (
    <Flex
      vertical
      gap={SPACE.lg}
      // Grows to fill Content's height instead of sizing to its own content.
      // `<Outlet/>` renders no DOM node of its own, so this Flex IS Content's
      // one child (Content is a flex column — see AppLayout.tsx). Without
      // `flex: 1` here, a form's `<Form style={{ flex: 1 }}>` further down
      // this tree would have nothing tall enough above it to inherit space
      // from, and FooterToolbar's `position: sticky` would have no
      // containing block reaching the viewport bottom on a short step. A
      // short list page just gains empty layout-background below its last
      // card — Content already painted that background there before this
      // change, so nothing here is visibly new.
      flex={1}
      style={
        fill
          ? // The two properties that make a nested scroll area possible at
            // all. Without `minHeight: 0` this column inherits the flex
            // default of `min-height: auto`, refuses to shrink below its
            // content, and every `overflow: auto` beneath it is inert.
            { minHeight: 0, overflow: "hidden" }
          : undefined
      }
    >
      {/* No breadcrumb. Removed on 2026-08-26 by owner decision: with the
          deepest route two levels down, every trail restated the highlighted
          sidebar item and then the page title directly beneath it, spending a
          line of vertical space to say nothing the screen was not already
          saying twice. `navigation.tsx` records the same decision from the
          other end. */}
      <Flex vertical gap={SPACE.sm} style={stickyStyle}>
        <Flex align="flex-start" justify="space-between" gap={SPACE.md} wrap>
          <Flex align="center" gap={SPACE.sm} style={{ minWidth: 0 }}>
            {backTo !== undefined && (
              <Button
                type="text"
                shape="circle"
                icon={<ArrowLeftOutlined />}
                aria-label={t("page.back", "Back")}
                onClick={() => navigate(backTo)}
                // Pulled into the gutter so the title still starts on the
                // same vertical line as every other page's. A heading that
                // shifts 40px right on detail pages reads as a different
                // layout rather than the same one with an arrow.
                style={{ marginInlineStart: -SPACE.sm }}
              />
            )}
            <Typography.Title
              level={4}
              style={{
                margin: 0,
                fontSize: TYPE.xl,
                fontWeight: WEIGHT.strong,
                lineHeight: lineHeightHeading3,
              }}
            >
              {/* Translated here rather than at 20 call sites. Every page hands
                this an English source string and gets its own language's H1
                back — see i18n/catalogue.ts on why the English IS the key. */}
              {t(title)}
            </Typography.Title>
          </Flex>

          {(extra || (hasActions && !compact)) && (
            <Flex gap={SPACE.sm}>
              {hasActions && !compact && (
                <Space>
                  {actions.map(({ key, label, icon, ...rest }) => (
                    <Button key={key} icon={icon} {...rest}>
                      {label}
                    </Button>
                  ))}
                </Space>
              )}
              {extra}
            </Flex>
          )}
        </Flex>
        {banner}
      </Flex>

      {children}

      {/* The float button is `position: fixed`, so it sits OVER the end of the
          content rather than after it. Without this the last row of a list —
          which on a phone is a card with its own action buttons — is under the
          thumb target. 88px is antd's 48px inset plus a 40px button. */}
      {hasActions && compact && (
        <div style={{ height: 88, flexShrink: 0 }} aria-hidden />
      )}

      {/* Position, inset and stacking are all antd component tokens — nothing
          here picks a pixel or a z-index. */}
      {hasActions &&
        compact &&
        (actions.length === 1 && actions[0] ? (
          <FloatButton
            type={actions[0].type === "primary" ? "primary" : "default"}
            icon={actions[0].icon}
            tooltip={actions[0].label}
            // The tooltip is not a NAME — it appears on hover, which a phone
            // does not have, and a screen reader reads the icon's glyph
            // instead. Every page action is icon-only here, so each one has
            // to say what it is.
            aria-label={actions[0].label}
            // FloatButton has no `disabled`, so a disabled action is shown
            // greyed and made inert rather than vanishing — a control that
            // disappears when it cannot be used is a control the user hunts
            // for.
            style={
              actions[0].disabled
                ? { opacity: 0.5, pointerEvents: "none" }
                : undefined
            }
            aria-disabled={actions[0].disabled}
            onClick={actions[0].disabled ? undefined : actions[0].onClick}
          />
        ) : (
          // A neutral glyph, not the first action's: the group's trigger opens
          // a fan of several, and wearing one member's icon claims it does
          // that one thing.
          <FloatButton.Group
            trigger="click"
            type="primary"
            icon={<MoreOutlined />}
            aria-label={t("page.actions", "Page actions")}
          >
            {actions.map(({ key, label, icon, onClick, disabled }) => (
              <FloatButton
                key={key}
                icon={icon}
                tooltip={label}
                aria-label={label}
                style={
                  disabled ? { opacity: 0.5, pointerEvents: "none" } : undefined
                }
                aria-disabled={disabled}
                onClick={disabled ? undefined : onClick}
              />
            ))}
          </FloatButton.Group>
        ))}
    </Flex>
  );
}
