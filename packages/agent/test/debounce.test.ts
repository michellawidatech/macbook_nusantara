/**
 * The adaptive wait — how long the agent lets a customer keep typing.
 *
 * WhatsApp customers do not write one tidy message. They write "halo", then
 * "mau tanya", then "ada macbook air m2?" across eight seconds. Answering each
 * line is robotic, burns a model call per fragment, and produces three replies
 * to one thought. So a burst is collapsed into one turn — and the only question
 * is how long to wait before deciding the burst is finished.
 *
 * A flat window gets that wrong in both directions: it makes someone who asked
 * a plain question wait for nothing, and it cuts off someone who is visibly
 * mid-sentence. The wait is therefore read off the LATEST message — the one
 * that says most about whether more is coming.
 *
 * Every case here is pure. No timers, no database, no clock: `computeWaitMs`
 * returns a number of milliseconds and the caller decides what to do with it.
 * That is what makes the policy testable at all, and it is why the previous
 * build's process-local timer Map is not ported — see the module docblock.
 */

import { describe, expect, it } from "vitest";
import {
  BASE_WAIT_MS,
  FILLER_FACTOR,
  MAX_WAIT_MS,
  MIN_WAIT_MS,
  computeWaitMs,
} from "../src/debounce.js";

/** A burst, as the draft pass reads it: oldest first, text may be null. */
const burst = (...texts: (string | null)[]) => texts.map((text) => ({ text }));

describe("computeWaitMs", () => {
  it("answers a direct question soonest rather than waiting out the base window", () => {
    // Nothing more is coming after a question mark. Making this customer wait
    // ten seconds is the difference between a shop that feels staffed and one
    // that feels asleep.
    expect(computeWaitMs(burst("ada macbook air m2?"))).toBe(MIN_WAIT_MS);
    expect(MIN_WAIT_MS).toBeLessThan(BASE_WAIT_MS);
  });

  it("answers an English question just as fast, since customers mix languages", () => {
    expect(computeWaitMs(burst("do you have the m2 air?"))).toBe(MIN_WAIT_MS);
  });

  it("waits longest when the customer says they will come back later", () => {
    // "nanti saya kabarin" means the conversation is paused, not finished.
    // Replying in four seconds talks over somebody who already left.
    expect(computeWaitMs(burst("nanti saya kabarin ya"))).toBe(MAX_WAIT_MS);
    expect(computeWaitMs(burst("mau pikir dulu"))).toBe(MAX_WAIT_MS);
    expect(computeWaitMs(burst("besok aja deh"))).toBe(MAX_WAIT_MS);
  });

  it("extends the wait for filler, because the customer is still typing", () => {
    // "bentar" is not a message, it is a request to hold on.
    const extended = Math.round(BASE_WAIT_MS * FILLER_FACTOR);
    expect(computeWaitMs(burst("bentar"))).toBe(extended);
    expect(computeWaitMs(burst("oke"))).toBe(extended);
    expect(computeWaitMs(burst("hm"))).toBe(extended);
  });

  it("treats a trailing ellipsis as mid-thought rather than a finished message", () => {
    expect(computeWaitMs(burst("kalau yang 512gb..."))).toBe(
      Math.round(BASE_WAIT_MS * FILLER_FACTOR),
    );
  });

  it("folds repeated letters, so 'hmmmm' and 'hmm' are the same filler", () => {
    const extended = Math.round(BASE_WAIT_MS * FILLER_FACTOR);
    expect(computeWaitMs(burst("hmmmm"))).toBe(extended);
    expect(computeWaitMs(burst("okeee"))).toBe(extended);
    expect(computeWaitMs(burst("sipp"))).toBe(extended);
  });

  it("falls back to the base window for an ordinary statement", () => {
    expect(computeWaitMs(burst("saya mau yang warna silver"))).toBe(
      BASE_WAIT_MS,
    );
  });

  it("reads the latest message, not the whole burst", () => {
    // The customer opened with filler and ended with a question. The question
    // is what they are waiting on an answer to.
    expect(computeWaitMs(burst("hm", "bentar", "ada m2 ga?"))).toBe(MIN_WAIT_MS);
    // And the reverse: a question followed by "bentar" means more is coming.
    expect(computeWaitMs(burst("ada m2 ga?", "eh bentar"))).toBe(
      Math.round(BASE_WAIT_MS * FILLER_FACTOR),
    );
  });

  it("skips past an attachment when deciding, rather than reading it as silence", () => {
    // A photo carries no text. The question before it is still the live one.
    expect(computeWaitMs(burst("ini serinya apa ya?", null))).toBe(MIN_WAIT_MS);
  });

  it("treats an empty burst as the base window instead of answering instantly", () => {
    expect(computeWaitMs(burst())).toBe(BASE_WAIT_MS);
    expect(computeWaitMs(burst(null))).toBe(BASE_WAIT_MS);
    expect(computeWaitMs(burst("   "))).toBe(BASE_WAIT_MS);
  });

  it("takes its windows from the caller, so the worker's config is the only source", () => {
    // 01 §7: never `process.env` at module scope. The reference build read the
    // env here and could not be tested without one.
    const opts = { minMs: 1_000, baseMs: 2_000, maxMs: 3_000 };
    expect(computeWaitMs(burst("ada?"), opts)).toBe(1_000);
    expect(computeWaitMs(burst("halo semua"), opts)).toBe(2_000);
    expect(computeWaitMs(burst("nanti saya kabarin"), opts)).toBe(3_000);
  });

  it("never returns a wait longer than the maximum, whatever the multiplier does", () => {
    // Filler times the factor must not sail past the ceiling a caller set.
    const opts = { minMs: 1_000, baseMs: 2_000, maxMs: 2_500 };
    expect(computeWaitMs(burst("bentar"), opts)).toBeLessThanOrEqual(2_500);
  });
});
