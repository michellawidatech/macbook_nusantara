/**
 * Keyboard navigation, as answers rather than as listeners (owner ask
 * 2026-09-15).
 *
 * *"All of the UI has to be keyboard friendly (enter key to move to the next
 * column focus, arrow buttons, and other navigation helpers."* The listeners
 * that act on it are `components/KeyboardNav.tsx` (Enter, `/`, `?`),
 * `EditableTable` (a grid's arrows) and `DataTable` (a list's rows). Every
 * question they ask is answered here, where a test can build a scrap of DOM and
 * ask it without rendering a page: is this keystroke ours, where does it go,
 * which cell is below this one.
 *
 * ## Enter
 *
 * Moves to the next FIELD in reading order — a box you type into or pick from.
 * Switches, checkboxes and buttons between two fields are stepped over: Enter
 * on one of those activates it, so landing there would turn the next Enter into
 * a toggle instead of a move. Tab still reaches them.
 *
 * The next field is looked for inside the nearest scope — a modal, a drawer, a
 * `form`, or anything marked `data-keyboard-scope` — and otherwise the page's
 * `<main>`. At the end of a scope a modal's primary button is PRESSED, because
 * the dialog is the thing being filled in and confirming it is what comes next;
 * anywhere else the primary button that follows is only FOCUSED, because saving
 * a page is what one more Enter should decide, not a side effect of finishing
 * the last box.
 *
 * `shouldHandleEnter` is the list of Enters that are not ours, and every entry
 * on it is a keystroke some screen already depends on.
 */

/** Opts a subtree out of Enter-to-next, the grid arrows and `/` `?`. */
export const NAV_OFF_SELECTOR = '[data-keyboard-nav="off"]';

/** Where Enter looks for the next field. The nearest one wins. */
export const SCOPE_SELECTOR =
  "[data-keyboard-scope], form, .ant-modal-container, .ant-drawer-section";

const MODAL_SELECTOR = ".ant-modal-container";
const DRAWER_SELECTOR = ".ant-drawer-section";

/**
 * A floating layer's content. Its keys are its own — Enter in a table filter's
 * search box, or in a Select's dropdown, answers that layer and nothing else.
 */
const POPUP_SELECTOR = [
  ".ant-select-dropdown",
  ".ant-picker-dropdown",
  ".ant-cascader-dropdown",
  ".ant-dropdown",
  ".ant-popover",
  ".ant-tooltip",
  ".ant-table-filter-dropdown",
].join(", ");

/** `EditableTable`'s root, and the marker it puts on every row, in both layouts. */
export const EDITABLE_TABLE_CLASS = "nusantara-editable-table";
export const EDITABLE_ROW_ATTR = "data-editable-row";

/** A `DataTable` row that opens something — see `DataTable`'s `keyboardRows`. */
export const KEYBOARD_ROW_ATTR = "data-keyboard-row";
export const KEYBOARD_ROW_CLASS = "nusantara-keyboard-row";

/** The box `/` jumps to. `ProTable` marks its own; see `pageSearchBox`. */
export const PAGE_SEARCH_ATTR = "data-page-search";

/** rc-table's own row identity, which `EditableTable` repeats on a stacked card. */
const ROW_KEY_ATTR = "data-row-key";

/** The parts of a keydown this module reads. A DOM `KeyboardEvent` is one. */
export interface KeyLike {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly repeat?: boolean;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
  readonly defaultPrevented?: boolean;
}

/** ⌘, Ctrl or Alt — a chord, which belongs to whoever defined it (⌘⏎ adds a row). */
export function hasCommandModifier(e: KeyLike): boolean {
  return e.ctrlKey || e.metaKey || e.altKey;
}

/**
 * An IME mid-word. That Enter picks a candidate out of the input method's list;
 * moving on would take the half-built word with it. 229 is what Safari sends
 * in place of `isComposing`.
 */
export function isComposing(e: KeyLike): boolean {
  return e.isComposing === true || e.keyCode === 229;
}

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

function isTextLikeInput(el: Element): el is HTMLInputElement {
  return el instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(el.type);
}

/**
 * Is somebody typing into this? `/` and `?` are characters there, not
 * shortcuts.
 */
export function isTypingTarget(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return true;
  }
  if (el instanceof HTMLInputElement) return isTextLikeInput(el);
  // `closest` rather than `isContentEditable`, which jsdom does not implement.
  if (el.closest('[contenteditable=""], [contenteditable="true"]')) return true;
  const role = el.getAttribute("role");
  return (
    role === "textbox" ||
    role === "combobox" ||
    role === "searchbox" ||
    role === "spinbutton"
  );
}

