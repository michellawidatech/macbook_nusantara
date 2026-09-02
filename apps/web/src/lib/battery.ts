/**
 * Battery health: how it prints, and how it filters.
 *
 * Replaced the cycle count on 2026-08-24 by owner decision. Both are hard
 * numbers, but they are not equally useful at the counter: a cycle count has to
 * be argued into a price ("300 cycles on a 1000-cycle rating"), while a health
 * percentage already IS the argument. The shop's own unit descriptions were
 * written in percentages long before this column was — "mulus 95%, battery 91%"
 * — so the structured field now says what the prose always did.
 *
 * The column sorts on the number and facets on a BAND, for the same reason the
 * cycle column did: `ProTable` builds a facet's options from the values present
 * in the data, so faceting on the number itself would offer one option per
 * percentage point.
 *
 * ## Two thresholds, three bands
 *
 * The owner's bands arrived as three ranges that overlapped — "fair 76–79"
 * against "bad below 75%–79%" — which is the failure mode of writing ranges by
 * hand: they can overlap, and they can leave a gap. Storing two thresholds
 * makes both unrepresentable. Good is `>= goodMin`, fair is `>= fairMin`, and
 * anything below `fairMin` is bad, so the three always tile 0–100 exactly once.
 */

/** The two numbers the bands are derived from. Configurable in Settings. */
export interface BatteryThresholds {
  /** At or above this is good. */
  readonly goodMin: number;
  /** At or above this — but below `goodMin` — is fair. */
  readonly fairMin: number;
}

/**
 * The owner's defaults (2026-08-24): good 80–100, fair 76–79, bad 75 and under.
 *
 * Mirrors the `battery.goodMin` / `battery.fairMin` rows the AppSetting
 * migration seeds, so the mock and the database agree before Settings is wired
 * to the API.
 */
export const DEFAULT_BATTERY_THRESHOLDS: BatteryThresholds = {
  goodMin: 80,
  fairMin: 76,
};

/** What a missing reading shows as — in the cell, and as its own filter value. */
export const BATTERY_UNKNOWN = "Not recorded";

/**
 * The only readings that exist: a percentage of the battery's original capacity.
 *
 * One pair of numbers for the whole app, so the bound the QC box enforces and
 * the bound `batteryGrade` refuses to grade are the same bound. 100 is a new
 * battery and there is nothing above it — a bigger number is a typo (a slipped
 * digit on 15, or a keyboard repeat on 100), never a healthier machine.
 */
export const BATTERY_HEALTH_MIN = 0;
export const BATTERY_HEALTH_MAX = 100;

/**
 * Is this something somebody could have read off System Information?
 *
 * Empty passes: "nobody has measured it" is a legitimate state of the field,
 * and the one an accessory stays in forever. Only a number outside the range
 * fails.
 */
export function isBatteryHealthInRange(
  health: number | null | undefined,
): boolean {
  if (health == null) return true;
  return (
    Number.isFinite(health) &&
    health >= BATTERY_HEALTH_MIN &&
    health <= BATTERY_HEALTH_MAX
  );
}

export type BatteryGrade = "good" | "fair" | "bad";

/** Band colours, as antd Tag colours. Green good, gold fair, red bad. */
export const BATTERY_GRADE_COLOR: Record<BatteryGrade, string> = {
  good: "green",
  fair: "gold",
  bad: "red",
};

/**
 * Which grade a reading falls in, or `null` when there is no reading.
 *
 * `null`/`undefined` is "nobody has measured this" and is deliberately NOT
 * folded into the worst band: an accessory has no battery at all, and a unit
 * adjusted in off the street may reach the shelf before anyone opened System
 * Information. Filtering for it is how staff find the units still owed a
 * reading.
 *
 * Note the sentinel inverted when this replaced the cycle count. A brand-new
 * battery reads **0 cycles** but **100 percent**, so the old trap ("0 is a real
 * count, do not treat it as missing") became the opposite one: 0% is a real
 * reading too, of a dead battery. Both versions are safe for the same reason —
 * an explicit null check rather than a falsiness check.
 */
