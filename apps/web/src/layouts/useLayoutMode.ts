import { Grid } from "antd";

/** How the shell should lay itself out at the current viewport. */
export interface LayoutMode {
  /**
   * Below `lg` the sider leaves the flow entirely and the nav becomes a
   * Drawer. Not a narrow rail — a 48px column of glyphs costs a phone an
   * eighth of its width and gives back icons nobody can read.
   */
  nav: "sider" | "drawer";
  /**
   * Below `md` the dense grids stop working: line-item labels have to become
   * real labels, the content gutter tightens, and page actions move to a
   * float button.
   */
  compact: boolean;
}

/**
 * The one place the app decides what "mobile" means.
 *
 * Two boundaries, both already in use here before this hook existed: `lg`
 * (992) was the Sider's own `breakpoint` and the login split, `md` (768) is
 * where the stock forms' `xs={0} md={span}` header strip already disappears.
 * No new numbers — a third breakpoint would be a third thing to keep in step.
 *
 * `Grid.useBreakpoint` returns a PARTIAL record, so every key is
 * `boolean | undefined` and all of them are undefined on the first render
 * pass. That pass is never painted — antd registers the breakpoints inside a
 * `useLayoutEffect`, which commits before paint — so there is no flash. What it
 * does mean is that this hook renders twice on mount, so keep it
 * presentational: do not hang effects, timers or refs off `compact`.
 */
export function useLayoutMode(): LayoutMode {
  const screens = Grid.useBreakpoint();
  return {
    nav: screens.lg ? "sider" : "drawer",
    compact: !screens.md,
  };
}
