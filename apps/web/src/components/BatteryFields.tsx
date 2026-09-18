/**
 * The battery boxes, in whichever reading the machine is being recorded in —
 * and the switch between the two (owner ask 2026-09-15).
 *
 * One component because there are four desks that ask for a battery reading —
 * Inbound & QC, the Inventory batch editor, the single-unit adjustment dialog
 * and the customer return desk — and after the 2026-09-08 split each of them
 * would otherwise have to know that an Intel machine of 2020 or before wants
 * two numbers and an Apple silicon one wants a percentage. That is not a fact
 * about any of those screens; it is a fact about the machine, and it belongs
 * in one place.
 *
 * ## Why the switch is drawn on every row
 *
 * *"Make the battery & cycles switchable to 'Battery health'."* `fallback` is
 * only the machine's DEFAULT — `defaultBatteryMode`, the chip and the year —
 * and a default is a guess about a model, while the bench is holding the
 * machine. A 2019 Pro whose owner replaced the battery reports a percentage;
 * a hackintosh-era Air somebody reset reports cycles. The person who can see
 * the screen decides, per machine, and `batteryDraftMode` is where that
 * decision is read back.
 *
 * The switch writes `mode` into the DRAFT rather than calling a handler of its
 * own, so a caller that already carries a draft carries the switch for free
 * and `batteryPatch` writes the right pair of columns without being told.
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
 * @see lib/battery.ts — `defaultBatteryMode`, `BatteryDraft`, `batteryPatch`
 */
import { Flex, InputNumber, Segmented, Typography } from "antd";
import { useTranslation } from "react-i18next";
import {
  BATTERY_FIELD_RANGE,
  BATTERY_FIELDS,
  batteryDraftMode,
  isBatteryFieldInRange,
  type BatteryDraft,
  type BatteryField,
  type BatteryMode,
} from "../lib/battery.js";

export interface BatteryFieldsProps {
  /**
   * Which reading this machine STARTS on — `defaultBatteryMode`. The draft's
   * own `mode` wins over it once somebody has flicked the switch.
   */
  readonly fallback: BatteryMode;
  /** What the boxes hold. `null` in a field is a box somebody emptied. */
  readonly value: BatteryDraft;
  /** Called on every keystroke, and on the switch, with the whole draft. */
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
  readonly onCommit?: (field: BatteryField, value: number | null) => void;
  /**
   * Called when the switch is flicked, after `onChange` has carried the new
   * draft. For a caller that writes through immediately — the switch is a
   * decision, not a keystroke, so there is no blur to wait for.
   */
  readonly onModeCommit?: (mode: BatteryMode) => void;
  readonly disabled?: boolean;
  readonly size?: "small" | "middle";
  /** Distinguishes this instance's error-message ids from every other row's. */
  readonly idPrefix: string;
}

export function BatteryFields({
  fallback,
  value,
  onChange,
  onCommit,
  onModeCommit,
  disabled,
  size = "small",
  idPrefix,
}: BatteryFieldsProps) {
  const { t } = useTranslation();
  const mode = batteryDraftMode(value, fallback);

  const box = (field: BatteryField, label: string, suffix: string) => {
    const shown = value[field] ?? null;
    const [lo, hi] = BATTERY_FIELD_RANGE[field];
    // Said while the number is still in the box rather than only once it has
    // been left: the person is still looking at the cell.
    const bad = !isBatteryFieldInRange(field, shown);
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
          onChange={(v) => onChange({ ...value, mode, [field]: v })}
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

  const label: Record<BatteryMode, string> = {
    HEALTH: t("battery.modeHealth", "Health"),
    CYCLES: t("battery.modeCycles", "Cycles"),
  };

  return (
    <Flex vertical gap={4}>
      <Segmented
        size="small"
        block
        disabled={disabled}
        aria-label={t("battery.modeAria", "How this battery is recorded")}
        value={mode}
        onChange={(next) => {
          const picked = next as BatteryMode;
          onChange({ ...value, mode: picked });
          onModeCommit?.(picked);
        }}
        options={[
          { value: "HEALTH", label: label.HEALTH },
          { value: "CYCLES", label: label.CYCLES },
        ]}
      />
      {BATTERY_FIELDS[mode].map((field) =>
        field === "health"
          ? box(field, t("battery.health", "Battery health"), "%")
          : field === "cycleCount"
            ? box(field, t("battery.cycleCount", "Cycle count"), "cc")
            : box(field, t("battery.fcc", "Full charge capacity"), "mAh"),
      )}
    </Flex>
  );
}

/**
 * What a reading's boxes are called, for a column heading or a form label.
 *
 * A heading is per GROUP — one product, so one default — while the switch is
 * per machine, which is why a row switched away from the heading still reads
 * correctly: every box carries its own unit as a suffix and its own label to
 * assistive technology.
 */
export function batteryFieldsLabel(
  mode: BatteryMode,
  t: (k: string, d: string) => string,
): string {
  return mode === "CYCLES"
    ? t("battery.cyclesAndCapacity", "Cycles & capacity")
    : t("battery.health", "Battery health");
}
