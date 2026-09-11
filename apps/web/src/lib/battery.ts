/**
 * A battery: how it is recorded, how it prints, and how it filters.
 *
 * ## Two eras (owner ask 2026-09-08)
 *
 * A Mac released in **2020 or earlier** is recorded as a **cycle count** and a
 * **full charge capacity**; **2021 and later** as a **health percentage**. That
 * is not a change of mind about which number is better — it is a change of
 * question, because the two kinds of machine tell you different things. See
 * `BATTERY_CYCLE_ERA_MAX_YEAR` at the foot of this file for why, and
 * `readBattery` for the one function every column and filter goes through.
 *
 * Everything above that divider is the health half, unchanged. The cycle half
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

/* ────────────────────────────────────────────────────────────────────────────
 * Two eras of battery reading (owner ask 2026-09-08)
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * The last model year whose battery is recorded as cycles rather than health.
 *
 * The owner's rule: *"if the release year of the device is 2020 and earlier,
 * the battery health is tracked by cc (cycle count) and fcc (full charging
 * capacity), while the other model (2021 and above) is tracked by battery
 * health"*. Inclusive — a 2020 machine is a cycles machine.
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
 * So each era is recorded in the units its own machines actually report, and
 * `batteryEra` is the one place that decides which.
 */
export const BATTERY_CYCLE_ERA_MAX_YEAR = 2020;

/** Which pair of numbers a machine's battery is described by. */
export type BatteryEra =
  /** Cycle count and full charge capacity — 2020 and earlier. */
  | "CYCLES"
  /** A health percentage — 2021 and later. */
  | "HEALTH";

/**
 * Which era a model belongs to, from its release year.
 *
 * An unknown year answers `HEALTH`, and the choice is deliberate: a product
 * with no year is almost always something new enough that nobody bothered to
 * type one, and health is the reading the bench takes without thinking. The
 * cost of guessing wrong is one field asking for a number the machine does not
 * show, which the QC grid recovers from — the other direction would ask for
 * two.
 */
