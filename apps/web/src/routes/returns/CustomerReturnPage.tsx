/**
 * Phase 4 — returns from customers: plain return (back to stock on arrival)
 * or exchange with another unit plus an optional fee.
 *
 * The reason list is not a constant in this file. It reads from `db.reasons`
 * (activity `RETURN_CUSTOMER`), which Settings owns, so adding a reason is a
 * settings change rather than a deploy. Picking "Other" reveals a required
 * free-text box — an "Other" with nothing beside it is a row that answers
 * nothing when someone reads it back in six months.
 */
import { useState } from "react";
import {
  App,
  Button,
  Card,
  DatePicker,
  Flex,
  Form,
  Input,
  Radio,
  Select,
  Tag,
  Tooltip,
} from "antd";
import { CheckOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { MoneyInput } from "../../components/MoneyInput";
import { fmtRp, fmtDate } from "../../lib/format.js";
import {
  useDb,
  mutate,
  nextId,
  docCode,
  appendEvent,
} from "../../mock/store.js";

/** The label that turns on the "specify" field. Matched case-insensitively. */
const OTHER = "other";

export function CustomerReturnPage() {
  const db = useDb();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [kind, setKind] = useState<"RETURN" | "EXCHANGE">("RETURN");
  const [reason, setReason] = useState<string>();

  const reasons = db.reasons.filter(
    (r) => r.activity === "RETURN_CUSTOMER" && r.active,
  );
  const needsDetail = (reason ?? "").trim().toLowerCase() === OTHER;

  const soldUnits = db.units.filter((u) => u.status === "TERJUAL");
  const label = (serial: string) => {
    const k = db.skus.find(
      (s) => s.id === db.units.find((u) => u.serial === serial)!.skuId,
    )!;
    const o = db.orders.find((x) => x.serials.includes(serial));
    return `${serial} — ${k.name} ${k.variantLabel}${o ? ` (${o.code})` : ""}`;
  };

  const submit = (v: {
    serial: string;
    reason: string;
    reasonDetail?: string;
    date: dayjs.Dayjs;
    exchangeSerial?: string;
    fee?: number;
  }) => {
    mutate((d) => {
      d.returns.unshift({
        id: nextId("r"),
        code: docCode("SG"),
        kind: "CUSTOMER",
        serial: v.serial,
        reason: v.reason,
        reasonDetail: needsDetail ? v.reasonDetail?.trim() : undefined,
        date: v.date.format("YYYY-MM-DD"),
        status: "PENDING",
        exchangeSerial: kind === "EXCHANGE" ? v.exchangeSerial : undefined,
        fee: kind === "EXCHANGE" ? (v.fee ?? 0) : undefined,
      });
      if (kind === "EXCHANGE" && v.exchangeSerial) {
        appendEvent(d, v.exchangeSerial, {
          type: "TERJUAL",
          toStatus: "TERJUAL",
          note: `Exchange for ${v.serial}${v.fee ? ` + fee ${fmtRp(v.fee)}` : ""}`,
        });
      }
    });
    message.success("Return recorded — mark it arrived when the unit is back.");
    form.resetFields();
    setReason(undefined);
  };

  const markArrived = (id: string) => {
    mutate((d) => {
      const r = d.returns.find((x) => x.id === id)!;
      r.status = "ARRIVED";
      // Back into stock automatically — the system stocks it in again.
      appendEvent(d, r.serial, {
        type: "RETUR_PELANGGAN",
        toStatus: "TERSEDIA",
        note: `${[r.reason, r.reasonDetail].filter(Boolean).join(": ")} — restocked on arrival (${r.code})`,
        refCode: r.code,
      });
    });
    message.success("Unit is back in sellable stock.");
  };

  return (
    <PageContainer title="Return from Customer">
      <Flex vertical gap={16}>
        <Card title="New return">
          <Form
            form={form}
            layout="vertical"
            style={{ maxWidth: 640 }}
            initialValues={{ date: dayjs() }}
            onFinish={submit}
          >
            <Form.Item label="Type">
              <Radio.Group
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                optionType="button"
                options={[
                  { value: "RETURN", label: "Return to stock" },
                  { value: "EXCHANGE", label: "Exchange with another unit" },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="serial"
              label="Sold unit (from transaction history)"
              rules={[{ required: true }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Search the serial that is coming back"
                options={soldUnits.map((u) => ({
                  value: u.serial,
                  label: label(u.serial),
                }))}
              />
            </Form.Item>
            <Form.Item
              name="reason"
              label="Reason"
              tooltip="Managed in Settings → Reasons per activity"
              rules={[{ required: true }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Pick or search a reason"
                options={reasons.map((r) => ({
                  value: r.label,
                  label: r.label,
                }))}
                onChange={setReason}
              />
            </Form.Item>
            {needsDetail && (
              <Form.Item
                name="reasonDetail"
                label="Specify the reason"
                rules={[
                  { required: true, message: "Say what actually happened" },
                ]}
              >
                <Input.TextArea
                  rows={2}
                  placeholder="What was wrong with it?"
                />
              </Form.Item>
            )}
            <Form.Item name="date" label="Date" rules={[{ required: true }]}>
              <DatePicker format="DD MMM YYYY" />
            </Form.Item>
            {kind === "EXCHANGE" && (
              <>
                <Form.Item
                  name="exchangeSerial"
                  label="Replacement unit"
                  rules={[{ required: true }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="Unit handed to the customer instead"
                    options={db.units
                      .filter((u) => u.status === "TERSEDIA")
                      .map((u) => ({
                        value: u.serial,
                        label: label(u.serial),
                      }))}
                  />
                </Form.Item>
                <Form.Item name="fee" label="Additional fee (optional)">
                  <MoneyInput />
                </Form.Item>
              </>
            )}
            <Button type="primary" htmlType="submit">
              Record return
            </Button>
          </Form>
        </Card>
        <Card title="Return history">
          <ProTable
            rowKey="id"
            dataSource={db.returns.filter((r) => r.kind === "CUSTOMER")}
            searchPlaceholder="Search code, serial or reason"
            columns={[
              { title: "Code", dataIndex: "code", searchable: true },
              { title: "Serial", dataIndex: "serial", searchable: true },
              {
                title: "Product",
                key: "product",
                facet: true,
                sortValue: (r) => {
                  const u = db.units.find((x) => x.serial === r.serial);
                  const k = u && db.skus.find((s) => s.id === u.skuId);
                  return k ? `${k.name} ${k.variantLabel}` : "—";
                },
                render: (_, r) => {
                  const u = db.units.find((x) => x.serial === r.serial);
                  const k = u && db.skus.find((s) => s.id === u.skuId);
                  return k ? `${k.name} ${k.variantLabel}` : "—";
                },
              },
              {
                title: "Reason",
                key: "reason",
                facet: true,
                searchable: true,
                sortValue: (r) => r.reason,
                searchValue: (r) => `${r.reason} ${r.reasonDetail ?? ""}`,
                render: (_, r) => (
                  <>
                    <Tag>{r.reason}</Tag>
                    {r.reasonDetail && <div>{r.reasonDetail}</div>}
                  </>
                ),
              },
              {
                title: "Date",
                dataIndex: "date",
                defaultSortOrder: "descend",
                render: fmtDate,
              },
              {
                title: "Exchange",
                key: "exchange",
                sortValue: (r) => r.exchangeSerial ?? "",
                render: (_, r) =>
                  r.exchangeSerial
                    ? `${r.exchangeSerial}${r.fee ? ` + ${fmtRp(r.fee)}` : ""}`
                    : "—",
              },
              {
                title: "Status",
                dataIndex: "status",
                facet: true,
                sortValue: (r) =>
                  r.status === "PENDING"
                    ? "Waiting for the unit"
                    : "Arrived — restocked",
                render: (v) => (
                  <Tag color={v === "PENDING" ? "orange" : "green"}>
                    {v === "PENDING"
                      ? "Waiting for the unit"
                      : "Arrived — restocked"}
                  </Tag>
                ),
              },
              {
                // Blank by convention: DataTable drops an untitled column to
                // the foot of the card on a phone, where buttons belong.
                title: "",
                key: "actions",
                width: 60,
                render: (_, r) =>
                  r.status === "PENDING" && (
                    <Tooltip title="Mark as arrived — puts it back in stock">
                      <Button
                        size="small"
                        type="primary"
                        aria-label={`Mark ${r.serial} as arrived`}
                        icon={<CheckOutlined />}
                        onClick={() => markArrived(r.id)}
                      />
                    </Tooltip>
                  ),
              },
            ]}
          />
        </Card>
      </Flex>
    </PageContainer>
  );
}
