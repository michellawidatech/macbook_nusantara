/**
 * The battery boxes, in whichever reading the unit's model is recorded in.
 *
 * One component because there are four desks that ask for a battery reading —
 * Inbound & QC, the Inventory batch editor, the single-unit adjustment dialog
 * and the customer return desk — and each of them would otherwise have to know
 * that an Intel unit of 2020 or before wants two numbers and an Apple silicon
 * one wants a percentage. That is a fact about the unit, not about a screen.
 *
 * ## Why there is no switch
 *
 * There was one, per row, from 2026-09-15. The owner took it out on
 * 2026-09-19: *"the system is the one that must determine"* — Apple silicon
 * or 2021+ is health, Intel is cycle count and FCC, and `fallback`
 * (`defaultBatteryMode`) is that decision. Nobody at the bench chooses.
 *
 * ## Why the two cycle boxes share a row
 *
 * *"For the inbound battery section in FCC and CC, make it in 1 row not
 * separate row"* — owner, 2026-09-20. They are one reading taken off one
 * screen in System Information, so stacking them made one battery look like
 * two questions and cost the QC grid a row's height on every unit.
 *
 * Sharing a row is a width problem, and two things solve it. The capacity box
 * is given HALF AGAIN the cycle box's share (`GROW`), because it holds four
 * digits and the longer suffix while a cycle count is three digits and "cc".
 * And the stepper arrows are off: nobody nudges a measured battery up by one,
 * they type what System Information said, and the arrows were eating the
 * width that the fourth digit of "7538" needed — it rendered as "75… mAh".
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
import { Flex, InputNumber, Typography } from "antd";
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

/** How the row's width is shared out. See the header. */
const GROW: Record<BatteryField, number> = {
  health: 1,
  cycleCount: 1,
  fcc: 1.5,
};

export interface BatteryFieldsProps {
  /** Which reading this unit is recorded in — `defaultBatteryMode`. */
  readonly fallback: BatteryMode;
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
  readonly onCommit?: (field: BatteryField, value: number | null) => void;
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
      <Flex
        vertical
        gap={2}
        key={field}
        // A share of the row each, and allowed to shrink: without
        // `minWidth: 0` a flex item refuses to go under its content's width
        // and the pair overflows the column instead of sharing it.
        style={{ flex: `${GROW[field]} 1 0`, minWidth: 0 }}
      >
        <InputNumber
          size={size}
          style={{ width: "100%" }}
          disabled={disabled}
          aria-valuemin={lo}
          aria-valuemax={hi}
          precision={0}
          // See the header: a battery reading is typed, never stepped, and
          // the arrows cost the room the last digit needs.
          controls={false}
          // `suffix`, not `addonAfter`: antd 6 deprecates the addon, and the
          // unit belongs inside the box in a column this narrow. There is no
          // placeholder, so an empty box shows the suffix alone — not a dash
          // (owner 2026-09-21), and not a 0, which would read as a dead
          // battery rather than an unmeasured one.
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
    // One row. `wrap={false}` on purpose: a battery that dropped its capacity
    // under the cycle count on a narrow column would be the stacked layout
    // this replaced, arriving by itself.
    <Flex gap={4} wrap={false} align="flex-start">
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
 * A heading is per GROUP — one product, so one reading. Every box still
 * carries its own unit as a suffix and its own label to assistive technology.
 */
export function batteryFieldsLabel(
  mode: BatteryMode,
  t: (k: string, d: string) => string,
): string {
  return mode === "CYCLES"
    ? t("battery.cyclesAndCapacity", "Cycles & capacity")
    : t("battery.health", "Battery health");
}
