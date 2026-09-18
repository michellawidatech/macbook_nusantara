/**
 * A battery: how it is recorded, how it prints, and how it filters.
 *
 * ## Two readings, a default, and a switch (owner asks 2026-09-08, 2026-09-15)
 *
 * A battery is recorded as a **health percentage**, or as a **cycle count**
 * and a **full charge capacity**. Which of the two a machine STARTS on comes
 * from its model — Apple silicon, or anything released in 2021 or later,
 * starts on health; the Intel machines of 2020 and before start on cycles —
 * and whoever enters the battery can switch that one machine to the other
 * reading. A machine that has a reading is read the way it was recorded. See
 * `defaultBatteryMode` for the rule, `batteryModeOf` for the switch, and
 * `readBattery` for the one function every column and filter goes through.
 *
 * Everything above the divider is the health half, unchanged. The cycle half
 * mirrors it function for function — thresholds, bands, a formatter, a grade —
 * so that a screen showing a mixed shelf has one shape to render and one band
 * vocabulary to filter on.
 *
 * ## The health reading
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

/** Best to worst — the order a facet lists the bands and a sort ranks them. */
export const BATTERY_GRADES: readonly BatteryGrade[] = ["good", "fair", "bad"];

/** Band colours, as antd Tag colours. Green good, gold fair, red bad. */
export const BATTERY_GRADE_COLOR: Record<BatteryGrade, string> = {
  good: "green",
  fair: "gold",
  bad: "red",
};

/**
 * The worst of some grades, or null when none of them is a grade.
 *
 * What a range is coloured by: a product whose machines span a band boundary is
 * one a buyer can still be handed the tired one from.
 */
export function worstBatteryGrade(
  grades: Iterable<BatteryGrade | null>,
): BatteryGrade | null {
  let worst: BatteryGrade | null = null;
  for (const g of grades) {
    if (g === null) continue;
    if (
      worst === null ||
      BATTERY_GRADES.indexOf(g) > BATTERY_GRADES.indexOf(worst)
    ) {
      worst = g;
    }
  }
  return worst;
}

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

/* ────────────────────────────────────────────────────────────────────────────
 * Two readings (owner ask 2026-09-08), a default and a switch (2026-09-15)
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * The last model year whose battery STARTS on cycles rather than health.
 *
 * The owner's rule of 2026-09-08: *"if the release year of the device is 2020
 * and earlier, the battery health is tracked by cc (cycle count) and fcc (full
 * charging capacity), while the other model (2021 and above) is tracked by
 * battery health"*. Inclusive — a 2020 Intel machine is a cycles machine.
 *
 * The reason is not a preference, it is what the machine will tell you. macOS
 * has always printed the cycle count and the full charge capacity in System
 * Information; the single "Battery Health: 91%" figure staff read off the
 * settings pane is a modern reading, and on an older Mac the bench has to
 * divide FCC by a design capacity nobody has to hand. Recording a percentage
 * there means recording somebody's arithmetic, and three people doing that
 * arithmetic against three remembered design capacities is three different
 * answers about one battery.
 *
 * Half of a default since 2026-09-15, not the whole answer — Apple silicon is
 * health whatever its year. See `defaultBatteryMode`.
 */
export const BATTERY_CYCLE_ERA_MAX_YEAR = 2020;

/**
 * The year Apple silicon first shipped: the M1, November 2020.
 *
 * The guard on the chip half of the rule. The 12-inch MacBook of 2016–2017 was
 * sold with an Intel Core m3, m5 or m7, and the B2Soft import files that chip
 * as `m3` in exactly the axis an M3 would sit in — so a chip token on a model
 * released before Apple silicon existed is an Intel part, not an M-series Mac.
 */
export const APPLE_SILICON_FIRST_YEAR = 2020;

/** Which pair of numbers a machine's battery is described by. */
export type BatteryMode =
  /** Cycle count and full charge capacity. */
  | "CYCLES"
  /** A health percentage. */
  | "HEALTH";

