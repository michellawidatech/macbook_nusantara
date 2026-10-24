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
  assertSchedule,
  createHold,
  releaseHold,
  rescheduleHold,
  recordStoreChanges,
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
import { loadKnowledgeBase, type KnowledgeBase } from "./knowledge.js";
import { isStrongMatch } from "./retrieval.js";
import {
  HANDOFF_TOPICS,
  PARALLEL_CAPABILITIES,
  effectiveCapabilities,
  type AgentCapabilities,
} from "./policy.js";
import { lookupCatalog } from "./systemFacts.js";

/** How many units one search may return. Past this the agent should narrow. */
const SEARCH_LIMIT = 12;

/** Caps on the sender's own history. Enough to be useful, not a data dump. */
const ORDER_LIMIT = 5;
const RESERVATION_LIMIT = 5;

import { STORE_HOURS } from "./hours.js";
export { STORE_HOURS };

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
    /**
     * How long after a missed appointment the worker's expiry pass lets the
     * hold go, so a booking can tell the customer until when it is held
     * rather than leaving the model to make that up.
     */
    readonly graceMs?: number;
  };
  /**
   * Present when the caller may record what the customer says about
   * themselves (`remember_customer`, owner ask 2026-09-29). The worker passes
   * it; the staff Draft page does not, because a draft must not write.
   */
  readonly profile?: { readonly write: PrismaClient };
  /**
   * The shop's switches (policy.ts). Read by the tools that can say a price,
   * so a figure is left out of a result the price switch forbids — the model
   * cannot quote what it was never shown.
   */
  readonly capabilities?: AgentCapabilities;
  /** Writes already made this turn, so a retry cannot double-book. */
  readonly writesUsed?: Set<string>;
  /**
   * The pass's knowledge base, already indexed (knowledge.ts), so a search
   * cites the same `K` handles the prompt shows. Absent, `search_knowledge`
   * loads and indexes the active answers itself.
   */
  readonly knowledge?: KnowledgeBase;
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

/**
 * The shop's own photographs of one machine (owner ask 2026-09-21: *"the
 * chatbot can send pictures per unit"*).
 *
 * It returns HANDLES, never bytes and never a URL: the model is given
 * `photoIds` and the sending is done by the worker, out of band, from the
 * database. That ordering is the whole safety of it — a model that never sees
 * an image cannot be talked into describing one, and a customer who guesses a
 * serial gets the same three pictures the shop would have sent anyway, with no
 * way to reach any other row.
 *
 * Only the photos QC took of THAT unit, and only while it can be bought. A
 * machine that is sold, reserved or written off returns nothing: its pictures
 * are a record, not a listing.
 */
