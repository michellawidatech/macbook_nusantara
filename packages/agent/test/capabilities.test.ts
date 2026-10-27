/**
 * The switch between the 2026-09-18 bot and the 2026-09-21 one.
 *
 * Owner ask, 2026-09-21: *"make sure like the chatbot can send pictures per
 * unit and get detail about a unit, and the only write operation is to make a
 * reservation. But the bot should actually focus more on how to get to know
 * the user like be more proactive, ask questions to determine intent, and
 * upselling a product."*
 *
 * What these pin is the BOUNDARY, not the wording: which messages still reach
 * a person whatever the capability, and which stop doing so when it is on.
 * `policy.test.ts` still holds the parallel-operation rules, unchanged —
 * they are what `AGENT_CAPABILITIES=parallel` means (unset is the POS as the
 * source of truth since 2026-10-27).
 */
import { describe, expect, it } from "vitest";
import {
  agentCapabilities,
  capabilitiesFromSettings,
  LIVE_CAPABILITIES,
  PARALLEL_CAPABILITIES,
  SHOP_CAPABILITIES,
  routeMessage,
} from "../src/policy.js";
import { buildAgentPrompt } from "../src/prompt.js";

const live = (text: string, hasMedia = false) =>
  routeMessage(text, { capabilities: LIVE_CAPABILITIES, hasMedia });
const parallel = (text: string) =>
  routeMessage(text, { capabilities: PARALLEL_CAPABILITIES });

describe("what the bot may answer once it can read the shelf", () => {
  it("answers stock, price and condition itself", () => {
    // Every one of these went to a person under the 2026-09-18 design, and
    // policy.test.ts still says so for the default capability.
    for (const text of [
      "air m1 ready ga kak?",
      "macbook pro 13 2020 harganya berapa?",
      "kondisi air m2 gimana kak, ada lecet?",
      "minta foto air m1 dong",
      "battery health nya berapa persen?",
      "budget 10 juta dapat apa ya?",
    ]) {
      expect(live(text), text).toBeNull();
      expect(parallel(text), text).not.toBeNull();
    }
  });

  it("books a visit itself, and never a hold (2026-10-27)", () => {
    expect(live("mau booking datang besok jam 3 kak")).toBeNull();
    // Keeping a unit is a DP, and a DP is a person's: a closing task,
    // whatever the switches say.
    expect(live("bisa di keep dulu ga kak?")).toMatchObject({
      topic: "closing",
      rule: "keep",
    });
    expect(parallel("bisa di keep dulu ga kak?")).toMatchObject({
      topic: "closing",
    });
  });
});

describe("what still goes to a person, capability or not", () => {
  it("sends negotiation to a person even with the price in front of it", () => {
    // A discount is the owner's to give. A bot that can see the price is one
    // message away from discounting it.
    expect(live("air m1 bisa nego ga kak?")).toMatchObject({
      topic: "negotiation",
    });
  });

  it("sends a payment already made to a person", () => {
    expect(live("kak sudah transfer ya, ini buktinya")).toMatchObject({
      topic: "order_payment",
    });
  });

  it("sends a photo the CUSTOMER sent to a person", () => {
    /*
     * The `photos` capability is about the shop SENDING its own pictures. A
     * picture coming the other way is a transfer slip, a cracked screen or a
     * machine somebody wants valued, and every one of those needs eyes.
     */
    expect(live("", true)).toMatchObject({ topic: "media" });
  });
});

describe("agentCapabilities", () => {
  it("reads live, and parallel", () => {
    expect(agentCapabilities({ AGENT_CAPABILITIES: "live" })).toEqual(
      LIVE_CAPABILITIES,
    );
    expect(agentCapabilities({ AGENT_CAPABILITIES: " LIVE " })).toEqual(
      LIVE_CAPABILITIES,
    );
    expect(agentCapabilities({ AGENT_CAPABILITIES: "parallel" })).toEqual(
      PARALLEL_CAPABILITIES,
    );
  });

  it("makes the POS the source of truth when unset (2026-10-27)", () => {
    // The shelf in this database is the shop's real shelf now: stock, price
    // and photos are on unless the owner switched one off — and bookings,
    // since a bot booking is a visit that holds nothing (2026-10-27).
    for (const env of [
      {},
      { AGENT_CAPABILITIES: "" },
      { AGENT_CAPABILITIES: "liv" },
    ]) {
      expect(agentCapabilities(env)).toEqual(SHOP_CAPABILITIES);
    }
    expect(SHOP_CAPABILITIES).toEqual({
      stock: true,
      price: true,
      reserve: true,
      photos: true,
    });
  });

  it("lets a switch the owner pressed win over the default", () => {
    expect(
      capabilitiesFromSettings(
        [
          { key: "chatbot.price", value: "false" },
          { key: "chatbot.reservation", value: "true" },
        ],
        agentCapabilities({}),
      ),
    ).toEqual({ stock: true, price: false, reserve: true, photos: true });
  });
});

describe("the prompt follows the capability", () => {
  const base = {
    persona: "You are the admin.",
    storeFacts: "Open 10.00 to 20.00.",
    knowledge: "APPROVED ANSWERS\n\nK1 Garansi 1 bulan.",
    corrections: [],
    now: new Date("2026-09-21T10:00:00+07:00"),
    openNow: true,
  };

  it("tells the parallel bot it cannot see stock", () => {
    const { stable } = buildAgentPrompt(base);
    expect(stable).toContain("nobody can see today's stock");
    expect(stable).not.toContain('cite "stock"');
  });

  it("tells the live bot to look before it speaks, and to sell", () => {
    const { stable } = buildAgentPrompt({
      ...base,
      capabilities: LIVE_CAPABILITIES,
    });
    expect(stable).toContain('cite "stock"');
    expect(stable).toContain("Look before you speak");
    expect(stable).toContain("Get to know them");
    expect(stable).toContain("ONE step up");
    expect(stable).toContain("Recommend ONE first");
    // The sales strategy (2026-10-27): one first, honest urgency, a next
    // step, a visit that holds nothing, and a person for the close — and it
    // reads like WhatsApp, not a spec sheet.
    expect(stable).toContain("Never a list");
    expect(stable).toContain('Never "8GB · 256GB grade A"');
    expect(stable).toContain("Wanting to buy is NOT closing");
    expect(stable).toContain('cites "greeting". Small talk');
    expect(stable).toContain('"tinggal 1 unit kak"');
    expect(stable).toContain("Mau lihat");
    expect(stable).toContain("It books and holds NOTHING");
    expect(stable).toContain("a REQUEST a colleague approves");
    expect(stable).toContain("topic closing");
    // The booking lifecycle, said in the rules as well as enforced in `toolsFor`.
    expect(stable).toContain(
      "file, check, move and cancel THIS customer's own booking",
    );
    expect(stable).not.toContain("nobody can see today's stock");
  });

  it("keeps the grounding rule identical on both sides", () => {
    // The rule that makes the whole design safe: a figure the cited source
    // does not state is never sent. Relaxing what the bot may LOOK AT must not
    // relax what it may SAY.
    for (const capabilities of [PARALLEL_CAPABILITIES, LIVE_CAPABILITIES]) {
      expect(buildAgentPrompt({ ...base, capabilities }).stable).toContain(
        "Never state a price, an amount, a stock level",
      );
    }
  });
});
