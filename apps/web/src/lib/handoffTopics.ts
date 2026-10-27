/**
 * The bot's hand-over topics in words (packages/agent policy.ts
 * `HANDOFF_TOPICS`), for the Chat page.
 *
 * A switch of literal `t()` calls rather than a table: test/i18n.test.ts finds
 * copy by reading the source, and a table indexed by the topic would hide
 * every one of these from it.
 */
import type { TFunction } from "../i18n/translate.js";

export function handoffTopicLabel(t: TFunction, topic: string): string {
  switch (topic) {
    case "stock":
      return t("handoff.stock", "Stock");
    case "price":
      return t("handoff.price", "Price");
    case "negotiation":
      return t("handoff.negotiation", "Negotiation");
    case "unit_details":
      return t("handoff.unitDetails", "Unit details");
    case "recommendation":
      return t("handoff.recommendation", "Recommendation");
    case "reservation":
      return t("handoff.reservation", "Booking");
    case "order_payment":
      return t("handoff.orderPayment", "Order or payment");
    case "trade_in":
      return t("handoff.tradeIn", "Trade-in");
    case "sell_to_shop":
      return t("handoff.sellToShop", "Selling to us");
    case "shipping_quote":
      return t("handoff.shippingQuote", "Shipping cost");
    case "warranty_claim":
      return t("handoff.warrantyClaim", "Warranty claim");
    case "complaint":
      return t("handoff.complaint", "Complaint");
    case "media":
      return t("handoff.media", "Photo or file");
    case "photos":
      return t("handoff.photos", "Wants photos");
    case "human":
      return t("handoff.human", "Wants a person");
    case "closing":
      return t("handoff.closing", "Ready to buy");
    case "visit":
      return t("handoff.visit", "Visit");
    case "restock":
      return t("handoff.restock", "Back in stock");
    case "dp":
      return t("handoff.dp", "DP");
    case "hold":
      return t("handoff.hold", "Reservation");
    default:
      return t("handoff.other", "Not in the answers");
  }
}
