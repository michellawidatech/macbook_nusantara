/**
 * How a list is ordered, on a phone (owner-approved mockup, 2026-11-16).
 *
 * A desktop sorts by clicking a column heading; a phone draws no headings, so
 * the same choice is a sheet: each sortable column both ways, plus the list's
 * default. A pick applies at once and closes — there is nothing to review
 * before an order changes. It writes the same `{ key, order }` the header
 * arrows write (`ProTable`).
 */
import { Button, Drawer, Flex } from "antd";
import { CheckOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { SPACE, TYPE } from "../theme/tokens";

export type SortOrder = "ascend" | "descend" | null;

export interface SortChoice {
  readonly key: string;
  readonly label: string;
  /** A date reads as newest/oldest rather than ascending/descending. */
  readonly isDate?: boolean;
}

/** What a sort reads as in words, for the sheet and the line above a list. */
export function sortWords(
  t: (key: string, fallback: string, vars?: Record<string, unknown>) => string,
  choice: SortChoice,
  order: "ascend" | "descend",
): string {
  if (choice.isDate)
    return order === "descend"
      ? t("sortSheet.newest", "{{column}} — newest first", {
          column: choice.label,
        })
      : t("sortSheet.oldest", "{{column}} — oldest first", {
          column: choice.label,
        });
  return order === "ascend"
    ? t("sortSheet.ascending", "{{column}} — ascending", {
        column: choice.label,
      })
    : t("sortSheet.descending", "{{column}} — descending", {
        column: choice.label,
      });
}

export function SortSheet({
  open,
  onClose,
  choices,
  current,
  onPick,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly choices: readonly SortChoice[];
  readonly current: { readonly key: string; readonly order: SortOrder };
  readonly onPick: (key: string, order: SortOrder) => void;
}) {
  const { t } = useTranslation();
  const row = (id: string, label: string, on: boolean, pick: () => void) => (
    <Button
      key={id}
      type="text"
      block
      size="large"
      aria-pressed={on}
      onClick={() => {
        pick();
        onClose();
      }}
      style={{
        justifyContent: "space-between",
        height: 52,
        fontSize: TYPE.lg,
        fontWeight: on ? 600 : undefined,
      }}
    >
      <span>{label}</span>
      {on && <CheckOutlined aria-hidden />}
    </Button>
  );
  return (
    <Drawer
      placement="bottom"
      open={open}
      onClose={onClose}
      title={t("sortSheet.title", "Sort")}
      size="auto"
      rootClassName="nusantara-bottom-sheet"
      destroyOnHidden
      styles={{ body: { padding: `${SPACE.xs}px ${SPACE.sm}px` } }}
    >
      <Flex vertical>
        {row(
          "default",
          t("sortSheet.default", "Default order"),
          current.order === null,
          () => onPick("", null),
        )}
        {choices.flatMap((c) =>
          (c.isDate
            ? (["descend", "ascend"] as const)
            : (["ascend", "descend"] as const)
          ).map((order) =>
            row(
              `${c.key}:${order}`,
              sortWords(t, c, order),
              current.key === c.key && current.order === order,
              () => onPick(c.key, order),
            ),
          ),
        )}
      </Flex>
    </Drawer>
  );
}
