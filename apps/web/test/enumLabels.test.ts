import { describe, expect, it } from "vitest";
import {
  labelOf,
  tagOf,
  ORDER_SOURCE,
  ORDER_SOURCE_PHRASE,
  RESERVATION_STATUS,
  UNIT_EVENT,
  UNIT_STATUS,
} from "../src/i18n/enumLabels.js";
import { CATALOGUES } from "../src/i18n/catalogue.js";
import { makeT } from "../src/i18n/translate.js";

const PLAIN = [UNIT_EVENT, ORDER_SOURCE, ORDER_SOURCE_PHRASE];
const TAGGED = [UNIT_STATUS, RESERVATION_STATUS];

describe("a hold's status, in both vocabularies", () => {
  /**
   * The bug this pins: `/reservations` rendered "Tidak dikenal" on every
   * status tag — the hold's and each machine's — for three days, because the
   * page fed the SCHEMA's spelling to a map that only knew the STORE's.
   *
   * `tagOf` was right to refuse: an unmapped SCREAMING_CASE token is "Unknown"
   * rather than a colour borrowed from a status it might have been. What was
   * missing was coverage, and coverage is a thing a test can hold.
   */
  const SCHEMA = ["TERJADWAL", "SELESAI", "BATAL"] as const;
  const STORE = ["ACTIVE", "DONE", "CANCELLED"] as const;

  it("names every value either side can hand it", () => {
    for (const v of [...SCHEMA, ...STORE]) {
      expect(tagOf(RESERVATION_STATUS, v).label, v).not.toBe("Unknown");
    }
  });

  it("says the same thing in both, so a migration cannot change the words", () => {
    SCHEMA.forEach((schema, i) => {
      expect(tagOf(RESERVATION_STATUS, schema)).toEqual(
        tagOf(RESERVATION_STATUS, STORE[i]!),
      );
    });
  });
});

describe("enum labels", () => {
  it("never lets a SCREAMING_CASE token through as its own label", () => {
    const labels = [
      ...PLAIN.flatMap((m) => Object.values(m)),
      ...TAGGED.flatMap((m) => Object.values(m).map((v) => v.label)),
    ];
    for (const label of labels) {
      expect(label, `"${label}" is still a token`).not.toMatch(
        /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/,
      );
    }
  });

  it("has Indonesian for every label that reaches a screen", () => {
    // The faktur is excluded from the language switch, so ORDER_SOURCE's brand
    // names are allowed to fall through to English — see enumLabels.ts.
    // Tokopedia and TikTok joined them on 2026-08-26; this list is the one
    // place that has to grow when the shop adds a marketplace, which is why
    // this test caught them.
    const brands = new Set([
      "Shopee",
      "Tokopedia",
      "TikTok",
      "Instagram",
      "WhatsApp",
    ]);
    const labels = [
      ...Object.values(UNIT_EVENT),
      ...Object.values(ORDER_SOURCE),
      ...TAGGED.flatMap((m) => Object.values(m).map((v) => v.label)),
    ].filter((l) => !brands.has(l));
    for (const label of labels) {
      expect(CATALOGUES.id[label], `missing id for "${label}"`).toBeTypeOf(
        "string",
      );
    }
  });
});

describe("the fallback", () => {
  it("translates a value it knows", () => {
    expect(labelOf(UNIT_EVENT, "TERJUAL", makeT("id"))).toBe("Terjual");
    expect(tagOf(UNIT_STATUS, "TERSEDIA", makeT("id"))).toEqual({
      label: "Tersedia",
      color: "green",
    });
  });

  it("leaves English alone when given no t — the faktur's path", () => {
    expect(labelOf(ORDER_SOURCE, "SHOPEE")).toBe("Shopee");
    expect(labelOf(ORDER_SOURCE, "OFFLINE")).toBe("In store");
  });

  // The bug this module exists to prevent: staff seeing the database's own
  // vocabulary.
  it("says Unknown for an enum member no map has been taught", () => {
    expect(labelOf(UNIT_STATUS as never, "DIKARANTINA")).toBe("Unknown");
    expect(labelOf(UNIT_EVENT, "OPNAME_BARU", makeT("id"))).toBe(
      "Tidak dikenal",
    );
  });

  it("gives an unknown status neutral grey, never a colour that means something", () => {
    const { color, label } = tagOf(UNIT_STATUS, "DIKARANTINA");
    expect(label).toBe("Unknown");
    expect(color).toBe("default");
  });

  // Absent and unrecognised are different facts and get different copy.
  it("says None for an absent value", () => {
    expect(labelOf(UNIT_EVENT, null)).toBe("None");
    expect(labelOf(UNIT_EVENT, undefined)).toBe("None");
    expect(labelOf(UNIT_EVENT, "")).toBe("None");
    expect(tagOf(UNIT_STATUS, null).label).toBe("None");
  });

  it("passes through text that is already human", () => {
    expect(labelOf(UNIT_EVENT, "Refurbished by Andi")).toBe(
      "Refurbished by Andi",
    );
  });
});
