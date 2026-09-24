/**
 * One payment over a party's bills, oldest first — the owner's own example
 * (2026-09-22) is the first test, and every other case is a change somebody
 * makes after it.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_ALLOCATION,
  allocate,
  setAmount,
  toggleRow,
  type AllocationState,
} from "../src/lib/allocatePayment.js";

const JT = 1_000_000;
/** 5, 2, 4, 2, 1 million — oldest first, as the owner listed them. */
const BILLS = [
  { key: "b1", owed: 5 * JT },
  { key: "b2", owed: 2 * JT },
  { key: "b3", owed: 4 * JT },
  { key: "b4", owed: 2 * JT },
  { key: "b5", owed: 1 * JT },
];
const paidOf = (s: AllocationState) =>
  allocate(BILLS, s).lines.map((l) => l.paid / JT);
const statusOf = (s: AllocationState) =>
  allocate(BILLS, s).lines.map((l) => l.status);

describe("allocate", () => {
  it("fills oldest first: 10jt pays 5 and 2 in full and 3 of the 4", () => {
    const s = setAmount(EMPTY_ALLOCATION, 10 * JT);
    expect(paidOf(s)).toEqual([5, 2, 3, 0, 0]);
    expect(statusOf(s)).toEqual(["FULL", "FULL", "PARTIAL", "NONE", "NONE"]);
    const a = allocate(BILLS, s);
    expect(a.count).toBe(3);
    expect(a.allocated).toBe(10 * JT);
    expect(a.leftover).toBe(0);
    expect(a.lines.map((l) => l.ticked)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("lowering the total empties the newest bill first", () => {
    const s = setAmount(EMPTY_ALLOCATION, 8 * JT);
    expect(paidOf(s)).toEqual([5, 2, 1, 0, 0]);
  });

  it("raising the total fills the next-oldest", () => {
    const s = setAmount(EMPTY_ALLOCATION, 12.5 * JT);
    expect(paidOf(s)).toEqual([5, 2, 4, 1.5, 0]);
  });

  it("with no amount, ticked rows are paid in full and the amount is their sum", () => {
    let s = EMPTY_ALLOCATION;
    s = toggleRow(s, allocate(BILLS, s), "b2");
    s = toggleRow(s, allocate(BILLS, s), "b4");
    const a = allocate(BILLS, s);
    expect(a.auto).toBe(true);
    expect(a.amount).toBe(4 * JT);
    expect(paidOf(s)).toEqual([0, 2, 0, 2, 0]);
  });

  it("editing the auto amount down takes it off the newest ticked row", () => {
    let s = EMPTY_ALLOCATION;
    s = toggleRow(s, allocate(BILLS, s), "b2");
    s = toggleRow(s, allocate(BILLS, s), "b4");
    s = setAmount(s, 3 * JT);
    expect(paidOf(s)).toEqual([0, 2, 0, 1, 0]);
    expect(statusOf(s)[3]).toBe("PARTIAL");
  });

  it("editing it above the ticked rows spills into the oldest others", () => {
    let s = EMPTY_ALLOCATION;
    s = toggleRow(s, allocate(BILLS, s), "b2");
    s = toggleRow(s, allocate(BILLS, s), "b4");
    s = setAmount(s, 6 * JT);
    expect(paidOf(s)).toEqual([2, 2, 0, 2, 0]);
  });

  it("unticking a row the spill filled keeps the money off it", () => {
    let s = setAmount(EMPTY_ALLOCATION, 10 * JT);
    s = toggleRow(s, allocate(BILLS, s), "b2");
    expect(paidOf(s)).toEqual([5, 0, 4, 1, 0]);
    expect(allocate(BILLS, s).lines[1]!.ticked).toBe(false);
  });

  it("ticking a row again after unticking it gives it money back", () => {
    let s = setAmount(EMPTY_ALLOCATION, 10 * JT);
    s = toggleRow(s, allocate(BILLS, s), "b2");
    s = toggleRow(s, allocate(BILLS, s), "b2");
    // Picked now, so it is paid before the spill.
    expect(paidOf(s)).toEqual([5, 2, 3, 0, 0]);
  });

  it("a ticked row the money cannot reach stays ticked, with nothing on it", () => {
    let s = setAmount(EMPTY_ALLOCATION, 1 * JT);
    s = toggleRow(s, allocate(BILLS, s), "b4");
    s = toggleRow(s, allocate(BILLS, s), "b5");
    const a = allocate(BILLS, s);
    expect(paidOf(s)).toEqual([0, 0, 0, 1, 0]);
    expect(a.lines[4]!.ticked).toBe(true);
    expect(a.lines[4]!.status).toBe("NONE");
    expect(a.count).toBe(1);
  });

  it("clearing the amount goes back to adding up the ticks", () => {
    let s = EMPTY_ALLOCATION;
    s = toggleRow(s, allocate(BILLS, s), "b3");
    s = setAmount(s, 1 * JT);
    s = setAmount(s, null);
    expect(allocate(BILLS, s).amount).toBe(4 * JT);
  });

  it("reports money beyond every bill as left over", () => {
    const a = allocate(BILLS, setAmount(EMPTY_ALLOCATION, 20 * JT));
    expect(a.allocated).toBe(14 * JT);
    expect(a.leftover).toBe(6 * JT);
  });

  it("money beyond the rows nobody skipped is left over too", () => {
    let s = setAmount(EMPTY_ALLOCATION, 14 * JT);
    s = toggleRow(s, allocate(BILLS, s), "b1");
    expect(allocate(BILLS, s).leftover).toBe(5 * JT);
  });
});
