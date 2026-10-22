/**
 * Correcting a recorded sale — the facts on it, and the units that went out.
 *
 * > *"This edit button will allow to edit the ref ID, date, channel, customer,
 * > edit serial (automatically fill in the unit) or unit (automatically empty
 * > the serial when the unit is changed so the user will fill again), payment
 * > method, amount, and actual paid or reference number."*
 * > — owner, 2026-09-23
 *
 * ## Swapping a unit rewrites the ledger
 *
 * The owner's decision, taken against the alternative of appending a
 * correction: a sale that went out with the wrong serial should read as though
 * it never did. So the unit coming off has its `TERJUAL` event REMOVED — it
 * goes back to the shelf with nothing on its timeline about this receipt — and
 * the unit going on gets one of its own.
 *
 * ⚠️ This is the one place the append-only rule in CLAUDE.md does not hold.
 * `packages/db`'s events adapter permits it for exactly this shape: the LAST
 * event of a unit, never leaving a unit with no history at all.
 *
 * ## Everything on it is correctable (owner, 2026-10-22)
 *
 * > *"The transaction history should be editable … Do not implement append
 * > only. This is an environment where they input amount / product / channel
 * > wrongly. So all things should be recoverable and a mistake should not cost
 * > lots of additional steps."*
 *
 * So a unit's PRICE is a box on its line, and a counted product — a MagSafe,
 * a charger, anything with no serial — is a line of its own with a quantity
 * and a price per piece. It could not be added here before, which is the bug
 * the owner reported. Its pieces leave and return on the stock ledger the way
 * the till's do: more pieces is a `TERJUAL` from the shelf, fewer (or the line
 * gone) is a `KOREKSI` putting them back at the cost they went out at. The
 * sale's subtotal and total are re-derived from the lines on save, so the
 * money on every other screen follows.
 *
 * Money is `PaymentsPanel`, the same grid the till and the payment dialog use.
 */
import { useEffect, useMemo, useState } from "react";
import {
  App,
  Card,
  DatePicker,
  Divider,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Table,
  Typography,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button } from "antd";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { PaymentsPanel } from "../../components/PaymentsPanel";
import { MoneyInput } from "../../components/MoneyInput";
import { averageCost, takeFrom } from "../../lib/stock.js";
import { skuTracksSerial } from "../../lib/serialTracking.js";
import { isLiveSku } from "../../lib/skuCode.js";
import { fmtRp } from "../../lib/format.js";
import { priceOf } from "../../lib/unitPrice.js";
import {
  SALE_CHANNELS,
  channelOf,
  holdsFunds,
  type SaleSource,
} from "../../lib/channels.js";
import { upsertSettlement } from "../../lib/payouts.js";
import type { SettlementFee } from "../../lib/marketplace.js";
import { customerLine } from "../../lib/customers.js";
import { isSaleLocked } from "../../lib/bookClose.js";
import { resolveSerialQuery } from "../../lib/serialInput.js";
import {
  billAfterReturns,
  isSettled,
  paymentsOf,
  refundedOf,
  type SalePayment,
} from "../../lib/salePayments.js";
import { diffPayments } from "../../lib/paymentEdits.js";
import {
  appendEvent,
  currentStaffName,
  mutate,
  nextId,
  removeLastEvent,
  useDb,
} from "../../mock/store.js";
import type { Order, OrderFee } from "../../mock/seed.js";
import { COLUMN, SPACE, TYPE } from "../../theme/tokens";

/** One unit line on the sale, while it is being edited. */
interface UnitLine {
  readonly key: string;
  /** The serial as stored when the dialog opened; "" for a line being added. */
  readonly was: string;
  /** What the box holds now. */
  readonly serial: string;
  /** The variant, which the serial decides — or which empties the serial. */
  readonly skuId: string | undefined;
  /** What this unit is charged on the sale. */
  readonly price: number;
}

