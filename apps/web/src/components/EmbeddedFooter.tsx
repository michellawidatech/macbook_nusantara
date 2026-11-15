import type { ReactNode } from "react";
import { Flex, theme } from "antd";
import { SPACE } from "../theme/tokens";

/**
 * The buttons of a form drawn inside somebody else's dialog — Inventory's
 * Stock In / Stock Out (owner ask 2026-11-16), where the type picked at the
 * top decides which form is below it and so which buttons end it.
 *
 * Laid out where antd's Modal puts its own footer — right-aligned, primary
 * last, a hairline above — so a form looks the same embedded as it does in
 * the dialog of its own every other screen opens.
 */
export function EmbeddedFooter({ children }: { children: ReactNode }) {
  const {
    token: { colorBorderSecondary },
  } = theme.useToken();
  return (
    <Flex
      // Pinned to the foot of a phone's full-screen dialog (global.css,
      // 2026-11-16), like the footer antd draws itself.
      className="nusantara-embedded-footer"
      justify="end"
      gap={SPACE.sm}
      wrap
      style={{
        marginTop: SPACE.lg,
        paddingTop: SPACE.md,
        borderTop: `1px solid ${colorBorderSecondary}`,
      }}
    >
      {children}
    </Flex>
  );
}
