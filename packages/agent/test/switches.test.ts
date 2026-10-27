/**
 * The four switches on /chat, and the grounding fixes of the 2026-09-29
 * audit (owner ask the same day).
 *
 * Pure: policy.ts and the fact reader in converse.ts, no database, no model.
 */
import { describe, expect, it } from "vitest";
import {
  LIVE_CAPABILITIES,
  PARALLEL_CAPABILITIES,
  actionKindOf,
  capabilitiesFromSettings,
  checkReply,
  effectiveCapabilities,
  parseAskPrice,
  routeMessage,
  type AgentCapabilities,
  type StockFact,
} from "../src/policy.js";
import { stockFactsOf } from "../src/converse.js";

const withSwitches = (over: Partial<AgentCapabilities>) => ({
  ...LIVE_CAPABILITIES,
  ...over,
});
const route = (text: string, over: Partial<AgentCapabilities> = {}) =>
  routeMessage(text, { capabilities: withSwitches(over) });

describe("each switch decides its own kind of question", () => {
  it("sends a price question to a person when Price is off", () => {
    expect(
      route("air m1 harganya berapa kak?", { price: false }),
    ).toMatchObject({
      topic: "price",
    });
    expect(route("air m1 harganya berapa kak?")).toBeNull();
  });

  it("sends a photo request to a person when Photos is off", () => {
    expect(route("minta foto air m2 dong", { photos: false })).toMatchObject({
      topic: "photos",
    });
    expect(route("minta foto air m2 dong")).toBeNull();
  });

  it("sends booking, moving and cancelling to a person when Reservations is off", () => {
    for (const text of [
      "mau booking datang besok kak",
      "kak booking saya batalin aja",
      "bisa reschedule jadi besok?",
    ]) {
      expect(route(text, { reserve: false }), text).toMatchObject({
        topic: "reservation",
      });
    }
    // With the switch on the bot handles the lifecycle itself.
    expect(route("kak booking saya batalin aja")).toBeNull();
  });

  it("treats an offer as negotiation, with every switch on", () => {
    for (const text of [
      "air m1 bisa nego ga kak?",
      "kalau 7jt boleh kak?",
      "7,5jt aja ya kak",
      "bisa 7.200.000?",
    ]) {
      expect(route(text), text).toMatchObject({ topic: "negotiation" });
    }
    // A budget is a request to pick, not an offer on a unit.
    expect(route("budget 10 juta dapat apa ya?")).toBeNull();
  });

  it("turns price, bookings and photos off with Stock", () => {
    expect(
      effectiveCapabilities({
        stock: false,
        price: true,
        reserve: true,
        photos: true,
      }),
    ).toEqual(PARALLEL_CAPABILITIES);
  });
});

describe("the switches as stored", () => {
  it("reads a row over the environment, and the environment for a missing row", () => {
    const caps = capabilitiesFromSettings(
      [
        { key: "chatbot.stock", value: "true" },
        { key: "chatbot.photos", value: "false" },
      ],
      { stock: false, price: true, reserve: true, photos: true },
    );
    expect(caps).toEqual({
      stock: true,
      price: true,
      reserve: true,
      photos: false,
    });
  });

  it("falls back on a value it does not recognise", () => {
    const caps = capabilitiesFromSettings(
      [{ key: "chatbot.stock", value: "yes" }],
      PARALLEL_CAPABILITIES,
    );
    expect(caps.stock).toBe(false);
  });
});