export function batteryGrade(
  health: number | null | undefined,
  thresholds: BatteryThresholds = DEFAULT_BATTERY_THRESHOLDS,
): BatteryGrade | null {
  if (health == null || !Number.isFinite(health)) return null;
  // Out of range is not a reading. The QC box refuses one before it reaches the
  // store (`isBatteryHealthInRange`), but an import can still carry one, and
  // bucketing 250% as "good" would launder bad data into a plausible-looking
  // row.
  if (!isBatteryHealthInRange(health)) return null;
  if (health >= thresholds.goodMin) return "good";
  if (health >= thresholds.fairMin) return "fair";
  return "bad";
}

/**
 * The three band labels, in the order a facet should list them.
 *
 * Labels are built from the thresholds rather than written out, so a change in
 * Settings cannot leave the filter claiming a range the data no longer uses.
 */
export function batteryBands(
  thresholds: BatteryThresholds = DEFAULT_BATTERY_THRESHOLDS,
): readonly { grade: BatteryGrade; label: string }[] {
  const { goodMin, fairMin } = thresholds;
  return [
    { grade: "good", label: `Good (${goodMin}%+)` },
    // Only shown as a range when there is a range to show: with fairMin one
    // below goodMin the band is a single value, and "Fair (79–79%)" reads as
    // a bug.
    {
      grade: "fair",
      label:
        goodMin - 1 > fairMin
          ? `Fair (${fairMin}–${goodMin - 1}%)`
          : `Fair (${fairMin}%)`,
    },
    { grade: "bad", label: `Poor (under ${fairMin}%)` },
  ];
}

/** The band label a reading falls in, or `BATTERY_UNKNOWN`. */
export function batteryBand(
  health: number | null | undefined,
  thresholds: BatteryThresholds = DEFAULT_BATTERY_THRESHOLDS,
): string {
  const grade = batteryGrade(health, thresholds);
  if (grade === null) return BATTERY_UNKNOWN;
  return batteryBands(thresholds).find((b) => b.grade === grade)!.label;
}

/** The cell: `91%`, or an em dash. Never a bare `0` for a missing reading. */
export function fmtBatteryHealth(health: number | null | undefined): string {
  if (health == null || !Number.isFinite(health)) return "—";
  return `${health}%`;
}

/** The `?` guide next to the column title, as one sentence per band. */
export function batteryGuide(
  thresholds: BatteryThresholds = DEFAULT_BATTERY_THRESHOLDS,
): string {
  const { goodMin, fairMin } = thresholds;
  return (
    `Battery health as a percentage of original capacity. ` +
    `Good is ${goodMin}% and above, fair is ${fairMin}–${goodMin - 1}%, ` +
    `and poor is under ${fairMin}%. Blank means nobody has measured it yet. ` +
    `The thresholds are set in Settings.`
  );
}

/**
 * The thresholds as the mock database currently holds them.
 *
 * A thin adapter, so that pages read "the shop's thresholds" rather than
 * reaching into `db.settings` and each deciding what to do when a value is
 * missing. When Settings is wired to the API this is the one function that
 * changes.
 */
export function thresholdsFrom(settings: {
  batteryGoodMin?: number;
  batteryFairMin?: number;
}): BatteryThresholds {
  const goodMin = settings.batteryGoodMin ?? DEFAULT_BATTERY_THRESHOLDS.goodMin;
  const fairMin = settings.batteryFairMin ?? DEFAULT_BATTERY_THRESHOLDS.fairMin;
  // A fair floor above the good floor would make the fair band empty and the
  // labels nonsense. Clamp rather than throw: a bad setting should degrade the
  // filter, not take the stock list down with it.
  return { goodMin, fairMin: Math.min(fairMin, goodMin) };
}