/**
 * A search box owns its Enter.
 *
 * Enter there means "search", and the two that matter most are scan boxes: the
 * till's catalogue search and Stock Opname's count box, which both take serial
 * after serial into ONE field. A counter who presses Enter on an empty count
 * box and finds the caret moved into the first counted row would type the next
 * serial over a machine already counted.
 */
export function isSearchBox(el: Element): boolean {
  return (
    (el instanceof HTMLInputElement && el.type === "search") ||
    el.getAttribute("role") === "searchbox" ||
    el.closest(`.ant-input-search, [${PAGE_SEARCH_ATTR}]`) !== null
  );
}

export function isInsidePopup(el: Element): boolean {
  return el.closest(POPUP_SELECTOR) !== null;
}

/** What kind of field an Enter was pressed in, or null when Enter is not ours there. */
export type EnterField = "text" | "number" | "picker" | "combobox" | "select";

export function enterFieldKind(el: Element | null): EnterField | null {
  if (el instanceof HTMLSelectElement) return "select";
  // A textarea is absent on purpose: Enter there is a new line.
  if (el === null || !isTextLikeInput(el) || isSearchBox(el)) return null;
  if (el.getAttribute("role") === "combobox") return "combobox";
  if (el.closest(".ant-picker")) return "picker";
  if (el.getAttribute("role") === "spinbutton" || el.closest(".ant-input-number")) {
    return "number";
  }
  return "text";
}

/**
 * Is this field's list, calendar or dropdown showing? Enter there picks from
 * it.
 *
 * A Select says so itself (`aria-expanded`). A DatePicker does not — rc-picker
 * puts no ARIA on its input — but it opens on focus and closes on blur, so
 * while its field has the caret, any picker panel that is showing is its own.
 */
export function isPopupOpen(el: Element): boolean {
  if (el.getAttribute("aria-expanded") === "true") return true;
  if (el.closest(".ant-select-open")) return true;
  if (el.closest(".ant-picker")) {
    return Array.from(
      el.ownerDocument.querySelectorAll(".ant-picker-dropdown"),
    ).some((panel) => isVisible(panel));
  }
  return false;
}

/** Whether this environment lays anything out. jsdom does not. */
function hasLayout(doc: Document): boolean {
  return doc.documentElement.getClientRects().length > 0;
}

/**
 * Can anybody see it?
 *
 * In a browser the box model answers: nothing inside a `display: none`
 * ancestor — an inactive tab, a closed modal left in the DOM — has a client
 * rect. jsdom lays nothing out, so every element there has none, and the
 * fallback reads what the browser would have acted on instead: inline
 * `display`/`visibility`, and the `*-hidden` class antd hangs on a closed tab
 * pane, popup or form item. The fallback only ever runs without layout, so it
 * cannot misjudge anything in production.
 */
export function isVisible(el: Element): boolean {
  if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const doc = el.ownerDocument;
  if (hasLayout(doc)) {
    if (el.getClientRects().length === 0) return false;
    return doc.defaultView?.getComputedStyle(el).visibility !== "hidden";
  }
  for (let node: Element | null = el; node !== null; node = node.parentElement) {
    if (
      node instanceof HTMLElement &&
      (node.style.display === "none" || node.style.visibility === "hidden")
    ) {
      return false;
    }
    for (const name of Array.from(node.classList)) {
      if (name.endsWith("-hidden")) return false;
    }
  }
  return true;
}

export function isEnabled(el: Element): boolean {
  if (el.getAttribute("aria-disabled") === "true") return false;
  // `:disabled` rather than `.disabled`, so a field inside a disabled
  // `<fieldset>` counts too.
  return !el.matches(":disabled");
}

/** A button one Enter may press or land on. A spinning one is already pressed. */
function isButtonReady(el: Element): boolean {
  return (
    isEnabled(el) &&
    !el.classList.contains("ant-btn-disabled") &&
    !el.classList.contains("ant-btn-loading")
  );
}

const FIELD_SELECTOR = "input, select, textarea";

/**
 * Somewhere Enter may land: a box somebody types into or picks from, enabled,
 * showing, and in the tab order.
 *
 * A read-only text box is a reading, not a field — except the two antd
 * controls whose real `<input>` is read-only by construction: a Select without
 * search, and a picker set to `inputReadOnly`. Both are picked from, so both
 * are fields.
 */