describe("the grounding check against what the shelf said (audit 2026-09-29)", () => {
  const m1: StockFact = {
    label: "MacBook Air M1 8/256",
    available: true,
    prices: ["7500000"],
  };
  const m2: StockFact = {
    label: "MacBook Air M2 8/256",
    available: true,
    prices: ["11000000"],
  };
  const check = (
    message: string,
    stockFacts: StockFact[],
    sourceTexts: string[] = [],
  ) =>
    checkReply({
      message,
      sourceCount: 1,
      unknownSources: 0,
      sourceTexts,
      stockFacts,
    });

  it("refuses 'ready' about a unit the lookup said was NOT available", () => {
    // The old check matched the word "available" inside {"available": false}.
    const gone: StockFact = { ...m1, available: false };
    expect(check("Air M1 nya ready kak 😊", [gone])).toBe(
      "AVAILABILITY_NOT_IN_SOURCE",
    );
    expect(check("Air M1 nya ready kak 😊", [m1])).toBeNull();
  });

  it("refuses 'ada' beside a named unit the shelf did not show", () => {
    expect(check("Ada kak Air M3 16/512 nya", [m1])).toBe(
      "AVAILABILITY_NOT_IN_SOURCE",
    );
    expect(check("Ada kak Air M3 16/512 nya", [], ["Buka 10.00-20.00"])).toBe(
      "AVAILABILITY_NOT_IN_SOURCE",
    );
    // "Ada" as yes, about nothing in particular, is not a stock claim.
    expect(check("Ada kak, COD bisa 😊", [], ["COD bisa"])).toBeNull();
    // Nor is what a model comes in.
    expect(check("Air M2 ada varian 8/256 kak", [], ["catalog"])).toBeNull();
  });

  it("refuses one unit's price quoted for another", () => {
    expect(check("Air M1 harganya Rp11.000.000 kak", [m1, m2])).toBe(
      "AMOUNT_NOT_IN_SOURCE",
    );
    expect(check("Air M1 harganya Rp7.500.000 kak", [m1, m2])).toBeNull();
    // A list, each price beside its own unit.
    expect(
      check("Ada Air M1 Rp7.500.000 dan Air M2 Rp11.000.000 kak", [m1, m2]),
    ).toBeNull();
    // The unit named after the figure.
    expect(check("Rp7.500.000 untuk Air M1 ya kak", [m1, m2])).toBeNull();
    expect(check("Rp11.000.000 untuk Air M1 ya kak", [m1, m2])).toBe(
      "AMOUNT_NOT_IN_SOURCE",
    );
  });

  it("refuses the price of a unit that is not available", () => {
    expect(check("Air M1 Rp7.500.000 kak", [{ ...m1, available: false }])).toBe(
      "AMOUNT_NOT_IN_SOURCE",
    );
  });

  it("checks a figure written without separators, and in juta", () => {
    expect(check("Air M1 7500000 kak", [m2])).toBe("AMOUNT_NOT_IN_SOURCE");
    expect(check("Air M1 7,5jt kak", [m1])).toBeNull();
    expect(check("Air M1 7,5jt kak", [m2])).toBe("AMOUNT_NOT_IN_SOURCE");
  });
});

describe("reading the shelf's answers as facts", () => {
  it("keeps an unavailable unit unavailable", () => {
    const facts = stockFactsOf("check_serial", {
      found: true,
      serial: "C02X",
      model: "MacBook Air M1",
      available: false,
      note: "This unit is not available.",
    });
    expect(facts).toEqual([
      { label: "MacBook Air M1", available: false, prices: [] },
    ]);
  });

  it("reads each unit's price from a search", () => {
    const facts = stockFactsOf("search_stock", {
      units: [
        {
          serial: "A",
          model: "MacBook Air M1",
          variant: "8/256",
          price: "Rp 7.500.000",
        },
        { serial: "B", model: "MacBook Air M2", price: null },
      ],
    });
    expect(facts).toEqual([
      { label: "MacBook Air M1 8/256", available: true, prices: ["7500000"] },
      { label: "MacBook Air M2", available: true, prices: [] },
    ]);
  });
});

describe("the customer's offer", () => {
  it("reads the figure they want to pay", () => {
    expect(parseAskPrice("kalau 7jt boleh kak?")).toBe(7_000_000n);
    expect(parseAskPrice("7,5jt aja ya")).toBe(7_500_000n);
    expect(parseAskPrice("bisa Rp 7.200.000?")).toBe(7_200_000n);
    expect(parseAskPrice("7500000 deal?")).toBe(7_500_000n);
  });

  it("ignores numbers that are not money", () => {
    expect(parseAskPrice("air m1 8/256 bisa nego?")).toBeNull();
    expect(parseAskPrice("kirim 2 hari ya, 7jt aja")).toBe(7_000_000n);
  });
});

describe("the action item a hand-over leaves", () => {
  it("groups topics into one task per kind", () => {
    expect(actionKindOf("negotiation")).toBe("NEGOTIATION");
    expect(actionKindOf("price")).toBe("PRICE");
    expect(actionKindOf("unit_details")).toBe("STOCK");
    expect(actionKindOf("photos")).toBe("PHOTOS");
    expect(actionKindOf("complaint")).toBe("OTHER");
  });
});
