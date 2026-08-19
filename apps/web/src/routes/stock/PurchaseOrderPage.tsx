/**
 * Phase 1 — initialize inbound. Multistep page form (never a modal):
 * supplier & invoice → lines → optional payment → review. Saving creates the
 * PO and puts every line into QC (Stock In) where the lifecycle starts.
 */
import { useMemo, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import {
  App,
  AutoComplete,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Flex,
  Form,
  Input,
  Select,
  Steps,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { FooterToolbar } from "../../components/FooterToolbar";
import { MoneyInput } from "../../components/MoneyInput";
import { fmtRp, fmtDate } from "../../lib/format.js";
import {
  useDb,
  mutate,
  nextId,
  docCode,
  appendEvent,
} from "../../mock/store.js";

interface Line {
  skuId?: string;
  serial?: string;
  qty: number;
  unitCost?: number;
}
interface Pay {
  method?: string;
  /**
   * No "amount paid" — the owner removed it. What a PO cost is the sum of its
   * lines plus this fee; a second, separately typed number could only ever
   * disagree with that.
   */
  fee?: number;
}

const PAY_METHODS = [
  "Cash",
  "Transfer BCA",
  "Transfer Mandiri",
  "QRIS",
  "Tempo 30d",
];

const STEPS = [
  { title: "Supplier" },
  { title: "Products" },
  { title: "Payment" },
  { title: "Review" },
];

export function PurchaseOrderPage() {
  const db = useDb();
  const { message } = App.useApp();
  const [step, setStep] = useState(0);
  const [header, setHeader] = useState<{
    supplier?: string;
    invoice?: string;
    date?: Dayjs;
  }>({
    date: dayjs(),
  });
  const [lines, setLines] = useState<Line[]>([{ qty: 1 }]);
  const [pay, setPay] = useState<Pay>({});

  const skuOptions = useMemo(
    () =>
      db.skus.map((s) => ({
        value: s.id,
        label: `${s.name} — ${s.variantLabel}`,
      })),
    [db.skus],
  );

  const total =
    lines.reduce((t, l) => t + (l.unitCost ?? 0) * l.qty, 0) + (pay.fee ?? 0);

  const validStep = (i: number): string | null => {
    if (i === 0 && !header.supplier?.trim()) return "Pick or type a supplier.";
    if (i === 0 && !header.date) return "Pick the purchase date.";
    if (i === 1 && !lines.some((l) => l.skuId && l.unitCost)) {
      return "Add at least one product with its unit price.";
    }
    // Step 2 (payment) is optional by design, so it never blocks the way
    // forward — which is also why step 3 is reachable straight from step 1.
    return null;
  };

  /**
   * The first step that is not yet filled in, or `STEPS.length` when they all
   * are. Everything at or before this index is reachable by clicking the
   * stepper; everything past it is not, because a later step would be reading
   * an answer nobody has given yet.
   */
  const firstIncomplete = useMemo(() => {
    for (let i = 0; i < STEPS.length; i += 1) {
      if (validStep(i)) return i;
    }
    return STEPS.length;
  }, [header, lines]);

  /**
   * Backwards is always allowed — going back to change an answer is not a
   * request to re-validate the answer you are leaving. Forwards is allowed only
   * as far as the last complete step, and the blocking step's own message is
   * what gets shown, so "why can't I click Review" has an answer on screen.
   */
  const goTo = (to: number) => {
    if (to <= step) return setStep(to);
    for (let i = step; i < to; i += 1) {
      const err = validStep(i);
      if (err) {
        setStep(i);
        return void message.warning(`${STEPS[i]!.title}: ${err}`);
      }
    }
    setStep(to);
  };

  const save = () => {
    mutate((d) => {
      let sup = d.suppliers.find(
        (s) => s.name.toLowerCase() === header.supplier!.trim().toLowerCase(),
      );
      if (!sup) {
        // Free-text supplier is saved automatically for future POs.
        sup = { id: nextId("sup"), name: header.supplier!.trim() };
        d.suppliers.push(sup);
      }
      const po = {
        id: nextId("po"),
        code: docCode("PI"),
        supplierId: sup.id,
        invoice: header.invoice ?? "",
        date: header.date!.format("YYYY-MM-DD"),
        locationId: d.myWarehouseId,
        items: [] as (typeof d.pos)[number]["items"],
        payments: pay.method ? [{ method: pay.method, fee: pay.fee ?? 0 }] : [],
        status: "RECEIVED" as const,
      };
      for (const l of lines) {
        if (!l.skuId || !l.unitCost) continue;
        for (let q = 0; q < l.qty; q += 1) {
          const serial =
            l.qty === 1 && l.serial?.trim()
              ? l.serial.trim()
              : `TBD-${nextId("sn").slice(3)}`;
          po.items.push({
            id: nextId("poi"),
            skuId: l.skuId,
            serial,
            qty: 1,
            unitCost: l.unitCost,
          });
          d.units.push({
            serial,
            skuId: l.skuId,
            status: "QC",
            locationId: d.myWarehouseId,
            buy: l.unitCost,
            price: null,
            description: "",
            poId: po.id,
          });
          appendEvent(d, serial, {
            type: "DITERIMA",
            toStatus: "QC",
            note: `Arrived on ${po.code}`,
          });
        }
      }
      d.pos.unshift(po);
    });
    message.success("PO saved — units are waiting in Stock In (QC).");
    setStep(0);
    setHeader({ date: dayjs() });
    setLines([{ qty: 1 }]);
    setPay({});
  };

  const newPo = (
    <Flex vertical gap={16} style={{ flex: 1 }}>
      <Steps
        size="small"
        current={step}
        onChange={goTo}
        style={{ maxWidth: 720 }}
        items={STEPS.map((s, i) => ({
          title: s.title,
          // A step past the first gap is not clickable, and antd greys a
          // disabled step — so the stepper shows how far the form has got
          // without anyone reading a message about it.
          disabled: i > Math.max(step, firstIncomplete),
        }))}
      />
      {step === 0 && (
        <Card title="Purchase details">
          <Form layout="vertical" style={{ maxWidth: 520 }}>
            <Form.Item
              label="Supplier"
              required
              tooltip="Free text is saved as a new supplier"
            >
              <AutoComplete
                value={header.supplier}
                onChange={(v) => setHeader({ ...header, supplier: v })}
                options={db.suppliers.map((s) => ({ value: s.name }))}
                filterOption={(input, opt) =>
                  (opt?.value as string)
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
                placeholder="Search or type a new supplier name"
              />
            </Form.Item>
            <Form.Item label="PO / seller invoice number">
              <Input
                value={header.invoice}
                onChange={(e) =>
                  setHeader({ ...header, invoice: e.target.value })
                }
                placeholder="e.g. INV/MJ/0815"
              />
            </Form.Item>
            <Form.Item label="Date of purchase" required>
              <DatePicker
                value={header.date}
                onChange={(v) => setHeader({ ...header, date: v ?? undefined })}
                format="DD MM YYYY"
                style={{ width: 200 }}
              />
            </Form.Item>
          </Form>
        </Card>
      )}
      {step === 1 && (
        <Card title="Products bought">
          <Table
            rowKey={(_, i) => String(i)}
            dataSource={lines}
            pagination={false}
            size="middle"
            columns={[
              {
                title: "Product & variant",
                width: 340,
                render: (_, l, i) => (
                  <Select
                    showSearch
                    style={{ width: "100%" }}
                    value={l.skuId}
                    options={skuOptions}
                    optionFilterProp="label"
                    placeholder="Search product"
                    onChange={(v) =>
                      setLines(
                        lines.map((x, j) => (j === i ? { ...x, skuId: v } : x)),
                      )
                    }
                  />
                ),
              },
              {
                title: "Serial number (optional)",
                render: (_, l, i) => (
                  <Input
                    value={l.serial}
                    disabled={l.qty > 1}
                    placeholder={
                      l.qty > 1 ? "Enter serials at QC" : "Scan or type"
                    }
                    onChange={(e) =>
                      setLines(
                        lines.map((x, j) =>
                          j === i ? { ...x, serial: e.target.value } : x,
                        ),
                      )
                    }
                  />
                ),
              },
              {
                title: "Qty",
                width: 90,
                render: (_, l, i) => (
                  <Input
                    type="number"
                    min={1}
                    value={l.qty}
                    onChange={(e) =>
                      setLines(
                        lines.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                qty: Math.max(1, Number(e.target.value) || 1),
                              }
                            : x,
                        ),
                      )
                    }
                  />
                ),
              },
              {
                title: "Price / unit",
                width: 220,
                render: (_, l, i) => (
                  <MoneyInput
                    value={l.unitCost}
                    onChange={(v) =>
                      setLines(
                        lines.map((x, j) =>
                          j === i ? { ...x, unitCost: v ?? undefined } : x,
                        ),
                      )
                    }
                  />
                ),
              },
              {
                title: "Subtotal",
                width: 140,
                align: "right" as const,
                render: (_, l) => fmtRp((l.unitCost ?? 0) * l.qty),
              },
              {
                width: 50,
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
            onClick={() => setLines([...lines, { qty: 1 }])}
          >
            Add a product
          </Button>
        </Card>
      )}
      {step === 2 && (
        <Card title="Payment (optional)">
          <Form layout="vertical" style={{ maxWidth: 520 }}>
            <Form.Item label="Method">
              <AutoComplete
                value={pay.method}
                onChange={(v) => setPay({ ...pay, method: v })}
                options={PAY_METHODS.map((m) => ({ value: m }))}
                placeholder="Search or type a method"
              />
            </Form.Item>
            <Form.Item
              label="Additional fee"
              tooltip="Freight, admin, or transfer fee"
            >
              <MoneyInput
                value={pay.fee}
                onChange={(v) => setPay({ ...pay, fee: v ?? undefined })}
              />
            </Form.Item>
            <Typography.Text type="secondary">
              What the PO cost is the sum of its lines plus this fee —{" "}
              {fmtRp(total)}.
            </Typography.Text>
          </Form>
        </Card>
      )}
      {step === 3 && (
        <Card title="Review">
          <Descriptions
            column={2}
            items={[
              { key: "s", label: "Supplier", children: header.supplier },
              { key: "i", label: "Invoice", children: header.invoice || "—" },
              {
                key: "d",
                label: "Date",
                children: header.date?.format("DD MMM YYYY"),
              },
              {
                key: "w",
                label: "Receive into",
                children: db.warehouses.find((w) => w.id === db.myWarehouseId)
                  ?.name,
              },
              {
                key: "p",
                label: "Payment method",
                children: pay.method || "—",
              },
              {
                key: "f",
                label: "Additional fee",
                children: fmtRp(pay.fee ?? 0),
              },
            ]}
          />
          <Table
            style={{ marginTop: 16 }}
            rowKey={(_, i) => String(i)}
            size="small"
            pagination={false}
            dataSource={lines.filter((l) => l.skuId)}
            columns={[
              {
                title: "Product",
                render: (_, l: Line) =>
                  skuOptions.find((o) => o.value === l.skuId)?.label,
              },
              {
                title: "Serial",
                dataIndex: "serial",
                render: (v: string) => v || <Tag>at QC</Tag>,
              },
              { title: "Qty", dataIndex: "qty", width: 70 },
              {
                title: "Price / unit",
                width: 150,
                align: "right",
                render: (_, l: Line) => fmtRp(l.unitCost ?? 0),
              },
            ]}
          />
        </Card>
      )}
      <FooterToolbar
        info={
          <Typography.Text>
            {lines.filter((l) => l.skuId).length} product(s) ·{" "}
            <strong>Total {fmtRp(total)}</strong>
          </Typography.Text>
        }
      >
        {step > 0 && <Button onClick={() => goTo(step - 1)}>Back</Button>}
        {step < 3 && (
          <Button type="primary" onClick={() => goTo(step + 1)}>
            Next
          </Button>
        )}
        {step === 3 && (
          <Button type="primary" onClick={save}>
            Save PO
          </Button>
        )}
      </FooterToolbar>
    </Flex>
  );

  const history = (
    <Card>
      <ProTable
        rowKey="id"
        dataSource={db.pos}
        searchPlaceholder="Search PO number, supplier or invoice"
        columns={[
          {
            title: "PO number",
            dataIndex: "code",
            searchable: true,
            defaultSortOrder: "descend",
          },
          {
            title: "Supplier",
            key: "supplier",
            searchable: true,
            facet: true,
            sortValue: (p) =>
              db.suppliers.find((s) => s.id === p.supplierId)?.name,
            render: (_, p) =>
              db.suppliers.find((s) => s.id === p.supplierId)?.name,
          },
          {
            title: "Invoice",
            dataIndex: "invoice",
            searchable: true,
            render: (v) => v || "—",
          },
          { title: "Date", dataIndex: "date", render: fmtDate },
          {
            title: "Warehouse",
            key: "wh",
            facet: true,
            sortValue: (p) =>
              db.warehouses.find((w) => w.id === p.locationId)?.name,
            render: (_, p) =>
              db.warehouses.find((w) => w.id === p.locationId)?.name,
          },
          {
            title: "Units",
            key: "units",
            sortValue: (p) => p.items.length,
            render: (_, p) => p.items.length,
          },
          {
            title: "Total",
            key: "total",
            align: "right",
            sortValue: (p) =>
              p.items.reduce((t, i) => t + i.unitCost * i.qty, 0),
            render: (_, p) =>
              fmtRp(p.items.reduce((t, i) => t + i.unitCost * i.qty, 0)),
          },
          {
            title: "In QC",
            key: "qc",
            facet: true,
            sortValue: (p) =>
              db.units.filter((u) => u.poId === p.id && u.status === "QC")
                .length > 0
                ? "Waiting"
                : "Clear",
            render: (_, p) => {
              const n = db.units.filter(
                (u) => u.poId === p.id && u.status === "QC",
              ).length;
              return n > 0 ? (
                <Tag color="orange">{n} waiting</Tag>
              ) : (
                <Tag color="green">clear</Tag>
              );
            },
          },
        ]}
      />
    </Card>
  );

  return (
    <PageContainer title="Purchase Order">
      <Tabs
        items={[
          { key: "new", label: "New PO", children: newPo },
          { key: "history", label: "PO History", children: history },
        ]}
      />
    </PageContainer>
  );
}
