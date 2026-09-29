/**
 * An inbound order opens read-only, and paying it off offers to close it
 * (owner asks 2026-09-24).
 *
 * > *"When viewing an inbound it should be display only first, and add an
 * > 'Edit Invoice' button to edit it next to Close invoice. When the user add
 * > payment and the inbound is fully paid, add popup modal to ask the user to
 * > close the invoice or not."*
 *
 * The rest of the page is `inboundQcPage.test.tsx`, which presses the same
 * button in its own `renderOrder`. What is here is the gate itself: the two
 * things that must be true before a bench can type, and the one dialog that
 * appears after the last rupiah.
 */
import { App as AntdApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InboundDetailPage } from "../src/routes/inbound/InboundDetailPage.js";
import { poTotals } from "../src/lib/inbound.js";
import { getDb, mutate } from "../src/mock/store.js";

vi.setConfig({ testTimeout: 60_000 });

const ORDER = "po-5";

/**
 * A wide viewport, so `PageContainer` draws its actions as buttons rather than
 * as the phone's `FloatButton` group. `test/setup.ts` stubs `matchMedia` to
 * answer "no" to everything, which makes every test compact by default.
 */
function desktop() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: /min-width/.test(query),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

function renderOrder() {
  desktop();
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={[`/inbound/${ORDER}`]}>
        <Routes>
          <Route path="/inbound/:poId" element={<InboundDetailPage />} />
        </Routes>
      </MemoryRouter>
    </AntdApp>,
  );
}

/**
 * The header's toggle. It used to be drawn twice — here and on a banner under
 * the title — and the banner went on 2026-09-25 (owner ask), so the header is
 * the only one. This file renders on a wide viewport (`desktop()` above), so
 * it is a real header button; `test/pageActions.ts` is how a compact suite
 * reaches the same action inside its float fan.
 */
const editInvoice = () =>
  screen.getAllByRole("button", { name: /Edit invoice/ })[0]!;

describe("an inbound opens read-only", () => {
  it("locks the page, and offers the way out", async () => {
    renderOrder();
    expect(await screen.findByLabelText("Supplier")).toBeDisabled();
    // Every field is a fact that writes on change (2026-09-15), so read-only
    // has to mean the controls too. The state is not announced in prose any
    // more; what says it is the disabled field and the button offering to
    // undo it.
    expect(editInvoice()).toBeTruthy();
  });

  it("takes changes once Edit invoice is pressed, and stops again", async () => {
    renderOrder();
    await userEvent.click(editInvoice());
    expect(screen.getByLabelText("Supplier")).not.toBeDisabled();
    expect(screen.queryByRole("button", { name: /Edit invoice/ })).toBeNull();

    await userEvent.click(
      screen.getAllByRole("button", { name: /Save invoice/ })[0]!,
    );
    expect(screen.getByLabelText("Supplier")).toBeDisabled();
  });

  it("refuses a scan while it is read-only", async () => {
    renderOrder();
    // The scanner listens at the document, so no `disabled` prop reaches it:
    // a bench scanning onto a page nobody unlocked would mint units silently.
    for (const ch of "SC02AA111AAAX") {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: ch, bubbles: true }),
      );
    }
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(
      await screen.findByText(
        "This invoice is read-only. Press Edit invoice before scanning.",
      ),
    ).toBeTruthy();
    expect(getDb().units.some((u) => u.serial === "C02AA111AAAX")).toBe(false);
  });
});

describe("paying an invoice off", () => {
  beforeEach(async () => {
    /*
     * One bucket owing money and nothing paid yet, so one payment settles the
     * whole invoice. The demo order's shipping expense would otherwise leave
     * Rp 150.000 behind — which is the point of `offerToClose` reading the
     * STORE rather than a render, but not what these two pin — and the store
     * carries the previous test's payment into the next one.
     */
    await mutate((d) => {
      const po = d.pos.find((p) => p.id === ORDER)!;
      po.fees = [];
      po.payments = [];
      delete po.closedAt;
    });
  });

  /** Fill the dialog with everything still owed and record it. */
  async function payItOff() {
    await userEvent.click(editInvoice());
    await userEvent.click(
      screen.getByRole("button", { name: "Record payment" }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Pay what is owed on it/ }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Record" }),
    );
  }

  it("asks whether to close the invoice, and closes it on yes", async () => {
    renderOrder();
    const owed = poTotals(getDb().pos.find((p) => p.id === ORDER)!).outstanding;
    expect(owed).toBeGreaterThan(0);

    await payItOff();
    // antd's confirm renders its title twice (the heading and its label).
    expect(
      (await screen.findAllByText("This invoice is paid in full")).length,
    ).toBeGreaterThan(0);
    await userEvent.click(
      screen.getByRole("button", { name: /^Close invoice$/ }),
    );
    await waitFor(() =>
      expect(getDb().pos.find((p) => p.id === ORDER)!.closedAt).toBeDefined(),
    );
  });

  it("leaves it open on no — an invoice can be settled and still in QC", async () => {
    renderOrder();
    await payItOff();
    await screen.findAllByText("This invoice is paid in full");
    await userEvent.click(
      screen.getByRole("button", { name: "Leave it open" }),
    );
    await waitFor(() =>
      expect(poTotals(getDb().pos.find((p) => p.id === ORDER)!).fullyPaid).toBe(
        true,
      ),
    );
    expect(getDb().pos.find((p) => p.id === ORDER)!.closedAt).toBeUndefined();
  });
});
