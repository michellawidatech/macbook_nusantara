/**
 * Which model the nightly chatbot audit reviews with, chosen on /audit
 * (2026-11-20) rather than fixed in code. The shop's `claude setup-token`
 * token is a 429 on Sonnet 5.5, so the review FAILED on its first two nights
 * and reviewed nothing; this lets the Widatech login pick a model the token
 * accepts. Read by the worker at the start of every run, so a change applies
 * to the next night (or the next `ops/run chat-review`) with no restart.
 *
 * Only models that take the reviewer's JSON answer format
 * (`output_config.format`) are offered. `REVIEW_MODEL` stays the default:
 * absent, or a stored value no longer on the list, means Sonnet 5.5.
 */
import type { PrismaClient } from "@nusantara/db";
import { REVIEW_MODEL } from "./review.js";

export const REVIEW_MODEL_SETTING_KEY = "chatbot.reviewModel";

export interface ReviewModel {
  readonly id: string;
  readonly label: string;
  /** Answers the shop's `claude setup-token` login (Haiku 4.5, 2026-10-22). */
  readonly worksWithSetupToken: boolean;
  /** Takes `output_config.effort`; Haiku 4.5 answers it with a 400. */
  readonly takesEffort: boolean;
}

export const REVIEW_MODELS: readonly ReviewModel[] = [
  {
    id: REVIEW_MODEL,
    label: "Sonnet 5.5",
    worksWithSetupToken: false,
    takesEffort: true,
  },
  {
    id: "claude-opus-4-5",
    label: "Opus 4.5",
    worksWithSetupToken: false,
    takesEffort: true,
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    worksWithSetupToken: true,
    takesEffort: false,
  },
];

/** A stored or requested value, kept only when it names a model on the list. */
export function reviewModelOf(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return REVIEW_MODELS.some((m) => m.id === v) ? v : null;
}

/** The model a run uses: the stored choice, else `REVIEW_MODEL`. */
export async function loadReviewModel(
  db: Pick<PrismaClient, "appSetting">,
): Promise<string> {
  const row = await db.appSetting.findUnique({
    where: { key: REVIEW_MODEL_SETTING_KEY },
    select: { value: true },
  });
  return reviewModelOf(row?.value) ?? REVIEW_MODEL;
}

/** `output_config.effort` for the review, only where the model takes it. */
export function reviewEffort(model: string): { effort?: "medium" } {
  const m = REVIEW_MODELS.find((x) => x.id === model);
  return m?.takesEffort === false ? {} : { effort: "medium" };
}
