/**
 * DataTable — docs/rebuild/02-interaction.md §8, the section this rebuild
 * exists for. "Most screens are a table. Get these right once, in the shared
 * component."
 *
 * Extracted after Inventori (S9), not before it — the affordances here are
 * the ones that screen actually needed plus the §8 contract:
 *
 *   - explicit, resizable column widths, persisted per user per table, with a
 *     keyboard-operable resize handle (a mouse-only control fails §14);
 *   - ellipsis + title tooltip; wrapping is opt-in per column, never default;
 *   - numbers right-aligned and tabular; sort stable, arrowed, multi-column
 *     with Shift+click;
 *   - selection: Space toggles, Shift+click ranges, tri-state header that says
 *     what it will select; bulk actions in a docked bar, never a hidden menu;
 *   - compact/normal density, persisted;
 *   - virtualization above ~200 rows (01 §5);
 *   - empty and no-match are different states with different next actions.
 *
 * Deliberately NOT here: filters. They belong to the page (URL state) and to
 * FacetFilter/FilterChipBar — a table that owns its filters cannot share them
 * with the URL.
 */

import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
} from "@tanstack/react-table";
import { observeElementRect, useVirtualizer } from "@tanstack/react-virtual";
import type { SortState } from "./useUrlState.js";
import styles from "./DataTable.module.css";

export interface KitColumn<T> {
  readonly id: string;
  readonly header: ReactNode;
  readonly cell: (row: T) => ReactNode;
  /** Tooltip for truncated text (§8). Defaults to none. */
  readonly title?: (row: T) => string;
  readonly width?: number;
  readonly minWidth?: number;
  readonly align?: "left" | "right";
  readonly sortable?: boolean;
  /** Opt-in wrapping — never the default (§8). */
  readonly wrap?: boolean;
}

export interface BulkAction {
  readonly label: string;
  readonly onAction: (selectedKeys: string[]) => void;
}

export interface DataTableProps<T> {
  /** Prefs key: widths and density live under `staffId` + `tableId`. */
  readonly tableId: string;
  readonly staffId?: string;
  readonly columns: readonly KitColumn<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly caption?: string;
  /** Controlled multi-sort; first entry is the primary column. */
  readonly sort?: readonly SortState[];
  readonly onSortChange?: (next: SortState[]) => void;
  readonly selected?: ReadonlySet<string>;
  readonly onSelectedChange?: (next: Set<string>) => void;
  readonly bulkActions?: readonly BulkAction[];
  /** Enter on a focused row (§2: every actionable row is actionable). */
  readonly onRowOpen?: (row: T) => void;
  /** Which empty state applies (§8): no data at all, or no matches. */
  readonly isFiltered: boolean;
  readonly emptyState: ReactNode;
  readonly noMatchState: ReactNode;
  /** Scroll viewport height; virtualization needs a bounded box. */
  readonly height?: number | string;
  /** Rows briefly highlighted — e.g. the line a duplicate scan hit (§2). */
  readonly highlightKeys?: ReadonlySet<string>;
}

const VIRTUAL_THRESHOLD = 200;
const ROW_HEIGHT = { compact: 32, normal: 44 } as const;
const RESIZE_STEP = 16;

type Density = keyof typeof ROW_HEIGHT;

interface TablePrefs {
  readonly widths: Record<string, number>;
  readonly density: Density;
}

function prefsKey(staffId: string, tableId: string): string {
  return `nusantara.table.${staffId}.${tableId}`;
}

function loadPrefs(key: string): TablePrefs {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw !== null && raw !== undefined) return JSON.parse(raw) as TablePrefs;
  } catch {
    // Corrupt prefs are defaults, not a crash.
  }
  return { widths: {}, density: "normal" };
}

function savePrefs(key: string, prefs: TablePrefs): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(prefs));
  } catch {
    // Nothing persists, everything still works this session.
  }
}

