/**
 * Conversation state carried explicitly (plan Task 12, 2026-11-09). It used
 * to be guessed from the wording of the bot's last reply, so a booking given
 * one detail per message lost the time or the name, and a yes to "Mau aku
 * cariin yang mirip?" forgot what was offered.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_STATE, readState } from "../src/threadState.js";

describe("readState", () => {
  it("reads nothing as empty, and never throws on an older row", () => {
    expect(readState(null)).toEqual(EMPTY_STATE);
    expect(readState({})).toEqual(EMPTY_STATE);
    expect(readState({ units: ["S1"] })).toEqual(EMPTY_STATE);
    expect(readState({ state: "garbage" })).toEqual(EMPTY_STATE);
    expect(readState({ state: { v: 2, booking: {} } })).toEqual(EMPTY_STATE);
  });

  it("reads back what was written", () => {
    const state = {
      v: 1,
      booking: { serial: "S1", when: "2026-11-14T14:00", name: null, keep: true },
      pendingSearch: "macbook air m3",
    };
    expect(readState({ units: ["S1"], state })).toEqual(state);
  });

  it("drops a field of the wrong type rather than trusting it", () => {
    expect(
      readState({ state: { v: 1, booking: { serial: 7, when: "x", name: null, keep: "yes" }, pendingSearch: 3 } }),
    ).toEqual({ v: 1, booking: { serial: null, when: null, name: null, keep: false }, pendingSearch: null });
  });
});