/**
 * `BatteryMode`, under the name it had while the model's release year was the
 * whole answer (2026-09-08 to 2026-09-15). Kept so existing callers compile.
 */
export type BatteryEra = BatteryMode;

/**
 * A release year that means something.
 *
 * Zero is not one. The Postgres projection writes 0 for a model nobody gave a
 * year, and so does the B2Soft import for every accessory, spare part and name
 * it could not parse — and read as a year, 0 is "before 2020", which filed
 * every one of them as a cycles machine.
 */
function knownYear(year: number | null | undefined): number | undefined {
  return year != null && Number.isFinite(year) && year > 0 ? year : undefined;
}

/**
 * The release-year half of the default: 2020 and earlier start on cycles.
 *
 * An unknown year answers `HEALTH`, and the choice is deliberate: a product
 * with no year is almost always something new enough that nobody bothered to
 * type one, and health is the reading the bench takes without thinking. The
 * cost of guessing wrong is one field asking for a number the machine does not
 * show, which the switch recovers from — the other direction would ask for
 * two.
 *
 * Blind to the chip, so a 2020 M1 comes out `CYCLES` here. Ask
 * `defaultBatteryMode` wherever the model is to hand.
 */
export function batteryEra(
  releaseYear: number | null | undefined,
): BatteryMode {
  const year = knownYear(releaseYear);
  if (year === undefined) return "HEALTH";
  return year <= BATTERY_CYCLE_ERA_MAX_YEAR ? "CYCLES" : "HEALTH";
}

/**
 * An M-series chip, as a token: `M1`, `M2 Pro`, `(M1, 2020)`, `13" M2 8/256`.
 *
 * A token and not a substring — the M must not follow a letter or digit and
 * the number must not run into one — which is what keeps `M.2` (a drive),
 * `MQ2K3` (a part number), `MAGSAFE 3`, `iMac21,1` and `XM4` out. Case-blind,
 * because B2Soft types in capitals and a person types however they like; Intel
 * spells its own chip "Core m3", so that spelling is excluded by name.
 */
const M_CHIP = /(?<![A-Za-z0-9])(?<!core[\s-]*)m[1-9]\d?(?![A-Za-z0-9])/i;

/** Does this piece of catalogue text name an M-series chip? */
export function namesAppleSilicon(text: string | null | undefined): boolean {
  return text != null && M_CHIP.test(text);
}

/** What a catalogue model says that bears on its battery. */
export interface BatteryModelFacts {
  readonly name?: string;
  readonly line?: string;
  readonly identifier?: string;
  readonly releaseYear?: number | null;
  readonly axes?: readonly { readonly values: readonly string[] }[];
}

/** …and a variant, which is where the chip lives when a model spans two. */
export interface BatterySkuFacts {
  readonly name?: string;
  readonly variantLabel?: string;
  readonly axisValues?: Readonly<Record<string, string>>;
}

/**
 * Is this an Apple silicon machine, as far as the catalogue can tell?
 *
 * Read from everywhere the catalogue spells a chip: the model's name, line and
 * identifier, and the variant's name, label and axis values. The MODEL's axis
 * values only when no variant is given — a model can span both kinds of
 * machine (the 13-inch MacBook Pro of 2020 shipped as an Intel and as an M1),
 * and a variant that says `i5` must not inherit the `M1` beside it in the
 * model's list of chips.
 */
export function isAppleSilicon(
  model: BatteryModelFacts | undefined,
  sku?: BatterySkuFacts,
): boolean {
  const year = knownYear(model?.releaseYear);
  if (year !== undefined && year < APPLE_SILICON_FIRST_YEAR) return false;
  const texts = [
    model?.name,
    model?.line,
    model?.identifier,
    ...(sku
      ? [sku.name, sku.variantLabel, ...Object.values(sku.axisValues ?? {})]
      : (model?.axes ?? []).flatMap((a) => a.values)),
  ];
  return texts.some(namesAppleSilicon);
}

