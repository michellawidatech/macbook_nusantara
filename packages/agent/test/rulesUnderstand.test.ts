/**
 * The rule-based reader (owner, 2026-10-15: AI only where rules cannot do
 * it). Sentences in this shop's customers' own style.
 */

import { describe, expect, it } from "vitest";
import { understand, visitTimeOf, nameOf } from "../src/rules/understand.js";

/** Thursday 15 October 2026, 10:00 in Jakarta. */
const NOW = new Date("2026-10-15T03:00:00.000Z");
const fresh = { proposalOpen: false, lastShown: [] as string[] };
const read = (text: string, ctx = fresh) => understand(text, NOW, ctx);

describe("intent", () => {
  it.each([
    ["halo kak", "greeting"],
    ["P", "greeting"],
    ["selamat siang min", "greeting"],
    ["makasih kak", "thanks"],
    ["kak ada macbook pro 16 m3?", "ask_stock"],
    ["macbook air m2 256", "ask_stock"],
    ["ready mba m1 8/256?", "ask_stock"],
    ["budget 15jt dapet apa ya kak", "browse"],
    ["rekomendasi laptop buat kuliah dong", "browse"],
    ["air m2 harganya berapa?", "ask_price"],
    ["minta fotonya kak", "ask_photo"],
    ["besok jam 2 saya ke toko ya", "reserve"],
    ["bisa booking unitnya?", "reserve"],
    ["garansi berapa lama?", "other"],
  ])("%s → %s", (text, intent) => {
    expect(read(text).intent).toBe(intent);
  });

  it("reads a yes or a no only while a proposal is open", () => {
    const open = { proposalOpen: true, lastShown: [] };
    expect(read("iya betul kak", open).intent).toBe("confirm");
    expect(read("ok", open).intent).toBe("confirm");
    expect(read("gak jadi deh kak", open).intent).toBe("decline");
    expect(read("iya betul kak").intent).not.toBe("confirm");
  });

  it("asks the price of what was just shown", () => {
    expect(read("yang kedua berapa?", { proposalOpen: false, lastShown: ["A", "B"] })).toMatchObject({
      intent: "ask_price",
      pick: 1,
    });
  });
});

describe("what it pulls out", () => {
  it("builds a shelf search in the shop's words", () => {
    expect(read("kak ada MBP 16 M3 Pro 18/512?").query).toBe(
      "macbook pro m3 pro 16 18/512",
    );
    expect(read("mba m1 2020").query).toBe("macbook air m1 2020");
  });

  it("reads a budget as a range", () => {
    expect(read("budget 15jt").budgetMax).toBe(15_000_000);
    expect(read("budget 15jt").budgetMin).toBe(15_000_000);
    expect(read("di bawah 20 juta ada macbook?")).toMatchObject({
      budgetMin: null,
      budgetMax: 20_000_000,
    });
    expect(read("budget 12-15jt")).toMatchObject({
      budgetMin: 12_000_000,
      budgetMax: 15_000_000,
    });
  });

  it("does not read a spec or a serial as money", () => {
    expect(read("air m2 8/256").budgetMax).toBeNull();
    expect(read("serial C02XK1JDJG5H").budgetMax).toBeNull();
  });

  it("finds a serial", () => {
    expect(read("cek unit C02XK1JDJG5H dong").serial).toBe("C02XK1JDJG5H");
  });

  it("collects what they do, the apps and what they prefer", () => {
    const u = read(
      "aku mahasiswa DKV, butuh buat desain pake photoshop sama figma, maunya yang baru dan ringan",
    );
    expect(u.occupation).toBe("student (university)");
    expect(u.usage).toEqual(expect.arrayContaining(["design", "school"]));
    expect(u.apps).toEqual(expect.arrayContaining(["Photoshop", "Figma"]));
    expect(u.preferences).toEqual(expect.arrayContaining(["new", "light"]));
  });

  it("detects English", () => {
    expect(read("hi, do you have a macbook air m2?").language).toBe("en");
    expect(read("kak ada macbook air m2?").language).toBe("id");
  });
});

describe("a visit time", () => {
  it.each([
    ["besok jam 2", "2026-10-16T14:00"],
    ["hari ini jam 15.30", "2026-10-15T15:30"],
    ["lusa jam 11", "2026-10-17T11:00"],
    ["sabtu jam 1 siang", "2026-10-17T13:00"],
    ["senin jam 10", "2026-10-19T10:00"],
    ["20/10 jam 16:00", "2026-10-20T16:00"],
  ])("%s → %s", (text, when) => {
    expect(visitTimeOf(text, NOW)).toBe(when);
  });

  it("is null with no clock in it", () => {
    expect(visitTimeOf("besok ya kak", NOW)).toBeNull();
  });
});

describe("a name", () => {
  it.each([
    ["nama saya Budi", "Budi"],
    ["atas nama budi santoso jam 2", "Budi Santoso"],
    ["a.n. Rina", "Rina"],
    ["saya Andi, besok jam 3", "Andi"],
  ])("%s → %s", (text, name) => {
    expect(nameOf(text)).toBe(name);
  });

  it("is not fooled by a verb", () => {
    expect(nameOf("saya mau tanya")).toBeNull();
    expect(nameOf("aku mahasiswa")).toBeNull();
  });
});