export function isFieldTarget(el: Element): el is HTMLElement {
  if (el instanceof HTMLInputElement) {
    if (!isTextLikeInput(el)) return false;
    if (
      el.readOnly &&
      el.getAttribute("role") !== "combobox" &&
      !el.closest(".ant-picker")
    ) {
      return false;
    }
  } else if (el instanceof HTMLTextAreaElement) {
    if (el.readOnly) return false;
  } else if (!(el instanceof HTMLSelectElement)) {
    return false;
  }
  if (el.getAttribute("tabindex") === "-1") return false;
  return isEnabled(el) && !isInsidePopup(el) && isVisible(el);
}

export function fieldsIn(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll(FIELD_SELECTOR)).filter(isFieldTarget);
}

function pageRoot(el: Element): HTMLElement {
  return el.closest("main") ?? el.ownerDocument.body;
}

export function scopeOf(el: Element): HTMLElement {
  return el.closest<HTMLElement>(SCOPE_SELECTOR) ?? pageRoot(el);
}

/** The layer a field is on: a modal, a drawer, or the page under both. */
export interface Surface {
  readonly kind: "modal" | "drawer" | "page";
  readonly root: HTMLElement;
}

export function surfaceOf(el: Element): Surface {
  const layer = el.closest<HTMLElement>(`${MODAL_SELECTOR}, ${DRAWER_SELECTOR}`);
  if (layer !== null) {
    return { kind: layer.matches(MODAL_SELECTOR) ? "modal" : "drawer", root: layer };
  }
  return { kind: "page", root: pageRoot(el) };
}

function follows(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/**
 * The first field after `from` in reading order, inside `root`, on the same
 * layer — a field on a page that sits outside `<main>` must not "next" into a
 * dialog that happens to be later in `<body>`.
 */
export function nextFieldAfter(root: Element, from: Element): HTMLElement | null {
  const layer = surfaceOf(from).root;
  for (const candidate of Array.from(root.querySelectorAll(FIELD_SELECTOR))) {
    if (candidate === from || !follows(from, candidate)) continue;
    if (surfaceOf(candidate).root !== layer) continue;
    if (isFieldTarget(candidate)) return candidate;
  }
  return null;
}

/**
 * A primary button: antd's `type="primary"` (either spelling of its classes)
 * or a form's submit. Danger primaries included — the delete dialog that asks
 * for the count's own reference is confirmed by exactly this.
 */
const PRIMARY_SELECTOR =
  ".ant-btn-primary, .ant-btn-color-primary.ant-btn-variant-solid," +
  " button[type='submit'], input[type='submit']";

function primaryButtons(root: Element, layer: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(PRIMARY_SELECTOR)).filter(
    (button) =>
      surfaceOf(button).root === layer &&
      !isInsidePopup(button) &&
      isVisible(button),
  );
}

/**
 * The first primary button AFTER `from`. After, because the button that saves
 * what was just filled in sits below it — a page header's "Add supplier" above
 * the form is a different errand.
 */
export function primaryAfter(root: Element, from: Element): HTMLElement | null {
  const layer = surfaceOf(from).root;
  return primaryButtons(root, layer).find((b) => follows(from, b)) ?? null;
}

export type EnterPlan =
  | { readonly kind: "focus"; readonly target: HTMLElement }
  | { readonly kind: "click"; readonly target: HTMLElement };

/**
 * Where an Enter in `from` goes. Null means nowhere, and the Enter keeps its
 * native meaning.
 *
 * A disabled primary answers null rather than being skipped for another
 * button: a dialog whose OK is greyed out is saying it is not finished, and
 * pressing Cancel instead is not what anybody meant.
 */
export function planEnter(from: HTMLElement): EnterPlan | null {
  const scope = scopeOf(from);
  const next = nextFieldAfter(scope, from);
  if (next !== null) return { kind: "focus", target: next };

  const surface = surfaceOf(from);
  if (surface.kind === "modal") {
    // A form inside a dialog can be followed by more of the dialog.
    const later = scope === surface.root ? null : nextFieldAfter(surface.root, from);
    if (later !== null) return { kind: "focus", target: later };
    const ok = primaryAfter(surface.root, from);
    return ok !== null && isButtonReady(ok) ? { kind: "click", target: ok } : null;
  }

  let button = primaryAfter(scope, from);
  // A form's Save often lives outside the form — a FooterToolbar, a drawer's
  // footer — and it is still that form's Save.
  if (button === null && scope !== surface.root) {
    button = primaryAfter(surface.root, from);
  }
  // A drawer puts its Save in the header's `extra`, above everything.
  if (button === null && surface.kind === "drawer") {
    button = primaryButtons(surface.root, surface.root)[0] ?? null;
  }
  return button !== null && isButtonReady(button)
    ? { kind: "focus", target: button }
    : null;
}