/**
 * Which reading a machine STARTS on (owner ask 2026-09-15).
 *
 * *"Generally the M chips are battery health, AND model is 2021 and above, it
 * should be battery health."* So health for Apple silicon whatever its year —
 * a 2020 M1 shows a health percentage like every M-series Mac after it — and
 * health for anything released in 2021 or later; cycles for the rest, which
 * is the Intel machines of 2020 and before. An unknown year with no chip in
 * sight is health, for the reason `batteryEra` gives.
 *
 * A default, not a verdict. The machine can be switched where its battery is
 * entered, and a machine that HAS a reading is read the way it was recorded —
 * see `batteryModeOf`.
 */
export function defaultBatteryMode(
  model: BatteryModelFacts | undefined,
  sku?: BatterySkuFacts,
): BatteryMode {
  return isAppleSilicon(model, sku) ? "HEALTH" : batteryEra(model?.releaseYear);
}

/** The reading fields a `Unit` carries. */
export interface BatteryReadings {
  readonly batteryHealth?: number | null;
  readonly cycleCount?: number | null;
  readonly fcc?: number | null;
}

const isReading = (v: number | null | undefined): v is number =>
  v != null && Number.isFinite(v);

/**
 * The reading a unit's own numbers are in, or `null` when they do not say.
 *
 * A percentage and no count is a health machine; a count or a capacity and no
 * percentage is a cycles machine. Nothing recorded says nothing — and neither
 * does both, which is a row from before the switch (typed before 2026-09-08,
 * or imported) that the default has to decide between.
 */
export function recordedBatteryMode(unit: BatteryReadings): BatteryMode | null {
  const health = isReading(unit.batteryHealth);
  const cycles = isReading(unit.cycleCount) || isReading(unit.fcc);
  if (health === cycles) return null;
  return health ? "HEALTH" : "CYCLES";
}

/**
 * How one machine's battery is read: the way it was recorded, else its default.
 *
 * The recording wins because it is a fact about the machine and the default is
 * a guess about its model. Somebody switched a 2019 Pro to health because that
 * Pro showed them a percentage; reading its 91% back as "— cycles" would lose
 * the reading on the very screen it was typed into.
 */
export function batteryModeOf(
  unit: BatteryReadings,
  fallback: BatteryMode,
): BatteryMode {
  return recordedBatteryMode(unit) ?? fallback;
}

/**
 * The bounds of a cycle count.
 *
 * Zero is a real reading — a battery replaced last week — and the ceiling is
 * deliberately generous: Apple rates modern Macs at 1000 cycles, older ones at
 * 300 or 500, and a machine that has been through 1400 exists and is exactly
 * the machine this column is for. 5000 is where a reading stops being a
 * battery and starts being a slipped digit.
 */
export const CYCLE_COUNT_MIN = 0;
export const CYCLE_COUNT_MAX = 5000;

/** Full charge capacity, in mAh, as System Information prints it. */
export const FCC_MIN = 0;
export const FCC_MAX = 20000;

export function isCycleCountInRange(cc: number | null | undefined): boolean {
  if (cc == null) return true;
  return Number.isFinite(cc) && cc >= CYCLE_COUNT_MIN && cc <= CYCLE_COUNT_MAX;
}

export function isFccInRange(fcc: number | null | undefined): boolean {
  if (fcc == null) return true;
  return Number.isFinite(fcc) && fcc >= FCC_MIN && fcc <= FCC_MAX;
}

/**
 * The cycle-count thresholds, which run the OTHER WAY from the health ones.
 *
 * Fewer cycles is a better battery, so these are ceilings where the health
 * pair are floors: good is at or below `goodMax`, fair is at or below
 * `fairMax`, and anything above `fairMax` is poor. Two numbers again rather
 * than three ranges, for the reason the health thresholds are two — see this
 * file's header. The same shape stops a Settings screen from having to explain
 * two different kinds of number.
 */
