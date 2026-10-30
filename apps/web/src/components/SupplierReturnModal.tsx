/**
 * Return a unit to its supplier — ONE dialog for every door (owner asks
 * 2026-10-26, spec §3 and §4): the Returns page's *To supplier*, the QC row's
 * Return button and the accepted row's ⋯ on `/inbound/:id`, and Inventory's
 * unit ⋯.
 *
 * It asks what the unit is worth back — the **credit**, `Unit.buy` by default
 * and editable, with the unit's service charges beside it and a button that
 * adds them — and where the money went. Rule C (`lib/supplierReturn.ts`)
 * decides the split, live, under the box: what comes off the unit's invoice
 * while it still owes anything, and the rest a refund received into Bank,
 * Other bank or Cash, or *not paid by the supplier yet*.
 *
 * One mutation writes the return (kind SUPPLIER, status DONE), the
 * `RETUR_SUPPLIER` event, the credit on the invoice, the refund income, and
 * closes an open service visit — a unit going back from the repairer is no
 * longer on the bench. Everything is asked again INSIDE the mutation: a unit
 * can be held or sold in another tab between the render and the press.
 *
 * `SupplierReturnForm` is the body, so the Returns page can keep its own
 * dialog (with the counted-product mode beside it) and still ask exactly
 * these questions.
 */
