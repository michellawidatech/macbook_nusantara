/**
 * Date filters as presets (owner-approved mockup c2, 2026-11-16): on a phone a
 * date column's filter is *Any date, Today, 7 days, This month* and *Custom* —
 * nearly every look-up is one of the first four, and a calendar first is a
 * calendar to dismiss.
 *
 * A preset is only a way of WRITING a range: it becomes the same
 * `[from, until]` pair of local `YYYY-MM-DD` days the desktop header's range
 * picker writes, so a filter set on one is read by the other. `presetOf`
 * reads a stored range back to the chip that wrote it, and anything else is
 * Custom.
 */
import dayjs, { type Dayjs } from "dayjs";

/** A date filter's bounds as local days; either end may be open. */
export type DayRange = readonly [string | null, string | null];

export type DatePreset = "today" | "7d" | "month";

const DAY = "YYYY-MM-DD";

/** The range a preset means, on the day `now` falls on. */
export function presetRange(
  preset: DatePreset,
  now: Dayjs = dayjs(),
): DayRange {
  const today = now.format(DAY);
  switch (preset) {
    case "today":
      return [today, today];
    case "7d":
      // Seven calendar days, today included.
      return [now.subtract(6, "day").format(DAY), today];
    case "month":
      return [now.startOf("month").format(DAY), now.endOf("month").format(DAY)];
  }
}

/** Which chip a stored range is: a preset, nothing at all, or Custom. */
export function presetOf(
  range: DayRange | undefined,
  now: Dayjs = dayjs(),
): DatePreset | "any" | "custom" {
  if (range === undefined || (range[0] === null && range[1] === null))
    return "any";
  for (const p of ["today", "7d", "month"] as const) {
    const r = presetRange(p, now);
    if (r[0] === range[0] && r[1] === range[1]) return p;
  }
  return "custom";
}
