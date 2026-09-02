/**
 * The tool whitelist, considered as a security boundary.
 *
 * Everything the agent can do to this database, it does through one of these
 * tools. There is no path from model output to a query — the model supplies
 * entity *values*, never a filter, a table name or a fragment of SQL. So the
 * list itself is the policy, and a test that reads it is the only way that
 * policy stays true after somebody adds a tool in a hurry.
 *
 * Two claims matter more than the rest:
 *
 *  1. **Nothing here can move money.** No order, no payment, no price, no
 *     discount, no refund. A customer's sentence cannot reach those because
 *     there is no tool that performs them, not because the prompt says not to.
 *  2. **`create_reservation` cannot be pointed at somebody else.** The phone
 *     number comes from the WhatsApp envelope, which the model never sees and
 *     cannot write. "reserve it under 0812..." is a sentence, not an argument.
 *
 * Pure: this reads the exported schema and calls nothing.
 */

import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_TOOLS,
  READ_TOOLS,
  WRITE_TOOLS,
  dispatchTool,
  phoneForms,
  toolsFor,
} from "../src/tools.js";
import { noDb } from "./fixtures.js";

/** The complete surface this build allows. Changing it is a policy decision. */
const ALLOWED = [
  "search_stock",
  "check_serial",
  "store_info",
  "browse_catalog",
  "lookup_customer",
  "check_order",
  "search_knowledge",
  "handoff_to_staff",
  "create_reservation",
  "cancel_reservation",
] as const;

const names = () => ANTHROPIC_TOOLS.map((t) => t.name).sort();

