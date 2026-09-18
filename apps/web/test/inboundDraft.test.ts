/**
 * The order form's auto-save.
 *
 * Its whole job is to survive things a test cannot stage — a closed tab, a
 * flat battery — so what is checked here is the join it does survive: what
 * comes back out of storage, and whether there was anything worth offering
 * back. `lib/inboundDraft.ts` has the reasoning.
 */
import { describe, expect, it } from "vitest";
import {
  inboundDraftHasContent,
  parseInboundDraft,
  type InboundDraft,
} from "../src/lib/inboundDraft.js";

const draft = (over: Partial<InboundDraft> = {}): InboundDraft => ({
  step: 0,
  invoice: "",
  noInvoice: false,
  date: "2026-09-15",
  warehouseId: "wh-1",
  discountMode: "RP",
  lines: [],
  ...over,
});

describe("parseInboundDraft", () => {
  it("round-trips a draft through JSON", () => {
    const before = draft({
      step: 2,
      supplier: "Apel Segar",
      invoice: "INV-9",
      paid: 5_000_000,
      lines: [{ skuId: "sku-1", qty: 3, unitCost: 8_000_000 }],
    });
    expect(parseInboundDraft(JSON.parse(JSON.stringify(before)))).toEqual(
      before,
    );
  });

  it("refuses anything that is not a draft at all", () => {
    // What is in storage was written by whatever build ran last.
    expect(parseInboundDraft(null)).toBeUndefined();
    expect(parseInboundDraft("nonsense")).toBeUndefined();
    expect(parseInboundDraft(42)).toBeUndefined();
    expect(parseInboundDraft({})).toBeUndefined();
    expect(parseInboundDraft({ lines: "no" })).toBeUndefined();
    expect(parseInboundDraft({ lines: [null] })).toBeUndefined();
  });

  it("drops a number that arrived as a string rather than passing it on", () => {
    // `"3"` in an InputNumber is a blank page where an order used to be,
    // which is worse than the lost typing this exists to prevent.
    const parsed = parseInboundDraft({
      ...draft(),
      paid: "5000000",
      lines: [{ skuId: "sku-1", qty: "3" }],
    });
    expect(parsed?.paid).toBeUndefined();
    expect(parsed?.lines[0]?.qty).toBe(1);
  });

  it("clamps a step nobody could navigate to", () => {
    expect(parseInboundDraft({ ...draft(), step: 99 })?.step).toBe(2);
    expect(parseInboundDraft({ ...draft(), step: -4 })?.step).toBe(0);
  });

  it("keeps a missing date as no date rather than as today", () => {
    // Today is a guess. An empty date box asks the question again, which is
    // the honest thing to do with a fact nobody supplied.
    expect(parseInboundDraft({ ...draft(), date: undefined })?.date).toBeNull();
  });
});

describe("inboundDraftHasContent", () => {
  it("says no to a form nobody typed in", () => {
    // Today's date, the shop's own warehouse and cash are defaults, not
    // answers — offering to restore them is a banner that cries wolf.
    expect(inboundDraftHasContent(draft())).toBe(false);
    expect(inboundDraftHasContent(draft({ step: 2, method: "TUNAI" }))).toBe(
      false,
    );
  });

  it("says yes to anything a person had to decide", () => {
    expect(inboundDraftHasContent(draft({ supplier: "Apel Segar" }))).toBe(true);
    expect(inboundDraftHasContent(draft({ invoice: "INV-9" }))).toBe(true);
    expect(inboundDraftHasContent(draft({ noInvoice: true }))).toBe(true);
    expect(inboundDraftHasContent(draft({ paid: 1 }))).toBe(true);
    expect(inboundDraftHasContent(draft({ shippingFee: 1 }))).toBe(true);
    expect(inboundDraftHasContent(draft({ taxFee: 1 }))).toBe(true);
    expect(inboundDraftHasContent(draft({ discount: 1 }))).toBe(true);
  });

  it("does not count a blank line the editor added by itself", () => {
    // `EditableTable` starts a row when the step opens. A qty of 1 and
    // nothing else is that row, not an order.
    expect(inboundDraftHasContent(draft({ lines: [{ qty: 1 }] }))).toBe(false);
    expect(
      inboundDraftHasContent(draft({ lines: [{ qty: 1, skuId: "sku-1" }] })),
    ).toBe(true);
    expect(inboundDraftHasContent(draft({ lines: [{ qty: 2 }] }))).toBe(true);
  });
});
