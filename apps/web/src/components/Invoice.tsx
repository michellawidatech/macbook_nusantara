/**
 * The printed faktur — offered the moment a sale is recorded, and re-printable
 * for ever after from Finance → Transaction History.
 *
 * ## The one adjustment to the owner's template
 *
 * The template this is built from carried a fixed line reading
 * "INSTAGRAM NUSANTARA" in the bill-to block — the shop's own handle, printed
 * on every receipt regardless of who was buying. That line is now
 * {@link billedTo}: the customer's name off the sale, upper-cased, in the same
 * position and weight. A walk-in with no customer record prints "WALK-IN
 * CUSTOMER" rather than a blank, because a receipt with an empty bill-to line
 * looks like a printer fault.
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
import type { CSSProperties } from "react";
import { Button, Modal, Typography } from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import { fmtRp, fmtDate } from "../lib/format.js";
import { paymentsOf, saleBalance } from "../lib/salePayments.js";
import { marketplacePayMethod } from "../lib/channels.js";
// No `t` on purpose: the faktur is a print template and is deliberately
// outside the language switch, so it takes the English label.
import { labelOf, ORDER_SOURCE } from "../i18n/enumLabels.js";
import type { MockDb, Order } from "../mock/seed.js";

/**
 * What the header prints when the shop has not said otherwise.
 *
 * Settings owns shop identity as of 2026-09-02 (`AppSettings.shopName` and its
 * three siblings, mirroring the `shop.*` keys in `AppSetting`). These are the
 * exact strings that used to be hard-coded here, kept as the fallback rather
 * than dropped: a faktur is the wrong surface on which to discover that a
 * setting is missing, and a receipt with no shop name on it looks like a
 * printer fault rather than a configuration one.
 */
const SHOP_FALLBACK = {
  name: "NUSANTARA",
  tagline: "Second-hand Apple — sales, trade-in and service",
  address: "Jakarta, Indonesia",
  contact: "WhatsApp +62 811 2233 44 · @nusantara",
} as const;

/** The header block, as the shop has set it. Blank fields fall back. */
function shopOf(db: MockDb) {
  const s = db.settings;
  const or = (value: string | undefined, fallback: string) =>
    value !== undefined && value.trim() !== "" ? value : fallback;
  return {
    name: or(s.shopName, SHOP_FALLBACK.name),
    tagline: or(s.shopTagline, SHOP_FALLBACK.tagline),
    address: or(s.shopAddress, SHOP_FALLBACK.address),
    contact: or(s.shopContact, SHOP_FALLBACK.contact),
  };
}

export interface InvoiceProps {
  readonly db: MockDb;
  readonly order: Order;
}

