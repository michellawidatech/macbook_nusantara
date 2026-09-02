/**
 * The whitelisted tools the chat agent may call — and the boundary that makes
 * the rest of the POS unreachable.
 *
 * Each tool runs a fixed, parameterized Prisma query with an explicit `select`.
 * The model supplies entity *values* — a model name, a budget, a serial, a date
 * — never a query, a filter object, or a fragment of SQL.
 *
 * ## The three tiers
 *
 * **Safe reads** are the shop's public facts and the sender's own history.
 * **Two guarded writes** book a visit holding a unit, and cancel it again.
 * **Everything else is forbidden**: orders, payments, prices, discounts,
 * returns, warranty resolutions, any unit transition other than the reservation
 * hold, and any other customer's data.
 *
 * Forbidden is enforced structurally, in five places, none of them a prompt:
 *
 *  1. The tool is not in the array sent to the API. `toolsFor(ctx)` omits the
 *     write tools entirely when the caller granted no reserve capability — the
 *     staff Draft page does exactly that, because pressing Draft should propose
 *     a sentence, not book a reservation.
 *  2. The whitelist is compile-time. Nothing a customer types adds a name to it.
 *  3. `dispatchTool` is a literal branch chain, never `handlers[name]` — an
 *     object indexed by a model-supplied key answers to "constructor".
 *  4. Writes need a capability the read path does not hold, so there is no
 *     ambient client to reach.
 *  5. Every query names its columns. `Unit.buy`, `Unit.landed`, `OrderItem.cogs`
 *     and `Staff.passwordHash` appear nowhere in this package, so no prompt can
 *     surface them.
 *
 * ## Three rules that were each a real bug
 *
 * - **Never cached.** Stock and price are re-read on every call. Caching the
 *   *decision* is fine; caching the *data* is how a bot quotes a laptop that
 *   sold yesterday.
 * - **Money crosses as a formatted string.** Not merely for looks: a raw
 *   `BigInt` in a tool result *throws* in `JSON.stringify`, which `converse`
 *   catches, which returns null, which escalates the thread. A leaked BigInt is
 *   a silent outage, not a formatting slip. `toolJson` is the gate.
 * - **Results are capped.** "What MacBooks do you have" must not push 400 rows
 *   through the context window.
 */

import {
  TXN_TIMEOUTS,
  createHold,
  releaseHold,
  AmbiguousHoldError,
  BookingInPastError,
  BookingTooFarAheadError,
  DuplicateHoldError,
  HoldAlreadySettledError,
  HoldNotFoundError,
  OutsideStoreHoursError,
  UnitNotAvailableError,
  UnknownSerialError,
  type PrismaClient,
} from "@nusantara/db";
import type Anthropic from "@anthropic-ai/sdk";
import { formatRupiah } from "@nusantara/domain";

/** How many units one search may return. Past this the agent should narrow. */
const SEARCH_LIMIT = 12;

/** Caps on the sender's own history. Enough to be useful, not a data dump. */
const ORDER_LIMIT = 5;
const RESERVATION_LIMIT = 5;

/** The shop's day, as one machine-readable fact that prose and logic share. */
export const STORE_HOURS = { openHour: 10, closeHour: 20 } as const;

/** How far ahead a booking may be made. */
export const MAX_BOOKING_DAYS = 60;

// --- the context the model never sees --------------------------------------

/**
 * Who is talking, and what this caller is allowed to do.
 *
 * The sender's identity lives here and **never** in a tool's input schema. That
 * is the whole anti-injection story for writes: "reserve it under 0812..." is a
 * sentence in a message, not an argument, so it cannot retarget a booking.
 */
export interface ToolContext {
  /** The wa_id from the WhatsApp envelope. Digits only, no plus. */
  readonly from: string;
  /** The profile name Meta sent, if any — a fallback for a new customer's name. */
  readonly profileName?: string | null;
  readonly now: Date;
  /**
   * Present only when the caller consciously enabled writing. Absent on the
   * staff Draft path, which keeps the write path to exactly one caller.
   */
  readonly reserve?: {
    readonly write: PrismaClient;
    /** The reserved agent Staff row. A `UnitEvent` must be attributable. */
    readonly staffId: string;
  };
  /** Writes already made this turn, so a retry cannot double-book. */
  readonly writesUsed?: Set<string>;
  /**
   * Where a swallowed failure goes.
   *
   * The customer must never see a stack trace, but "fail soft" and "fail
   * silently" are not the same thing — `converse.ts` makes the same argument
   * about the model call. Without this, a booking that fails on a constraint
   * and a booking that fails on a dead connection produce the identical
   * "a colleague will follow up", and neither is diagnosable from anywhere but
   * a debugger.
   */
  readonly onError?: (tool: string, err: unknown) => void;
}

// --- serialisation gate ----------------------------------------------------

export class ToolSerialisationError extends Error {
  constructor(path: string, kind: string) {
    super(`tool result carried a raw ${kind} at ${path}`);
    this.name = "ToolSerialisationError";
  }
}

/**
 * Prove a tool result can survive `JSON.stringify` before the loop tries it.
 *
 * `JSON.stringify(1n)` throws a `TypeError`, and `converse` runs its stringify
 * inside the try that also wraps the model call — so one leaked `BigInt` fails
 * the whole turn and hands a live conversation to a human. A `Date` is nearly
 * as bad: it serialises to UTC, and for a Jakarta shop that is the wrong day
 * either side of midnight.
 */
export function toolJson<T>(value: T, path = "$"): T {
  if (typeof value === "bigint")
    throw new ToolSerialisationError(path, "BigInt");
  if (value instanceof Date) throw new ToolSerialisationError(path, "Date");
  if (Array.isArray(value)) {
    value.forEach((v, i) => toolJson(v, `${path}[${i}]`));
    return value;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) toolJson(v, `${path}.${k}`);
  }
  return value;
}

/** Whole rupiah, written the way the shop writes it. Never a bare number. */
const rp = (value: bigint | null): string | undefined =>
  value === null ? undefined : formatRupiah(value);

// --- Jakarta time ----------------------------------------------------------

const JKT = "Asia/Jakarta";

/** `YYYY-MM-DD` in Jakarta, so a stored date is never a UTC day out. */
export const jakartaDate = (at: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: JKT,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);

