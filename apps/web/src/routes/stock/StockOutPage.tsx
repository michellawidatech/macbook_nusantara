/**
 * Phase 3 — outbound. Sells specific serials. Price autofills from QC and can
 * be overwritten (the override is logged on the unit's timeline, and applies
 * to this transaction only). Shopee money stays pending until withdrawn.
 *
 * A sale can start from nothing or from a reservation. Starting from a
 * reservation is the common case for anything sold over chat: the unit and the
 * customer were agreed days ago, so re-picking them here is re-doing work the
 * shop already did — and re-doing it is where the wrong serial gets sold.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  App,
  Alert,
  Button,
  Card,
  Checkbox,
  Flex,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  ArrowUpOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  GiftOutlined,
  PlusOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { FooterToolbar } from "../../components/FooterToolbar";
import { MoneyInput } from "../../components/MoneyInput";
import { InvoiceModal } from "../../components/Invoice";
import { fmtRp, fmtDateTime } from "../../lib/format.js";
import {
  bundleProgress,
  describeDiscount,
  discountAmount,
  isRedeemable,
  unusedBundles,
  type BasketLine,
} from "../../lib/pricing.js";
import { recommendFor } from "../../lib/recommend.js";
import {
  useDb,
  mutate,
  nextId,
  docCode,
  appendEvent,
} from "../../mock/store.js";
import type { Order } from "../../mock/seed.js";

interface Line {
  serial?: string;
  price?: number;
}

const SOURCES = [
  { value: "OFFLINE", label: "Offline (store)" },
  { value: "SHOPEE", label: "Shopee" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "WHATSAPP", label: "WhatsApp" },
] as const;
type SourceValue = (typeof SOURCES)[number]["value"];

/**
 * A reservation's channel maps onto the sale's channel where the two mean the
 * same thing. Anything else (a walk-in, a marketplace we don't record sales
 * against) leaves the sale source alone rather than guessing.
 */
const SOURCE_BY_RESERVATION: Record<string, SourceValue> = {
  Instagram: "INSTAGRAM",
  WhatsApp: "WHATSAPP",
  Shopee: "SHOPEE",
  "Walk-in": "OFFLINE",
};

