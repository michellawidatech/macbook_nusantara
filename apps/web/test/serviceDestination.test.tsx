/**
 * Stock out is by reason since 2026-10-30 (Internal use writes off; Service
 * is the batch dialog). Before that it kept only write-offs (2026-10-26). "On service" and its
 * *Send to* left the batch editor: a unit goes to a repairer through *Send to
 * service* on its row, the one dialog every door opens (inventoryPage.test.tsx
 * and inboundQcPage.test.tsx cover it). And Stock out's counted-products
 * picker offers only what the shop has pieces of — Stock in still offers every
 * variant.
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { InventoryPage } from "../src/routes/stock/InventoryPage.js";
import { getDb, mutate } from "../src/mock/store.js";
import { onHand } from "../src/lib/stock.js";
import { skuTracksSerial } from "../src/lib/serialTracking.js";
import { isLiveSku } from "../src/lib/skuCode.js";

vi.setConfig({ testTimeout: 60_000 });

async function openBatch(direction: "IN" | "OUT") {
  render(
    <AntdApp>
      <MemoryRouter initialEntries={[`/stock/inventory?adjust=${direction}`]}>
        <InventoryPage />
      </MemoryRouter>
    </AntdApp>,
  );
  return (
    await screen.findByText(direction === "OUT" ? /^Stock out/ : /^Stock in/)
  ).closest(".ant-modal") as HTMLElement;
}

/** The titles of the options a Select offers, once opened. */
async function optionsOf(control: HTMLElement): Promise<string[]> {
  fireEvent.mouseDown(control);
  return vi.waitFor(() => {
    const open = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
      ),
    );
    const titles = Array.from(
      open[open.length - 1]?.querySelectorAll<HTMLElement>(
        ".ant-select-item-option",
      ) ?? [],
    ).map((el) => el.getAttribute("title") ?? el.textContent ?? "");
    if (titles.length === 0) throw new Error("no options open");
    return titles;
  });
}

describe("Stock out", () => {
  it("asks for a reason from a fixed list (2026-10-30)", async () => {
    const dialog = await openBatch("OUT");
    expect(
      within(dialog)
        .getAllByRole("radio")
        .map((r) => r.closest("label")?.textContent),
    ).toEqual([
      "Internal use",
      "Stock transfer",
      "Service",
      "Return to supplier",
    ]);
    expect(within(dialog).queryByLabelText("Send to")).toBeNull();
  });

  it("offers only the counted products the shop has pieces of", async () => {
    // Sell one counted product out, so the shop has both kinds.
    const before = getDb();
    const gone = before.skus.find(
      (s) =>
        isLiveSku(s) &&
        !skuTracksSerial(before, s.id) &&
        onHand(before.stockMoves, s.id) > 0,
    )!;
    const levels = new Map<string, number>();
    for (const m of before.stockMoves)
      if (m.skuId === gone.id)
        levels.set(m.locationId, (levels.get(m.locationId) ?? 0) + m.qty);
    mutate((d) => {
      for (const [locationId, qty] of levels) {
        if (qty === 0) continue;
        d.stockMoves.push({
          id: `sm-test-out-${locationId}`,
          skuId: gone.id,
          locationId,
          qty: -qty,
          cost: 0,
          type: "KOREKSI",
          at: new Date().toISOString(),
          staff: "Test",
        });
      }
    });
    try {
      const db = getDb();
      const counted = db.skus.filter(
        (s) => isLiveSku(s) && !skuTracksSerial(db, s.id),
      );
      const stocked = counted.filter((s) => onHand(db.stockMoves, s.id) > 0);
      expect(stocked.length).toBeGreaterThan(0);
      expect(stocked.length).toBeLessThan(counted.length);

      const dialog = await openBatch("OUT");
      fireEvent.click(
        within(dialog).getByRole("radio", { name: "Internal use" }),
      );
      expect(await countedOffered(dialog)).toHaveLength(stocked.length);
    } finally {
      mutate((d) => {
        d.stockMoves = d.stockMoves.filter(
          (m) => !m.id.startsWith("sm-test-out-"),
        );
      });
    }
  });

  it("leaves Stock in offering every counted product", async () => {
    const db = getDb();
    const counted = db.skus.filter(
      (s) => isLiveSku(s) && !skuTracksSerial(db, s.id),
    );
    const dialog = await openBatch("IN");
    fireEvent.click(
      within(dialog).getByRole("radio", { name: "Internal use" }),
    );
    expect(await countedOffered(dialog)).toHaveLength(counted.length);
  });
});

/** Add a counted line and read what its product picker offers. */
async function countedOffered(dialog: HTMLElement): Promise<string[]> {
  const adds = within(dialog).getAllByRole("button", { name: /Add line/ });
  fireEvent.click(adds.at(-1)!);
  const picker = await within(dialog).findByLabelText("Counted product");
  return optionsOf(picker);
}
