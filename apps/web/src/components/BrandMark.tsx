/**
 * The shop's mark: a gold interlaced octagram on deep green.
 *
 * ## One file, two jobs
 *
 * This renders `/favicon.svg` through an `<img>` rather than inlining the SVG,
 * which makes that file the single definition of the artwork. The browser tab
 * and the sidebar are then guaranteed to show the same mark — an inline copy
 * here would be a second version to keep in step, and the one that goes stale
 * is always the one nobody looks at.
 *
 * The cost of `<img>` is that the mark cannot inherit `currentColor`. That is
 * no loss: this mark is gold-on-green in both colour schemes by design. Gold
 * measures about 1.7:1 on a white page (see `ACCENT` in tokens.ts), so it can
 * never sit directly on a light surface — it needs the green tile under it,
 * and carrying its own background is precisely what makes it safe to drop
 * anywhere.
 *
 * ## Decorative by default
 *
 * `alt=""` because every place this is used sits beside the words "Macbook
 * Nusantara". A screen reader announcing "Macbook Nusantara logo, Macbook
 * Nusantara" is worse than one that skips it. Pass a `label` where the mark
 * stands alone.
 */
import { RADIUS } from "../theme/tokens";

export interface BrandMarkProps {
  /** Rendered square, in px. */
  size?: number;
  /** Accessible name. Omit where the product name is already beside it. */
  label?: string;
}

export function BrandMark({ size = 28, label }: BrandMarkProps) {
  return (
    <img
      src="/favicon.svg"
      width={size}
      height={size}
      alt={label ?? ""}
      // The SVG draws its own rounded tile, but Safari antialiases the corner
      // of a scaled `<img>` a shade darker than the CSS radius beneath it; a
      // matching radius here clips that fringe.
      style={{
        borderRadius: RADIUS.chip,
        display: "block",
        flexShrink: 0,
      }}
    />
  );
}