export function StockOutPage() {
  const db = useDb();
  const { message } = App.useApp();
  const [params, setParams] = useSearchParams();
  const [lines, setLines] = useState<Line[]>([
    { serial: params.get("serial") ?? undefined },
  ]);
  const [customerId, setCustomerId] = useState<string>();
  const [discountMode, setDiscountMode] = useState<
    "NONE" | "PCT" | "NOMINAL" | "RULE"
  >("NONE");
  const [discountPct, setDiscountPct] = useState<number>();
  const [discountRp, setDiscountRp] = useState<number>();
  const [discountId, setDiscountId] = useState<string>();
  const [source, setSource] = useState<SourceValue>("OFFLINE");
  const [referralId, setReferralId] = useState<string>();
  const [shipped, setShipped] = useState(false);
  const [address, setAddress] = useState("");
  const [payMethod, setPayMethod] = useState("Cash");
  const [salesmanId, setSalesmanId] = useState<string>();
  /**
   * The sale that was just recorded, held only so its invoice can be offered.
   * Cleared when the modal closes — the order itself lives in the store, and
   * keeping a second copy around after the print would be two sources of truth
   * for one receipt.
   */
  const [invoiceFor, setInvoiceFor] = useState<Order | null>(null);
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [reservationPickerOpen, setReservationPickerOpen] = useState(false);
  /** Reservations this sale is fulfilling, so submitting can close them. */
  const [fromReservations, setFromReservations] = useState<string[]>([]);
  const [ncForm] = Form.useForm<{ name: string; phone: string }>();

  const sellable = useMemo(
    () =>
      db.units.filter(
        (u) => u.status === "TERSEDIA" || u.status === "DIRESERVASI",
      ),
    [db.units],
  );
  const activeReservations = useMemo(
    () => db.reservations.filter((r) => r.status === "ACTIVE"),
    [db.reservations],
  );

  const skuOf = (serial?: string) =>
    db.skus.find(
      (s) => s.id === db.units.find((u) => u.serial === serial)?.skuId,
    );
  const unitOption = (u: (typeof sellable)[number]) => {
    const sku = db.skus.find((s) => s.id === u.skuId)!;
    return {
      value: u.serial,
      label: `${u.serial} — ${sku.name} ${sku.variantLabel}${u.status === "DIRESERVASI" ? " (reserved)" : ""}`,
    };
  };

  /**
   * Fill the form from one or more reservations: the units become the lines,
   * the customer becomes the sale's customer, and the reservation's channel
   * becomes the sale's channel where the two agree. Prices are left to autofill
   * from the unit, exactly as a hand-picked line does.
   *
   * Prefill only ever *fills blanks*. If the operator already picked a customer
   * it is not overwritten — a prefill that clobbers a deliberate choice is
   * worse than no prefill.
   */
  const applyReservations = (ids: string[]) => {
    const picked = db.reservations.filter(
      (r) => ids.includes(r.id) && r.status === "ACTIVE",
    );
    if (!picked.length) return;
    setLines((prev) => {
      const kept = prev.filter(
        (l) => l.serial && !picked.some((r) => r.serial === l.serial),
      );
      return [...kept, ...picked.map((r) => ({ serial: r.serial }))];
    });
    setCustomerId((prev) => prev ?? picked[0]!.customerId);
    const channel = db.reservationSources.find(
      (s) => s.id === picked[0]!.sourceId,
    )?.name;
    const mapped = channel ? SOURCE_BY_RESERVATION[channel] : undefined;
    if (mapped) setSource((prev) => (prev === "OFFLINE" ? mapped : prev));
    setFromReservations((prev) => [
      ...new Set([...prev, ...picked.map((r) => r.id)]),
    ]);
    setReservationPickerOpen(false);
    message.success(
      picked.length === 1
        ? `Loaded reservation for ${picked[0]!.serial}.`
        : `Loaded ${picked.length} reservations.`,
    );
  };

  // Arriving from the Reservations page's "sell this now" button. The param is
  // cleared once consumed so a refresh does not re-apply it over later edits.
  const reservationParam = params.get("reservation");
  useEffect(() => {
    if (!reservationParam) return;
    applyReservations([reservationParam]);
    const next = new URLSearchParams(params);
    next.delete("reservation");
    setParams(next, { replace: true });
    // Runs once per distinct incoming id; `applyReservations` reads fresh state
    // through the setter callbacks above rather than closing over it.
  }, [reservationParam]);

  const priceOf = (serial?: string) =>
    db.units.find((u) => u.serial === serial)?.price ?? undefined;

  /**
   * The basket, resolved to the prices that will actually be charged.
   *
   * Bundle discounts need to know WHICH units are being bought, not merely what
   * they add up to, so the basket — not the subtotal — is what the pricing
   * rules are handed.
   */
  const basket: BasketLine[] = useMemo(
    () =>
      lines
        .filter((l) => l.serial)
        .map((l) => ({
          serial: l.serial!,
          price: l.price ?? priceOf(l.serial) ?? 0,
        })),
    [lines, db.units],
  );
  const subtotal = basket.reduce((t, l) => t + l.price, 0);
  const rule = db.discounts.find((x) => x.id === discountId);
  const discountValue = (() => {
    if (discountMode === "PCT")
      return Math.min(
        Math.round((subtotal * (discountPct ?? 0)) / 100),
        subtotal,
      );
    if (discountMode === "NOMINAL") return Math.min(discountRp ?? 0, subtotal);
    if (discountMode === "RULE") return discountAmount(db, rule, basket);
    return 0;
  })();
  const total = subtotal - discountValue;

  /** How the chosen bundle is landing, so the form can narrate it. */
  const chosenBundle =
    rule?.type === "BUNDLE" ? bundleProgress(db, rule, basket) : null;
  /** Live bundles this basket already earns but has not claimed. */
  const missedBundles = useMemo(
    () =>
      unusedBundles(
        db,
        basket,
        discountMode === "RULE" ? discountId : undefined,
      ),
    [db.discounts, basket, discountMode, discountId],
  );
  const suggestions = useMemo(() => recommendFor(db, basket), [db, basket]);

  const submit = () => {
    const chosen = lines.filter((l) => l.serial);
    if (chosen.length === 0)
      return void message.warning("Pick at least one unit from inventory.");
    // Required, not optional: an unattributed sale is a hole in every per-staff
    // figure built on this column afterwards, and there is no way to fill it in
    // six months later.
    if (!salesmanId)
      return void message.warning(
        "Pick who made this sale — the staff figures are built on it.",
      );
    if (shipped && !address.trim())
      return void message.warning("Add the shipping address.");

    // The order is built BEFORE the mutation rather than inside it, because the
    // invoice needs the very row that was written. Reaching back into the store
    // for "the newest order" would be a guess that a second till could break.
    const code = docCode("SI");
    const prices: Record<string, number> = {};
    for (const l of chosen)
      prices[l.serial!] = l.price ?? priceOf(l.serial) ?? 0;
    const order: Order = {
      id: nextId("o"),
      code,
      ts: new Date().toISOString(),
      customerId: customerId ?? null,
      serials: chosen.map((l) => l.serial!),
      prices,
      discount: discountValue,
      discountId: discountMode === "RULE" ? discountId : undefined,
      source,
      salesmanId,
      referralSourceId: referralId,
      shippingAddress: shipped ? address.trim() : undefined,
      payMethod: source === "SHOPEE" ? "Shopee (escrow)" : payMethod,
      settled: source !== "SHOPEE",
      total,
      reservationId: fromReservations[0],
    };

    let closed = 0;
    mutate((d) => {
      for (const l of chosen) {
        const unit = d.units.find((u) => u.serial === l.serial)!;
        const price = prices[l.serial!]!;
        if (unit.price !== null && price !== unit.price) {
          appendEvent(d, l.serial!, {
            type: "DICATAT",
            note: `Price override on ${code}: ${fmtRp(unit.price)} → ${fmtRp(price)} (this transaction only)`,
          });
        }
        // A sold unit closes its hold, whether the sale started from the
        // reservation picker or the operator simply picked the reserved serial.
        const rsv = d.reservations.find(
          (r) => r.serial === l.serial && r.status === "ACTIVE",
        );
        if (rsv) {
          rsv.status = "DONE";
          closed += 1;
        }
        appendEvent(d, l.serial!, {
          type: "TERJUAL",
          toStatus: "TERJUAL",
          refCode: code,
        });
      }
      if (discountMode === "RULE" && rule) {
        const r = d.discounts.find((x) => x.id === rule.id);
        if (r) r.used += 1;
      }
      d.orders.unshift(order);
    });
    message.success(
      [
        "Sale recorded.",
        closed > 0 && `${closed} reservation(s) marked as bought.`,
        source === "SHOPEE" &&
          "Shopee money is pending until you confirm the withdrawal in Cashflow.",
      ]
        .filter(Boolean)
        .join(" "),
    );
    // Offer the invoice rather than printing it: plenty of sales do not want
    // paper, and a print dialog nobody asked for is a dialog people learn to
    // dismiss without reading.
    setInvoiceFor(order);
    setLines([{}]);
    setCustomerId(undefined);
    setDiscountMode("NONE");
    setDiscountId(undefined);
    setShipped(false);
    setAddress("");
    setFromReservations([]);
  };

  /** Put a recommended unit on the sale as a new line. */
  const addSuggestion = (serial: string) => {
    setLines((prev) => [...prev.filter((l) => l.serial), { serial }]);
    message.success(`${serial} added to the sale.`);
  };

  return (
    <PageContainer title="Stock Out">
      <Flex vertical gap={16} style={{ flex: 1 }}>
        {fromReservations.length > 0 && (
          <Alert
            type="info"
            showIcon
            title={`This sale closes ${fromReservations.length} reservation(s).`}
            description="Recording it marks those units as bought and releases the hold."
            closable
            onClose={() => setFromReservations([])}
          />
        )}

        {missedBundles.map(({ discount, progress }) => (
          <Alert
            key={discount.id}
            type="success"
            showIcon
            icon={<GiftOutlined />}
            title={`This basket qualifies for ${discount.code} — ${discount.name}.`}
            description={`${progress.complete} bundle(s) of ${progress.perBundle}, worth ${fmtRp(progress.saving)} off. It is not applied yet.`}
            action={
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  setDiscountMode("RULE");
                  setDiscountId(discount.id);
                }}
              >
                Apply it
              </Button>
            }
          />
        ))}

        <Card
          title="Items"
          extra={
            <Tooltip
              title={
                activeReservations.length
                  ? "Load a unit and customer from a reservation"
                  : "Nothing is on hold right now"
              }
            >
              <Button
                icon={<ClockCircleOutlined />}
                disabled={activeReservations.length === 0}
                onClick={() => setReservationPickerOpen(true)}
              >
                Pick from reservations ({activeReservations.length})
              </Button>
            </Tooltip>
          }
        >
          <Table
            rowKey={(_, i) => String(i)}
            dataSource={lines}
            pagination={false}
            columns={[
              {
                title: "Unit (serial in inventory)",
                render: (_, l, i) => (
                  <Select
                    showSearch
                    style={{ width: "100%" }}
                    value={l.serial}
                    optionFilterProp="label"
                    placeholder="Search serial, model or variant"
                    options={sellable
                      .filter(
                        (u) =>
                          u.serial === l.serial ||
                          !lines.some((x) => x.serial === u.serial),
                      )
                      .map(unitOption)}
                    onChange={(v) =>
                      setLines(
                        lines.map((x, j) =>
                          j === i ? { serial: v, price: undefined } : x,
                        ),
                      )
                    }
                  />
                ),
              },
              {
                title: "Description",
                width: 260,
                render: (_, l) => (
                  <Typography.Text type="secondary">
                    {db.units.find((u) => u.serial === l.serial)?.description ??
                      "—"}
                  </Typography.Text>
                ),
              },
              {
                title: "Price",
                width: 220,
                render: (_, l, i) => (
                  <MoneyInput
                    value={l.price ?? priceOf(l.serial)}
                    disabled={!l.serial}
                    onChange={(v) =>
                      setLines(
                        lines.map((x, j) =>
                          j === i ? { ...x, price: v ?? undefined } : x,
                        ),
                      )
                    }
                  />
                ),
              },
              {
                title: "",
                width: 46,
                render: (_, _l, i) => (
                  <Tooltip title="Remove this line">
                    <Button
                      type="text"
                      danger
                      aria-label="Remove this line"
                      icon={<DeleteOutlined />}
                      disabled={lines.length === 1}
                      onClick={() => setLines(lines.filter((_, j) => j !== i))}
                    />
                  </Tooltip>
                ),
              },
            ]}
          />
          <Button
            type="dashed"
            block
            icon={<PlusOutlined />}
            style={{ marginTop: 12 }}
            onClick={() => setLines([...lines, {}])}
          >
            Add a unit
          </Button>
        </Card>

        {suggestions.length > 0 && (
          <Card
            title="Worth offering with this sale"
            extra={
              <Typography.Text type="secondary">
                From what is on the shelf and what has sold together before
              </Typography.Text>
            }
          >
            <Table
              rowKey="serial"
              dataSource={suggestions}
              pagination={false}
              size="small"
              columns={[
                {
                  title: "",
                  width: 108,
                  render: (_, r) =>
                    r.kind === "UPGRADE" ? (
                      <Tag color="geekblue" icon={<ArrowUpOutlined />}>
                        Upgrade
                      </Tag>
                    ) : (
                      <Tag color="purple" icon={<GiftOutlined />}>
                        Add-on
                      </Tag>
                    ),
                },
                {
                  title: "Unit",
                  render: (_, r) => (
                    <>
                      <strong>
                        {r.title} {r.variant}
                      </strong>
                      <div>
                        <Typography.Text type="secondary">
                          {r.serial}
                          {r.description ? ` · ${r.description}` : ""}
                        </Typography.Text>
                      </div>
                    </>
                  ),
                },
                {
                  title: "Why",
                  width: 300,
                  render: (_, r) => (
                    <>
                      <Typography.Text type="secondary">
                        {r.why}
                      </Typography.Text>
                      {r.bundleNote && (
                        <div>
                          <Typography.Text type="success">
                            {r.bundleNote}
                          </Typography.Text>
                        </div>
                      )}
                    </>
                  ),
                },
                {
                  title: "Price",
                  width: 140,
                  align: "right",
                  render: (_, r) => fmtRp(r.price),
                },
                {
                  title: "",
                  width: 110,
                  render: (_, r) => (
                    <Button
                      size="small"
                      onClick={() => addSuggestion(r.serial)}
                    >
                      Add to sale
                    </Button>
                  ),
                },
              ]}
            />
            <Typography.Paragraph
              type="secondary"
              style={{ marginTop: 12, marginBottom: 0 }}
            >
              An upgrade is the same kind of thing, one step dearer. An add-on
              is something else entirely — ranked by what past receipts actually
              carried together, and by whether it completes a bundle. Every row
              is a real serial in stock at the price shown.
            </Typography.Paragraph>
          </Card>
        )}

        <Card title="Sale details">
          <Form layout="vertical" style={{ maxWidth: 720 }}>
            <Flex gap={12} align="end">
              <Form.Item label="Customer" style={{ flex: 1 }}>
                <Select
                  showSearch
                  allowClear
                  value={customerId}
                  optionFilterProp="label"
                  placeholder="Search name or phone"
                  options={db.customers.map((c) => ({
                    value: c.id,
                    label: `${c.name} · ${c.phone}`,
                  }))}
                  onChange={setCustomerId}
                />
              </Form.Item>
              <Form.Item label=" ">
                <Button
                  icon={<UserAddOutlined />}
                  onClick={() => setNewCustomerOpen(true)}
                >
                  Add customer
                </Button>
              </Form.Item>
            </Flex>
            <Form.Item label="Discount">
              <Flex gap={12} wrap>
                <Radio.Group
                  value={discountMode}
                  onChange={(e) => setDiscountMode(e.target.value)}
                  options={[
                    { value: "NONE", label: "None" },
                    { value: "PCT", label: "%" },
                    { value: "NOMINAL", label: "Amount" },
                    { value: "RULE", label: "Discount code" },
                  ]}
                  optionType="button"
                />
                {discountMode === "PCT" && (
                  <Input
                    type="number"
                    suffix="%"
                    style={{ width: 110 }}
                    value={discountPct}
                    onChange={(e) =>
                      setDiscountPct(Number(e.target.value) || undefined)
                    }
                  />
                )}
                {discountMode === "NOMINAL" && (
                  <MoneyInput
                    style={{ width: 200 }}
                    value={discountRp}
                    onChange={(v) => setDiscountRp(v ?? undefined)}
                  />
                )}
                {discountMode === "RULE" && (
                  <Select
                    style={{ width: 340 }}
                    value={discountId}
                    placeholder="Pick a discount"
                    // Only what can actually be redeemed today. Offering an
                    // expired or used-up code and then quietly taking nothing
                    // off is how a till argument starts.
                    options={db.discounts
                      .filter((x) => isRedeemable(x))
                      .map((x) => ({
                        value: x.id,
                        label: `${x.code} — ${describeDiscount(x)}`,
                      }))}
                    onChange={setDiscountId}
                  />
                )}
              </Flex>
              {chosenBundle && (
                <Typography.Text
                  type={chosenBundle.complete > 0 ? "success" : "warning"}
                >
                  {chosenBundle.complete > 0
                    ? `${chosenBundle.complete} × ${rule!.code} on ${chosenBundle.qualifying} qualifying unit(s) — ${fmtRp(chosenBundle.saving)} off. Bundles take the dearest units first.`
                    : `Nothing yet — ${rule!.code} needs ${chosenBundle.shortBy || chosenBundle.perBundle} more unit(s) from "${rule!.scope}" on this sale.`}
                </Typography.Text>
              )}
            </Form.Item>
            <Flex gap={12} wrap>
              <Form.Item
                label="Salesperson"
                required
                style={{ width: 220 }}
                tooltip="Who gets credit for this sale. Managed in Settings → Salespeople."
              >
                <Select
                  showSearch
                  value={salesmanId}
                  optionFilterProp="label"
                  placeholder="Who made this sale?"
                  options={db.salesmen
                    .filter((x) => x.active)
                    .map((x) => ({ value: x.id, label: x.name }))}
                  onChange={setSalesmanId}
                />
              </Form.Item>
              <Form.Item label="Source" required style={{ width: 220 }}>
                <Select
                  value={source}
                  options={[...SOURCES]}
                  onChange={setSource}
                />
              </Form.Item>
              <Form.Item label="Referral" style={{ width: 220 }}>
                <Select
                  allowClear
                  value={referralId}
                  placeholder="Where did they hear of us?"
                  options={db.referralSources
                    .filter((r) => r.active)
                    .map((r) => ({ value: r.id, label: r.name }))}
                  onChange={setReferralId}
                />
              </Form.Item>
              {source !== "SHOPEE" && (
                <Form.Item label="Payment method" style={{ width: 200 }}>
                  <Select
                    value={payMethod}
                    options={["Cash", "QRIS", "Transfer", "Debit"].map((m) => ({
                      value: m,
                      label: m,
                    }))}
                    onChange={setPayMethod}
                  />
                </Form.Item>
              )}
            </Flex>
            {source === "SHOPEE" && (
              <Typography.Paragraph type="warning">
                Shopee holds the money in escrow — this sale is recorded as
                pending in Cashflow until you confirm the withdrawal.
              </Typography.Paragraph>
            )}
            <Form.Item>
              <Checkbox
                checked={shipped}
                onChange={(e) => setShipped(e.target.checked)}
              >
                This order is shipped
              </Checkbox>
            </Form.Item>
            {shipped && (
              <Form.Item label="Shipping address" required>
                <Input.TextArea
                  rows={2}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </Form.Item>
            )}
          </Form>
        </Card>

        <FooterToolbar
          info={
            <Typography.Text>
              Subtotal {fmtRp(subtotal)} · Discount {fmtRp(discountValue)} ·{" "}
              <strong>Total {fmtRp(total)}</strong>
            </Typography.Text>
          }
        >
          <Button type="primary" onClick={submit}>
            Record sale
          </Button>
        </FooterToolbar>
      </Flex>

      <InvoiceModal
        db={db}
        {...(invoiceFor ? { order: invoiceFor } : {})}
        open={invoiceFor !== null}
        onClose={() => setInvoiceFor(null)}
        headline="The sale is already recorded. Print this now, or find it again later under Finance → Transaction History."
      />

      <Modal
        title="Sell from a reservation"
        open={reservationPickerOpen}
        onCancel={() => setReservationPickerOpen(false)}
        footer={null}
        width={860}
      >
        <Typography.Paragraph type="secondary">
          Picking one loads its unit and customer into the sale below. The hold
          is released when you record the sale, not now.
        </Typography.Paragraph>
        <ProTable
          rowKey="id"
          dataSource={activeReservations}
          searchPlaceholder="Search serial, product or customer"
          cards={false}
          columns={[
            { title: "Serial", dataIndex: "serial", searchable: true },
            {
              title: "Product",
              key: "product",
              searchable: true,
              facet: true,
              sortValue: (r) =>
                `${skuOf(r.serial)?.name ?? "?"} ${skuOf(r.serial)?.variantLabel ?? ""}`,
              render: (_, r) =>
                `${skuOf(r.serial)?.name ?? "?"} ${skuOf(r.serial)?.variantLabel ?? ""}`,
            },
            {
              title: "Customer",
              key: "customer",
              searchable: true,
              sortValue: (r) =>
                db.customers.find((c) => c.id === r.customerId)?.name,
              render: (_, r) =>
                db.customers.find((c) => c.id === r.customerId)?.name,
            },
            {
              title: "Came from",
              key: "source",
              facet: true,
              sortValue: (r) =>
                db.reservationSources.find((s) => s.id === r.sourceId)?.name ??
                "—",
              render: (_, r) => {
                const name = db.reservationSources.find(
                  (s) => s.id === r.sourceId,
                )?.name;
                return name ? <Tag>{name}</Tag> : "—";
              },
            },
            { title: "Hold until", dataIndex: "when", render: fmtDateTime },
            {
              title: "Price",
              key: "price",
              align: "right",
              sortValue: (r) => priceOf(r.serial) ?? 0,
              render: (_, r) => fmtRp(priceOf(r.serial)),
            },
            {
              title: "",
              key: "actions",
              width: 90,
              render: (_, r) => (
                <Button
                  type="primary"
                  size="small"
                  onClick={() => applyReservations([r.id])}
                >
                  Use this
                </Button>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        title="Add customer"
        open={newCustomerOpen}
        onCancel={() => setNewCustomerOpen(false)}
        onOk={() =>
          ncForm.validateFields().then((v) => {
            const id = nextId("c");
            mutate((d) => {
              d.customers.push({
                id,
                name: v.name,
                phone: v.phone,
                createdAt: new Date().toISOString(),
              });
            });
            setCustomerId(id);
            setNewCustomerOpen(false);
            ncForm.resetFields();
            message.success(`${v.name} added.`);
          })
        }
      >
        <Form form={ncForm} layout="vertical">
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="phone"
            label="Phone number"
            rules={[{ required: true }]}
          >
            <Input placeholder="+62…" />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