/** A counted product's line — an accessory, by quantity (no serial). */
interface CountLine {
  readonly key: string;
  /** `OrderLine.id`; a new line gets one at save. */
  readonly id: string | undefined;
  readonly skuId: string | undefined;
  readonly qty: number;
  /** Per piece. */
  readonly price: number;
  /** Pieces on the sale when the dialog opened; 0 for a new line. */
  readonly wasQty: number;
  readonly listPrice?: number;
  readonly returnedQty?: number;
}

export interface EditTransactionModalProps {
  readonly open: boolean;
  readonly order: Order | null;
  readonly onClose: () => void;
}

export function EditTransactionModal({
  open,
  order,
  onClose,
}: EditTransactionModalProps) {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();

  const [ref, setRef] = useState("");
  const [at, setAt] = useState(() => dayjs());
  const [source, setSource] = useState<SaleSource>("OFFLINE");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [lines, setLines] = useState<UnitLine[]>([]);
  const [counted, setCounted] = useState<CountLine[]>([]);
  /** The sale's additional charges (delivery, a bag…), as rows. */
  const [fees, setFees] = useState<OrderFee[]>([]);
  const [payments, setPayments] = useState<SalePayment[]>([]);
  /**
   * Each marketplace payment's deductions, by payment id (owner ask
   * 2026-10-22: deductions are entered under the payment, here, not on a
   * page of their own). Seeded from the payment's settlement.
   */
  const [deductions, setDeductions] = useState<Record<string, SettlementFee[]>>(
    {},
  );

  useEffect(() => {
    if (!open || order === null) return;
    const paid = paymentsOf(order);
    setRef(paid.find((p) => p.ref?.trim())?.ref ?? "");
    setAt(dayjs(order.ts));
    setSource(order.source as SaleSource);
    setCustomerId(order.customerId);
    setLines(
      order.serials.map((serial, i) => ({
        key: `l-${i}-${serial}`,
        was: serial,
        serial,
        skuId: db.units.find((u) => u.serial === serial)?.skuId,
        price: order.prices[serial] ?? 0,
      })),
    );
    setCounted(
      (order.lines ?? []).map((l) => ({
        key: `c-${l.id}`,
        id: l.id,
        skuId: l.skuId,
        qty: l.qty,
        price: l.price,
        wasQty: l.qty,
        ...(l.listPrice !== undefined ? { listPrice: l.listPrice } : {}),
        ...(l.returnedQty !== undefined ? { returnedQty: l.returnedQty } : {}),
      })),
    );
    setPayments(paid.map((p) => ({ ...p })));
    setFees(
      order.fees?.map((f) => ({ ...f })) ??
        ((order.extra ?? 0) > 0
          ? [
              {
                id: `fee-${order.id}`,
                label: order.extraNote ?? "Extra",
                amount: order.extra!,
              },
            ]
          : []),
    );
    setDeductions(
      Object.fromEntries(
        db.settlements
          .filter((s) => s.orderId === order.id)
          .map((s) => [s.paymentId, s.fees.map((f) => ({ ...f }))]),
      ),
    );
  }, [open, order?.id]);

  /**
   * A sale-level reference box only where nothing else carries one: a
   * marketplace CHANNEL (Shopee, Tokopedia, TikTok) with no marketplace
   * payment row — TikTok, or Shopee taken in cash. A marketplace payment
   * carries its own under its method; any other sale has none at all.
   */
  const saleRefShown =
    holdsFunds(source) && !payments.some((p) => p.channel !== undefined);

  const setDeductionsOf = (paymentId: string, list: SettlementFee[]) =>
    setDeductions((all) => ({ ...all, [paymentId]: list }));
  const markReceived = (paymentId: string, on: boolean, at?: string) =>
    setPayments((rows) =>
      rows.map((p) =>
        p.id === paymentId
          ? {
              ...p,
              state: on ? "SETTLED" : "PENDING",
              ...(on ? { at: at ?? p.at } : {}),
            }
          : p,
      ),
    );

  /** Every serial the shop knows, for reading a typed or scanned one back. */
  const knownSerials = useMemo(() => db.units.map((u) => u.serial), [db.units]);

  /** Variants identified by serial, and the ones counted by quantity. */
  const [skuOptions, countedOptions] = useMemo(() => {
    const opts = db.skus
      .filter(isLiveSku)
      .map((k) => ({
        value: k.id,
        label: `${k.name} ${k.variantLabel}`.trim(),
        tracked: skuTracksSerial(db, k.id),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [opts.filter((o) => o.tracked), opts.filter((o) => !o.tracked)];
  }, [db.skus, db.models, db.categories]);

  const setCount = (key: string, patch: Partial<CountLine>) =>
    setCounted((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );

  const setLine = (key: string, patch: Partial<UnitLine>) =>
    setLines((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );

  /** A serial names its unit, so picking one fills the product in. */
  const commitSerial = (line: UnitLine, raw: string) => {
    const serial = resolveSerialQuery(raw, knownSerials);
    const unit = db.units.find((u) => u.serial === serial);
    const sku = unit && db.skus.find((k) => k.id === unit.skuId);
    setLine(line.key, {
      serial,
      ...(unit ? { skuId: unit.skuId } : {}),
      // A unit new to the sale starts at its own asking price; one already on
      // it keeps what it was charged.
      ...(unit && serial !== line.was
        ? { price: priceOf(unit, sku?.price ?? 0) }
        : {}),
    });
  };

  /** Changing the product empties the serial — the old one is not that unit. */
  const pickSku = (line: UnitLine, skuId: string) =>
    setLine(line.key, { skuId, serial: "" });

  /** The subtotal and total the lines on screen add up to. */
  const draftTotals = (o: Order) => {
    const unitsSum = lines
      .filter((l) => l.serial.trim() !== "")
      .reduce((n, l) => n + l.price, 0);
    const countedSum = counted
      .filter((c) => c.skuId !== undefined && c.qty > 0)
      .reduce((n, c) => n + c.price * c.qty, 0);
    const extra = fees.reduce((n, f) => n + f.amount, 0);
    const trade = (o.tradeIns ?? []).reduce((n, x) => n + x.value, 0);
    const bill = unitsSum + countedSum - o.discount + extra;
    return { bill, total: Math.max(0, bill - trade) };
  };
  const bill = order
    ? billAfterReturns({ ...order, total: draftTotals(order).total })
    : 0;

  const save = () => {
    if (order === null) return;
    // The book, closed over this date (owner ask 2026-09-24). Transaction
    // History already disables the button; this is the writer refusing, so no
    // other door into this dialog can get around it.
    if (isSaleLocked(order, db.settings)) {
      message.error(
        t(
          "editSale.bookClosed",
          "The book is closed over this date. Reopen it on Transaction History first.",
        ),
      );
      return;
    }
    const kept = lines.filter((l) => l.serial.trim() !== "");
    const serials = kept.map((l) => l.serial.trim());
    if (new Set(serials).size !== serials.length) {
      message.error(
        t("editSale.duplicateSerial", "The same serial is on two lines."),
      );
      return;
    }
    const unknown = serials.filter(
      (s) => !db.units.some((u) => u.serial === s),
    );
    if (unknown.length > 0) {
      message.error(
        t("editSale.unknownSerial", "No unit carries {{serial}}.", {
          serial: unknown[0]!,
        }),
      );
      return;
    }
    const gone = lines
      .map((l) => l.was)
      .filter((s) => s !== "" && !serials.includes(s));
    const added = serials.filter((s) => !lines.some((l) => l.was === s));
    const taken = added.filter((s) => {
      const u = db.units.find((x) => x.serial === s);
      return u !== undefined && u.status === "TERJUAL";
    });
    if (taken.length > 0) {
      message.error(
        t("editSale.alreadySold", "{{serial}} is already on another sale.", {
          serial: taken[0]!,
        }),
      );
      return;
    }

    const countedKept = counted.filter(
      (c) => c.skuId !== undefined && c.qty > 0,
    );
    if (counted.some((c) => c.skuId === undefined && c.qty > 0)) {
      message.error(
        t("editSale.pickProduct", "Pick the product on every accessory line."),
      );
      return;
    }
    if (countedKept.some((c) => c.qty < (c.returnedQty ?? 0))) {
      message.error(
        t(
          "editSale.belowReturned",
          "A line cannot hold fewer pieces than have already come back.",
        ),
      );
      return;
    }
    // More pieces than before have to come off a shelf that holds them.
    const want = new Map<string, number>();
    for (const c of counted) {
      if (c.skuId === undefined) continue;
      const delta = (c.skuId ? Math.max(0, c.qty) : 0) - c.wasQty;
      if (delta > 0) want.set(c.skuId, (want.get(c.skuId) ?? 0) + delta);
    }
    for (const [skuId, qty] of want) {
      if (takeFrom(db.stockMoves, skuId, qty, db.myWarehouseId) === null) {
        const sku = db.skus.find((k) => k.id === skuId);
        message.error(
          t(
            "editSale.notEnoughStock",
            "Not enough {{product}} in stock for {{qty}} more.",
            { product: sku ? `${sku.name} ${sku.variantLabel}` : skuId, qty },
          ),
        );
        return;
      }
    }
    const { total: newTotal } = draftTotals(order);

    const before = paymentsOf(order);
    const refText = ref.trim();
    const stamp = new Date().toISOString();
    mutate((d) => {
      const o = d.orders.find((x) => x.id === order.id);
      if (!o) return;
      o.ts = at.toISOString();
      o.source = source as Order["source"];
      o.customerId = customerId;

      /*
       * The units that left the sale. Their TERJUAL comes OFF (owner decision
       * 2026-09-23) and the unit goes back to whatever its previous event
       * said, which for a sold unit is the shelf it was picked from.
       */
      for (const serial of gone) {
        removeLastEvent(d, serial);
        delete o.prices[serial];
        if (o.listPrices) delete o.listPrices[serial];
      }
      o.serials = serials;
      // Every unit's price is what its line says now — a typo in the amount
      // is corrected here, not with another document.
      for (const l of kept) o.prices[l.serial.trim()] = l.price;
      for (const serial of added) {
        appendEvent(d, serial, {
          type: "TERJUAL",
          toStatus: "TERJUAL",
          refCode: o.code,
        });
      }

      // The counted lines, and their pieces on the stock ledger.
      const staff = currentStaffName();
      const soldCost = (lineId: string) => {
        const m = d.stockMoves.find(
          (x) => x.orderLineId === lineId && x.type === "TERJUAL",
        );
        return m?.cost;
      };
      const nextLines: NonNullable<Order["lines"]> = [];
      for (const c of counted) {
        const id = c.id ?? nextId("ol");
        const skuId = c.skuId;
        const qty = skuId === undefined ? 0 : Math.max(0, c.qty);
        const was = c.wasQty;
        const original = (order.lines ?? []).find((l) => l.id === c.id);
        // A product changed on an existing line is the old pieces back and
        // the new ones out.
        const swapped =
          original !== undefined &&
          skuId !== undefined &&
          original.skuId !== skuId;
        const backQty = swapped ? was : Math.max(0, was - qty);
        const outQty = swapped ? qty : Math.max(0, qty - was);
        if (backQty > 0 && original !== undefined) {
          const home =
            d.stockMoves.find(
              (x) => x.orderLineId === original.id && x.type === "TERJUAL",
            )?.locationId ?? d.myWarehouseId;
          d.stockMoves.push({
            id: nextId("sm"),
            skuId: original.skuId,
            locationId: home,
            qty: backQty,
            cost: soldCost(original.id) ?? averageCost(d, original.skuId),
            type: "KOREKSI",
            at: stamp,
            refCode: o.code,
            orderId: o.id,
            orderLineId: original.id,
            note: `Transaction ${o.code} corrected — ${staff}`,
            staff,
          });
        }
        if (outQty > 0 && skuId !== undefined) {
          const cost = averageCost(d, skuId);
          for (const part of takeFrom(
            d.stockMoves,
            skuId,
            outQty,
            d.myWarehouseId,
          ) ?? []) {
            d.stockMoves.push({
              id: nextId("sm"),
              skuId,
              locationId: part.locationId,
              qty: -part.qty,
              cost,
              type: "TERJUAL",
              at: stamp,
              refCode: o.code,
              orderId: o.id,
              orderLineId: id,
              staff,
            });
          }
        }
        if (qty > 0 && skuId !== undefined) {
          nextLines.push({
            id,
            skuId,
            qty,
            price: c.price,
            ...(c.listPrice !== undefined && !swapped
              ? { listPrice: c.listPrice }
              : {}),
            ...(c.returnedQty ? { returnedQty: c.returnedQty } : {}),
          });
        }
      }
      if (nextLines.length > 0) o.lines = nextLines;
      else delete o.lines;
      // The charges: the rows, their total as `extra` and its label — what
      // the invoice prints (2026-09-01: `extra` is the denormalised total).
      const charges = fees.filter((f) => f.amount > 0);
      if (charges.length > 0) {
        o.fees = charges.map((f) => ({
          ...f,
          label: f.label.trim() || "Extra",
        }));
        o.extra = charges.reduce((n, f) => n + f.amount, 0);
        o.extraNote =
          charges.length === 1 ? o.fees[0]!.label : `${charges.length} charges`;
      } else {
        delete o.fees;
        delete o.extra;
        delete o.extraNote;
      }
      o.total = newTotal;

      // A marketplace part keeps its own number (typed under its method). The
      // sale-level box writes onto the parts only when it is shown; a sale
      // moved off a marketplace (Shopee → Instagram, paid by transfer) keeps
      // no reference anywhere (owner, 2026-10-22).
      const next = payments.map((p) => {
        if (p.channel !== undefined) return p;
        const { ref: _drop, ...rest } = p;
        return saleRefShown && refText !== ""
          ? { ...rest, ref: refText }
          : rest;
      });
      o.payments = next;
      o.settled = isSettled(billAfterReturns(o), next, refundedOf(o));
      // The deductions under each marketplace payment, into its settlement.
      for (const p of next) {
        if (p.channel === undefined) continue;
        const fees = (deductions[p.id] ?? []).filter((f) => f.amount !== 0);
        const had = d.settlements.some((s) => s.paymentId === p.id);
        if (fees.length === 0 && !had && p.state !== "SETTLED") continue;
        upsertSettlement(
          d,
          {
            paymentId: p.id,
            orderId: o.id,
            channel: p.channel,
            gross: p.amount,
            fees,
            at: p.at,
          },
          { staff: currentStaffName(), nextId },
        );
      }
      for (const row of diffPayments(before, next, {
        at: stamp,
        staff: currentStaffName(),
      })) {
        d.paymentLog.push({ id: nextId("plog"), ...row });
      }
    });
    message.success(t("editSale.saved", "Transaction updated."));
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={980}
      title={t("editSale.title", "Edit transaction — {{code}}", {
        code: order?.code ?? "",
      })}
      okText={t("editSale.save", "Save")}
      onOk={save}
      destroyOnHidden
    >
      <Form layout="vertical">
        <Flex gap={SPACE.md} wrap>
          {saleRefShown && (
            <Form.Item
              label={t("editSale.ref", "Reference ID")}
              style={{ flex: "1 1 220px" }}
            >
              <Input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder={t(
                  "editSale.refPlaceholder",
                  "The marketplace's order number",
                )}
              />
            </Form.Item>
          )}
          <Form.Item
            label={t("editSale.date", "Date")}
            style={{ flex: "1 1 200px" }}
          >
            <DatePicker
              showTime
              format="DD MMM YYYY HH:mm"
              style={{ width: "100%" }}
              value={at}
              onChange={(d) => d && setAt(d)}
              allowClear={false}
            />
          </Form.Item>
          <Form.Item
            label={t("editSale.channel", "Channel")}
            style={{ flex: "1 1 180px" }}
          >
            <Select<SaleSource>
              value={source}
              onChange={setSource}
              options={SALE_CHANNELS.map((c) => ({
                value: c.value,
                label: t(c.label),
              }))}
            />
          </Form.Item>
          <Form.Item
            label={t("editSale.customer", "Customer")}
            style={{ flex: "1 1 220px" }}
          >
            <Select<string | null>
              showSearch
              allowClear
              optionFilterProp="label"
              value={customerId}
              onChange={(v) => setCustomerId(v ?? null)}
              placeholder={t("piutang.walkIn", "Walk-in")}
              options={db.customers.map((c) => ({
                value: c.id,
                label: customerLine(c),
              }))}
            />
          </Form.Item>
        </Flex>
      </Form>

      <Divider style={{ marginTop: 0 }}>{t("editSale.units", "Units")}</Divider>

      <Table<UnitLine>
        size="small"
        rowKey="key"
        dataSource={lines}
        pagination={false}
        columns={[
          {
            title: t("editSale.serial", "Serial number"),
            key: "serial",
            width: COLUMN.serial,
            render: (_, l) => (
              <Input
                size="small"
                style={{ textTransform: "uppercase" }}
                defaultValue={l.serial}
                key={l.serial}
                aria-label={t("editSale.serialFor", "Serial number")}
                onBlur={(e) => commitSerial(l, e.target.value)}
                onPressEnter={(e) =>
                  commitSerial(l, (e.target as HTMLInputElement).value)
                }
              />
            ),
          },
          {
            title: t("editSale.unit", "Unit"),
            key: "sku",
            render: (_, l) => (
              <Select<string>
                size="small"
                showSearch
                optionFilterProp="label"
                style={{ width: "100%" }}
                value={l.skuId}
                aria-label={t("editSale.unitFor", "Unit")}
                placeholder={t("editSale.pickUnit", "Pick a unit")}
                options={skuOptions}
                onChange={(v) => pickSku(l, v)}
              />
            ),
          },
          {
            title: t("editSale.price", "Price"),
            key: "price",
            width: COLUMN.moneyInput,
            render: (_, l) => (
              <MoneyInput
                value={l.price}
                aria-label={t("editSale.priceFor", "Price")}
                onChange={(v) => setLine(l.key, { price: v ?? 0 })}
              />
            ),
          },
          {
            title: "",
            key: "remove",
            width: COLUMN.action,
            render: (_, l) => (
              <Button
                type="text"
                icon={<DeleteOutlined />}
                aria-label={t("editSale.removeLine", "Take this unit off")}
                onClick={() =>
                  setLines((rows) => rows.filter((r) => r.key !== l.key))
                }
              />
            ),
          },
        ]}
      />
      <Button
        size="small"
        style={{ marginTop: SPACE.sm }}
        onClick={() =>
          setLines((rows) => [
            ...rows,
            {
              key: `l-new-${rows.length}-${Date.now()}`,
              was: "",
              serial: "",
              skuId: undefined,
              price: 0,
            },
          ])
        }
      >
        {t("editSale.addLine", "Add a unit")}
      </Button>

      <Divider>{t("editSale.accessories", "Accessories (no serial)")}</Divider>

      {counted.length > 0 && (
        <Table<CountLine>
          size="small"
          rowKey="key"
          dataSource={counted}
          pagination={false}
          columns={[
            {
              title: t("editSale.product", "Product"),
              key: "sku",
              render: (_, c) => (
                <Select<string>
                  size="small"
                  showSearch
                  optionFilterProp="label"
                  style={{ width: "100%" }}
                  value={c.skuId}
                  aria-label={t("editSale.productFor", "Product")}
                  placeholder={t("editSale.pickProductOne", "Pick a product")}
                  options={countedOptions}
                  onChange={(v) => {
                    const sku = db.skus.find((k) => k.id === v);
                    setCount(c.key, {
                      skuId: v,
                      ...(c.wasQty === 0 ? { price: sku?.price ?? 0 } : {}),
                    });
                  }}
                />
              ),
            },
            {
              title: t("editSale.qty", "Qty"),
              key: "qty",
              width: COLUMN.qty,
              render: (_, c) => (
                <InputNumber<number>
                  size="small"
                  min={1}
                  precision={0}
                  value={c.qty}
                  aria-label={t("editSale.qtyFor", "Quantity")}
                  onChange={(v) => setCount(c.key, { qty: v ?? 1 })}
                  style={{ width: "100%" }}
                />
              ),
            },
            {
              title: t("editSale.pricePerPiece", "Price per piece"),
              key: "price",
              width: COLUMN.moneyInput,
              render: (_, c) => (
                <MoneyInput
                  value={c.price}
                  aria-label={t("editSale.piecePriceFor", "Price per piece")}
                  onChange={(v) => setCount(c.key, { price: v ?? 0 })}
                />
              ),
            },
            {
              title: "",
              key: "remove",
              width: COLUMN.action,
              render: (_, c) => (
                <Button
                  type="text"
                  icon={<DeleteOutlined />}
                  aria-label={t(
                    "editSale.removeCounted",
                    "Take this product off",
                  )}
                  onClick={() =>
                    setCounted((rows) => rows.filter((r) => r.key !== c.key))
                  }
                />
              ),
            },
          ]}
        />
      )}
      <Button
        size="small"
        style={{ marginTop: SPACE.sm }}
        onClick={() =>
          setCounted((rows) => [
            ...rows,
            {
              key: `c-new-${rows.length}-${Date.now()}`,
              id: undefined,
              skuId: undefined,
              qty: 1,
              price: 0,
              wasQty: 0,
            },
          ])
        }
      >
        {t("editSale.addCounted", "Add an accessory")}
      </Button>
      <Divider>{t("editSale.charges", "Additional charges")}</Divider>
      {fees.map((f, i) => (
        <Flex key={f.id} gap={SPACE.sm} style={{ marginBottom: SPACE.xs }}>
          <Input
            size="small"
            value={f.label}
            placeholder={t("editSale.chargeName", "Charge, e.g. Delivery")}
            aria-label={t("editSale.chargeNameFor", "Charge name")}
            onChange={(e) =>
              setFees((rows) =>
                rows.map((x, j) =>
                  j === i ? { ...x, label: e.target.value } : x,
                ),
              )
            }
          />
          <MoneyInput
            value={f.amount}
            aria-label={t("editSale.chargeAmountFor", "Charge amount")}
            style={{ width: 200 }}
            onChange={(v) =>
              setFees((rows) =>
                rows.map((x, j) => (j === i ? { ...x, amount: v ?? 0 } : x)),
              )
            }
          />
          <Button
            size="small"
            type="text"
            icon={<DeleteOutlined />}
            aria-label={t("editSale.removeCharge", "Remove charge")}
            onClick={() => setFees((rows) => rows.filter((_, j) => j !== i))}
          />
        </Flex>
      ))}
      <Button
        size="small"
        icon={<PlusOutlined />}
        onClick={() =>
          setFees((rows) => [
            ...rows,
            { id: nextId("fee"), label: "", amount: 0 },
          ])
        }
      >
        {t("editSale.addCharge", "Add a charge")}
      </Button>
      <Typography.Text
        strong
        style={{ display: "block", marginTop: SPACE.sm, textAlign: "right" }}
      >
        {t("editSale.newTotal", "Total {{total}}", { total: fmtRp(bill) })}
      </Typography.Text>
      {lines.some((l) => l.was !== "" && l.was !== l.serial) && (
        <Typography.Text
          type="warning"
          style={{ display: "block", marginTop: SPACE.sm, fontSize: TYPE.sm }}
        >
          {t(
            "editSale.swapWarning",
            "A unit taken off goes back on the shelf, and this sale leaves its timeline.",
          )}
        </Typography.Text>
      )}

      <Divider>{t("editSale.payment", "Payment")}</Divider>

      <PaymentsPanel
        orderId={order?.id ?? ""}
        total={bill}
        value={payments}
        onChange={setPayments}
      />

      {/*
       * The payout of each marketplace payment, under it (owner ask
       * 2026-10-22). Deductions any time; "Payout received" is the payment's
       * Pending/Settled — the one fact the balance reads.
       */}
      {payments
        .filter((p) => p.channel !== undefined && p.amount > 0)
        .map((p) => {
          const fees = deductions[p.id] ?? [];
          const deducted = fees.reduce((n, f) => n + f.amount, 0);
          const name = channelOf(p.channel!)?.label ?? p.channel!;
          return (
            <Card
              key={p.id}
              size="small"
              style={{ marginTop: SPACE.md }}
              title={t(
                "editSale.payoutTitle",
                "{{channel}} payout — {{amount}}",
                {
                  channel: name,
                  amount: fmtRp(p.amount),
                },
              )}
              extra={
                <Flex gap={SPACE.sm} align="center">
                  <Switch
                    size="small"
                    checked={p.state === "SETTLED"}
                    aria-label={t("editSale.payoutReceived", "Payout received")}
                    onChange={(on) => markReceived(p.id, on)}
                  />
                  <Typography.Text>
                    {t("editSale.payoutReceived", "Payout received")}
                  </Typography.Text>
                  {p.state === "SETTLED" && (
                    <DatePicker
                      size="small"
                      allowClear={false}
                      value={dayjs(p.at)}
                      aria-label={t("editSale.payoutDate", "Received on")}
                      onChange={(day) =>
                        day && markReceived(p.id, true, day.toISOString())
                      }
                    />
                  )}
                </Flex>
              }
            >
              {fees.map((f, i) => (
                <Flex
                  key={f.id}
                  gap={SPACE.sm}
                  style={{ marginBottom: SPACE.xs }}
                >
                  <Input
                    size="small"
                    value={f.label ?? ""}
                    placeholder={t(
                      "editSale.deductionName",
                      "Deduction, e.g. Komisi",
                    )}
                    aria-label={t(
                      "editSale.deductionNameFor",
                      "Deduction name",
                    )}
                    onChange={(e) =>
                      setDeductionsOf(
                        p.id,
                        fees.map((x, j) =>
                          j === i ? { ...x, label: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <MoneyInput
                    value={f.amount}
                    min={f.amount < 0 ? f.amount : 0}
                    aria-label={t(
                      "editSale.deductionAmountFor",
                      "Deduction amount",
                    )}
                    style={{ width: 200 }}
                    onChange={(v) =>
                      setDeductionsOf(
                        p.id,
                        fees.map((x, j) =>
                          j === i ? { ...x, amount: v ?? 0 } : x,
                        ),
                      )
                    }
                  />
                  <Button
                    size="small"
                    type="text"
                    icon={<DeleteOutlined />}
                    aria-label={t(
                      "editSale.removeDeduction",
                      "Remove deduction",
                    )}
                    onClick={() =>
                      setDeductionsOf(
                        p.id,
                        fees.filter((_, j) => j !== i),
                      )
                    }
                  />
                </Flex>
              ))}
              <Flex justify="space-between" align="center">
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() =>
                    setDeductionsOf(p.id, [
                      ...fees,
                      { id: nextId("fee"), kind: "OTHER", amount: 0 },
                    ])
                  }
                >
                  {t("editSale.addDeduction", "Add deduction")}
                </Button>
                <Typography.Text>
                  {t("editSale.payoutLands", "Received {{amount}}", {
                    amount: fmtRp(p.amount - deducted),
                  })}
                </Typography.Text>
              </Flex>
            </Card>
          );
        })}
    </Modal>
  );
}
