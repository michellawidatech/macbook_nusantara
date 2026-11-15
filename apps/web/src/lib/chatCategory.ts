/**
 * What a chat waiting for a person is waiting FOR, as a category staff can
 * filter on (owner, 2026-11-16: *"categorize chats waiting for a person so
 * staff know which to answer"*).
 *
 * Read off the hand-over topics the bot already writes (packages/agent
 * policy.ts `HANDOFF_TOPICS`, on the message and on each open `ChatAction`)
 * and, failing a topic, the task's kind. No schema of its own: a topic this
 * screen does not know — or a row from before topics — is "Other".
 *
 * Literal `t()` calls in a switch, not a table: test/i18n.test.ts finds copy
 * by reading the source, and a table indexed by a variable hides it.
 */
import type { TFunction } from "../i18n/translate.js";
import type { ChatActionKind, InboxThread } from "./inboxApi.js";

export type ChatCategory =
  | "photoDefect"
  | "complaintService"
  | "videoCall"
  | "delivery"
  | "negotiation"
  | "closing"
  | "admin"
  | "booking"
  | "priceStock"
  | "payment"
  | "tradeIn"
  | "media"
  | "other";

/** The order the filter chips are drawn in: the owner's four first. */
export const CATEGORY_ORDER: readonly ChatCategory[] = [
  "photoDefect",
  "complaintService",
  "videoCall",
  "delivery",
  "negotiation",
  "closing",
  "admin",
  "booking",
  "priceStock",
  "payment",
  "tradeIn",
  "media",
  "other",
];

/** A hand-over topic (or a task's own topic) as its category. */
export function categoryOfTopic(
  topic: string | null | undefined,
): ChatCategory {
  switch (topic) {
    case "unit_details":
    case "photos":
      return "photoDefect";
    case "complaint":
    case "warranty_claim":
    case "service":
      return "complaintService";
    case "video_call":
      return "videoCall";
    case "shipping_quote":
      return "delivery";
    case "negotiation":
      return "negotiation";
    case "closing":
      return "closing";
    case "human":
      return "admin";
    case "reservation":
    case "visit":
    case "dp":
    case "hold":
      return "booking";
    case "price":
    case "stock":
    case "recommendation":
    case "restock":
      return "priceStock";
    case "order_payment":
      return "payment";
    case "trade_in":
    case "sell_to_shop":
      return "tradeIn";
    case "media":
      return "media";
    default:
      return "other";
  }
}

/** A task's kind as its category, for a task whose topic says nothing. */
export function categoryOfKind(kind: ChatActionKind | string): ChatCategory {
  switch (kind) {
    case "NEGOTIATION":
      return "negotiation";
    case "PRICE":
    case "STOCK":
      return "priceStock";
    case "RESERVATION":
      return "booking";
    case "PHOTOS":
      return "photoDefect";
    case "CLOSING":
      return "closing";
    default:
      return "other";
  }
}

type WaitingFields = Pick<
  InboxThread,
  "handoff" | "openActions" | "needsReply" | "autoReply"
> & { readonly openTopics?: readonly string[] };

/**
 * Is a person needed here? Handed over, a task open, or a message in a chat
 * whose bot is switched off.
 */
export function isWaitingForPerson(t: WaitingFields): boolean {
  return (
    t.handoff !== null ||
    (t.openActions?.length ?? 0) > 0 ||
    (t.needsReply && !t.autoReply)
  );
}

/**
 * Every category a waiting chat is waiting for, in `CATEGORY_ORDER`; empty
 * when nobody is needed. The hand-over's topic and the others a list handed
 * over beside it, then each open task's topic; a task whose topic is not one
 * of the bot's falls back to its kind. A chat waiting only because its bot is
 * off is "Other".
 */
export function threadCategories(t: WaitingFields): ChatCategory[] {
  if (!isWaitingForPerson(t)) return [];
  const found = new Set<ChatCategory>();
  if (t.handoff) {
    found.add(categoryOfTopic(t.handoff.topic));
    for (const topic of t.handoff.also ?? []) found.add(categoryOfTopic(topic));
  }
  for (const topic of t.openTopics ?? []) {
    const c = categoryOfTopic(topic);
    if (c !== "other") found.add(c);
  }
  // Kinds only fill in what no topic said.
  if (found.size === 0)
    for (const kind of t.openActions ?? []) found.add(categoryOfKind(kind));
  if (found.size === 0) found.add("other");
  return CATEGORY_ORDER.filter((c) => found.has(c));
}

/** How many waiting chats each category holds. A chat counts once per category. */
export function categoryCounts(
  threads: readonly WaitingFields[],
): Map<ChatCategory, number> {
  const counts = new Map<ChatCategory, number>();
  for (const t of threads)
    for (const c of threadCategories(t))
      counts.set(c, (counts.get(c) ?? 0) + 1);
  return counts;
}

/** antd's preset tag colours; "other" and "media" stay neutral. */
export function categoryColor(c: ChatCategory): string | undefined {
  switch (c) {
    case "photoDefect":
      return "magenta";
    case "complaintService":
      return "red";
    case "videoCall":
      return "purple";
    case "delivery":
      return "cyan";
    case "negotiation":
      return "orange";
    case "closing":
      return "green";
    case "admin":
      return "volcano";
    case "booking":
      return "blue";
    case "priceStock":
      return "geekblue";
    case "payment":
      return "gold";
    case "tradeIn":
      return "lime";
    default:
      return undefined;
  }
}

export function categoryLabel(t: TFunction, c: ChatCategory): string {
  switch (c) {
    case "photoDefect":
      return t("chat.category.photoDefect", "Photo / defect detail");
    case "complaintService":
      return t("chat.category.complaintService", "Complaint / service");
    case "videoCall":
      return t("chat.category.videoCall", "Video call request");
    case "delivery":
      return t("chat.category.delivery", "Delivery fee estimate");
    case "negotiation":
      return t("chat.category.negotiation", "Negotiation");
    case "closing":
      return t("chat.category.closing", "Ready to buy");
    case "admin":
      return t("chat.category.admin", "Admin request");
    case "booking":
      return t("chat.category.booking", "Booking / reservation");
    case "priceStock":
      return t("chat.category.priceStock", "Price / stock check");
    case "payment":
      return t("chat.category.payment", "Payment / DP proof");
    case "tradeIn":
      return t("chat.category.tradeIn", "Trade-in / selling to us");
    case "media":
      return t("chat.category.media", "Customer sent a file");
    default:
      return t("chat.category.other", "Other");
  }
}
