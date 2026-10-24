/**
 * The faktur follows B2Soft's FAKTUR PENJUALAN (owner ask 2026-10-21) and
 * carries no text the shop has not written: no warranty paragraph, no
 * payment-method lines, no unit description.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  InvoiceSheet,
  SHOP_ADDRESS,
  SHOP_PHONE,
  fakturAmount,
} from "../src/components/Invoice.js";
import { buildSeed, type Order } from "../src/mock/seed.js";

function sale(): { db: ReturnType<typeof buildSeed>; order: Order } {
  const db = buildSeed();
  const unit = db.units.find((u) => u.status === "TERSEDIA" && u.description)!;
  const sku = db.skus.find((k) => k.id !== unit.skuId)!;
  db.settings.shopName = "Macbook Nusantara";
  db.settings.shopTagline = "Buka setiap hari 10.00 - 20.00";
  const order: Order = {
    id: "o-faktur",
    code: "SI-2026/07-000094",
    ts: "2026-07-27T05:00:00.000Z",
    customerId: null,
    serials: [unit.serial],
    prices: { [unit.serial]: 5_700_000 },
    listPrices: { [unit.serial]: 6_000_000 },
    lines: [{ id: "l1", skuId: sku.id, qty: 2, price: 150_000 }],
    discount: 100_000,
    source: "WALKIN" as Order["source"],
    payMethod: "TUNAI",
    settled: true,
    fees: [
      { id: "f1", label: "Delivery", amount: 50_000 },
      { id: "f2", label: "Shopping bag", amount: 10_000 },
    ],
    total: 5_700_000 + 300_000 - 100_000 + 60_000,
  };
  return { db, order };
}

describe("InvoiceSheet", () => {
  it("prints the template's labels and the sums in its order", () => {
    const { db, order } = sale();
    const { container } = render(<InvoiceSheet db={db} order={order} />);
    for (const text of [
      "FAKTUR PENJUALAN",
      "MACBOOK NUSANTARA",
      "Buka setiap hari 10.00 - 20.00",
      SHOP_ADDRESS,
      `Telp. ${SHOP_PHONE}`,
      "Kepada Yth,",
      "WALK-IN CUSTOMER",
      "Perincian",
      "Diterima Oleh,",
      "Hormat kami,",
    ])
      expect(screen.getByText(text)).toBeInTheDocument();
    const foot = [...container.querySelectorAll("tfoot tr")].map(
      (tr) => tr.lastElementChild!.textContent,
    );
    // Total, Diskon, Ongkos, PPN, Lain, Netto.
    expect(foot).toEqual(
      [6_000_000, 100_000, 50_000, 0, 10_000, 5_960_000].map(fakturAmount),
    );
    // The haggled unit: listed 6jt, Rp300.000 off, charged 5.7jt.
    expect(container.textContent).toContain(
      "6,000,000.00300,000.005,700,000.00",
    );
  });

  it("prints none of the old receipt's extra text", () => {
    const { db, order } = sale();
    const unit = db.units.find((u) => u.serial === order.serials[0])!;
    const { container } = render(<InvoiceSheet db={db} order={order} />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("Garansi");
    expect(text).not.toContain("Payment");
    expect(text).not.toContain("Channel");
    // Settings' demo address and number never reach the paper.
    expect(text).not.toContain(db.settings.shopAddress!);
    expect(text).not.toContain(db.settings.shopContact!);
    expect(text).not.toContain(unit.description);
    expect(text).toContain(unit.serial);
  });
});