const byName = (name: string) => {
  const tool = ANTHROPIC_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool named ${name}`);
  return tool;
};

/** The properties block of a tool's JSON Schema. */
const props = (name: string) =>
  (byName(name).input_schema.properties ?? {}) as Record<string, unknown>;

describe("the tool whitelist", () => {
  it("exposes exactly the tools this build allows, and no others", () => {
    expect(names()).toEqual([...ALLOWED].sort());
  });

  it("splits reads from writes, so the boundary is readable in code", () => {
    expect([...WRITE_TOOLS].sort()).toEqual([
      "cancel_reservation",
      "create_reservation",
    ]);
    expect([...READ_TOOLS].sort()).toEqual(
      [...ALLOWED].filter((n) => !WRITE_TOOLS.includes(n as never)).sort(),
    );
  });

  it("ships a way to undo the write, because a hold nobody can release is a lost unit", () => {
    // A booking takes a real unit out of stock. Without cancel_reservation the
    // only way back is a staff member noticing.
    expect(WRITE_TOOLS).toContain("cancel_reservation");
  });

  it("hides the write tools from a caller that was granted no reserve capability", () => {
    // The staff Draft page passes none: pressing Draft proposes a sentence, it
    // does not book. A model cannot call a tool that is not in the array.
    const base = { from: "628111000111", now: new Date() };
    const offered = toolsFor(base).map((t) => t.name).sort();
    expect(offered).toEqual([...READ_TOOLS].sort());
    expect(offered).not.toContain("create_reservation");

    const withWrite = toolsFor({
      ...base,
      reserve: { write: noDb, staffId: "staff_agent" },
    }).map((t) => t.name);
    expect(withWrite).toContain("create_reservation");
  });

  it("exposes no tool that can create an order, take a payment or change a price", () => {
    // The forbidden verbs, as a customer might phrase them and as a careless
    // commit might name them.
    // Named rather than pattern-matched: `check_order` and `cancel_reservation`
    // are both legitimate and would trip a naive regex on "order" or "cancel".
    const forbidden = [
      "create_order",
      "update_order",
      "take_payment",
      "record_payment",
      "set_price",
      "update_price",
      "apply_discount",
      "refund_order",
      "process_return",
      "resolve_warranty",
      "mark_sold",
      "update_unit",
      "delete_reservation",
      "run_sql",
      "query",
    ];
    for (const name of forbidden) {
      expect(names(), `"${name}" must not exist`).not.toContain(name);
    }
    // And nothing may mutate a unit beyond the reservation hold.
    for (const name of names()) {
      expect(/terjual|hilang|koreksi|klaim|opname|retur/i.test(name)).toBe(false);
    }
  });

  it("gives every tool a description, since an undescribed tool gets called at random", () => {
    for (const tool of ANTHROPIC_TOOLS) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(40);
    }
  });

  it("declares an object schema for every tool", () => {
    for (const tool of ANTHROPIC_TOOLS) {
      expect(tool.input_schema.type).toBe("object");
    }
  });

  it("names the required fields of the tools that have them", () => {
    expect(byName("check_serial").input_schema.required).toEqual(["serial"]);
    expect(byName("store_info").input_schema.required).toEqual(["topic"]);
    expect(byName("check_order").input_schema.required).toEqual(["code"]);
    // A search with no arguments is "what have you got", which is a real question.
    expect(byName("search_stock").input_schema.required ?? []).toEqual([]);
  });

  it("gives create_reservation no phone argument, so the sender cannot be spoofed", () => {
    // The wa_id comes from the WhatsApp envelope via the dispatch context. If
    // the model could supply it, "reserve it for 62812..." would book a unit
    // against a stranger's number.
    const p = Object.keys(props("create_reservation"));
    expect(p).not.toContain("phone");
    expect(p).not.toContain("from");
    expect(p).not.toContain("waId");
    expect(p).not.toContain("customerId");
  });

  it("gives lookup_customer no arguments at all, so it can only ever be about this sender", () => {
    // Any argument here would be a way to read another customer's history.
    expect(Object.keys(props("lookup_customer"))).toEqual([]);
  });

  it("lets create_reservation carry only what a customer would actually say", () => {
    const p = Object.keys(props("create_reservation")).sort();
    expect(p).toEqual(["custName", "note", "serial", "when"]);
  });

  it("requires a real date and a chosen unit before anything is held", () => {
    // Both, because a hold with no time is a unit nobody comes for, and a time
    // with no unit is not a hold at all.
    expect(byName("create_reservation").input_schema.required).toEqual([
      "when",
      "serial",
    ]);
  });

  it("closes every schema to extra properties, so a smuggled key is an error not a shrug", () => {
    for (const tool of ANTHROPIC_TOOLS) {
      expect(
        (tool.input_schema as { additionalProperties?: boolean })
          .additionalProperties,
        `${tool.name} must be closed`,
      ).toBe(false);
    }
  });

  it("keeps the reservation tool's description honest about it being a real hold", () => {
    // Staff read this description when they audit what the bot can do.
    expect(byName("create_reservation").description).toMatch(/hold|reserve/i);
  });
});

/**
 * The other half of the boundary, proved with no database in the room.
 *
 * A test that needed a database to show a write tool does not exist could be
 * green because the seed was empty. This Proxy makes any database contact a
 * failure, so "the forbidden tool is unreachable" is a claim about behaviour
 * rather than a claim about a list. Copied from the webhook's fail-closed
 * suite, which makes the same argument about signature rejection.
 */
/** The context the dispatcher always receives — the sender is never the model's to choose. */
const ctx = {
  from: "628111000111",
  customerId: null,
  staffId: "staff_agent",
  now: new Date("2026-08-20T03:00:00.000Z"),
};

describe("dispatchTool, fail closed", () => {
  it("refuses every forbidden tool name without touching the database", async () => {
    const forbidden = [
      "create_order",
      "take_payment",
      "set_price",
      "apply_discount",
      "mark_sold",
      "update_unit",
      "delete_reservation",
      "refund_order",
      "create_warranty_claim",
    ];
    for (const name of forbidden) {
      const out = await dispatchTool(noDb, name, {}, ctx);
      expect(out, `${name} must be refused`).toMatchObject({
        error: expect.stringContaining(name),
      });
    }
  });

  it("refuses an unknown tool with an error object rather than throwing, so the model can correct itself", async () => {
    // A thrown error would end the turn and lose the customer's message.
    await expect(
      dispatchTool(noDb, "definitely_not_a_tool", {}, ctx),
    ).resolves.toMatchObject({ error: expect.any(String) });
  });

  it("refuses a tool name that differs only by case rather than dispatching it", async () => {
    for (const name of ["Search_Stock", "STORE_INFO", "Create_Reservation"]) {
      await expect(dispatchTool(noDb, name, {}, ctx)).resolves.toMatchObject({
        error: expect.any(String),
      });
    }
  });

  it("survives null, a string and an array where an argument object was expected", async () => {
    for (const bad of [null, undefined, "halo", [1, 2, 3], 42]) {
      await expect(
        dispatchTool(noDb, "store_info", bad, ctx),
      ).resolves.toBeDefined();
    }
  });

  it("answers store_info without touching the database at all", async () => {
    const out = await dispatchTool(noDb, "store_info", { topic: "hours" }, ctx);
    expect(JSON.stringify(out)).toMatch(/10:00/);
  });

  it("reports an unknown store_info topic as unrecorded rather than inventing a fact", async () => {
    const out = (await dispatchTool(
      noDb,
      "store_info",
      { topic: "cicilan_0_persen" },
      ctx,
    )) as Record<string, string>;
    expect(JSON.stringify(out)).toMatch(/not something the shop has recorded/i);
  });

  it("returns store facts as plain sentences, since a model copies the shape it is handed", () => {
    // A tool that returns a bulleted list gets a bulleted list back in a
    // WhatsApp message.
    const facts = JSON.stringify(
      ANTHROPIC_TOOLS.find((t) => t.name === "store_info"),
    );
    expect(facts).not.toMatch(/[—–]/);
  });
});

describe("the tool arguments the model is allowed to supply", () => {
  it("accepts no price, amount, quantity or unit status as an argument", () => {
    // The model supplies entity values. It does not supply money or state.
    const banned =
      /^(price|harga|amount|total|qty|quantity|status|grade|discount|diskon|cost|buy|landed)$/i;
    for (const tool of ANTHROPIC_TOOLS) {
      for (const key of Object.keys(tool.input_schema.properties ?? {})) {
        expect(banned.test(key), `${tool.name}.${key} is not the model's to set`).toBe(
          false,
        );
      }
    }
  });

  it("accepts no filter object or array, so there is no path from model output to a query shape", () => {
    for (const tool of ANTHROPIC_TOOLS) {
      const properties = (tool.input_schema.properties ?? {}) as Record<
        string,
        { type?: string; enum?: unknown[] }
      >;
      for (const [key, schema] of Object.entries(properties)) {
        // `integer` counts: whole rupiah is exactly the right type for a
        // budget, and it is narrower than `number`, not wider.
        expect(
          ["string", "number", "integer", "boolean"],
          `${tool.name}.${key} must be a scalar`,
        ).toContain(schema.type ?? (schema.enum ? "string" : "object"));
      }
    }
  });

  it("never promises a discount or a free anything in a tool description", () => {
    for (const tool of ANTHROPIC_TOOLS) {
      expect(tool.description ?? "").not.toMatch(
        /diskon|discount|gratis|free|bonus/i,
      );
    }
  });

  /**
   * `/api/chat/reply` takes an optional `waId` — a persona preview has no
   * thread open — and passes `ctx.from = ""` when it is missing. That used to
   * become the filter `["", "+"]`, which are two values a row can actually
   * MATCH, so an order stored with a blank phone would be read back to a
   * stranger as their own purchase history.
   */
  it("scopes to nothing when nobody has been identified", () => {
    expect(phoneForms("")).toEqual([]);
    expect(phoneForms("   ")).toEqual([]);
    expect(phoneForms("628123")).toEqual(["628123", "+628123"]);
  });
});
