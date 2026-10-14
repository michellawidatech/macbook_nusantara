/**
 * The app's standard list: a search box, per-column filters in the column
 * headers, per-column sorting, and optional row selection with bulk actions —
 * Ant Design Pro's ProTable arrangement, built on this codebase's own
 * `DataTable`.
 *
 * Why not `@ant-design/pro-components`: its peer range is `antd ^4 || ^5` and
 * this app is on antd 6. Pulling it in would run two different antd component
 * trees against one ConfigProvider. So the *arrangement* is Pro's and the
 * *components* are the ones already here.
 *
 * ## Where the filters live, and why this file does the filtering
 *
 * Until 2026-08-26 a filterable column rendered a multi-select in a toolbar
 * ROW above the table. The owner asked for the control to sit in the column
 * header instead, which is where antd puts it and where a reader looks for it.
 * That is what `facet: true` now renders — antd's own funnel icon, checkbox
 * list and Reset/OK.
 *
 * The catch that shapes the rest of this file: `DataTable` replaces the header
 * with cards on a phone, so a header-only filter would be a control that
 * silently disappears on the device it is most needed on. The fix is that the
 * header dropdown is only ever a CONTROL — this component holds the filter
 * state and does the filtering itself:
 *
 * - `filters` + `filteredValue` are passed to the column, so antd paints the
 *   dropdown and ticks the right boxes;
 * - `onFilter` is deliberately NOT passed, so antd does not also filter, which
 *   would apply the same predicate twice;
 * - `onChange` reports what the user picked and the state lands here.
 *
 * On a phone the same state is driven by selects in the toolbar instead. One
 * filter state, two controls — so a filter picked on a desktop survives a
 * tablet rotating into card mode.
 *
 * Sorting works the same way and for a sharper reason: `DataTable` paginates,
 * and a `sorter` function left to antd would sort only the rows on the current
 * page. `sorter: true` renders the arrows without antd sorting anything, and
 * the comparison happens here, over the whole list, before it is paged.
 *
 * Selection is grid-only by the same logic: antd renders its checkbox column
 * inside the table, which a phone does not draw. `bulkActions` therefore only
 * appears on a wide viewport, and a page whose primary flow is a bulk action
 * needs a per-card button too.
 */
