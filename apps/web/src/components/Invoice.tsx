/**
 * The printed faktur — offered the moment a sale is recorded, and re-printable
 * for ever after from Finance → Transaction History.
 *
 * ## The owner's template, 2026-10-21
 *
 * The sheet is laid out after B2Soft's FAKTUR PENJUALAN, the one the shop
 * printed for years (owner ask: *"make the bill exactly like this structure,
 * with no extra text"*). Title and shop on the left, the date and *Kepada
 * Yth.* on the right; No Faktur / Salesman / Tgl / JTp; a table of No ·
 * Perincian · Qty · Harga · Diskon · Jumlah; then the print stamp, Ref and
 * Keterangan beside Total · Diskon · Ongkos · PPN · Lain · Netto; and four
 * signature boxes.
 *
 * What went, deliberately: the warranty and "sold as described" paragraphs,
 * the channel and payment-method lines, the pending / balance-due warnings,
 * and each unit's QC description. The owner's word for them was
 * *misleading* — a receipt is something a customer argues from, and every
 * sentence on it is one the shop has to stand behind. Under the shop's name
 * go its hours (Settings → tagline), its address and its telephone number.
 *
 * Two of B2Soft's cells are NOT printed: *Cetak : 2x* (this app does not count
 * prints, and a made-up count is worse than none) and *Hal : 1 dari 1* (the
 * browser paginates, and cannot tell a page what number it is). The serial
 * stays beside the product in Perincian, because the serial is what a warranty
 * claim is checked against.
 *
 * The bill-to line is the customer's name off the sale, upper-cased. B2Soft's
 * read "INSTAGRAM NUSANTARA" — a channel filed as a customer. A walk-in prints
 * "WALK-IN CUSTOMER" rather than a blank, because an empty Kepada line looks
 * like a printer fault.
 *
 * ## Why it prints the way it does
 *
 * Printing is `window.print()` against a visibility switch in global.css, not a
 * second window and not a PDF library. The reasons, in order: a popup is
 * blocked by default on a shop laptop nobody administers, a PDF library is
 * 300kB to render one page of text, and the browser's own print dialog is the
 * only thing that reliably reaches a thermal printer over CUPS. The trade-off
 * is that exactly one `.invoice-print-root` may be mounted at a time — which is
 * why this lives inside a modal that only ever shows one sale.
 *
 * Money is read from the ORDER, never recomputed from today's prices: a unit's
 * price can be edited after the sale, and a receipt that changes retroactively
 * is not a receipt.
 */
import { SHOP_ADDRESS, SHOP_PHONE } from "@nusantara/domain";
import type { CSSProperties } from "react";
import { Button, Modal, Typography } from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import { customerLabel } from "../lib/customers.js";
import { paymentsOf } from "../lib/salePayments.js";
import { paymentRefOf } from "../lib/saleStatus.js";
import { currentStaffName } from "../mock/store.js";
// No `t` on purpose: the faktur is a print template and is deliberately
// outside the language switch — it is in Indonesian, like B2Soft's.
import type { MockDb, Order, OrderFee } from "../mock/seed.js";

/**
 * What the header prints when the shop has not said otherwise.
 *
 * Settings owns shop identity as of 2026-09-02 (`AppSettings.shopName` and its
 * three siblings, mirroring the `shop.*` keys in `AppSetting`). The name falls
 * back because a faktur with no shop on it looks like a printer fault; the
 * tagline (the opening hours) prints only when the shop has written one — a
 * fallback sentence here would be exactly the invented text the 2026-10-21
 * template removed.
 */
const SHOP_FALLBACK_NAME = "MACBOOK NUSANTARA";

/**
 * Where the shop is and how to reach it, as the owner gave them on 2026-10-21.
 *
 * Fixed here rather than read from Settings → Shop address / contact: those
 * fields were seeded with demo text ("Jakarta, Indonesia", a made-up WhatsApp
 * number), and a customer who rings the number on their receipt must reach
 * the shop.
 */
export { SHOP_ADDRESS, SHOP_PHONE };

/** The header block. */
function shopOf(db: MockDb) {
  const s = db.settings;
  const tagline = s.shopTagline?.trim() ?? "";
  return {
    name: (s.shopName?.trim() || SHOP_FALLBACK_NAME).toUpperCase(),
    lines: [...(tagline ? [tagline] : []), SHOP_ADDRESS, `Telp. ${SHOP_PHONE}`],
  };
}

export interface InvoiceProps {
  readonly db: MockDb;
  readonly order: Order;
}

/** Kepada Yth. — the customer, and where the parcel goes when it is sent. */
function billedTo(
  db: MockDb,
  order: Order,
): { name: string; address?: string } {
  const customer = order.customerId
    ? db.customers.find((c) => c.id === order.customerId)
    : undefined;
  return {
    // The name, or the number when that is all the shop has of them.
    name: customer ? customerLabel(customer).toUpperCase() : "WALK-IN CUSTOMER",
    ...(order.shippingAddress ? { address: order.shippingAddress } : {}),
  };
}