export interface CycleThresholds {
  /** At or below this is good. */
  readonly goodMax: number;
  /** At or below this — but above `goodMax` — is fair. */
  readonly fairMax: number;
}

/**
 * Defaults, from the rating the machines themselves carry.
 *
 * A 2015–2020 Mac is rated for 1000 cycles, so 400 is well inside its designed
 * life and 800 is the last stretch of it. A shop that finds these wrong for the
 * models it actually buys moves them in Settings, exactly as it does the
 * health pair.
 */
export const DEFAULT_CYCLE_THRESHOLDS: CycleThresholds = {
  goodMax: 400,
  fairMax: 800,
};

/**
 * Which band a cycle count falls in, or `null` when nobody has read one.
 *
 * Same contract as `batteryGrade`, sentinel included: a missing reading is
 * "not measured" and is never folded into the worst band, and a reading
 * outside the range is not a reading at all.
 */
export function cycleGrade(
  cc: number | null | undefined,
  thresholds: CycleThresholds = DEFAULT_CYCLE_THRESHOLDS,
): BatteryGrade | null {
  if (cc == null || !Number.isFinite(cc)) return null;
  if (!isCycleCountInRange(cc)) return null;
  if (cc <= thresholds.goodMax) return "good";
  if (cc <= thresholds.fairMax) return "fair";
  return "bad";
}

/** The three cycle bands, in the order a facet should list them. */
export function cycleBands(
  thresholds: CycleThresholds = DEFAULT_CYCLE_THRESHOLDS,
): readonly { grade: BatteryGrade; label: string }[] {
  const { goodMax, fairMax } = thresholds;
  return [
    { grade: "good", label: `Good (${goodMax} cycles or fewer)` },
    {
      grade: "fair",
      label:
        fairMax > goodMax + 1
          ? `Fair (${goodMax + 1}–${fairMax} cycles)`
          : `Fair (${fairMax} cycles)`,
    },
    { grade: "bad", label: `Poor (over ${fairMax} cycles)` },
  ];
}

/**
 * Everything one machine's battery says, whichever reading it is in.
 *
 * One shape for both, so a column, a filter and a QC field ask the store once
 * and branch on `mode` rather than each deciding for itself which fields to
 * read. `grade` is comparable across the two — a good 2017 battery and a good
 * 2023 battery are both `"good"` — which is what lets Inventory keep ONE
 * battery facet over a mixed shelf.
 */
export interface BatteryReading {
  /** Which reading this is: what the unit recorded, else its default. */
  readonly mode: BatteryMode;
  /** HEALTH only. */
  readonly health?: number;
  /** CYCLES only. */
  readonly cycleCount?: number;
  /** CYCLES only, in mAh. Not banded — it is context for the count. */
  readonly fcc?: number;
  /** The band, comparable across readings, or null when nothing was measured. */
  readonly grade: BatteryGrade | null;
  /** What the cell prints: `91%`, `312 cycles`, or an em dash. */
  readonly text: string;
}

/** Both sets of thresholds, as one argument. */
export interface BatterySettings {
  readonly health: BatteryThresholds;
  readonly cycles: CycleThresholds;
}

export const DEFAULT_BATTERY_SETTINGS: BatterySettings = {
  health: DEFAULT_BATTERY_THRESHOLDS,
  cycles: DEFAULT_CYCLE_THRESHOLDS,
};

/**
 * Read one machine's battery, in whichever reading it was recorded in.
 *
 * `fallback` is the machine's default — `defaultBatteryMode` — and decides only
 * where the unit's own numbers do not (`batteryModeOf`). A release year is
 * still accepted in its place, read through `batteryEra`, for callers written
 * before 2026-09-15; it cannot see a chip, so it opens a 2020 M1 with no
 * reading on the wrong one.
 *
 * What sits in the other reading's fields is ignored, not promoted: a legacy
 * row carrying both is shown in its default reading and nothing else.
 */
