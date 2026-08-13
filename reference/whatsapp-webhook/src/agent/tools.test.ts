import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDb } from "../test/harness.js";

const { db } = mockDb();
const { dispatchTool, WARRANTY_POLICY, STORE_PAYMENT, ANTHROPIC_TOOLS, TOOL_NAMES } =
  await import("./tools.js");

const sku = (
  modelName: string,
  opts: { chip?: string; storage?: string; grade?: string; price?: bigint; units?: number } = {},
) => ({
  id: `sku-${modelName}-${opts.chip ?? ""}-${opts.storage ?? ""}`,
  name: modelName,
  chip: opts.chip ?? null,
  storage: opts.storage ?? null,
  grade: opts.grade ?? "A",
  price: opts.price ?? 15_000_000n,
  model: { name: modelName, category: "MacBook" },
  units: Array.from({ length: opts.units ?? 0 }, (_, i) => ({ id: `u${i}` })),
});

/** Conversation identity threaded into every dispatch. */
const CTX = { from: "628111", name: "Budi" };

// dispatchTool returns { result } | { escalate } | { clarify }; unwrap the
// structured result and fail loudly on either signal branch.
const result = async (name: string, input: unknown): Promise<Record<string, unknown>> => {
  const out = await dispatchTool(name, input, CTX);
  if ("escalate" in out) throw new Error(`unexpected escalate: ${out.escalate}`);
  if ("clarify" in out) throw new Error(`unexpected clarify: ${out.clarify}`);
  return out.result as Record<string, unknown>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("stock_lookup", () => {
  it("asks for a product when none was supplied (no query)", async () => {
    expect(await result("stock_lookup", {})).toEqual({ needProduct: true });
    expect(db.sku.findMany).not.toHaveBeenCalled();
  });

  it("queries by a parameterized product/chip/grade filter (never raw SQL)", async () => {
    db.sku.findMany.mockResolvedValue([sku("MacBook Air", { units: 2 })]);
    await result("stock_lookup", { product: "MacBook Air", chip: "M2", grade: "b" });

    const where = db.sku.findMany.mock.calls[0]![0].where;
    // Each name word is required, and each is matched against BOTH the linked
    // model name and the SKU's own name (modelId is nullable) — see ./catalog.ts.
    expect(where.AND[0].OR[0].model.is.name.contains).toBe("MacBook");
    expect(where.AND[0].OR[1].name.contains).toBe("MacBook");
    expect(where.AND[1].OR[1].name.contains).toBe("Air");
    expect(where.AND[2].chip.contains).toBe("M2");
    expect(where.grade).toBe("B"); // normalized to a valid Grade
    expect(where.archived).toBe(false);
  });

  it("routes chip/capacity/grade buried in `product` to their own columns", async () => {
    db.sku.findMany.mockResolvedValue([sku("MacBook Air 13\"", { units: 4 })]);
    // The whole label pasted back as `product` — the shape that used to return
    // nothing and get narrated as "unit-nya baru sold tadi".
    await result("stock_lookup", { product: 'MacBook Air 13" M2 16GB/512GB Grade B' });

    const where = db.sku.findMany.mock.calls[0]![0].where;
    const names = where.AND.filter((c: { OR?: unknown }) => c.OR).map(
      (c: { OR: [{ name: { contains: string } }, { name: { contains: string } }] }) =>
        c.OR[1].name.contains,
    );
    expect(names).toEqual(["MacBook", "Air", '13"']); // no chip/size/grade left in the name
    expect(where.AND.find((c: { chip?: unknown }) => c.chip).chip.contains).toBe("M2");
    // Each capacity is required separately, so a stored "16GB / 512GB" matches.
    const sizes = where.AND.filter((c: { storage?: unknown }) => c.storage).map(
      (c: { storage: { contains: string } }) => c.storage.contains,
    );
    expect(sizes).toEqual(["16GB", "512GB"]);
    expect(where.grade).toBe("B");
  });

  it("returns structured variants + available counts for one matched model", async () => {
    db.sku.findMany.mockResolvedValue([
      sku("MacBook Air M2", { storage: "256GB", units: 2, price: 15_000_000n }),
      sku("MacBook Air M2", { storage: "512GB", units: 1, price: 18_000_000n }),
    ]);
    const out = await result("stock_lookup", { product: "MacBook Air M2" });
    expect(out.model).toBe("MacBook Air M2");
    expect(out.totalAvailable).toBe(3);
    expect(out.variants).toHaveLength(2);
    expect((out.variants as { price: string }[])[0]!.price).toContain("Rp");
  });

  it("reports an out-of-stock model as zero available rather than hiding it", async () => {
    db.sku.findMany.mockResolvedValue([sku("MacBook Pro 14", { units: 0 })]);
    const out = await result("stock_lookup", { product: "MacBook Pro 14" });
    expect(out.totalAvailable).toBe(0);
  });

  it("flags an empty match instead of inventing a model", async () => {
    db.sku.findMany.mockResolvedValue([]);
    expect(await result("stock_lookup", { product: "Nokia 3310" })).toMatchObject({
      empty: true,
      query: "Nokia 3310",
    });
  });

  it("returns candidates (not a handoff) when the product is ambiguous", async () => {
    db.sku.findMany.mockResolvedValue([
      sku("MacBook Air M2", { units: 1 }),
      sku("MacBook Air M3", { units: 1 }),
    ]);
    expect(await result("stock_lookup", { product: "MacBook Air" })).toEqual({
      ambiguous: true,
      candidates: ["MacBook Air M2", "MacBook Air M3"],
    });
  });
});

describe("price_lookup", () => {
  it("returns per-variant prices for a single model", async () => {
    db.sku.findMany.mockResolvedValue([
      sku("MacBook Air M2", { storage: "256GB", price: 15_000_000n }),
      sku("MacBook Air M2", { storage: "512GB", price: 18_000_000n }),
    ]);
    const out = await result("price_lookup", { product: "MacBook Air M2" });
    expect(out.model).toBe("MacBook Air M2");
    expect((out.variants as { price: string }[])[0]!.price).toContain("Rp");
  });

  it("returns candidates when the product is ambiguous across models", async () => {
    db.sku.findMany.mockResolvedValue([sku("iPad Air"), sku("iPad Pro")]);
    expect(await result("price_lookup", { product: "iPad" })).toEqual({
      ambiguous: true,
      candidates: ["iPad Air", "iPad Pro"],
    });
  });
});

describe("budget_recommend", () => {
  it("asks for a budget when none was supplied (no query)", async () => {
    expect(await result("budget_recommend", {})).toEqual({ needBudget: true });
    expect(db.sku.findMany).not.toHaveBeenCalled();
  });

  it("queries available units at or under the rupiah ceiling, priciest first", async () => {
    db.sku.findMany.mockResolvedValue([sku("iPad Air", { units: 2, price: 9_500_000n })]);
    const out = await result("budget_recommend", { budget: 10_000_000 });

    const args = db.sku.findMany.mock.calls[0]![0];
    expect(args.where.price.lte).toBe(10_000_000n);
    expect(args.where.units.some.status).toBe("TERSEDIA");
    expect(args.orderBy).toEqual([{ price: "desc" }]);
    expect(out.budget).toContain("Rp");
    expect((out.options as { model: string }[])[0]!.model).toBe("iPad Air");
  });

  it("returns an empty option list when nothing fits the budget", async () => {
    db.sku.findMany.mockResolvedValue([]);
    const out = await result("budget_recommend", { budget: 1_000_000 });
    expect(out.options).toEqual([]);
  });
});

describe("store_info & warranty_info", () => {
  it("store_info returns hours/location/payment with no query", async () => {
    const out = await result("store_info", {});
    expect(out.hours).toBeTruthy();
    expect(out.payment).toBe(STORE_PAYMENT);
    expect(db.sku.findMany).not.toHaveBeenCalled();
  });

  it("warranty_info returns the static store policy verbatim", async () => {
    expect(await result("warranty_info", {})).toEqual({ policy: WARRANTY_POLICY });
  });
});

describe("promo_featured", () => {
  it("surfaces active discounts and newest available units", async () => {
    db.discount.findMany.mockResolvedValue([
      { description: "Diskon lebaran", pct: 10, scope: "SEMUA", scopeCat: null },
    ]);
    db.unit.findMany.mockResolvedValue([
      {
        sku: { name: "MacBook Air M3", chip: "M3", storage: "256GB", grade: "A", price: 17_000_000n, model: { name: "MacBook Air M3" } },
      },
    ]);
    const out = await result("promo_featured", {});
    expect((out.promos as { description: string }[])[0]!.description).toBe("Diskon lebaran");
    expect((out.newArrivals as { model: string; price: string }[])[0]!.model).toBe("MacBook Air M3");
    expect((out.newArrivals as { price: string }[])[0]!.price).toContain("Rp");
    // only active + in-window discounts are queried
    expect(db.discount.findMany.mock.calls[0]![0].where.active).toBe(true);
    expect(db.unit.findMany.mock.calls[0]![0].orderBy).toEqual({ intakeAt: "desc" });
  });
});

describe("escalate_to_staff", () => {
  it("returns an escalate signal carrying the reason (no DB write)", async () => {
    const out = await dispatchTool("escalate_to_staff", { reason: "komplain unit rusak" }, CTX);
    expect(out).toEqual({ escalate: "komplain unit rusak" });
  });

  it("defaults the reason when the model omits it", async () => {
    expect(await dispatchTool("escalate_to_staff", {}, CTX)).toEqual({ escalate: "customer-request" });
  });
});

describe("dispatchTool registry", () => {
  it("returns an error result for an unknown tool (never throws)", async () => {
    expect(await result("drop_table", {})).toMatchObject({ error: expect.stringContaining("drop_table") });
  });

  it("TOOL_NAMES matches the exported Anthropic tool schemas", () => {
    expect([...TOOL_NAMES].sort()).toEqual(ANTHROPIC_TOOLS.map((t) => t.name).sort());
  });
});

describe("ask_clarification", () => {
  it("is exposed to the model", () => {
    expect(TOOL_NAMES.has("ask_clarification")).toBe(true);
  });

  it("returns a clarify signal, not an escalation", async () => {
    const out = await dispatchTool("ask_clarification", { reason: "typo berat" }, { from: "628111" });
    expect(out).toEqual({ clarify: "typo berat" });
    expect(out).not.toHaveProperty("escalate");
  });

  it("falls back to a placeholder reason when the model sends a blank one", async () => {
    expect(await dispatchTool("ask_clarification", { reason: "  " }, { from: "628111" })).toEqual({
      clarify: "unclear",
    });
  });
});
