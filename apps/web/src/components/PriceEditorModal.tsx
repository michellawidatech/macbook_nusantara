/**
 * Repricing a shelf: every machine's counter price and marketplace price, in
 * one grid (owner ask 2026-09-08).
 *
 * *"For editing the price, make it easy to edit all the unit price in the
 * inventory, both for store price and marketplace price."*
 *
 * With a price per serial, repricing stopped being one field on the Product
 * and became one field per machine — which is right, and which would be
 * miserable if it meant opening eleven units one at a time. So this is the
 * whole set at once: a row per serial with what it cost, what it asks and what
 * it is listed at, plus a header that fills a column down.
 *
 * ## The marketplace column is derived until it is not
 *
 * A blank marketplace box means "use the rule" — the store price plus the
 * shop's markup — and shows the derived figure as a placeholder so the row
 * never looks unpriced. Typing in it overrides the rule for that machine;
 * clearing it hands the machine back to the rule. That is the same contract
 * `lib/unitPrice.ts` describes, made visible: there is no third state and no
 * checkbox.
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
import { RP_SYMBOL, moneyFormatter, moneyParser } from "./money";
import { fmtRp } from "../lib/format.js";
import {
  derivedMarketPrice,
  isPriceInRange,
  marketPriceOf,
  markupOf,
  priceOf,
  PRICE_MAX,
  PRICE_MIN,
} from "../lib/unitPrice.js";
import { SPACE, TYPE } from "../theme/tokens";

/** One machine as this grid needs it. */
export interface PriceEditorUnit {
  readonly serial: string;
  readonly skuId: string;
  readonly grade?: string;
  readonly buy: number;
  readonly price?: number;
  readonly marketPrice?: number;
}

/** What Save hands back: only the machines whose numbers actually moved. */
export interface PriceEdit {
  readonly serial: string;
  /** The new counter price. */
  readonly price: number;
  /** The new marketplace price, or `undefined` to hand it back to the rule. */
  readonly marketPrice: number | undefined;
}

export interface PriceEditorModalProps {
  readonly open: boolean;
  readonly units: readonly PriceEditorUnit[];
  /** `Sku.price` per SKU id — what a machine with no price of its own quotes. */
  readonly skuPrice: (skuId: string) => number;
  readonly markupPct: number;
  /** What the dialog is about: a product name, a grade, a warehouse. */
  readonly title: string;
  readonly onClose: () => void;
  readonly onSave: (edits: readonly PriceEdit[]) => void;
}

interface Draft {
  price: number | null;
  /** `null` is "use the rule" — the box is empty. */
  market: number | null;
}

