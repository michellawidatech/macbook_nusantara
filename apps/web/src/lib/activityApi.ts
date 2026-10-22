/**
 * The activity log, typed — `GET /api/kontrol/audit` (apps/api/src/routes/kontrol.ts),
 * owner-only on the server whatever the screen does.
 *
 * Every store save writes its lines there since 2026-10-22 (packages/db
 * `store/activity.ts`), beside the sign-ins and staff changes the auth routes
 * always wrote. Server data in TanStack Query, like `staffApi`: who did what
 * is not the shop's data, and the store sends nobody a copy of it.
 */
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "./api.js";

export type ActivityAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "ARCHIVE"
  | "LOGIN"
  | "LOGIN_GAGAL"
  | "EKSPOR";

export interface ActivityEntry {
  readonly id: string;
  /** ISO. */
  readonly at: string;
  readonly action: ActivityAction;
  /** A store collection (`orders`, `units`, `settings`…) or `Staff`. */
  readonly entity: string;
  readonly entityId: string;
  /** The fields an UPDATE changed, comma-separated. */
  readonly field: string | null;
  /** JSON: the changed fields before, or what a removed row was. */
  readonly before: string | null;
  /** JSON: the changed fields after, or what an added row is. */
  readonly after: string | null;
  readonly requestId: string | null;
  readonly ip: string | null;
  readonly staff: {
    readonly id: string;
    readonly name: string;
    readonly username: string;
  } | null;
}

export interface ActivityFilter {
  readonly page: number;
  readonly perPage: number;
  readonly staffId?: string | undefined;
  readonly action?: readonly ActivityAction[] | undefined;
  readonly entity?: string | undefined;
  /** ISO, inclusive. */
  readonly from?: string | undefined;
  /** ISO, exclusive. */
  readonly to?: string | undefined;
  readonly q?: string | undefined;
}

export interface ActivityPage {
  readonly entries: readonly ActivityEntry[];
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
}

/** The query string the route reads. Empty filters are left out. */
export function activityQuery(f: ActivityFilter): string {
  const p = new URLSearchParams();
  p.set("page", String(f.page));
  p.set("perPage", String(f.perPage));
  if (f.staffId) p.set("staffId", f.staffId);
  if (f.action && f.action.length > 0) p.set("action", f.action.join(","));
  if (f.entity) p.set("entity", f.entity);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.q && f.q.trim() !== "") p.set("q", f.q.trim());
  return p.toString();
}

export function useActivity(filter: ActivityFilter, enabled = true) {
  return useQuery({
    queryKey: ["kontrol", "audit", filter],
    queryFn: () =>
      api<ActivityPage>(`/api/kontrol/audit?${activityQuery(filter)}`),
    // A new page or filter keeps the old rows on screen until it lands.
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * Clear the whole log — `DELETE /api/kontrol/audit`, owner-only (2026-10-22).
 * The server leaves one line recording the clear; `cleared` is how many rows
 * went before it.
 */
export function useClearActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ cleared: number }>("/api/kontrol/audit", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kontrol", "audit"] }),
  });
}

/** An entry's JSON column, read back. Anything unreadable is nothing. */
export function readValues(text: string | null): Record<string, unknown> {
  if (text === null || text === "") return {};
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
