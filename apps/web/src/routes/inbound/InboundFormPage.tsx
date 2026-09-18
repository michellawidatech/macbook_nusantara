/**
 * Raising a purchase order — three steps, in the order the owner described
 * (2026-08-24).
 *
 * ## Why products are optional
 *
 * The shape of this form is dictated by how the shop actually buys. The owner
 * deals with suppliers; the staff enter the paperwork. Often the owner simply
 * says "transfer this much to that supplier", and nobody at a keyboard knows
 * what it buys until the boxes arrive days later.
 *
 * So step 1 asks only for what is knowable on the day the money moves —
 * supplier, invoice, what was paid — and step 2, the products, can be left
 * empty and filled in from the Inbound detail screen when the goods land. The
 * previous version required at least one priced line before it would let you
 * past step 1, which meant staff invented lines to get an order saved.
 *
 * ## Where the money lives
 *
 * On the order, as a payment. That reverses the note in the old page saying the
 * owner had removed "amount paid" because "a PO's total IS its lines" — true
 * only when the lines are known first. With products optional, the transfer is
 * the ONLY fact available on day one, and deriving it from lines that do not
 * exist yet would record it as zero.
 *
 * Paying less than the invoice is normal, not an error: a deposit now and the
 * balance on delivery is how the shop buys. The order carries the outstanding
 * balance rather than refusing the entry.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import dayjs, { type Dayjs } from "dayjs";
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Flex,
  Form,
  Input,
  InputNumber,
  Segmented,
  Select,
  Steps,
  Typography,
} from "antd";
import { DeleteOutlined, SaveOutlined } from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { FooterToolbar } from "../../components/FooterToolbar";
import { EditableTable } from "../../components/EditableTable";
import { SkuPicker } from "../../components/SkuPicker";
import { CountInput, COUNT_COLUMN_WIDTH } from "../../components/CountInput";
import { MoneyInput } from "../../components/MoneyInput";
import { RP_SYMBOL } from "../../components/money";
import { fmtRp } from "../../lib/format.js";
import { useDb, mutate, nextId, docCode } from "../../mock/store.js";
import { FORM_CENTRE } from "../../theme/tokens";
import { usePersistentState } from "../../hooks/usePersistentState";
import {
  INBOUND_DRAFT_KEY,
  inboundDraftHasContent,
  parseInboundDraft,
  type InboundDraft,
} from "../../lib/inboundDraft.js";
import { useTranslation } from "react-i18next";

interface Line {
  skuId?: string;
  qty: number;
  unitCost?: number;
}

const STEPS = [
  { title: "Order & payment" },
  { title: "Products" },
  { title: "Review" },
];

export function InboundFormPage() {
  const { t } = useTranslation();
  const db = useDb();
  const navigate = useNavigate();
  const { message } = App.useApp();
  /**
   * The wizard, mirrored to this device on every keystroke (owner ask
   * 2026-09-15).
   *
   * Read ONCE, into the ordinary state below, rather than held as the state
   * itself: eleven fields reading and writing one object would rerender the
   * whole form on every character, and every existing control here is written
   * against its own setter. The effect underneath is the mirror. See
   * `lib/inboundDraft.ts` for why auto-save and *Save draft* are two different
   * things.
   */
  const [stored, setStored, clearStored] =
    usePersistentState<InboundDraft | null>(INBOUND_DRAFT_KEY, null, (raw) =>
      raw === null ? null : parseInboundDraft(raw),
    );
  // Read at mount and never again: `stored` changes on every keystroke once
  // the mirror below starts writing, and re-seeding from it would fight the
  // person typing.
  const [restored] = useState(() =>
    stored !== null && inboundDraftHasContent(stored) ? stored : null,
  );
  const [restoreOffered, setRestoreOffered] = useState(restored !== null);

  const [step, setStep] = useState(restored?.step ?? 0);

  const [supplier, setSupplier] = useState<string | undefined>(
    restored?.supplier,
  );
  const [invoice, setInvoice] = useState(restored?.invoice ?? "");
  const [noInvoice, setNoInvoice] = useState(restored?.noInvoice ?? false);
  const [date, setDate] = useState<Dayjs | null>(
    restored?.date ? dayjs(restored.date) : dayjs(),
  );
  const [warehouseId, setWarehouseId] = useState(
    // A warehouse the shop has since removed would leave the Select showing an
    // id, so the stored one is only taken when it is still a place.
    restored?.warehouseId &&
      db.warehouses.some((w) => w.id === restored.warehouseId)
      ? restored.warehouseId
      : db.myWarehouseId,
  );
  const [method, setMethod] = useState<string>(restored?.method ?? "TUNAI");
  const [paid, setPaid] = useState<number | undefined>(restored?.paid);
  const [shippingFee, setShippingFee] = useState<number | undefined>(
    restored?.shippingFee,
  );
  const [taxFee, setTaxFee] = useState<number | undefined>(restored?.taxFee);
  /**
   * The negotiated discount, in whichever unit it was agreed in.
   *
   * Suppliers quote both ways — "I'll knock 500 off" and "5% for cash" — and
   * until 2026-08-26 this form only took rupiah, so a percentage had to be
   * worked out on a phone calculator before it could be typed in. That is a
   * rounding error waiting to happen and, worse, it throws away WHICH deal was
   * struck: 5% of an order whose lines are still unknown is not a number yet.
   *
   * `Po.discount` stays a rupiah figure — it is what the invoice total is
   * built from and no schema column changes — so a percentage is resolved
   * against the subtotal at the moment the order is saved.
   */
  const [discountMode, setDiscountMode] = useState<"RP" | "PCT">(
    restored?.discountMode ?? "RP",
  );
  const [discount, setDiscount] = useState<number | undefined>(
    restored?.discount,
  );
  const [discountPct, setDiscountPct] = useState<number | undefined>(
    restored?.discountPct,
  );
  const [lines, setLines] = useState<Line[]>(() =>
    (restored?.lines ?? []).map((l) => ({ ...l })),
  );

  /**
   * The mirror. One effect over every answer, so nothing can be added to the
   * form and quietly left out of what is saved.
   */
  useEffect(() => {
    setStored({
      step,
      ...(supplier === undefined ? {} : { supplier }),
      invoice,
      noInvoice,
      date: date ? date.format("YYYY-MM-DD") : null,
      warehouseId,
      method,
      ...(paid === undefined ? {} : { paid }),
      ...(shippingFee === undefined ? {} : { shippingFee }),
      ...(taxFee === undefined ? {} : { taxFee }),
      discountMode,
      ...(discount === undefined ? {} : { discount }),
      ...(discountPct === undefined ? {} : { discountPct }),
      lines,
    });
  }, [
    setStored,
    step,
    supplier,
    invoice,
    noInvoice,
    date,
    warehouseId,
    method,
    paid,
    shippingFee,
    taxFee,
    discountMode,
    discount,
    discountPct,
    lines,
  ]);

  /**
   * `MoneyInput` clears to `null`; this state is `undefined`.
   *
   * One adapter rather than a cast at each of the five call sites — the two
   * values mean the same thing here ("no amount entered") and the difference
   * is antd's, not the form's.
   */
  const money = (set: (v: number | undefined) => void) => (v: number | null) =>
    set(v ?? undefined);

  const poMethods = useMemo(
    () => db.paymentMethods.filter((m) => m.forPo && m.active),
    [db.paymentMethods],
  );
  const subtotal = lines.reduce(
    (t, l) => t + (l.unitCost ?? 0) * (l.qty || 0),
    0,
  );
  /**
   * What the discount is worth in rupiah, whichever way it was entered.
   *
   * A percentage bites on the SUBTOTAL, not on the invoiced total: the shop
   * negotiates a discount on the goods, and shipping and tax are the
   * courier's and the state's, not the supplier's to discount. Capped at the
   * subtotal so a mistyped 500% cannot turn an order into money owed to the
   * shop.
   */
  const discountRp =
    discountMode === "PCT"
      ? Math.min(subtotal, Math.round((subtotal * (discountPct ?? 0)) / 100))
      : (discount ?? 0);
  const total = Math.max(
    0,
    subtotal + (shippingFee ?? 0) + (taxFee ?? 0) - discountRp,
  );
  const outstanding = Math.max(0, total - (paid ?? 0));

  /**
   * What blocks step 1, and deliberately nothing else.
   *
   * Supplier, date, and an invoice number OR an explicit "no invoice" — the
   * escape hatch the schema's `noInvoice` column exists for. Products are not
   * here, which is the whole point of the redesign.
   */
  const step1Error = (): string | null => {
    if (!supplier?.trim()) return "Pick or type a supplier.";
    if (!date) return "Pick the date the order was placed.";
    if (!noInvoice && !invoice.trim())
      return "Enter the invoice number, or tick “no invoice”.";
    return null;
  };

  /**
   * Write the order — as a draft, or as one that has been placed.
   *
   * *Save draft* is the fallback the owner asked for on every step: a real
   * `Po` with `status: "DRAFT"`, which is on the Inbound list, has a code and
   * can be opened from another till. Auto-save cannot do any of that — it is
   * this device's `localStorage` — so the two are not alternatives, they are a
   * short net and a long one. See `lib/inboundDraft.ts`.
   *
   * Both go through the same writer, because a draft and a placed order differ
   * in exactly one field and having two functions is how they come to differ
   * in two.
   */
  const save = (status: "DRAFT" | "ORDERED" = "ORDERED") => {
    const err = step1Error();
    if (err) {
      message.error(err);
      setStep(0);
      return;
    }
    const id = nextId("po");
    mutate((d) => {
      const supplierId =
        d.suppliers.find(
          (s) => s.name.toLowerCase() === supplier!.trim().toLowerCase(),
        )?.id ??
        (() => {
          // A supplier typed rather than picked is a new one. Creating it here
          // beats making staff leave a half-filled order to go and add it.
          const fresh = { id: nextId("sup"), name: supplier!.trim() };
          d.suppliers.push(fresh);
          return fresh.id;
        })();
      d.pos.unshift({
        id,
        code: docCode("PI"),
        supplierId,
        invoice: noInvoice ? "" : invoice.trim(),
        noInvoice,
        date: date!.format("YYYY-MM-DD"),
        locationId: warehouseId,
        items: lines
          .filter((l) => l.skuId)
          .map((l) => ({
            id: nextId("poi"),
            skuId: l.skuId!,
            serial: null,
            qty: l.qty || 1,
            unitCost: l.unitCost ?? 0,
          })),
        payments: paid
          ? [
              {
                id: nextId("pp"),
                method,
                amount: paid,
                at: new Date().toISOString(),
              },
            ]
          : [],
        shippingFee: shippingFee ?? 0,
        taxFee: taxFee ?? 0,
        discount: discountRp,
        status,
      });
    });
    // The order IS the draft now, so the device's copy has done its job.
    // Leaving it behind would offer to restore this order onto the next one.
    clearStored();
    message.success(
      status === "DRAFT"
        ? t(
            "inboundForm.draftSaved",
            "Saved as a draft. It is on the Inbound list — finish it whenever.",
          )
        : lines.length === 0
          ? t(
              "inboundForm.savedNoProducts",
              "Order saved. Add the products from the order page when the goods arrive.",
            )
          : t("inboundForm.saved", "Order saved."),
    );
    navigate(`/inbound/${id}`);
  };

  const orderStep = (
    <Card
      title={t("inboundForm.orderPayment", "Order & payment")}
      style={FORM_CENTRE}
    >
      <Form layout="vertical" style={FORM_CENTRE}>
        <Form.Item label={t("inboundForm.supplier", "Supplier")} required>
          <AutoComplete
            value={supplier}
            onChange={setSupplier}
            placeholder={t(
              "inboundForm.searchOrTypeANew",
              "Search or type a new supplier name",
            )}
            options={db.suppliers.map((s) => ({ value: s.name }))}
            filterOption={(input, option) =>
              (option?.value ?? "").toLowerCase().includes(input.toLowerCase())
            }
          />
        </Form.Item>

        <Form.Item
          label={t("inboundForm.invoiceNumber", "Invoice number")}
          required={!noInvoice}
        >
          <Input
            value={invoice}
            disabled={noInvoice}
            onChange={(e) => setInvoice(e.target.value)}
            placeholder={t("inboundForm.eGInvMj0815", "e.g. INV/MJ/0815")}
          />
        </Form.Item>
        <Form.Item>
          <Checkbox
            checked={noInvoice}
            onChange={(e) => {
              setNoInvoice(e.target.checked);
              if (e.target.checked) setInvoice("");
            }}
          >
            {t(
              "inboundForm.thisSupplierIssuedNoInvoice",
              "This supplier issued no invoice",
            )}
          </Checkbox>
        </Form.Item>

        {/*
         * The six facts about the order that are not the supplier or the
         * invoice, on one grid of equal columns (owner decision 2026-08-26).
         *
         * They were three `Flex` rows of two, each field carrying its own
         * hand-picked pixel width — 180 for the date, 200 for the warehouse,
         * whatever a `MoneyInput` happened to be — so no two columns lined up
         * and the form read as six unrelated boxes. `1fr` columns make the
         * question of how wide a field should be answerable in one place, and
         * `auto-fit` drops the grid to two columns and then one as the measure
         * narrows, so a phone gets a stack rather than six slivers.
         */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            columnGap: 16,
          }}
        >
          <Form.Item
            label={t("inboundForm.dateOfPurchase", "Date of purchase")}
            required
          >
            <DatePicker
              value={date}
              onChange={setDate}
              // "26 Aug 2026", not "26 08 2026" (owner decision 2026-08-26). A
              // named month cannot be read the American way round, which is
              // the whole point: 08 09 2026 is two different days depending on
              // who is looking at it.
              format="DD MMM YYYY"
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item label={t("inboundForm.arrivingAt", "Arriving at")}>
            <Select
              value={warehouseId}
              onChange={setWarehouseId}
              style={{ width: "100%" }}
              options={db.warehouses.map((w) => ({
                value: w.id,
                label: w.name,
              }))}
            />
          </Form.Item>
          <Form.Item label={t("inboundForm.paymentMethod", "Payment method")}>
            <Select
              value={method}
              onChange={setMethod}
              style={{ width: "100%" }}
              options={poMethods.map((m) => ({
                value: m.code,
                label: m.label,
              }))}
            />
          </Form.Item>
          <Form.Item
            label={t("inboundForm.totalPaidNow", "Total paid now")}
            extra={t(
              "inboundForm.paidNowHint",
              "Leave blank if nothing has been transferred yet.",
            )}
          >
            <MoneyInput
              style={{ width: "100%" }}
              value={paid}
              onChange={money(setPaid)}
            />
          </Form.Item>
          <Form.Item label={t("inboundForm.shippingFee", "Shipping fee")}>
            <MoneyInput
              style={{ width: "100%" }}
              value={shippingFee}
              onChange={money(setShippingFee)}
            />
          </Form.Item>
          <Form.Item label={t("inboundForm.taxFee", "Tax fee")}>
            <MoneyInput
              style={{ width: "100%" }}
              value={taxFee}
              onChange={money(setTaxFee)}
            />
          </Form.Item>
        </div>
      </Form>
    </Card>
  );

  /**
   * The product lines.
   *
   * Rewritten 2026-09-01 on three owner complaints, all of which are really one
   * complaint — this is a form and it was being drawn as a table:
   *
   * - *Add product* was in the card header, above a grid you read downwards,
   *   and mouse-only. It is under the last row now, where the next row is
   *   about to appear, and ⌘⏎ does the same from inside any cell.
   * - Qty collapsed to about one character when the window narrowed, with the
   *   stepper arrows sitting on what was left. `CountInput` holds three digits
   *   open and `EditableTable` stops the grid compressing at all.
   * - Below `md` the row becomes a card of labelled full-width fields rather
   *   than five slivers behind a sideways scroll.
   *
   * The empty state lost its own *Add product* button with the move: it was
   * repeated there (owner decision 2026-08-26) precisely BECAUSE the real one
   * was a whole table away, and two buttons a few pixels apart is worse than
   * the problem it solved.
   */
  const addLine = () => setLines((ls) => [...ls, { qty: 1 }]);
  const editLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((x, j) => (i === j ? { ...x, ...patch } : x)));

  const productStep = (
    <Card
      // Wider than FORM_CENTRE allows: this step is a line-item grid, not a
      // form read top to bottom, and five columns do not fit in a 720px
      // measure. Centred all the same.
      style={{ maxWidth: 1100, width: "100%", marginInline: "auto" }}
      title={t("inboundForm.products", "Products")}
    >
      <Typography.Paragraph type="secondary">
        Optional. If the goods have not arrived and nobody knows what was
        bought, leave this empty — the order saves anyway, and the products get
        added from the order page when the boxes land.
      </Typography.Paragraph>
      <EditableTable<Line>
        rowKey={(_, i) => String(i)}
        dataSource={lines}
        onAdd={addLine}
        addLabel={t("inboundForm.addProduct", "Add product")}
        emptyText={t(
          "inboundForm.noProductsYet",
          "No products yet. Add new or leave it as is",
        )}
        columns={[
          {
            title: t("inboundForm.product", "Product"),
            key: "product",
            // Fixed, like every other column here (owner complaint
            // 2026-09-01). A product label runs to seventy characters —
            // `PRO 13" 2016 i5 8/128 NTB — MacBook Pro 13 2016 i5 / 8GB /
            // 128GB / NTB` — and a column sized to fit one on a single line
            // took the room out of Qty and Total. It wraps to a second line in
            // its own cell instead; see `EditableTable`.
            width: 360,
            render: (_, l, i) => (
              <SkuPicker
                skus={db.skus}
                placeholder={t("inboundForm.pickAProduct", "Pick a product")}
                // The column header names this box for anyone reading the
                // screen; nothing names it for anyone hearing it.
                aria-label={t("inboundForm.product", "Product")}
                value={l.skuId}
                onChange={(v) => editLine(i, { skuId: v })}
              />
            ),
          },
          {
            title: t("inboundForm.qty", "Qty"),
            key: "qty",
            width: COUNT_COLUMN_WIDTH,
            render: (_, l, i) => (
              <CountInput
                min={1}
                precision={0}
                value={l.qty}
                aria-label={t("inboundForm.qty", "Qty")}
                // Empty is a state on the way to a number, not zero: clearing
                // the box to retype it must not silently make the line free.
                onChange={(v) => editLine(i, { qty: v ?? 1 })}
              />
            ),
          },
          {
            title: t("inboundForm.unitCost", "Unit cost"),
            key: "unitCost",
            width: 190,
            render: (_, l, i) => (
              <MoneyInput
                value={l.unitCost}
                aria-label={t("inboundForm.unitCost", "Unit cost")}
                onChange={(v) => editLine(i, { unitCost: v ?? undefined })}
              />
            ),
          },
          {
            // "Total", not "Line total" (owner decision 2026-08-26): the
            // column already sits inside a row, so "line" is a word the layout
            // is saying for it.
            title: t("inboundForm.total", "Total"),
            key: "total",
            align: "right",
            width: 150,
            render: (_, l) => fmtRp((l.unitCost ?? 0) * (l.qty || 0)),
          },
          {
            title: "",
            key: "remove",
            width: 48,
            render: (_, __, i) => (
              <Button
                type="text"
                icon={<DeleteOutlined />}
                aria-label={t("inboundForm.removeProduct", "Remove product")}
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
              />
            ),
          },
        ]}
      />
    </Card>
  );

  const reviewStep = (
    <Flex vertical gap={16} style={FORM_CENTRE}>
      <Card title={t("inboundForm.review", "Review")}>
        <Descriptions
          column={{ xs: 1, sm: 2 }}
          items={[
            {
              key: "s",
              label: t("inboundForm.supplier", "Supplier"),
              children: supplier ?? "—",
            },
            {
              key: "i",
              label: t("inboundForm.invoice", "Invoice"),
              children: noInvoice ? "No invoice" : invoice || "—",
            },
            {
              key: "d",
              label: t("inboundForm.ordered", "Ordered"),
              children: date?.format("DD MMM YYYY") ?? "—",
            },
            {
              key: "w",
              label: t("inboundForm.arrivingAt", "Arriving at"),
              children: db.warehouses.find((w) => w.id === warehouseId)?.name,
            },
            {
              key: "p",
              label: t("inboundForm.products", "Products"),
              children:
                lines.filter((l) => l.skuId).length === 0
                  ? "Not entered yet"
                  : `${lines.filter((l) => l.skuId).length} line(s)`,
            },
          ]}
        />
      </Card>
      {/* "Purchase", not "Money" (owner decision 2026-08-26). Every figure on
          this card is money; what tells it apart from the payment fields a
          step earlier is that these are the numbers of the PURCHASE. */}
      <Card title={t("inboundForm.purchase", "Purchase")}>
        <Flex
          vertical
          gap={8}
          style={{ maxWidth: 420, marginInline: "auto", width: "100%" }}
        >
          <Flex justify="space-between">
            <span>Subtotal</span>
            <span>{fmtRp(subtotal)}</span>
          </Flex>
          <Flex justify="space-between">
            <span>Shipping</span>
            <span>{fmtRp(shippingFee ?? 0)}</span>
          </Flex>
          <Flex justify="space-between">
            <span>Tax</span>
            <span>{fmtRp(taxFee ?? 0)}</span>
          </Flex>
          {/* Rupiah or per cent, the supplier's choice. See `discountMode`. */}
          <Form layout="vertical">
            <Form.Item
              label={t("inboundForm.discount", "Discount")}
              style={{ marginBottom: 0 }}
              extra={
                discountMode === "PCT" ? (
                  <span>
                    {t("inboundForm.pctOfSubtotal", "{{pct}}% of {{sub}}", {
                      pct: discountPct ?? 0,
                      sub: fmtRp(subtotal),
                    })}{" "}
                    = <strong>{fmtRp(discountRp)}</strong>
                  </span>
                ) : undefined
              }
            >
              <Flex gap={8} align="center" wrap>
                <Segmented<"RP" | "PCT">
                  value={discountMode}
                  onChange={setDiscountMode}
                  options={[
                    { value: "RP", label: RP_SYMBOL },
                    { value: "PCT", label: "%" },
                  ]}
                />
                {discountMode === "RP" ? (
                  <MoneyInput
                    style={{ flex: 1, minWidth: 160 }}
                    value={discount}
                    onChange={money(setDiscount)}
                  />
                ) : (
                  <InputNumber
                    min={0}
                    max={100}
                    precision={2}
                    suffix="%"
                    style={{ flex: 1, minWidth: 160 }}
                    aria-label={t(
                      "inboundForm.discountPercent",
                      "Discount percentage",
                    )}
                    value={discountPct}
                    onChange={(v) => setDiscountPct(v ?? undefined)}
                  />
                )}
              </Flex>
            </Form.Item>
          </Form>
          <Flex justify="space-between" style={{ fontWeight: 600 }}>
            <span>Invoiced total</span>
            <span>{fmtRp(total)}</span>
          </Flex>
          <Flex justify="space-between">
            <span>Paid now</span>
            <span>{fmtRp(paid ?? 0)}</span>
          </Flex>
          {outstanding > 0 && (
            <Flex justify="space-between">
              <Typography.Text type="danger">Still owed</Typography.Text>
              <Typography.Text type="danger">
                {fmtRp(outstanding)}
              </Typography.Text>
            </Flex>
          )}
          {total === 0 && (paid ?? 0) > 0 && (
            <Typography.Text type="secondary">
              Nothing invoiced yet — this records the transfer against the
              supplier until the products are known.
            </Typography.Text>
          )}
        </Flex>
      </Card>
    </Flex>
  );

  return (
    <PageContainer
      title={t("inboundForm.newInboundOrder", "New inbound order")}
      backTo="/inbound"
    >
      <Flex vertical gap={16}>
        {/*
         * Auto-save, said out loud (owner ask 2026-09-15).
         *
         * A form that silently refills itself is a form somebody saves twice:
         * they came to raise Tuesday's order and got Monday's, half-typed,
         * with no sign of where it came from. The banner names what happened
         * and offers the one thing the restore cannot guess — that they did
         * not want it.
         */}
        {restoreOffered && (
          <Alert
            type="info"
            showIcon
            closable
            onClose={() => setRestoreOffered(false)}
            title={t(
              "inboundForm.restoredTitle",
              "Picked up where you left off",
            )}
            description={t(
              "inboundForm.restoredBody",
              "This order was still being typed when the page last closed. Nothing has been saved to Inbound yet — press Save draft for that.",
            )}
            action={
              <Button
                size="small"
                onClick={() => {
                  clearStored();
                  setRestoreOffered(false);
                  // A reload rather than eleven setters: the form seeds itself
                  // from storage at mount, and mount is the only moment that
                  // can put every field back to its default at once.
                  navigate(0);
                }}
              >
                {t("inboundForm.startFresh", "Start a fresh order")}
              </Button>
            }
          />
        )}
        <Steps
          current={step}
          onChange={setStep}
          // Translated here rather than in the constant — see StockOutPage.
          items={STEPS.map((x) => ({ title: t(x.title) }))}
          // Every step is reachable. Only step 1 can block saving, and it says
          // so at the point of saving — gating navigation as well would stop
          // someone flicking to Review to check a number.
        />
        {step === 0 && orderStep}
        {step === 1 && productStep}
        {step === 2 && reviewStep}
      </Flex>

      <FooterToolbar
        info={
          <Typography.Text>
            {lines.filter((l) => l.skuId).length} product(s) ·{" "}
            <strong>{fmtRp(total)}</strong>
            {outstanding > 0 && (
              <Typography.Text type="danger">
                {" "}
                · {fmtRp(outstanding)} owed
              </Typography.Text>
            )}
          </Typography.Text>
        }
      >
        <Button
          onClick={() => {
            // Cancelling is a decision, so it takes the auto-saved copy with
            // it: offering to restore an order somebody just abandoned is the
            // banner that teaches people to ignore banners.
            clearStored();
            navigate("/inbound");
          }}
        >
          {t("inboundForm.cancel", "Cancel")}
        </Button>
        {step > 0 && (
          <Button onClick={() => setStep(step - 1)}>
            {t("inboundForm.back", "Back")}
          </Button>
        )}
        {/* On every step (owner ask 2026-09-15), because the reason to save a
            draft — the goods have not arrived, nobody knows the prices yet —
            turns up on step one as often as on step three. */}
        <Button icon={<SaveOutlined />} onClick={() => save("DRAFT")}>
          {t("inboundForm.saveDraft", "Save draft")}
        </Button>
        {step < STEPS.length - 1 && (
          <Button type="primary" onClick={() => setStep(step + 1)}>
            {t("inboundForm.next", "Next")}
          </Button>
        )}
        {step === STEPS.length - 1 && (
          <Button type="primary" onClick={() => save("ORDERED")}>
            {t("inboundForm.saveOrder", "Save order")}
          </Button>
        )}
      </FooterToolbar>
    </PageContainer>
  );
}
