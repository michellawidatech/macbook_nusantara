/**
 * The whitelisted tools the chat agent may call.
 *
 * Each one runs a fixed, parameterized Prisma query. The model supplies entity
 * *values* — a model name, a budget, a serial — never a query, a filter object
 * or a fragment of SQL. There is deliberately no path from model output to the
 * database beyond these three shapes.
 *
 * Three further rules, each of which was a real bug in the previous build:
 *
 * - **Never cached.** Stock and price are re-read on every call. Caching the
 *   *decision* is fine (that is what `AgentCache` is for); caching the *data*
 *   is how a bot quotes a laptop that sold yesterday.
 * - **Money crosses as a formatted string.** `BigInt` does not survive
 *   `JSON.stringify` (CLAUDE.md), and a model handed `15500000` writes
 *   "15500000" into a WhatsApp message. Formatting here means the agent can
 *   only ever repeat a correctly written number.
 * - **Results are capped.** A customer asking "what MacBooks do you have"
 *   should not push 400 rows through the context window.
 */

import type { PrismaClient } from "@nusantara/db";
import type Anthropic from "@anthropic-ai/sdk";

/** Whole rupiah, written the way the shop writes it. */
function rp(value: bigint | null): string {
  if (value === null) return "unknown";
  return `Rp ${value.toLocaleString("id-ID")}`;
}

/** How many units one search may return. Past this the agent should narrow. */
const SEARCH_LIMIT = 12;

export const ANTHROPIC_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_stock",
    description:
      "Search units that are in stock and sellable right now. Use this before naming any model, " +
      "price or availability. Returns at most 12 units, newest intake first.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Free text matched against the model and variant name, e.g. 'MacBook Air M2' or 'Pro 14'. " +
            "Leave empty to list what is in stock generally.",
        },
        maxPrice: {
          type: "number",
          description:
            "Optional ceiling in whole rupiah, e.g. 15000000 for a 15 million budget.",
        },
      },
      required: [],
    },
  },
  {
    name: "check_serial",
    description:
      "Look up one specific unit by its serial number — its model, condition grade, price and " +
      "whether it is still available. Use when the customer quotes a serial.",
    input_schema: {
      type: "object",
      properties: {
        serial: {
          type: "string",
          description: "The serial number, exactly as the customer wrote it.",
        },
      },
      required: ["serial"],
    },
  },
  {
    name: "store_info",
    description:
      "The shop's own facts: opening hours, address, payment methods and warranty terms. " +
      "Use this rather than remembering them.",
    input_schema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          enum: ["hours", "address", "payment", "warranty", "all"],
          description: "Which fact is needed.",
        },
      },
      required: ["topic"],
    },
  },
];

/**
 * The shop's static facts.
 *
 * Deliberately plain sentences with no bullet characters or print punctuation:
 * a small model copies the shape of whatever a tool hands it, so a tool that
 * returns a formatted list gets a formatted list back in a WhatsApp message.
 */
const STORE_FACTS: Record<string, string> = {
  hours: "The shop is open every day from 10:00 to 20:00 Jakarta time.",
  address:
    "The shop is in Jakarta. Give the full address only after the customer asks to visit.",
  payment:
    "We take cash, bank transfer, QRIS, debit and credit card, and instalments.",
  warranty:
    "Every unit carries a 90 day shop warranty covering hardware faults that are not caused by " +
    "damage, liquid or software. Keep the receipt as proof.",
};

export interface ToolResult {
  readonly name: string;
  readonly output: unknown;
}

/**
 * Run one tool call.
 *
 * Unknown tool names and malformed arguments return an error *object* rather
 * than throwing: the loop hands it straight back to the model, which then
 * corrects itself or gives up gracefully. A thrown error would end the turn and
 * lose the customer's message.
 */
export async function dispatchTool(
  db: PrismaClient,
  name: string,
  input: unknown,
): Promise<unknown> {
  const args = (input ?? {}) as Record<string, unknown>;

  if (name === "store_info") {
    const topic = String(args["topic"] ?? "all");
    if (topic === "all") return STORE_FACTS;
    return {
      [topic]: STORE_FACTS[topic] ?? "Not something the shop has recorded.",
    };
  }

  if (name === "check_serial") {
    const serial = String(args["serial"] ?? "").trim();
    if (!serial) return { error: "No serial given." };
    const unit = await db.unit.findUnique({
      where: { serial },
      select: {
        serial: true,
        status: true,
        grade: true,
        price: true,
        sku: { select: { name: true, variantLabel: true } },
      },
    });
    if (!unit)
      return { found: false, note: "No unit with that serial in this shop." };
    return {
      found: true,
      serial: unit.serial,
      model: unit.sku.name,
      variant: unit.sku.variantLabel,
      grade: unit.grade,
      price: rp(unit.price),
      available: unit.status === "TERSEDIA",
      status: unit.status,
    };
  }

  if (name === "search_stock") {
    const query = String(args["query"] ?? "").trim();
    const maxPriceRaw = args["maxPrice"];
    const maxPrice =
      typeof maxPriceRaw === "number" &&
      Number.isFinite(maxPriceRaw) &&
      maxPriceRaw > 0
        ? BigInt(Math.floor(maxPriceRaw))
        : undefined;

    const units = await db.unit.findMany({
      where: {
        // Only what can actually be sold today. A DIRESERVASI unit is somebody
        // else's, and a QC unit has no price yet.
        status: "TERSEDIA",
        price: maxPrice ? { not: null, lte: maxPrice } : { not: null },
        ...(query
          ? {
              OR: [
                {
                  sku: {
                    name: { contains: query, mode: "insensitive" as const },
                  },
                },
                {
                  sku: {
                    variantLabel: {
                      contains: query,
                      mode: "insensitive" as const,
                    },
                  },
                },
                {
                  sku: {
                    model: {
                      name: { contains: query, mode: "insensitive" as const },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        serial: true,
        grade: true,
        price: true,
        sku: { select: { name: true, variantLabel: true } },
      },
      orderBy: { intakeAt: "desc" },
      take: SEARCH_LIMIT,
    });

    const total = await db.unit.count({
      where: {
        status: "TERSEDIA",
        price: maxPrice ? { not: null, lte: maxPrice } : { not: null },
        ...(query
          ? {
              OR: [
                {
                  sku: {
                    name: { contains: query, mode: "insensitive" as const },
                  },
                },
                {
                  sku: {
                    variantLabel: {
                      contains: query,
                      mode: "insensitive" as const,
                    },
                  },
                },
                {
                  sku: {
                    model: {
                      name: { contains: query, mode: "insensitive" as const },
                    },
                  },
                },
              ],
            }
          : {}),
      },
    });

    return {
      matched: total,
      showing: units.length,
      // Said out loud so the agent asks the customer to narrow down instead of
      // pretending the twelve it can see are all there is.
      note:
        total > units.length
          ? `${total} units match. Only the ${units.length} most recent are listed — ask the customer what they need so you can narrow it down.`
          : undefined,
      units: units.map((u) => ({
        serial: u.serial,
        model: u.sku.name,
        variant: u.sku.variantLabel,
        grade: u.grade,
        price: rp(u.price),
      })),
    };
  }

  return { error: `Unknown tool ${name}.` };
}
