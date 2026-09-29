/**
 * URL state — docs/rebuild/02-interaction.md §7.
 *
 * "Filters, sort, page and open-drawer id live in the URL. A shared link
 * reproduces the exact view." This is not a nicety: it is how a staff member
 * sends a colleague "the twelve units that failed opname" without describing
 * it in words (01 §5).
 *
 * Extracted from InventoriPage — every convention here is one that screen
 * actually needed, not one imagined in advance:
 *
 *   - multi-select facets are one comma-separated param (`lokasi=a,b`);
 *   - changing any filter deletes `page`, because page 3 of the old filter is
 *     not a place in the new one;
 *   - clearing a value removes the param entirely, so the pristine URL and the
 *     reset URL are the same string.
 */

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export interface SortState {
  readonly column: string;
  readonly dir: "asc" | "desc";
}

export interface UrlState {
  /** The raw params, for query keys and request URLs. */
  readonly params: URLSearchParams;
  readonly get: (key: string) => string | null;
  /** A comma-separated multi-select, `""` and absent both meaning none. */
  readonly getList: (key: string) => string[];
  readonly getNumber: (key: string, fallback: number) => number;
  /** Batch several changes into one history entry. */
  readonly update: (mutate: (next: URLSearchParams) => void) => void;
  /** Set or (with null/"") remove one param. Filters reset the page. */
  readonly set: (
    key: string,
    value: string | null,
    opts?: { keepPage?: boolean },
  ) => void;
  /** Toggle one id inside a multi-select param. Resets the page. */
  readonly toggleInList: (key: string, id: string) => void;
  /** First entry drives a single-sort server; later entries are Shift+click. */
  readonly getSort: (fallback: SortState) => SortState[];
  readonly setSort: (next: readonly SortState[]) => void;
  /** Back to the pristine URL. */
  readonly reset: () => void;
}

/**
 * Sort is `sort=landed&dir=desc`, exactly the shape Inventori shipped with in
 * S9 — a shared URL from before this hook existed still reproduces its view.
 * Multi-column (02 §8, Shift+click) extends both params as parallel lists:
 * `sort=landed,serial&dir=desc,asc`.
 */
function parseSort(
  sortRaw: string | null,
  dirRaw: string | null,
  fallback: SortState,
): SortState[] {
  if (sortRaw === null || sortRaw === "") return [fallback];
  const dirs = (dirRaw ?? "").split(",");
  const parsed = sortRaw
    .split(",")
    .filter((c) => c !== "")
    .map((column, i): SortState => ({
      column,
      dir: dirs[i] === "desc" ? "desc" : "asc",
    }));
  return parsed.length === 0 ? [fallback] : parsed;
}

export function useUrlState(): UrlState {
  const [params, setParams] = useSearchParams();

  const update = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        mutate(next);
        return next;
      });
    },
    [setParams],
  );

  return useMemo<UrlState>(
    () => ({
      params,
      get: (key) => params.get(key),
      getList: (key) => {
        const raw = params.get(key);
        return raw === null || raw === "" ? [] : raw.split(",");
      },
      getNumber: (key, fallback) => {
        const n = Number(params.get(key));
        return Number.isFinite(n) && n > 0 ? n : fallback;
      },
      update,
      set: (key, value, opts) =>
        update((next) => {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
          if (opts?.keepPage !== true) next.delete("page");
        }),
      toggleInList: (key, id) =>
        update((next) => {
          const raw = next.get(key);
          const current = raw === null || raw === "" ? [] : raw.split(",");
          const after = current.includes(id)
            ? current.filter((v) => v !== id)
            : [...current, id];
          if (after.length === 0) next.delete(key);
          else next.set(key, after.join(","));
          next.delete("page");
        }),
      getSort: (fallback) =>
        parseSort(params.get("sort"), params.get("dir"), fallback),
      setSort: (next) =>
        update((p) => {
          if (next.length === 0) {
            p.delete("sort");
            p.delete("dir");
          } else {
            p.set("sort", next.map((s) => s.column).join(","));
            p.set("dir", next.map((s) => s.dir).join(","));
          }
          p.delete("page");
        }),
      reset: () => setParams(new URLSearchParams()),
    }),
    [params, update, setParams],
  );
}
