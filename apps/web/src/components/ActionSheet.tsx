/**
 * A bottom sheet of text rows (owner-approved mockup, 2026-11-16).
 *
 * What a phone's "More ▾" opens: the page's rarer actions — export, print,
 * movement history — each a full-width row with its icon AND its word. It
 * replaced the float fan, whose members were glyphs with a hover tooltip on a
 * device that has no hover.
 *
 * An antd `Drawer` from the bottom, so the focus trap, the scrim, Escape and
 * the close button are antd's. `nusantara-bottom-sheet` rounds its top
 * corners and is what the full-screen dialog rule leaves alone.
 */
import type { ReactNode } from "react";
import { Button, Drawer, Flex } from "antd";
import { useTranslation } from "react-i18next";
import { SPACE, TYPE } from "../theme/tokens";

export interface SheetAction {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function ActionSheet({
  open,
  onClose,
  title,
  actions,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title?: string;
  readonly actions: readonly SheetAction[];
}) {
  const { t } = useTranslation();
  return (
    <Drawer
      placement="bottom"
      open={open}
      onClose={onClose}
      title={title ?? t("page.moreActions", "More actions")}
      size="auto"
      rootClassName="nusantara-bottom-sheet"
      styles={{
        body: {
          padding: `${SPACE.xs}px ${SPACE.sm}px calc(${SPACE.md}px + env(safe-area-inset-bottom))`,
        },
      }}
      destroyOnHidden
    >
      <Flex vertical gap={SPACE.xs}>
        {actions.map((a) => (
          <Button
            key={a.key}
            type="text"
            block
            size="large"
            icon={
              a.icon === undefined ? undefined : (
                <span aria-hidden>{a.icon}</span>
              )
            }
            danger={a.danger}
            disabled={a.disabled}
            onClick={() => {
              onClose();
              a.onClick();
            }}
            style={{
              justifyContent: "flex-start",
              height: 52,
              fontSize: TYPE.lg,
            }}
          >
            {a.label}
          </Button>
        ))}
      </Flex>
    </Drawer>
  );
}
