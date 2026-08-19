import type { ReactNode } from "react";
import { Flex } from "antd";
import { SPACE } from "../theme/tokens";
import { useLayoutMode } from "../layouts/useLayoutMode";

export interface FilterBarProps {
  /** The controls: a search box, selects, a date range, a summary line. */
  children: ReactNode;
}

/**
 * The row of filters above a list.
 *
 * On a desktop it is a wrapping row, exactly what every page was already
 * hand-rolling with `<Flex gap wrap>`. On a phone it stacks, and each control
 * takes the full width — a 340px search box beside a 300px select is two
 * controls in a 375px screen's worth of horizontal scroll.
 *
 * The widths themselves are released by `.responsive-controls` in global.css
 * rather than here, because the widths live at the call sites as inline styles
 * and inline styles cannot be overridden from a parent component — only from a
 * stylesheet. That rule and this class are one mechanism in two files; neither
 * half does anything alone. An inline `<Form>` that is not a filter bar can
 * wear the same class for the same effect.
 */
export function FilterBar({ children }: FilterBarProps) {
  const { compact } = useLayoutMode();
  return (
    <Flex
      className="responsive-controls"
      vertical={compact}
      wrap={!compact}
      gap={compact ? SPACE.sm : SPACE.md}
      align={compact ? "stretch" : "center"}
      style={{ marginBottom: SPACE.md }}
    >
      {children}
    </Flex>
  );
}
