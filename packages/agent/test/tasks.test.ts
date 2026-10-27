/**
 * What a hand-over leaves a person to do — one short action item (owner,
 * 2026-10-27: *"Need …" — short and concise, action items*). Pure.
 */
import { describe, expect, it } from "vitest";
import {
  TASK_NEED,
  dpDecisionTask,
  dpVerifyTask,
  routeSummary,
  closingTask,
  heldReplyTask,
  jakartaVisitLabel,
  notifyTask,
  shortRupiah,
  welcomeTask,
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

describe("the sales tasks (2026-10-27)", () => {
  it("writes a closing task the way the owner wrote one", () => {
    expect(
      closingTask({
        name: "Budi",
        wants: "buy",
        unit: "Air M2 8/256",
        price: "Rp 9.500.000",
        how: "mau COD Sabtu",
        text: "oke kak saya ambil",
      }),
    ).toBe(
      'Perlu closing — Budi siap ambil Air M2 8/256 Rp 9,5jt, mau COD Sabtu\n"oke kak saya ambil"',
    );
    expect(
      closingTask({ name: null, wants: "keep", unit: null, text: "" }),
    ).toBe("Perlu closing — Pelanggan minta unit di-keep (DP)");
  });

  it("writes the welcome and the restock tasks", () => {
    expect(
      welcomeTask({ name: "Budi", when: "Sabtu 14.00", unit: "Air M2" }),
    ).toBe("Perlu sambut — Budi datang Sabtu 14.00 lihat Air M2");
    expect(notifyTask({ name: "Budi", unit: "Air M3 16/512" })).toBe(
      "Perlu kabari — Air M3 16/512 sudah ready, Budi minta dikabari",
    );
  });

  it("reads a visit in the shop's words and a price in its shorthand", () => {
    // Saturday 17 October 2026, 14:00 Jakarta.
    expect(jakartaVisitLabel(new Date("2026-10-17T07:00:00.000Z"))).toBe(
      "Sabtu 14.00",
    );
    expect(shortRupiah("Rp 11.900.000")).toBe("Rp 11,9jt");
    expect(shortRupiah(9_000_000)).toBe("Rp 9jt");
    expect(shortRupiah(450_000)).toBe("Rp 450rb");
    expect(shortRupiah(null)).toBe("");
  });

  it("names the job a closing hand-over leaves", () => {
    expect(TASK_NEED.closing).toBe("Perlu closing");
    expect(routedTask("closing", "cara bayarnya gimana?")).toBe(
      'Perlu closing\n"cara bayarnya gimana?"',
    );
  });
});

describe("the DP tasks (2026-10-27)", () => {
  it("asks a person to verify a DP the customer says they paid", () => {
    expect(
      dpVerifyTask({
        name: "Budi",
        amount: 500_000,
        unit: "Air M2 8/256",
        text: "sudah tf dp ya kak",
      }),
    ).toBe(
      'Perlu verifikasi DP — Budi kirim bukti transfer Rp 500rb untuk Air M2 8/256\n"sudah tf dp ya kak"',
    );
    expect(
      dpVerifyTask({ name: null, amount: null, unit: null, text: "" }),
    ).toBe("Perlu verifikasi DP — Pelanggan kirim bukti transfer");
    expect(
      routeSummary(
        { topic: "order_payment", rule: "dp_proof" },
        "bukti dp 500rb",
        "Rina",
      ),
    ).toMatch(/^Perlu verifikasi DP — Rina kirim bukti transfer Rp 500rb/);
    // Any other route is the ordinary routed task.
    expect(
      routeSummary(
        { topic: "order_payment", rule: "order_payment" },
        "sudah transfer",
      ),
    ).toMatch(/^Perlu cek pembayaran/);
  });

  it("asks a person to refund or keep a DP whose hold ran out", () => {
    expect(
      dpDecisionTask({ name: "Budi", unit: "Air M2", amount: 500_000n }),
    ).toBe(
      "Perlu putuskan DP — Budi tidak melunasi Air M2, DP Rp 500rb: kembalikan atau hangus?",
    );
    expect(dpDecisionTask({ name: null, unit: null, amount: "500000" })).toBe(
      "Perlu putuskan DP — Pelanggan tidak melunasi unitnya, DP Rp 500rb: kembalikan atau hangus?",
    );
  });
});