/** `HH:MM` in Jakarta, 24 hour. */
export const jakartaTime = (at: Date): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: JKT,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);

/** The weekday in Jakarta, spelled out. */
export const jakartaWeekday = (at: Date): string =>
  new Intl.DateTimeFormat("en-GB", { timeZone: JKT, weekday: "long" }).format(
    at,
  );

/** Is the shop open at this instant? */
export function storeOpenAt(at: Date): boolean {
  const hour = Number(jakartaTime(at).slice(0, 2));
  return hour >= STORE_HOURS.openHour && hour < STORE_HOURS.closeHour;
}

// --- phone -----------------------------------------------------------------

/**
 * The wa_id and `Customer.phone` do not match, and nothing in this build
 * reconciled them before now: WhatsApp sends `62812…`, the customer table
 * stores `/// E.164` — `+62812…`.
 *
 * Reads use both exact forms, so the unique index on `Customer.phone` still
 * applies; a `regexp_replace` comparison would be correct and would scan every
 * customer. Writes always use E.164, matching the column's docblock.
 *
 * Known gap, stated rather than hidden: a row a staff member typed as
 * `0812-3456-7890` will not be found. Fixing that needs a normalised generated
 * column and an index.
 */
/**
 * Empty in, empty out — and that is the load-bearing case, not an edge one.
 *
 * `/api/chat/reply` takes an optional `waId`, because a staff member previewing
 * a persona edit has no thread open, and passes `ctx.from = ""` when it is
 * missing. Without this guard that became the filter `["", "+"]`: two exact
 * values that MATCH, against any row whose phone was ever written as an empty
 * string — a walk-in migrated from the previous build, a bad import — and the
 * preview would read a stranger's purchase history back as the caller's own.
 *
 * An empty list is what "we do not know who this is" has to compile to.
 * Prisma renders `IN ()` as a false predicate, so every scoped read below
 * finds nothing rather than finding whatever happens to be blank.
 */
export const phoneForms = (waId: string): string[] =>
  waId.trim() === "" ? [] : [waId, `+${waId}`];
export const toE164 = (waId: string): string => `+${waId}`;

// --- the whitelist ---------------------------------------------------------

const SEARCH_STOCK: Anthropic.Tool = {
  name: "search_stock",
  description:
    "Search units that are in stock and sellable right now. Call this before naming any model, " +
    "price or availability. Returns at most 12 units. The serial is a handle for booking, not " +
    "sales copy, so do not read serials out unless the customer asks.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        maxLength: 120,
        description:
          "Free text matched against the category, model, variant and sku name. Every word must " +
          "match something, so 'air m2 256' and 'macbook 256gb' both work. Name the kind of " +
          "machine whenever you know it, even just 'macbook', or a price ceiling on its own " +
          "returns whatever happens to cost that much, watches and accessories included. " +
          "Leave empty only for a genuinely open question.",
      },
      maxPrice: {
        type: "integer",
        minimum: 1,
        description: "Ceiling in whole rupiah. 15 juta is 15000000.",
      },
      minPrice: { type: "integer", minimum: 1 },
      sort: {
        type: "string",
        enum: ["newest", "cheapest", "priciest"],
        description:
          "Which end of the range to show. With a budget, priciest plus maxPrice is the most " +
          "the customer can get for their money, which is usually what they are asking for.",
      },
    },
    required: [],
    additionalProperties: false,
  },
};

const CHECK_SERIAL: Anthropic.Tool = {
  name: "check_serial",
  description:
    "Look up one specific unit by its serial number — its model, condition grade, price and " +
    "whether it can be bought right now. Use when the customer quotes a serial.",
  input_schema: {
    type: "object",
    properties: {
      serial: {
        type: "string",
        maxLength: 40,
        description: "The serial number, exactly as the customer wrote it.",
      },
    },
    required: ["serial"],
    additionalProperties: false,
  },
};

const STORE_INFO: Anthropic.Tool = {
  name: "store_info",
  description:
    "The shop's own facts: today's date and time in Jakarta, whether the shop is open right now, " +
    "opening hours, the shop address, payment methods, warranty terms and what the condition " +
    "grades mean. Use this rather than remembering any of them.",
  input_schema: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        enum: ["hours", "address", "payment", "warranty", "grade", "all"],
        description: "Which fact is needed.",
      },
    },
    required: ["topic"],
    additionalProperties: false,
  },
};

const BROWSE_CATALOG: Anthropic.Tool = {
  name: "browse_catalog",
  description:
    "What kinds of thing are in stock right now, grouped by category and model, with how many of " +
    "each and the price range. Use for an open question like what do you have, before narrowing " +
    "down with search_stock.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

const LOOKUP_CUSTOMER: Anthropic.Tool = {
  name: "lookup_customer",
  description:
    "What the shop knows about the person you are talking to: their name, how long they have been " +
    "a customer, what they have bought, and any booking they already have. Takes no arguments, it " +
    "is always about this conversation. Use it before asking them something the shop already knows.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

const SEARCH_KNOWLEDGE: Anthropic.Tool = {
  name: "search_knowledge",
  description:
    "Search the answers the shop's own staff have written and approved, for anything about how " +
    "the shop works: trade-in, instalments, shipping, testing, what is included in the box, " +
    "how a warranty claim goes. Call this BEFORE answering any question you are not certain " +
    "about. If it returns an answer, use that answer. If it returns nothing, say you will " +
    "check with a colleague rather than working it out for yourself.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        maxLength: 120,
        description:
          "What the customer asked, in a few words. For example 'tukar tambah' or 'bisa kirim ke luar kota'.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

const CHECK_ORDER: Anthropic.Tool = {
  name: "check_order",
  description:
    "Look up one of this customer's own past purchases by its code, including what was bought and " +
    "how long the warranty runs. Only ever returns this customer's own purchase.",
  input_schema: {
    type: "object",
    properties: {
      code: {
        type: "string",
        maxLength: 30,
        description:
          "The purchase code the customer quoted, for example SI-2026/01-000094.",
      },
    },
    required: ["code"],
    additionalProperties: false,
  },
};

const HANDOFF: Anthropic.Tool = {
  name: "handoff_to_staff",
  description:
    "Hand the conversation to a person. Use for price negotiation, instalment terms, trade-in " +
    "quotes, warranty claims, returns, refunds, complaints, payment problems, repairs, or when the " +
    "customer asks for a human. Also use it whenever you do not know and no tool answers it. Never " +
    "guess instead of using this.",
  input_schema: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        enum: [
          "price_negotiation",
          "trade_in",
          "warranty_claim",
          "return_or_refund",
          "payment",
          "service",
          "complaint",
          "other",
        ],
      },
      reason: { type: "string", maxLength: 200 },
    },
    required: ["topic"],
    additionalProperties: false,
  },
};

