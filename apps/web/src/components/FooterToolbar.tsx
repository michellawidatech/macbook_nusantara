import type { ReactNode } from "react";
import { Flex, theme } from "antd";
import { LAYOUT, SPACE, Z } from "../theme/tokens";
import { useLayoutMode } from "../layouts/useLayoutMode";

export interface FooterToolbarProps {
  /** Shown on the left — a running total, a validation summary, a count. */
  info?: ReactNode;
  /** The actions, right-aligned. Primary action last, as antd orders buttons. */
  children: ReactNode;
}

/**
 * A bar pinned to the bottom of a long form, holding its submit actions.
 *
 * Ant Design Pro's FooterToolbar, and the reason a stock post can be submitted
 * without scrolling to the end of the page. Measured from
 * preview.pro.ant.design: 64px tall, a hairline along the top, actions flush
 * right, and a translucent background so content scrolling underneath is
 * visibly *under* it rather than cut off.
 *
 * Pro positions its toolbar `fixed` with `left` hard-set to the sidebar width,
 * and so, now, does this one — but without hard-setting anything. The sider's
 * width reaches here as `--nusantara-content-left`, published by AppLayout from
 * the same constant the Sider is sized by. The old objection to `fixed` was
 * that it meant describing the layout a second time; reading the first
 * description answers it.
 *
 * It was `sticky` before, and the reason it changed is worth keeping: sticky
 * only pins an element to the viewport bottom while its CONTAINING BLOCK still
 * extends below the viewport. That made the bar's position depend on an
 * unbroken chain of full-height flex ancestors, and any caller that wrapped it
 * in a column sized to its own content — a short wizard step, a Tabs panel —
 * got a bar floating mid-page instead. The Purchase Order wizard was exactly
 * that: four ancestors between the bar and Content, one of them a Tabs panel
 * that cannot pass height through. Fixed positioning depends on nothing above
 * it, so every caller behaves the same whether its content is one field or
 * fifty.
 *
 * Because a fixed bar leaves the document flow, a spacer of the same height
 * renders in its place. Without it the last row of a form sits underneath the
 * bar, reachable only by scrolling past the end of the page.
 */
export function FooterToolbar({ info, children }: FooterToolbarProps) {
  const { compact } = useLayoutMode();
  const {
    token: { colorBgElevated, colorBorderSecondary },
  } = theme.useToken();

  // The SAME constant Content pads by. These have to agree — the bleed is
  // exactly the padding it cancels — and when they were two literals in two
  // files, the phone layout is where they drifted.
  const gutter = compact
    ? LAYOUT.contentPadding.compact
    : LAYOUT.contentPadding.comfortable;

  return (
    <>
      {/* Holds the bar's height open in the flow it no longer occupies. */}
      <div
        aria-hidden="true"
        style={{ flex: "0 0 auto", height: LAYOUT.footerToolbarHeight }}
      />
      <Flex
        align="center"
        justify="space-between"
        gap={SPACE.md}
        // On a phone the totals and both buttons do not fit on one 375px line,
        // so the bar grows to two rows rather than clipping. minHeight, not
        // height, is what lets it.
        wrap={compact}
        style={{
          position: "fixed",
          bottom: 0,
          // The sider's width on a desktop, 0 on a phone — see the docblock.
          // The fallback keeps the bar full-width if the variable is ever
          // missing, which is the harmless failure of the two.
          left: "var(--nusantara-content-left, 0px)",
          right: 0,
          paddingInline: gutter,
          // Clears the home indicator rather than sitting under it.
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingBlock: compact ? SPACE.sm : 0,
          minHeight: LAYOUT.footerToolbarHeight,
          background: colorBgElevated,
          borderTop: `1px solid ${colorBorderSecondary}`,
          // Above the page's own content and below the fixed header. Those two
          // CAN now meet — the header is pinned rather than scrolling away — so
          // the order is stated in tokens instead of assumed.
          zIndex: Z.footerToolbar,
        }}
      >
        <div>{info}</div>
        {/* `flex: 1` + `justify="end"` rather than leaning on the parent's
          space-between, because space-between does nothing for a flex line
          holding a SINGLE item: once `info` is long enough to wrap the actions
          onto their own row, that row has one child, and it sits flush LEFT.
          Claiming the whole row and right-aligning inside it puts the primary
          action at the bottom right in both cases — wrapped and not. Compact
          only: the desktop bar never wraps, and every existing page's spacing
          there is tuned against the space-between behaviour. */}
        <Flex
          align="center"
          gap={SPACE.sm}
          flex={compact ? 1 : undefined}
          justify={compact ? "end" : undefined}
        >
          {children}
        </Flex>
      </Flex>
    </>
  );
}