import { useMemo, useState, type Key, type ReactNode } from "react";
import { draftKey, usePersistentState } from "../hooks/usePersistentState";
import { asString, isRecord } from "../lib/draftGuards.js";
import {
  Button,
  DatePicker,
  Flex,
  Input,
  Select,
  Space,
  Tag,
  Typography,
  theme,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import type { TableProps } from "antd";
import { SPACE, TYPE } from "../theme/tokens";
import { useLayoutMode } from "../layouts/useLayoutMode";
import { DataTable, type DataTableProps } from "./DataTable";
import { useTranslation } from "react-i18next";
import { PAGE_SEARCH_ATTR } from "../lib/keyboardNav";

type AntColumns<T> = NonNullable<TableProps<T>["columns"]>;
type AntColumn<T> = AntColumns<T>[number];
type SortOrder = "ascend" | "descend" | null;

/**
 * How many distinct values a column may offer before its dropdown grows a
 * search box of its own. Twelve is about a screenful of checkboxes; past that,
 * scanning the list is slower than typing the first three letters.
 */
const FILTER_SEARCH_THRESHOLD = 12;

export type ProColumn<T> = AntColumn<T> & {
  /** Fold this column's text into the search box above the table. */
  searchable?: boolean;
  /**
   * Give this column a filter dropdown in its header. The options are the
   * distinct values present in `dataSource`, so a filter can never offer a
   * value that would return nothing.
   */
  facet?: boolean;
  /** Label for the phone-layout filter control. Defaults to the column's `title`. */
  facetLabel?: string;
  /**
   * What this column offers as filter options, when they are not its own
   * values. A number column is the case that needs it: battery health sorts as
   * a number and must, but faceting on the raw reading would offer four hundred
   * one-unit options — so the column sorts on `sortValue` and filters on a band
   * from here. Rows whose facet value is undefined are filtered OUT while that
   * filter has anything picked, exactly as an unset `sortValue` is.
   */
  facetValue?: (record: T) => string | undefined | null;
  /**
   * The comparable/filterable value for a row. Required when the column has no
   * `dataIndex` (a column rendered from several fields), optional otherwise.
   */
  sortValue?: (record: T) => string | number | undefined | null;
  /** Text this column contributes to search, when it differs from `sortValue`. */
  searchValue?: (record: T) => string | undefined | null;
  /**
   * Give this column a date-range filter in its header (owner ask
   * 2026-09-22: *"select by … date range"*). The column's value — `sortValue`
   * or `dataIndex` — must be an ISO instant or a `YYYY-MM-DD` day; it is
   * compared as the local calendar day it falls on, bounds included. A row
   * with no date is filtered OUT while a range is set, the rule a facet
   * already follows for a row with no value.
   */
  dateRange?: boolean;
};

/** A date filter's bounds as local `YYYY-MM-DD` days; either may be open. */
type DayRange = readonly [string | null, string | null];

export interface ProTableProps<T> extends Omit<
  DataTableProps<T>,
  "columns" | "rowSelection"
> {
  columns: ProColumn<T>[];
  /** Placeholder for the search box. Omit the box entirely with `search={false}`. */
  searchPlaceholder?: string;
  search?: boolean;
  /** Extra controls dropped into the toolbar, after the search box. */
  toolbar?: ReactNode;
  /**
   * Right-hand side of the toolbar — a primary action, a count, a segmented
   * view switch. A function is handed what is currently ticked, which is how
   * Payable and Receivable put the SELECTED total beside *Add payment*
   * (owner ask 2026-09-24) rather than always the whole page's.
   */
  extra?: ReactNode | ((selected: T[]) => ReactNode);
  /** Turn on row selection. Wide viewports only; see this file's docblock. */
  selectable?: boolean;
  /**
   * The rows carry `children` and are drawn as a tree (owner ask 2026-09-24:
   * Payable is *"a expandable column per supplier"*).
   *
   * Two things follow, and neither is worth making a caller remember. Row
   * selection becomes `checkStrictly: false`, so ticking a supplier ticks its
   * invoices and the page can total the LEAVES; and the phone keeps the grid
   * instead of becoming cards, for the reason `DataTable` already keeps it for
   * an expandable table — a child row has nowhere to go in a card, and hiding
   * it is worse than scrolling sideways.
   *
   * Searching, filtering and sorting still run over the TOP level only: a
   * group is what the list is of, and its `searchValue` is what carries its
   * children's numbers into the search box.
   */
  treeData?: boolean;
  /** Rendered beside the "N selected" line once something is ticked. */
  bulkActions?: (selected: T[], clear: () => void) => ReactNode;
  /**
   * Keep this list's search, filters and sort on this device, under this
   * name (owner ask 2026-09-21: *"all the things of the user input will be
   * saved locally"*). A page's own list sets it; a list inside a dialog does
   * not, because a picker that opens already narrowed by last week's search
   * is a picker that looks empty.
   */
  persistKey?: string;
  /**
   * What the header filters start at, column key → picked values (the facet
   * values, so the labels a `facetValue` gives). For a list whose useful
   * view is a slice — the chatbot's evaluations open on "bad, still open".
   * Shown as chips like any other filter, so it is one × away from the lot.
   */
  defaultFilters?: Record<string, string[]>;
}

/** The filter map as the header writes it: column key → picked values. */
function parseFilters(v: unknown): Record<string, string[]> | undefined {
  if (!isRecord(v)) return undefined;
  return Object.fromEntries(
    Object.entries(v)
      .filter(([, picked]) => Array.isArray(picked))
      .map(([k, picked]) => [
        k,
        (picked as unknown[]).filter((x): x is string => typeof x === "string"),
      ]),
  );
}

function parseRanges(v: unknown): Record<string, DayRange> | undefined {
  if (!isRecord(v)) return undefined;
  const day = (x: unknown) =>
    typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null;
  return Object.fromEntries(
    Object.entries(v)
      .filter(([, r]) => Array.isArray(r) && r.length === 2)
      .map(([k, r]) => [
        k,
        [day((r as unknown[])[0]), day((r as unknown[])[1])],
      ]),
  );
}

/** The local calendar day a column value falls on, or undefined. */
function dayOfValue(v: string | number | undefined): string | undefined {
  if (v === undefined || v === "") return undefined;
  const d = dayjs(v);
  return d.isValid() ? d.format("YYYY-MM-DD") : undefined;
}

/** Is a range doing anything? */
const rangeSet = (r: DayRange | undefined) =>
  r !== undefined && (r[0] !== null || r[1] !== null);

/** The picker's value for a stored range. */
const pickerValue = (
  r: DayRange | undefined,
): [Dayjs | null, Dayjs | null] | null =>
  rangeSet(r)
    ? [r![0] ? dayjs(r![0]) : null, r![1] ? dayjs(r![1]) : null]
    : null;

/** The stored range for what the picker reports. */
const fromPicker = (v: [Dayjs | null, Dayjs | null] | null): DayRange => [
  v?.[0] ? v[0].format("YYYY-MM-DD") : null,
  v?.[1] ? v[1].format("YYYY-MM-DD") : null,
];

function parseSort(v: unknown): { key: string; order: SortOrder } | undefined {
  if (!isRecord(v) || typeof v.key !== "string") return undefined;
  const order = v.order;
  return order === "ascend" || order === "descend" || order === null
    ? { key: v.key, order }
    : undefined;
}

/** Reads a column's raw cell value, honouring antd's array `dataIndex` form. */
function raw<T>(record: T, dataIndex: unknown): unknown {
  if (dataIndex === undefined || dataIndex === null) return undefined;
  const path = Array.isArray(dataIndex) ? dataIndex : [dataIndex];
  return path.reduce<unknown>(
    (acc, k) =>
      acc == null ? undefined : (acc as Record<string, unknown>)[String(k)],
    record,
  );
}

/** What a column sorts, filters and searches on. */
function valueOf<T>(col: ProColumn<T>, record: T): string | number | undefined {
  if (col.sortValue) {
    const v = col.sortValue(record);
    return v == null ? undefined : v;
  }
  const v = raw(record, (col as { dataIndex?: unknown }).dataIndex);
  if (v == null) return undefined;
  return typeof v === "number" ? v : String(v);
}

/** What a column's filter dropdown lists, and filters on. */
function facetOf<T>(col: ProColumn<T>, record: T): string | undefined {
  if (col.facetValue) {
    const v = col.facetValue(record);
    return v == null ? undefined : String(v);
  }
  const v = valueOf(col, record);
  return v === undefined ? undefined : String(v);
}

function compare(
  a: string | number | undefined,
  b: string | number | undefined,
): number {
  // Blanks sort last in both directions rather than clumping at whichever end
  // the empty string happens to land — an unpriced unit is not "cheapest".
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** A stable key for a column, used for filter state and React keys. */
function colKey<T>(col: ProColumn<T>, index: number): string {
  const withKey = col as { key?: Key; dataIndex?: unknown };
  if (withKey.key !== undefined) return String(withKey.key);
  if (withKey.dataIndex !== undefined) return String(withKey.dataIndex);
  return `col-${index}`;
}

export function ProTable<T extends object>({
  columns,
  dataSource,
  searchPlaceholder,
  search = true,
  toolbar,
  extra,
  selectable = false,
  treeData = false,
  bulkActions,
  resetKey,
  rowKey,
  persistKey,
  defaultFilters,
  ...rest
}: ProTableProps<T>) {
  const { compact } = useLayoutMode();
  const { t } = useTranslation();
  const {
    token: { colorTextSecondary, colorFillTertiary, colorBorderSecondary },
  } = theme.useToken();
  const kept = (part: string) =>
    persistKey === undefined ? null : draftKey(`list.${persistKey}.${part}`);
  const [query, setQuery] = usePersistentState<string>(
    kept("search"),
    "",
    asString,
  );
  const [filters, setFilters] = usePersistentState<Record<string, string[]>>(
    kept("filters"),
    () => defaultFilters ?? {},
    parseFilters,
  );
  const [ranges, setRanges] = usePersistentState<Record<string, DayRange>>(
    kept("ranges"),
    {},
    parseRanges,
  );
  const setRange = (key: string, v: [Dayjs | null, Dayjs | null] | null) =>
    setRanges((r) => ({ ...r, [key]: fromPicker(v) }));
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  /**
   * Which column is sorted, and which way.
   *
   * Seeded from whichever column declared `defaultSortOrder`, so a list that
   * wants to open newest-first still does. antd would normally own this, but
   * it cannot: it only ever sees one page (see the docblock).
   */
  const [sort, setSort] = usePersistentState<{
    key: string;
    order: SortOrder;
  }>(
    kept("sort"),
    () => {
      const i = columns.findIndex((c) => c.defaultSortOrder);
      return i < 0
        ? { key: "", order: null }
        : {
            key: colKey(columns[i]!, i),
            order: columns[i]!.defaultSortOrder as SortOrder,
          };
    },
    parseSort,
  );

  const searchCols = columns.filter((c) => c.searchable);
  /**
   * The filterable columns, each keyed by its index in `columns` — NOT by its
   * index among the filterable ones.
   *
   * That distinction is the whole reason this is a list of pairs. `colKey`
   * falls back to `col-${index}` for a column carrying neither `key` nor
   * `dataIndex` (a derived column with only `facetValue` and `render`), and
   * `filters` is one flat map shared by three readers: the desktop header, the
   * phone toolbar and the row filter. The header numbered such a column by its
   * position in `columns` while the other two numbered it by its position
   * here, so the options were stored under one key and read under another —
   * the header quietly dropped the dropdown, and two colliding fallbacks would
   * have filtered the table on the wrong field entirely.
   *
   * One key per column, computed once, and every consumer reads it from here.
   */
  const facetCols = columns
    .map((col, index) => ({ col, key: colKey(col, index) }))
    .filter((c) => c.col.facet);
  /** The date-filtered columns, keyed the same way. */
  const dateCols = columns
    .map((col, index) => ({ col, key: colKey(col, index) }))
    .filter((c) => c.col.dateRange);

  /** Distinct values per filterable column, in alphabetical order. */
  const facetOptions = useMemo(() => {
    const out: Record<string, string[]> = {};
    facetCols.forEach(({ col, key }) => {
      const seen = new Set<string>();
      for (const row of dataSource) {
        const v = facetOf(col, row);
        if (v !== undefined && v !== "") seen.add(v);
      }
      out[key] = [...seen].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      );
    });
    return out;
    // `facetCols` is rebuilt each render from `columns`; keying the memo on the
    // array identity would defeat it, so it keys on what actually decides the
    // options: the rows, and which columns are filterable.
  }, [dataSource, facetCols.map((c) => c.key).join("|")]);

  /**
   * Search, then filters, then sort — over the WHOLE list, before `DataTable`
   * cuts it into pages.
   */
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const kept = dataSource.filter((row) => {
      for (const [key, picked] of Object.entries(filters)) {
        if (!picked.length) continue;
        const col = facetCols.find((c) => c.key === key)?.col;
        if (!col) continue;
        const v = facetOf(col, row);
        if (v === undefined || !picked.includes(v)) return false;
      }
      for (const { col, key } of dateCols) {
        const r = ranges[key];
        if (!rangeSet(r)) continue;
        const day = dayOfValue(valueOf(col, row));
        if (day === undefined) return false;
        if (r![0] !== null && day < r![0]) return false;
        if (r![1] !== null && day > r![1]) return false;
      }
      if (!needle) return true;
      // No column opted into search → search everything with a dataIndex,
      // which is the sane default for a list nobody has tuned yet.
      const cols = searchCols.length ? searchCols : columns;
      return cols.some((c) => {
        const text = c.searchValue ? c.searchValue(row) : valueOf(c, row);
        return text != null && String(text).toLowerCase().includes(needle);
      });
    });

    if (!sort.order) return kept;
    const i = columns.findIndex((c, n) => colKey(c, n) === sort.key);
    const col = i < 0 ? undefined : columns[i];
    if (!col) return kept;
    const dir = sort.order === "ascend" ? 1 : -1;
    // `slice()` first: `kept` may be `dataSource` itself when nothing is
    // filtered, and sorting a prop array in place mutates the caller's data.
    return kept
      .slice()
      .sort((a, b) => dir * compare(valueOf(col, a), valueOf(col, b)));
  }, [dataSource, query, filters, ranges, sort, columns]);

  /**
   * Every column gets its header controls: sort arrows, and a filter dropdown
   * if it asked for one. Neither does any work — see this file's docblock —
   * they only report what was clicked.
   */
  const tableColumns = useMemo(
    () =>
      columns.map((col, i) => {
        const {
          searchable,
          facet,
          facetLabel,
          facetValue,
          sortValue,
          searchValue,
          defaultSortOrder,
          dateRange,
          ...antCol
        } = col;
        const key = colKey(col, i);
        const sortable =
          sortValue !== undefined ||
          (antCol as { dataIndex?: unknown }).dataIndex !== undefined;
        const options = facetOptions[key] ?? [];
        return {
          ...antCol,
          key,
          ...(sortable
            ? {
                // `true`, not a comparator: it draws the arrows and reports
                // the click without antd sorting the one page it can see.
                sorter: true,
                sortOrder: sort.key === key ? sort.order : null,
              }
            : {}),
          ...(facet && options.length > 0
            ? {
                filters: options.map((v) => ({ text: v, value: v })),
                filteredValue: filters[key] ?? null,
                filterSearch: options.length > FILTER_SEARCH_THRESHOLD,
              }
            : {}),
          ...(dateRange
            ? {
                // A control only, like the facets: the range is this
                // component's state and the filtering happens above.
                filtered: rangeSet(ranges[key]),
                filterDropdown: ({ close }: { close: () => void }) => (
                  <Flex vertical gap={SPACE.sm} style={{ padding: SPACE.sm }}>
                    <DatePicker.RangePicker
                      // Inside the dropdown, not in a portal of its own: a
                      // click on the calendar must not read as a click
                      // outside the filter, which closes it.
                      getPopupContainer={(node) =>
                        node.parentElement ?? document.body
                      }
                      value={pickerValue(ranges[key])}
                      onChange={(v) => setRange(key, v)}
                      allowEmpty={[true, true]}
                      format="DD MMM YYYY"
                      placeholder={[
                        t("proTable.dateFrom", "From"),
                        t("proTable.dateUntil", "Until"),
                      ]}
                    />
                    <Flex justify="space-between">
                      <Button
                        size="small"
                        type="link"
                        disabled={!rangeSet(ranges[key])}
                        onClick={() => setRange(key, null)}
                      >
                        {t("proTable.dateReset", "Reset")}
                      </Button>
                      <Button size="small" type="primary" onClick={close}>
                        {t("proTable.dateDone", "OK")}
                      </Button>
                    </Flex>
                  </Flex>
                ),
              }
            : {}),
        };
      }) as AntColumns<T>,
    [columns, facetOptions, filters, ranges, sort],
  );

  const selected = useMemo(() => {
    if (!selectable) return [];
    const keyOf = (r: T, i: number) =>
      typeof rowKey === "function" ? rowKey(r, i) : String(raw(r, rowKey));
    const out: T[] = [];
    // Depth-first, because a tree's ticks land on children as well as parents
    // and a page totalling only the top level would read zero for a supplier
    // whose invoices were ticked one at a time.
    const walk = (list: readonly T[]) => {
      list.forEach((r, i) => {
        if (selectedKeys.includes(keyOf(r, i))) out.push(r);
        const kids = (r as { children?: readonly T[] }).children;
        if (treeData && kids) walk(kids);
      });
    };
    walk(rows);
    return out;
  }, [selectable, treeData, rows, selectedKeys, rowKey]);

  const clear = () => setSelectedKeys([]);

  const activeFilterCount =
    Object.values(filters).reduce((n, v) => n + v.length, 0) +
    dateCols.filter(({ key }) => rangeSet(ranges[key])).length;

  /**
   * Every picked value as its own chip, with the way to take just it off.
   *
   * A facet contributes one chip per value; a date range contributes one for
   * the whole range, because half a range is not a filter anybody set.
   */
  const activeFilters = useMemo(() => {
    const nameOf = (col: ProColumn<T>) =>
      col.facetLabel ??
      (typeof col.title === "string" ? col.title : undefined) ??
      "";
    const out: {
      key: string;
      column: string;
      value: string;
      remove: () => void;
    }[] = [];
    for (const { col, key } of facetCols) {
      for (const value of filters[key] ?? []) {
        out.push({
          key,
          column: nameOf(col),
          value,
          remove: () =>
            setFilters((f) => ({
              ...f,
              [key]: (f[key] ?? []).filter((v) => v !== value),
            })),
        });
      }
    }
    for (const { col, key } of dateCols) {
      const r = ranges[key];
      if (!rangeSet(r)) continue;
      out.push({
        key,
        column: nameOf(col),
        value: [r?.[0], r?.[1]].filter(Boolean).join(" – "),
        remove: () =>
          setRanges((v) => {
            const next = { ...v };
            delete next[key];
            return next;
          }),
      });
    }
    return out;
  }, [facetCols, dateCols, filters, ranges]);
  // The phone layout has no column headers to hang a filter on, so the selects
  // come back there — driving the very same state. See the docblock.
  const showToolbarFilters =
    compact && (facetCols.length > 0 || dateCols.length > 0);
  const hasToolbar =
    search ||
    showToolbarFilters ||
    activeFilterCount > 0 ||
    toolbar !== undefined ||
    extra !== undefined;

  return (
    <>
      {hasToolbar && (
        <Flex
          className="responsive-controls"
          vertical={compact}
          wrap={!compact}
          align={compact ? "stretch" : "center"}
          justify="space-between"
          gap={compact ? SPACE.sm : SPACE.md}
          style={{ marginBottom: SPACE.md }}
        >
          <Flex
            className="responsive-controls"
            vertical={compact}
            wrap={!compact}
            align={compact ? "stretch" : "center"}
            gap={compact ? SPACE.sm : SPACE.md}
          >
            {search && (
              <Input.Search
                allowClear
                // What `/` jumps to (owner ask 2026-09-15). Marked rather than
                // found by shape: a page can hold several search-looking boxes
                // — a Select's own filter, a dialog's — and this is the one
                // that searches the PAGE. See `pageSearchBox`.
                {...{ [PAGE_SEARCH_ATTR]: "" }}
                placeholder={
                  searchPlaceholder ?? t("proTable.search", "Search")
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ width: compact ? undefined : 320 }}
              />
            )}
            {showToolbarFilters &&
              facetCols.map(({ col, key }) => {
                return (
                  <Select
                    key={key}
                    mode="multiple"
                    allowClear
                    maxTagCount="responsive"
                    value={filters[key] ?? []}
                    placeholder={
                      col.facetLabel ??
                      (typeof col.title === "string" ? col.title : undefined) ??
                      t("proTable.filter", "Filter")
                    }
                    options={(facetOptions[key] ?? []).map((v) => ({
                      value: v,
                      label: v,
                    }))}
                    onChange={(v) => setFilters((f) => ({ ...f, [key]: v }))}
                    style={{ minWidth: 200 }}
                  />
                );
              })}
            {showToolbarFilters &&
              dateCols.map(({ col, key }) => (
                <DatePicker.RangePicker
                  key={key}
                  value={pickerValue(ranges[key])}
                  onChange={(v) => setRange(key, v)}
                  allowEmpty={[true, true]}
                  format="DD MMM YYYY"
                  aria-label={
                    col.facetLabel ??
                    (typeof col.title === "string" ? col.title : undefined)
                  }
                  placeholder={[
                    t("proTable.dateFrom", "From"),
                    t("proTable.dateUntil", "Until"),
                  ]}
                />
              ))}
            {/* One chip per picked value, in BOTH layouts (owner ask
                2026-09-23: *"if there is like filter pls put it down instead
                of just saying clear 2 filters, so that I can cancel out one
                of the filter"*). A count told you how many were on and left
                you opening funnels to find which; a chip names it and its ×
                takes off that one alone. */}
            {activeFilterCount > 0 && (
              <Flex wrap align="center" gap={SPACE.xs}>
                {activeFilters.map((f) => (
                  <Tag
                    key={`${f.key}:${f.value}`}
                    closable
                    onClose={f.remove}
                    aria-label={t(
                      "proTable.removeFilter",
                      "Remove {{filter}}",
                      {
                        filter: `${f.column} ${f.value}`,
                      },
                    )}
                  >
                    <span style={{ opacity: 0.65 }}>{f.column}</span> {f.value}
                  </Tag>
                ))}
                {activeFilterCount > 1 && (
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      setFilters({});
                      setRanges({});
                    }}
                  >
                    {t("proTable.clearFilters", "Clear all")}
                  </Button>
                )}
              </Flex>
            )}
            {toolbar}
          </Flex>
          {/* `marginLeft: auto` rather than leaning on the parent's
              space-between: once the filter row wraps, this lands on a line of
              its own, and space-between does nothing for a line holding a
              single item — it would sit flush LEFT. Same trap FooterToolbar
              documents. */}
          {extra !== undefined && extra !== false && (
            <Flex
              gap={SPACE.sm}
              style={compact ? undefined : { marginLeft: "auto" }}
            >
              {typeof extra === "function" ? extra(selected) : extra}
            </Flex>
          )}
        </Flex>
      )}

      {selectable && !compact && selected.length > 0 && (
        <Flex
          align="center"
          justify="space-between"
          gap={SPACE.md}
          style={{
            marginBottom: SPACE.md,
            padding: `${SPACE.sm}px ${SPACE.md}px`,
            background: colorFillTertiary,
            border: `1px solid ${colorBorderSecondary}`,
            borderRadius: 6,
          }}
        >
          <Typography.Text style={{ fontSize: TYPE.sm }}>
            {t("proTable.selected", "{{count}} selected", {
              count: selected.length,
            })}
          </Typography.Text>
          <Space>
            {bulkActions?.(selected, clear)}
            <Button size="small" type="text" onClick={clear}>
              {t("proTable.clearSelection", "Clear")}
            </Button>
          </Space>
        </Flex>
      )}

      <DataTable
        {...rest}
        {...(treeData ? { cards: false } : {})}
        rowKey={rowKey}
        columns={tableColumns}
        dataSource={rows}
        // Search and filters are new questions, so both send the pager back to
        // page one — see DataTable's `resetKey`.
        resetKey={`${String(resetKey ?? "")}|${query}|${JSON.stringify(filters)}|${JSON.stringify(ranges)}`}
        /**
         * Where a header click lands. antd hands back the whole filter map and
         * the sorter it just changed; both become this component's state, and
         * the next render feeds them back down as `filteredValue`/`sortOrder`.
         */
        onChange={(_pagination, nextFilters, sorter) => {
          setFilters(
            Object.fromEntries(
              Object.entries(nextFilters).map(([k, v]) => [
                k,
                (v ?? []).map(String),
              ]),
            ),
          );
          // Never an array here: `multiple` is not set on any sorter in this
          // app, so antd reports a single object.
          const s = Array.isArray(sorter) ? sorter[0] : sorter;
          setSort({
            key: s?.columnKey === undefined ? "" : String(s.columnKey),
            order: (s?.order ?? null) as SortOrder,
          });
        }}
        rowSelection={
          selectable && !compact
            ? {
                selectedRowKeys: selectedKeys,
                onChange: (keys) => setSelectedKeys(keys),
                // A supplier's tick is its invoices' ticks (see `treeData`).
                ...(treeData ? { checkStrictly: false } : {}),
              }
            : undefined
        }
      />

      {rows.length !== dataSource.length && (
        <Typography.Text
          style={{ fontSize: TYPE.sm, color: colorTextSecondary }}
        >
          {t("proTable.narrowed", "Showing {{shown}} of {{total}}", {
            shown: rows.length,
            total: dataSource.length,
          })}
        </Typography.Text>
      )}
    </>
  );
}
