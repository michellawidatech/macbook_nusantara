/**
 * Buying units from a customer with no sale — Inbound → Trade-in's
 * "+ Trade-in" (owner answers 2026-10-31).
 *
 * > *"1. + Trade-in in inbound → trade-in. 2. A [a document of its own].
 * > 3. Yes name and phone, KTP is not recorded. 4. No [paid in full, on the
 * > spot]."*
 *
 * One dialog: who sold it (a name AND a phone — a unit bought from a stranger
 * is the one somebody may come looking for), the units (each asked exactly
 * what the till's trade-in asks, through the same `TradeInDialog`), and how
 * the shop paid: cash or a transfer, to whom, and the transfer's reference.
 *
 * Save writes, in one mutation: the customer (found by phone, or added), a
 * `CustomerPurchase` (BP-…), each unit booked into stock by `bookTradeIn` —
 * QC was taken in the dialog, so it goes onto the shelf — and ONE `Expense`
 * of kind TUKAR_TAMBAH for the whole amount, which is what the bank
 * reconciliation pairs the transfer with.
 */
import { useMemo, useState } from "react";
import {
  App,
  Button,
  DatePicker,
  Flex,
  Input,
  Modal,
  Segmented,
  Select,
  Table,
  Typography,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { GradeTag } from "../../components/GradeTag";
import { customerLine } from "../../lib/customers.js";
import { fmtRp } from "../../lib/format.js";
import type { TradeInLine } from "../../lib/pos.js";
import { bookTradeIn, TRADE_IN_EXPENSE } from "../../lib/tradeIn.js";
import {
  appendEvent,
  currentStaffName,
  docCode,
  ensureQcDescription,
  mutate,
  nextId,
  useDb,
} from "../../mock/store.js";
import { COLUMN, SPACE, TYPE } from "../../theme/tokens";
import { TradeInDialog } from "../stock/TradeInDialog.js";

/** Digits only — how two spellings of one phone number are compared. */
const digits = (s: string) => s.replace(/\D/g, "");

export function BuyFromCustomerModal({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();

  const [customerId, setCustomerId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [units, setUnits] = useState<TradeInLine[]>([]);
  const [adding, setAdding] = useState(false);
  const [method, setMethod] = useState<"TUNAI" | "TRANSFER">("TRANSFER");
  const [paidTo, setPaidTo] = useState("");
  const [ref, setRef] = useState("");
  const [day, setDay] = useState(() => dayjs());
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);

  const total = units.reduce((n, u) => n + u.value, 0);
  const customers = useMemo(
    () => db.customers.map((c) => ({ value: c.id, label: customerLine(c) })),
    [db.customers],
  );

  const reset = () => {
    setCustomerId(undefined);
    setName("");
    setPhone("");
    setUnits([]);
    setMethod("TRANSFER");
    setPaidTo("");
    setRef("");
    setDay(dayjs());
    setNote("");
    setChecked(false);
  };
  const close = () => {
    reset();
    onClose();
  };

  const pickCustomer = (id: string | undefined) => {
    setCustomerId(id);
    const c = db.customers.find((x) => x.id === id);
    setName(c?.name ?? "");
    setPhone(c?.phone ?? "");
  };

  const nameMissing = name.trim() === "";
  const phoneMissing = digits(phone) === "";

  const save = () => {
    setChecked(true);
    if (nameMissing || phoneMissing) {
      message.error(
        t(
          "buyFromCustomer.needsPerson",
          "Type the seller's name and phone number.",
        ),
      );
      return;
    }
    if (units.length === 0) {
      message.error(
        t("buyFromCustomer.needsUnit", "Add the unit the shop is buying."),
      );
      return;
    }
    const at = day
      .hour(dayjs().hour())
      .minute(dayjs().minute())
      .second(dayjs().second())
      .toISOString();
    const code = docCode("BP");
    const staff = currentStaffName();
    mutate((d) => {
      // The seller: the one picked, else the one with this phone, else new.
      // A picked customer with a name or number missing gets it filled in.
      let c =
        (customerId && d.customers.find((x) => x.id === customerId)) ||
        d.customers.find(
          (x) => digits(x.phone) !== "" && digits(x.phone) === digits(phone),
        );
      if (c === undefined) {
        c = {
          id: nextId("c"),
          name: name.trim(),
          phone: phone.trim(),
          createdAt: at,
        };
        d.customers.push(c);
      } else {
        if (c.name.trim() === "") c.name = name.trim();
        if (digits(c.phone) === "") c.phone = phone.trim();
      }
      const purchaseId = nextId("bp");
      for (const x of units) {
        bookTradeIn(d, x, {
          code,
          at,
          staff,
          nextId,
          appendEvent,
          ensureQcDescription,
          receivedNote: t(
            "buyFromCustomer.ledgerReceived",
            "Bought from {{name}} on {{code}}: {{label}}",
            { name: customerLine(c), code, label: x.label },
          ),
          qcNote: t("buyFromCustomer.ledgerQc", "QC on {{code}}", { code }),
        });
      }
      d.customerPurchases.unshift({
        id: purchaseId,
        code,
        at,
        customerId: c.id,
        ...(note.trim() ? { note: note.trim() } : {}),
        items: units.map((x) => ({
          id: nextId("bpi"),
          skuId: x.skuId!,
          ...(x.serial ? { serial: x.serial.trim().toUpperCase() } : {}),
          label: x.label,
          value: x.value,
          qty: 1,
        })),
        createdAt: at,
      });
      d.expenses.unshift({
        id: nextId("e"),
        kind: TRADE_IN_EXPENSE,
        amount: total,
        date: day.format("YYYY-MM-DD"),
        method,
        customerPurchaseId: purchaseId,
        ...(paidTo.trim() ? { note: paidTo.trim() } : {}),
        ...(method === "TRANSFER" && ref.trim() ? { ref: ref.trim() } : {}),
        createdAt: at,
      });
    });
    message.success(
      t("buyFromCustomer.saved", "{{count}} unit(s) bought for {{amount}}.", {
        count: units.length,
        amount: fmtRp(total),
      }),
    );
    close();
  };

  return (
    <Modal
      open={open}
      title={t("buyFromCustomer.title", "Buy from a customer")}
      okText={t("buyFromCustomer.save", "Record the purchase")}
      onOk={save}
      onCancel={close}
      width={760}
      destroyOnHidden
    >
      <Flex vertical gap={SPACE.md}>
        <Flex vertical gap={SPACE.xs}>
          <Typography.Text strong>
            {t("buyFromCustomer.seller", "Seller")}
          </Typography.Text>
          <Select
            showSearch
            allowClear
            value={customerId}
            optionFilterProp="label"
            options={customers}
            placeholder={t(
              "buyFromCustomer.findCustomer",
              "Find an existing customer (optional)",
            )}
            aria-label={t(
              "buyFromCustomer.findCustomer",
              "Find an existing customer (optional)",
            )}
            onChange={pickCustomer}
          />
          <Flex gap={SPACE.sm} wrap>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              status={checked && nameMissing ? "error" : undefined}
              placeholder={t("buyFromCustomer.name", "Name")}
              aria-label={t("buyFromCustomer.name", "Name")}
              style={{ flex: "1 1 220px" }}
            />
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              status={checked && phoneMissing ? "error" : undefined}
              placeholder={t("buyFromCustomer.phone", "Phone number")}
              aria-label={t("buyFromCustomer.phone", "Phone number")}
              style={{ flex: "1 1 200px" }}
            />
          </Flex>
        </Flex>

        <Flex vertical gap={SPACE.xs}>
          <Typography.Text strong>
            {t("buyFromCustomer.units", "Units")}
          </Typography.Text>
          <Table<TradeInLine>
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={units}
            locale={{
              emptyText: t(
                "buyFromCustomer.noUnits",
                "No unit yet — add the one the shop is buying.",
              ),
            }}
            columns={[
              {
                title: t("buyFromCustomer.product", "Product"),
                dataIndex: "label",
              },
              {
                title: t("inbound.serial", "Serial"),
                dataIndex: "serial",
                width: COLUMN.serial,
                render: (v?: string) => v ?? "",
              },
              {
                title: t("inbound.grade", "Grade"),
                dataIndex: "grade",
                width: COLUMN.grade,
                render: (g?: string) => <GradeTag grade={g} />,
              },
              {
                title: t("buyFromCustomer.price", "Price"),
                dataIndex: "value",
                width: COLUMN.money,
                align: "right",
                render: (v: number) => fmtRp(v),
              },
              {
                title: "",
                key: "remove",
                width: COLUMN.action,
                render: (_: unknown, u) => (
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={t(
                      "buyFromCustomer.removeUnit",
                      "Remove {{label}}",
                      { label: u.label },
                    )}
                    onClick={() =>
                      setUnits((rows) => rows.filter((x) => x.id !== u.id))
                    }
                  />
                ),
              },
            ]}
          />
          <Button
            icon={<PlusOutlined />}
            onClick={() => setAdding(true)}
            style={{ alignSelf: "flex-start" }}
          >
            {t("buyFromCustomer.addUnit", "Add a unit")}
          </Button>
        </Flex>

        <Flex vertical gap={SPACE.xs}>
          <Typography.Text strong>
            {t("buyFromCustomer.payment", "Paid to the customer")}
          </Typography.Text>
          <Flex gap={SPACE.sm} wrap align="center">
            <Segmented<"TUNAI" | "TRANSFER">
              value={method}
              onChange={setMethod}
              options={[
                {
                  value: "TRANSFER",
                  label: t("pos.methodTransfer", "Transfer"),
                },
                { value: "TUNAI", label: t("pos.methodCash", "Cash") },
              ]}
            />
            <DatePicker
              value={day}
              allowClear={false}
              onChange={(v) => v && setDay(v)}
              aria-label={t("buyFromCustomer.date", "Date")}
            />
            <Typography.Text strong style={{ marginLeft: "auto" }}>
              {fmtRp(total)}
            </Typography.Text>
          </Flex>
          <Flex gap={SPACE.sm} wrap>
            <Input
              value={paidTo}
              onChange={(e) => setPaidTo(e.target.value)}
              aria-label={t("pos.payoutTo", "Paid to")}
              placeholder={t(
                "pos.payoutToPlaceholder",
                "Paid to — e.g. BCA 0671705342 · Abdul Basid",
              )}
              style={{ flex: "2 1 260px" }}
            />
            {method === "TRANSFER" && (
              <Input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                aria-label={t("pos.payoutRef", "Transfer reference")}
                placeholder={t(
                  "pos.payoutRefPlaceholder",
                  "Transfer reference number",
                )}
                style={{ flex: "1 1 180px" }}
              />
            )}
          </Flex>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label={t("buyFromCustomer.note", "Note")}
            placeholder={t("buyFromCustomer.note", "Note")}
          />
          <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
            {t(
              "buyFromCustomer.paidInFull",
              "Paid in full now. The units go straight into stock at what the shop paid.",
            )}
          </Typography.Text>
        </Flex>
      </Flex>

      <TradeInDialog
        open={adding}
        db={db}
        onCancel={() => setAdding(false)}
        onAdd={(draft) => {
          setUnits((rows) => [...rows, { id: nextId("ti"), ...draft }]);
          setAdding(false);
        }}
      />
    </Modal>
  );
}