export function readBattery(
  unit: BatteryReadings,
  fallback: BatteryMode | number | null | undefined,
  settings: BatterySettings = DEFAULT_BATTERY_SETTINGS,
): BatteryReading {
  const mode = batteryModeOf(
    unit,
    typeof fallback === "string" ? fallback : batteryEra(fallback),
  );
  if (mode === "CYCLES") {
    const cc = unit.cycleCount ?? undefined;
    const fcc = unit.fcc ?? undefined;
    return {
      mode,
      ...(cc === undefined ? {} : { cycleCount: cc }),
      ...(fcc === undefined ? {} : { fcc }),
      grade: cycleGrade(cc, settings.cycles),
      text: fmtCycleCount(cc),
    };
  }
  const health = unit.batteryHealth ?? undefined;
  return {
    mode,
    ...(health === undefined ? {} : { health }),
    grade: batteryGrade(health, settings.health),
    text: fmtBatteryHealth(health),
  };
}

/** The cell: `312 cycles`, or an em dash. Never a bare `0` for no reading. */
export function fmtCycleCount(cc: number | null | undefined): string {
  if (cc == null || !Number.isFinite(cc)) return "—";
  return `${cc.toLocaleString("id-ID")} cycles`;
}

/** The cell: `4.312 mAh`, or an em dash. */
export function fmtFcc(fcc: number | null | undefined): string {
  if (fcc == null || !Number.isFinite(fcc)) return "—";
  return `${fcc.toLocaleString("id-ID")} mAh`;
}

/**
 * The band label a reading falls in, across both readings.
 *
 * ONE facet over a mixed shelf, which is why the label is the band's NAME
 * rather than its numbers: a filter offering "Good (80%+)" and "Good (400
 * cycles or fewer)" as two separate options would split every search over a
 * shop that sells both. The numbers still appear — in the column guide, and in
 * Settings where they are set.
 */
export const BATTERY_BAND_LABEL: Record<BatteryGrade, string> = {
  good: "Good",
  fair: "Fair",
  bad: "Poor",
};

export function batteryBandOf(reading: BatteryReading): string {
  return reading.grade === null
    ? BATTERY_UNKNOWN
    : BATTERY_BAND_LABEL[reading.grade];
}

/** Both threshold pairs as the mock database holds them. */
export function batterySettingsFrom(settings: {
  batteryGoodMin?: number;
  batteryFairMin?: number;
  cycleGoodMax?: number;
  cycleFairMax?: number;
}): BatterySettings {
  const goodMax = settings.cycleGoodMax ?? DEFAULT_CYCLE_THRESHOLDS.goodMax;
  const fairMax = settings.cycleFairMax ?? DEFAULT_CYCLE_THRESHOLDS.fairMax;
  return {
    health: thresholdsFrom(settings),
    // A fair ceiling below the good one would leave the fair band empty and
    // the labels nonsense — the mirror of the clamp in `thresholdsFrom`.
    cycles: { goodMax, fairMax: Math.max(fairMax, goodMax) },
  };
}

/**
 * The `?` guide beside the battery column: the rule, the switch, both bands.
 *
 * Takes `t` because it is copy on an Indonesian screen, and this file imports
 * nothing — the caller already holds one.
 */
