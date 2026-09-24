/**
 * Repricing a shelf: every unit's counter price in one grid (owner ask
 * 2026-09-08), and what that does to the variant's marketplace listing
 * (2026-09-19).
 *
 * *"For editing the price, make it easy to edit all the unit price in the
 * inventory."*
 *
 * With a price per serial, repricing stopped being one field on the Product
 * and became one field per unit — which is right, and which would be
 * miserable if it meant opening eleven units one at a time. So this is the
 * whole set at once: a row per serial with what it cost and what it asks, plus
 * a header that fills the column down.
 *
 * ## No marketplace column (2026-09-19)
 *
 * *"Marketplace price is taken from the highest price for all unit, so it
 * will not be displayed per unit."* The per-unit marketplace box and its Fill
 * down went the day the listing became the variant's. What the grid shows
 * instead is the CONSEQUENCE: the variant's marketplace price as it stands
 * and as it will be after Save, because repricing the dearest unit is how the
 * listing moves and somebody pricing a shelf should see it move.
 *
 * The preview has to be told about the variant's OTHER units (`listedUnits`):
 * the grid holds one grade in one warehouse, and the listing is the highest
 * across all of them.
 *
 * ## What a unit cost, not only what it was bought for
 *
 * The cost column is COGS — the invoice line, the unit's share of the
 * invoice's expenses and its repairs (`costBreakdown`) — and "Below cost" is
 * measured against it. It showed `Unit.buy` until 2026-09-19, which let a
 * unit be priced under what it had actually cost without a word.
 *
 * ## Nothing is written until Save
 *
 * A price grid that committed per keystroke would file Rp9, Rp95, Rp950 … on
 * the way to Rp9.500.000, and every one of those is a number somebody could
 * have meant. The draft lives here and one mutation writes the lot, which is
 * also what lets the ledger record a repricing as one act.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Flex,
  InputNumber,
  Modal,
  Table,
  Tooltip,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { GradeTag } from "./GradeTag";
import { CostInfoButton } from "./CostBreakdown";
import { RP_SYMBOL, moneyFormatter, moneyParser } from "./money";
import { fmtRp } from "../lib/format.js";
import {
  isPriceInRange,
  priceOf,
  PRICE_MAX,
  PRICE_MIN,
  variantMarketPrice,
  type ListedUnit,
} from "../lib/unitPrice.js";
import type { UnitCost } from "../lib/service.js";
import { SPACE, TYPE } from "../theme/tokens";

/** One unit as this grid needs it. A store `Unit` is one. */
export interface PriceEditorUnit extends ListedUnit {
  readonly buy: number;
  /** Its invoice, for its share of the invoice's expenses; null for none. */
  readonly poId: string | null;
}

/** What Save hands back: only the units whose price actually moved. */
export interface PriceEdit {
  readonly serial: string;
  /** The new counter price. */
  readonly price: number;
}

export interface PriceEditorModalProps {
  readonly open: boolean;
  readonly units: readonly PriceEditorUnit[];
  /** `Sku.price` per SKU id — what a unit with no price of its own quotes. */
  readonly skuPrice: (skuId: string) => number;
  readonly markupPct: number;
  /** What a unit has cost the shop — build it with `costIndex`. */
  readonly costOf: (unit: PriceEditorUnit) => UnitCost;
  /**
   * Every unit a variant's listing is taken over — the store's units. Without
   * it the preview can only see the grid's own units, which is one grade in
   * one warehouse of what the listing covers.
   */
  readonly listedUnits?: readonly ListedUnit[];
  /** A variant's name, for the preview when the grid spans more than one. */
  readonly skuName?: (skuId: string) => string;
  /** What the dialog is about: a product, a grade, a warehouse. */
  readonly title: string;
  readonly onClose: () => void;
  readonly onSave: (edits: readonly PriceEdit[]) => void;
}

