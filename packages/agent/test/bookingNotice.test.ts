/**
 * A booking the bot made is told to the customer, whatever became of the
 * reply (audit 2026-09-29).
 *
 * The booking — a visit since 2026-10-27, holding nothing — is its own
 * transaction, committed mid-turn. Before this, a reply
 * refused afterwards — a figure its source did not state, a turn out of steps
 * — sent only the generic holding line, and the customer never heard the code
 * of the visit booked for them.
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@nusantara/db";

vi.mock("@nusantara/db", async (original) => ({
  ...(await original<typeof import("@nusantara/db")>()),
  createVisit: async () => ({
    id: "r1",
    code: "RV-2026/09-000007",
    scheduledFor: new Date("2026-09-30T08:00:00.000Z"),
  }),
}));

const { converse } = await import("../src/converse.js");
const { knowledgeBase } = await import("../src/knowledge.js");
const { LIVE_CAPABILITIES } = await import("../src/policy.js");
const { calls, noDb, replies, scriptedClient } = await import("./fixtures.js");

const NOW = new Date("2026-09-29T04:00:00.000Z");
const fakeWrite = {
  unit: { findMany: async () => [] },
  $transaction: (fn: (tx: unknown) => unknown) =>
    fn({ reservationProposal: { create: async () => ({ id: "p1" }) } }),
} as unknown as PrismaClient;

function run(script: Parameters<typeof scriptedClient>[0]) {
  return converse({
    client: scriptedClient(script).client,
    db: noDb as unknown as PrismaClient,
    ctx: {
      from: "628123",
      now: NOW,
      reserve: { write: fakeWrite, staffId: "agent", graceMs: 4 * 3_600_000 },
      writesUsed: new Set(),
    },
    prompt: { stable: "S", volatile: "V" },
    turns: [{ role: "user", text: "mau lihat air m1 nya besok jam 3 ya" }],
    knowledge: knowledgeBase([]),
    storeFacts: "Buka 10.00-20.00",
    capabilities: LIVE_CAPABILITIES,
  });
}

describe("a booking the bot made", () => {
  it("is announced when the reply that would have announced it is refused", async () => {
    const result = await run([
      calls("book_visit", {
        when: "2026-09-30T15:00",
        serials: "C02AIRM1",
      }),
      // A figure no source gave: refused, and the turn goes to a person.
      replies("Siap kak, sudah di-keep, DP Rp500.000 ya", "greeting"),
    ]);
    expect(result?.handoff?.forcedBy).toBe("AMOUNT_NOT_IN_SOURCE");
    expect(result?.reply).toContain("RV-2026/09-000007");
    expect(result?.handoff?.summary).toContain("RV-2026/09-000007");
    expect(result?.bookings).toEqual([
      expect.objectContaining({
        tool: "book_visit",
        code: "RV-2026/09-000007",
      }),
    ]);
  });

  it("is added to a reply that forgot to mention it", async () => {
    const result = await run([
      calls("book_visit", {
        when: "2026-09-30T15:00",
        serials: "C02AIRM1",
      }),
      replies("Siap kak, ditunggu besok ya 😊", "greeting"),
    ]);
    expect(result?.handoff).toBeUndefined();
    expect(result?.reply).toMatch(/RV-2026\/09-000007[\s\S]*ditunggu besok/);
  });

  it("is not repeated when the reply already carries the code", async () => {
    const result = await run([
      calls("book_visit", {
        when: "2026-09-30T15:00",
        serials: "C02AIRM1",
      }),
      replies("Siap kak, kode booking RV-2026/09-000007 ya 😊", "greeting"),
    ]);
    expect(result?.reply.match(/RV-2026\/09-000007/g)).toHaveLength(1);
  });
});
