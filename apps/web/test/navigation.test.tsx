import { describe, expect, it } from "vitest";
import { matchLeaf, NAV_SECTIONS } from "../src/layouts/navigation.js";
import { buildSeed } from "../src/mock/seed.js";

/** Every leaf in the tree, flattened, with the section that owns it. */
const leaves = NAV_SECTIONS.flatMap((s) =>
  (s.children ?? (s.path ? [{ path: s.path, label: s.label }] : [])).map(
    (leaf) => ({ section: s.label, ...leaf }),
  ),
);

describe("navigation", () => {
  it("has seven top-level sections, in the owner's order", () => {
    // The 2026-08-26 flattening: Reservation, Return and Discount stopped
    // being top-level and went back under the section whose job they are part
    // of. Nine sections was more than the sidebar could show without
    // scrolling, which is what made the accordion necessary in the first
    // place.
    //
    // Supplier joined on 2026-09-08, beside Customer, because it is Customer's
    // mirror: money out against money in. Seven is inside the budget the
    // flattening bought.
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual([
      "Stock",
      "Product",
      "Financial & Report",
      "Chatbot",
      "Customer",
      "Supplier",
      "Settings",
    ]);
  });

  it("Stock leads with intake and ends with the two movements", () => {
    const stock = NAV_SECTIONS.find((s) => s.key === "stock");
    expect(stock?.children?.map((c) => c.label)).toEqual([
      "Inbound & QC",
      "New Transaction",
      "Inventory",
      "Stock Opname",
      "S/N Tracking",
      // Machines away at a repairer (owner ask 2026-09-08). Between tracking
      // and the two movements because that is where it sits in the day: you
      // look a serial up, then you look at what is out of the building.
      "Service",
      "Reservation",
      "Return",
    ]);
  });

  it("Reservation and Return are Stock leaves again", () => {
    // The reverse of the 2026-08-20 change, asserted from both ends: neither
    // is a section any more, and both resolve under Stock.
    expect(NAV_SECTIONS.some((s) => s.path === "/reservations")).toBe(false);
    expect(NAV_SECTIONS.some((s) => s.path === "/returns")).toBe(false);
    expect(matchLeaf("/reservations")?.section.label).toBe("Stock");
    expect(matchLeaf("/returns")?.leaf?.label).toBe("Return");
  });

  it("Discount is a Product leaf, and its child route still resolves", () => {
    // /discounts/new must keep resolving, or a bookmark breaks on an IA change.
    expect(matchLeaf("/discounts")?.section.label).toBe("Product");
    expect(matchLeaf("/discounts")?.leaf?.label).toBe("Discount");
    expect(matchLeaf("/discounts/new")?.leaf?.label).toBe("Discount");
  });

  it("the two merged screens are one leaf each", () => {
    // Inventory absorbed Stock Movement and the chat inbox absorbed the
    // knowledge base (2026-08-26). Both old paths redirect in App.tsx; here we
    // only assert that the MENU offers one entry, not two.
    expect(leaves.filter((l) => l.path.startsWith("/stock/inventory"))).toEqual(
      [
        {
          section: "Stock",
          path: "/stock/inventory",
          label: "Inventory",
        },
      ],
    );
    expect(leaves.filter((l) => l.path.startsWith("/chat"))).toEqual([
      { section: "Chatbot", path: "/chat", label: "Chatbot" },
    ]);
  });

  it("a section with children never matches as a bare leaf", () => {
    // `matchLeaf` reports `leaf` only for a section that HAS children. A page
    // reading it to highlight the menu depends on that split.
    expect(matchLeaf("/settings")?.leaf).toBeUndefined();
    expect(matchLeaf("/customers")?.leaf).toBeUndefined();
    expect(matchLeaf("/nowhere")).toBeNull();
  });

  it("every leaf path is unique", () => {
    const paths = leaves.map((l) => l.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("mock seed", () => {
  const db = buildSeed();
  it("every unit's variant carries a positive price", () => {
    // Mirrored the DB CHECK on `Unit.price` until 2026-08-27. The column and
    // the CHECK both went when the price moved to the variant, and the claim
    // worth keeping moved with them: whatever a unit's status, the SKU behind
    // it can quote a number.
    for (const u of db.units) {
      const sku = db.skus.find((s) => s.id === u.skuId);
      expect(sku?.price ?? 0).toBeGreaterThan(0);
    }
  });
  it("every unit's history starts with DITERIMA", () => {
    for (const u of db.units) {
      const first = db.events
        .filter((e) => e.serial === u.serial)
        .sort((a, b) => a.seq - b.seq)[0];
      expect(first?.type).toBe("DITERIMA");
    }
  });
  it("shopee order is pending until withdrawn", () => {
    const shopee = db.orders.find((o) => o.source === "SHOPEE");
    expect(shopee?.settled).toBe(false);
  });
});
