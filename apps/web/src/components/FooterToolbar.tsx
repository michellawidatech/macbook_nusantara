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
 * Pro positions its toolbar `fixed` with `left` hard-set to the sidebar width.
 * This one is `sticky` inside the content column instead: our sider collapses
 * between two widths, and a fixed bar would need to be told about that — a
 * second place for the layout to be described, and the one that goes stale.
 * Sticky needs to know nothing, because the content column already knows.
 *
 * The negative inline margins bleed the bar out to the edges of `Content`'s
 * padding, which is what makes it read as a bar spanning the page rather than
 * a floating card, and the negative bottom margin sits it flush with the
 * viewport edge.
 *
 * `position: sticky` only pins an element to the viewport bottom while its
 * CONTAINING BLOCK still extends below the viewport. A short wizard step used
 * to break exactly this: `<form>` sized to `height: auto` stopped as soon as
 * its content did, so on first open the bar rendered mid-page instead of at
 * the bottom. `marginTop: auto` below is the other half of the fix: inside a
 * flex column with leftover main-axis space, an `auto` margin absorbs all of
 * it and pushes this bar to the very end of the box — which is what finally
 * gives sticky a containing block tall enough to pin against. Only
 * ProductFormPage.tsx's `<Form>` currently offers that leftover space (it
 * sets `flex: 1` and is itself stretched full-height by PageContainer.tsx and
 * AppLayout.tsx). Every other caller wraps this bar in a flex column sized to
 * `auto` — exactly as tall as its own content, with nothing left over — so
 * the same `auto` margin resolves to 0 there and changes nothing.
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
    <Flex
      align="center"
      justify="space-between"
      gap={SPACE.md}
      // On a phone the totals and both buttons do not fit on one 375px line,
      // so the bar grows to two rows rather than clipping. minHeight, not
      // height, is what lets it.
      wrap={compact}
      style={{
        position: "sticky",
        bottom: 0,
        // Drops the bar to the bottom of the flex column that wraps it,
        // PROVIDED that column has leftover height to give — see this file's
        // docblock. Every caller but ProductFormPage wraps a column sized to
        // its own content, where this resolves to 0 and changes nothing.
        marginTop: "auto",
        // Bleed past Content's padding so the bar spans the full column, and
        // — for marginBottom specifically — so it can reach the true
        // viewport edge once it is actually stuck: a negative margin here
        // extends the sticky constraint rectangle past Content's own bottom
        // padding. Remove it and the bar rests one gutter short, independently
        // of the flex chain marginTop relies on above.
        marginInline: -gutter,
        marginBottom: -gutter,
        paddingInline: gutter,
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
  );
}