/**
 * Is this Enter ours to move on?
 *
 * Not ours:
 * - with Ctrl, ⌘, Alt or Shift — ⌘⏎ adds a row, Shift+Enter is MultiFillNumber's;
 * - held down (`repeat`), which would race through a whole form;
 * - while an IME is composing;
 * - anywhere but a field — a textarea's Enter is a new line, and a button, a
 *   link, a checkbox, a switch or a segmented control is activated by Enter
 *   natively;
 * - in a search box (see `isSearchBox`);
 * - inside `[data-keyboard-nav="off"]`, or inside a floating layer;
 * - while the field's own list or calendar is open, where Enter picks.
 *
 * Two more are decided by the listener, because they are facts about the
 * keystroke's history rather than about the DOM: an Enter that ends a scanner
 * burst, and one the field's own handler already answered (`defaultPrevented`).
 */
export function shouldHandleEnter(
  e: KeyLike,
  el: EventTarget | null,
): el is HTMLElement {
  if (e.key !== "Enter" || e.repeat === true) return false;
  if (hasCommandModifier(e) || e.shiftKey || isComposing(e)) return false;
  if (!(el instanceof HTMLElement) || enterFieldKind(el) === null) return false;
  if (el.closest(NAV_OFF_SELECTOR) || isInsidePopup(el)) return false;
  return !isPopupOpen(el);
}

export function valueOf(el: Element): string {
  return el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
    ? el.value
    : "";
}

/** How the caret is left in a field that focus moved into. */
export type Caret = "select" | "end";

/**
 * Focus, and leave the text the way Tab leaves it: selected, so typing replaces
 * it and an arrow leaves the cell at once (see `caretAt`).
 */
export function focusControl(el: HTMLElement, caret: Caret = "select"): void {
  el.focus();
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  if (el.readOnly) return;
  try {
    if (caret === "select") el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
  } catch {
    // A type with no text selection (a native date box). Focus is enough.
  }
}

// ---------------------------------------------------------------------------
// Grids — `EditableTable`
// ---------------------------------------------------------------------------

export function isEditableText(
  el: Element,
): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  return isTextLikeInput(el) && !el.readOnly;
}

/**
 * Has the caret nothing left to move over in this direction?
 *
 * True at the edge, and also when the WHOLE value is selected — which is how
 * Tab, Enter and the arrows themselves leave a field — so a run of → presses
 * crosses a row instead of stopping in every cell to collapse a selection. A
 * partial selection is somebody editing, and the arrow is theirs.
 */
export function caretAt(
  el: HTMLInputElement | HTMLTextAreaElement,
  edge: "start" | "end",
): boolean {
  let start: number | null;
  let end: number | null;
  try {
    start = el.selectionStart;
    end = el.selectionEnd;
  } catch {
    return true;
  }
  if (start === null || end === null) return true;
  const length = el.value.length;
  if (start === 0 && end === length) return true;
  if (start !== end) return false;
  return edge === "start" ? start === 0 : end === length;
}

/**
 * Controls whose ← → already mean something: a segmented control and a radio
 * group move their choice, a slider its value, a tab list its tab. In a grid
 * they keep them — ↑ ↓ still change rows.
 */
const HORIZONTAL_OWNERS =
  ".ant-segmented, .ant-radio-group, .ant-slider, .ant-rate," +
  " [role='radiogroup'], [role='tablist'], [role='slider']";

function ownsHorizontalArrows(el: Element): boolean {
  if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "range")) {
    return true;
  }
  return el.closest(HORIZONTAL_OWNERS) !== null;
}

const CONTROL_SELECTOR = "input, select, textarea, button, a[href], [tabindex]";

function isControl(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement && el.type === "hidden") return false;
  if (el.getAttribute("tabindex") === "-1") return false;
  return isEnabled(el) && !isInsidePopup(el) && isVisible(el);
}

/** Every stop Tab would make inside `container`, in order. */
export function controlsIn(container: Element): HTMLElement[] {
  const all = Array.from(container.querySelectorAll(CONTROL_SELECTOR)).filter(
    isControl,
  );
  // A focusable wrapper around a focusable control is one stop, not two.
  return all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
}

