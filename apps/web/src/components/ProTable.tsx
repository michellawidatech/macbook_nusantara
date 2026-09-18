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
import { Button, Flex, Input, Select, Space, Typography, theme } from "antd";
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
};

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
  /** Right-hand side of the toolbar — a primary action, a count, a segmented view switch. */
  extra?: ReactNode;
  /** Turn on row selection. Wide viewports only; see this file's docblock. */
  selectable?: boolean;
  /** Rendered beside the "N selected" line once something is ticked. */
  bulkActions?: (selected: T[], clear: () => void) => ReactNode;
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
  bulkActions,
  resetKey,
  rowKey,
  ...rest
}: ProTableProps<T>) {
  const { compact } = useLayoutMode();
  const { t } = useTranslation();
  const {
    token: { colorTextSecondary, colorFillTertiary, colorBorderSecondary },
  } = theme.useToken();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  /**
   * Which column is sorted, and which way.
   *
   * Seeded from whichever column declared `defaultSortOrder`, so a list that
   * wants to open newest-first still does. antd would normally own this, but
   * it cannot: it only ever sees one page (see the docblock).
   */
  const [sort, setSort] = useState<{ key: string; order: SortOrder }>(() => {
    const i = columns.findIndex((c) => c.defaultSortOrder);
    return i < 0
      ? { key: "", order: null }
      : {
          key: colKey(columns[i]!, i),
          order: columns[i]!.defaultSortOrder as SortOrder,
        };
  });

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
  }, [dataSource, query, filters, sort, columns]);

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
        };
      }) as AntColumns<T>,
    [columns, facetOptions, filters, sort],
  );

  const selected = useMemo(() => {
    if (!selectable) return [];
    const keyOf = (r: T, i: number) =>
      typeof rowKey === "function" ? rowKey(r, i) : String(raw(r, rowKey));
    return rows.filter((r, i) => selectedKeys.includes(keyOf(r, i)));
  }, [selectable, rows, selectedKeys, rowKey]);

  const clear = () => setSelectedKeys([]);

  const activeFilterCount = Object.values(filters).reduce(
    (n, v) => n + v.length,
    0,
  );
  // The phone layout has no column headers to hang a filter on, so the selects
  // come back there — driving the very same state. See the docblock.
  const showToolbarFilters = compact && facetCols.length > 0;
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
            {/* Shown in BOTH layouts. On a desktop the header funnels are easy
                to set and easy to forget — one lit icon among nine columns —
                so the one control that clears them all has to be visible from
                outside the header. */}
            {activeFilterCount > 0 && (
              <Button type="link" size="small" onClick={() => setFilters({})}>
                {t("proTable.clearFilters", "Clear filters ({{count}})", {
                  count: activeFilterCount,
                })}
              </Button>
            )}
            {toolbar}
          </Flex>
          {/* `marginLeft: auto` rather than leaning on the parent's
              space-between: once the filter row wraps, this lands on a line of
              its own, and space-between does nothing for a line holding a
              single item — it would sit flush LEFT. Same trap FooterToolbar
              documents. */}
          {extra && (
            <Flex
              gap={SPACE.sm}
              style={compact ? undefined : { marginLeft: "auto" }}
            >
              {extra}
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
        rowKey={rowKey}
        columns={tableColumns}
        dataSource={rows}
        // Search and filters are new questions, so both send the pager back to
        // page one — see DataTable's `resetKey`.
        resetKey={`${String(resetKey ?? "")}|${query}|${JSON.stringify(filters)}`}
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
