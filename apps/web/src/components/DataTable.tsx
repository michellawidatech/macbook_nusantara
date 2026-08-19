/**
 * The app's one list surface: a table that loads as you scroll, and stops
 * being a table on a phone.
 *
 * Two problems this solves, both of which every list page had independently.
 *
 * 1. **Pagination.** antd's default pager puts a numbered footer under every
 *    table. On a phone that footer is a row of 32px tap targets a thumb misses,
 *    and it makes "how much stock do we hold" a paging exercise. This renders a
 *    growing window instead: `pageSize` rows, then another `pageSize` each time
 *    a sentinel below the last row enters the viewport. The rows already
 *    rendered stay rendered — this is progressive disclosure, not
 *    virtualisation, which is the right trade at our row counts (the mock seed
 *    is 5 000 units, and 5 000 DOM rows is a real cost only if you ever scroll
 *    to them).
 *
 * 2. **Columns on a 375px screen.** A seven-column stock table on a phone can
 *    either scroll sideways — which hides the columns that matter behind a
 *    gesture nobody discovers — or stop being a grid. Below `md` this renders
 *    one card per row, built from the SAME column definitions: the first
 *    titled column becomes the card's heading, the rest become label/value
 *    lines, and any column with a blank title (the actions column, by this
 *    codebase's convention) drops to the bottom of the card as its buttons.
 *    Nothing is declared twice, so a column added for the desktop table shows
 *    up on the phone without anyone remembering to add it there.
 *
 * A caller keeps writing ordinary antd `columns`. Pages that need a real grid
 * on a phone — the line-item editors inside the stock forms, where the columns
 * ARE the form — keep using `<Table>` directly and are unaffected.
 *
 * Known limit: a column's `sorter` and `filters` are the TABLE's controls —
 * they live in its header — so they do nothing in card mode. A list whose
 * filtering matters on a phone should filter above the list, in a `FilterBar`,
 * where the control exists in both layouts.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Key,
  type ReactNode,
} from "react";
import { Card, Empty, Flex, Spin, Table, Typography, theme } from "antd";
import type { TableProps } from "antd";
import { SPACE, TYPE, WEIGHT } from "../theme/tokens";
import { useLayoutMode } from "../layouts/useLayoutMode";

type AntColumns<T> = NonNullable<TableProps<T>["columns"]>;
type AntColumn<T> = AntColumns<T>[number];

export interface DataTableProps<T> extends Omit<
  TableProps<T>,
  "pagination" | "dataSource" | "columns"
> {
  dataSource: readonly T[];
  columns: AntColumns<T>;
  /**
   * Rows per load. 25 fills a laptop viewport and roughly two phone screens,
   * so the first scroll is what triggers the second load rather than the
   * sentinel being visible on arrival.
   */
  pageSize?: number;
  /**
   * Change this to send the window back to the first page — a search string, a
   * filter value. Without it the window only ever grows, which is right when
   * the underlying data changed under the user and wrong when the user asked a
   * new question.
   *
   * Deliberately NOT derived from `dataSource` identity: most callers build
   * their rows with an inline `.filter()`, so identity changes on every render
   * of the parent and a reset keyed on it would snap the list back to the top
   * every time anything in the store moved.
   */
  resetKey?: unknown;
  /**
   * Set false to keep the grid on a phone. For tables whose columns are inputs
   * rather than readings, where cards would break the row's alignment.
   */
  cards?: boolean;
}

/** Reads a column's raw cell value, honouring antd's array dataIndex form. */
function cellValue<T>(record: T, dataIndex: unknown): unknown {
  if (dataIndex === undefined || dataIndex === null) return undefined;
  const path = Array.isArray(dataIndex) ? dataIndex : [dataIndex];
  return path.reduce<unknown>(
    (acc, k) =>
      acc == null ? undefined : (acc as Record<string, unknown>)[String(k)],
    record,
  );
}

/**
 * What a column would paint in this row.
 *
 * `render` may return either a node or antd's `{ children, props }` cell
 * descriptor (the rowSpan/colSpan form). The descriptor is meaningless outside
 * a grid, so card mode keeps the children and drops the spans.
 */
function cellContent<T>(
  col: AntColumn<T>,
  record: T,
  index: number,
): ReactNode {
  const c = col as {
    dataIndex?: unknown;
    render?: (v: unknown, r: T, i: number) => unknown;
  };
  const value = cellValue(record, c.dataIndex);
  const out = c.render ? c.render(value, record, index) : value;
  if (
    out != null &&
    typeof out === "object" &&
    !Array.isArray(out) &&
    "children" in out
  ) {
    return (out as { children?: ReactNode }).children ?? null;
  }
  return out as ReactNode;
}

/** Column groups have no meaning in a card; flatten to the leaves. */
function leafColumns<T>(columns: AntColumns<T>): AntColumn<T>[] {
  return columns.flatMap((c) =>
    "children" in c && Array.isArray(c.children)
      ? (c.children as AntColumn<T>[])
      : [c],
  );
}

