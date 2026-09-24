import { describe, expect, it } from "vitest";
import {
  BATTERY_UNKNOWN,
  DEFAULT_BATTERY_THRESHOLDS,
  DEFAULT_CYCLE_THRESHOLDS,
  batteryBand,
  batteryBandOf,
  batteryBands,
  batteryEra,
  batteryGrade,
  batteryGuide,
  batterySettingsFrom,
  cycleGrade,
  fmtBatteryHealth,
  isBatteryHealthInRange,
  readBattery,
} from "../src/lib/battery.js";

describe("batteryGrade", () => {
  it("uses the owner's defaults: good 80+, fair 76–79, poor under 76", () => {
    expect(batteryGrade(100)).toBe("good");
    expect(batteryGrade(80)).toBe("good");
    expect(batteryGrade(79)).toBe("fair");
    expect(batteryGrade(76)).toBe("fair");
    expect(batteryGrade(75)).toBe("bad");
    expect(batteryGrade(0)).toBe("bad");
  });

  it("treats a missing reading as unknown, not as the worst band", () => {
    // An accessory has no battery; a unit off the street may not be opened yet.
    // Folding those into "poor" would invent a fault that was never measured.
    expect(batteryGrade(undefined)).toBeNull();
    expect(batteryGrade(null)).toBeNull();
    expect(batteryGrade(Number.NaN)).toBeNull();
  });

  it("does not launder an out-of-range import into a plausible band", () => {
    expect(batteryGrade(250)).toBeNull();
    expect(batteryGrade(-5)).toBeNull();
  });

  it("reads 0 as a real measurement of a dead battery", () => {
    // The sentinel inverted when health replaced cycles: a new battery reads
    // 0 cycles but 100 percent. 0% is a reading, not a blank.
    expect(batteryGrade(0)).not.toBeNull();
    expect(fmtBatteryHealth(0)).toBe("0%");
  });

  it("follows thresholds that came from Settings", () => {
    const strict = { goodMin: 90, fairMin: 85 };
    expect(batteryGrade(88, strict)).toBe("fair");
    expect(batteryGrade(88)).toBe("good");
  });
});

describe("isBatteryHealthInRange", () => {
  it("takes every percentage a battery can actually read", () => {
    expect(isBatteryHealthInRange(0)).toBe(true);
    expect(isBatteryHealthInRange(91)).toBe(true);
    expect(isBatteryHealthInRange(100)).toBe(true);
  });

  it("refuses the typo above it — 100% is a new battery, and nothing beats new", () => {
    expect(isBatteryHealthInRange(101)).toBe(false);
    expect(isBatteryHealthInRange(150)).toBe(false);
    expect(isBatteryHealthInRange(-1)).toBe(false);
    expect(isBatteryHealthInRange(Number.NaN)).toBe(false);
  });

  it("lets an unmeasured battery through", () => {
    // Not the same fact as a bad reading: an accessory never gets one, and the
    // QC box has to be leaveable empty.
    expect(isBatteryHealthInRange(undefined)).toBe(true);
    expect(isBatteryHealthInRange(null)).toBe(true);
  });
});

describe("batteryBands", () => {
  it("tiles 0–100 exactly once, with no gap and no overlap", () => {
    const seen = new Map<string, number>();
    for (let h = 0; h <= 100; h += 1) {
      const g = batteryGrade(h);
      expect(g).not.toBeNull();
      seen.set(g!, (seen.get(g!) ?? 0) + 1);
    }
    // 0–75 poor, 76–79 fair, 80–100 good.
    expect(seen.get("bad")).toBe(76);
    expect(seen.get("fair")).toBe(4);
    expect(seen.get("good")).toBe(21);
    expect(seen.get("bad")! + seen.get("fair")! + seen.get("good")!).toBe(101);
  });

  it("builds its labels from the thresholds, not from prose", () => {
    expect(batteryBands().map((b) => b.label)).toEqual([
      "Good (80%+)",
      "Fair (76–79%)",
      "Poor (under 76%)",
    ]);
    expect(batteryBands({ goodMin: 90, fairMin: 85 })[0]?.label).toBe(
      "Good (90%+)",
    );
  });

  it("does not render a one-wide band as a range", () => {
    // "Fair (79–79%)" reads as a bug, so a single-value band says so.
    expect(batteryBands({ goodMin: 80, fairMin: 79 })[1]?.label).toBe(
      "Fair (79%)",
    );
  });
});

describe("batteryBand", () => {
  it("names the band a reading falls in", () => {
    expect(batteryBand(91)).toBe("Good (80%+)");
    expect(batteryBand(77)).toBe("Fair (76–79%)");
    expect(batteryBand(60)).toBe("Poor (under 76%)");
  });

  it("gives an unmeasured unit its own filterable bucket", () => {
    expect(batteryBand(undefined)).toBe(BATTERY_UNKNOWN);
  });
});