export function PriceEditorModal({
  open,
  units,
  skuPrice,
  markupPct,
  costOf,
  listedUnits,
  skuName,
  title,
  onClose,
  onSave,
}: PriceEditorModalProps) {
  const { t } = useTranslation();
  /** Serial → the typed price; `null` is a box somebody emptied. */
  const [draft, setDraft] = useState<Record<string, number | null>>({});

  // Re-seeded whenever the dialog opens on a different set. Keyed on the
  // serials rather than on `open` alone, so reopening on another product does
  // not show the previous one's numbers for a frame.
  const key = units.map((u) => u.serial).join("|");
  useEffect(() => {
    if (!open) return;
    setDraft(
      Object.fromEntries(
        units.map((u) => [u.serial, priceOf(u, skuPrice(u.skuId))]),
      ),
    );
    // `skuPrice` is a closure over the store and changes on every render; the
    // set of serials is what actually decides whether this needs re-seeding.
    // This project's eslint config has no exhaustive-deps rule to disable, so
    // the reason is stated rather than suppressed.
  }, [open, key]);

  const current = (u: PriceEditorUnit) => priceOf(u, skuPrice(u.skuId));
  /** What the box holds: the draft, or — before it is seeded — the stored price. */
  const typed = (u: PriceEditorUnit): number | null => {
    const v = draft[u.serial];
    return v === undefined ? current(u) : v;
  };

  /** Everything that is out of range, so Save can refuse and say how many. */
  const bad = units.filter((u) => !isPriceInRange(typed(u))).length;

  /**
   * Fill the column down from the first row.
   *
   * The shop's actual repricing job: eleven units of one variant that all
   * move by the same amount because the market did. Taking the top row rather
   * than asking for a number in a second dialog keeps it to one press.
   */
  const fillDown = () => {
    const first = units[0];
    if (!first) return;
    const value = typed(first);
    setDraft(Object.fromEntries(units.map((u) => [u.serial, value])));
  };

  /**
   * A unit as it will stand after Save: the typed price, and — if that price
   * moved — no legacy marketplace override, because saving a price hands the
   * unit back to the rule (see `applyPriceEdits` in `InventoryTable`).
   */
  const afterSave = (u: PriceEditorUnit): ListedUnit => {
    const price = typed(u) ?? current(u);
    return price === current(u) ? u : { ...u, price, marketPrice: undefined };
  };

  /** The variant's listing now and after Save, per variant in the grid. */
  const listings = useMemo(() => {
    const pool = listedUnits ?? units;
    const mine = new Set(units.map((u) => u.serial));
    const after = [
      ...pool.filter((u) => !mine.has(u.serial)),
      ...units.map(afterSave),
    ];
    const skuIds = [...new Set(units.map((u) => u.skuId))];
    return skuIds.map((skuId) => ({
      skuId,
      before: variantMarketPrice(pool, skuId, skuPrice(skuId), markupPct),
      after: variantMarketPrice(after, skuId, skuPrice(skuId), markupPct),
    }));
    // `afterSave` and `skuPrice` read the draft and the store, both of which
    // are listed; see the seeding effect above for the rule.
  }, [units, listedUnits, draft, markupPct]);

  const save = () => {
    const edits: PriceEdit[] = [];
    for (const u of units) {
      const price = typed(u) ?? current(u);
      // Only what moved. A dialog opened and closed on eleven units must not
      // write eleven identical repricings into the ledger.
      if (price === current(u)) continue;
      edits.push({ serial: u.serial, price });
    }
    onSave(edits);
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={760}
      // Reachable from inside Inventory's unit popup since 2026-09-23, which
      // is a modal in another part of the tree — see `UnitEditModal`.
      zIndex={1100}
      title={t("price.editTitle", "Prices — {{what}}", { what: title })}
      okText={t("price.save", "Save prices")}
      okButtonProps={{ disabled: bad > 0 }}
      onOk={save}
    >
      {bad > 0 && (
        <Typography.Text type="danger">
          {t("price.outOfRange", "{{n}} of these is not a price.", { n: bad })}
        </Typography.Text>
      )}
      <Table<PriceEditorUnit>
        size="small"
        rowKey="serial"
        dataSource={units as PriceEditorUnit[]}
        pagination={false}
        scroll={{ y: 420 }}
        columns={[
          {
            title: t("price.serial", "Serial"),
            dataIndex: "serial",
            render: (v: string) => (
              <Typography.Text style={{ fontFamily: "monospace" }}>
                {v}
              </Typography.Text>
            ),
          },
          {
            title: t("price.grade", "Grade"),
            key: "grade",
            width: 80,
            render: (_: unknown, u: PriceEditorUnit) => (
              <GradeTag grade={u.grade} />
            ),
          },
          {
            // What it cost, so nobody prices a unit under it by accident.
            // Read-only here: a cost is a fact about a purchase and its
            // repairs, not a number a repricing may touch.
            title: t("price.cogs", "COGS"),
            key: "cost",
            width: 170,
            align: "right",
            render: (_: unknown, u: PriceEditorUnit) => (
              <Flex align="center" justify="flex-end" gap={SPACE.xs}>
                <Typography.Text type="secondary">
                  {fmtRp(costOf(u).total)}
                </Typography.Text>
                <CostInfoButton serial={u.serial} cost={costOf(u)} />
              </Flex>
            ),
          },
          {
            title: (
              <Flex align="center" gap={SPACE.xs} justify="flex-end">
                {t("price.store", "Store price")}
                <Tooltip
                  title={t(
                    "price.fillDown",
                    "Copy the top row down the column",
                  )}
                >
                  <Button size="small" type="link" onClick={fillDown}>
                    {t("price.fill", "Fill down")}
                  </Button>
                </Tooltip>
              </Flex>
            ),
            key: "price",
            width: 240,
            align: "right",
            render: (_: unknown, u: PriceEditorUnit) => {
              const value = typed(u);
              const badRow = !isPriceInRange(value);
              return (
                <Flex vertical align="flex-end" gap={2}>
                  <InputNumber
                    // No `min`/`max`: antd snaps rather than refusing, and a
                    // snapped price is a number nobody chose. See
                    // `components/BatteryFields.tsx` for the same reasoning.
                    aria-valuemin={PRICE_MIN}
                    aria-valuemax={PRICE_MAX}
                    style={{ width: "100%" }}
                    status={badRow ? "error" : undefined}
                    aria-invalid={badRow || undefined}
                    aria-label={t(
                      "price.storeFor",
                      "Store price for {{serial}}",
                      { serial: u.serial },
                    )}
                    value={value}
                    formatter={moneyFormatter}
                    parser={moneyParser}
                    precision={0}
                    prefix={RP_SYMBOL}
                    onChange={(v) => setDraft((d) => ({ ...d, [u.serial]: v }))}
                  />
                  {value != null && value < costOf(u).total && (
                    // The one warning worth the vertical space: a unit priced
                    // under what it cost is a loss somebody should have
                    // meant. It does not block — the shop does clear stock.
                    <Typography.Text
                      type="warning"
                      style={{ fontSize: TYPE.sm }}
                    >
                      {t("price.belowCost", "Below cost")}
                    </Typography.Text>
                  )}
                </Flex>
              );
            },
          },
        ]}
      />
      <Flex vertical gap={SPACE.xs} style={{ marginTop: SPACE.md }}>
        {listings.map(({ skuId, before, after }) => {
          const line =
            after === undefined
              ? t(
                  "price.notListed",
                  "Marketplace: not listed — no unit of this variant is on sale.",
                )
              : before === after
                ? t("price.listing", "Marketplace price: {{price}}", {
                    price: fmtRp(after),
                  })
                : t(
                    "price.listingChanges",
                    "Marketplace price after saving: {{before}} → {{after}}",
                    { before: fmtRp(before), after: fmtRp(after) },
                  );
          return (
            <Typography.Text key={skuId} strong={before !== after}>
              {listings.length > 1 && skuName ? `${skuName(skuId)} — ` : ""}
              {line}
            </Typography.Text>
          );
        })}
      </Flex>
    </Modal>
  );
}