import { useEffect, useState } from "react";
import {
  Alert,
  App,
  AutoComplete,
  Button,
  DatePicker,
  Flex,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Typography,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";
import { MoneyInput } from "./MoneyInput";
import { fmtRp } from "../lib/format.js";
import { serviceCostOf } from "../lib/service.js";
import {
  REFUND_INTO,
  invoiceOwedOf,
  planSupplierReturnMoney,
  splitCredit,
  supplierReturnBlock,
  type RefundInto,
} from "../lib/supplierReturn.js";
import {
  appendEvent,
  docCode,
  ensureReason,
  mutate,
  nextId,
  useDb,
} from "../mock/store.js";
import { FORM_CENTRE, SPACE, TYPE } from "../theme/tokens";

/** The label that turns on the "specify" field. Matched case-insensitively. */
const OTHER = "other";

/** The reason a QC rejection is filed under, as it always was. */
export const QC_REJECT_REASON = "Rejected at QC";

interface Values {
  serial: string;
  supplierId?: string;
  reason: string;
  reasonDetail?: string;
  date: Dayjs;
  credit?: number | null;
  refundInto?: RefundInto;
}

/** The words for where a refund went. Literal calls: the i18n test reads them. */
export function useRefundIntoLabel() {
  const { t } = useTranslation();
  return (r: RefundInto): string => {
    switch (r) {
      case "TRANSFER":
        return t("supplierReturn.intoBank", "Bank");
      case "TRANSFER_LUAR":
        return t("supplierReturn.intoOtherBank", "Other bank");
      case "TUNAI":
        return t("supplierReturn.intoCash", "Cash");
      default:
        return t("supplierReturn.notPaidYet", "Not paid by supplier yet");
    }
  };
}

/** The instant a return dated `day` records its credit at. */
function instantOf(day: Dayjs): string {
  return day.isSame(dayjs(), "day")
    ? new Date().toISOString()
    : day.hour(12).minute(0).second(0).millisecond(0).toISOString();
}

export interface SupplierReturnFormProps {
  /** The unit, when the door already knows it. Absent: a unit picker. */
  readonly serial?: string;
  /** The reason it opens with — the QC row's "Rejected at QC". */
  readonly defaultReason?: string;
  readonly onDone: (code: string) => void;
}

export function SupplierReturnForm({
  serial: fixedSerial,
  defaultReason,
  onDone,
}: SupplierReturnFormProps) {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();
  const intoWord = useRefundIntoLabel();
  const [form] = Form.useForm<Values>();
  const [addedService, setAddedService] = useState(false);

  const picked: string | undefined = Form.useWatch("serial", form);
  const serial = fixedSerial ?? picked;
  const reason: string | undefined = Form.useWatch("reason", form);
  const credit: number | null | undefined = Form.useWatch("credit", form);
  const unit = db.units.find((u) => u.serial === serial);
  const po =
    unit?.poId != null ? db.pos.find((p) => p.id === unit.poId) : undefined;
  const sku = unit ? db.skus.find((k) => k.id === unit.skuId) : undefined;
  const serviceTotal = serial ? serviceCostOf(serial, db.services) : 0;
  const split = splitCredit(credit ?? 0, invoiceOwedOf(po));
  const block = unit ? supplierReturnBlock(unit.status) : undefined;
  const needsDetail = (reason ?? "").trim().toLowerCase() === OTHER;

  const reasons = db.reasons.filter(
    (r) => r.activity === "RETURN_SUPPLIER" && r.active,
  );

  /** What the unit and its invoice say, put into the boxes. */
  const prefill = (s: string | undefined) => {
    const u = db.units.find((x) => x.serial === s);
    const p = u?.poId != null ? db.pos.find((x) => x.id === u.poId) : undefined;
    setAddedService(false);
    form.setFieldsValue({
      supplierId: p?.supplierId,
      credit: u?.buy ?? 0,
      refundInto: undefined,
    });
  };

  // A door that names its unit fills the boxes as the dialog opens.
  useEffect(() => {
    if (fixedSerial !== undefined) prefill(fixedSerial);
  }, [fixedSerial]);

  const blockWhy =
    block === "HELD"
      ? t(
          "supplierReturn.held",
          "Reserved for a customer — release the hold first.",
        )
      : block === "NOT_IN_STOCK"
        ? t(
            "supplierReturn.notInStock",
            "Only a unit in QC, in stock or at service can go back to its supplier.",
          )
        : undefined;

  /** Every unit the shop could send back, a held one drawn switched off. */
  const candidates = db.units.filter((u) =>
    ["QC", "TERSEDIA", "SERVIS", "DIRESERVASI"].includes(u.status),
  );
  const unitLabel = (s: string) => {
    const u = db.units.find((x) => x.serial === s);
    const k = u ? db.skus.find((x) => x.id === u.skuId) : undefined;
    return k ? `${s} — ${k.name} ${k.variantLabel}` : s;
  };

  const submit = (v: Values) => {
    const s = fixedSerial ?? v.serial;
    const at = instantOf(v.date);
    const day = v.date.format("YYYY-MM-DD");
    const out: { refused: boolean; code?: string } = { refused: false };
    void mutate((d) => {
      const u = d.units.find((x) => x.serial === s);
      if (!u || supplierReturnBlock(u.status) !== undefined) {
        out.refused = true;
        return;
      }
      const inv =
        u.poId != null ? d.pos.find((p) => p.id === u.poId) : undefined;
      const supplierId = inv?.supplierId ?? v.supplierId;
      const supplierName =
        d.suppliers.find((x) => x.id === supplierId)?.name ?? "";
      // A typed reason joins Settings' list in the same write (2026-10-21).
      ensureReason(d, "RETURN_SUPPLIER", v.reason);
      const id = nextId("r");
      const code = docCode("SP");
      // Against the invoice AS IT IS NOW, inside the write: another till may
      // have paid it since the dialog drew its line.
      const plan = planSupplierReturnMoney({
        returnId: id,
        credit: v.credit ?? 0,
        po: inv,
        refundInto: v.refundInto ?? "AWAITED",
        at,
        date: day,
        paymentId: nextId("pp"),
        incomeId: nextId("inc"),
        note: supplierName
          ? `Supplier refund — ${supplierName}`
          : "Supplier refund",
      });
      d.returns.unshift({
        id,
        code,
        kind: "SUPPLIER",
        serial: s,
        reason: v.reason.trim(),
        ...(needsDetail && v.reasonDetail?.trim()
          ? { reasonDetail: v.reasonDetail.trim() }
          : {}),
        date: day,
        status: "DONE",
        ...(u.status === "QC" ? { fromQc: true } : {}),
        ...(supplierId ? { supplierId } : {}),
        expectedCredit: plan.split.credit,
        ...(plan.received > 0 ? { refundReceived: plan.received } : {}),
      });
      // A unit going back from the repairer has left the bench. No
      // destination: it is not back in any warehouse of the shop's.
      d.services = d.services.map((r) =>
        r.serial === s && r.closedAt === undefined ? { ...r, closedAt: at } : r,
      );
      appendEvent(d, s, {
        type: "RETUR_SUPPLIER",
        toStatus: "RETUR_SUPPLIER",
        // The return document — what a reopen reads to know which claim to
        // withdraw.
        refCode: code,
        note: [v.reason.trim(), needsDetail ? v.reasonDetail?.trim() : null]
          .filter(Boolean)
          .join(": "),
        at,
      });
      if (plan.payment) {
        const target = d.pos.find((p) => p.id === plan.payment!.poId);
        target?.payments.push(plan.payment.payment);
      }
      if (plan.income) d.incomes.unshift(plan.income);
      out.code = code;
    });
    if (out.refused) {
      message.warning(
        t(
          "supplierReturn.refused",
          "{{serial}} can no longer go back to the supplier — it is held, sold or already returned.",
          { serial: s },
        ),
      );
      return;
    }
    message.success(
      t(
        "supplierReturn.done",
        "{{serial}} is returned to the supplier ({{code}}).",
        {
          serial: s,
          code: out.code,
        },
      ),
    );
    form.resetFields();
    setAddedService(false);
    onDone(out.code!);
  };

  return (
    <Form<Values>
      form={form}
      layout="vertical"
      style={{ ...FORM_CENTRE, maxWidth: 640 }}
      onFinish={submit}
      initialValues={{
        date: dayjs(),
        reason: defaultReason,
        ...(fixedSerial ? { serial: fixedSerial } : {}),
      }}
    >
      {fixedSerial === undefined ? (
        <Form.Item
          name="serial"
          label={t("returnSupplier.unitInInventory", "Unit in inventory")}
          rules={[{ required: true }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            placeholder={t("returnSupplier.searchSerial", "Search serial")}
            options={candidates.map((u) => ({
              value: u.serial,
              label: unitLabel(u.serial),
              disabled: u.status === "DIRESERVASI",
            }))}
            onChange={(s: string) => prefill(s)}
          />
        </Form.Item>
      ) : (
        <Typography.Paragraph>
          <Typography.Text strong>{fixedSerial}</Typography.Text>
          {sku && (
            <Typography.Text type="secondary">
              {" "}
              — {sku.name} {sku.variantLabel}
            </Typography.Text>
          )}
        </Typography.Paragraph>
      )}

      {blockWhy && (
        <Alert
          type="warning"
          showIcon
          message={blockWhy}
          style={{ marginBottom: SPACE.md }}
        />
      )}

      <Form.Item
        name="supplierId"
        label={t("returnSupplier.supplier", "Supplier")}
        rules={[{ required: true }]}
        extra={
          po
            ? t("supplierReturn.fromInvoice", "From invoice {{code}}", {
                code: po.code,
              })
            : undefined
        }
      >
        <Select
          showSearch
          optionFilterProp="label"
          aria-label={t("returnSupplier.supplier", "Supplier")}
          // The invoice names the supplier; a unit with none is asked.
          disabled={po !== undefined}
          options={db.suppliers.map((s) => ({ value: s.id, label: s.name }))}
        />
      </Form.Item>

      <Form.Item
        name="reason"
        label={t("returnSupplier.reason", "Reason")}
        tooltip={t(
          "returnSupplier.pickOneOrTypeA",
          "Pick one, or type a new reason — a new one is added to Settings automatically",
        )}
        rules={[{ required: true }]}
      >
        <AutoComplete
          aria-label={t("returnSupplier.reason", "Reason")}
          placeholder={t(
            "returnSupplier.searchAReasonOrType",
            "Search a reason, or type a new one",
          )}
          options={reasons.map((r) => ({ value: r.label }))}
          filterOption={(input, opt) =>
            String(opt?.value ?? "")
              .toLowerCase()
              .includes(input.toLowerCase())
          }
        />
      </Form.Item>
      {needsDetail && (
        <Form.Item
          name="reasonDetail"
          label={t("returnSupplier.specifyTheReason", "Specify the reason")}
          rules={[
            {
              required: true,
              message: t(
                "returnSupplier.sayWhatIsActuallyWrong",
                "Say what is actually wrong with it",
              ),
            },
          ]}
        >
          <Input.TextArea
            rows={2}
            placeholder={t(
              "returnSupplier.eGDeadPixelCluster",
              "e.g. dead pixel cluster, hinge play",
            )}
          />
        </Form.Item>
      )}

      <Form.Item
        name="date"
        label={t("supplierReturn.date", "Date")}
        rules={[{ required: true }]}
      >
        <DatePicker style={{ width: "100%" }} allowClear={false} />
      </Form.Item>

      <Form.Item
        label={t("supplierReturn.credit", "Credit")}
        required
        tooltip={t(
          "supplierReturn.creditHint",
          "What the supplier owes back for this unit — its unit price unless you agreed otherwise.",
        )}
        extra={
          <Flex vertical gap={2} style={{ marginTop: SPACE.xs }}>
            {serviceTotal > 0 && (
              <Flex gap={SPACE.sm} align="center" wrap>
                <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                  {t(
                    "supplierReturn.serviceCharges",
                    "Service charges on this unit: {{amount}}",
                    { amount: fmtRp(serviceTotal) },
                  )}
                </Typography.Text>
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  disabled={addedService}
                  onClick={() => {
                    form.setFieldsValue({
                      credit:
                        (form.getFieldValue("credit") ?? 0) + serviceTotal,
                    });
                    setAddedService(true);
                  }}
                >
                  {addedService
                    ? t("supplierReturn.serviceAdded", "Service charges added")
                    : t("supplierReturn.addService", "Add service charges")}
                </Button>
              </Flex>
            )}
            {split.applied > 0 && po && (
              <Typography.Text style={{ fontSize: TYPE.sm }}>
                {t(
                  "supplierReturn.offInvoice",
                  "{{amount}} comes off invoice {{code}} (still unpaid {{owed}})",
                  {
                    amount: fmtRp(split.applied),
                    code: po.code,
                    owed: fmtRp(split.owed),
                  },
                )}
              </Typography.Text>
            )}
            {split.refund > 0 && (
              <Typography.Text style={{ fontSize: TYPE.sm }}>
                {t(
                  "supplierReturn.refundPart",
                  "{{amount}} is a refund from the supplier",
                  { amount: fmtRp(split.refund) },
                )}
              </Typography.Text>
            )}
          </Flex>
        }
      >
        <Form.Item name="credit" noStyle rules={[{ required: true }]}>
          <MoneyInput aria-label={t("supplierReturn.credit", "Credit")} />
        </Form.Item>
      </Form.Item>

      {split.refund > 0 && (
        <Form.Item
          name="refundInto"
          label={t("supplierReturn.receivedInto", "Received into")}
          rules={[
            {
              required: true,
              message: t(
                "supplierReturn.receivedIntoRequired",
                "Say where the refund went, or that it has not come yet.",
              ),
            },
          ]}
        >
          <Radio.Group
            aria-label={t("supplierReturn.receivedInto", "Received into")}
            optionType="button"
            options={REFUND_INTO.map((r) => ({ value: r, label: intoWord(r) }))}
          />
        </Form.Item>
      )}

      <Button
        type="primary"
        htmlType="submit"
        disabled={serial === undefined || block !== undefined}
      >
        {t("returnSupplier.recordSupplierReturn", "Record supplier return")}
      </Button>
    </Form>
  );
}

export interface SupplierReturnModalProps {
  /** The unit being returned, or null while the dialog is shut. */
  readonly serial?: string | null;
  /**
   * Several units, one after another (2026-10-30: Stock out → Return to
   * supplier hands over what was scanned). Each is its own return with its
   * own credit — two units of one box can sit on two invoices. An empty list
   * opens the form with its unit picker.
   */
  readonly serials?: readonly string[] | null;
  readonly defaultReason?: string;
  readonly onClose: () => void;
  /** Stacked above another dialog when it is opened from inside one. */
  readonly zIndex?: number;
}

export function SupplierReturnModal({
  serial,
  serials,
  defaultReason,
  onClose,
  zIndex,
}: SupplierReturnModalProps) {
  const { t } = useTranslation();
  const queue: readonly string[] | null =
    serials !== undefined && serials !== null
      ? serials
      : serial !== undefined && serial !== null
        ? [serial]
        : null;
  const [at, setAt] = useState(0);
  useEffect(() => setAt(0), [serials, serial]);
  const current = queue === null ? undefined : queue[at];
  const next = () => {
    if (queue !== null && at + 1 < queue.length) setAt(at + 1);
    else onClose();
  };
  return (
    <Modal
      open={queue !== null}
      centered
      zIndex={zIndex}
      width={720}
      title={
        current === undefined
          ? t("returns.toSupplier", "To supplier")
          : queue !== null && queue.length > 1
            ? t(
                "supplierReturn.titleOf",
                "Return {{serial}} to the supplier ({{n}} of {{count}})",
                { serial: current, n: at + 1, count: queue.length },
              )
            : t("supplierReturn.title", "Return {{serial}} to the supplier", {
                serial: current,
              })
      }
      onCancel={onClose}
      destroyOnHidden
      // The form owns its submit, at the foot of its fields — the same
      // button the Returns page's dialog shows.
      footer={null}
    >
      {queue !== null && (
        <SupplierReturnForm
          // A fresh form per unit, so the next one does not inherit a credit.
          key={current ?? "pick"}
          serial={current}
          defaultReason={defaultReason}
          onDone={next}
        />
      )}
    </Modal>
  );
}
