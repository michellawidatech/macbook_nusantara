import { useCallback, useMemo, useState } from "react";

/** One cell of a grid: a column, and a 0-based row index within that grid. */
export interface CellRef<TField extends string> {
  field: TField;
  row: number;
}

/**
 * Which cells a value typed right now should be written to.
 *
 * A free-form set of cells rather than a column of rows: a delivery of
 * identical cartons repeats its quantity AND its buy price AND its cost down
 * the whole page, and making the operator fill one column, then start over for
 * the next, is three passes over the same ten lines. So the selection spans
 * columns, exactly as a spreadsheet's does.
 *
 * The trade that buys: filling a buy price into a weight column is now
 * reachable, and there is no undo. It is reachable in every spreadsheet ever
 * shipped for the same reason — the operator can see what they selected, and
 * the selection is painted the whole time they are typing.
 *
 * `TField` is the caller's own column union — `'listBuyPriceTwd' | …` for the
 * variant table, `'qty' | 'unitBuyPriceTwd' | 'purchaseCostTwd'` for a stock
 * receipt's lines. Generic rather than a shared union, so neither screen can
 * name a column the other has.
 */
export interface CellSelection<TField extends string> {
  /** Ordered left-to-right then top-to-bottom. Never empty while a selection exists. */
  cells: CellRef<TField>[];
  /** The cell a Shift-click measures its rectangle from. */
  anchor: CellRef<TField>;
}

/** The modifier keys a click carried, as the table reads them. */
export interface ClickModifiers {
  /** ⌘ on macOS, Ctrl elsewhere — add or remove this one cell. */
  toggle: boolean;
  /** Shift — extend from the anchor to here. */
  range: boolean;
}

export interface UseCellSelectionResult<TField extends string> {
  selection: CellSelection<TField> | null;
  isSelected: (field: TField, row: number) => boolean;
  /** Call from a cell's mousedown/focus. */
  select: (field: TField, row: number, modifiers: ClickModifiers) => void;
  clear: () => void;
  /**
   * The cells a value typed into (field, row) should be written to.
   *
   * The clicked cell itself is ALWAYS included, even when it is not part of
   * the current selection — a keystroke never goes somewhere the caret is
   * not, whatever the selection happens to say.
   */
  targetCells: (field: TField, row: number) => CellRef<TField>[];
}

/**
 * NUL rather than `:` as the separator, so a column literally named `qty:1`
 * cannot collide with column `qty` at row 1.
 */
function cellKey(field: string, row: number): string {
  return `${field}\u0000${row}`;
}

/** Every integer from `from` to `to`, ascending, either way round. */
function span(from: number, to: number): number[] {
  const [start, end] = from <= to ? [from, to] : [to, from];
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/**
 * The block of cells between two corners — every column between theirs, every
 * row between theirs.
 *
 * Null when either corner names a column this grid did not declare, which the
 * caller treats as "just select the clicked cell". That is a programming error
 * rather than something an operator can do, and collapsing is a better answer
 * to it than a selection spanning columns nobody can see.
 */
function rectangle<TField extends string>(
  columns: readonly TField[],
  anchor: CellRef<TField>,
  corner: CellRef<TField>,
): CellRef<TField>[] | null {
  const from = columns.indexOf(anchor.field);
  const to = columns.indexOf(corner.field);
  if (from === -1 || to === -1) {
    return null;
  }
  const cells: CellRef<TField>[] = [];
  for (const column of span(from, to)) {
    for (const row of span(anchor.row, corner.row)) {
      cells.push({ field: columns[column]!, row });
    }
  }
  return cells;
}

/** Left-to-right, then top-to-bottom — so `cells[0]` is the top-left one. */
function ordered<TField extends string>(
  columns: readonly TField[],
  cells: CellRef<TField>[],
): CellRef<TField>[] {
  return [...cells].sort(
    (a, b) =>
      columns.indexOf(a.field) - columns.indexOf(b.field) || a.row - b.row,
  );
}

/**
 * Spreadsheet-style multi-cell selection for a grid of numeric inputs.
 *
 * Nine variants of one shirt usually share a buy price, a weight and three
 * dimensions — that is 45 cells holding 5 distinct numbers, and typing each
 * one out is where the operator gives up and leaves the table half filled. A
 * ten-line delivery of the same carton size is the same shape of problem. So:
 * click a cell, ⌘-click (or Ctrl-click) any others, Shift-click for a block,
 * and what you type lands in all of them at once — replacing whatever each of
 * them held, however different those values were.
 *
 * A plain click collapses the selection to the one cell, which is what makes
 * ordinary single-cell editing — and every keyboard-only Tab through the
 * table — behave exactly as it would with no selection feature at all. That
 * is the property worth protecting: the shortcut is additive, never a mode
 * you can end up in by accident.
 *
 * `columns` is the grid's fillable columns IN THE ORDER THEY ARE RENDERED,
 * because that order is the only thing that can say which columns lie between
 * a Shift-click's two corners. Pass a module-level constant, not an inline
 * literal: a fresh array each render gives `select` a fresh identity and
 * re-renders every cell in the grid on every keystroke.
 *
 * Lives under `components/` rather than in either screen's own folder because
 * both the product variant table and the stock-in receipt lines use it; see
 * `MultiFillNumber`, which is the cell this drives.
 */
export function useCellSelection<TField extends string>(
  columns: readonly TField[],
): UseCellSelectionResult<TField> {
  const [selection, setSelection] = useState<CellSelection<TField> | null>(
    null,
  );

  const select = useCallback(
    (field: TField, row: number, modifiers: ClickModifiers) => {
      const cell: CellRef<TField> = { field, row };
      setSelection((current) => {
        if (current && modifiers.range) {
          const cells = rectangle(columns, current.anchor, cell);
          // The anchor stays put, so dragging the far corner around with
          // repeated Shift-clicks grows and shrinks one block rather than
          // ratcheting outwards.
          return cells
            ? { cells, anchor: current.anchor }
            : { cells: [cell], anchor: cell };
        }

        if (current && modifiers.toggle) {
          const key = cellKey(field, row);
          const has = current.cells.some(
            (c) => cellKey(c.field, c.row) === key,
          );
          const cells = has
            ? current.cells.filter((c) => cellKey(c.field, c.row) !== key)
            : ordered(columns, [...current.cells, cell]);
          if (cells.length === 0) {
            return null;
          }
          return {
            cells,
            // Removing the anchor would leave a later Shift-click measuring
            // from a cell that is no longer in the set.
            anchor:
              has && cellKey(current.anchor.field, current.anchor.row) === key
                ? cells[0]!
                : current.anchor,
          };
        }

        return { cells: [cell], anchor: cell };
      });
    },
    [columns],
  );

  // Rebuilt only when the selection changes, because `isSelected` is called
  // once per cell per render and a linear scan of the selection would make
  // painting a 6-column × 40-row grid quadratic.
  const selectedKeys = useMemo(
    () => new Set((selection?.cells ?? []).map((c) => cellKey(c.field, c.row))),
    [selection],
  );

  const isSelected = useCallback(
    (field: TField, row: number) => selectedKeys.has(cellKey(field, row)),
    [selectedKeys],
  );

  const targetCells = useCallback(
    (field: TField, row: number) => {
      if (!selection || !selectedKeys.has(cellKey(field, row))) {
        return [{ field, row }];
      }
      return selection.cells;
    },
    [selection, selectedKeys],
  );

  const clear = useCallback(() => setSelection(null), []);

  return { selection, isSelected, select, clear, targetCells };
}
