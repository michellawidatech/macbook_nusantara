/**
 * A line-item editor: the surface for a table whose columns ARE the form.
 *
 * `DataTable` is the app's list surface, and its docblock used to end by
 * saying that "pages that need a real grid on a phone — the line-item editors
 * inside the stock forms — keep using `<Table>` directly and are unaffected".
 * Three owner complaints on 2026-09-01 said that exemption was the bug:
 *
 * 1. **Add a row from the bottom, and from the keyboard.** *Add product* sat
 *    in the card header, above a table you had just finished reading downwards,
 *    and could only be reached with a mouse. It is now the last thing under the
 *    last row — where the next row is going to appear — and ⌘⏎ (Ctrl+⏎ off a
 *    Mac) does the same thing from inside any cell.
 * 2. **Every cell fillable with a keyboard alone.** Which mostly means landing
 *    IN the row you just created: adding a line and then tabbing back down
 *    through eight controls to reach it is not keyboard support, it is a
 *    keyboard obstacle course. Focus follows the add.
 * 3. **No cell squeezed below its own input.** A grid whose columns compress
 *    gives you a Qty box one character wide with the stepper arrows on top of
 *    it. So the grid never compresses (`scroll.x`), and below `md` it stops
 *    being a grid at all: a row becomes a card of labelled, full-width fields —
 *    the owner's "make another rows". Horizontal scrolling is the right answer
 *    on a tablet, where the columns nearly fit; it is the wrong one on a phone,
 *    where five columns are five slivers behind a gesture nobody discovers.
 *
 * The stacked layout is built from the SAME `columns` — see `tableCells.ts` —
 * so a column added for the grid appears there without being declared twice.
 *
 * Deliberately not paginated. A line-item editor shows every line it has: you
 * are filling this in, not browsing it, and a total under a page-one subtotal
 * is a lie. A list wants `DataTable`; a filterable list wants `ProTable`.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button, Card, Empty, Flex, Table, Typography, theme } from "antd";
import type { TableProps } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { SPACE, TYPE, WEIGHT } from "../theme/tokens";
import { useLayoutMode } from "../layouts/useLayoutMode";
import {
  cellContent,
  gridMinWidth,
  isActionColumn,
  keyOf,
  leafColumns,
  titleText,
  type AntColumn,
  type AntColumns,
} from "./tableCells";
import { useTranslation } from "react-i18next";
import {
  EDITABLE_ROW_ATTR,
  focusControl,
  gridArrowTarget,
} from "../lib/keyboardNav";

/**
 * The attribute the keyboard finds a row by, in either layout.
 *
 * A DOM lookup rather than a registry of refs, for the same reason
 * `MultiFillNumber` uses one: the row a focus lands in did not exist when the
 * keystroke asking for it was handled, so anything captured in advance would
 * be stale exactly when it mattered.
 */
/**
 * Restated from `lib/keyboardNav.ts` rather than imported, and the direction
 * matters: that module was written against the marker this component already
 * put on its rows, so this is the definition and `EDITABLE_ROW_ATTR` is the
 * copy. The assertion below is what keeps them one value.
 */
const ROW_ATTR: typeof EDITABLE_ROW_ATTR = "data-editable-row";

/** What counts as somewhere a caret can go. */
const FOCUSABLE =
  "input:not([disabled]), textarea:not([disabled]), select:not([disabled])," +
  ' button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Whether to print ⌘ or Ctrl beside the shortcut.
 *
 * `userAgent` rather than the deprecated `platform`, and a plain test rather
 * than a library: the answer only decides which of two keycaps is drawn, and
 * getting it wrong shows somebody the other modifier — which is a hint, not a
 * broken feature. Both are wired up regardless (see `onKeyDown`).
 */
function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}

/**
 * Keycaps are not translated — `⌘`, `Ctrl` and `Enter` are printed on the
 * keyboard in both languages. Same rule `FillGuideModal` follows; see the head
 * of `i18n/locales/id.ts`.
 */
export function addRowShortcutLabel(): string {
  return isApplePlatform() ? "⌘ + Enter" : "Ctrl + Enter";
}

/** True for the chord that adds a row, whichever platform pressed it. */
export function isAddRowChord(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): boolean {
  // Alt excluded so this cannot fire from a chord meant for something else.
  return e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.altKey;
}

