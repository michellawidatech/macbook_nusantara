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
 * event of a unit, never one in the middle, and never leaving a unit with no
 * history at all. Everything else about the ledger is unchanged.
 *
 * Money is `PaymentsPanel`, the same grid the till and the payment dialog use.
 */
import { useEffect, useMemo, useState } from "react";
import {
  App,
  DatePicker,
  Divider,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Table,
  Typography,
} from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { Button } from "antd";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { PaymentsPanel } from "../../components/PaymentsPanel";
import { SALE_CHANNELS, type SaleSource } from "../../lib/channels.js";
import { customerLine } from "../../lib/customers.js";
import { isBookClosed } from "../../lib/bookClose.js";
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
import type { Order } from "../../mock/seed.js";
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
  const [payments, setPayments] = useState<SalePayment[]>([]);

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
      })),
    );
    setPayments(paid.map((p) => ({ ...p })));
  }, [open, order?.id]);

  /** Every serial the shop knows, for reading a typed or scanned one back. */
  const knownSerials = useMemo(() => db.units.map((u) => u.serial), [db.units]);

  /** Variants that can go out: this sale's own, plus anything on the shelf. */
  const skuOptions = useMemo(
    () =>
      db.skus
        .map((k) => ({ value: k.id, label: `${k.name} ${k.variantLabel}` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [db.skus],
  );

  const setLine = (key: string, patch: Partial<UnitLine>) =>
    setLines((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );

  /** A serial names its unit, so picking one fills the product in. */
  const commitSerial = (line: UnitLine, raw: string) => {
    const serial = resolveSerialQuery(raw, knownSerials);
    const unit = db.units.find((u) => u.serial === serial);
    setLine(line.key, {
      serial,
      ...(unit ? { skuId: unit.skuId } : {}),
    });
  };

  /** Changing the product empties the serial — the old one is not that unit. */
  const pickSku = (line: UnitLine, skuId: string) =>
    setLine(line.key, { skuId, serial: "" });

  const bill = order ? billAfterReturns(order) : 0;

  const save = () => {
    if (order === null) return;
    // The book, closed over this date (owner ask 2026-09-24). Transaction
    // History already disables the button; this is the writer refusing, so no
    // other door into this dialog can get around it.
    if (isBookClosed(order.ts, db.settings)) {
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
      // A unit joining the sale is sold at what the one it replaced fetched,
      // or at the variant's asking price when it is simply an extra line.
      const freed = gone.map((s) => order.prices[s] ?? 0);
      for (const [i, serial] of added.entries()) {
        const unit = d.units.find((u) => u.serial === serial);
        const sku = unit && d.skus.find((k) => k.id === unit.skuId);
        o.prices[serial] =
          freed[i] ?? unit?.price ?? sku?.price ?? o.prices[serial] ?? 0;
        appendEvent(d, serial, {
          type: "TERJUAL",
          toStatus: "TERJUAL",
          refCode: o.code,
        });
      }

      // The reference belongs to the marketplace part, and to every part when
      // no part is a marketplace one — a TikTok sale taken in cash still has
      // the platform's order number.
      const marketplaceParts = payments.filter((p) => p.channel !== undefined);
      const next = payments.map((p) =>
        marketplaceParts.length === 0 || p.channel !== undefined
          ? { ...p, ...(refText === "" ? {} : { ref: refText }) }
          : p,
      );
      o.payments = next;
      o.settled = isSettled(billAfterReturns(o), next, refundedOf(o));
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
            },
          ])
        }
      >
        {t("editSale.addLine", "Add a unit")}
      </Button>
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
    </Modal>
  );
}
