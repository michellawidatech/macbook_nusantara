/**
 * Send a unit to service — ONE dialog for every door (owner asks 2026-10-26,
 * spec §2 and §4): the Inbound & QC row (an accepted unit too, from its ⋯),
 * Inventory's unit rows (their ⋯), and nothing else, because Stock out keeps
 * only write-offs now.
 *
 * It asks *Where is it serviced?* — every active warehouse, the unit's own by
 * default and labelled so. Until this it defaulted to "the bench", found by
 * `Location.kind === "SERVIS"`, and in the shop's database that is 04, *Gudang
 * Masuk Belum QC*: the receiving room. A different warehouse asks what the
 * courier cost; the repair quote is asked either way; and each charge says how
 * it was paid — Bank, Other bank, Cash, or *Not paid yet*. A paid one is an
 * expense of kind UNIT (`lib/serviceActions.ts`), in the same mutation.
 *
 * What is written is `planSendToService`'s plan, read against the unit as it
 * is INSIDE the mutation — its warehouse before the event moves it is where it
 * set out from, which is what *Back in stock* returns it to.
 */
import {
  App,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { RP_SYMBOL, moneyFormatter, moneyParser } from "./money";
import {
  PAID_WITH,
  planSendToService,
  sendToServiceBlock,
  type PaidWith,
} from "../lib/serviceActions.js";
import { warehouseLabel, warehouseLabelOf } from "../lib/warehouses.js";
import {
  appendEvent,
  currentStaffName,
  mutate,
  nextId,
  useDb,
} from "../mock/store.js";
import { SPACE } from "../theme/tokens";
import type { ServiceRec } from "../lib/service.js";

export interface SendToServiceModalProps {
  /** The unit being sent, or null while the dialog is shut. */
  readonly serial: string | null;
  /** Which desk sent it. */
  readonly raisedBy: ServiceRec["raisedBy"];
  /** The invoice it is on, when QC sends it. */
  readonly poId?: string;
  /** The document the event names — the invoice's code at QC. */
  readonly refCode?: string;
  readonly onClose: () => void;
  /** Stacked above another dialog when it is opened from inside one. */
  readonly zIndex?: number;
}

interface Values {
  dest: string;
  shippingFee?: number;
  shippingPaid: PaidWith;
  quote?: number;
  quotePaid: PaidWith;
  note?: string;
}

/** The words for one way of paying. Literal calls: the i18n test reads them. */
export function usePaidWithLabel() {
  const { t } = useTranslation();
  return (p: PaidWith): string => {
    switch (p) {
      case "TRANSFER":
        return t("service.paidBank", "Bank");
      case "TRANSFER_LUAR":
        return t("service.paidOtherBank", "Other bank");
      case "TUNAI":
        return t("service.paidCash", "Cash");
      default:
        return t("service.notPaidYet", "Not paid yet");
    }
  };
}

/** The four choices as buttons, for a charge's "Paid with". */
export function PaidWithField({
  name,
  label,
}: {
  readonly name: string;
  readonly label: string;
}) {
  const word = usePaidWithLabel();
  return (
    <Form.Item name={name} label={label} style={{ marginBottom: SPACE.md }}>
      <Radio.Group
        aria-label={label}
        optionType="button"
        size="small"
        options={PAID_WITH.map((p) => ({ value: p, label: word(p) }))}
      />
    </Form.Item>
  );
}

const MONEY_INPUT = {
  min: 0,
  precision: 0,
  prefix: RP_SYMBOL,
  formatter: moneyFormatter,
  parser: moneyParser,
  style: { width: "100%" },
} as const;

export function SendToServiceModal({
  serial,
  raisedBy,
  poId,
  refCode,
  onClose,
  zIndex,
}: SendToServiceModalProps) {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const unit = db.units.find((u) => u.serial === serial);
  const here = unit?.locationId;

  const close = () => {
    form.resetFields();
    onClose();
  };

  const submit = () =>
    form.validateFields().then((v) => {
      if (serial === null) return;
      const at = new Date().toISOString();
      // An object, not two `let`s: TypeScript does not see the recipe assign
      // them and would narrow both to their starting values.
      const out: { refused: boolean; sentTo?: string } = { refused: false };
      // `mutate` runs the recipe synchronously; what it learned is read
      // straight after, without waiting for the server to answer.
      void mutate((d) => {
        const u = d.units.find((x) => x.serial === serial);
        // Asked again inside the mutation: a unit can be reserved or sold in
        // another tab between the render and the click.
        if (!u || sendToServiceBlock(u.status) !== undefined) {
          out.refused = true;
          return;
        }
        const plan = planSendToService({
          unit: { serial, locationId: u.locationId },
          dest: v.dest,
          shippingFee: v.shippingFee ?? undefined,
          shippingPaid: v.shippingPaid,
          quote: v.quote ?? undefined,
          quotePaid: v.quotePaid,
          note: v.note,
          raisedBy,
          poId,
          at,
          staff: currentStaffName(),
          // Translated where it is WRITTEN — stored, and frozen in whatever
          // language the desk happened to be in.
          words: {
            shipLabel: t("inbound.serviceShipLabel", "Courier to service"),
            quoteLabel:
              raisedBy === "QC"
                ? t("inbound.serviceFeeRaised", "Quoted at QC")
                : t("service.quoteLabel", "Quoted when sent"),
            eventNote:
              v.dest !== u.locationId
                ? `Sent to service — ${warehouseLabelOf(d.warehouses, v.dest) ?? v.dest}`
                : "Sent to service",
          },
          nextId,
        });
        appendEvent(d, serial, {
          ...plan.event,
          ...(refCode ? { refCode } : {}),
        });
        // The rack belongs to the warehouse it is leaving.
        if (plan.travelling) u.rackId = undefined;
        d.services.push(plan.visit);
        for (const e of plan.expenses) d.expenses.unshift(e);
        if (plan.travelling) out.sentTo = v.dest;
      });
      if (out.refused) {
        message.warning(
          t(
            "service.sendRefused",
            "{{serial}} can no longer be sent to service — it is not in QC or on the shelf.",
            { serial },
          ),
        );
        close();
        return;
      }
      close();
      message.success(
        out.sentTo !== undefined
          ? t(
              "inbound.serviceSentShipping",
              "{{serial}} is now at {{bench}}.",
              {
                serial,
                bench:
                  warehouseLabelOf(db.warehouses, out.sentTo) ?? out.sentTo,
              },
            )
          : t(
              "service.sentStays",
              "{{serial}} is at service where it stands.",
              {
                serial,
              },
            ),
      );
    });

  return (
    <Modal
      open={serial !== null}
      centered
      zIndex={zIndex}
      title={t("service.sendTitle", "Send {{serial}} to service", {
        serial: serial ?? "",
      })}
      okText={t("inbound.serviceOk", "Send to service")}
      onCancel={close}
      onOk={submit}
      destroyOnHidden
    >
      <Form<Values>
        form={form}
        layout="vertical"
        initialValues={{
          dest: here,
          shippingPaid: "UNPAID",
          quotePaid: "UNPAID",
        }}
      >
        <Typography.Paragraph type="secondary">
          {t(
            "service.sendBody",
            "{{serial}} stops being sellable now. Its charges count in what the unit cost, paid or not.",
            { serial: serial ?? "" },
          )}
        </Typography.Paragraph>
        <Form.Item
          name="dest"
          label={t("service.whereServiced", "Where is it serviced?")}
          rules={[{ required: true }]}
        >
          <Select
            aria-label={t("service.whereServiced", "Where is it serviced?")}
            options={db.warehouses
              .filter((w) => w.active || w.id === here)
              .map((w) => ({
                value: w.id,
                label:
                  w.id === here
                    ? t("inbound.serviceStaysHere", "{{name}} (stays here)", {
                        name: warehouseLabel(w),
                      })
                    : warehouseLabel(w),
              }))}
          />
        </Form.Item>
        <Form.Item noStyle shouldUpdate>
          {({ getFieldValue }) => {
            const travelling =
              getFieldValue("dest") !== undefined &&
              getFieldValue("dest") !== here;
            const shipping = (getFieldValue("shippingFee") ?? 0) > 0;
            const quoted = (getFieldValue("quote") ?? 0) > 0;
            return (
              <Flex vertical>
                {travelling && (
                  <>
                    <Form.Item
                      name="shippingFee"
                      label={t(
                        "inbound.serviceShippingFee",
                        "Cost of getting it there",
                      )}
                      tooltip={t(
                        "inbound.serviceShippingFeeHint",
                        "The courier between the two warehouses. It joins what this unit has cost the shop.",
                      )}
                    >
                      <InputNumber {...MONEY_INPUT} />
                    </Form.Item>
                    {shipping && (
                      <PaidWithField
                        name="shippingPaid"
                        label={t(
                          "service.courierPaidWith",
                          "Courier paid with",
                        )}
                      />
                    )}
                  </>
                )}
                <Form.Item
                  name="quote"
                  label={t("service.repairQuote", "Repair quote")}
                  tooltip={t(
                    "inbound.serviceFeeHint2",
                    "Only if you already know it. Anything the repairer bills later is added at the bench, where it can also be corrected.",
                  )}
                >
                  <InputNumber
                    {...MONEY_INPUT}
                    placeholder={t("inbound.serviceFeeHint", "If you know it")}
                  />
                </Form.Item>
                {quoted && (
                  <PaidWithField
                    name="quotePaid"
                    label={t("service.quotePaidWith", "Repair paid with")}
                  />
                )}
              </Flex>
            );
          }}
        </Form.Item>
        <Form.Item
          name="note"
          label={t("inbound.serviceProblem", "What is wrong with it")}
        >
          <Input.TextArea
            rows={2}
            placeholder={t(
              "inbound.serviceProblemHint",
              "Optional — what the bench should look at",
            )}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