/**
 * The grid's own width, when every column has declared one.
 *
 * This is what stops a long value in one column stealing room from the rest
 * (owner complaint 2026-09-01: a product picker holding
 * `PRO 13" 2016 i5 8/128 NTB — MacBook Pro 13 2016 i5 / 8GB / 128GB / NTB`
 * squeezed Qty down to a sliver and broke "Rp 3.900.000" across three lines).
 * A number here puts rc-table into `table-layout: fixed`, where a column gets
 * the width it asked for and nothing else can bid for it; the long label wraps
 * onto a second line inside its own cell instead, which is the owner's "it
 * should just have 2 rows".
 *
 * Summed here rather than passed in, because the two have to agree exactly —
 * short, and rc-table takes the difference out of the one column with no width
 * of its own; long, and it pads the last column with the surplus, which is how
 * the QC grid's action buttons once ended up a quarter of a screen right of the
 * row they belonged to. A hand-maintained constant drifts the first time
 * somebody adds a column; this cannot.
 *
 * Null the moment ANY column leaves its width open, because such a column is
 * asking to be sized by its content and `max-content` is how that is spelled.
 */
function declaredWidth<T>(columns: AntColumn<T>[]): number | null {
  let total = 0;
  for (const col of columns) {
    const w = (col as { width?: number | string }).width;
    if (typeof w !== "number") return null;
    total += w;
  }
  return total === 0 ? null : total;
}

/**
 * Whether a column belongs in the stacked layout.
 *
 * antd's own `responsive` already says which breakpoints a column is for, and
 * the stacked layout IS the below-`md` case — so a column marked
 * `responsive: ["md"]` is asking to be left out of it, and gets its wish
 * without a second vocabulary being invented for the same fact. The grid above
 * `md` honours the property natively, so the two agree by construction.
 */
function inStackedLayout<T>(col: AntColumn<T>): boolean {
  const r = (col as { responsive?: readonly string[] }).responsive;
  if (!r) return true;
  return r.includes("xs") || r.includes("sm");
}

/** Moves the caret to the first control in a row of this editor. */
function focusRow(root: HTMLElement | null, row: number): void {
  const host = root?.querySelector<HTMLElement>(`[${ROW_ATTR}="${row}"]`);
  host?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
}

/**
 * `data-` attributes are legal DOM and absent from React's typed attribute
 * set, so the marker is built as a loose record and spread — a spread of a
 * non-literal type skips the excess-property check a literal would fail.
 */
function rowMarker(row: number): Record<string, unknown> {
  return { [ROW_ATTR]: row };
}

export interface EditableTableProps<T> extends Omit<
  TableProps<T>,
  "pagination" | "dataSource" | "columns" | "footer"
> {
  dataSource: readonly T[];
  columns: AntColumns<T>;
  /**
   * Appends a row. Drawn as the button under the last row, and bound to ⌘⏎
   * from inside any cell. Omit for an editor whose rows come from elsewhere —
   * the QC grid's rows are the quantities on the order.
   */
  onAdd?: () => void;
  /** The add button's label. Required with `onAdd`, so it says what it adds. */
  addLabel?: string;
  /** Greys the add button — a closed invoice, a row still half-filled. */
  addDisabled?: boolean;
  /** What an editor with no rows says. */
  emptyText?: ReactNode;
  /**
   * The caption at the top of a stacked row's card. Defaults to "Line n",
   * which is what the row's position is called when there is no grid to read
   * it off. Return null for a card that needs no heading.
   */
  rowTitle?: (record: T, index: number) => ReactNode;
  /**
   * Overrides the grid's width. Rarely needed: when every column declares a
   * numeric `width` this is their sum (see `declaredWidth`), and otherwise it
   * is `max-content`, which is the no-column-ever-compresses guarantee.
   */
  scrollX?: number | "max-content";
}

