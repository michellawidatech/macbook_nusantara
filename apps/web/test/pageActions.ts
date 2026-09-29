/**
 * Press a `PageContainer` action, whichever viewport the test is in.
 *
 * `test/setup.ts` stubs `matchMedia` to answer "no" to everything, so unless a
 * test says otherwise `compact` is TRUE and the page's actions are NOT buttons
 * in the header — they are a `FloatButton` fan behind a neutral glyph, and its
 * members are not in the DOM until the fan is opened.
 *
 * Until 2026-09-25 the inbound suites did not have to know that: the page
 * carried a read-only banner with its own *Edit invoice* button, drawn on
 * every viewport. The owner asked for the banner to go, so the header action
 * is the only one and this is how a test reaches it.
 */
import { fireEvent, screen } from "@testing-library/react";

export function pressPageAction(name: RegExp | string) {
  const found = screen.queryAllByRole("button", { name });
  if (found.length > 0) {
    fireEvent.click(found[0]!);
    return;
  }
  // Compact: open the fan, then press the member. A single action renders as
  // the float button itself and is caught by the branch above.
  fireEvent.click(screen.getByRole("button", { name: "Page actions" }));
  fireEvent.click(screen.getAllByRole("button", { name })[0]!);
}