const CREATE_RESERVATION: Anthropic.Tool = {
  name: "create_reservation",
  description:
    "Book a visit and hold a unit for this customer. Call this only once the customer has agreed " +
    "and you have both a day and a time. This really does reserve the unit, so nobody else can buy " +
    "it until the booking is cancelled. The phone number comes from WhatsApp automatically, so " +
    "never ask for it. If the result says unavailable, follow its guidance exactly and offer the " +
    "alternatives. Do not invent a reason.",
  input_schema: {
    type: "object",
    properties: {
      when: {
        type: "string",
        maxLength: 20,
        description:
          "Jakarta local date and time as YYYY-MM-DDTHH:MM, for example 2026-08-21T15:00. Work out " +
          "the real date from store_info first. Never send a word like besok.",
      },
      serial: {
        type: "string",
        maxLength: 40,
        description:
          "Serial of the exact unit the customer chose, from search_stock or check_serial.",
      },
      custName: {
        type: "string",
        maxLength: 80,
        description: "The customer's name, if they gave one.",
      },
      note: {
        type: "string",
        maxLength: 280,
        description: "What the customer wants, in one short sentence.",
      },
    },
    required: ["when", "serial"],
    additionalProperties: false,
  },
};

const CANCEL_RESERVATION: Anthropic.Tool = {
  name: "cancel_reservation",
  description:
    "Cancel a booking this customer made, and release the unit that was held for it. Only ever " +
    "touches this customer's own booking.",
  input_schema: {
    type: "object",
    properties: {
      code: {
        type: "string",
        maxLength: 30,
        description:
          "The booking code, for example RV-2026/08-000012, if the customer gave one.",
      },
    },
    required: [],
    additionalProperties: false,
  },
};

/** Reads, plus the escalation exit. Always offered. */
export const READ_TOOLS = [
  "search_stock",
  "check_serial",
  "store_info",
  "browse_catalog",
  "lookup_customer",
  "check_order",
  "search_knowledge",
  "handoff_to_staff",
] as const;

/** Writes: offered only to a caller holding a reserve capability. */
export const WRITE_TOOLS = ["create_reservation", "cancel_reservation"] as const;

/** The complete surface. Changing this array is a policy decision. */
export const ANTHROPIC_TOOLS: Anthropic.Tool[] = [
  SEARCH_STOCK,
  CHECK_SERIAL,
  STORE_INFO,
  BROWSE_CATALOG,
  LOOKUP_CUSTOMER,
  CHECK_ORDER,
  SEARCH_KNOWLEDGE,
  HANDOFF,
  CREATE_RESERVATION,
  CANCEL_RESERVATION,
];

/**
 * The tools this caller may actually see.
 *
 * A model cannot call a tool that was never in the array. This is the strongest
 * control in the design and it costs one function: with no reserve capability
 * `create_reservation` is not merely refused, it does not exist.
 */
export function toolsFor(ctx: ToolContext): Anthropic.Tool[] {
  const allowed: readonly string[] = ctx.reserve
    ? [...READ_TOOLS, ...WRITE_TOOLS]
    : READ_TOOLS;
  return ANTHROPIC_TOOLS.filter((t) => allowed.includes(t.name));
}

// --- the shop's static facts -----------------------------------------------

/**
 * Deliberately plain sentences with no bullet characters or print punctuation:
 * a small model copies the shape of whatever a tool hands it, so a tool that
 * returns a formatted list gets a formatted list back in a WhatsApp message.
 */
const STORE_FACTS: Record<string, string> = {
  payment:
    "We take cash, bank transfer, QRIS, debit and credit card, and instalments.",
  warranty:
    "Every unit carries a 90 day shop warranty covering hardware faults that are not caused by " +
    "damage, liquid or software. Keep the receipt as proof.",
  grade:
    "Grade A is near mint with only faint marks. Grade B has visible wear but nothing that " +
    "affects use. Grade C is well used and looks it. Every grade is tested and works.",
};

/**
 * What the agent is told when nothing matched.
 *
 * It once turned an empty result into "unit-nya baru sold tadi" — a reason the
 * tool never gave it. So the result now says outright that the reason is
 * unknown, and carries real alternatives so there is nothing left to invent.
 */
const NEVER_INVENT_REASON =
  "There is no unit matching this that can be booked right now. You do NOT know why. Do not say " +
  "it was just sold, do not say it was just taken, do not say it is out of stock. Say only that " +
  "you could not book that one, then offer the alternatives listed here if there are any.";

// --- stock -----------------------------------------------------------------

/** Words that carry no signal, so "macbook 13 inch" narrows on the useful part. */
const STOPWORDS = new Set([
  "inch", "inci", "ram", "ssd", "unit", "dan", "atau", "yang", "gb", "grade",
]);

/**
 * The condition grade, read out of the customer's own words.
 *
 * `Unit.grade` is a real column and a real thing customers ask for, but it
 * appears in no name the query matches, so "Air M2 grade A" tokenised to a word
 * matching nothing and the search came back empty. The bot then told a customer
 * that grade was out of stock while the shop held twenty eight of them, which
 * is a lost sale caused by a tokeniser.
 *
 * Read off the query rather than taken as an argument, and the distinction is
 * not cosmetic. `tools.schema.test.ts` bans `grade` from every input schema by
 * name, alongside price, quantity and status: the model supplies entity values,
 * never state. A free-text query is already an entity value, and interpreting
 * it here is the same server-side reading that `tokens` has always done. So the
 * bug is fixed without widening what the model is allowed to say.
 */
