/**
 * The day's price list (owner ask 2026-11-10): "boleh lihat pricelist hari
 * ini gak" is answered from the shelf by code, filtered to what was asked
 * for, and never with the whole shop.
 */
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@nusantara/db";
import {
  asksPriceList,
  priceListAsk,
  routeMessage,
  SHOP_CAPABILITIES,
} from "../src/index.js";
import { priceListTurn } from "../src/rules/run.js";
import type { ToolContext } from "../src/tools.js";

describe("asksPriceList", () => {
  it.each([
    "boleh lihat pricelist hari ini gak",
    "kak minta price list macbook air",
    "ada list harga ipad?",
    "daftar harganya dong",
    "harga list mbp berapa",
  ])("hears %s", (t) => expect(asksPriceList(t)).toBe(true));
  it.each([
    "harga air m2 berapa?",
    "ada macbook pro m1?",
    "listrik di toko aman?",
  ])("leaves %s alone", (t) => expect(asksPriceList(t)).toBe(false));
});

describe("priceListAsk", () => {
  it("narrows to the line, chip and size named", () => {
    expect(priceListAsk("pricelist macbook air dong")).toEqual({
      query: "macbook air",
      label: "MacBook Air",
    });
    expect(priceListAsk("pricelist mbp m1 pro 14 inch")).toEqual({
      query: "macbook pro m1 pro 14",
      label: 'MacBook Pro 14" M1 Pro',
    });
    expect(priceListAsk("list harga ipad")).toEqual({
      query: "ipad",
      label: "iPad",
    });
    expect(priceListAsk("pricelist m2")).toEqual({
      query: "macbook m2",
      label: "MacBook M2",
    });
  });
  it("names nothing when nothing was named, and never reads a budget as a size", () => {
    expect(priceListAsk("boleh lihat pricelist hari ini gak").query).toBe("");
    expect(priceListAsk("pricelist air budget 15 juta").query).toBe("air");
  });
  it("is not routed to a person", () => {
    expect(
      routeMessage("boleh lihat pricelist hari ini gak", {
        capabilities: SHOP_CAPABILITIES,
      }),
    ).toBeNull();
  });
});

const ctx: ToolContext = {
  from: "6281200000000",
  now: new Date("2026-11-10T03:00:00Z"),
  writesUsed: new Set<string>(),
};
const db = {} as PrismaClient;

function stub(out: Record<string, unknown>) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    dispatch: async (_name: string, args: unknown) => {
      calls.push(args as Record<string, unknown>);
      return out;
    },
  };
}

describe("priceListTurn", () => {
  it("sends the asked-for line's list, lowest – highest, friendly", async () => {
    const s = stub({
      lines: [
        {
          product: 'MacBook Air 13" M1',
          variant: "8/256",
          min: "9200000",
          max: "10120000",
        },
        {
          product: 'MacBook Air 13" M2',
          variant: "8/256",
          min: "12500000",
          max: "12500000",
        },
      ],
      categories: [],
    });
    const r = await priceListTurn({
      db,
      ctx,
      text: "kak boleh lihat pricelist macbook air hari ini gak",
      capabilities: SHOP_CAPABILITIES,
      dispatch: s.dispatch,
    });
    expect(s.calls[0]).toEqual({ query: "macbook air" });
    expect(r!.reply).toContain(
      "Siap kak, ini pricelist MacBook Air hari ini (10 November 2026) ya:",
    );
    expect(r!.reply).toContain(
      'MacBook Air 13" M1\n• 8/256: Rp 9.200.000 – Rp 10.120.000',
    );
    expect(r!.reply).toContain("• 8/256: Rp 12.500.000");
    expect(r!.reply).toContain("Mau aku bantu pilihin");
    expect(r!.usedAi).toBe(false);
  });

  it("asks which line when none was named, instead of sending everything", async () => {
    const s = stub({
      lines: [],
      categories: ["MacBook Air", "MacBook Pro", "iPad"],
    });
    const r = await priceListTurn({
      db,
      ctx,
      text: "boleh lihat pricelist hari ini gak",
      capabilities: SHOP_CAPABILITIES,
      dispatch: s.dispatch,
    });
    expect(s.calls[0]).toEqual({ query: "" });
    expect(r!.reply).toBe(
      "Siap kak, mau pricelist yang mana nih? Hari ini ada MacBook Air, MacBook Pro atau iPad, nanti aku kirimin yang itu ya",
    );
  });

  it("says when the line is empty, and passes a budget on", async () => {
    const s = stub({ lines: [], categories: [] });
    const r = await priceListTurn({
      db,
      ctx,
      text: "pricelist ipad budget 5jt",
      capabilities: SHOP_CAPABILITIES,
      dispatch: s.dispatch,
    });
    expect(s.calls[0]).toMatchObject({ query: "ipad", maxPrice: 5_000_000 });
    expect(r!.reply).toContain(
      "Maaf kak, iPad sampai Rp5jt lagi kosong hari ini",
    );
  });

  it("leaves the turn alone with the price switch off, or for another question", async () => {
    const s = stub({ lines: [], categories: [] });
    expect(
      await priceListTurn({
        db,
        ctx,
        text: "pricelist air",
        capabilities: { ...SHOP_CAPABILITIES, price: false },
        dispatch: s.dispatch,
      }),
    ).toBeNull();
    expect(
      await priceListTurn({
        db,
        ctx,
        text: "air m2 ada?",
        capabilities: SHOP_CAPABILITIES,
        dispatch: s.dispatch,
      }),
    ).toBeNull();
    expect(s.calls).toHaveLength(0);
  });
});
