/**
 * Has this unit ever been serviced or opened? (owner, 2026-10-28) — asked at
 * QC, because "belum pernah servis" is a promise the bot makes to a customer
 * and only the person who opened the unit can make it.
 *
 * Three answers, and the third is real: *Not checked* is what every unit
 * taken in before today says, and it is never read as either of the others.
 * A visit to the Service bench says "serviced" whatever this holds
 * (`servicedState`, packages/domain).
 */
import { Segmented, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { fmtNone } from "../lib/format.js";

type Answer = "never" | "serviced" | "unknown";

const toAnswer = (v: boolean | undefined): Answer =>
  v === true ? "never" : v === false ? "serviced" : "unknown";
const fromAnswer = (a: Answer): boolean | undefined =>
  a === "never" ? true : a === "serviced" ? false : undefined;

export function NeverServicedField({
  value,
  onChange,
  disabled,
}: {
  readonly value: boolean | undefined;
  readonly onChange: (next: boolean | undefined) => void;
  readonly disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Segmented<Answer>
      size="small"
      value={toAnswer(value)}
      disabled={disabled}
      aria-label={t("qc.neverServiced", "Never serviced / opened")}
      options={[
        { value: "never", label: t("qc.neverServicedYes", "Never") },
        { value: "serviced", label: t("qc.neverServicedNo", "Serviced") },
        {
          value: "unknown",
          label: t("qc.neverServicedUnknown", "Not checked"),
        },
      ]}
      onChange={(a) => onChange(fromAnswer(a))}
    />
  );
}

/** The answer as text, for a row that can no longer be edited. */
export function NeverServicedText({
  value,
}: {
  readonly value: boolean | undefined;
}) {
  const { t } = useTranslation();
  return (
    <Typography.Text>
      {value === true
        ? t("qc.neverServicedYes", "Never")
        : value === false
          ? t("qc.neverServicedNo", "Serviced")
          : fmtNone()}
    </Typography.Text>
  );
}