describe("fmtBatteryHealth", () => {
  // "None", not 0%: a missing reading is not a dead battery.
  it("prints a percentage, or None when there is no reading", () => {
    expect(fmtBatteryHealth(88)).toBe("88%");
    expect(fmtBatteryHealth(undefined)).toBe("None");
    expect(fmtBatteryHealth(null)).toBe("None");
  });
});

describe("batteryGuide", () => {
  it("states every threshold it is given, so the ? cannot go stale", () => {
    const guide = batteryGuide(DEFAULT_BATTERY_THRESHOLDS);
    expect(guide).toContain("80%");
    expect(guide).toContain("76");
    const strict = batteryGuide({ goodMin: 90, fairMin: 85 });
    expect(strict).toContain("90%");
    expect(strict).toContain("85");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The two eras (owner ask 2026-09-08)
 * ──────────────────────────────────────────────────────────────────────────*/

describe("batteryEra", () => {
  it("puts 2020 and earlier on cycles and 2021 and later on health", () => {
    expect(batteryEra(2015)).toBe("CYCLES");
    expect(batteryEra(2020)).toBe("CYCLES");
    expect(batteryEra(2021)).toBe("HEALTH");
    expect(batteryEra(2024)).toBe("HEALTH");
  });

  it("reads an unknown year as health", () => {
    // The cheaper mistake: one field asking for a number the machine does not
    // show, rather than two.
    expect(batteryEra(undefined)).toBe("HEALTH");
    expect(batteryEra(null)).toBe("HEALTH");
    expect(batteryEra(Number.NaN)).toBe("HEALTH");
  });
});

describe("cycleGrade", () => {
  it("bands on ceilings, not floors — fewer cycles is better", () => {
    expect(cycleGrade(0)).toBe("good");
    expect(cycleGrade(400)).toBe("good");
    expect(cycleGrade(401)).toBe("fair");
    expect(cycleGrade(800)).toBe("fair");
    expect(cycleGrade(801)).toBe("bad");
  });

  it("keeps 0 a reading and a missing count not one", () => {
    // The same trap as battery health, inverted: a replaced battery really
    // does read zero cycles.
    expect(cycleGrade(0)).toBe("good");
    expect(cycleGrade(undefined)).toBeNull();
    expect(cycleGrade(null)).toBeNull();
  });

  it("refuses to band a count outside the range", () => {
    expect(cycleGrade(-1)).toBeNull();
    expect(cycleGrade(50_000)).toBeNull();
  });

  it("honours thresholds it is given", () => {
    const t = { goodMax: 100, fairMax: 200 };
    expect(cycleGrade(100, t)).toBe("good");
    expect(cycleGrade(150, t)).toBe("fair");
    expect(cycleGrade(201, t)).toBe("bad");
  });
});

describe("readBattery", () => {
  const old = { batteryHealth: 91, cycleCount: 312, fcc: 4800 };

  it("reads a pre-2021 machine as cycles and ignores a stray percentage", () => {
    const r = readBattery(old, 2017);
    expect(r.mode).toBe("CYCLES");
    expect(r.cycleCount).toBe(312);
    expect(r.fcc).toBe(4800);
    expect(r.health).toBeUndefined();
    expect(r.grade).toBe("good");
    expect(r.text).toContain("cycles");
  });

  it("reads a 2021-or-later machine as health and ignores a stray count", () => {
    const r = readBattery(old, 2023);
    expect(r.mode).toBe("HEALTH");
    expect(r.health).toBe(91);
    expect(r.cycleCount).toBeUndefined();
    expect(r.grade).toBe("good");
    expect(r.text).toBe("91%");
  });

  it("says nothing was measured when nothing was", () => {
    expect(readBattery({}, 2017).grade).toBeNull();
    expect(readBattery({}, 2017).text).toBe("None");
    expect(readBattery({}, 2023).grade).toBeNull();
  });

  it("bands the two eras into one vocabulary", () => {
    // The whole reason Inventory can keep ONE battery facet over a mixed
    // shelf: a good 2017 battery and a good 2023 battery are both "Good".
    expect(batteryBandOf(readBattery({ cycleCount: 200 }, 2017))).toBe("Good");
    expect(batteryBandOf(readBattery({ batteryHealth: 95 }, 2023))).toBe(
      "Good",
    );
    expect(batteryBandOf(readBattery({}, 2017))).toBe(BATTERY_UNKNOWN);
  });
});

describe("batterySettingsFrom", () => {
  it("falls back to the defaults", () => {
    const s = batterySettingsFrom({});
    expect(s.health).toEqual(DEFAULT_BATTERY_THRESHOLDS);
    expect(s.cycles).toEqual(DEFAULT_CYCLE_THRESHOLDS);
  });

  it("clamps a fair ceiling below the good one", () => {
    // The mirror of the health clamp: the fair band must not be empty.
    expect(
      batterySettingsFrom({ cycleGoodMax: 500, cycleFairMax: 200 }).cycles,
    ).toEqual({ goodMax: 500, fairMax: 500 });
  });
});