export function batteryEraGuide(
  settings: BatterySettings,
  t: (
    key: string,
    defaultValue: string,
    vars?: Record<string, unknown>,
  ) => string,
): string {
  const { goodMin, fairMin } = settings.health;
  const { goodMax, fairMax } = settings.cycles;
  return t(
    "battery.guide",
    "Apple silicon Macs and any model from 2021 on start on battery health; older machines start on cycle count and full charge capacity, and any machine can be switched where its battery is entered. Health: good is {{goodMin}}% and above, fair is {{fairMin}}–{{fairTop}}%, poor is under {{fairMin}}%. Cycles: good is {{goodMax}} or fewer, fair is up to {{fairMax}}, poor is above that. Blank means nobody has measured it yet.",
    { goodMin, fairMin, fairTop: goodMin - 1, goodMax, fairMax },
  );
}

/** The three numbers a battery can be recorded in. */
export type BatteryField = "health" | "cycleCount" | "fcc";

/**
 * What a battery editor holds for one machine before it is committed.
 *
 * Three optional numbers rather than one, because the reading decides which of
 * them the person is even shown — and `null` in any of them is a box somebody
 * EMPTIED, which is not the same fact as a field nobody has touched. The
 * distinction is what lets a commit tell "clear this reading" from "leave what
 * the store holds".
 */
export interface BatteryDraft {
  /**
   * The reading this machine was switched to (2026-09-15), or absent when
   * nobody has switched it — the draft's own numbers, then the machine's
   * default, decide then. See `batteryDraftMode`.
   */
  readonly mode?: BatteryMode;
  readonly health?: number | null;
  readonly cycleCount?: number | null;
  readonly fcc?: number | null;
}

/**
 * Which reading a draft is in: the switch, else its numbers, else the default.
 *
 * The order a stored unit is read in (`batteryModeOf`) with the person's
 * choice in front, so the boxes on screen and the fields `batteryPatch` writes
 * are always the same boxes.
 */
export function batteryDraftMode(
  draft: BatteryDraft,
  fallback: BatteryMode,
): BatteryMode {
  return (
    draft.mode ??
    batteryModeOf(
      {
        batteryHealth: draft.health,
        cycleCount: draft.cycleCount,
        fcc: draft.fcc,
      },
      fallback,
    )
  );
}

/** Every field a reading asks for, so an editor can render and validate one list. */
export const BATTERY_FIELDS: Record<BatteryMode, readonly BatteryField[]> = {
  HEALTH: ["health"],
  CYCLES: ["cycleCount", "fcc"],
};

/** The bounds of one field, for the message that names them. */
export const BATTERY_FIELD_RANGE: Record<
  BatteryField,
  readonly [number, number]
> = {
  health: [BATTERY_HEALTH_MIN, BATTERY_HEALTH_MAX],
  cycleCount: [CYCLE_COUNT_MIN, CYCLE_COUNT_MAX],
  fcc: [FCC_MIN, FCC_MAX],
};

/** Is one box's number one somebody could have read off a machine? */
export function isBatteryFieldInRange(
  field: BatteryField,
  value: number | null | undefined,
): boolean {
  if (field === "health") return isBatteryHealthInRange(value);
  if (field === "cycleCount") return isCycleCountInRange(value);
  return isFccInRange(value);
}

/**
 * Is every number in a draft one somebody could have read off a machine?
 *
 * Checks only the fields of the draft's own reading. The other reading's
 * values are not judged because they are not shown: a machine carrying an old
 * out-of-range count would otherwise be refused by a form that is showing its
 * health box and offers nowhere to fix the count.
 */
export function isBatteryDraftInRange(
  draft: BatteryDraft,
  fallback: BatteryMode,
): boolean {
  return BATTERY_FIELDS[batteryDraftMode(draft, fallback)].every((field) =>
    isBatteryFieldInRange(field, draft[field]),
  );
}

/**
 * What a unit already holds, as a draft — the starting point of an edit.
 *
 * The recorded reading is pinned as the draft's `mode`, so emptying a box to
 * retype it does not flip the editor to the machine's default halfway through.
 * Nothing recorded pins nothing, and the default decides.
 */