function keyOf<T>(
  record: T,
  index: number,
  rowKey: TableProps<T>["rowKey"],
): Key {
  if (typeof rowKey === "function") return rowKey(record, index);
  if (typeof rowKey === "string") {
    const k = cellValue(record, rowKey);
    if (k != null) return String(k);
  }
  return index;
}

export function DataTable<T extends object>({
  dataSource,
  columns,
  pageSize = 25,
  resetKey,
  cards = true,
  rowKey,
  size,
  scroll,
  ...rest
}: DataTableProps<T>) {
  const { compact } = useLayoutMode();
  const {
    token: { colorTextSecondary, colorBorderSecondary },
  } = theme.useToken();

  const [limit, setLimit] = useState(pageSize);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLimit(pageSize);
  }, [resetKey, pageSize]);

  const rows = useMemo(() => dataSource.slice(0, limit), [dataSource, limit]);
  const more = dataSource.length > rows.length;

  // `limit` is a dependency on purpose. Re-observing after each load re-fires
  // the callback while the sentinel is STILL in view, which is what keeps a
  // tall viewport filling instead of stalling one page in: an observer left
  // attached only reports intersection *changes*, and appending rows below a
  // sentinel that never left the screen is not one. It terminates because
  // every pass adds `pageSize` rows to a finite list, and `more` gates it.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    // jsdom and older WebViews have no observer. Showing everything beats
    // showing the first 25 rows with no way to reach row 26.
    if (typeof IntersectionObserver === "undefined") {
      setLimit(dataSource.length);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting))
          setLimit((n) => n + pageSize);
      },
      // Start the next load a screenful early, so the rows are there before
      // the user scrolls to where they would have been missing.
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [more, limit, pageSize, dataSource.length]);

  const leaves = useMemo(() => leafColumns(columns), [columns]);

  // A column with no title is this codebase's actions column. In a card those
  // belong at the bottom, unlabelled — a "" label above a row of buttons reads
  // as a rendering bug.
  const titled = leaves.filter((c) => c.title !== undefined && c.title !== "");
  const untitled = leaves.filter(
    (c) => c.title === undefined || c.title === "",
  );
  const [heading, ...fields] = titled;

  const footer = (
    // The sentinel must stay mounted while `more` is true — it is what the
    // observer watches. The count line replaces it once the list is whole, so
    // the end of a list is a statement rather than an absence.
    <div ref={sentinel} style={{ paddingBlock: SPACE.md, textAlign: "center" }}>
      {more ? (
        <Spin size="small" />
      ) : dataSource.length > pageSize ? (
        <Typography.Text
          style={{ fontSize: TYPE.sm, color: colorTextSecondary }}
        >
          {dataSource.length} rows — that's all of them
        </Typography.Text>
      ) : null}
    </div>
  );

  // An expandable table's detail row has nowhere to go in a card — there is no
  // second level to expand INTO — so a table that uses one keeps its grid and
  // scrolls sideways on a phone. Detected rather than configured: a caller who
  // adds `expandable` later would otherwise silently lose the expansion on
  // mobile and never see it, because they were testing on a laptop.
  if (compact && cards && rest.expandable === undefined) {
    return (
      <>
        <Flex vertical gap={SPACE.sm}>
          {rows.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          {rows.map((record, index) => (
            <Card key={keyOf(record, index, rowKey)} size="small">
              {heading && (
                <div
                  style={{ fontWeight: WEIGHT.strong, marginBottom: SPACE.sm }}
                >
                  {cellContent(heading, record, index)}
                </div>
              )}
              <Flex vertical gap={SPACE.xs}>
                {fields.map((col, i) => (
                  <Flex
                    key={String(col.key ?? i)}
                    justify="space-between"
                    align="baseline"
                    gap={SPACE.md}
                  >
                    <Typography.Text
                      style={{
                        fontSize: TYPE.sm,
                        color: colorTextSecondary,
                        flexShrink: 0,
                      }}
                    >
                      {col.title as ReactNode}
                    </Typography.Text>
                    {/* minWidth: 0 lets a long description shrink and wrap
                        instead of pushing its own label off the card. */}
                    <div style={{ textAlign: "right", minWidth: 0 }}>
                      {cellContent(col, record, index)}
                    </div>
                  </Flex>
                ))}
              </Flex>
              {untitled.length > 0 && (
                <Flex
                  justify="flex-end"
                  gap={SPACE.sm}
                  style={{
                    marginTop: SPACE.sm,
                    paddingTop: SPACE.sm,
                    borderTop: `1px solid ${colorBorderSecondary}`,
                  }}
                >
                  {untitled.map((col, i) => (
                    <div key={String(col.key ?? i)}>
                      {cellContent(col, record, index)}
                    </div>
                  ))}
                </Flex>
              )}
            </Card>
          ))}
        </Flex>
        {footer}
      </>
    );
  }

  return (
    <>
      <Table
        {...rest}
        rowKey={rowKey}
        columns={columns}
        dataSource={rows as T[]}
        pagination={false}
        size={size ?? "middle"}
        // A tablet is wide enough for a grid and still too narrow for eight
        // columns, so the desktop table keeps its own horizontal scroll rather
        // than compressing every cell to a two-character column.
        scroll={scroll ?? { x: "max-content" }}
      />
      {footer}
    </>
  );
}