/** The line that used to read "INSTAGRAM NUSANTARA" on the owner's template. */
function billedTo(
  db: MockDb,
  order: Order,
): { name: string; phone?: string; address?: string } {
  const customer = order.customerId
    ? db.customers.find((c) => c.id === order.customerId)
    : undefined;
  if (!customer) return { name: "WALK-IN CUSTOMER" };
  return {
    name: customer.name.toUpperCase(),
    ...(customer.phone ? { phone: customer.phone } : {}),
    ...((order.shippingAddress ?? customer.address)
      ? { address: order.shippingAddress ?? customer.address }
      : {}),
  };
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
  /*
   * The method, spelled the way the shop spells it.
   *
   * `Order.payMethod` and `SalePayment.method` hold `PaymentMethod` CODES
   * since 2026-09-09 — see seed.ts — so a receipt that printed the field raw
   * would say "KARTU_KREDIT". A marketplace sale gets its channel's own
   * escrow wording, which is what the customer's own order confirmation says.
   */
  const methodLabel = (code: string) =>
    code === "MARKETPLACE"
      ? marketplacePayMethod(order.source)
      : (db.paymentMethods.find((m) => m.code === code)?.label ?? code);
  const salesman = db.salesmen.find((s) => s.id === order.salesmanId);
  /** The bill in parts, and what it comes to. See `lib/salePayments.ts`. */
  const parts = paymentsOf(order);
  const balance = saleBalance(order.total, parts);
  const subtotal = order.serials.reduce(
    (t, s) => t + (order.prices[s] ?? 0),
    0,
  );
  const lines = order.serials.map((serial) => {
    const unit = db.units.find((u) => u.serial === serial);
    const sku = unit && db.skus.find((k) => k.id === unit.skuId);
    return {
      serial,
      name: sku ? `${sku.name} ${sku.variantLabel}` : serial,
      description: unit?.description ?? "",
      price: order.prices[serial] ?? 0,
    };
  });

  const cell: CSSProperties = {
    padding: "6px 8px",
    borderBottom: "1px solid #e5e5e5",
  };
  const th: CSSProperties = {
    ...cell,
    borderBottom: "1.5px solid #111",
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    textAlign: "left",
  };

  return (
    <div
      className="invoice-print-root"
      style={{
        background: "#fff",
        color: "#111",
        fontFamily: "'Helvetica Neue', Arial, sans-serif",
        fontSize: 12,
        lineHeight: 1.45,
        padding: 24,
      }}
    >
      {/* Header — shop on the left, document identity on the right. */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 24,
          alignItems: "flex-start",
        }}
      >
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1.5 }}>
            {shop.name}
          </div>
          <div style={{ fontSize: 11, color: "#555" }}>{shop.tagline}</div>
          <div style={{ fontSize: 11, color: "#555" }}>{shop.address}</div>
          <div style={{ fontSize: 11, color: "#555" }}>{shop.contact}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 3 }}>
            INVOICE
          </div>
          <div style={{ fontSize: 11, color: "#555" }}>FAKTUR PENJUALAN</div>
          <div style={{ marginTop: 8, fontSize: 12 }}>
            <strong>{order.code}</strong>
          </div>
          <div style={{ fontSize: 11, color: "#555" }}>
            {new Date(order.ts).toLocaleString("en-GB", {
              day: "2-digit",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>
      </div>

      <hr
        style={{ border: 0, borderTop: "2px solid #111", margin: "14px 0" }}
      />

      {/* Bill-to. The name here is the template's old "INSTAGRAM NUSANTARA". */}
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: 24 }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              letterSpacing: 0.8,
              color: "#666",
              textTransform: "uppercase",
            }}
          >
            Kepada / Bill to
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.5 }}>
            {to.name}
          </div>
          {to.phone && <div style={{ color: "#444" }}>{to.phone}</div>}
          {to.address && (
            <div style={{ color: "#444", maxWidth: 260 }}>{to.address}</div>
          )}
        </div>
        <div style={{ textAlign: "right", color: "#444" }}>
          <div>
            <span style={{ color: "#666" }}>Channel</span>{" "}
            {labelOf(ORDER_SOURCE, order.source)}
          </div>
          {/*
            * The bill's parts, since 2026-09-08 (owner ask: *"we need to track
            * different payment handling and reflect it on invoice"*).
            *
            * A sale paid one way prints exactly the line it always printed —
            * `paymentsOf` gives a single-payment order one part — so nothing
            * changes for the common receipt. A split one prints a line each,
            * because a customer who paid Rp5jt in cash and Rp5jt on PayLater
            * needs a receipt that says so, and one that reads "Payment
            * Transfer" is a receipt they cannot use to argue with either
            * party.
            */}
          {parts.length === 1 ? (
            <div>
              <span style={{ color: "#666" }}>Payment</span>{" "}
              {methodLabel(order.payMethod)}
            </div>
          ) : (
            parts.map((p) => (
              <div key={p.id}>
                <span style={{ color: "#666" }}>
                  {p.state === "PENDING"
                    ? `${p.channel ?? "Marketplace"} (pending)`
                    : p.state === "DUE"
                      ? "Due"
                      : methodLabel(p.method)}
                </span>{" "}
                {fmtRp(p.amount)}
              </div>
            ))
          )}
          {salesman && (
            <div>
              <span style={{ color: "#666" }}>Salesperson</span> {salesman.name}
            </div>
          )}
        </div>
      </div>

      <table
        style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}
      >
        <thead>
          <tr>
            <th style={{ ...th, width: 28 }}>#</th>
            <th style={th}>Description</th>
            <th style={{ ...th, width: 150 }}>Serial number</th>
            <th style={{ ...th, width: 120, textAlign: "right" }}>Price</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.serial}>
              <td style={{ ...cell, verticalAlign: "top", color: "#666" }}>
                {i + 1}
              </td>
              <td style={{ ...cell, verticalAlign: "top" }}>
                <div style={{ fontWeight: 600 }}>{l.name}</div>
                {l.description && (
                  <div style={{ fontSize: 11, color: "#666" }}>
                    {l.description}
                  </div>
                )}
              </td>
              <td
                style={{
                  ...cell,
                  verticalAlign: "top",
                  fontFamily: "ui-monospace, Menlo, monospace",
                  fontSize: 11,
                }}
              >
                {l.serial}
              </td>
              <td
                style={{
                  ...cell,
                  verticalAlign: "top",
                  textAlign: "right",
                  whiteSpace: "nowrap",
                }}
              >
                {fmtRp(l.price)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals, right-aligned under the price column. */}
      <div
        style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}
      >
        <table style={{ borderCollapse: "collapse", minWidth: 260 }}>
          <tbody>
            <tr>
              <td style={{ padding: "3px 8px", color: "#555" }}>Subtotal</td>
              <td
                style={{
                  padding: "3px 8px",
                  textAlign: "right",
                  whiteSpace: "nowrap",
                }}
              >
                {fmtRp(subtotal)}
              </td>
            </tr>
            {order.discount > 0 && (
              <tr>
                <td style={{ padding: "3px 8px", color: "#555" }}>
                  Discount
                  {order.discountId &&
                    ` (${db.discounts.find((d) => d.id === order.discountId)?.code ?? ""})`}
                </td>
                <td
                  style={{
                    padding: "3px 8px",
                    textAlign: "right",
                    whiteSpace: "nowrap",
                  }}
                >
                  −{fmtRp(order.discount)}
                </td>
              </tr>
            )}
            <tr>
              <td
                style={{
                  padding: "8px",
                  borderTop: "2px solid #111",
                  fontWeight: 700,
                  fontSize: 14,
                }}
              >
                TOTAL
              </td>
              <td
                style={{
                  padding: "8px",
                  borderTop: "2px solid #111",
                  textAlign: "right",
                  fontWeight: 700,
                  fontSize: 14,
                  whiteSpace: "nowrap",
                }}
              >
                {fmtRp(order.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {order.shippingAddress && (
        <div style={{ marginTop: 12, fontSize: 11 }}>
          <span style={{ color: "#666" }}>Ship to </span>
          {order.shippingAddress}
        </div>
      )}

      <div
        style={{ marginTop: 18, fontSize: 10, color: "#555", lineHeight: 1.6 }}
      >
        <div>
          <strong>Garansi 90 hari</strong> — hardware faults not caused by
          damage, liquid or software. Bring this invoice as proof of purchase.
        </div>
        <div>
          Second-hand units are sold in the condition described above. Serial
          numbers are recorded against this sale and cannot be exchanged for
          another unit.
        </div>
        {/*
          * Two different warnings, because they are about two different
          * people. A marketplace holding the money is the shop's problem; an
          * unpaid balance is the customer's, and the receipt they walk out
          * with has to say what they still owe and when.
          */}
        {balance.pending > 0 && (
          <div style={{ marginTop: 4, fontWeight: 700, color: "#8a6100" }}>
            {fmtRp(balance.pending)} pending —{" "}
            {labelOf(ORDER_SOURCE, order.source)} has not released the funds
            yet.
          </div>
        )}
        {balance.customerOwes > 0 && (
          <div style={{ marginTop: 4, fontWeight: 700, color: "#a8071a" }}>
            Balance due {fmtRp(balance.customerOwes)}
            {balance.nextDueAt ? ` by ${fmtDate(balance.nextDueAt)}` : ""}.
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 32,
          gap: 24,
        }}
      >
        {["Hormat kami / For the shop", "Diterima oleh / Received by"].map(
          (label) => (
            <div key={label} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ height: 48 }} />
              <div
                style={{
                  borderTop: "1px solid #111",
                  paddingTop: 4,
                  fontSize: 10,
                  color: "#555",
                }}
              >
                {label}
              </div>
            </div>
          ),
        )}
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