function gridRows(root: Element): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(`[${EDITABLE_ROW_ATTR}]`),
  ).filter((row) => row.closest(`.${EDITABLE_TABLE_CLASS}`) === root);
}

/**
 * The same column, `step` rows away.
 *
 * "Same column" is the cell's index in its `<tr>`, and within a cell holding
 * two controls — a price's store and marketplace boxes, an old battery's
 * cycles and capacity — the same one of the two. A row with nothing enabled in
 * that column (an accepted machine, a closed invoice) is passed over rather
 * than stopping the caret dead.
 */
function cellBelow(
  root: Element,
  row: HTMLElement,
  from: HTMLElement,
  step: 1 | -1,
): HTMLElement | null {
  const cell = from.closest("td");
  if (!(row instanceof HTMLTableRowElement) || cell === null || cell.parentElement !== row) {
    return null;
  }
  const rows = gridRows(root);
  const index = rows.indexOf(row);
  if (index < 0) return null;
  const column = cell.cellIndex;
  const ordinal = Math.max(0, controlsIn(cell).indexOf(from));
  for (let i = index + step; i >= 0 && i < rows.length; i += step) {
    const next = rows[i];
    if (!(next instanceof HTMLTableRowElement)) continue;
    const target = next.cells[column];
    if (target === undefined) continue;
    const controls = controlsIn(target);
    if (controls.length > 0) {
      return controls[Math.min(ordinal, controls.length - 1)] ?? null;
    }
  }
  return null;
}

/**
 * Where an arrow in an `EditableTable` grid goes, or null when it is not the
 * grid's to take.
 *
 * ↑ ↓ change rows from anywhere — including a number box, whose own ↑ ↓ would
 * step the figure, and a closed Select, whose ↓ would open it — except inside a
 * textarea away from its first or last character. ← → change cells only once
 * the caret is at the edge of the text, and straight away from anything with no
 * text. Never with a modifier (Shift+arrow selects text, Alt+↓ opens a list),
 * never while a list or calendar is open, and only for a row of THIS grid.
 */
export function gridArrowTarget(
  e: KeyLike,
  from: EventTarget | null,
  root: Element,
): HTMLElement | null {
  const vertical = e.key === "ArrowUp" || e.key === "ArrowDown";
  if (!vertical && e.key !== "ArrowLeft" && e.key !== "ArrowRight") return null;
  if (hasCommandModifier(e) || e.shiftKey || isComposing(e)) return null;
  if (e.defaultPrevented === true || !(from instanceof HTMLElement)) return null;
  const row = from.closest<HTMLElement>(`[${EDITABLE_ROW_ATTR}]`);
  if (row === null || row.closest(`.${EDITABLE_TABLE_CLASS}`) !== root) return null;
  if (from.closest(NAV_OFF_SELECTOR) || isInsidePopup(from) || isPopupOpen(from)) {
    return null;
  }

  if (vertical) {
    const up = e.key === "ArrowUp";
    if (from instanceof HTMLTextAreaElement && !caretAt(from, up ? "start" : "end")) {
      return null;
    }
    return cellBelow(root, row, from, up ? -1 : 1);
  }

  const back = e.key === "ArrowLeft";
  if (ownsHorizontalArrows(from)) return null;
  if (isEditableText(from) && !caretAt(from, back ? "start" : "end")) return null;
  const controls = controlsIn(row);
  const at = controls.indexOf(from);
  if (at < 0) return null;
  return controls[back ? at - 1 : at + 1] ?? null;
}

// ---------------------------------------------------------------------------
// Lists — `DataTable`
// ---------------------------------------------------------------------------

/** ↑ ↓ Home End between a list's focusable rows. No wrapping at either end. */
export function listRowTarget(key: string, row: HTMLElement): HTMLElement | null {
  const parent = row.parentElement;
  if (parent === null) return null;
  const rows = Array.from(parent.children).filter(
    (r): r is HTMLElement =>
      r instanceof HTMLElement && r.hasAttribute(KEYBOARD_ROW_ATTR) && isVisible(r),
  );
  const at = rows.indexOf(row);
  let target: HTMLElement | undefined;
  switch (key) {
    case "ArrowDown":
      target = at < 0 ? undefined : rows[at + 1];
      break;
    case "ArrowUp":
      target = at <= 0 ? undefined : rows[at - 1];
      break;
    case "Home":
      target = rows[0];
      break;
    case "End":
      target = rows[rows.length - 1];
      break;
    default:
      return null;
  }
  return target !== undefined && target !== row ? target : null;
}

// ---------------------------------------------------------------------------
// `/`
// ---------------------------------------------------------------------------