const UNIT_PHOTOS: Anthropic.Tool = {
  name: "unit_photos",
  description:
    "The shop's own photos of one unit, by serial. Returns photo handles you pass to reply as " +
    "'photos'; you never see the pictures yourself, so describe nothing about them. Use it when " +
    "the customer asks for a photo, a real pic or to see the condition of a unit you have " +
    "already found with search_stock.",
  input_schema: {
    type: "object",
    properties: {
      serial: {
        type: "string",
        maxLength: 40,
        description: "The serial of the unit, as search_stock returned it.",
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
    "Search the answers the shop's owner has written and approved, for anything about how the " +
    "shop works: instalments, delivery, warranty, what comes in the box, trade-in, service. " +
    "Returns the best matches with their handles (K7). If nothing matches, the shop has not " +
    "answered it and a colleague must: use handoff_to_staff rather than working it out.",
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

const LOOKUP_CATALOG: Anthropic.Tool = {
  name: "lookup_catalog",
  description:
    "Which models and which configurations the shop deals in, from its own catalogue: chip, " +
    "memory, storage, screen size, year. Specifications only. It never says what is in stock " +
    "or what anything costs, so it cannot answer either question.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        maxLength: 80,
        description:
          "The model as the customer named it, for example 'air m2' or 'pro 14 m3'.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

/**
 * The only way an answer reaches a customer (converse.ts): the words, and what
 * they rest on. `sources` is one string rather than an array because no tool
 * here takes an array — tools.schema.test.ts holds every argument to a scalar.
 */
const REPLY: Anthropic.Tool = {
  name: "reply",
  description:
    "Send your answer to the customer. Everything it tells them must come from an approved " +
    "answer (cite its handle, like K7), the shop facts ('store'), a catalogue lookup " +
    "('catalog') or a stock lookup ('stock'). A greeting or a thank-you that states no fact " +
    "cites 'greeting'. If you cannot name a source for what they asked, use handoff_to_staff " +
    "instead.",
  input_schema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        maxLength: 1500,
        description:
          "Exactly what the customer will read, in the shop's voice.",
      },
      sources: {
        type: "string",
        maxLength: 120,
        description:
          "Comma-separated: the handles of the approved answers used (K3, K12), and/or store, catalog, stock or greeting.",
      },
      photos: {
        type: "string",
        maxLength: 300,
        description:
          "Comma-separated photo handles from unit_photos, when the customer asked to see the " +
          "unit. They are sent after your message. Leave it out otherwise.",
      },
    },
    required: ["message", "sources"],
    additionalProperties: false,
  },
};

const HANDOFF: Anthropic.Tool = {
  name: "handoff_to_staff",
  description:
    "Hand the conversation to a colleague. Use it for the stock, price or condition of a " +
    "particular machine, negotiation, picking a machine from today's shelf, bookings, payments " +
    "already made, trade-in or buy-back quotes, shipping costs, complaints and warranty claims, " +
    "when the customer asks for a person, and for ANYTHING the approved answers and the shop " +
    "facts do not cover. Never guess instead of using this.",
  input_schema: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        enum: [...HANDOFF_TOPICS],
        description: "What the colleague is picking up.",
      },
      summary: {
        type: "string",
        maxLength: 240,
        description:
          "For the colleague, in Indonesian: what the customer wants, naming the model or specification if they gave one.",
      },
      serial: {
        type: "string",
        maxLength: 40,
        description:
          "The serial of the unit this is about, when a stock lookup gave you one — so the " +
          "colleague sees the unit and its price without reading the chat.",
      },
      customer_message: {
        type: "string",
        maxLength: 600,
        description:
          "What the customer reads now: a short, warm line in the shop's voice saying the admin " +
          '("admin kami") will follow up in this chat. If an approved answer covers part of the ' +
          "question, answer that part first. No price, no stock, no promised time.",
      },
    },
    required: ["topic", "summary", "customer_message"],
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

/**
 * The shop's photos of the best unit that fits a description (owner ask
 * 2026-09-29): "if there are several, pick the best one — the most expensive —
 * tell the price, then ask whether they want to see another unit with better
 * specs or a better price; if there is only one, send its picture".
 */
const FIND_UNIT_PHOTOS: Anthropic.Tool = {
  name: "find_unit_photos",
  description:
    "Photos of a unit for a customer who asked to see one by model rather than by serial. Picks " +
    "the most expensive matching unit that has photos and returns its photo handles, which you " +
    "pass to reply as 'photos'. You never see the pictures, so describe nothing about them. " +
    "Follow the guidance in the result about offering another unit.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        maxLength: 120,
        description:
          "The model as the customer named it, for example 'air m2' or 'pro 14 m3 grade a'.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

const CHECK_RESERVATION: Anthropic.Tool = {
  name: "check_reservation",
  description:
    "This customer's own open bookings: the code, the day and time, and the unit held. Takes no " +
    "arguments, it is always about this conversation.",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

const RESCHEDULE_RESERVATION: Anthropic.Tool = {
  name: "reschedule_reservation",
  description:
    "Move this customer's own booking to another day or time. The unit stays held. Only ever " +
    "touches this customer's own booking. Call it only once they have given the new day and time.",
  input_schema: {
    type: "object",
    properties: {
      when: {
        type: "string",
        maxLength: 20,
        description:
          "The NEW Jakarta local date and time as YYYY-MM-DDTHH:MM. Work out the real date from " +
          "the shop facts first. Never send a word like besok.",
      },
      code: {
        type: "string",
        maxLength: 30,
        description:
          "The booking code, for example RV-2026/08-000012, if the customer has more than one.",
      },
    },
    required: ["when"],
    additionalProperties: false,
  },
};

/**
 * What the customer has told the bot about themselves (owner ask 2026-09-29:
 * "the goal is always to get to know the user first, store the user data").
 * Every field is the customer's own words; none of it is shop state.
 */
const REMEMBER_CUSTOMER: Anthropic.Tool = {
  name: "remember_customer",
  description:
    "Save what the customer has just told you about themselves, so the shop remembers it and " +
    "you never ask twice. Call it whenever they tell you their name, what they will use the " +
    "unit for, their budget, what they use now or a preference. Only what they actually said.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", maxLength: 80, description: "Their name." },
      use_case: {
        type: "string",
        maxLength: 160,
        description:
          "What they want it for, in a few words: kuliah, editing video, kantor.",
      },
      budget: {
        type: "integer",
        minimum: 1,
        description:
          "The budget they stated, in whole rupiah. 15 juta is 15000000.",
      },
      current_device: {
        type: "string",
        maxLength: 120,
        description: "What they use now, if they said.",
      },
      preference: {
        type: "string",
        maxLength: 200,
        description: "Anything else they want: size, colour, light, a grade.",
      },
      budget_min: {
        type: "integer",
        minimum: 1,
        description:
          "The bottom of their budget range in whole rupiah, when they gave a range.",
      },
      budget_max: {
        type: "integer",
        minimum: 1,
        description:
          "The top of their budget range in whole rupiah. 'di bawah 20 jt' is 20000000.",
      },
      age_estimate: {
        type: "string",
        maxLength: 20,
        description:
          "Your ESTIMATE of their age band, e.g. '18-22', only when something they said points " +
          "to it (school, kuliah, a job). Never ask their age.",
      },
      occupation: {
        type: "string",
        maxLength: 80,
        description:
          "Their job or school as they described it: 'mahasiswa DKV', 'programmer', 'guru'.",
      },
      usage: {
        type: "string",
        maxLength: 200,
        description:
          "What they mainly do on it, comma-separated: programming, design, video editing, office.",
      },
      apps: {
        type: "string",
        maxLength: 300,
        description:
          "Specific apps they named: VS Code, Photoshop, Premiere, Excel.",
      },
      preferences: {
        type: "string",
        maxLength: 300,
        description:
          "Product preferences, comma-separated: new, 14 inch, light, silver, M-series, 512GB.",
      },
      about: {
        type: "string",
        maxLength: 600,
        description:
          "Anything else worth a colleague knowing, short facts separated by semicolons.",
      },
    },
    required: [],
    additionalProperties: false,
  },
};

/**
 * Chatbot v2 step 5: a booking the customer has NOT yet agreed to. Holds
 * nothing. The customer's next message decides — and that decision is read by
 * the router and acted on by CODE (`confirm_reservation` is never offered to
 * a model), so no sentence of the model's can turn a proposal into a hold.
 */
const PROPOSE_RESERVATION: Anthropic.Tool = {
  name: "propose_reservation",
  description:
    "Prepare a visit to the shop to see one or more units in person. This does NOT book " +
    "anything: it returns the units and the time for the advisor to read back to the customer " +
    "for confirmation. Use the serials search_stock returned. A new proposal replaces the last.",
  input_schema: {
    type: "object",
    properties: {
      serials: {
        type: "string",
        maxLength: 120,
        description:
          "The serials of the units the customer wants to see, comma-separated, at most three.",
      },
      when: {
        type: "string",
        description: "The visit, YYYY-MM-DDTHH:MM in Jakarta time.",
      },
      custName: {
        type: "string",
        maxLength: 80,
        description: "The name the customer gave for the booking.",
      },
    },
    required: ["serials", "when", "custName"],
    additionalProperties: false,
  },
};

/** Reads, plus the escalation exit. */
export const READ_TOOLS = [
  "search_stock",
  "check_serial",
  "unit_photos",
  "find_unit_photos",
  "store_info",
  "browse_catalog",
  "lookup_customer",
  "check_order",
  "search_knowledge",
  "lookup_catalog",
  "check_reservation",
  "handoff_to_staff",
] as const;

/** How a turn ends: an answer with its sources, or a colleague (converse.ts). */
export const TERMINAL_TOOLS = ["reply", "handoff_to_staff"] as const;

/**
 * What a customer's conversation is offered while the shop runs this app in
 * parallel with B2Soft (owner, 2026-09-18). Production holds the catalogue,
 * the store and the staff, and NOT the shop's real stock or prices, so every
 * tool that reads a unit, a price, an order or a booking stays out of the
 * array — a model cannot call a tool it was never given. The shop facts ride
 * in the prompt itself (systemFacts.ts), so `store_info` is not needed.
 *
 * Bringing stock answers back is a change to this list and to the prompt's
 * rules, the day the stock in this database is the shop's stock.
 */
export const CUSTOMER_TOOLS = [
  "search_knowledge",
  "lookup_catalog",
  "reply",
  "handoff_to_staff",
] as const;

