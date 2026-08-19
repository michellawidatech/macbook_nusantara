/**
 * The app's standard list: a search box, per-column value filters, per-column
 * sorting, and optional row selection with bulk actions — Ant Design Pro's
 * ProTable arrangement, built on this codebase's own `DataTable`.
 *
 * Why not `@ant-design/pro-components`: its peer range is `antd ^4 || ^5` and
 * this app is on antd 6. Pulling it in would run two different antd component
 * trees against one ConfigProvider. So the *arrangement* is Pro's and the
 * *components* are the ones already here — which also means every list keeps
 * `DataTable`'s two hard-won behaviours: scroll-to-load instead of a pager, and
 * cards instead of a grid on a phone.
 *
 * What a caller declares, and what this derives from it:
 *
 * - `searchable: true` on a column puts that column's text into the one search
 *   box above the table. Nothing else needs saying; the box knows what it
 *   searches because the columns said so.
 * - `facet: true` turns a column into a multi-select filter in the toolbar,
 *   with its options built from the values actually present in the data. antd's
 *   own header `filters` do this too — but they live IN the table header, and
 *   `DataTable` replaces the header with cards on a phone, so a header filter
 *   is a control that silently disappears on the device it is most needed on.
 *   The toolbar exists in both layouts.
 * - `sortValue` makes a column sortable. A column with a `dataIndex` and no
 *   `sorter` gets a generic one for free, because "sortable per column" is the
 *   house rule and opting in one column at a time is how half a table ends up
 *   unsortable.
 *
 * Selection is grid-only by the same logic as antd's header filters: antd
 * renders its checkbox column inside the table, which a phone does not draw.
 * `bulkActions` therefore only appears on a wide viewport, and a page whose
 * primary flow is a bulk action needs a per-card button too.
 */
import { useMemo, useState, type Key, type ReactNode } from "react";
import { Button, Flex, Input, Select, Space, Typography, theme } from "antd";
import type { TableProps } from "antd";
import { SPACE, TYPE } from "../theme/tokens";
import { useLayoutMode } from "../layouts/useLayoutMode";
import { DataTable, type DataTableProps } from "./DataTable";

type AntColumns<T> = NonNullable<TableProps<T>["columns"]>;
type AntColumn<T> = AntColumns<T>[number];

export type ProColumn<T> = AntColumn<T> & {
  /** Fold this column's text into the search box above the table. */
  searchable?: boolean;
  /**
   * Offer this column as a multi-select filter in the toolbar. The options are
   * the distinct values present in `dataSource`, so a filter can never offer a
   * value that would return nothing.
   */
  facet?: boolean;
  /** Label for the facet control. Defaults to the column's `title`. */
  facetLabel?: string;
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
  /** Extra controls dropped into the toolbar, after the facets. */
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

/** A stable key for a column, used for facet state and React keys. */
function colKey<T>(col: ProColumn<T>, index: number): string {
  const withKey = col as { key?: Key; dataIndex?: unknown };
  if (withKey.key !== undefined) return String(withKey.key);
  if (withKey.dataIndex !== undefined) return String(withKey.dataIndex);
  return `col-${index}`;
}

export function ProTable<T extends object>({
  columns,
  dataSource,
  searchPlaceholder = "Search",
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
  const {
    token: { colorTextSecondary, colorFillTertiary, colorBorderSecondary },
  } = theme.useToken();
  const [query, setQuery] = useState("");
  const [facets, setFacets] = useState<Record<string, string[]>>({});
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);

  const searchCols = columns.filter((c) => c.searchable);
  const facetCols = columns.filter((c) => c.facet);

  /** Distinct values per facet column, in first-seen order. */
  const facetOptions = useMemo(() => {
    const out: Record<string, string[]> = {};
    facetCols.forEach((col, i) => {
      const key = colKey(col, i);
      const seen = new Set<string>();
      for (const row of dataSource) {
        const v = valueOf(col, row);
        if (v !== undefined && v !== "") seen.add(String(v));
      }
      out[key] = [...seen].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      );
    });
    return out;
    // `facetCols` is rebuilt each render from `columns`; keying the memo on the
    // array identity would defeat it, so it keys on what actually decides the
    // options: the rows, and which columns are facets.
  }, [dataSource, facetCols.map((c, i) => colKey(c, i)).join("|")]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return dataSource.filter((row) => {
      for (const [key, picked] of Object.entries(facets)) {
        if (!picked.length) continue;
        const col = facetCols.find((c, i) => colKey(c, i) === key);
        if (!col) continue;
        const v = valueOf(col, row);
        if (v === undefined || !picked.includes(String(v))) return false;
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
  }, [dataSource, query, facets, columns]);

  /**
   * Every column becomes sortable. A column that already declared a `sorter`
   * keeps it; the rest get one built from `sortValue`/`dataIndex`. Columns with
   * neither — an actions column — are left alone, since there is nothing to
   * compare.
   */
  const sortedColumns = useMemo(
    () =>
      columns.map((col) => {
        const {
          searchable,
          facet,
          facetLabel,
          sortValue,
          searchValue,
          ...antCol
        } = col;
        const sortable =
          sortValue !== undefined ||
          (antCol as { dataIndex?: unknown }).dataIndex !== undefined;
        if ((antCol as { sorter?: unknown }).sorter !== undefined || !sortable)
          return antCol;
        return {
          ...antCol,
          sorter: (a: T, b: T) => compare(valueOf(col, a), valueOf(col, b)),
        };
      }) as AntColumns<T>,
    [columns],
  );

  const selected = useMemo(() => {
    if (!selectable) return [];
    const keyOf = (r: T, i: number) =>
      typeof rowKey === "function" ? rowKey(r, i) : String(raw(r, rowKey));
    return rows.filter((r, i) => selectedKeys.includes(keyOf(r, i)));
  }, [selectable, rows, selectedKeys, rowKey]);

  const clear = () => setSelectedKeys([]);

  const activeFacetCount = Object.values(facets).reduce(
    (n, v) => n + v.length,
    0,
  );
  const hasToolbar =
    search ||
    facetCols.length > 0 ||
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
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ width: 320 }}
              />
            )}
            {facetCols.map((col, i) => {
              const key = colKey(col, i);
              return (
                <Select
                  key={key}
                  mode="multiple"
                  allowClear
                  maxTagCount="responsive"
                  value={facets[key] ?? []}
                  placeholder={
                    col.facetLabel ?? (col.title as string) ?? "Filter"
                  }
                  options={(facetOptions[key] ?? []).map((v) => ({
                    value: v,
                    label: v,
                  }))}
                  onChange={(v) => setFacets((f) => ({ ...f, [key]: v }))}
                  style={{ minWidth: 200 }}
                />
              );
            })}
            {activeFacetCount > 0 && (
              <Button type="link" size="small" onClick={() => setFacets({})}>
                Clear filters
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
            {selected.length} selected
          </Typography.Text>
          <Space>
            {bulkActions?.(selected, clear)}
            <Button size="small" type="text" onClick={clear}>
              Clear
            </Button>
          </Space>
        </Flex>
      )}

      <DataTable
        {...rest}
        rowKey={rowKey}
        columns={sortedColumns}
        dataSource={rows}
        // Search and facets are new questions, so both send the growing window
        // back to the first page — see DataTable's `resetKey`.
        resetKey={`${String(resetKey ?? "")}|${query}|${JSON.stringify(facets)}`}
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
          Showing {rows.length} of {dataSource.length}
        </Typography.Text>
      )}
    </>
  );
}
