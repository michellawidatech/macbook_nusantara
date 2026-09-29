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
import { Button, Divider, Flex, Popover, Typography } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { fmtRp } from "../lib/format.js";
import type { UnitCost } from "../lib/service.js";
import { SPACE } from "../theme/tokens";

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
      <Divider style={{ margin: `${SPACE.xs}px 0` }} />
      {line(t("cost.cogs", "COGS"), cost.total, true)}
    </Flex>
  );
}

/** The "i" beside a unit's price, opening its `CostBreakdown`. */
export function CostInfoButton({
  serial,
  cost,
}: {
  serial: string;
  cost: UnitCost;
}) {
  const { t } = useTranslation();
  return (
    <Popover
      trigger="click"
      title={t("cost.title", "What {{serial}} cost", { serial })}
      content={<CostBreakdown cost={cost} />}
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
