/**
 * A description or a note, given room to be one — two lines of it, then an
 * ellipsis and a tooltip for anything past that.
 *
 * Owner decision 2026-08-26: every description and note column in the app was
 * `ellipsis: true`, which is antd's one-line clamp. The trouble is that these
 * are the columns staff write sentences into — "dent kiri bawah, battery 90%,
 * fullset dus" — and a one-line clamp cut them at about four words, so the
 * column reliably showed the least useful half of what somebody had bothered
 * to type. A table full of "Mulus, battery…" is a table whose most human
 * column has been turned into decoration.
 *
 * Two lines rather than unlimited: an uncapped cell lets one three-sentence
 * note set the height of a row whose other cells are a single number, and a
 * list that jumps from 40px rows to 90px rows is harder to scan than one that
 * truncates. Two is what a shop's notes actually run to, measured against the
 * seed and the owner's own examples.
 *
 * The tooltip is the escape hatch and is only attached when there is something
 * to escape to — an always-on tooltip over a fully visible cell is a tooltip
 * people learn to ignore.
 */
import { Tooltip, Typography } from "antd";
import { fmtNone } from "../lib/format.js";

export interface LongTextProps {
  children: string | null | undefined;
  /** How many lines before it clamps. */
  lines?: number;
  /** What to draw when there is nothing. "None" unless told otherwise. */
  fallback?: string;
}

/**
 * Roughly how many characters fit in `lines` lines of a table cell at the
 * widths these columns use. Only decides whether to offer the tooltip, so it
 * is allowed to be approximate — being wrong shows a tooltip that repeats what
 * is on screen, which costs nothing.
 */
const CHARS_PER_LINE = 44;

export function LongText({
  children,
  lines = 2,
  fallback = fmtNone(),
}: LongTextProps) {
  const text = (children ?? "").trim();
  if (text === "") return <>{fallback}</>;

  const clamped = (
    <Typography.Text
      style={{
        display: "-webkit-box",
        WebkitLineClamp: lines,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
        // Without this the box refuses to wrap a long unbroken run — a serial
        // pasted into a note, a URL — and pushes the column wider instead.
        overflowWrap: "anywhere",
        whiteSpace: "normal",
      }}
    >
      {text}
    </Typography.Text>
  );

  return text.length > CHARS_PER_LINE * lines ? (
    <Tooltip title={text}>{clamped}</Tooltip>
  ) : (
    clamped
  );
}
