/**
 * The chatbot audit, typed — `/api/audit` (apps/api/src/routes/audit.ts),
 * Widatech only on the server whatever the screen does (2026-11-18).
 * Server data in TanStack Query, like `activityApi`: the store carries none
 * of it.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.js";

export type ReviewCategory =
  | "WRONG_FACT"
  | "UNANSWERED"
  | "HANDOVER"
  | "RULE_BROKEN"
  | "TONE"
  | "MISSED_SALE"
  | "OTHER";
export type ReviewSeverity = "BAD" | "IMPROVE";
export type ReviewRunStatus = "RUNNING" | "DONE" | "STOPPED" | "FAILED";

export const REVIEW_CATEGORIES: readonly ReviewCategory[] = [
  "WRONG_FACT",
  "UNANSWERED",
  "HANDOVER",
  "RULE_BROKEN",
  "TONE",
  "MISSED_SALE",
  "OTHER",
];

export interface ReviewRun {
  readonly id: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly model: string;
  readonly status: ReviewRunStatus;
  readonly reason: string | null;
  readonly chats: number;
  readonly flags: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** US dollars × 1 000 000, as a string. */
  readonly costMicros: string;
  /** Flags by category and by severity (`BAD`, `IMPROVE`). */
  readonly byCategory: Partial<Record<ReviewCategory | ReviewSeverity, number>>;
  readonly chatsWithBad: number;
}

export interface ReviewFlag {
  readonly id: string;
  readonly threadId: string;
  readonly from: string;
  readonly tester: boolean;
  readonly messageId: string | null;
  readonly category: ReviewCategory;
  readonly severity: ReviewSeverity;
  readonly quote: string;
  readonly suggestion: string;
  readonly createdAt: string;
  readonly dismissedAt: string | null;
  readonly dismissedBy: string | null;
}

export interface ReviewThread {
  readonly thread: {
    readonly id: string;
    readonly from: string;
    readonly reviewedFrom: string;
    readonly reviewedTo: string;
  };
  readonly lines: ReadonlyArray<{
    readonly messageId: string;
    readonly at: string;
    readonly who: "customer" | "bot" | "staff";
    readonly text: string;
  }>;
  readonly flags: ReadonlyArray<{
    readonly id: string;
    readonly messageId: string | null;
    readonly category: ReviewCategory;
    readonly severity: ReviewSeverity;
    readonly quote: string;
    readonly suggestion: string;
    readonly dismissedAt: string | null;
  }>;
}

/** The dashboard reads the newest flags at most; the table filters them. */
export const FLAG_PAGE = 500;

export function useReviewRuns() {
  return useQuery({
    queryKey: ["audit", "runs"],
    queryFn: () => api<{ runs: ReviewRun[] }>("/api/audit/runs"),
  });
}

export function useReviewFlags() {
  return useQuery({
    queryKey: ["audit", "flags"],
    queryFn: () =>
      api<{ flags: ReviewFlag[]; nextCursor: string | null }>(
        `/api/audit/flags?limit=${FLAG_PAGE}`,
      ),
  });
}

export function useReviewThread(id: string | null) {
  return useQuery({
    queryKey: ["audit", "thread", id],
    queryFn: () => api<ReviewThread>(`/api/audit/threads/${id ?? ""}`),
    enabled: id !== null,
  });
}

export function useDismissFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dismiss }: { id: string; dismiss: boolean }) =>
      api<{ flag: { id: string; dismissedAt: string | null } }>(
        `/api/audit/flags/${id}/${dismiss ? "dismiss" : "undismiss"}`,
        { method: "POST" },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audit"] }),
  });
}

/** A model the reviewer can run on (packages/agent reviewModel.ts). */
export interface ReviewModelOption {
  readonly id: string;
  readonly label: string;
  readonly worksWithSetupToken: boolean;
  readonly takesEffort: boolean;
}

export interface ReviewModelSetting {
  readonly model: string;
  readonly defaultModel: string;
  readonly models: readonly ReviewModelOption[];
}

export function useReviewModel() {
  return useQuery({
    queryKey: ["audit", "model"],
    queryFn: () => api<ReviewModelSetting>("/api/audit/model"),
  });
}

export function useSetReviewModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (model: string) =>
      api<ReviewModelSetting>("/api/audit/model", {
        method: "PUT",
        body: { model },
      }),
    onSuccess: (data) => qc.setQueryData(["audit", "model"], data),
  });
}

/** A "run the review now" still waiting for the worker to answer it. */
export interface ReviewRunRequest {
  readonly pending: { readonly days: number; readonly at: string } | null;
}

/** Polls while a request waits, so the page sees the run land. */
export function useReviewRunRequest() {
  return useQuery({
    queryKey: ["audit", "run"],
    queryFn: () => api<ReviewRunRequest>("/api/audit/run"),
    refetchInterval: (q) => (q.state.data?.pending ? 15_000 : false),
  });
}

export function useRequestReviewRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (days: number) =>
      api<ReviewRunRequest>("/api/audit/run", {
        method: "POST",
        body: { days },
      }),
    onSuccess: (data) => qc.setQueryData(["audit", "run"], data),
  });
}

/** Dollars, from micros, for a figure nobody adds up. */
export function dollars(micros: string): string {
  const n = Number(micros) / 1_000_000;
  return `US$${n.toFixed(n < 1 ? 3 : 2)}`;
}
