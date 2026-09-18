/**
 * Every keyboard shortcut, on one card (owner ask 2026-09-15).
 *
 * Opened by `?` from anywhere that is not a field — see `KeyboardNav`. A
 * shortcut nobody has heard of is a shortcut nobody uses, and a screen that can
 * only be driven from the keyboard by somebody who has read its source is not
 * keyboard friendly.
 *
 * Keycaps are not translated: `Enter`, `Esc` and `⌘` are printed on the
 * keyboard in both languages (see the head of `i18n/locales/id.ts`). Space is
 * the exception — nothing is printed on a space bar, so its name is a word,
 * and a word gets translated.
 */
import { Flex, Modal, Typography, theme } from "antd";
import { useTranslation } from "react-i18next";
import { SPACE, TYPE } from "../theme/tokens";
import { addRowShortcutLabel } from "./EditableTable";

interface Shortcut {
  /** Printed on the keyboard, so not translated. */
  readonly keys: readonly string[];
  readonly description: string;
}

interface ShortcutGroup {
  readonly heading: string;
  readonly shortcuts: readonly Shortcut[];
}

export interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsModal({
  open,
  onClose,
}: KeyboardShortcutsModalProps) {
  const { t } = useTranslation();
  const {
    token: { colorTextSecondary, colorBorderSecondary },
  } = theme.useToken();

  const space = t("keyboard.keySpace", "Space");
  const groups: ShortcutGroup[] = [
    {
      heading: t("keyboard.groupFields", "Filling in"),
      shortcuts: [
        {
          keys: ["Enter"],
          description: t(
            "keyboard.enter",
            "Next field. On the last field of a dialog, confirms it; anywhere else, lands on the button that saves.",
          ),
        },
        {
          keys: ["Tab", "Shift + Tab"],
          description: t(
            "keyboard.tab",
            "Next or previous control, buttons and switches included",
          ),
        },
        {
          keys: ["Esc"],
          description: t("keyboard.escape", "Close a dropdown or a dialog"),
        },
      ],
    },
    {
      heading: t("keyboard.groupGrids", "Line-item grids"),
      shortcuts: [
        {
          keys: ["↑", "↓"],
          description: t(
            "keyboard.gridUpDown",
            "Same column, one row up or down",
          ),
        },
        {
          keys: ["←", "→"],
          description: t(
            "keyboard.gridLeftRight",
            "Previous or next cell, once the caret reaches the edge of the text",
          ),
        },
        {
          keys: [addRowShortcutLabel()],
          description: t("keyboard.addRow", "Add a row"),
        },
      ],
    },
    {
      heading: t("keyboard.groupLists", "Lists"),
      shortcuts: [
        {
          keys: ["↑", "↓"],
          description: t("keyboard.listUpDown", "Previous or next row"),
        },
        {
          keys: ["Home", "End"],
          description: t(
            "keyboard.listHomeEnd",
            "First or last row on this page of the list",
          ),
        },
        {
          keys: ["Enter", space],
          description: t("keyboard.listOpen", "Open the highlighted row"),
        },
      ],
    },
    {
      heading: t("keyboard.groupAnywhere", "Anywhere"),
      shortcuts: [
        {
          keys: ["/"],
          description: t("keyboard.search", "Jump to this page's search box"),
        },
        {
          keys: ["?"],
          description: t("keyboard.help", "Show this list"),
        },
      ],
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      title={t("keyboard.title", "Keyboard shortcuts")}
      width={560}
    >
      <Flex vertical gap={SPACE.md}>
        {groups.map((group) => (
          <section key={group.heading} aria-label={group.heading}>
            <Typography.Text
              strong
              style={{
                display: "block",
                marginBottom: SPACE.xs,
                fontSize: TYPE.sm,
                color: colorTextSecondary,
              }}
            >
              {group.heading}
            </Typography.Text>
            <dl style={{ margin: 0 }}>
              {group.shortcuts.map((shortcut) => (
                <Flex
                  key={shortcut.description}
                  justify="space-between"
                  align="baseline"
                  gap={SPACE.md}
                  style={{
                    padding: `${SPACE.xs}px 0`,
                    borderTop: `1px solid ${colorBorderSecondary}`,
                  }}
                >
                  <dt style={{ flexShrink: 0 }}>
                    <Flex gap={4} wrap>
                      {shortcut.keys.map((key) => (
                        <Typography.Text keyboard key={key}>
                          {key}
                        </Typography.Text>
                      ))}
                    </Flex>
                  </dt>
                  <dd style={{ margin: 0, textAlign: "right" }}>
                    {shortcut.description}
                  </dd>
                </Flex>
              ))}
            </dl>
          </section>
        ))}
        <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
          {t(
            "keyboard.stays",
            "Enter stays put after a scan, so scanning keeps landing in the box it was aimed at — and in a search box, and in a box that has just refused what was typed.",
          )}
        </Typography.Text>
      </Flex>
    </Modal>
  );
}
