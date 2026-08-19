/**
 * Everything currently held, by serial — price, hold state, location. Edits
 * are appended to the unit's timeline; nothing is ever deleted.
 *
 * The "Add adjustment" flow is where a reason gets *created*. A user may type a
 * reason that has never been used before, and the rule is that the managed list
 * in Settings learns it FIRST: `ensureReason` runs inside the same `mutate` as
 * the adjustment row, so there is no instant at which an adjustment points at a
 * reason the settings page has never heard of. That is why the adjustment
 * stores a `reasonId` and not the typed text.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  App,
  AutoComplete,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { MoneyInput } from "../../components/MoneyInput";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { fmtRp, fmtDateTime } from "../../lib/format.js";
import {
  useDb,
  mutate,
  appendEvent,
  ensureReason,
  nextId,
} from "../../mock/store.js";
import type { Unit } from "../../mock/seed.js";

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  // "Pending QC" rather than "In QC": a unit sitting here has not been looked
  // at yet, which is what the Stock In queue actually means.
  QC: { color: "orange", label: "Pending QC" },
  TERSEDIA: { color: "green", label: "In stock" },
  DIRESERVASI: { color: "gold", label: "Reserved" },
  TERJUAL: { color: "blue", label: "Sold" },
  RETUR_SUPPLIER: { color: "default", label: "Returned to supplier" },
  SERVIS: { color: "purple", label: "On service" },
  HILANG: { color: "red", label: "Lost" },
};

export function StockAdjustmentPage() {
  const db = useDb();
  const { message } = App.useApp();
  const { compact } = useLayoutMode();
  const [editing, setEditing] = useState<Unit | null>(null);
  const [adding, setAdding] = useState(false);
  const [form] = Form.useForm<{
    price: number;
    locationId: string;
    description: string;
    reason: string;
  }>();
  const [addForm] = Form.useForm<{
    serial: string;
    description: string;
    reason: string;
  }>();

  const skuOf = (skuId: string) => db.skus.find((s) => s.id === skuId);
  const rackOf = (id?: string) => db.racks.find((r) => r.id === id)?.name;
  const adjustmentReasons = db.reasons.filter(
    (r) => r.activity === "ADJUSTMENT" && r.active,
  );

  const openEdit = (u: Unit) => {
    setEditing(u);
    form.setFieldsValue({
      price: u.price ?? 0,
      locationId: u.locationId,
      description: u.description,
      reason: "",
    });
  };

  const saveEdit = () =>
    form.validateFields().then((v) => {
      mutate((d) => {
        const u = d.units.find((x) => x.serial === editing!.serial)!;
        if (v.price !== u.price) {
          appendEvent(d, u.serial, {
            type: "KOREKSI",
            note: `Price ${fmtRp(u.price)} → ${fmtRp(v.price)} — ${v.reason || "adjustment"}`,
          });
          u.price = v.price;
        }
        if (v.locationId !== u.locationId) {
          appendEvent(d, u.serial, {
            type: "DIPINDAH",
            toLocationId: v.locationId,
            note: v.reason || "Moved",
          });
          // The rack belongs to the old warehouse, so a move clears it rather
          // than leaving the unit filed onto a shelf in another building.
          u.rackId = undefined;
        }
        if (v.description !== u.description) {
          appendEvent(d, u.serial, {
            type: "DICATAT",
            note: `Description updated: ${v.description}`,
          });
          u.description = v.description;
        }
      });
      message.success("Adjustment logged on the unit's timeline.");
      setEditing(null);
    });

  /** Open the add-adjustment form, prefilled from whichever unit is picked. */
  const openAdd = () => {
    addForm.resetFields();
    setAdding(true);
  };

  const submitAdd = () =>
    addForm.validateFields().then((v) => {
      mutate((d) => {
        // Reason list first, adjustment second — the no-orphan-data rule.
        const reasonId = ensureReason(d, "ADJUSTMENT", v.reason);
        const label =
          d.reasons.find((r) => r.id === reasonId)?.label ?? v.reason;
        const unit = d.units.find((u) => u.serial === v.serial);
        if (unit) unit.description = v.description;
        d.adjustments.unshift({
          id: nextId("adj"),
          serial: v.serial,
          description: v.description,
          reasonId,
          at: new Date().toISOString(),
          staff: "Michella",
        });
        appendEvent(d, v.serial, {
          type: "KOREKSI",
          note: `${label} — ${v.description}`,
        });
      });
      const known = adjustmentReasons.some(
        (r) => r.label.toLowerCase() === v.reason.trim().toLowerCase(),
      );
      message.success(
        known
          ? "Adjustment logged."
          : `Adjustment logged, and "${v.reason.trim()}" was added to the reason list in Settings.`,
      );
      setAdding(false);
    });

  const onHold = db.units.filter((u) => u.status === "DIRESERVASI").length;
  const inStock = db.units.filter((u) =>
    ["TERSEDIA", "DIRESERVASI"].includes(u.status),
  );

  const addAction = (
    <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
      Add adjustment
    </Button>
  );

  const stockTab = (
    <Card>
      <ProTable
        rowKey="serial"
        dataSource={db.units}
        searchPlaceholder="Search serial number, product or description"
        // The button sits at the top right of the table itself on a desktop;
        // on a phone PageContainer turns it into the float button instead, so
        // this half is hidden there to avoid rendering it twice.
        extra={compact ? undefined : addAction}
        toolbar={
          <Typography.Text type="secondary">
            {inStock.length} sellable · {onHold} on hold · value{" "}
            {fmtRp(inStock.reduce((t, u) => t + (u.price ?? 0), 0))}
          </Typography.Text>
        }
        columns={[
          {
            title: "Serial",
            dataIndex: "serial",
            searchable: true,
            render: (v) => <Link to={`/stock/history?serial=${v}`}>{v}</Link>,
          },
          {
            title: "Product",
            key: "product",
            searchable: true,
            facet: true,
            sortValue: (u) =>
              `${skuOf(u.skuId)?.name} ${skuOf(u.skuId)?.variantLabel}`,
            render: (_, u) => (
              <>
                {skuOf(u.skuId)?.name}
                <Typography.Text type="secondary" style={{ display: "block" }}>
                  {skuOf(u.skuId)?.variantLabel}
                </Typography.Text>
              </>
            ),
          },
          {
            title: "Description",
            dataIndex: "description",
            searchable: true,
            ellipsis: true,
            render: (v) => v || "—",
          },
          {
            title: "Status",
            dataIndex: "status",
            facet: true,
            facetLabel: "Any status",
            sortValue: (u) => STATUS_TAG[u.status]?.label ?? u.status,
            render: (v: string) => (
              <Tag color={STATUS_TAG[v]?.color}>
                {STATUS_TAG[v]?.label ?? v}
              </Tag>
            ),
          },
          {
            title: "Warehouse",
            key: "wh",
            facet: true,
            sortValue: (u) =>
              db.warehouses.find((w) => w.id === u.locationId)?.name,
            render: (_, u) =>
              db.warehouses.find((w) => w.id === u.locationId)?.name,
          },
          {
            title: "Location",
            key: "rack",
            facet: true,
            sortValue: (u) => rackOf(u.rackId) ?? "—",
            render: (_, u) => rackOf(u.rackId) ?? "—",
          },
          {
            title: "Buy",
            key: "buy",
            align: "right",
            sortValue: (u) => u.buy,
            render: (_, u) => fmtRp(u.buy),
          },
          {
            title: "Price",
            key: "price",
            align: "right",
            sortValue: (u) => u.price ?? 0,
            render: (_, u) => fmtRp(u.price),
          },
          {
            title: "",
            key: "actions",
            width: 60,
            render: (_, u) => (
              <Tooltip title="Adjust this unit">
                <Button
                  type="text"
                  aria-label={`Adjust ${u.serial}`}
                  icon={<EditOutlined />}
                  onClick={() => openEdit(u)}
                />
              </Tooltip>
            ),
          },
        ]}
      />
    </Card>
  );

  const logTab = (
    <Card>
      <ProTable
        rowKey="id"
        dataSource={db.adjustments}
        searchPlaceholder="Search serial, description or reason"
        extra={compact ? undefined : addAction}
        columns={[
          {
            title: "When",
            dataIndex: "at",
            defaultSortOrder: "descend",
            render: fmtDateTime,
          },
          {
            title: "Serial",
            dataIndex: "serial",
            searchable: true,
            render: (v) => <Link to={`/stock/history?serial=${v}`}>{v}</Link>,
          },
          {
            title: "Product",
            key: "product",
            facet: true,
            sortValue: (a) => {
              const u = db.units.find((x) => x.serial === a.serial);
              const k = u && skuOf(u.skuId);
              return k ? `${k.name} ${k.variantLabel}` : "—";
            },
            render: (_, a) => {
              const u = db.units.find((x) => x.serial === a.serial);
              const k = u && skuOf(u.skuId);
              return k ? `${k.name} ${k.variantLabel}` : "—";
            },
          },
          {
            title: "Description",
            dataIndex: "description",
            searchable: true,
            ellipsis: true,
          },
          {
            title: "Reason",
            key: "reason",
            facet: true,
            searchable: true,
            sortValue: (a) =>
              db.reasons.find((r) => r.id === a.reasonId)?.label ?? a.reasonId,
            render: (_, a) => (
              <Tag>
                {db.reasons.find((r) => r.id === a.reasonId)?.label ??
                  a.reasonId}
              </Tag>
            ),
          },
          { title: "By", dataIndex: "staff", facet: true },
        ]}
      />
    </Card>
  );

  return (
    <PageContainer
      title="Stock Adjustment"
      // Compact only — the desktop button lives at the top right of the table
      // itself. See PageContainer's docblock on the ListToolbar arrangement.
      actions={
        compact
          ? [
              {
                key: "add",
                label: "Add adjustment",
                icon: <PlusOutlined />,
                type: "primary",
                onClick: openAdd,
              },
            ]
          : undefined
      }
    >
      <Tabs
        items={[
          { key: "stock", label: "Stock", children: stockTab },
          { key: "log", label: "Adjustment log", children: logTab },
        ]}
      />

      <Modal
        title="Add stock adjustment"
        open={adding}
        onCancel={() => setAdding(false)}
        onOk={submitAdd}
        okText="Log adjustment"
      >
        <Form form={addForm} layout="vertical">
          <Form.Item
            name="serial"
            label="Serial number"
            rules={[
              { required: true, message: "Pick the unit being adjusted" },
            ]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Search a serial number"
              options={db.units.map((u) => ({
                value: u.serial,
                label: `${u.serial} — ${skuOf(u.skuId)?.name} ${skuOf(u.skuId)?.variantLabel}`,
              }))}
              // Prefills the description with whatever the unit already says,
              // so the common case — adjusting the reason, not the condition —
              // is one field instead of retyping a sentence.
              onChange={(serial: string) =>
                addForm.setFieldsValue({
                  description:
                    db.units.find((u) => u.serial === serial)?.description ??
                    "",
                })
              }
            />
          </Form.Item>
          <Form.Item
            name="description"
            label="Description of the unit"
            tooltip="Prefilled from the unit; edit it if the condition changed"
            rules={[{ required: true, message: "Describe the unit" }]}
          >
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            name="reason"
            label="Reason"
            tooltip="Pick one, or type a new reason — a new one is added to Settings automatically"
            rules={[{ required: true, message: "Pick or type a reason" }]}
          >
            <AutoComplete
              options={adjustmentReasons.map((r) => ({ value: r.label }))}
              filterOption={(input, opt) =>
                String(opt?.value ?? "")
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              placeholder="Search a reason, or type a new one"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Adjust ${editing?.serial ?? ""}`}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={saveEdit}
        okText="Log adjustment"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="price"
            label="Selling price"
            rules={[{ required: true }]}
          >
            <MoneyInput />
          </Form.Item>
          <Form.Item
            name="locationId"
            label="Warehouse"
            rules={[{ required: true }]}
          >
            <Select
              options={db.warehouses.map((w) => ({
                value: w.id,
                label: w.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            name="reason"
            label="Reason"
            tooltip="Written into the append-only log"
          >
            <Input placeholder="Why this change?" />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
