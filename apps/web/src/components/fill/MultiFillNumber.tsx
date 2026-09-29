import { useRef } from "react";
import type { ReactNode } from "react";
import { InputNumber, Space, theme } from "antd";
import { MoneyAddon } from "../MoneyInput";
import { moneyFormatter, moneyParser } from "../money";
import type { ClickModifiers } from "./useCellSelection";

/**
 * The attribute a cell is found by when the keyboard walks the column.
 *
 * `grid:field:row`, on the wrapper rather than the input, because antd's
 * `InputNumber` owns its own `<input>` and passing arbitrary `data-` props
 * through to it is not part of its contract.
 */
function cellAttribute(gridId: string, field: string, row: number): string {
  return `${gridId}:${field}:${row}`;
}

/**
 * Moves the caret to (field, row) in one grid. Returns false when there is no
 * such cell — a row that does not exist, or one whose input is disabled.
 *
 * A DOM lookup rather than a registry of refs: the two grids that use this
 * render their cells from a `Form.List`, where the row a move lands on may not
 * have existed when the move was requested (see `onAddRow` below), so anything
 * captured in advance would be stale exactly when it mattered.
 */
function focusCell(gridId: string, field: string, row: number): boolean {
  const host = document.querySelector<HTMLElement>(
    `[data-fill-cell="${cellAttribute(gridId, field, row)}"]`,
  );
  const input = host?.querySelector<HTMLInputElement>("input");
  if (!input || input.disabled) {
    return false;
  }
  input.focus();
  // Selects what is there, so the next keystroke REPLACES rather than
  // appends — the same thing arriving in a spreadsheet cell does.
  input.select();
  return true;
}

export interface MultiFillNumberProps {
  value?: number;
  onChange?: (value: number | null) => void;
  /** Writes this value to every OTHER selected row. This cell's own row is
   * left to `onChange`, so the caret's cell is never written twice. */
  onFill: (value: number | null) => void;
  onSelect: (modifiers: ClickModifiers) => void;
  selected: boolean;
  /**
   * Which grid this cell belongs to. Part of the `data-fill-cell` key, so a
   * keyboard move finds a neighbour in THIS table — not in another one that
   * happens to name its columns the same way.
   */
  gridId: string;
  /** The column, as `useCellSelection` names it. */
  field: string;
  /** 0-based row index within the grid. */
  row: number;
  /** How many rows the grid currently has, so Enter knows it is on the last. */
  rowCount: number;
  /** Enter on the last row calls this and lands in the row it creates. Omit
   * and Enter simply stops at the bottom. */
  onAddRow?: () => void;
  /** Escape calls this and drops focus. */
  onClearSelection?: () => void;
  disabled?: boolean;
  /**
   * Makes this a money cell: thousands separators in the box and an "Rp"
   * addon outside it, both from `components/MoneyInput`. A flag rather than a
   * `prefix` string — which is all this ever carried — because the currency
   * label and the grouping are one decision, and splitting them across two
   * props is how a column ends up with one and not the other.
   */
  money?: boolean;
  placeholder?: string;
  ariaLabel: string;
  min?: number;
  /** Decimal places the INPUT shows — not what gets stored. */
  precision?: number;
  step?: number;
  /** Stored (form) value → what the input shows. */
  toDisplay?: (stored: number) => number;
  /** The inverse of `toDisplay`. */
  fromDisplay?: (displayed: number) => number;
}

/**
 * One numeric cell that a multi-cell selection can write through.
 *
 * `value`/`onChange` are bound by `Form.Item` — this component's own job is
 * the three things `Form.Item` cannot know about: painting the cell when it is
 * part of the current selection, mirroring what is typed into every OTHER
 * selected row (`onFill`), and the keyboard walk down the column.
 *
 * KEYS. Enter moves down one row in the same column and Shift-Enter moves up,
 * which is the gesture a spreadsheet trains; Enter on the last row adds one
 * (`onAddRow`) and lands in it. ⌥/⌘ with ↑/↓ does the same, for anyone who
 * reaches for an arrow first. PLAIN ↑/↓ IS DELIBERATELY LEFT ALONE: it is
 * `InputNumber`'s own stepper, which the Weight column's g/kg `step` depends
 * on, and a grid that silently stops stepping is a worse trade than one extra
 * modifier. Escape clears the selection. Tab still walks across the row, as it
 * always did, and every one of these is additive — a table nobody presses a
 * shortcut in behaves exactly as it would without them.
 *
 * `toDisplay`/`fromDisplay` are the one place a column-level unit toggle
 * (currently just the variant table's Weight) is allowed to touch the number
 * at all: `value` in and `onChange`/`onFill` out are ALWAYS the form's own
 * unit. Nothing above this component — not the cell's Form.Item, not
 * fill-down, not the submit payload — ever sees the display unit. Both default
 * to identity, which is exactly plain behaviour for every other column.
 */
