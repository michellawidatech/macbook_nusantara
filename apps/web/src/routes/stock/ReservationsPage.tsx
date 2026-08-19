/** Phase 5 — reservations put a unit on hold; cancel releases it, or proceed to Stock Out. */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import {
  App,
  Button,
  Card,
  DatePicker,
  Flex,
  Form,
  Input,
  Select,
  Tag,
  Tooltip,
} from "antd";
import {
  CloseOutlined,
  PlusOutlined,
  ShoppingCartOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { fmtDateTime } from "../../lib/format.js";
import { useDb, mutate, nextId, appendEvent } from "../../mock/store.js";

/**
 * A reservation that turned into a sale reads as "Bought", not "Done" — the
 * status the owner asked for, and the one that distinguishes a hold that
 * completed from a hold that merely stopped.
 */
const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  ACTIVE: { text: "On hold", color: "gold" },
  DONE: { text: "Bought", color: "green" },
  CANCELLED: { text: "Cancelled", color: "default" },
};

export function ReservationsPage() {
  const db = useDb();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const { compact } = useLayoutMode();
  const [form] = Form.useForm();
  const [adding, setAdding] = useState(false);

  const available = db.units.filter((u) => u.status === "TERSEDIA");
  const skuOf = (serial: string) =>
    db.skus.find(
      (s) => s.id === db.units.find((u) => u.serial === serial)?.skuId,
    );
  const sourceName = (id?: string) =>
    db.reservationSources.find((s) => s.id === id)?.name;

  const add = (v: {
    serial: string;
    customerId: string;
    when: dayjs.Dayjs;
    sourceId?: string;
    note?: string;
  }) => {
    mutate((d) => {
      d.reservations.unshift({
        id: nextId("rsv"),
        serial: v.serial,
        customerId: v.customerId,
        when: v.when.toISOString(),
        note: v.note ?? "",
        sourceId: v.sourceId,
        status: "ACTIVE",
      });
      appendEvent(d, v.serial, {
        type: "DIRESERVASI",
        toStatus: "DIRESERVASI",
        note: [
          v.note,
          sourceName(v.sourceId) && `via ${sourceName(v.sourceId)}`,
        ]
          .filter(Boolean)
          .join(" — "),
      });
    });
    message.success("Reserved — the unit is now on hold.");
    form.resetFields();
    setAdding(false);
  };

  /** Cancelling frees the unit, so it asks first — this is not an undo. */
  const cancel = (id: string) => {
    const r = db.reservations.find((x) => x.id === id);
    modal.confirm({
      title: "Cancel this reservation?",
      content: `${r?.serial} goes back into sellable stock straight away.`,
      okText: "Cancel reservation",
      okButtonProps: { danger: true },
      cancelText: "Keep the hold",
      onOk: () => {
        mutate((d) => {
          const x = d.reservations.find((y) => y.id === id)!;
          x.status = "CANCELLED";
          appendEvent(d, x.serial, {
            type: "RESERVASI_BATAL",
            toStatus: "TERSEDIA",
            note: "Reservation cancelled",
          });
        });
        message.success("Reservation cancelled — the unit is back in stock.");
      },
    });
  };

  return (
    <PageContainer
      title="Reservations"
      // The card's own `extra` button used to hold this. Declared as a page
      // action instead, it stays in the header on a desktop and becomes the
      // bottom-right float button on a phone, where the card header is a
      // scroll away from the thumb.
      actions={[
        {
          key: "add",
          label: adding ? "Close the form" : "Add reservation",
          icon: adding ? <CloseOutlined /> : <PlusOutlined />,
          type: "primary",
          onClick: () => setAdding(!adding),
        },
      ]}
    >
      <Flex vertical gap={16}>
        <Card title="Reservations">
          {adding && (
            <Form
              form={form}
              layout={compact ? "vertical" : "inline"}
              className="responsive-controls"
              onFinish={add}
              style={{ marginBottom: 16, rowGap: 8 }}
            >
              <Form.Item
                name="serial"
                label={compact ? "Unit" : undefined}
                rules={[{ required: true, message: "Pick a unit" }]}
              >
                <Select
                  showSearch
                  style={{ width: 320 }}
                  optionFilterProp="label"
                  placeholder="Available unit"
                  options={available.map((u) => ({
                    value: u.serial,
                    label: `${u.serial} — ${skuOf(u.serial)?.name} ${skuOf(u.serial)?.variantLabel}`,
                  }))}
                />
              </Form.Item>
              <Form.Item
                name="customerId"
                label={compact ? "Customer" : undefined}
                rules={[{ required: true, message: "Pick a customer" }]}
              >
                <Select
                  showSearch
                  style={{ width: 240 }}
                  optionFilterProp="label"
                  placeholder="Customer"
                  options={db.customers.map((c) => ({
                    value: c.id,
                    label: `${c.name} · ${c.phone}`,
                  }))}
                />
              </Form.Item>
              {/* Where the hold came in from. Managed in Settings, so a new
                  marketplace is a settings row rather than a code change. */}
              <Form.Item
                name="sourceId"
                label={compact ? "Came from" : undefined}
                rules={[
                  { required: true, message: "Where did this come from?" },
                ]}
              >
                <Select
                  showSearch
                  style={{ width: 180 }}
                  optionFilterProp="label"
                  placeholder="Came from"
                  options={db.reservationSources
                    .filter((s) => s.active)
                    .map((s) => ({ value: s.id, label: s.name }))}
                />
              </Form.Item>
              <Form.Item
                name="when"
                label={compact ? "Hold until" : undefined}
                rules={[{ required: true, message: "Pick a time" }]}
              >
                <DatePicker
                  showTime
                  format="DD MMM YYYY HH:mm"
                  placeholder="Hold until"
                />
              </Form.Item>
              <Form.Item
                name="note"
                label={compact ? "Description" : undefined}
              >
                <Input placeholder="Description" style={{ width: 220 }} />
              </Form.Item>
              <Button type="primary" htmlType="submit">
                Reserve
              </Button>
            </Form>
          )}
          <ProTable
            rowKey="id"
            dataSource={[...db.reservations].sort((a, b) =>
              a.when.localeCompare(b.when),
            )}
            searchPlaceholder="Search serial, product or customer"
            columns={[
              {
                title: "When",
                dataIndex: "when",
                defaultSortOrder: "ascend",
                render: fmtDateTime,
              },
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
                sortValue: (r) => sourceName(r.sourceId) ?? "—",
                render: (_, r) =>
                  sourceName(r.sourceId) ? (
                    <Tag>{sourceName(r.sourceId)}</Tag>
                  ) : (
                    "—"
                  ),
              },
              { title: "Note", dataIndex: "note", render: (v) => v || "—" },
              {
                title: "Status",
                dataIndex: "status",
                facet: true,
                sortValue: (r) => STATUS_LABEL[r.status]?.text ?? r.status,
                render: (v: string) => (
                  <Tag color={STATUS_LABEL[v]?.color}>
                    {STATUS_LABEL[v]?.text ?? v}
                  </Tag>
                ),
              },
              {
                // Blank by convention: DataTable drops an untitled column to
                // the foot of the card on a phone, where buttons belong.
                title: "",
                key: "actions",
                width: 100,
                render: (_, r) =>
                  r.status === "ACTIVE" && (
                    <Flex gap={8}>
                      <Tooltip title="Sell this unit now">
                        <Button
                          type="primary"
                          size="small"
                          aria-label={`Stock out ${r.serial}`}
                          icon={<ShoppingCartOutlined />}
                          onClick={() =>
                            navigate(`/stock/out?reservation=${r.id}`)
                          }
                        />
                      </Tooltip>
                      <Tooltip title="Cancel the hold">
                        <Button
                          size="small"
                          danger
                          aria-label={`Cancel reservation for ${r.serial}`}
                          icon={<StopOutlined />}
                          onClick={() => cancel(r.id)}
                        />
                      </Tooltip>
                    </Flex>
                  ),
              },
            ]}
          />
        </Card>
      </Flex>
    </PageContainer>
  );
}
