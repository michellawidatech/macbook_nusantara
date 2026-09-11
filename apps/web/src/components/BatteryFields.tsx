/**
 * The battery boxes, in whichever units the machine's era reports.
 *
 * One component because there are four desks that ask for a battery reading —
 * Inbound & QC, the Inventory batch editor, the single-unit adjustment dialog
 * and the customer return desk — and after the 2026-09-08 split each of them
 * would otherwise have to know that a 2020-or-earlier machine wants two
 * numbers and a later one wants one. That is not a fact about any of those
 * screens; it is a fact about the machine, and it belongs in one place.
 *
 * ## Why there is no `min`/`max` on the inputs
 *
 * antd's range props do not REFUSE an out-of-range number, they hide it: the
 * change is swallowed while you type and the box snaps to the bound when you
 * leave it, with nothing said. A stray digit therefore becomes a reading of a
 * machine nobody measured. The bound still reaches assistive technology
 * through `aria-valuemin`/`aria-valuemax`, which is the other thing `max` was
 * doing, and the refusal is said out loud — under the box, and by whatever
 * gate the caller has (`commitBattery` at QC, `batchProblems` in the editor).
 *
 * @see lib/battery.ts — `batteryEra`, `BatteryDraft`, `batteryPatch`
 */
import { Flex, InputNumber, Typography } from "antd";
import { useTranslation } from "react-i18next";
import {
  BATTERY_FIELD_RANGE,
  isBatteryDraftInRange,
  type BatteryDraft,
  type BatteryEra,
} from "../lib/battery.js";

export interface BatteryFieldsProps {
  /** Which reading this machine's model reports. See `batteryEra`. */
  readonly era: BatteryEra;
  /** What the boxes hold. `null` in a field is a box somebody emptied. */
  readonly value: BatteryDraft;
  /** Called on every keystroke, with the whole draft. */
  readonly onChange: (next: BatteryDraft) => void;
  /**
   * Called when a box is left or Enter is pressed, naming the field that
   * changed.
   *
   * Optional, and its absence is a real mode rather than an oversight: the
   * batch editor holds a whole grid of rows and validates them all at OK, so
   * it has nothing to do per box. Inbound & QC writes straight to the store
   * and needs the moment.
   */
  readonly onCommit?: (field: keyof BatteryDraft, value: number | null) => void;
  readonly disabled?: boolean;
  readonly size?: "small" | "middle";
  /** Distinguishes this instance's error-message ids from every other row's. */
  readonly idPrefix: string;
}

export function BatteryFields({
  era,
  value,
  onChange,
  onCommit,
  disabled,
  size = "small",
  idPrefix,
}: BatteryFieldsProps) {
  const { t } = useTranslation();

  const box = (field: keyof BatteryDraft, label: string, suffix: string) => {
    const shown = value[field] ?? null;
    const [lo, hi] = BATTERY_FIELD_RANGE[field];
    // Said while the number is still in the box rather than only once it has
    // been left: the person is still looking at the cell.
    const bad = !isBatteryDraftInRange({ [field]: shown }, era);
    const rangeId = `${idPrefix}-${field}-range`;
    return (
      <Flex vertical gap={2} key={field} style={{ minWidth: 0 }}>
        <InputNumber
          size={size}
          style={{ width: "100%" }}
          disabled={disabled}
          aria-valuemin={lo}
          aria-valuemax={hi}
          precision={0}
          placeholder="—"
          // `suffix`, not `addonAfter`: antd 6 deprecates the addon, and the
          // unit belongs inside the box in a column this narrow.
          suffix={suffix}
          status={bad ? "error" : undefined}
          aria-invalid={bad || undefined}
          aria-describedby={bad ? rangeId : undefined}
          aria-label={label}
          value={shown}
          onChange={(v) => onChange({ ...value, [field]: v })}
          onPressEnter={() => onCommit?.(field, shown)}
          onBlur={() => onCommit?.(field, shown)}
        />
        {bad && (
          <Typography.Text id={rangeId} type="danger" style={{ fontSize: 12 }}>
            {t("battery.range", "{{lo}}–{{hi}} only", { lo, hi })}
          </Typography.Text>
        )}
      </Flex>
    );
  };

  return (
    <Flex vertical gap={4}>
      {era === "CYCLES"
        ? [
            box("cycleCount", t("battery.cycleCount", "Cycle count"), "cc"),
            box("fcc", t("battery.fcc", "Full charge capacity"), "mAh"),
          ]
        : box("health", t("battery.health", "Battery health"), "%")}
    </Flex>
  );
}

/** What an era's boxes are called, for a column heading or a form label. */
export function batteryFieldsLabel(era: BatteryEra, t: (k: string, d: string) => string): string {
  return era === "CYCLES"
    ? t("battery.cyclesAndCapacity", "Cycles & capacity")
    : t("battery.health", "Battery health");
}