export function EditableTable<T extends object>({
  dataSource,
  columns,
  onAdd,
  addLabel,
  addDisabled,
  emptyText,
  rowTitle,
  scrollX,
  rowKey,
  rowClassName,
  onRow,
  size,
  className,
  locale,
  ...rest
}: EditableTableProps<T>) {
  const { compact } = useLayoutMode();
  const { t } = useTranslation();
  const {
    token: { colorTextSecondary, colorBorderSecondary },
  } = theme.useToken();

  const rootRef = useRef<HTMLDivElement>(null);
  /** Set by an add, cleared by the render that answers it. */
  const focusPending = useRef(false);
  const rowCount = dataSource.length;
  const lastCount = useRef(rowCount);

  useEffect(() => {
    const grew = rowCount > lastCount.current;
    lastCount.current = rowCount;
    if (!focusPending.current) return;
    // Cleared either way: an add that produced no row (a caller refusing it
    // because the last one is still empty) must not park the request and fire
    // it at whatever row appears next.
    focusPending.current = false;
    if (grew) focusRow(rootRef.current, rowCount - 1);
  }, [rowCount]);

  const add = useCallback(() => {
    if (!onAdd || addDisabled) return;
    focusPending.current = true;
    onAdd();
  }, [onAdd, addDisabled]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!onAdd || !isAddRowChord(e)) return;
      e.preventDefault();
      add();
    },
    [onAdd, add],
  );

  /**
   * The grid's arrows (owner ask 2026-09-15: *"All of the UI has to be
   * keyboard friendly … arrow buttons, and other navigation helpers"*).
   *
   * ↑ ↓ move down a column, ← → across a row. `gridArrowTarget` decides which
   * arrows are the grid's and which belong to the control under the caret,
   * which is the whole difficulty: ↓ in a number box steps the figure, ↓ on a
   * closed Select opens it, and → in a half-typed serial moves the caret.
   *
   * ## Why CAPTURE
   *
   * antd's `InputNumber` calls `preventDefault()` on ↑ ↓ to step its value,
   * and it does so before a bubbling handler here would ever run — so on
   * bubble every one of these keys arrives already claimed, and `Qty` was the
   * one column the arrows could not leave. Capture is the only phase in which
   * the question "whose key is this?" can still be asked, which is the same
   * reason `KeyboardNav` reads Enter there.
   *
   * Enter is NOT here: it moves to the next FIELD everywhere in the app, and
   * `components/KeyboardNav.tsx` owns it once for all of them.
   */
  const onKeyDownCapture = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (root === null) return;
    const target = gridArrowTarget(e, e.target, root);
    if (target === null) return;
    // Before the number steps, before the list opens, and before the browser
    // scrolls the row into view.
    e.preventDefault();
    e.stopPropagation();
    focusControl(target);
  }, []);

  const leaves = useMemo(() => leafColumns(columns), [columns]);
  const stacked = leaves.filter(inStackedLayout);
  const fields = stacked.filter((c) => !isActionColumn(c));
  const actions = stacked.filter(isActionColumn);
  // Every column declared: their sum, laid out `fixed`. Otherwise the same sum
  // with the open columns counted at their floor, laid out `auto` so they can
  // wrap and take the slack — never `max-content`, which refused to wrap and
  // scrolled a grid that fitted (2026-09-28).
  const declared = declaredWidth(leaves);
  const gridWidth = scrollX ?? declared ?? gridMinWidth(leaves);

  const heading = (record: T, index: number): ReactNode =>
    rowTitle
      ? rowTitle(record, index)
      : t("editableTable.line", "Line {{n}}", { n: index + 1 });

  const adder = onAdd ? (
    <Flex
      vertical
      align="center"
      gap={SPACE.xs}
      style={{ marginTop: SPACE.sm }}
    >
      <Button
        type="dashed"
        block
        // `aria-hidden` on the glyph, which antd ships with `role="img"` and
        // an `aria-label` of its own ("plus"). Without this the button's
        // accessible name is "plus Add product" — the icon reading itself out
        // in front of the label it decorates.
        icon={<PlusOutlined aria-hidden />}
        disabled={addDisabled}
        onClick={add}
      >
        {addLabel}
      </Button>
      {/* No modifier key on a phone, so no hint about one. */}
      {!compact && (
        <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
          {t("editableTable.orPress", "or press {{keys}}", {
            keys: addRowShortcutLabel(),
          })}
        </Typography.Text>
      )}
    </Flex>
  ) : null;

  const empty = (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={emptyText ?? t("editableTable.empty", "Nothing here yet.")}
    />
  );

  const body = compact ? (
    /*
     * Stacked. Every column is a labelled field at full width — including the
     * first, which `DataTable` promotes to a card heading and this deliberately
     * does not: in an editor the first column is the product picker, and a
     * picker with its label taken away is a box nobody can name.
     */
    <Flex vertical gap={SPACE.sm}>
      {rowCount === 0 && empty}
      {dataSource.map((record, index) => {
        const title = heading(record, index);
        return (
          <div
            key={keyOf(record, index, rowKey)}
            // The row props the caller wrote for a `<tr>` — a click handler, a
            // ref, a background — land on the card instead. Dropping them here
            // would make a converted table lose behaviour on a phone and only
            // on a phone, which is the kind of difference nobody finds until a
            // person at the counter reports it.
            {...(onRow?.(record, index) ?? {})}
            {...rowMarker(index)}
            className={[
              "nusantara-stacked-row",
              typeof rowClassName === "function"
                ? rowClassName(record, index, 0)
                : (rowClassName ?? ""),
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <Card size="small">
              {title != null && title !== "" && (
                <Typography.Text
                  style={{
                    fontSize: TYPE.sm,
                    color: colorTextSecondary,
                    display: "block",
                    marginBottom: SPACE.sm,
                  }}
                >
                  {title}
                </Typography.Text>
              )}
              <Flex vertical gap={SPACE.sm}>
                {fields.map((col, i) => (
                  <Flex vertical gap={SPACE.xs} key={String(col.key ?? i)}>
                    <Typography.Text
                      style={{
                        fontSize: TYPE.sm,
                        fontWeight: WEIGHT.strong,
                        color: colorTextSecondary,
                      }}
                    >
                      {titleText(col)}
                    </Typography.Text>
                    {/* The class releases the desktop widths the controls
                        carry at their call sites. See global.css. */}
                    <div className="nusantara-stacked-cell">
                      {cellContent(col, record, index)}
                    </div>
                  </Flex>
                ))}
              </Flex>
              {actions.length > 0 && (
                <Flex
                  justify="flex-end"
                  align="center"
                  gap={SPACE.sm}
                  wrap
                  style={{
                    marginTop: SPACE.sm,
                    paddingTop: SPACE.sm,
                    borderTop: `1px solid ${colorBorderSecondary}`,
                  }}
                >
                  {actions.map((col, i) => (
                    <div key={String(col.key ?? i)}>
                      {cellContent(col, record, index)}
                    </div>
                  ))}
                </Flex>
              )}
            </Card>
          </div>
        );
      })}
    </Flex>
  ) : (
    <Table<T>
      {...rest}
      rowKey={rowKey}
      rowClassName={rowClassName}
      columns={columns}
      dataSource={dataSource as T[]}
      pagination={false}
      size={size ?? "small"}
      className={className}
      locale={{ ...locale, emptyText: empty }}
      // The no-compression guarantee. Without it rc-table divides the
      // available width among the columns and a Qty box ends up narrower than
      // its own stepper arrows.
      scroll={{ x: gridWidth }}
      /*
       * And this is what makes the widths BINDING rather than advisory.
       *
       * rc-table picks `fixed` only when a column is pinned, the header
       * scrolls, or something has `ellipsis` (see `mergedTableLayout` in its
       * Table.js) — otherwise `auto`, where the browser sizes columns by their
       * content and a `<col width>` is a suggestion it may overrule. That is
       * precisely the reported bug: a product label wanting 700px got it, out
       * of Qty's pocket. `fixed` cannot be set when the width is
       * `max-content`, because there is then no total to divide.
       */
      tableLayout={
        typeof gridWidth === "number" && (scrollX !== undefined || declared)
          ? "fixed"
          : undefined
      }
      onRow={(record, index) => ({
        ...(onRow?.(record, index) ?? {}),
        ...rowMarker(index ?? 0),
      })}
    />
  );

  return (
    // The class is what lets a long value wrap inside its own column rather
    // than widening it. See global.css.
    <div
      ref={rootRef}
      className="nusantara-editable-table"
      onKeyDown={onKeyDown}
      onKeyDownCapture={onKeyDownCapture}
    >
      {body}
      {adder}
    </div>
  );
}
