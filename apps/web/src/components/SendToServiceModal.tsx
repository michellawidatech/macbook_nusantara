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
import { Form, Radio } from "antd";
import { useTranslation } from "react-i18next";
import { PAID_WITH, type PaidWith } from "../lib/serviceActions.js";
import { SPACE } from "../theme/tokens";
import type { ServiceRec } from "../lib/service.js";
import { ServiceBatchModal } from "./ServiceBatchModal";

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

/**
 * The single-unit door: `ServiceBatchModal` with one serial and no list
 * (2026-10-30). The repair quote left it — the bill is added later on the
 * Service page with *+ Charge* — and "What is wrong with it" became
 * *Description*, the same box every unit of a batch has.
 */
export function SendToServiceModal({
  serial,
  raisedBy,
  poId,
  refCode,
  onClose,
  zIndex,
}: SendToServiceModalProps) {
  return (
    <ServiceBatchModal
      mode="SEND"
      single
      serials={serial === null ? null : [serial]}
      raisedBy={raisedBy}
      poId={poId}
      refCode={refCode}
      onClose={onClose}
      zIndex={zIndex}
    />
  );
}