function gradeIn(query: string | undefined): "A" | "B" | "C" | undefined {
  const m = /\bgrade\s*([abc])\b/i.exec(query ?? "");
  const letter = m?.[1]?.toUpperCase();
  return letter === "A" || letter === "B" || letter === "C" ? letter : undefined;
}

/**
 * Split a customer's phrase into tokens that must ALL match something.
 *
 * A single `contains` of the whole string only works when the customer types
 * the words in the order the catalogue happens to store them. Tokenising means
 * "m2 air" and "macbook 256gb" both land, which is how people actually type.
 */
function tokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,/|·]+/)
    // `%` and `_` are LIKE wildcards, and Prisma's `contains` does not escape
    // them. Without this a customer typing "%" matches every row in the table.
    .map((t) => t.trim().replace(/[%_\\]/g, ""))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .slice(0, 6);
}

/**
 * The one place the sellable filter is written.
 *
 * Built once and shared by the listing, the count and the reservation path. The
 * previous build had the same predicate in two places, they drifted, and a
 * customer was told "stok 4 unit" and then watched the booking fail.
 */
function stockWhere(args: {
  query?: string;
  minPrice?: bigint;
  maxPrice?: bigint;
}) {
  // An unusable query narrows to nothing rather than widening to everything.
  // "%" must not list the whole shop.
  const words = args.query ? tokens(args.query) : [];
  const unusable = Boolean(args.query?.trim()) && words.length === 0;
  const grade = gradeIn(args.query);
  return {
    status: "TERSEDIA" as const,
    archivedAt: null,
    ...(grade ? { grade } : {}),
    // Price lives on the SKU, so a budget filter is a filter on the variant.
    // No `not: null` any more — `Sku.price` is NOT NULL, so "in stock" and
    // "has a price" are the same set and the old guard against an unpriced
    // unit reaching a customer has nothing left to guard.
    sku: {
      archived: false,
      model: { archived: false },
      ...(args.minPrice !== undefined || args.maxPrice !== undefined
        ? {
            price: {
              ...(args.minPrice !== undefined ? { gte: args.minPrice } : {}),
              ...(args.maxPrice !== undefined ? { lte: args.maxPrice } : {}),
            },
          }
        : {}),
    },
    // An empty serial is valid text and can never be a real one. A NUL byte
    // would be the obvious sentinel and Postgres rejects it outright.
    ...(unusable ? { serial: "" } : {}),
    ...(words.length
      ? {
          AND: words.map((t) => ({
            OR: [
              { sku: { name: { contains: t, mode: "insensitive" as const } } },
              {
                sku: {
                  variantLabel: { contains: t, mode: "insensitive" as const },
                },
              },
              {
                sku: {
                  model: { name: { contains: t, mode: "insensitive" as const } },
                },
              },
              {
                sku: {
                  model: {
                    category: {
                      name: { contains: t, mode: "insensitive" as const },
                    },
                  },
                },
              },
            ],
          })),
        }
      : {}),
  };
}

/** How the shop says a unit out loud. `Sku.name` alone reads "Air M2 256GB". */
const label = (u: {
  sku: {
    name: string;
    variantLabel: string | null;
    model: { name: string; category: { name: string } };
  };
}) => ({
  model: u.sku.model.name.startsWith(u.sku.model.category.name)
    ? u.sku.name
    : `${u.sku.model.category.name} ${u.sku.name}`,
  ...(u.sku.variantLabel ? { variant: u.sku.variantLabel } : {}),
});

const UNIT_SELECT = {
  serial: true,
  grade: true,
  sku: {
    select: {
      name: true,
      variantLabel: true,
      // The price, since 2026-08-27. It is a property of the variant, so two
      // units of one SKU quote the same money whatever their grade — and the
      // bot must never be the thing that says otherwise.
      price: true,
      model: { select: { name: true, category: { select: { name: true } } } },
    },
  },
} as const;

async function searchStock(db: PrismaClient, args: Record<string, unknown>) {
  const query = String(args["query"] ?? "").trim();
  const num = (v: unknown): bigint | undefined =>
    typeof v === "number" && Number.isFinite(v) && v > 0
      ? BigInt(Math.floor(v))
      : undefined;
  const where = stockWhere({
    query,
    minPrice: num(args["minPrice"]),
    maxPrice: num(args["maxPrice"]),
  });
  const sort = String(args["sort"] ?? "newest");
  const orderBy =
    sort === "cheapest"
      ? ({ sku: { price: "asc" } } as const)
      : sort === "priciest"
        ? ({ sku: { price: "desc" } } as const)
        : ({ intakeAt: "desc" } as const);

  const [units, total] = await Promise.all([
    db.unit.findMany({ where, select: UNIT_SELECT, orderBy, take: SEARCH_LIMIT }),
    db.unit.count({ where }),
  ]);

  return {
    matched: total,
    showing: units.length,
    // `matched` is for the model's judgement, and reading it out as a headline
    // is what made the bot sound like a query result: "ada 90 unit bahkan".
    // Answering "how many are left" is a fair question and still gets a number.
    guidance:
      "matched is how many sellable units fit this search. Answer with the number when the " +
      "customer actually asked how many are left. Otherwise do not lead with it, just say what " +
      "there is and pick the one that suits them.",
    ...(total > units.length
      ? {
          // This note used to end "Ask the customer what they need so you can
          // narrow it down", and a tool result is read as an instruction: a
          // customer who had already said "17jtan buat kerja" got asked what
          // kind of work, because the tool had just told the model to ask. The
          // narrowing that was wanted is of the SEARCH, and the model is the
          // one holding the query.
          note:
            `${total} units match and these ${units.length} are an arbitrary slice of them, not ` +
            `the best ones. Narrow the SEARCH rather than asking the customer to narrow it for ` +
            `you: search again with a query naming the kind of machine they need, and sort by ` +
            `price so the list means something. Then recommend from what comes back.`,
        }
      : {}),
    units: units.map((u) => ({
      serial: u.serial,
      ...label(u),
      ...(u.grade ? { grade: u.grade } : {}),
      price: formatRupiah(u.sku.price),
    })),
  };
}

