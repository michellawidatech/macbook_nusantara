/**
 * What a hand-over leaves a person to do — one short action item (owner,
 * 2026-10-27: *"Need …" — short and concise, action items*). Pure.
 */
import { describe, expect, it } from "vitest";
import {
  TASK_NEED,
  heldReplyTask,
  routedTask,
  saidColleagueWillReply,
  taskNote,
  unitSubject,
} from "../src/index.js";

describe("the unit a message names, as a colleague writes it", () => {
  it("reads line, size, chip and configuration", () => {
    expect(unitSubject("air 15 m2 8/256 harganya berapa kak?")).toBe(
      'Air 15" M2 8/256',
    );
    expect(unitSubject("macbook pro 14 m3 pro 18/512")).toBe(
      'MacBook Pro 14" M3 Pro 18/512',
    );
    expect(unitSubject("ada imac 2019 512gb?")).toBe("iMac 512GB 2019");
    expect(unitSubject("garansinya berapa lama?")).toBeNull();
  });
});

describe("the task line", () => {
  it("is the job, the unit and the customer's words, short", () => {
    expect(routedTask("price", "air 15 m2 8/256 harganya berapa kak?")).toBe(
      'Perlu cek harga — Air 15" M2 8/256\n"air 15 m2 8/256 harganya berapa kak?"',
    );
    const long = "kak ".repeat(80);
    const quoted = taskNote("reply", null, long).split("\n")[1]!;
    expect(quoted.length).toBeLessThanOrEqual(122);
    expect(quoted.endsWith('…"')).toBe(true);
    expect(taskNote("photos")).toBe(TASK_NEED.photos);
  });

  it("turns every refused draft into a job, never a code", () => {
    const draft = "Air M2 15 nya Rp17.500.000 kak";
    const cases = {
      AMOUNT_NOT_IN_SOURCE: ["price", 'Perlu cek harga — Air 15" M2'],
      AVAILABILITY_NOT_IN_SOURCE: ["stock", 'Perlu cek stok — Air 15" M2'],
      NO_SOURCE: ["other", "Perlu dibalas — tidak ada sumber untuk jawabannya"],
      UNKNOWN_SOURCE: [
        "other",
        "Perlu dibalas — sumber jawabannya tidak dikenal",
      ],
      TOO_LONG: ["other", "Perlu dibalas — draf terlalu panjang"],
    } as const;
    for (const [problem, [topic, head]] of Object.entries(cases)) {
      const t = heldReplyTask(
        problem as keyof typeof cases,
        draft,
        "air 15 m2 berapa kak?",
      );
      expect(t.topic, problem).toBe(topic);
      expect(t.summary.split("\n")[0], problem).toBe(head);
      // The held draft, quoted on its own line.
      expect(t.summary.split("\n")[1], problem).toBe(`"${draft}"`);
      expect(t.summary, problem).not.toMatch(/[A-Z]{2,}_[A-Z]/);
    }
  });

  it("names the job without a unit when nobody named one", () => {
    expect(
      heldReplyTask("AMOUNT_NOT_IN_SOURCE", "Ongkirnya Rp50.000 kak", "ongkir?")
        .summary,
    ).toBe(
      'Perlu cek harga — angka di draf tidak ada sumbernya\n"Ongkirnya Rp50.000 kak"',
    );
  });
});

describe("has the customer been told a colleague will reply", () => {
  it("reads the holding line and the still-waiting line", () => {
    expect(
      saidColleagueWillReply("Admin kami segera balas di chat ini ya kak 🙏"),
    ).toBe(true);
    expect(
      saidColleagueWillReply("Untuk harganya tadi masih dicek tim kami ya kak"),
    ).toBe(true);
    expect(saidColleagueWillReply("Ada kak 😊 Ini yang ready")).toBe(false);
    expect(saidColleagueWillReply(null)).toBe(false);
  });
});

describe("the prompt names what is waiting for a colleague", () => {
  it("in the per-thread half, so the cache still hits", async () => {
    const { buildAgentPrompt, SHOP_CAPABILITIES } =
      await import("../src/index.js");
    const base = {
      persona: "You are the admin.",
      storeFacts: "Open 10.00 to 20.00.",
      knowledge: "",
      corrections: [],
      now: new Date("2026-10-27T03:00:00Z"),
      openNow: true,
      capabilities: SHOP_CAPABILITIES,
    };
    const p = buildAgentPrompt({
      ...base,
      waiting: [{ topic: "negotiation", text: "kalau 7jt boleh?" }],
    });
    expect(p.volatile).toContain("WAITING FOR A COLLEAGUE");
    expect(p.volatile).toContain('negotiation: "kalau 7jt boleh?"');
    expect(p.volatile).toContain("Do not answer these");
    expect(p.volatile).toContain("Do not repeat that the admin will reply");
    expect(p.stable).toBe(buildAgentPrompt(base).stable);
    expect(buildAgentPrompt(base).volatile).not.toContain("WAITING");
  });
});