export function MultiFillNumber({
  value,
  onChange,
  onFill,
  onSelect,
  selected,
  gridId,
  field,
  row,
  rowCount,
  onAddRow,
  onClearSelection,
  disabled,
  money,
  placeholder,
  ariaLabel,
  min = 0,
  precision = 0,
  step,
  toDisplay,
  fromDisplay,
}: MultiFillNumberProps) {
  const {
    token: { colorPrimary, colorPrimaryBg, borderRadius },
  } = theme.useToken();

  // Set by the pointer, consumed by the focus that the same click causes.
  //
  // A click fires mousedown, then focus, then mouseup. The capture handler
  // below has already decided the selection by the time focus arrives, so
  // focus must keep its hands off — otherwise every ⌘-click added a row and
  // the focus a millisecond later collapsed the selection straight back to
  // that one cell, which is what stopped multi-cell fill working at all.
  //
  // A previous attempt guarded on `relatedTarget`, asking whether focus came
  // from inside this same cell. Moving between two cells never satisfies
  // that, so it never fired. The question worth asking is not where focus
  // came from, it is whether a pointer already answered it.
  const pointerHandled = useRef(false);

  /** Grams (or whatever the form stores) → what the input shows. */
  const toDisplayValue = (stored: number) =>
    toDisplay ? toDisplay(stored) : stored;
  /** The inverse — what the input shows → what gets stored. */
  const toStoredValue = (displayed: number) =>
    fromDisplay ? fromDisplay(displayed) : displayed;

  /**
   * Walks one row up or down the same column.
   *
   * Past the last row it adds one and lands there, on the NEXT frame: the row
   * is created by a `Form.List` operation, so its input does not exist in the
   * DOM until React has committed the render that call causes.
   */
  function move(delta: number): void {
    const next = row + delta;
    if (next < 0) {
      return;
    }
    if (next >= rowCount) {
      if (delta > 0 && onAddRow) {
        onAddRow();
        requestAnimationFrame(() => focusCell(gridId, field, next));
      }
      return;
    }
    focusCell(gridId, field, next);
  }

  return (
    <div
      data-fill-cell={cellAttribute(gridId, field, row)}
      // Capture, so the selection is decided before the input takes focus and
      // the browser's own click handling moves the caret.
      onMouseDownCapture={(event) => {
        pointerHandled.current = true;
        onSelect({
          toggle: event.metaKey || event.ctrlKey,
          range: event.shiftKey,
        });

        // Shift-click has to place the caret itself.
        //
        // The browser's own answer to shift+mousedown is "extend the document
        // text selection", NOT "move the caret" — so focus stayed wherever it
        // already was and the block lit up with nothing to type into. That was
        // the whole of the bug: the selection was right, the caret was absent.
        //
        // preventDefault suppresses the text-selection extension, and with it
        // the focus the browser would otherwise have moved, so this has to
        // focus explicitly. The focus() below is synchronous and lands while
        // `pointerHandled` is still true, so onFocus leaves the block alone.
        if (event.shiftKey) {
          event.preventDefault();
          const input = event.currentTarget.querySelector("input");
          input?.focus();
          // Same as a keyboard move: the next keystroke replaces.
          input?.select();
        }
      }}
      // Clears a flag the focus never got to consume — a mousedown on a
      // disabled cell focuses nothing, and the stale flag would otherwise
      // eat the next Tab into this cell. Runs after focus, so it cannot
      // steal the flag from a click that did focus.
      onMouseUp={() => {
        pointerHandled.current = false;
      }}
      onFocus={() => {
        // Tab arriving from elsewhere collapses to this one cell.
        if (pointerHandled.current) {
          pointerHandled.current = false;
          return;
        }
        onSelect({ toggle: false, range: false });
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClearSelection?.();
          (event.target as HTMLElement).blur();
          return;
        }

        const arrowNav =
          (event.key === "ArrowDown" || event.key === "ArrowUp") &&
          (event.altKey || event.metaKey);

        if (event.key !== "Enter" && !arrowNav) {
          return;
        }

        // Enter inside a form submits it by default, which on these two
        // screens means posting a half-typed receipt from the middle of the
        // grid. Moving a row is both the more useful answer and the safer one.
        event.preventDefault();
        move(
          event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey)
            ? -1
            : 1,
        );
      }}
      style={{
        padding: 2,
        borderRadius: borderRadius + 2,
        outline: selected
          ? `2px solid ${colorPrimary}`
          : "2px solid transparent",
        background: selected ? colorPrimaryBg : undefined,
      }}
    >
      <NumberBox money={money} disabled={disabled}>
        <InputNumber<number>
          value={value === undefined ? undefined : toDisplayValue(value)}
          onChange={(next) => {
            const stored = next === null ? null : toStoredValue(next);
            onChange?.(stored);
            onFill(stored);
          }}
          min={min}
          precision={precision}
          step={step}
          formatter={money ? moneyFormatter : undefined}
          parser={money ? moneyParser : undefined}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          // `flex: 1` inside the money wrapper, where the addon takes its own
          // width first; plain `100%` otherwise, where there is nothing beside
          // it and the cell is the only thing to fill.
          style={money ? { flex: 1 } : { width: "100%" }}
        />
      </NumberBox>
    </div>
  );
}

/**
 * Attaches the "Rp" addon, or gets out of the way.
 *
 * Split out only so the `InputNumber` above is written once — a money cell and
 * a plain one differ by a wrapper, and forking the whole element on `money`
 * would mean two copies of the fill wiring to keep in step.
 */
function NumberBox({
  money,
  disabled,
  children,
}: {
  money?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  if (!money) {
    return <>{children}</>;
  }
  return (
    <Space.Compact block>
      <MoneyAddon disabled={disabled} />
      {children}
    </Space.Compact>
  );
}