/**
 * What is added when the bot may read the shelf (owner ask 2026-09-21).
 *
 * `lookup_customer` is in it, and it earns its place twice over: the owner
 * asked the bot to *"focus more on how to get to know the user"*, and the
 * cheapest way to sound like a shop that knows somebody is to not ask them a
 * question they have already answered. It reads that sender's own name, their
 * past purchases and their own booking — nobody else's.
 */
export const STOCK_TOOLS = [
  "search_stock",
  "check_serial",
  "browse_catalog",
  "lookup_customer",
  "check_order",
] as const;

/** The photo switch's tools. */
export const PHOTO_TOOLS = ["unit_photos", "find_unit_photos"] as const;

/**
 * The booking switch's tools — the whole lifecycle since 2026-09-29 (owner:
 * "make / check / edit / cancel reservation"). Each is scoped to the sender's
 * phone from the WhatsApp envelope, never an argument.
 */
export const RESERVATION_TOOLS = [
  "create_reservation",
  "check_reservation",
  "reschedule_reservation",
  "cancel_reservation",
] as const;

/** Offered whenever the caller can record a profile, whatever the switches. */
export const PROFILE_TOOLS = ["remember_customer"] as const;

/**
 * Chatbot v2's booking door: propose, then the CODE confirms. Offered only to
 * a caller that asks for it (`toolsFor(…, { proposals: true })`) — the v1
 * agent books directly and would leave a proposal nobody confirms.
 */
export const PROPOSAL_TOOLS = ["propose_reservation"] as const;

/** Run by code on the router's reading of the customer's reply; never offered. */
export const CODE_ONLY_TOOLS = ["confirm_reservation"] as const;

/**
 * Writes: offered only to a caller holding a reserve capability.
 *
 * ⚠️ `cancel_reservation` is NOT offered to a customer's conversation since
 * 2026-09-21 — *"the only write operation is to make a reservation"*. It still
 * exists, and `dispatchTool` still answers it, because the staff Draft page
 * and the tests both reach it; what changed is `toolsFor`, which is the only
 * thing a model can see. A customer asking to cancel goes to a person, which
 * is also where somebody can ask them why.
 */
export const WRITE_TOOLS = [
  "create_reservation",
  "reschedule_reservation",
  "cancel_reservation",
] as const;

/** The complete surface. Changing this array is a policy decision. */
export const ANTHROPIC_TOOLS: Anthropic.Tool[] = [
  SEARCH_STOCK,
  CHECK_SERIAL,
  UNIT_PHOTOS,
  FIND_UNIT_PHOTOS,
  STORE_INFO,
  BROWSE_CATALOG,
  LOOKUP_CUSTOMER,
  CHECK_ORDER,
  SEARCH_KNOWLEDGE,
  LOOKUP_CATALOG,
  HANDOFF,
  REPLY,
  CREATE_RESERVATION,
  CHECK_RESERVATION,
  RESCHEDULE_RESERVATION,
  CANCEL_RESERVATION,
  REMEMBER_CUSTOMER,
  PROPOSE_RESERVATION,
];

/**
 * The tools this caller may actually see.
 *
 * A model cannot call a tool that was never in the array. This is the strongest
 * control in the design and it costs one function. During the parallel
 * operation it is `CUSTOMER_TOOLS` for every caller — the worker's reserve
 * capability included, because a booking holds a unit this database does not
 * truly have.
 *
 * `handoffOnly` drops `reply`: the message has already been routed to a person
 * (policy.ts `routeMessage`), so the one way to end the turn is to say so.
 */
export function toolsFor(
  ctx: ToolContext,
  opts: {
    handoffOnly?: boolean;
    /** What the bot may do for itself. Defaults to the 2026-09-18 design. */
    capabilities?: AgentCapabilities;
    /** Chatbot v2: offer `propose_reservation` with the booking tools. */
    proposals?: boolean;
  } = {},
): Anthropic.Tool[] {
  const can = effectiveCapabilities(opts.capabilities ?? PARALLEL_CAPABILITIES);
  const names = new Set<string>(CUSTOMER_TOOLS);
  if (ctx.profile !== undefined) for (const n of PROFILE_TOOLS) names.add(n);
  if (can.stock) for (const n of STOCK_TOOLS) names.add(n);
  // The photo tools are their own switch: a shop may want the bot quoting
  // stock without it sending pictures nobody has looked at.
  if (can.photos) for (const n of PHOTO_TOOLS) names.add(n);
  /*
   * A booking needs BOTH the shop's switch and the caller's own capability.
   * The staff Draft page passes no `reserve` capability at all, because
   * pressing Draft should propose a sentence and not book a reservation — so
   * a booking tool reaching it would be a button with a side effect nobody
   * asked for.
   */
  if (can.reserve && ctx.reserve !== undefined) {
    for (const n of RESERVATION_TOOLS) names.add(n);
    if (opts.proposals) for (const n of PROPOSAL_TOOLS) names.add(n);
  }
  if (opts.handoffOnly) names.delete("reply");
  return ANTHROPIC_TOOLS.filter((t) => names.has(t.name));
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
  // The owner's warranty is in the approved answers (1 month, 2026-09-18). It
  // said 90 days here, which nobody at the shop ever offered; a policy written
  // twice is two policies.
  warranty:
    "The warranty terms are in the shop's approved answers. Use search_knowledge for 'garansi' " +
    "and do not state a term from here.",
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
  "inch",
  "inci",
  "ram",
  "ssd",
  "unit",
  "dan",
  "atau",
  "yang",
  "gb",
  "grade",
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
  return letter === "A" || letter === "B" || letter === "C"
    ? letter
    : undefined;
}

/**
 * Split a customer's phrase into tokens that must ALL match something.
 *
 * A single `contains` of the whole string only works when the customer types
 * the words in the order the catalogue happens to store them. Tokenising means
 * "m2 air" and "macbook 256gb" both land, which is how people actually type.
 */
function tokens(query: string): string[] {
  return (
    query
      .toLowerCase()
      .split(/[\s,/|·]+/)
      // `%` and `_` are LIKE wildcards, and Prisma's `contains` does not escape
      // them. Without this a customer typing "%" matches every row in the table.
      .map((t) => t.trim().replace(/[%_\\]/g, ""))
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
      .slice(0, 6)
  );
}

/**
 * The one place the sellable filter is written.
 *
 * Built once and shared by the listing, the count and the reservation path. The
 * previous build had the same predicate in two places, they drifted, and a
 * customer was told "stok 4 unit" and then watched the booking fail.
 */