export function PriceEditorModal({
  open,
  units,
  skuPrice,
  markupPct,
  title,
  onClose,
  onSave,
}: PriceEditorModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Record<string, Draft>>({});

  // Re-seeded whenever the dialog opens on a different set. Keyed on the
  // serials rather than on `open` alone, so reopening on another product does
  // not show the previous one's numbers for a frame.
  const key = units.map((u) => u.serial).join("|");
  useEffect(() => {
    if (!open) return;
    setDraft(
      Object.fromEntries(
        units.map((u) => [
          u.serial,
          {
            price: priceOf(u, skuPrice(u.skuId)),
            market: u.marketPrice ?? null,
          },
        ]),
      ),
    );
    // `skuPrice` is a closure over the store and changes on every render; the
    // set of serials is what actually decides whether this needs re-seeding.
    // This project's eslint config has no exhaustive-deps rule to disable, so
    // the reason is stated rather than suppressed.
  }, [open, key]);

  const rowOf = (u: PriceEditorUnit): Draft =>
    draft[u.serial] ?? { price: priceOf(u, skuPrice(u.skuId)), market: null };

  const set = (serial: string, patch: Partial<Draft>) =>
    setDraft((d) => ({
      ...d,
      [serial]: { ...(d[serial] ?? { price: null, market: null }), ...patch },
    }));

  /** Everything that is out of range, so Save can refuse and say how many. */
  const bad = useMemo(
    () =>
      units.filter((u) => {
        const r = rowOf(u);
        return !isPriceInRange(r.price) || !isPriceInRange(r.market);
      }).length,
    // `rowOf` closes over `draft`, which is already a dependency.
    [units, draft],
  );

  /**
   * Fill a column down from the first row.
   *
   * The shop's actual repricing job: eleven machines of one variant that all
   * move by the same amount because the market did. Taking the top row rather
   * than asking for a number in a second dialog keeps it to one press.
   */
  const fillDown = (field: keyof Draft) => {
    const first = units[0];
    if (!first) return;
    const value = rowOf(first)[field];
    setDraft((d) => {
      const next = { ...d };
      for (const u of units) {
        next[u.serial] = { ...(next[u.serial] ?? rowOf(u)), [field]: value };
      }
      return next;
    });
  };

  const save = () => {
    const edits: PriceEdit[] = [];
    for (const u of units) {
      const r = rowOf(u);
      const price = r.price ?? priceOf(u, skuPrice(u.skuId));
      const market = r.market ?? undefined;
      // Only what moved. A dialog opened and closed on eleven machines must
      // not write eleven identical repricings into the ledger.
      if (price === priceOf(u, skuPrice(u.skuId)) && market === u.marketPrice) {
        continue;
      }
      edits.push({ serial: u.serial, price, marketPrice: market });
    }
    onSave(edits);
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={860}
      title={t("price.editTitle", "Prices — {{what}}", { what: title })}
      okText={t("price.save", "Save prices")}
      okButtonProps={{ disabled: bad > 0 }}
      onOk={save}
    >
      <Typography.Paragraph type="secondary">
        {t(
          "price.marketHint",
          "Leave the marketplace price empty to follow the rule: store price plus {{pct}}%.",
          { pct: markupPct },
        )}
      </Typography.Paragraph>
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
            // What it cost, so nobody prices a machine under it by accident.
            // Read-only here: a cost is a fact about a purchase, not a number
            // a repricing may touch.
            title: t("price.cost", "Cost"),
            key: "buy",
            width: 130,
            align: "right",
            render: (_: unknown, u: PriceEditorUnit) => (
              <Typography.Text type="secondary">{fmtRp(u.buy)}</Typography.Text>
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
                  <Button
                    size="small"
                    type="link"
                    onClick={() => fillDown("price")}
                  >
                    {t("price.fill", "Fill down")}
                  </Button>
                </Tooltip>
              </Flex>
            ),
            key: "price",
            width: 220,
            align: "right",
            render: (_: unknown, u: PriceEditorUnit) => {
              const r = rowOf(u);
              const badRow = !isPriceInRange(r.price);
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
                      {
                        serial: u.serial,
                      },
                    )}
                    value={r.price}
                    formatter={moneyFormatter}
                    parser={moneyParser}
                    precision={0}
                    prefix={RP_SYMBOL}
                    onChange={(v) => set(u.serial, { price: v })}
                  />
                  {r.price != null && r.price < u.buy && (
                    // The one warning worth the vertical space: a machine
                    // priced under what it cost is a loss somebody should have
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
          {
            title: (
              <Flex align="center" gap={SPACE.xs} justify="flex-end">
                {t("price.market", "Marketplace")}
                <Tooltip
                  title={t(
                    "price.fillDown",
                    "Copy the top row down the column",
                  )}
                >
                  <Button
                    size="small"
                    type="link"
                    onClick={() => fillDown("market")}
                  >
                    {t("price.fill", "Fill down")}
                  </Button>
                </Tooltip>
              </Flex>
            ),
            key: "market",
            width: 240,
            align: "right",
            render: (_: unknown, u: PriceEditorUnit) => {
              const r = rowOf(u);
              const derived = derivedMarketPrice(
                r.price ?? priceOf(u, skuPrice(u.skuId)),
                markupPct,
              );
              const badRow = !isPriceInRange(r.market);
              const effective = r.market ?? derived;
              const up = markupOf(r.price ?? 0, effective);
              return (
                <Flex vertical align="flex-end" gap={2}>
                  <InputNumber
                    aria-valuemin={PRICE_MIN}
                    aria-valuemax={PRICE_MAX}
                    style={{ width: "100%" }}
                    status={badRow ? "error" : undefined}
                    aria-invalid={badRow || undefined}
                    aria-label={t(
                      "price.marketFor",
                      "Marketplace price for {{serial}}",
                      { serial: u.serial },
                    )}
                    // The derived figure as the placeholder, so an empty box
                    // still shows what the machine is listed at.
                    placeholder={fmtRp(derived)}
                    value={r.market}
                    formatter={moneyFormatter}
                    parser={moneyParser}
                    precision={0}
                    prefix={RP_SYMBOL}
                    onChange={(v) => set(u.serial, { market: v })}
                  />
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: TYPE.sm }}
                  >
                    {r.market == null
                      ? t("price.followsRule", "follows the rule")
                      : up === null
                        ? t("price.overridden", "set by hand")
                        : t("price.overriddenAt", "set by hand · {{pct}}%", {
                            pct: up.toFixed(0),
                          })}
                  </Typography.Text>
                </Flex>
              );
            },
          },
        ]}
      />
    </Modal>
  );
}

/** What a machine is listed at right now, for a caller that only needs the number. */
export { marketPriceOf };