export function batteryEra(releaseYear: number | null | undefined): BatteryEra {
  if (releaseYear == null || !Number.isFinite(releaseYear)) return "HEALTH";
  return releaseYear <= BATTERY_CYCLE_ERA_MAX_YEAR ? "CYCLES" : "HEALTH";
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
 * Everything one machine's battery says, whichever era it belongs to.
 *
 * One shape for both, so a column, a filter and a QC field ask the store once
 * and branch on `era` rather than each deciding for itself which fields to
 * read. `grade` is comparable across the two — a good 2017 battery and a good
 * 2023 battery are both `"good"` — which is what lets Inventory keep ONE
 * battery facet over a mixed shelf.
 */
export interface BatteryReading {
  readonly era: BatteryEra;
  /** HEALTH era only. */
  readonly health?: number;
  /** CYCLES era only. */
  readonly cycleCount?: number;
  /** CYCLES era only, in mAh. Not banded — it is context for the count. */
  readonly fcc?: number;
  /** The band, comparable across eras, or null when nothing was measured. */
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
 * Read one machine's battery, in whichever units its era uses.
 *
 * The era comes from the MODEL and not from which fields happen to be filled
 * in, and that ordering matters: a 2017 machine carrying a stray health
 * percentage (typed before this split existed, or imported) is still a cycles
 * machine, and reporting it as `91%` would show a figure the bench cannot
 * check against the machine in front of it. What is off-era is ignored, not
 * promoted.
 */
export function readBattery(
  unit: {
    readonly batteryHealth?: number | null;
    readonly cycleCount?: number | null;
    readonly fcc?: number | null;
  },
  releaseYear: number | null | undefined,
  settings: BatterySettings = DEFAULT_BATTERY_SETTINGS,
): BatteryReading {
  const era = batteryEra(releaseYear);
  if (era === "CYCLES") {
    const cc = unit.cycleCount ?? undefined;
    const fcc = unit.fcc ?? undefined;
    return {
      era,
      ...(cc === undefined ? {} : { cycleCount: cc }),
      ...(fcc === undefined ? {} : { fcc }),
      grade: cycleGrade(cc, settings.cycles),
      text: fmtCycleCount(cc),
    };
  }
  const health = unit.batteryHealth ?? undefined;
  return {
    era,
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
 * The band label a reading falls in, across both eras.
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

/** The `?` guide beside the battery column, for both eras at once. */
export function batteryEraGuide(
  settings: BatterySettings = DEFAULT_BATTERY_SETTINGS,
): string {
  const { goodMin, fairMin } = settings.health;
  const { goodMax, fairMax } = settings.cycles;
  return (
    `How a battery is recorded depends on the model's release year. ` +
    `${BATTERY_CYCLE_ERA_MAX_YEAR} and earlier: cycle count and full charge ` +
    `capacity, where good is ${goodMax} cycles or fewer, fair is up to ` +
    `${fairMax}, and poor is above that. ` +
    `${BATTERY_CYCLE_ERA_MAX_YEAR + 1} and later: battery health, where good ` +
    `is ${goodMin}% and above, fair is ${fairMin}–${goodMin - 1}%, and poor ` +
    `is under ${fairMin}%. Blank means nobody has measured it yet.`
  );
}

/**
 * What the QC grid holds for one row before it is committed.
 *
 * Three optional numbers rather than one, because a row's era decides which of
 * them the bench is even shown — and `null` in any of them is a box somebody
 * EMPTIED, which is not the same fact as a field nobody has touched. The
 * distinction is what lets a commit tell "clear this reading" from "leave what
 * the store holds".
 */
export interface BatteryDraft {
  readonly health?: number | null;
  readonly cycleCount?: number | null;
  readonly fcc?: number | null;
}

/** Every field an era asks for, so a grid can render and validate one list. */
export const BATTERY_FIELDS: Record<
  BatteryEra,
  readonly (keyof BatteryDraft)[]
> = {
  HEALTH: ["health"],
  CYCLES: ["cycleCount", "fcc"],
};

/**
 * Is every number in a draft one somebody could have read off a machine?
 *
 * Checks only the fields the era asks for. An off-era value is not judged
 * because it is not shown: a 2017 machine carrying an old percentage would
 * otherwise be refused by a form that never offered anywhere to fix it.
 */
export function isBatteryDraftInRange(
  draft: BatteryDraft,
  era: BatteryEra,
): boolean {
  if (era === "HEALTH") return isBatteryHealthInRange(draft.health);
  return isCycleCountInRange(draft.cycleCount) && isFccInRange(draft.fcc);
}

/** The bounds of one field, for the message that names them. */
export const BATTERY_FIELD_RANGE: Record<
  keyof BatteryDraft,
  readonly [number, number]
> = {
  health: [BATTERY_HEALTH_MIN, BATTERY_HEALTH_MAX],
  cycleCount: [CYCLE_COUNT_MIN, CYCLE_COUNT_MAX],
  fcc: [FCC_MIN, FCC_MAX],
};

/** What a unit already holds, as a draft — the starting point of an edit. */
export function batteryDraftOf(unit: {
  readonly batteryHealth?: number;
  readonly cycleCount?: number;
  readonly fcc?: number;
}): BatteryDraft {
  return {
    health: unit.batteryHealth ?? null,
    cycleCount: unit.cycleCount ?? null,
    fcc: unit.fcc ?? null,
  };
}

/**
 * A draft as the three columns a `Unit` carries, for whichever era applies.
 *
 * The off-era fields come back `undefined`, which is how a machine that
 * changes era — a model's release year corrected — stops reporting a number
 * nobody can check against it. Out-of-range values are dropped for the same
 * reason `identify` drops them: a refusal that never reached the store must
 * not arrive by another door.
 */
export function batteryPatch(
  draft: BatteryDraft,
  era: BatteryEra,
): { batteryHealth?: number; cycleCount?: number; fcc?: number } {
  const keep = (v: number | null | undefined, ok: boolean) =>
    v == null || !ok ? undefined : v;
  if (era === "HEALTH") {
    return {
      batteryHealth: keep(draft.health, isBatteryHealthInRange(draft.health)),
      cycleCount: undefined,
      fcc: undefined,
    };
  }
  return {
    batteryHealth: undefined,
    cycleCount: keep(draft.cycleCount, isCycleCountInRange(draft.cycleCount)),
    fcc: keep(draft.fcc, isFccInRange(draft.fcc)),
  };
}

/** The minimum a catalogue has to expose for a battery to know its era. */
export interface BatteryCatalogue {
  readonly skus: readonly { readonly id: string; readonly modelId: string }[];
  readonly models: readonly {
    readonly id: string;
    readonly releaseYear?: number;
  }[];
}

/** The release year behind a SKU, or undefined when the catalogue is missing it. */
export function releaseYearOfSku(
  cat: BatteryCatalogue,
  skuId: string,
): number | undefined {
  const sku = cat.skus.find((s) => s.id === skuId);
  const model = sku && cat.models.find((m) => m.id === sku.modelId);
  return model?.releaseYear;
}

/**
 * One machine's battery, era resolved through the catalogue.
 *
 * The convenience every screen wants: a page holds a unit and the catalogue,
 * and asking it to walk sku → model → year in each of five columns is five
 * chances to walk it differently. Structural parameters rather than the store's
 * own types, so this file still imports nothing.
 */
export function readUnitBattery(
  unit: {
    readonly skuId: string;
    readonly batteryHealth?: number;
    readonly cycleCount?: number;
    readonly fcc?: number;
  },
  cat: BatteryCatalogue,
  settings: BatterySettings = DEFAULT_BATTERY_SETTINGS,
): BatteryReading {
  return readBattery(unit, releaseYearOfSku(cat, unit.skuId), settings);
}
