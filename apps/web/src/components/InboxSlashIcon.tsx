/**
 * An inbox with a slash through it — "this never arrived" (owner ask
 * 2026-09-24: *"'Not arrived' button should be an inbox icon with slash,
 * instead of circle with slash"*).
 *
 * `StopOutlined` was doing the job and says the wrong thing: a circle with a
 * bar is "forbidden", and a unit the supplier never sent is not forbidden, it
 * simply did not turn up. The inbox is the same glyph *Mark arrived* uses two
 * buttons away, which is exactly the point — one says the boxes are here, the
 * other says this one was not in them.
 *
 * Ant Design has no such icon, so it is drawn here from theirs: `InboxOutlined`'s
 * own path, a diagonal cut through it and a diagonal stroke in the gap. The cut
 * is a mask rather than a second stroke painted in the page colour, because the
 * page colour is one thing in light mode and another in dark, and a slash that
 * draws its own hole works on either. `useId` keeps two icons on one screen from
 * sharing a mask.
 */
import { useId } from "react";
import Icon from "@ant-design/icons";
import type { GetProps } from "antd";

/** `InboxOutlined`'s path, verbatim, so the two icons are the same weight. */
const INBOX_PATH =
  "M885.2 446.3l-.2-.8-112.2-285.1c-5-16.1-19.9-27.2-36.8-27.2H281.2c-17 0-32.1 11.3-36.9 27.6L139.4 443l-.3.7-.2.8c-1.3 4.9-1.7 9.9-1 14.8-.1 1.6-.2 3.2-.2 4.8V830a60.9 60.9 0 0060.8 60.8h627.2c33.5 0 60.8-27.3 60.9-60.8V464.1c0-1.3 0-2.6-.1-3.7.4-4.9 0-9.6-1.3-14.1zm-295.8-43l-.3 15.7c-.8 44.9-31.8 75.1-77.1 75.1-22.1 0-41.1-7.1-54.8-20.6S436 441.2 435.6 419l-.3-15.7H229.5L309 210h399.2l81.7 193.3H589.4zm-375 76.8h157.3c24.3 57.1 76 90.8 140.4 90.8 33.7 0 65-9.4 90.3-27.2 22.2-15.6 39.5-37.4 50.7-63.6h156.5V814H214.4V480.1z";

/** Where the slash runs, corner to corner with a little inset. */
const SLASH = { x1: 176, y1: 128, x2: 872, y2: 896 } as const;

function InboxSlashSvg() {
  const mask = `inbox-slash-${useId()}`;
  return (
    <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor">
      <defs>
        <mask id={mask}>
          {/* White keeps, black removes: the wide black line is the gap the
              slash sits in, so the two never touch at any icon size. */}
          <rect width="1024" height="1024" fill="white" />
          <line
            {...SLASH}
            stroke="black"
            strokeWidth={168}
            strokeLinecap="round"
          />
        </mask>
      </defs>
      <path d={INBOX_PATH} mask={`url(#${mask})`} />
      <line
        {...SLASH}
        stroke="currentColor"
        strokeWidth={78}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function InboxSlashOutlined(
  props: Omit<GetProps<typeof Icon>, "component">,
) {
  return <Icon component={InboxSlashSvg} {...props} />;
}
