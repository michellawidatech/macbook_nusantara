/**
 * What one unit has cost the shop, taken apart (owner ask 2026-09-19).
 *
 * > *"The unit price should have an 'i' button per unit that breaks the cost
 * > down."*
 *
 * `lib/service.ts`'s `costBreakdown` has kept a cost as its parts since
 * 2026-09-15 — the invoice line, the unit's share of the invoice's expenses,
 * every repair — precisely so a screen could show what a COGS figure is made
 * of: an opaque cost is an argument waiting to happen. This is that screen
 * furniture, once, so the Inventory popup and the price grid cannot word the
 * same four numbers two ways.
 *
 * A popover on a click rather than a tooltip on a hover: the button sits in a
 * table somebody is using on a phone in the warehouse, and a hover does not
 * exist there.
 */
import {
  App,
  Button,
  Divider,
  Flex,
  Popconfirm,
  Popover,
  Typography,
} from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { fmtDate, fmtRp } from "../lib/format.js";
import type { UnitCost } from "../lib/service.js";
import { HELD_STATUSES, rowLocked, writeDownsOf } from "../lib/writeDown.js";
import { mutate, useDb } from "../mock/store.js";
import type { WriteDown } from "../mock/seed.js";
import { SPACE, TYPE } from "../theme/tokens";

/** The four lines: unit price, expenses share, repairs, and the total. */
export function CostBreakdown({ cost }: { cost: UnitCost }) {
  const { t } = useTranslation();
  const line = (label: string, amount: number, strong = false) => (
    <Flex justify="space-between" gap={SPACE.lg}>
      <Typography.Text type={strong ? undefined : "secondary"} strong={strong}>
        {label}
      </Typography.Text>
      <Typography.Text strong={strong}>{fmtRp(amount)}</Typography.Text>
    </Flex>
  );
  return (
    <Flex vertical gap={2} style={{ minWidth: 240 }}>
      {line(t("cost.unitPrice", "Unit price"), cost.buy)}
      {line(
        t("cost.expenseShare", "Shipping, tax & fees share"),
        cost.shippingTax,
      )}
      {line(t("cost.repairs", "Repairs"), cost.repair)}
      {cost.writeDown > 0 &&
        line(t("cost.writeDown", "Value written down"), -cost.writeDown)}
      <Divider style={{ margin: `${SPACE.xs}px 0` }} />
      {line(t("cost.cogs", "COGS"), cost.total, true)}
    </Flex>
  );
}

/**
 * The unit's write-downs under its cost (2026-11-24): when, how much, why and
 * who. Edit and Delete only where `onEdit` is given (Inventory) and only
 * while the row can still change — the unit held, and nothing having taken
 * it out of the shop since (`rowLocked`).
 */
function WriteDownList({
  serial,
  onEdit,
}: {
  serial: string;
  onEdit?: (row: WriteDown) => void;
}) {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();
  const rows = writeDownsOf(serial, db);
  if (rows.length === 0) return null;
  const unit = db.units.find((u) => u.serial === serial);
  const held = unit !== undefined && HELD_STATUSES.has(unit.status);
  return (
    <Flex
      vertical
      gap={SPACE.xs}
      style={{ marginTop: SPACE.sm, maxWidth: 320 }}
    >
      <Typography.Text strong>
        {t("writeDown.listTitle", "Value written down")}
      </Typography.Text>
      {rows.map((w) => {
        const open = onEdit !== undefined && held && !rowLocked(w, db.events);
        return (
          <Flex key={w.id} vertical gap={0} data-testid="write-down-row">
            <Flex justify="space-between" gap={SPACE.md}>
              <Typography.Text>{w.reason}</Typography.Text>
              <Typography.Text type="danger">
                −{fmtRp(w.amount)}
              </Typography.Text>
            </Flex>
            <Flex justify="space-between" align="center" gap={SPACE.md}>
              <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                {`${fmtDate(w.date)} · ${w.staff}`}
              </Typography.Text>
              {open && (
                <Flex gap={4}>
                  <Button size="small" type="link" onClick={() => onEdit(w)}>
                    {t("writeDown.edit", "Edit")}
                  </Button>
                  <Popconfirm
                    zIndex={1200}
                    title={t(
                      "writeDown.deleteConfirm",
                      "Delete this write-down? The COGS goes back up by {{amount}}.",
                      { amount: fmtRp(w.amount) },
                    )}
                    okText={t("writeDown.delete", "Delete")}
                    cancelText={t("writeDown.cancel", "Cancel")}
                    onConfirm={() => {
                      mutate((d) => {
                        d.writeDowns = d.writeDowns.filter(
                          (x) => x.id !== w.id,
                        );
                      });
                      message.success(
                        t("writeDown.deleted", "Write-down deleted."),
                      );
                    }}
                  >
                    <Button size="small" type="link" danger>
                      {t("writeDown.delete", "Delete")}
                    </Button>
                  </Popconfirm>
                </Flex>
              )}
            </Flex>
          </Flex>
        );
      })}
    </Flex>
  );
}

/** The "i" beside a unit's price, opening its `CostBreakdown`. */
export function CostInfoButton({
  serial,
  cost,
  onEditWriteDown,
}: {
  serial: string;
  cost: UnitCost;
  /** Inventory's door to correcting a write-down; absent lists them read-only. */
  onEditWriteDown?: (row: WriteDown) => void;
}) {
  const { t } = useTranslation();
  return (
    <Popover
      trigger="click"
      title={t("cost.title", "What {{serial}} cost", { serial })}
      content={
        <>
          <CostBreakdown cost={cost} />
          <WriteDownList serial={serial} onEdit={onEditWriteDown} />
        </>
      }
    >
      <Button
        type="text"
        size="small"
        icon={<InfoCircleOutlined />}
        aria-label={t("cost.showAria", "How the cost of {{serial}} adds up", {
          serial,
        })}
        // The row a button sits in may open something of its own on a click.
        onClick={(e) => e.stopPropagation()}
      />
    </Popover>
  );
}