/** `5,700,000.00` — B2Soft's figures, which the shop reads at a glance. */
export function fakturAmount(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `27/07/2026`. */
function dmy(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** `28/07/2026 - 03:23:45 PM` — when this copy came off the printer. */
function printStamp(d: Date): string {
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${dmy(d.toISOString())} - ${pad2(h12)}:${pad2(d.getMinutes())}:${pad2(
    d.getSeconds(),
  )} ${h < 12 ? "AM" : "PM"}`;
}

/** A charge that is the courier's — B2Soft's *Ongkos*. The rest is *Lain*. */
const SHIPPING_FEE = /deliver|ship|ongkir|ongkos|kirim|courier|kurir/i;

/**
 * The sale's charges split the way the faktur's foot names them.
 *
 * `fees` is the list since 2026-09-01; an order from before it carries one
 * `extra` with its `extraNote`, read as a list of one.
 */
function chargesOf(order: Order): { ongkos: number; lain: number } {
  const fees: readonly OrderFee[] =
    order.fees && order.fees.length > 0
      ? order.fees
      : order.extra
        ? [{ id: "extra", label: order.extraNote ?? "", amount: order.extra }]
        : [];
  let ongkos = 0;
  let lain = 0;
  for (const f of fees) {
    if (SHIPPING_FEE.test(f.label)) ongkos += f.amount;
    else lain += f.amount;
  }
  return { ongkos, lain };
}

/**
 * The sheet itself.
 *
 * Deliberately plain HTML with inline styles rather than antd components: this
 * is the only surface in the app whose rendering target is paper, where antd's
 * tokens (dark mode, hover states, elevation) are meaningless at best and
 * ink-wasting at worst.
 */
export function InvoiceSheet({ db, order }: InvoiceProps) {
  const to = billedTo(db, order);
  const shop = shopOf(db);
  const salesman = db.salesmen.find((s) => s.id === order.salesmanId);
  const parts = paymentsOf(order);
  const ref = paymentRefOf(parts);
  // Jatuh tempo: the earliest promise date, or the sale's own day when
  // nothing was left owing — which is what B2Soft printed for a cash sale.
  const dueAt =
    parts
      .filter((p) => p.state === "DUE" && p.dueAt)
      .map((p) => p.dueAt!)
      .sort()[0] ?? order.ts;

  const nameOf = (skuId: string) => {
    const sku = db.skus.find((k) => k.id === skuId);
    return sku ? `${sku.name} ${sku.variantLabel}`.trim() : skuId;
  };
  /*
   * Harga is what the line was LISTED at and Diskon what was knocked off it,
   * so Jumlah is what it was charged — the 2026-09-01 bargain, printed where
   * B2Soft printed a line discount. A line sold ABOVE list prints its charged
   * price and no discount; an upsell is not something to show the customer.
   */
  const row = (charged: number, listed: number | undefined) => {
    const harga = Math.max(charged, listed ?? charged);
    return { harga, diskon: harga - charged, jumlah: charged };
  };
  const lines = [
    ...order.serials.map((serial) => {
      const unit = db.units.find((u) => u.serial === serial);
      return {
        key: serial,
        name: unit ? nameOf(unit.skuId) : serial,
        serial,
        qty: 1,
        ...row(order.prices[serial] ?? 0, order.listPrices?.[serial]),
      };
    }),
    // A counted product has no serial (2026-09-19): one line of a quantity.
    ...(order.lines ?? []).map((l) => {
      const per = row(l.price, l.listPrice);
      return {
        key: l.id,
        name: nameOf(l.skuId),
        serial: undefined,
        qty: l.qty,
        harga: per.harga,
        diskon: per.diskon * l.qty,
        jumlah: l.price * l.qty,
      };
    }),
  ];
  const qty = lines.reduce((t, l) => t + l.qty, 0);
  const goods = lines.reduce((t, l) => t + l.jumlah, 0);
  const { ongkos, lain } = chargesOf(order);

  const num: CSSProperties = { textAlign: "right", whiteSpace: "nowrap" };
  const cell: CSSProperties = {
    padding: "3px 6px",
    verticalAlign: "top",
    fontWeight: 400,
  };
  const rule = "1px solid #111";
  const label: CSSProperties = { display: "inline-block", width: 76 };
  const field = (name: string, value: string) => (
    <div>
      <span style={label}>{name}</span>: {value}
    </div>
  );

  return (
    <div
      className="invoice-print-root"
      style={{
        background: "#fff",
        color: "#111",
        fontFamily: "Arial, 'Helvetica Neue', sans-serif",
        fontSize: 12,
        lineHeight: 1.4,
        padding: 24,
      }}
    >
      {/* Title and shop on the left; the date and Kepada Yth. on the right. */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 24,
          alignItems: "flex-start",
        }}
      >
        <div>
          <div style={{ fontSize: 16 }}>FAKTUR PENJUALAN</div>
          <div style={{ fontSize: 16 }}>{shop.name}</div>
          {shop.lines.map((l) => (
            <div key={l} style={{ fontSize: 11, color: "#444" }}>
              {l}
            </div>
          ))}
        </div>
        <div style={{ minWidth: 260 }}>
          <div>
            {new Date(order.ts).toLocaleDateString("id-ID", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </div>
          <div>Kepada Yth,</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{to.name}</div>
          {to.address && <div style={{ maxWidth: 300 }}>{to.address}</div>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 48, marginTop: 20 }}>
        <div>
          {field("No Faktur", order.code)}
          {field("Salesman", salesman?.name.toUpperCase() ?? "")}
        </div>
        <div>
          <div>
            <span style={{ ...label, width: 36 }}>Tgl</span>: {dmy(order.ts)}
          </div>
          <div>
            <span style={{ ...label, width: 36 }}>JTp</span>: {dmy(dueAt)}
          </div>
        </div>
      </div>

      <table
        style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}
      >
        <thead>
          <tr style={{ borderTop: rule, borderBottom: rule }}>
            <th style={{ ...cell, width: 28, textAlign: "left" }}>No</th>
            <th style={{ ...cell, textAlign: "left" }}>Perincian</th>
            <th style={{ ...cell, ...num, width: 48 }}>Qty</th>
            <th style={{ ...cell, ...num, width: 110 }}>Harga</th>
            <th style={{ ...cell, ...num, width: 90 }}>Diskon</th>
            <th style={{ ...cell, ...num, width: 110 }}>Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.key}>
              <td style={cell}>{i + 1}.</td>
              <td style={cell}>
                {l.name}
                {l.serial && (
                  <span style={{ marginLeft: 8, fontSize: 11 }}>
                    SN: {l.serial}
                  </span>
                )}
              </td>
              <td style={{ ...cell, ...num }}>{l.qty}</td>
              <td style={{ ...cell, ...num }}>{fakturAmount(l.harga)}</td>
              <td style={{ ...cell, ...num }}>{fakturAmount(l.diskon)}</td>
              <td style={{ ...cell, ...num }}>{fakturAmount(l.jumlah)}</td>
            </tr>
          ))}
        </tbody>
        {/*
         * The foot sits in the items table so its figures line up under the
         * columns they add up, as B2Soft's did: the quantity under Qty, the
         * names under Diskon, the rupiah under Jumlah.
         */}
        <tfoot>
          {(
            [
              ["Total", goods],
              ["Diskon", order.discount],
              ["Ongkos", ongkos],
              ["PPN", 0],
              ["Lain", lain],
              ["Netto", order.total],
            ] as const
          ).map(([name, value], i) => (
            <tr key={name} style={i === 0 ? { borderTop: rule } : undefined}>
              {i === 0 ? (
                <>
                  <td style={cell} colSpan={2} />
                  <td style={{ ...cell, ...num }}>{qty}</td>
                  <td style={cell} />
                </>
              ) : (
                <td
                  colSpan={4}
                  style={{
                    ...cell,
                    padding: "1px 6px",
                    ...(i === 1 ? { borderBottom: rule } : {}),
                  }}
                >
                  {i === 1 &&
                    `${printStamp(new Date())}\u00a0\u00a0\u00a0${currentStaffName()}`}
                  {i === 2 && field("Ref", ref ?? "")}
                  {i === 3 && field("Keterangan", "")}
                </td>
              )}
              <td style={{ ...cell, padding: "1px 6px", ...num }}>{name} :</td>
              <td style={{ ...cell, padding: "1px 6px", ...num }}>
                {fakturAmount(value)}
              </td>
            </tr>
          ))}
        </tfoot>
      </table>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 12,
        }}
      >
        {[
          "Diterima Oleh,",
          "Diserahkan Oleh,",
          "Diperiksa Oleh,",
          "Hormat kami,",
        ].map((who) => (
          <div key={who} style={{ flex: 1, textAlign: "center" }}>
            <div>{who}</div>
            <div style={{ height: 44 }} />
            <div>(........................)</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface InvoiceModalProps extends Partial<InvoiceProps> {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Shown above the sheet right after a sale; omitted on a reprint. */
  readonly headline?: string;
}

/** The preview, with the one button that matters. */
export function InvoiceModal({
  db,
  order,
  open,
  onClose,
  headline,
}: InvoiceModalProps) {
  return (
    <Modal
      title={order ? `Invoice ${order.code}` : "Invoice"}
      open={open && Boolean(db && order)}
      onCancel={onClose}
      width={820}
      // `.no-print` so the buttons do not appear as a grey strip on the paper.
      classNames={{ footer: "no-print", header: "no-print" }}
      footer={[
        <Button key="close" onClick={onClose}>
          Close
        </Button>,
        <Button
          key="print"
          type="primary"
          icon={<PrinterOutlined />}
          onClick={() => window.print()}
        >
          Print invoice
        </Button>,
      ]}
    >
      {headline && (
        <Typography.Paragraph type="secondary" className="no-print">
          {headline}
        </Typography.Paragraph>
      )}
      {db && order && (
        <div
          style={{
            border: "1px solid #d9d9d9",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <InvoiceSheet db={db} order={order} />
        </div>
      )}
    </Modal>
  );
}
