import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import {
  Breadcrumb,
  Button,
  FloatButton,
  Flex,
  Space,
  Typography,
  theme,
} from "antd";
import { MoreOutlined } from "@ant-design/icons";
import type { BreadcrumbProps, ButtonProps } from "antd";
import { useTranslation } from "react-i18next";
import { SPACE, TYPE, WEIGHT } from "../theme/tokens";
import { useLayoutMode } from "../layouts/useLayoutMode";
import { navTrail } from "../layouts/navigation";

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
  /** The page title. Also the last breadcrumb crumb. */
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
   * Overrides the trail derived from the route. Pass this on pages that sit
   * deeper than the nav knows about — a record detail page, say, where the
   * route carries an id the sidebar has never heard of.
   */
  breadcrumb?: BreadcrumbProps["items"];
  children: ReactNode;
}

/**
 * The standard frame for a page: breadcrumb, title, actions, then content.
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
  breadcrumb,
  children,
}: PageContainerProps) {
  const { pathname } = useLocation();
  const { compact } = useLayoutMode();
  const { t } = useTranslation();
  const {
    token: { lineHeightHeading3 },
  } = theme.useToken();

  // The trail mirrors the sidebar: root, then the section the page sits in if
  // it has one, then the page. `navTrail` is empty for a path the sidebar does
  // not own, in which case the title is the more honest crumb.
  const trail = navTrail(pathname);
  const items: BreadcrumbProps["items"] = breadcrumb ?? [
    { title: t("app.name", "Xinchuan CMS") },
    ...(trail.length > 0
      ? trail.map((key) => ({ title: t(key) }))
      : [{ title }]),
  ];

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
    >
      <Flex vertical gap={SPACE.sm}>
        {/* Hidden on a phone: a compact viewport needs its vertical space for
            content, and the trail duplicates what the page title already
            says one level up. `>` replaces antd's default `/` separator on
            desktop — the sidebar's own between-level glyph, so the crumb
            reads as the same hierarchy the nav shows. */}
        {!compact && <Breadcrumb items={items} separator=">" />}

        <Flex align="flex-start" justify="space-between" gap={SPACE.md} wrap>
          <Typography.Title
            level={4}
            style={{
              margin: 0,
              fontSize: TYPE.xl,
              fontWeight: WEIGHT.strong,
              lineHeight: lineHeightHeading3,
            }}
          >
            {title}
          </Typography.Title>

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
          >
            {actions.map(({ key, label, icon, onClick, disabled }) => (
              <FloatButton
                key={key}
                icon={icon}
                tooltip={label}
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
