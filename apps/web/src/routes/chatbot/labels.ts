/**
 * The chatbot's enums in words — the evaluation's reason, rating and status,
 * and the three agents.
 *
 * Switches of literal `t()` calls rather than tables: test/i18n.test.ts finds
 * copy by reading the source, and a table indexed by the code would hide
 * every one of these from it (the rule `lib/handoffTopics.ts` follows).
 */
import type { TFunction } from "../../i18n/translate.js";
import type { AgentKey, EvaluationReason } from "../../lib/chatApi.js";
import type { EvaluationRating, EvaluationStatus } from "../../lib/inboxApi.js";

export function reasonLabel(t: TFunction, reason: EvaluationReason): string {
  switch (reason) {
    case "WRONG_FACT":
      return t("chatEval.reasonWrongFact", "Wrong fact");
    case "WRONG_TONE":
      return t("chatEval.reasonWrongTone", "Wrong tone");
    case "TOO_LONG":
      return t("chatEval.reasonTooLong", "Too long");
    case "MISSED_QUESTION":
      return t("chatEval.reasonMissedQuestion", "Missed the question");
    case "SHOULD_ESCALATE":
      return t("chatEval.reasonShouldEscalate", "Should have handed over");
    case "SHOULD_NOT_ESCALATE":
      return t(
        "chatEval.reasonShouldNotEscalate",
        "Should not have handed over",
      );
    default:
      return t("chatEval.reasonOther", "Other");
  }
}

export function agentLabel(t: TFunction, agent: AgentKey): string {
  switch (agent) {
    case "ROUTER":
      return t("chatAgent.router", "Router");
    case "ADVISOR":
      return t("chatAgent.advisor", "Sales Advisor");
    default:
      return t("chatAgent.operations", "Operations");
  }
}

export function ratingLabel(t: TFunction, rating: EvaluationRating): string {
  return rating === "GOOD"
    ? t("chatEval.good", "Good")
    : t("chatEval.bad", "Bad");
}

export function evalStatusLabel(
  t: TFunction,
  status: EvaluationStatus,
): string {
  switch (status) {
    case "OPEN":
      return t("chatEval.statusOpen", "Needs review");
    case "APPLIED":
      return t("chatEval.statusApplied", "Applied");
    default:
      return t("chatEval.statusDismissed", "Dismissed");
  }
}

export const EVAL_STATUS_COLOR: Record<EvaluationStatus, string> = {
  OPEN: "orange",
  APPLIED: "green",
  DISMISSED: "default",
};
