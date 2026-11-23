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

/**
 * "Run the review now", pressed on /audit (2026-11-20) — the button form of
 * `ops/run chat-review --days N`. The API writes the request; the worker,
 * which owns the review tables, picks it up on its next tick and runs the
 * pass outside the night window. The worker role may only READ AppSetting,
 * so a request is never cleared: it is answered once a run has STARTED after
 * it and ENDED. Stored as `<days>|<ISO instant>`.
 */
export const REVIEW_REQUEST_SETTING_KEY = "chatbot.reviewRequest";
export const REVIEW_REQUEST_MAX_DAYS = 90;

export interface ReviewRequest {
  readonly days: number;
  readonly at: Date;
}

export function formatReviewRequest(r: ReviewRequest): string {
  return `${r.days}|${r.at.toISOString()}`;
}

export function parseReviewRequest(
  value: string | null | undefined,
): ReviewRequest | null {
  const [d, iso] = (value ?? "").split("|");
  const days = Number(d);
  const at = new Date(iso ?? "");
  if (!Number.isInteger(days) || days < 1 || days > REVIEW_REQUEST_MAX_DAYS)
    return null;
  if (Number.isNaN(at.getTime())) return null;
  return { days, at };
}

/** The request still waiting for a run to answer it, or null. */
export async function pendingReviewRequest(
  db: Pick<PrismaClient, "appSetting" | "chatReviewRun">,
): Promise<ReviewRequest | null> {
  const row = await db.appSetting.findUnique({
    where: { key: REVIEW_REQUEST_SETTING_KEY },
    select: { value: true },
  });
  const req = parseReviewRequest(row?.value);
  if (!req) return null;
  const answered = await db.chatReviewRun.findFirst({
    where: { startedAt: { gte: req.at }, status: { not: "RUNNING" } },
    select: { id: true },
  });
  return answered ? null : req;
}