export function DataTable<T>({
  tableId,
  staffId = "anon",
  columns,
  rows,
  rowKey,
  caption,
  sort = [],
  onSortChange,
  selected,
  onSelectedChange,
  bulkActions = [],
  onRowOpen,
  isFiltered,
  emptyState,
  noMatchState,
  height = "100%",
  highlightKeys,
}: DataTableProps<T>) {
  const storageKey = prefsKey(staffId, tableId);
  const [prefs, setPrefs] = useState<TablePrefs>(() => loadPrefs(storageKey));

  const updatePrefs = (mutate: (prev: TablePrefs) => TablePrefs) => {
    setPrefs((prev) => {
      const next = mutate(prev);
      savePrefs(storageKey, next);
      return next;
    });
  };

  const selectable = selected !== undefined && onSelectedChange !== undefined;

  // TanStack owns the sizing model (01 §1's chosen table core); everything
  // interactive around it is ours.
  const columnDefs = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((col) => ({
        id: col.id,
        size: col.width ?? 160,
        minSize: col.minWidth ?? 60,
        cell: () => null, // rendering is done by KitColumn.cell directly
      })),
    [columns],
  );

  const table = useReactTable({
    data: rows as T[],
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
    state: { columnSizing: prefs.widths as ColumnSizingState },
    onColumnSizingChange: (updater) =>
      updatePrefs((prev) => ({
        ...prev,
        widths: typeof updater === "function" ? updater(prev.widths) : updater,
      })),
    columnResizeMode: "onChange",
  });

  const widthOf = (columnId: string, fallback: number): number =>
    prefs.widths[columnId] ?? fallback;

  // --- sorting ---------------------------------------------------------------

  const sortOf = (columnId: string) => sort.find((s) => s.column === columnId);

  const clickSort = (columnId: string, additive: boolean) => {
    if (onSortChange === undefined) return;
    const existing = sortOf(columnId);
    const flipped: SortState = {
      column: columnId,
      dir: existing?.dir === "asc" ? "desc" : "asc",
    };
    if (!additive) {
      onSortChange([flipped]);
      return;
    }
    // Shift+click: add the column to the sort, or flip it in place (§8).
    const next = sort.some((s) => s.column === columnId)
      ? sort.map((s) => (s.column === columnId ? flipped : s))
      : [...sort, { column: columnId, dir: "asc" as const }];
    onSortChange([...next]);
  };

  // --- selection -------------------------------------------------------------

  const anchor = useRef<number | null>(null);

  const toggleRow = (index: number, shiftKey: boolean) => {
    if (!selectable) return;
    const next = new Set(selected);
    if (shiftKey && anchor.current !== null) {
      const [from, to] = [
        Math.min(anchor.current, index),
        Math.max(anchor.current, index),
      ];
      for (let i = from; i <= to; i += 1) {
        const row = rows[i];
        if (row !== undefined) next.add(rowKey(row));
      }
    } else {
      const row = rows[index];
      if (row !== undefined) {
        const key = rowKey(row);
        if (next.has(key)) next.delete(key);
        else next.add(key);
      }
      anchor.current = index;
    }
    onSelectedChange(next);
  };

  const visibleKeys = useMemo(
    () => rows.map((row) => rowKey(row)),
    [rows, rowKey],
  );
  const selectedVisible = selectable
    ? visibleKeys.filter((key) => selected.has(key)).length
    : 0;
  const allVisible =
    selectable && rows.length > 0 && selectedVisible === rows.length;

  const toggleAllVisible = () => {
    if (!selectable) return;
    const next = new Set(selected);
    if (allVisible) for (const key of visibleKeys) next.delete(key);
    else for (const key of visibleKeys) next.add(key);
    onSelectedChange(next);
  };

  const onRowKeyDown = (
    e: KeyboardEvent<HTMLTableRowElement>,
    index: number,
  ) => {
    if (e.target !== e.currentTarget) return; // typing in a cell control
    if (e.key === " " && selectable) {
      e.preventDefault();
      toggleRow(index, e.shiftKey);
    } else if (e.key === "Enter" && onRowOpen !== undefined) {
      e.preventDefault();
      const row = rows[index];
      if (row !== undefined) onRowOpen(row);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const sibling =
        e.key === "ArrowDown"
          ? e.currentTarget.nextElementSibling
          : e.currentTarget.previousElementSibling;
      if (sibling instanceof HTMLElement) sibling.focus();
    }
  };

  // --- virtualization --------------------------------------------------------

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowHeight = ROW_HEIGHT[prefs.density];
  const virtual = rows.length > VIRTUAL_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
    enabled: virtual,
    // A zero-sized container (jsdom, a hidden tab) would virtualize to an
    // empty range and blank the table. Fall back to a sane viewport; a real
    // browser reports the true rect on the next observation.
    observeElementRect: (instance, cb) =>
      observeElementRect(instance, (rect) =>
        cb(
          rect.width === 0 && rect.height === 0
            ? { width: 960, height: 640 }
            : rect,
        ),
      ),
  });

  const items = virtual ? virtualizer.getVirtualItems() : null;
  const first = items?.[0]?.start ?? 0;
  const last =
    items === null
      ? 0
      : virtualizer.getTotalSize() - (items[items.length - 1]?.end ?? 0);
  const indices =
    items === null ? rows.map((_, i) => i) : items.map((v) => v.index);

  const interactive = selectable || onRowOpen !== undefined;

  const rowClass = (key: string) =>
    [
      prefs.density === "compact" ? styles.rowCompact : styles.rowNormal,
      selectable && selected.has(key) ? styles.rowSelected : "",
      highlightKeys?.has(key) ? styles.rowHighlight : "",
    ]
      .filter(Boolean)
      .join(" ");

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.density}
          onClick={() =>
            updatePrefs((prev) => ({
              ...prev,
              density: prev.density === "normal" ? "compact" : "normal",
            }))
          }
        >
          Kepadatan: {prefs.density === "normal" ? "Normal" : "Rapat"}
        </button>
      </div>

      <div className={styles.scroll} ref={scrollRef} style={{ height }}>
        <table className={styles.table}>
          {caption === undefined ? null : (
            <caption className={styles.srOnly}>{caption}</caption>
          )}
          <thead>
            <tr>
              {selectable ? (
                <th
                  scope="col"
                  className={styles.checkCell}
                  style={{ width: 36 }}
                >
                  <input
                    type="checkbox"
                    checked={allVisible}
                    ref={(el) => {
                      // Tri-state: some-but-not-all is indeterminate (§8).
                      if (el !== null)
                        el.indeterminate = selectedVisible > 0 && !allVisible;
                    }}
                    aria-label={`Pilih ${rows.length} baris terlihat`}
                    onChange={toggleAllVisible}
                  />
                </th>
              ) : null}
              {columns.map((col, colIndex) => {
                const width = widthOf(col.id, col.width ?? 160);
                const s = sortOf(col.id);
                const position = sort.findIndex((x) => x.column === col.id);
                const arrow =
                  s === undefined
                    ? ""
                    : ` ${s.dir === "asc" ? "↑" : "↓"}${sort.length > 1 ? position + 1 : ""}`;
                const header = table.getHeaderGroups()[0]?.headers[colIndex];
                return (
                  <th
                    key={col.id}
                    scope="col"
                    style={{ width }}
                    className={
                      col.align === "right" ? styles.thRight : styles.th
                    }
                    aria-sort={
                      s === undefined
                        ? undefined
                        : s.dir === "asc"
                          ? "ascending"
                          : "descending"
                    }
                  >
                    {col.sortable === true && onSortChange !== undefined ? (
                      <button
                        type="button"
                        className={styles.sortButton}
                        onClick={(e) => clickSort(col.id, e.shiftKey)}
                      >
                        {col.header}
                        {arrow}
                      </button>
                    ) : (
                      <span>{col.header}</span>
                    )}
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Ubah lebar kolom ${col.id}`}
                      aria-valuenow={Math.round(width)}
                      aria-valuemin={col.minWidth ?? 60}
                      aria-valuemax={800}
                      tabIndex={0}
                      className={styles.resizer}
                      onMouseDown={header?.getResizeHandler()}
                      onTouchStart={header?.getResizeHandler()}
                      onKeyDown={(e) => {
                        // The mouse is optional everywhere (§2) — including here.
                        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight")
                          return;
                        e.preventDefault();
                        const delta =
                          e.key === "ArrowRight" ? RESIZE_STEP : -RESIZE_STEP;
                        updatePrefs((prev) => ({
                          ...prev,
                          widths: {
                            ...prev.widths,
                            [col.id]: Math.max(
                              col.minWidth ?? 60,
                              width + delta,
                            ),
                          },
                        }));
                      }}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {virtual && first > 0 ? (
              <tr aria-hidden="true" style={{ height: first }} />
            ) : null}
            {indices.map((index) => {
              const row = rows[index];
              if (row === undefined) return null;
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  className={rowClass(key)}
                  tabIndex={interactive ? 0 : undefined}
                  aria-selected={selectable ? selected.has(key) : undefined}
                  onKeyDown={
                    interactive ? (e) => onRowKeyDown(e, index) : undefined
                  }
                  onDoubleClick={
                    onRowOpen === undefined ? undefined : () => onRowOpen(row)
                  }
                >
                  {selectable ? (
                    <td className={styles.checkCell}>
                      <input
                        type="checkbox"
                        checked={selected.has(key)}
                        aria-label={`Pilih baris ${key}`}
                        // onClick, not onChange, because only the click event
                        // carries shiftKey — and no preventDefault: cancelling
                        // a checkbox's native toggle desyncs React's controlled
                        // checked tracking, and the controlled prop re-asserts
                        // the right state on the next render anyway.
                        onClick={(e) => toggleRow(index, e.shiftKey)}
                        onChange={() => undefined}
                      />
                    </td>
                  ) : null}
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className={
                        col.align === "right" ? styles.tdRight : styles.td
                      }
                      title={col.title?.(row)}
                    >
                      <span
                        className={
                          col.wrap === true ? styles.wrapCell : styles.truncate
                        }
                      >
                        {col.cell(row)}
                      </span>
                    </td>
                  ))}
                </tr>
              );
            })}
            {virtual && last > 0 ? (
              <tr aria-hidden="true" style={{ height: last }} />
            ) : null}
          </tbody>
        </table>

        {rows.length === 0 ? (
          <div className={styles.emptyWrap}>
            {isFiltered ? noMatchState : emptyState}
          </div>
        ) : null}
      </div>

      {/* The docked bulk bar (§8): visible the moment anything is selected,
          with the count and a clear affordance. Never a menu to hunt for. */}
      {selectable && selected.size > 0 ? (
        <div className={styles.bulkBar} role="toolbar" aria-label="Aksi massal">
          <span className={styles.bulkCount}>{selected.size} dipilih</span>
          {bulkActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={styles.bulkAction}
              onClick={() => action.onAction([...selected])}
            >
              {action.label}
            </button>
          ))}
          <button
            type="button"
            className={styles.bulkClear}
            onClick={() => onSelectedChange(new Set())}
          >
            Batal pilih
          </button>
        </div>
      ) : null}
    </div>
  );
}