function stockWhere(args: { query?: string }) {
  // An unusable query narrows to nothing rather than widening to everything.
  // "%" must not list the whole shop.
  const words = args.query ? tokens(args.query) : [];
  const unusable = Boolean(args.query?.trim()) && words.length === 0;
  const grade = gradeIn(args.query);
  return {
    status: "TERSEDIA" as const,
    archivedAt: null,
    ...(grade ? { grade } : {}),
    // The budget is NOT filtered here since 2026-09-29: a unit's price is
    // `Unit.price ?? Sku.price` and Prisma cannot compare a COALESCE, so
    // `searchStock` filters on `askingPrice` after the read.
    sku: {
      archived: false,
      model: { archived: false },
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
                  model: {
                    name: { contains: t, mode: "insensitive" as const },
                  },
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

/**
 * What THIS unit asks: its own price, else its variant's (owner revision
 * 2026-09-08 — price is per unit, `Sku.price` is only where one starts). Null
 * when the POS holds no price, or holds 0: the bot must never quote a unit the
 * shop has not priced, and 0 is a price nobody set (owner ask 2026-09-29).
 */
export function askingPrice(u: {
  readonly price: bigint | null;
  readonly sku: { readonly price: bigint };
}): bigint | null {
  const p = u.price ?? u.sku.price;
  return p > 0n ? p : null;
}

const NO_PRICE_NOTE =
  "The shop has not set a price for this unit. Do NOT state, estimate or round one. If the " +
  "customer wants the price, use handoff_to_staff with topic price and this unit's serial.";

/** The price fields of a result, as the price switch allows them. */
function quote(
  p: bigint | null,
  ctx: ToolContext,
): { price?: string | null; priceNote?: string } {
  if (!effectiveCapabilities(ctx.capabilities ?? PARALLEL_CAPABILITIES).price)
    return {};
  return p === null
    ? { price: null, priceNote: NO_PRICE_NOTE }
    : { price: formatRupiah(p) };
}

const pricesOn = (ctx: ToolContext) =>
  effectiveCapabilities(ctx.capabilities ?? PARALLEL_CAPABILITIES).price;

const UNIT_SELECT = {
  serial: true,
  grade: true,
  // What THIS unit asks (2026-09-08). Null falls back to the variant's.
  price: true,
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

/** How many rows a price-aware search reads before filtering in code. */
const PRICE_SCAN_LIMIT = 500;

async function searchStock(
  db: PrismaClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
) {
  const query = String(args["query"] ?? "").trim();
  const num = (v: unknown): bigint | undefined =>
    typeof v === "number" && Number.isFinite(v) && v > 0
      ? BigInt(Math.floor(v))
      : undefined;
  // With the price switch off a budget is not the bot's to apply: filtering
  // or sorting by price would say what things cost without saying a figure.
  const priced = pricesOn(ctx);
  const minPrice = priced ? num(args["minPrice"]) : undefined;
  const maxPrice = priced ? num(args["maxPrice"]) : undefined;
  const sort = priced ? String(args["sort"] ?? "newest") : "newest";
  const where = stockWhere({ query });

  const rows = await db.unit.findMany({
    where,
    select: { ...UNIT_SELECT, intakeAt: true },
    orderBy: { intakeAt: "desc" },
    take: PRICE_SCAN_LIMIT,
  });
  let units = rows.filter((u) => {
    if (minPrice === undefined && maxPrice === undefined) return true;
    const p = askingPrice(u);
    if (p === null) return false;
    return (
      (minPrice === undefined || p >= minPrice) &&
      (maxPrice === undefined || p <= maxPrice)
    );
  });
  if (sort === "cheapest" || sort === "priciest") {
    const dir = sort === "cheapest" ? 1 : -1;
    units = [...units].sort((a, b) => {
      const pa = askingPrice(a);
      const pb = askingPrice(b);
      if (pa === null) return 1;
      if (pb === null) return -1;
      return pa === pb ? 0 : (pa < pb ? -1 : 1) * dir;
    });
  }
  const total =
    rows.length < PRICE_SCAN_LIMIT ||
    minPrice !== undefined ||
    maxPrice !== undefined
      ? units.length
      : await db.unit.count({ where });
  const shown = units.slice(0, SEARCH_LIMIT);

  return {
    matched: total,
    showing: shown.length,
    // `matched` is for the model's judgement, and reading it out as a headline
    // is what made the bot sound like a query result: "ada 90 unit bahkan".
    // Answering "how many are left" is a fair question and still gets a number.
    guidance:
      "matched is how many sellable units fit this search. Answer with the number when the " +
      "customer actually asked how many are left. Otherwise do not lead with it, just say what " +
      "there is and pick the one that suits them.",
    ...(total > shown.length
      ? {
          // This note used to end "Ask the customer what they need so you can
          // narrow it down", and a tool result is read as an instruction: a
          // customer who had already said "17jtan buat kerja" got asked what
          // kind of work, because the tool had just told the model to ask. The
          // narrowing that was wanted is of the SEARCH, and the model is the
          // one holding the query.
          note:
            `${total} units match and these ${shown.length} are an arbitrary slice of them, not ` +
            `the best ones. Narrow the SEARCH rather than asking the customer to narrow it for ` +
            `you: search again with a query naming the kind of machine they need, and sort by ` +
            `price so the list means something. Then recommend from what comes back.`,
        }
      : {}),
    units: shown.map((u) => ({
      serial: u.serial,
      ...label(u),
      ...(u.grade ? { grade: u.grade } : {}),
      ...quote(askingPrice(u), ctx),
    })),
  };
}

async function checkSerial(
  db: PrismaClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
) {
  const serial = String(args["serial"] ?? "").trim();
  if (!serial) return { error: "No serial given." };

  const unit = await db.unit.findUnique({
    where: { serial },
    select: {
      ...UNIT_SELECT,
      status: true,
      archivedAt: true,
      price: true,
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
  if (!unit)
    return { found: false, note: "No unit with that serial in this shop." };

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
      ? quote(askingPrice(unit), ctx)
      : {
          note: "This unit is not available. You do not know why, so do not speculate.",
        }),
  };
}

/** How many photos one answer may carry. Three is a listing, ten is a folder. */
export const MAX_UNIT_PHOTOS = 3;

/**
 * The photo handles for one unit.
 *
 * `UnitNotePhoto` is where QC's pictures land, under a `UnitNote` on the unit.
 * Only the ids and a caption come back — the bytes are read by the worker when
 * it sends, which is what keeps an image out of the model's context and out of
 * the prompt cache.
 */
async function unitPhotos(db: PrismaClient, args: Record<string, unknown>) {
  const serial = String(args["serial"] ?? "").trim();
  if (!serial) return { error: "No serial given." };

  const unit = await db.unit.findUnique({
    where: { serial },
    select: {
      serial: true,
      status: true,
      archivedAt: true,
      sku: {
        select: {
          name: true,
          variantLabel: true,
          archived: true,
          model: { select: { name: true, archived: true } },
        },
      },
      notes: {
        select: {
          photos: {
            select: { id: true, sortOrder: true },
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: { at: "desc" },
      },
    },
  });
  if (!unit) return { found: false, note: "No unit with that serial." };

  const sellable =
    unit.status === "TERSEDIA" &&
    unit.archivedAt === null &&
    !unit.sku.archived &&
    !unit.sku.model.archived;
  if (!sellable) {
    // A sold machine's pictures are a record of what the shop shipped, not a
    // listing. Saying only "not available" is the same answer `check_serial`
    // gives, for the same reason: the raw status is nobody's business.
    return {
      found: true,
      photos: [],
      note: "This unit is not available, so there are no photos to send.",
    };
  }

  const ids = unit.notes
    .flatMap((n) => n.photos)
    .map((p) => p.id)
    .slice(0, MAX_UNIT_PHOTOS);
  const name = [unit.sku.model.name, unit.sku.variantLabel]
    .filter(Boolean)
    .join(" ");
  return {
    found: true,
    serial: unit.serial,
    photoIds: ids,
    caption: name,
    note:
      ids.length === 0
        ? "There are no photos of this unit yet. Offer to have a colleague take some."
        : `Pass these ${ids.length} handle(s) to reply as 'photos'. You have not seen the ` +
          "pictures, so say nothing about what is in them.",
  };
}

/** How many units a catalogue overview reads. Counts past it are approximate. */
const BROWSE_SCAN_LIMIT = 2_000;

async function browseCatalog(db: PrismaClient, ctx: ToolContext) {
  // Read as units rather than grouped by SKU (2026-09-29): a unit's price is
  // its own, so the range across a model is the range across its UNITS, and
  // Prisma cannot group on a COALESCE.
  const units = await db.unit.findMany({
    where: stockWhere({}),
    select: {
      price: true,
      sku: {
        select: {
          price: true,
          model: {
            select: { name: true, category: { select: { name: true } } },
          },
        },
      },
    },
    take: BROWSE_SCAN_LIMIT,
  });
  if (units.length === 0) return { categories: [] };

  const cats = new Map<
    string,
    Map<string, { available: number; min: bigint | null; max: bigint | null }>
  >();
  for (const u of units) {
    const cat = u.sku.model.category.name;
    const model = u.sku.model.name;
    const models = cats.get(cat) ?? new Map();
    const cur = models.get(model) ?? { available: 0, min: null, max: null };
    cur.available += 1;
    // Still BigInt, and still the easiest leak in the whole file to miss —
    // `toolJson` would fail the turn on one. An unpriced unit is counted and
    // never widens the range.
    const p = askingPrice(u);
    if (p !== null) {
      if (cur.min === null || p < cur.min) cur.min = p;
      if (cur.max === null || p > cur.max) cur.max = p;
    }
    models.set(model, cur);
    cats.set(cat, models);
  }
  const priced = pricesOn(ctx);

  return {
    categories: [...cats.entries()].slice(0, 8).map(([category, models]) => ({
      category,
      available: [...models.values()].reduce((n, m) => n + m.available, 0),
      models: [...models.entries()].slice(0, 8).map(([model, m]) => ({
        model,
        available: m.available,
        ...(priced && rp(m.min) ? { priceFrom: rp(m.min) } : {}),
        ...(priced && rp(m.max) ? { priceTo: rp(m.max) } : {}),
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
function shopBlock(
  shops: ReadonlyArray<{ name: string; address: string | null }>,
) {
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
    ...(customer
      ? { name: customer.name, customerSince: jakartaDate(customer.createdAt) }
      : {}),
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
        ? {
            when: `${jakartaDate(r.scheduledFor)} ${jakartaTime(r.scheduledFor)}`,
          }
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

const NO_APPROVED_ANSWER =
  "The shop has not written an answer for this. Do NOT work one out yourself. Hand it to a " +
  "colleague with handoff_to_staff.";

/**
 * The owner's approved answers, ranked (retrieval.ts) rather than recited.
 *
 * The whole base normally rides in the prompt already (knowledge.ts); this is
 * for the base that has outgrown it, and for a model that wants to check. A
 * result arrives as a fact retrieved in THIS turn, which is the standing the
 * rules give a tool result and withhold from the model's own memory.
 *
 * Staff-authored and `active: true` only, so this is the shop talking, not the
 * model. A customer can never write into it.
 */
async function searchKnowledge(
  db: PrismaClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
) {
  const query = String(args["query"] ?? "").trim();
  if (!query) return { error: "No question given." };

  const kb = ctx.knowledge ?? (await loadKnowledgeBase(db));
  const ranked = kb.index.rank(query, KNOWLEDGE_LIMIT);
  if (ranked.length === 0)
    return { found: false, guidance: NO_APPROVED_ANSWER };

  return {
    found: true,
    answers: ranked.map((r) => {
      const entry = kb.byHandle.get(r.doc.id)!;
      return {
        handle: entry.handle,
        question: entry.question,
        answer: entry.answer,
        match: isStrongMatch(r) ? "strong" : "weak",
      };
    }),
    guidance:
      "These are the owner's approved answers, best match first. Use one only if it really " +
      "answers what was asked, keep its facts and its wording close, do not add anything it " +
      "does not say, and cite its handle. A weak match usually means the shop has not " +
      "answered this: hand it over.",
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
  ctx: ToolContext,
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
    ...quote(askingPrice(u), ctx),
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
  if (!ctx.reserve)
    return { error: "Booking is not available on this channel." };

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

    const graceMs = ctx.reserve.graceMs;
    const until =
      graceMs !== undefined ? new Date(at.getTime() + graceMs) : null;
    return toolJson({
      ok: true,
      code: hold.code,
      when: `${jakartaDate(at)} ${jakartaTime(at)}`,
      serial,
      // Stated so the model has a real answer to "until when", instead of
      // one it would otherwise make up.
      ...(until
        ? { heldUntil: `${jakartaDate(until)} ${jakartaTime(until)}` }
        : {}),
      guidance:
        "Give the customer the booking code and the appointment, and confirm the unit is now " +
        "held for them" +
        (until ? " until heldUntil." : ". Do not state until when."),
    });
  } catch (err) {
    // Ordinary answers, not failures. These are converted before anything else,
    // and NEITHER releases the turn guard through the failure path nor calls
    // ctx.onError — which is wired to logger.error("a grounding tool failed").
    // A customer asking for a machine somebody else holds is not a failed tool.
    if (
      err instanceof UnitNotAvailableError ||
      err instanceof UnknownSerialError
    ) {
      // Nothing was held, so a later step may legitimately try another serial.
      guard?.delete("create_reservation");
      const skuId =
        err instanceof UnitNotAvailableError
          ? (err.units[0]?.skuId ?? null)
          : null;
      const alternatives = await alternativesFor(write, skuId, ctx);
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
  if (!ctx.reserve)
    return { error: "Booking is not available on this channel." };
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
      return err.ref === null
        ? { none: true }
        : { notFound: true, code: err.ref };
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

// --- photos by model ---------------------------------------------------------

/**
 * The best unit to show for a model, and its photos (owner ask 2026-09-29).
 *
 * "Best" is the owner's word, and the owner's reading of it: the most
 * expensive of the matching units that have photos — the grade and the
 * configuration are what the price already reflects. Units nobody has priced
 * rank last, since the shop cannot yet say what they are worth.
 */
async function findUnitPhotos(
  db: PrismaClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
) {
  const query = String(args["query"] ?? "").trim();
  if (!query) return { error: "No model given." };
  const units = await db.unit.findMany({
    where: stockWhere({ query }),
    select: {
      ...UNIT_SELECT,
      notes: {
        select: {
          photos: { select: { id: true }, orderBy: { sortOrder: "asc" } },
        },
        orderBy: { at: "desc" },
      },
    },
    orderBy: { intakeAt: "desc" },
    take: 200,
  });
  if (units.length === 0)
    return { found: false, note: "No unit on sale matches this." };

  const withPhotos = units
    .map((u) => ({ u, ids: u.notes.flatMap((n) => n.photos).map((p) => p.id) }))
    .filter((x) => x.ids.length > 0)
    .sort((a, b) => {
      const pa = askingPrice(a.u);
      const pb = askingPrice(b.u);
      if (pa === pb) return 0;
      if (pa === null) return 1;
      if (pb === null) return -1;
      return pa > pb ? -1 : 1;
    });
  if (withPhotos.length === 0) {
    return {
      found: true,
      photoIds: [],
      matching: units.length,
      note:
        "None of the matching units has photos yet. Say a colleague will send some, and use " +
        "handoff_to_staff with topic photos.",
    };
  }

  const best = withPhotos[0]!;
  const others = units.length - 1;
  return {
    found: true,
    serial: best.u.serial,
    ...label(best.u),
    ...(best.u.grade ? { grade: best.u.grade } : {}),
    ...quote(askingPrice(best.u), ctx),
    photoIds: best.ids.slice(0, MAX_UNIT_PHOTOS),
    otherMatchingUnits: others,
    guidance:
      "Pass photoIds to reply as 'photos'. You have not seen the pictures, so say nothing about " +
      "what is in them. Say which unit this is" +
      (pricesOn(ctx) ? " and its price if one is given" : "") +
      "." +
      (others > 0
        ? ` There are ${others} other matching unit(s): ask whether they would like to see ` +
          "another one, with better specs or a better price."
        : " It is the only matching unit."),
  };
}

// --- the customer's own bookings -------------------------------------------

async function checkReservation(db: PrismaClient, ctx: ToolContext) {
  const phones = phoneForms(ctx.from);
  const holds = await db.reservation.findMany({
    where: { phone: { in: phones }, status: "TERJADWAL" },
    select: {
      code: true,
      scheduledFor: true,
      items: {
        select: {
          sku: { select: { name: true, variantLabel: true } },
          unit: { select: { serial: true } },
        },
        take: 5,
      },
    },
    orderBy: { createdAt: "desc" },
    take: RESERVATION_LIMIT,
  });
  if (holds.length === 0)
    return { none: true, note: "This customer has no open booking." };
  return {
    bookings: holds.map((r) => ({
      code: r.code,
      ...(r.scheduledFor
        ? {
            when: `${jakartaDate(r.scheduledFor)} ${jakartaTime(r.scheduledFor)}`,
          }
        : {}),
      units: r.items.map((i) => ({
        name: [i.sku?.name, i.sku?.variantLabel].filter(Boolean).join(" "),
        ...(i.unit?.serial ? { serial: i.unit.serial } : {}),
      })),
    })),
  };
}

async function rescheduleReservation(
  args: Record<string, unknown>,
  ctx: ToolContext,
) {
  if (!ctx.reserve)
    return { error: "Booking is not available on this channel." };
  const at = parseJakarta(String(args["when"] ?? ""));
  if (!at)
    return {
      needWhen: true,
      note: "The date was not understood. Send it as YYYY-MM-DDTHH:MM in Jakarta time.",
    };
  const code = String(args["code"] ?? "").trim();
  try {
    const moved = await ctx.reserve.write.$transaction(
      (tx) =>
        rescheduleHold(tx, {
          target: { phone: toE164(ctx.from), ...(code ? { code } : {}) },
          scheduledFor: at,
          at: ctx.now,
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
      code: moved.code,
      when: `${jakartaDate(at)} ${jakartaTime(at)}`,
      guidance: "Confirm the new day and time and repeat the booking code.",
    });
  } catch (err) {
    if (err instanceof HoldNotFoundError)
      return err.ref === null
        ? { none: true }
        : { notFound: true, code: err.ref };
    if (err instanceof AmbiguousHoldError)
      return { ambiguous: true, codes: err.codes };
    if (err instanceof HoldAlreadySettledError)
      return { notFound: true, code: err.code };
    if (err instanceof BookingInPastError) return { pastDate: true };
    if (err instanceof BookingTooFarAheadError)
      return { tooFarAhead: true, maxDays: err.maxDays };
    if (err instanceof OutsideStoreHoursError)
      return {
        closedThen: true,
        hours: `${err.openHour}:00 to ${err.closeHour}:00`,
        guidance:
          "The shop is shut at that time. Offer a time inside opening hours instead.",
      };
    ctx.onError?.("reschedule_reservation", err);
    return { error: "Could not move the booking. Hand this to a colleague." };
  }
}

// --- what the customer told us ----------------------------------------------

const clip = (v: unknown, max: number): string | undefined => {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return t ? t.slice(0, max) : undefined;
};

/**
 * Keep what the customer said about themselves (owner ask 2026-09-29).
 *
 * Upserted on the wa_id, one field at a time, so "nama saya Budi" and, three
 * messages later, "buat editing" each add to the profile and neither erases
 * the other. A name also creates the Customer row when the shop has none —
 * CREATE only, never an edit, which is what the agent role's INSERT-only
 * grant on Customer already says (20260820002832).
 */
async function rememberCustomer(
  args: Record<string, unknown>,
  ctx: ToolContext,
) {
  if (!ctx.profile) return { error: "Not available here." };
  const name = clip(args["name"], 80);
  const useCase = clip(args["use_case"], 160);
  const currentDevice = clip(args["current_device"], 120);
  const preference = clip(args["preference"], 200);
  const ageEstimate = clip(args["age_estimate"], 20);
  const occupation = clip(args["occupation"], 80);
  const rupiah = (v: unknown): bigint | undefined =>
    typeof v === "number" && Number.isFinite(v) && v >= 1
      ? BigInt(Math.floor(v))
      : undefined;
  const budget = rupiah(args["budget"]);
  // A single figure is a range of one (owner: "budget is a min–max range").
  let budgetMin = rupiah(args["budget_min"]) ?? budget;
  let budgetMax = rupiah(args["budget_max"]) ?? budget;
  if (
    budgetMin !== undefined &&
    budgetMax !== undefined &&
    budgetMin > budgetMax
  )
    [budgetMin, budgetMax] = [budgetMax, budgetMin];
  const fields = {
    ...(name ? { name } : {}),
    ...(useCase ? { useCase } : {}),
    ...(currentDevice ? { currentDevice } : {}),
    ...(preference ? { preference } : {}),
    ...(ageEstimate ? { ageEstimate } : {}),
    ...(occupation ? { occupation } : {}),
    ...(budgetMin !== undefined ? { budgetMin } : {}),
    ...(budgetMax !== undefined ? { budgetMax } : {}),
    // The old single column, kept one release for the reader before
    // (migration 20261014120000): the top of the range is what it meant.
    ...((budgetMax ?? budget) !== undefined
      ? { budget: budgetMax ?? budget }
      : {}),
  };
  // Comma-separated text, never an array: no model output becomes a query
  // shape (tools.schema.test.ts). ABOUT facts may contain commas, so they
  // are split on semicolons.
  const list = (
    v: unknown,
    max: number,
    len: number,
    sep: RegExp = /[,;]/,
  ): string[] =>
    (typeof v === "string" ? v.split(sep) : [])
      .map((x) => clip(x, len))
      .filter((x): x is string => Boolean(x))
      .slice(0, max);
  const facts: Array<{
    kind: "USAGE" | "APP" | "PREFERENCE" | "ABOUT";
    value: string;
  }> = [
    ...list(args["usage"], 5, 40).map((value) => ({
      kind: "USAGE" as const,
      value,
    })),
    ...list(args["apps"], 8, 40).map((value) => ({
      kind: "APP" as const,
      value,
    })),
    ...list(args["preferences"], 6, 60).map((value) => ({
      kind: "PREFERENCE" as const,
      value,
    })),
    ...list(args["about"], 5, 120, /;/).map((value) => ({
      kind: "ABOUT" as const,
      value,
    })),
  ];
  if (Object.keys(fields).length === 0 && facts.length === 0)
    return { saved: false };

  const db = ctx.profile.write;
  const phones = phoneForms(ctx.from);
  await db.$transaction(async (tx) => {
    let customer = await tx.customer.findFirst({
      where: { phone: { in: phones } },
      select: { id: true },
    });
    if (!customer && name) {
      customer = await tx.customer.create({
        data: { phone: toE164(ctx.from), name, createdAt: ctx.now },
        select: { id: true },
      });
      // A customer the bot met for the first time is a row every till lists.
      await recordStoreChanges(tx, [["customers", customer.id]]);
    }
    const profile = await tx.customerProfile.upsert({
      where: { from: ctx.from },
      update: {
        ...fields,
        ...(customer ? { customerId: customer.id } : {}),
        updatedAt: ctx.now,
      },
      create: {
        from: ctx.from,
        ...fields,
        ...(customer ? { customerId: customer.id } : {}),
        updatedAt: ctx.now,
      },
      select: { id: true },
    });
    if (facts.length > 0) {
      // A fact already on the profile — the bot's or a colleague's, in any
      // letter case — is not written twice.
      const have = await tx.customerProfileFact.findMany({
        where: { profileId: profile.id, removedAt: null },
        select: { kind: true, value: true },
      });
      const seen = new Set(
        have.map((f) => `${f.kind}:${f.value.toLowerCase()}`),
      );
      for (const f of facts) {
        const key = `${f.kind}:${f.value.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await tx.customerProfileFact.create({
          data: {
            profileId: profile.id,
            kind: f.kind,
            value: f.value,
            source: "BOT",
            createdAt: ctx.now,
          },
        });
      }
    }
  }, TXN_TIMEOUTS);
  return {
    saved: true,
    guidance:
      "Saved. Do not tell the customer you saved anything; just carry on.",
  };
}

/** How long a proposal waits for the customer's yes. */
export const PROPOSAL_TTL_MS = 30 * 60_000;

/**
 * Chatbot v2 step 5: record a visit the customer has not agreed to yet.
 *
 * Validated exactly as the hold it may become (`assertSchedule`, the same
 * stock filter the search uses), so a proposal the customer says yes to does
 * not then fail for a reason that was knowable now. Writes no hold and no
 * UnitEvent; an earlier open proposal of this customer's is cancelled, so
 * "the one they said yes to" is never ambiguous.
 */
async function proposeReservation(
  args: Record<string, unknown>,
  ctx: ToolContext,
) {
  if (!ctx.reserve)
    return { error: "Booking is not available on this channel." };
  const { write } = ctx.reserve;
  const serials = [
    ...new Set(
      String(args["serials"] ?? "")
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, 3);
  if (serials.length === 0) return { needSerial: true };
  const custName = clip(args["custName"], 80);
  if (!custName)
    return {
      needName: true,
      guidance: "Ask the customer for the name the booking should be under.",
    };
  const at = parseJakarta(String(args["when"] ?? ""));
  if (!at)
    return {
      needWhen: true,
      note: "The date was not understood. Send it as YYYY-MM-DDTHH:MM in Jakarta time.",
    };
  try {
    assertSchedule(at, ctx.now, {
      requireFuture: true,
      maxBookingDays: MAX_BOOKING_DAYS,
      storeHours: STORE_HOURS,
    });
  } catch (err) {
    if (err instanceof BookingInPastError) return { pastDate: true };
    if (err instanceof BookingTooFarAheadError)
      return { tooFarAhead: true, maxDays: err.maxDays };
    if (err instanceof OutsideStoreHoursError)
      return {
        closedThen: true,
        hours: `${err.openHour}:00 to ${err.closeHour}:00`,
      };
    throw err;
  }

  const units = await write.unit.findMany({
    where: { ...stockWhere({}), serial: { in: serials } },
    select: { ...UNIT_SELECT, id: true },
  });
  const missing = serials.filter((s) => !units.some((u) => u.serial === s));
  if (missing.length > 0)
    return toolJson({
      unavailable: true,
      serials: missing,
      guidance: NEVER_INVENT_REASON,
    });

  const proposal = await write.$transaction(async (tx) => {
    await tx.reservationProposal.updateMany({
      where: { from: ctx.from, confirmedAt: null, cancelledAt: null },
      data: { cancelledAt: ctx.now },
    });
    return tx.reservationProposal.create({
      data: {
        from: ctx.from,
        custName,
        scheduledFor: at,
        createdAt: ctx.now,
        expiresAt: new Date(ctx.now.getTime() + PROPOSAL_TTL_MS),
        items: {
          create: serials.map((serial, i) => ({
            unitId: units.find((u) => u.serial === serial)!.id,
            sortOrder: i,
          })),
        },
      },
      select: { id: true },
    });
  }, TXN_TIMEOUTS);

  return toolJson({
    ok: true,
    proposed: true,
    proposalId: proposal.id,
    when: `${jakartaDate(at)} ${jakartaTime(at)}`,
    custName,
    units: serials.map((serial) => {
      const u = units.find((x) => x.serial === serial)!;
      return {
        serial,
        ...label(u),
        ...(u.grade ? { grade: u.grade } : {}),
        ...quote(askingPrice(u), ctx),
      };
    }),
    guidance:
      "NOT booked yet. Read every unit (name, grade, price) and the date and time back to the " +
      "customer and ask them to confirm. Do not say it is booked or held.",
  });
}

/**
 * Turn the customer's open proposal into a hold. Called by CODE when the
 * router reads the customer's reply as a yes — never offered to a model.
 */
async function confirmReservation(ctx: ToolContext) {
  if (!ctx.reserve)
    return { error: "Booking is not available on this channel." };
  const guard = ctx.writesUsed;
  if (guard?.has("create_reservation")) return { alreadyBooked: true };
  const { write, staffId } = ctx.reserve;
  const proposal = await write.reservationProposal.findFirst({
    where: {
      from: ctx.from,
      confirmedAt: null,
      cancelledAt: null,
      expiresAt: { gt: ctx.now },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      custName: true,
      scheduledFor: true,
      items: {
        orderBy: { sortOrder: "asc" },
        select: { unit: { select: { serial: true } } },
      },
    },
  });
  if (!proposal) return { noProposal: true };
  guard?.add("create_reservation");
  const e164 = toE164(ctx.from);
  const serials = proposal.items.map((i) => i.unit.serial);
  try {
    const hold = await write.$transaction(async (tx) => {
      const made = await createHold(tx, {
        serials,
        staffId,
        customer: { phone: e164, name: proposal.custName },
        scheduledFor: proposal.scheduledFor,
        note: null,
        eventNote: `Reservasi agen untuk ${e164}`,
        source: "AGEN",
        at: ctx.now,
        duplicateScope: { phone: e164, source: "AGEN" },
        policy: {
          requireFuture: true,
          maxBookingDays: MAX_BOOKING_DAYS,
          storeHours: STORE_HOURS,
        },
      });
      // Only while still open: two confirms racing are one hold, not two.
      const { count } = await tx.reservationProposal.updateMany({
        where: { id: proposal.id, confirmedAt: null, cancelledAt: null },
        data: { confirmedAt: ctx.now, reservationId: made.id },
      });
      if (count !== 1) throw new Error("proposal already settled");
      return made;
    }, TXN_TIMEOUTS);
    const at = proposal.scheduledFor;
    const graceMs = ctx.reserve.graceMs;
    const until =
      graceMs !== undefined ? new Date(at.getTime() + graceMs) : null;
    return toolJson({
      ok: true,
      code: hold.code,
      when: `${jakartaDate(at)} ${jakartaTime(at)}`,
      serials,
      custName: proposal.custName,
      ...(until
        ? { heldUntil: `${jakartaDate(until)} ${jakartaTime(until)}` }
        : {}),
    });
  } catch (err) {
    guard?.delete("create_reservation");
    if (
      err instanceof UnitNotAvailableError ||
      err instanceof UnknownSerialError
    )
      return toolJson({
        unavailable: true,
        serials,
        guidance: NEVER_INVENT_REASON,
      });
    if (err instanceof DuplicateHoldError)
      return toolJson({ alreadyBooked: true, code: err.code });
    if (
      err instanceof BookingInPastError ||
      err instanceof BookingTooFarAheadError ||
      err instanceof OutsideStoreHoursError
    )
      return { scheduleNoLongerValid: true };
    ctx.onError?.("confirm_reservation", err);
    return {
      error:
        "Could not save the booking. Tell the customer a colleague will follow up, and do not " +
        "claim it was booked.",
    };
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
    else if (name === "search_stock") out = await searchStock(db, args, ctx);
    else if (name === "check_serial") out = await checkSerial(db, args, ctx);
    else if (name === "unit_photos") out = await unitPhotos(db, args);
    else if (name === "find_unit_photos")
      out = await findUnitPhotos(db, args, ctx);
    else if (name === "browse_catalog") out = await browseCatalog(db, ctx);
    else if (name === "lookup_customer") out = await lookupCustomer(db, ctx);
    else if (name === "check_order") out = await checkOrder(db, args, ctx);
    else if (name === "search_knowledge")
      out = await searchKnowledge(db, args, ctx);
    else if (name === "lookup_catalog") out = await lookupCatalog(db, args);
    else if (name === "handoff_to_staff") out = handoff(args, ctx);
    else if (name === "create_reservation")
      out = await createReservation(args, ctx);
    else if (name === "cancel_reservation")
      out = await cancelReservation(args, ctx);
    else if (name === "check_reservation")
      out = await checkReservation(db, ctx);
    else if (name === "reschedule_reservation")
      out = await rescheduleReservation(args, ctx);
    else if (name === "remember_customer")
      out = await rememberCustomer(args, ctx);
    else if (name === "propose_reservation")
      out = await proposeReservation(args, ctx);
    else if (name === "confirm_reservation")
      out = await confirmReservation(ctx);
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
