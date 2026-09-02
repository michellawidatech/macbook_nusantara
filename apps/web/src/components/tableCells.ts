/**
 * What a column would paint, outside a `<table>`.
 *
 * Two surfaces need this and neither of them is a grid: `DataTable`'s cards on
 * a phone, and `EditableTable`'s stacked rows. Both are built from the SAME
 * `columns` a caller wrote for the desktop table — nothing is declared twice,
 * so a column added for the grid shows up in the other layout without anyone
 * remembering to add it there — and that only works if "run this column's
 * render against this record" lives somewhere both can import.
 *
 * It was `DataTable`'s private code until `EditableTable` needed the same four
 * functions on 2026-09-01. Copying them would have been the easy move and the
 * wrong one: the pair would have drifted at the first column shape either
 * layout learned to handle.
 */
import type { Key, ReactNode } from "react";
import type { TableProps } from "antd";

export type AntColumns<T> = NonNullable<TableProps<T>["columns"]>;
export type AntColumn<T> = AntColumns<T>[number];

/** Reads a column's raw cell value, honouring antd's array dataIndex form. */
export function cellValue<T>(record: T, dataIndex: unknown): unknown {
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
 * a grid, so the card layouts keep the children and drop the spans.
 */
export function cellContent<T>(
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

/** Column groups have no meaning outside a header; flatten to the leaves. */
export function leafColumns<T>(columns: AntColumns<T>): AntColumn<T>[] {
  return columns.flatMap((c) =>
    "children" in c && Array.isArray(c.children)
      ? (c.children as AntColumn<T>[])
      : [c],
  );
}

/**
 * A column header's own node, for the label beside its value.
 *
 * Titles are usually strings, but a column may render one — the battery column
 * pairs a word with a `?` tooltip, and the batch editor's Product header
 * carries a required asterisk. Both are legitimate labels, so the node is used
 * as it stands rather than being flattened to text.
 */
export function titleText<T>(col: AntColumn<T>): ReactNode {
  return col.title as ReactNode;
}

/** The key antd would give this row, for a layout that has no `<tr>`. */
export function keyOf<T>(
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

/**
 * A column with no title is this codebase's actions column — it holds the
 * row's buttons and belongs at the foot of a card rather than under a `""`
 * label, which reads as a rendering bug.
 */
export function isActionColumn<T>(col: AntColumn<T>): boolean {
  return col.title === undefined || col.title === "";
}
