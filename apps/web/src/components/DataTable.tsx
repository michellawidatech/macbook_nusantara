/**
 * The app's one list surface: a paginated table that stops being a table on a
 * phone.
 *
 * Two problems this solves, both of which every list page had independently.
 *
 * 1. **Pagination.** This used to render a growing window — `pageSize` rows,
 *    then another `pageSize` each time a sentinel scrolled into view. It was
 *    replaced on 2026-08-26 (owner decision) by an ordinary pager with a page
 *    size the user picks. The scroll window was pleasant to use and hopeless to
 *    work with: there was no way to say "show me 100 at a time", no way to tell
 *    how far through a list you were, and no way to get back to a row you had
 *    scrolled past except scrolling past it again. A pager answers all three,
 *    and `showTotal` puts the count on screen where it used to take a scroll to
 *    the end to learn.
 *
 *    The page and the page size live HERE rather than in antd's Table, because
 *    the card layout below has no Table to keep them in and the two modes must
 *    not disagree about which page you are on when a tablet rotates.
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
 * A caller keeps writing ordinary antd `columns`. A table whose columns ARE the
 * form — the line-item editors inside the stock and inbound screens — wants
 * `EditableTable` instead: same idea, but the stacked layout is labelled
 * full-width FIELDS rather than label/value readings, and it owns the add-row
 * button and its keyboard shortcut. The two share `tableCells.ts`.
 *
 * Known limit: a column's `sorter` and `filters` are the TABLE's controls — they
 * live in its header — so they do nothing in card mode. `ProTable` is what
 * handles that: it filters the rows itself and hands this component a list that
 * is already narrowed, so a filter picked on a desktop survives a rotation to
 * cards.
 */
import { useEffect, useMemo, useState } from "react";
import { Card, Empty, Flex, Pagination, Table, Typography, theme } from "antd";
import type { TableProps } from "antd";
import { SPACE, TYPE, WEIGHT } from "../theme/tokens";
import { useLayoutMode } from "../layouts/useLayoutMode";
import {
  cellContent,
  isActionColumn,
  keyOf,
  leafColumns,
  titleText,
  type AntColumns,
} from "./tableCells";
import { useTranslation } from "react-i18next";

/**
 * What the size changer offers.
 *
 * 10 is a screenful on a phone, 20 fills a laptop, and 100 is the "just show me
 * everything" option a stock take wants. 500 is deliberately absent: these
 * tables render every cell, and five hundred rows of `MoneyInput` is a visible
 * pause on the shop's own hardware.
 */
export const PAGE_SIZES = [10, 20, 50, 100] as const;

export interface DataTableProps<T> extends Omit<
  TableProps<T>,
  "pagination" | "dataSource" | "columns"
> {
  dataSource: readonly T[];
  columns: AntColumns<T>;
  /**
   * Rows per page before the user changes it. 20 fills a laptop viewport
   * without making the pager feel like it is doing nothing.
   */
  pageSize?: number;
  /** Hide the pager entirely — for a table that is a form, not a list. */
  paginated?: boolean;
  /**
   * Change this to send the pager back to page one — a search string, a filter
   * value. Without it, narrowing a list while on page 7 leaves you on a page
   * that no longer exists.
   *
   * Deliberately NOT derived from `dataSource` identity: most callers build
   * their rows with an inline `.filter()`, so identity changes on every render
   * of the parent and a reset keyed on it would snap the list back to page one
   * every time anything in the store moved.
   */
  resetKey?: unknown;
  /**
   * Set false to keep the grid on a phone. For tables whose columns are inputs
   * rather than readings, where cards would break the row's alignment.
   */
  cards?: boolean;
}

export function DataTable<T extends object>({
  dataSource,
  columns,
  pageSize: initialPageSize = 20,
  paginated = true,
  resetKey,
  cards = true,
  rowKey,
  size,
  scroll,
  ...rest
}: DataTableProps<T>) {
  const { compact } = useLayoutMode();
  const { t } = useTranslation();
  const {
    token: { colorTextSecondary, colorBorderSecondary },
  } = theme.useToken();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  // A page that no longer exists — the list shrank under a filter while the
  // user was on page 7 — shows nothing at all, with a pager that offers no way
  // back. Clamping during render rather than in an effect avoids painting that
  // empty frame first.
  const lastPage = Math.max(1, Math.ceil(dataSource.length / pageSize));
  const current = Math.min(page, lastPage);

  const rows = useMemo(
    () =>
      paginated
        ? dataSource.slice((current - 1) * pageSize, current * pageSize)
        : dataSource.slice(),
    [dataSource, current, pageSize, paginated],
  );

  const leaves = useMemo(() => leafColumns(columns), [columns]);

  // A column with no title is this codebase's actions column. In a card those
  // belong at the bottom, unlabelled — a "" label above a row of buttons reads
  // as a rendering bug.
  const titled = leaves.filter((c) => !isActionColumn(c));
  const untitled = leaves.filter(isActionColumn);
  const [heading, ...fields] = titled;

  const onPageChange = (next: number, nextSize: number) => {
    // antd fires this for a size change too, with a `next` it has already
    // rebased. Trusting it keeps the first visible row roughly where it was
    // rather than jumping to the top on every size change.
    setPage(next);
    setPageSize(nextSize);
  };

  /**
   * The pager, shared by both layouts so the two cannot drift.
   *
   * `showTotal` is the reason the old scroll window's "N rows" line is not
   * missed: the count is on screen at all times instead of only once the list
   * has been scrolled to its end.
   */
  const pager = paginated ? (
    <Flex
      justify="flex-end"
      style={{ marginTop: SPACE.md }}
      // The pager wraps to two lines on a phone rather than pushing the size
      // changer off the right edge.
      wrap
      gap={SPACE.sm}
    >
      <Pagination
        current={current}
        pageSize={pageSize}
        total={dataSource.length}
        onChange={onPageChange}
        // The whole point of the change: the user picks how many.
        showSizeChanger
        pageSizeOptions={PAGE_SIZES as unknown as number[]}
        // No quick-jump on a phone — it is a text field between two arrows on
        // a 375px line, and the arrows are what a thumb wants.
        showQuickJumper={!compact}
        size={compact ? "small" : undefined}
        showTotal={(total, [from, to]) =>
          t("dataTable.range", "{{from}}–{{to}} of {{total}}", {
            from,
            to,
            total,
          })
        }
        responsive
      />
    </Flex>
  ) : null;

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
                      {titleText(col)}
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
        {pager}
      </>
    );
  }

  return (
    <Table
      {...rest}
      rowKey={rowKey}
      columns={columns}
      // Already sliced above. antd is handed one page and told not to paginate,
      // so the page state has exactly one home — see this file's docblock.
      dataSource={rows as T[]}
      pagination={false}
      size={size ?? "middle"}
      // A tablet is wide enough for a grid and still too narrow for eight
      // columns, so the desktop table keeps its own horizontal scroll rather
      // than compressing every cell to a two-character column.
      scroll={scroll ?? { x: "max-content" }}
      footer={paginated ? () => pager : undefined}
    />
  );
}