export function batteryDraftOf(unit: BatteryReadings): BatteryDraft {
  const recorded = recordedBatteryMode(unit);
  return {
    ...(recorded === null ? {} : { mode: recorded }),
    health: unit.batteryHealth ?? null,
    cycleCount: unit.cycleCount ?? null,
    fcc: unit.fcc ?? null,
  };
}

/**
 * A draft as the three columns a `Unit` carries.
 *
 * Writes the draft's reading (`batteryDraftMode`) and clears the other one —
 * one battery, one set of numbers — which is how a machine switched from
 * cycles to health stops reporting a count nobody can check against it.
 *
 * Except when the chosen reading is EMPTY, and that exception is the point:
 * then the other reading is passed through as the draft holds it. Flicking the
 * switch and leaving the new boxes blank records nothing, and a switch that
 * records nothing must not have erased the reading somebody took. Emptying the
 * boxes that hold the numbers is how numbers are cleared.
 *
 * Out-of-range values are dropped for the same reason `identify` drops them: a
 * refusal that never reached the store must not arrive by another door.
 */
export function batteryPatch(
  draft: BatteryDraft,
  fallback: BatteryMode,
): { batteryHealth?: number; cycleCount?: number; fcc?: number } {
  const keep = (field: BatteryField) => {
    const v = draft[field];
    return v == null || !isBatteryFieldInRange(field, v) ? undefined : v;
  };
  const all = {
    batteryHealth: keep("health"),
    cycleCount: keep("cycleCount"),
    fcc: keep("fcc"),
  };
  if (batteryDraftMode(draft, fallback) === "HEALTH") {
    return all.batteryHealth === undefined
      ? all
      : {
          batteryHealth: all.batteryHealth,
          cycleCount: undefined,
          fcc: undefined,
        };
  }
  return all.cycleCount === undefined && all.fcc === undefined
    ? all
    : { batteryHealth: undefined, cycleCount: all.cycleCount, fcc: all.fcc };
}

/** The minimum a catalogue has to expose for a battery to know its default. */
export interface BatteryCatalogue {
  readonly skus: readonly ({
    readonly id: string;
    readonly modelId: string;
  } & BatterySkuFacts)[];
  readonly models: readonly ({ readonly id: string } & BatteryModelFacts)[];
}

/** The release year behind a SKU, or undefined when the catalogue is missing it. */
export function releaseYearOfSku(
  cat: BatteryCatalogue,
  skuId: string,
): number | undefined {
  const sku = cat.skus.find((s) => s.id === skuId);
  const model = sku && cat.models.find((m) => m.id === sku.modelId);
  return model?.releaseYear ?? undefined;
}

/** The reading a SKU's machines start on, resolved through the catalogue. */
export function defaultBatteryModeOfSku(
  cat: BatteryCatalogue,
  skuId: string,
): BatteryMode {
  const sku = cat.skus.find((s) => s.id === skuId);
  const model = sku && cat.models.find((m) => m.id === sku.modelId);
  return defaultBatteryMode(model, sku);
}

/** How one stored machine is read: its recording, else its SKU's default. */
export function batteryModeOfUnit(
  unit: BatteryReadings & { readonly skuId: string },
  cat: BatteryCatalogue,
): BatteryMode {
  return batteryModeOf(unit, defaultBatteryModeOfSku(cat, unit.skuId));
}

/**
 * One machine's battery, its default resolved through the catalogue.
 *
 * The convenience every screen wants: a page holds a unit and the catalogue,
 * and asking it to walk sku → model → chip and year in each of five columns is
 * five chances to walk it differently. Structural parameters rather than the
 * store's own types, so this file still imports nothing.
 */
export function readUnitBattery(
  unit: BatteryReadings & { readonly skuId: string },
  cat: BatteryCatalogue,
  settings: BatterySettings = DEFAULT_BATTERY_SETTINGS,
): BatteryReading {
  return readBattery(unit, defaultBatteryModeOfSku(cat, unit.skuId), settings);
}
