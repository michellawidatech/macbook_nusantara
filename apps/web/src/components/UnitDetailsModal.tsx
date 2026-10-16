/**
 * What has to be said about each unit of one purchase line — behind a popup
 * (owner ask 2026-09-20).
 *
 * > *"When the user clicks tab, then it will display a modal popup for the
 * > user to fill: Serial, grade, battery, sell price."*
 *
 * The invoice line itself is a product, a quantity and a price; this is what
 * the bench answers about the machines behind it. It is deliberately the same
 * component on both inbound screens — the order form (`InboundFormPage`) and
 * the order's own page (`InboundDetailPage`) — because the owner's ask was
 * that the two look alike: *"either seeing inbound detail and adding new
 * inbound will have the same display for the unit."* One component is the
 * only way that cannot drift.
 *
 * ## Why the cells are render props
 *
 * The two callers answer into different places. The order form holds drafts
 * until it writes the order; the order page writes each answer to the store
 * as it is given, with a scanner aimed at the serial box, a refusal outlined
 * in red, photos, and the row's accept/service/return decisions. Sharing the
 * WIDGETS would mean sharing all of that; sharing the LAYOUT is what the ask
 * is about. So this owns the columns, their order, their headings and their
 * widths, and each caller hands in the control that goes in the cell.
 *
 * Description is a column the owner did not list. It is here because a
 * second-hand unit cannot be accepted into stock without one (`qcReady`), so
 * a popup that never asks for it is a popup after which nothing can be
 * shelved (owner answer 2026-09-20: keep it).
 *
 * ## The quantity follows the serials
 *
 * > *"However if the user clicks tab and enter the serial before entering the
 * > qty, qty is auto-derived from the serials."*
 *
 * `onAddUnit` is that: another unit on this line, from inside the popup,
 * which raises the line's quantity. The caller decides what a unit costs and
 * whether one may still be added.
 */
import type { ReactNode } from "react";
import { Button, Flex, Modal, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { EditableTable } from "./EditableTable";
import { COLUMN, SPACE, TYPE } from "../theme/tokens";

/** The least a row has to be for this table to draw it. */
export interface UnitDetailRow {
  /** Unique within the popup — the caller's own key for the unit. */
  readonly key: string;
  /** Which piece of the line it is, from 1. */
  readonly n: number;
}

export interface UnitDetailsModalProps<R extends UnitDetailRow> {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The product this popup is about, as the line names it. */
  readonly product: string;
  /** Said under the product — the price, the discount, what a piece cost. */
  readonly subtitle?: ReactNode;
  readonly rows: readonly R[];
  readonly serial: (row: R) => ReactNode;
  readonly grade: (row: R) => ReactNode;
  readonly battery: (row: R) => ReactNode;
  readonly description: (row: R) => ReactNode;
  readonly sellPrice: (row: R) => ReactNode;
  /** The row's own buttons — decisions, photos. Omitted where there are none. */
  readonly actions?: (row: R) => ReactNode;
  /**
   * How wide the widest row's buttons are, cell padding included. The column
   * is laid out `fixed`, so buttons wider than it do not widen it — they
   * spill left over the sell price (owner report 2026-10-08).
   */
  readonly actionsWidth?: number;
  /** Another unit on this line. Omitted when the quantity cannot grow. */
  readonly onAddUnit?: () => void;
  /** Anything the caller wants under the table. */
  readonly footer?: ReactNode;
}

export function UnitDetailsModal<R extends UnitDetailRow>({
  open,
  onClose,
  product,
  subtitle,
  rows,
  serial,
  grade,
  battery,
  description,
  sellPrice,
  actions,
  actionsWidth = COLUMN.actionsPair,
  onAddUnit,
  footer,
}: UnitDetailsModalProps<R>) {
  const { t } = useTranslation();

  /*
   * The owner's order — serial, grade, battery, then the description that
   * gates acceptance, then what the unit will ask over the counter.
   */
  const columns = [
    {
      title: "#",
      key: "n",
      width: 44,
      responsive: ["md" as const],
      render: (_: unknown, r: R) => (
        <Typography.Text type="secondary">{r.n}</Typography.Text>
      ),
    },
    {
      title: t("inbound.serial", "Serial"),
      key: "serial",
      // A new unit's serial is ten to twelve; a second-hand one is taken as
      // read. Sized for a serial, not for a sentence.
      width: COLUMN.serial,
      render: (_: unknown, r: R) => serial(r),
    },
    {
      title: t("inbound.grade", "Grade"),
      key: "grade",
      width: COLUMN.grade,
      render: (_: unknown, r: R) => grade(r),
    },
    {
      // Health, or cycles and full charge capacity side by side — the model
      // decides which (`lib/battery.ts`), and the pair needs the room.
      title: t("inbound.battery", "Battery Health"),
      key: "battery",
      width: 230,
      render: (_: unknown, r: R) => battery(r),
    },
    {
      title: t("inbound.description", "Description"),
      key: "description",
      width: 240,
      render: (_: unknown, r: R) => description(r),
    },
    {
      title: t("inbound.sellPrice", "Sell price"),
      key: "sell",
      width: COLUMN.moneyInput,
      render: (_: unknown, r: R) => sellPrice(r),
    },
    ...(actions
      ? [
          {
            // Untitled, so a phone puts these in the card's footer rather
            // than labelling a row of buttons as if it were a field.
            title: "",
            key: "actions",
            width: actionsWidth,
            align: "right" as const,
            render: (_: unknown, r: R) => actions(r),
          },
        ]
      : []),
  ];

  // As wide as the columns need, and no wider than the screen: every column
  // is declared, so their sum is the grid, and 48 is the dialog's padding.
  const grid = columns.reduce((sum, c) => sum + c.width, 0);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={`min(${Math.max(1180, grid + 48)}px, calc(100vw - 32px))`}
      title={
        <Flex vertical gap={2}>
          <Typography.Text strong style={{ fontSize: TYPE.lg }}>
            {product}
          </Typography.Text>
          {subtitle !== undefined && (
            <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
              {subtitle}
            </Typography.Text>
          )}
        </Flex>
      }
      footer={
        <Button type="primary" onClick={onClose}>
          {t("common.done", "Done")}
        </Button>
      }
      destroyOnHidden
    >
      <Flex vertical gap={SPACE.md}>
        <EditableTable<R>
          size="small"
          rowKey="key"
          className="qc-table"
          dataSource={rows}
          // On a phone the row is a card, and this is its heading.
          rowTitle={(r) => t("inbound.unitN", "unit {{n}}", { n: r.n })}
          emptyText={t(
            "inbound.detailsNoUnits",
            "No units on this line yet. Add one to start recording serials.",
          )}
          {...(onAddUnit
            ? {
                onAdd: onAddUnit,
                addLabel: t("inbound.detailsAddUnit", "Add another unit"),
              }
            : {})}
          columns={columns}
        />
        {footer}
      </Flex>
    </Modal>
  );
}
