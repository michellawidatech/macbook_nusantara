/**
 * Press a `PageContainer` action, whichever viewport the test is in.
 *
 * `test/setup.ts` stubs `matchMedia` to answer "no" to everything, so unless a
 * test says otherwise `compact` is TRUE and the page's actions are in the
 * phone's app bar (2026-11-16): ONE of them as a labelled button, the rest as
 * text rows in the sheet behind "More actions" — not in the DOM until it is
 * opened. On a desktop every action is a button in the header.
 */
import { fireEvent, screen, within } from "@testing-library/react";

export function pressPageAction(name: RegExp | string) {
  const found = screen.queryAllByRole("button", { name });
  if (found.length > 0) {
    fireEvent.click(found[0]!);
    return;
  }
  // Compact: open the sheet, then press the row inside it.
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  const sheet = screen
    .getAllByRole("dialog")
    .find((d) => within(d).queryAllByRole("button", { name }).length > 0);
  if (!sheet) throw new Error(`No page action named ${String(name)}`);
  fireEvent.click(within(sheet).getAllByRole("button", { name })[0]!);
}