const SEARCH_SELECTORS = [
  `input[${PAGE_SEARCH_ATTR}]`,
  ".ant-input-search input",
  "input[type='search']",
  "input[role='searchbox']",
];

/**
 * The search box `/` jumps to: the top dialog's, if a dialog is open — the page
 * behind one is not where anybody is working — and otherwise the page's.
 * `ProTable`'s box is marked and wins; failing that, the first search box on
 * the page. A page with none gets nothing, rather than some other field.
 */
export function pageSearchBox(doc: Document): HTMLInputElement | null {
  const layers = Array.from(
    doc.querySelectorAll<HTMLElement>(`${MODAL_SELECTOR}, ${DRAWER_SELECTOR}`),
  ).filter((layer) => isVisible(layer));
  const root: Element =
    layers[layers.length - 1] ?? doc.querySelector("main") ?? doc.body;
  for (const selector of SEARCH_SELECTORS) {
    for (const box of Array.from(root.querySelectorAll<HTMLInputElement>(selector))) {
      if (isEnabled(box) && !isInsidePopup(box) && isVisible(box)) return box;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Finding a field again after the render its own Enter caused
// ---------------------------------------------------------------------------

/**
 * Enough about a field to find it again once React has replaced it.
 *
 * The case this exists for is the QC grid's serial box: committing a serial
 * turns a slot row (`slot:sku:0`) into a unit row (`unit:SC02…`), React mounts
 * a new row, and the box that had the caret is gone. Worse, the slots behind it
 * renumber — `inboundQc.ts` says so — so the OLD key now names the NEXT row,
 * and finding the field by its key would put the caret one machine down.
 */
export interface FieldLocator {
  /** The element holding the rows — a `<tbody>`, or the stacked cards' column. */
  readonly rows: Element | null;
  readonly rowKey: string | null;
  /** Every row key there was before the keystroke. */
  readonly rowKeys: readonly string[];
  /** Which control of its row the field was. */
  readonly ordinal: number;
  /** Outside a keyed row: the scope, and which of its fields this was. */
  readonly scope: HTMLElement;
  readonly fieldIndex: number;
  readonly fieldCount: number;
}

function keyedRows(rows: Element): HTMLElement[] {
  return Array.from(rows.children).filter(
    (r): r is HTMLElement => r instanceof HTMLElement && r.hasAttribute(ROW_KEY_ATTR),
  );
}

export function locateField(el: HTMLElement): FieldLocator {
  const row = el.closest<HTMLElement>(`[${ROW_KEY_ATTR}]`);
  const rows = row?.parentElement ?? null;
  const scope = scopeOf(el);
  const fields = fieldsIn(scope);
  return {
    rows,
    rowKey: row?.getAttribute(ROW_KEY_ATTR) ?? null,
    rowKeys:
      rows === null ? [] : keyedRows(rows).map((r) => r.getAttribute(ROW_KEY_ATTR) ?? ""),
    ordinal: row === null ? -1 : controlsIn(row).indexOf(el),
    scope,
    fieldIndex: fields.indexOf(el),
    fieldCount: fields.length,
  };
}

/**
 * The field `locateField` described, in the DOM as it is now — or null when
 * that cannot be said for certain, because a caret in the wrong machine's row
 * is worse than a caret nowhere.
 *
 * A keyed row: the ONE key that was not there before is the row that was
 * re-keyed, and so is ours. No new key means the row kept its key and only
 * re-rendered the control, so the same key is ours. Two new keys is a guess,
 * and is not taken.
 */
export function relocateField(loc: FieldLocator): HTMLElement | null {
  if (loc.rows !== null && loc.rows.isConnected && loc.rowKey !== null) {
    if (loc.ordinal < 0) return null;
    const rows = keyedRows(loc.rows);
    const fresh = rows.filter(
      (r) => !loc.rowKeys.includes(r.getAttribute(ROW_KEY_ATTR) ?? ""),
    );
    const row =
      fresh.length === 1
        ? fresh[0]
        : fresh.length === 0
          ? rows.find((r) => r.getAttribute(ROW_KEY_ATTR) === loc.rowKey)
          : undefined;
    return row === undefined ? null : (controlsIn(row)[loc.ordinal] ?? null);
  }
  if (loc.scope.isConnected && loc.fieldIndex >= 0) {
    const fields = fieldsIn(loc.scope);
    if (fields.length === loc.fieldCount) return fields[loc.fieldIndex] ?? null;
  }
  return null;
}
