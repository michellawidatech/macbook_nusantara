/**
 * Where a price list story puts things (design E, owner 2026-11-17) —
 * `lib/priceStoryLayout.ts`. Measured with a fixed-width fake, so a cut name
 * or a dropped column is decided here and not on a phone.
 */
import { describe, expect, it } from "vitest";
import {
  LIST,
  LIST_ROOM,
  STORY_H,
  STORY_W,
  cardHeight,
  fit,
  layoutStory,
  wrap,
  type Measure,
  type StoryOp,
} from "../src/lib/priceStoryLayout.js";
import {
  defaultStoryTexts,
  paginate,
  type StoryGroup,
  type StoryLine,
} from "../src/lib/priceStory.js";

const measure: Measure = (text, size) => text.length * size * 0.5;
const texts = defaultStoryTexts(new Date(2026, 10, 17), {
  whatsapp: "0858-8842-9991",
});

const line = (over: Partial<StoryLine> = {}): StoryLine => ({
  skuId: "s1",
  spec: "8GB | 256GB",
  lo: 9_499_000,
  hi: 10_299_000,
  qty: 2,
  allNew: false,
  isNew: false,
  ...over,
});

/** Every text op, flattened out of clips. */
function words(ops: readonly StoryOp[]): Extract<StoryOp, { kind: "text" }>[] {
  return ops.flatMap((o) =>
    o.kind === "text" ? [o] : o.kind === "clip" ? words(o.ops) : [],
  );
}

describe("layoutStory", () => {
  it("draws every row's price, struck before price and NEW tag", () => {
    const groups: StoryGroup[] = [
      {
        name: 'MacBook Air 13" M1',
        rows: [
          line({ before: 11_999_000 }),
          line({ skuId: "s2", lo: 11_299_000, hi: 11_299_000, isNew: true }),
        ],
      },
    ];
    const t = words(layoutStory(groups, texts, 1, 1, measure));
    const text = t.map((x) => x.text);
    expect(text).toContain('MacBook Air 13" M1');
    expect(text).toContain("Rp 9.499.000 – 10.299.000");
    expect(text).toContain("Rp 11.299.000");
    expect(t.find((x) => x.text === "Rp 11.999.000")!.strike).toBe(true);
    expect(text).toContain("NEW");
    expect(text).toContain("8GB");
    // One page: no page number.
    expect(text.some((s) => s.startsWith("Halaman"))).toBe(false);
  });

  it("prints every word staff typed, and leaves out an emptied one", () => {
    const own = {
      ...texts,
      promo: "SALE 11.11",
      titleTop: "Harga",
      titleBottom: "Spesial.",
      subtitle: "Cuma minggu ini",
      chips: "Cicilan 0%, Garansi 3 bulan",
      listTitle: "Stok terbaru",
      instagram: "",
      location: "BSD",
    };
    const text = words(layoutStory([], own, 1, 1, measure)).map((x) => x.text);
    for (const w of [
      "SALE 11.11",
      "Harga",
      "Spesial.",
      "Cuma minggu ini",
      "Cicilan 0%",
      "Garansi 3 bulan",
      "Stok terbaru",
      "BSD",
      "0858-8842-9991",
    ])
      expect(text).toContain(w);
    expect(text).not.toContain("macbooknusantara");
  });

  it("numbers the pages when there is more than one", () => {
    const text = words(layoutStory([], texts, 2, 3, measure)).map(
      (x) => x.text,
    );
    expect(text).toContain("Halaman 2 / 3");
  });

  it("cuts a product name too long for its card", () => {
    const long =
      "MacBook Pro 13 inch 2020 Four Thunderbolt 3 Ports Edition Space Gray";
    const t = words(
      layoutStory([{ name: long, rows: [line()] }], texts, 1, 1, measure),
    );
    const name = t.find((x) => x.size === 28 && x.weight === 700)!;
    expect(name.text.endsWith("…")).toBe(true);
    expect(measure(name.text, 28, 700)).toBeLessThanOrEqual(984 - 56);
  });

  it("keeps a full page of cards inside the poster, above the footer", () => {
    const many: StoryGroup[] = Array.from({ length: 12 }, (_, i) => ({
      name: `P${i}`,
      rows: [line({ skuId: `a${i}` }), line({ skuId: `b${i}` })],
    }));
    const pages = paginate(many, LIST_ROOM, LIST.gap, cardHeight);
    expect(pages.length).toBeGreaterThan(1);
    for (const [i, p] of pages.entries()) {
      const ops = layoutStory(p, texts, i + 1, pages.length, measure);
      for (const o of ops) {
        if (o.kind !== "rect" || o.w === STORY_W) continue;
        expect(o.x).toBeGreaterThanOrEqual(0);
        expect(o.x + o.w).toBeLessThanOrEqual(STORY_W);
        expect(o.y + o.h).toBeLessThanOrEqual(STORY_H);
        if (o.r === 28) expect(o.y + o.h).toBeLessThanOrEqual(LIST.bottom);
      }
    }
  });
});

describe("fit and wrap", () => {
  it("leaves short text alone and cuts long text with an ellipsis", () => {
    expect(fit("abc", 100, 10, 400, measure)).toBe("abc");
    const cut = fit("abcdefghijklmnop", 50, 10, 400, measure);
    expect(cut.endsWith("…")).toBe(true);
    expect(measure(cut, 10, 400)).toBeLessThanOrEqual(50);
  });

  it("wraps to the lines allowed and cuts what is left", () => {
    const lines = wrap(
      "one two three four five six seven",
      60,
      10,
      400,
      measure,
      2,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("one two");
    expect(lines[1]!.endsWith("…")).toBe(true);
    expect(wrap("short", 60, 10, 400, measure, 2)).toEqual(["short"]);
    expect(wrap("", 60, 10, 400, measure, 2)).toEqual([]);
  });
});