async function checkSerial(db: PrismaClient, args: Record<string, unknown>) {
  const serial = String(args["serial"] ?? "").trim();
  if (!serial) return { error: "No serial given." };

  const unit = await db.unit.findUnique({
    where: { serial },
    select: {
      ...UNIT_SELECT,
      status: true,
      archivedAt: true,
      // Spelled out rather than spread, because this select REPLACES the one
      // in UNIT_SELECT rather than merging with it — `price` has to be named
      // again here or the quote falls off the answer.
      sku: {
        select: {
          name: true,
          variantLabel: true,
          price: true,
          archived: true,
          model: {
            select: {
              name: true,
              archived: true,
              category: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!unit) return { found: false, note: "No unit with that serial in this shop." };

  const available =
    unit.status === "TERSEDIA" &&
    unit.archivedAt === null &&
    !unit.sku.archived &&
    !unit.sku.model.archived;

  // The raw status is deliberately NOT returned. Telling a stranger who guessed
  // a serial that a device is HILANG or KLAIM_GARANSI is an invitation, and it
  // is a fact about the shop's problems rather than about their purchase.
  return {
    found: true,
    serial: unit.serial,
    ...label(unit),
    ...(unit.grade ? { grade: unit.grade } : {}),
    available,
    ...(available
      ? { price: formatRupiah(unit.sku.price) }
      : {
          note: "This unit is not available. You do not know why, so do not speculate.",
        }),
  };
}

async function browseCatalog(db: PrismaClient) {
  const where = stockWhere({});
  // Counts only. The price range used to be `_min`/`_max` over the units in
  // each group, which was the right question while a unit carried its own
  // price; now every unit of a SKU quotes the SKU's price, so the range across
  // a model is the range across its VARIANTS and comes from the rows below.
  const grouped = await db.unit.groupBy({
    by: ["skuId"],
    where,
    _count: { _all: true },
  });
  if (grouped.length === 0) return { categories: [] };

  const skus = await db.sku.findMany({
    where: { id: { in: grouped.map((g) => g.skuId).slice(0, 200) } },
    select: {
      id: true,
      name: true,
      price: true,
      model: { select: { name: true, category: { select: { name: true } } } },
    },
  });
  const byId = new Map(skus.map((s) => [s.id, s]));

  const cats = new Map<
    string,
    Map<string, { available: number; min: bigint | null; max: bigint | null }>
  >();
  for (const g of grouped) {
    const sku = byId.get(g.skuId);
    if (!sku) continue;
    const cat = sku.model.category.name;
    const model = sku.model.name;
    const models = cats.get(cat) ?? new Map();
    const cur = models.get(model) ?? { available: 0, min: null, max: null };
    cur.available += g._count._all;
    // Still BigInt, and still the easiest leak in the whole file to miss —
    // `toolJson` would fail the turn on one. `Sku.price` is NOT NULL, so the
    // null checks the unit column needed are gone.
    if (cur.min === null || sku.price < cur.min) cur.min = sku.price;
    if (cur.max === null || sku.price > cur.max) cur.max = sku.price;
    models.set(model, cur);
    cats.set(cat, models);
  }

  return {
    categories: [...cats.entries()].slice(0, 8).map(([category, models]) => ({
      category,
      available: [...models.values()].reduce((n, m) => n + m.available, 0),
      models: [...models.entries()].slice(0, 8).map(([model, m]) => ({
        model,
        available: m.available,
        ...(rp(m.min) ? { priceFrom: rp(m.min) } : {}),
        ...(rp(m.max) ? { priceTo: rp(m.max) } : {}),
      })),
    })),
  };
}

// --- live context ----------------------------------------------------------

/**
 * The shops, and an honest note about the ones with no address on file.
 *
 * `Location.address` is nullable and today the shop's only TOKO row has none.
 * Returning a name and nothing else read to the model as an address it simply
 * had not been handed, and it improvised around the hole: asked to say where
 * the shop was, it answered "Tokonya di Bandung kak. Jalan mana nih yang paling
 * deket buat kamu", which is a question no shop asks and an address the
 * customer still does not have. Naming the gap is what turns that into a
 * handover.
 */
function shopBlock(shops: ReadonlyArray<{ name: string; address: string | null }>) {
  const withAddress = shops.filter((s) => s.address);
  return {
    shops: shops.map((s) => ({
      name: s.name,
      ...(s.address ? { address: s.address } : {}),
    })),
    note:
      withAddress.length === 0
        ? "The shop's street address is NOT recorded, so you do not have it and must not " +
          "describe, guess or approximate one. Say plainly that you will send the exact address, " +
          "hand over with handoff_to_staff, and keep helping with everything else meanwhile."
        : "Give the full address only once the customer asks to visit.",
  };
}

async function storeInfo(
  db: PrismaClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
) {
  const topic = String(args["topic"] ?? "all");
  const open = storeOpenAt(ctx.now);

  const live = {
    today: jakartaDate(ctx.now),
    weekday: jakartaWeekday(ctx.now),
    timeNow: jakartaTime(ctx.now),
    openNow: open,
    hours: `The shop is open every day from ${STORE_HOURS.openHour}:00 to ${STORE_HOURS.closeHour}:00 Jakarta time.`,
    ...(open
      ? {}
      : {
          note: `The shop is shut right now. It opens again at ${STORE_HOURS.openHour}:00. Do not promise a reply in a few minutes.`,
        }),
  };

  if (topic === "hours") return live;

  if (topic === "address") {
    // TOKO only. A customer never needs the warehouse, the service bench or a
    // transit location, and those addresses are not theirs to have.
    const shops = await db.location.findMany({
      where: { active: true, kind: "TOKO" },
      select: { name: true, address: true },
      orderBy: { sortOrder: "asc" },
    });
    return { ...shopBlock(shops) };
  }

  if (topic === "all") {
    const shops = await db.location.findMany({
      where: { active: true, kind: "TOKO" },
      select: { name: true, address: true },
      orderBy: { sortOrder: "asc" },
    });
    return { ...live, ...STORE_FACTS, ...shopBlock(shops) };
  }

  const fact = STORE_FACTS[topic];
  return {
    [topic]: fact ?? "Not something the shop has recorded.",
  };
}

// --- the sender's own record -----------------------------------------------

/** Statuses a customer should be reminded of. BATAL and APPROVAL are internal. */
const VISIBLE_ORDERS = ["LUNAS", "BELUM", "RETUR", "RETUR_SEBAGIAN"] as const;

async function lookupCustomer(db: PrismaClient, ctx: ToolContext) {
  const phones = phoneForms(ctx.from);

  const customer = await db.customer.findFirst({
    // Name and createdAt ONLY. `email`, `street`, `zip` and `note` are never
    // returned, not even to the sender: a WhatsApp number can change hands, and
    // reading a stored home address back to whoever holds it now is a leak.
    where: { phone: { in: phones } },
    select: { id: true, name: true, createdAt: true },
  });

  const owned = customer
    ? [{ customerId: customer.id }, { phone: { in: phones } }]
    : [{ phone: { in: phones } }];

  const [orders, reservations] = await Promise.all([
    db.order.findMany({
      where: { OR: owned, status: { in: [...VISIBLE_ORDERS] } },
      select: {
        code: true,
        ts: true,
        status: true,
        total: true,
        items: {
          select: { name: true, variant: true, qty: true, garansiUntil: true },
          take: 6,
        },
      },
      orderBy: { ts: "desc" },
      take: ORDER_LIMIT,
    }),
    db.reservation.findMany({
      where: { OR: owned, status: "TERJADWAL" },
      select: {
        code: true,
        scheduledFor: true,
        note: true,
        items: {
          select: {
            qty: true,
            sku: { select: { name: true, variantLabel: true } },
            unit: { select: { serial: true } },
          },
          take: 5,
        },
      },
      orderBy: { createdAt: "desc" },
      take: RESERVATION_LIMIT,
    }),
  ]);

  if (!customer && orders.length === 0 && reservations.length === 0) {
    return {
      known: false,
      note:
        "This number has not bought from us before and has no bookings. Greet them as a new " +
        "customer. Do not ask for their phone number, we already have it.",
    };
  }

  return {
    known: true,
    ...(customer ? { name: customer.name, customerSince: jakartaDate(customer.createdAt) } : {}),
    orders: orders.map((o) => ({
      code: o.code,
      date: jakartaDate(o.ts),
      status: o.status,
      ...(rp(o.total) ? { total: rp(o.total) } : {}),
      items: o.items.map((i) => ({
        name: i.name,
        ...(i.variant ? { variant: i.variant } : {}),
        qty: i.qty,
        ...(i.garansiUntil
          ? {
              warrantyUntil: jakartaDate(i.garansiUntil),
              withinWarranty: i.garansiUntil.getTime() > ctx.now.getTime(),
            }
          : {}),
      })),
    })),
    reservations: reservations.map((r) => ({
      code: r.code,
      ...(r.scheduledFor
        ? { when: `${jakartaDate(r.scheduledFor)} ${jakartaTime(r.scheduledFor)}` }
        : {}),
      ...(r.note ? { note: r.note } : {}),
      items: r.items.map((i) =>
        [i.sku?.name, i.sku?.variantLabel].filter(Boolean).join(" "),
      ),
    })),
  };
}

async function checkOrder(
  db: PrismaClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
) {
  const code = String(args["code"] ?? "").trim();
  if (!code) return { error: "No purchase code given." };
  const phones = phoneForms(ctx.from);

  const customer = await db.customer.findFirst({
    where: { phone: { in: phones } },
    select: { id: true },
  });
  const owned = customer
    ? [{ customerId: customer.id }, { phone: { in: phones } }]
    : [{ phone: { in: phones } }];

  const order = await db.order.findFirst({
    // Scoped to the sender in the SAME query as the code. A two-step "find the
    // order, then check it is theirs" is one forgotten early return away from
    // reading out a stranger's purchase.
    where: { code: { equals: code, mode: "insensitive" }, OR: owned },
    select: {
      code: true,
      ts: true,
      status: true,
      total: true,
      items: {
        select: { name: true, variant: true, qty: true, garansiUntil: true },
        take: 10,
      },
    },
  });

  // Identical answer whether the code does not exist or belongs to somebody
  // else, so this is not an oracle for enumerating other people's purchases.
  if (!order)
    return {
      found: false,
      note: "No purchase with that code under this customer.",
    };

  return {
    found: true,
    code: order.code,
    date: jakartaDate(order.ts),
    status: order.status,
    ...(rp(order.total) ? { total: rp(order.total) } : {}),
    items: order.items.map((i) => ({
      name: i.name,
      ...(i.variant ? { variant: i.variant } : {}),
      qty: i.qty,
      ...(i.garansiUntil
        ? {
            warrantyUntil: jakartaDate(i.garansiUntil),
            withinWarranty: i.garansiUntil.getTime() > ctx.now.getTime(),
          }
        : {}),
    })),
  };
}

/** How many approved answers one search may return. */
const KNOWLEDGE_LIMIT = 6;

/**
 * The staff-written answers, searched rather than recited.
 *
 * These already ride in the system prompt, but only the forty most recently
 * edited, and a prompt block is something the model may or may not reach for.
 * A tool call is different in two ways that matter: it scales past whatever
 * fits in a prompt, and its result arrives as a fact retrieved in THIS turn,
 * which is exactly the standing the grounding rules give to a tool result and
 * withhold from the model's own memory.
 *
 * Staff-authored and `active: true` only, so this is the shop talking, not the
 * model. A customer can never write into it.
 */
async function searchKnowledge(db: PrismaClient, args: Record<string, unknown>) {
  const query = String(args["query"] ?? "").trim();
  if (!query) return { error: "No question given." };

  const words = tokens(query);
  // A query was given but nothing usable survived it — punctuation, a wildcard,
  // a single letter. Returning "no filter" here would hand back the entire
  // knowledge base as though every entry answered the question.
  if (words.length === 0) {
    return {
      found: false,
      guidance:
        "The shop has not written an answer for this. Do NOT work one out yourself. Say you will " +
        "check with a colleague, and use handoff_to_staff.",
    };
  }

  const entries = await db.agentKnowledge.findMany({
    where: {
      active: true,
      ...(words.length
        ? {
            OR: words.flatMap((w) => [
              { question: { contains: w, mode: "insensitive" as const } },
              { answer: { contains: w, mode: "insensitive" as const } },
            ]),
          }
        : {}),
    },
    select: { question: true, answer: true },
    orderBy: { updatedAt: "desc" },
    take: KNOWLEDGE_LIMIT,
  });

  if (entries.length === 0) {
    return {
      found: false,
      guidance:
        "The shop has not written an answer for this. Do NOT work one out yourself. Say you will " +
        "check with a colleague, and use handoff_to_staff.",
    };
  }

  return {
    found: true,
    answers: entries,
    guidance:
      "These are approved by the shop and are correct. Reword them into your own voice, do not " +
      "read them out word for word, and do not add anything they do not say.",
  };
}

/**
 * Every `guidance` string in this file is briefing, never copy.
 *
 * This one used to read "The shop is shut. Tell the customer a colleague will
 * reply tomorrow from 10:00", and the bot sent the customer almost exactly
 * that: "nanti besok jam 10 pagi ada kolega yang bakal reply langsung sama
 * kasih tahu stok dan alamat toko ya". A small model copies the shape of what a
 * tool hands it, which the docblock at the top of this file already says about
 * formatting and is just as true of phrasing. So the guidance now states the
 * fact and says outright that the words are the model's own job.
 */
function handoff(args: Record<string, unknown>, ctx: ToolContext) {
  const topic = String(args["topic"] ?? "other");
  const open = storeOpenAt(ctx.now);
  return {
    handoff: true,
    topic,
    staffAvailable: open,
    guidance: open
      ? "Somebody from the shop takes this from here. Say so in your own words, warmly and in " +
        "one line, and do not promise a number of minutes. Do not read this sentence out, and " +
        "do not invent a person: it is the shop following up, not a named friend or relative."
      : `The shop is shut now and opens again at ${STORE_HOURS.openHour}:00. Say somebody from ` +
        "the shop will come back to them in the morning, in your own words and in one line. " +
        "Keep the customer warm rather than filing them away. Do not read this sentence out, " +
        "and do not invent a person: it is the shop following up, not a named friend or relative.",
  };
}

// --- the guarded write -----------------------------------------------------

/**
 * Jakarta wall clock to a real instant.
 *
 * Indonesia has no daylight saving, so a literal `+07:00` is exact and needs no
 * zone library. The parse is strict on purpose: the previous build stored the
 * word "besok" in a `DateTime` column because a lenient parser let it through.
 */
export function parseJakarta(when: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(when.trim());
  if (!m) return null;
  const at = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+07:00`);
  if (Number.isNaN(at.getTime())) return null;
  // A lenient Date rolls 2026-02-30 forward into March. Round-trip to catch it.
  return jakartaDate(at) === `${m[1]}-${m[2]}-${m[3]}` ? at : null;
}

async function alternativesFor(
  db: PrismaClient,
  skuId: string | null,
): Promise<Array<Record<string, unknown>>> {
  if (!skuId) return [];
  const units = await db.unit.findMany({
    where: { ...stockWhere({}), skuId },
    select: UNIT_SELECT,
    orderBy: { intakeAt: "desc" },
    take: 3,
  });
  return units.map((u) => ({
    serial: u.serial,
    ...label(u),
    price: formatRupiah(u.sku.price),
  }));
}

/**
 * Book a visit and hold a machine.
 *
 * The hold itself lives in `packages/db`'s `createHold`, which the POS and the
 * expiry sweep also call — one implementation, so a rule cannot be true at the
 * counter and false in a conversation. What stays here is everything that is
 * about talking to a customer rather than about holding stock: the capability
 * gate, the per-turn write guard, reading a date out of ordinary words, and
 * every sentence the model is handed.
 */
async function createReservation(
  args: Record<string, unknown>,
  ctx: ToolContext,
) {
  if (!ctx.reserve) return { error: "Booking is not available on this channel." };

  // Claimed synchronously, before the first await: `converse` runs a step's
  // tool calls through Promise.all, so two create_reservation blocks in one
  // step would both pass an awaited check.
  const guard = ctx.writesUsed;
  if (guard) {
    if (guard.has("create_reservation"))
      return {
        alreadyBooked: true,
        guidance:
          "You have already booked for this customer in this reply. Repeat the code you were " +
          "given, do not make a second booking.",
      };
    guard.add("create_reservation");
  }

  const when = String(args["when"] ?? "").trim();
  if (!when) return { needWhen: true };
  const at = parseJakarta(when);
  if (!at)
    return {
      needWhen: true,
      note: "The date was not understood. Send it as YYYY-MM-DDTHH:MM in Jakarta time.",
    };

  const serial = String(args["serial"] ?? "").trim();
  if (!serial) return { needSerial: true };

  const { write, staffId } = ctx.reserve;
  const e164 = toE164(ctx.from);
  const name =
    String(args["custName"] ?? "").trim() || ctx.profileName?.trim() || e164;
  const rawNote = String(args["note"] ?? "").trim();

  try {
    const hold = await write.$transaction(
      (tx) =>
        createHold(tx, {
          serials: [serial],
          staffId,
          customer: { phone: e164, name },
          scheduledFor: at,
          // The customer's own words. `createHold` marks them `[agen]`, because
          // they render in a staff-facing POS and must read as quoted input.
          note: rawNote || null,
          // The ledger's note is attribution the shop composed. Never the
          // customer's text: `UnitEvent` is append-only.
          eventNote: `Reservasi agen untuk ${e164}`,
          source: "AGEN",
          at: ctx.now,
          // Idempotency across ticks, scoped to this sender's own bookings. A
          // staff booking does not block a bot one, and never has.
          duplicateScope: { phone: e164, source: "AGEN" },
          // What a bot may promise unattended. The POS opts into none of this:
          // a staff member can see the customer, and has never been asked to
          // justify a collection outside opening hours.
          policy: {
            requireFuture: true,
            maxBookingDays: MAX_BOOKING_DAYS,
            storeHours: STORE_HOURS,
          },
        }),
      TXN_TIMEOUTS,
    );

    return toolJson({
      ok: true,
      code: hold.code,
      when: `${jakartaDate(at)} ${jakartaTime(at)}`,
      serial,
      guidance:
        "Give the customer the booking code and confirm the unit is now held for them.",
    });
  } catch (err) {
    // Ordinary answers, not failures. These are converted before anything else,
    // and NEITHER releases the turn guard through the failure path nor calls
    // ctx.onError — which is wired to logger.error("a grounding tool failed").
    // A customer asking for a machine somebody else holds is not a failed tool.
    if (err instanceof UnitNotAvailableError || err instanceof UnknownSerialError) {
      // Nothing was held, so a later step may legitimately try another serial.
      guard?.delete("create_reservation");
      const skuId =
        err instanceof UnitNotAvailableError ? (err.units[0]?.skuId ?? null) : null;
      const alternatives = await alternativesFor(write, skuId);
      return toolJson({
        unavailable: true,
        serial,
        guidance: NEVER_INVENT_REASON,
        ...(alternatives.length ? { alternatives } : {}),
      });
    }
    if (err instanceof DuplicateHoldError) {
      // The guard STAYS claimed: this result carries the real code, so
      // "repeat the code you were given" is a true instruction.
      return toolJson({
        alreadyBooked: true,
        code: err.code,
        ...(err.scheduledFor
          ? {
              when: `${jakartaDate(err.scheduledFor)} ${jakartaTime(err.scheduledFor)}`,
            }
          : {}),
        guidance:
          "This customer already has an open booking. Give them that code rather than making a " +
          "second one. To move it, cancel the old one first.",
      });
    }
    // The turn guard is deliberately NOT released for a schedule refusal, which
    // is what this tool has always done: the model asked for an impossible time
    // and gets one correction per turn, not an unbounded retry loop against the
    // clock. Releasing it would arguably be kinder — that is an owner's call,
    // not a refactor's.
    if (err instanceof BookingInPastError) {
      return { pastDate: true };
    }
    if (err instanceof BookingTooFarAheadError) {
      return { tooFarAhead: true, maxDays: err.maxDays };
    }
    if (err instanceof OutsideStoreHoursError) {
      return {
        closedThen: true,
        hours: `${err.openHour}:00 to ${err.closeHour}:00`,
        guidance:
          "The shop is shut at that time. Offer a time inside opening hours instead.",
      };
    }

    // A genuine failure: nothing was committed, so release the guard and say so
    // somewhere a person will see it.
    guard?.delete("create_reservation");
    ctx.onError?.("create_reservation", err);
    return {
      error:
        "Could not save the booking. Tell the customer a colleague will follow up, and do not " +
        "claim it was booked.",
    };
  }
}

/**
 * Let a booking go.
 *
 * `releaseHold` resolves which hold is meant under the same advisory lock it
 * releases under, scoped to this sender's own phone so a guessed code cannot
 * cancel a stranger's booking.
 */
async function cancelReservation(
  args: Record<string, unknown>,
  ctx: ToolContext,
) {
  if (!ctx.reserve) return { error: "Booking is not available on this channel." };
  const { write, staffId } = ctx.reserve;
  const e164 = toE164(ctx.from);
  const code = String(args["code"] ?? "").trim();

  try {
    const result = await write.$transaction(
      (tx) =>
        releaseHold(tx, {
          // No `source` filter, deliberately: a customer may cancel a hold a
          // staff member made for their number, and always could.
          target: { phone: e164, ...(code ? { code } : {}) },
          staffId,
          at: ctx.now,
          note: `Reservasi dibatalkan lewat chat`,
        }),
      TXN_TIMEOUTS,
    );

    if (result.skipped) return { notFound: true, code: result.code };

    // BATAL, never SELESAI. "The customer came and bought it" is a staff
    // assertion about the physical world, not one a chat can make — and
    // `headerState` yields BATAL because nothing on the hold sold.
    return toolJson({
      ok: true,
      code: result.code,
      released: result.released,
    });
  } catch (err) {
    if (err instanceof HoldNotFoundError) {
      // `ref` is null when they named nothing and nothing was open, and the
      // code when they named one that is not theirs. Two different sentences.
      return err.ref === null ? { none: true } : { notFound: true, code: err.ref };
    }
    if (err instanceof AmbiguousHoldError) {
      return { ambiguous: true, codes: err.codes };
    }
    if (err instanceof HoldAlreadySettledError) {
      // Behaviour preserved: the previous implementation filtered on
      // status=TERJADWAL, so a settled hold was simply not found. Telling the
      // customer it is "already SELESAI" would be better and is an owner
      // decision, not a refactor's to make.
      return { notFound: true, code: err.code };
    }
    ctx.onError?.("cancel_reservation", err);
    return { error: "Could not cancel the booking. Hand this to a colleague." };
  }
}

// --- dispatch --------------------------------------------------------------

/**
 * Run one tool call.
 *
 * A literal branch chain, never `handlers[name]`: an object indexed by a
 * model-supplied key answers to `"constructor"` and `"__proto__"`, and the
 * model chooses that key.
 *
 * Unknown names and malformed arguments return an error *object* rather than
 * throwing. The loop hands it straight back to the model, which corrects itself
 * or gives up gracefully; a thrown error would end the turn and lose the
 * customer's message.
 */
export async function dispatchTool(
  db: PrismaClient,
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  const args =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  try {
    let out: unknown;
    if (name === "store_info") out = await storeInfo(db, args, ctx);
    else if (name === "search_stock") out = await searchStock(db, args);
    else if (name === "check_serial") out = await checkSerial(db, args);
    else if (name === "browse_catalog") out = await browseCatalog(db);
    else if (name === "lookup_customer") out = await lookupCustomer(db, ctx);
    else if (name === "check_order") out = await checkOrder(db, args, ctx);
    else if (name === "search_knowledge") out = await searchKnowledge(db, args);
    else if (name === "handoff_to_staff") out = handoff(args, ctx);
    else if (name === "create_reservation")
      out = await createReservation(args, ctx);
    else if (name === "cancel_reservation")
      out = await cancelReservation(args, ctx);
    else return { error: `Unknown tool ${name}.` };

    // The gate. A BigInt reaching JSON.stringify in the loop throws, which is
    // caught as a model failure and escalates the whole thread — so a leak
    // degrades one tool call here instead of ending a live conversation.
    return toolJson(out);
  } catch (err) {
    ctx.onError?.(name, err);
    if (err instanceof ToolSerialisationError) return { error: "internal" };
    return {
      error: `The ${name} lookup failed. Say you will check and hand over to a colleague.`,
    };
  }
}
