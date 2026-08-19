/**
 * Return an in-stock unit to its supplier. The history includes units rejected
 * at QC, which arrive here without anyone filling in this form — the Stock In
 * page opens them. Those rows carry `fromQc`, and the table says so, because
 * "why is there a supplier return I never created" is otherwise a real question.
 */
import { useState } from "react";
import {
  App,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Select,
  Tag,
  Typography,
} from "antd";
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

export function SupplierReturnPage() {
  const db = useDb();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [reason, setReason] = useState<string>();

  const reasons = db.reasons.filter(
    (r) => r.activity === "RETURN_SUPPLIER" && r.active,
  );
  const needsDetail = (reason ?? "").trim().toLowerCase() === OTHER;

  const returnable = db.units.filter((u) =>
    ["TERSEDIA", "QC", "SERVIS"].includes(u.status),
  );
  const label = (serial: string) => {
    const k = db.skus.find(
      (s) => s.id === db.units.find((u) => u.serial === serial)!.skuId,
    )!;
    return `${serial} — ${k.name} ${k.variantLabel}`;
  };

  const submit = (v: {
    serial: string;
    supplierId: string;
    reason: string;
    reasonDetail?: string;
    credit?: number;
  }) => {
    mutate((d) => {
      d.returns.unshift({
        id: nextId("r"),
        code: docCode("SP"),
        kind: "SUPPLIER",
        serial: v.serial,
        reason: v.reason,
        reasonDetail: needsDetail ? v.reasonDetail?.trim() : undefined,
        date: new Date().toISOString().slice(0, 10),
        status: "DONE",
        supplierId: v.supplierId,
        expectedCredit: v.credit,
      });
      appendEvent(d, v.serial, {
        type: "RETUR_SUPPLIER",
        toStatus: "RETUR_SUPPLIER",
        note: [v.reason, needsDetail ? v.reasonDetail : null]
          .filter(Boolean)
          .join(": "),
      });
    });
    message.success("Unit returned to the supplier.");
    form.resetFields();
    setReason(undefined);
  };

  return (
    <PageContainer title="Return to Supplier">
      <Flex vertical gap={16}>
        <Card title="New supplier return">
          <Form
            form={form}
            layout="vertical"
            style={{ maxWidth: 640 }}
            onFinish={submit}
          >
            <Form.Item
              name="serial"
              label="Unit in inventory"
              rules={[{ required: true }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Search serial"
                options={returnable.map((u) => ({
                  value: u.serial,
                  label: label(u.serial),
                }))}
                onChange={(serial: string) => {
                  const u = db.units.find((x) => x.serial === serial);
                  const sup = db.pos.find((p) => p.id === u?.poId)?.supplierId;
                  form.setFieldsValue({ supplierId: sup, credit: u?.buy });
                }}
              />
            </Form.Item>
            <Form.Item
              name="supplierId"
              label="Supplier"
              rules={[{ required: true }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={db.suppliers.map((s) => ({
                  value: s.id,
                  label: s.name,
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
                  {
                    required: true,
                    message: "Say what is actually wrong with it",
                  },
                ]}
              >
                <Input.TextArea
                  rows={2}
                  placeholder="e.g. dead pixel cluster, hinge play"
                />
              </Form.Item>
            )}
            <Form.Item name="credit" label="Expected credit">
              <MoneyInput />
            </Form.Item>
            <Button type="primary" htmlType="submit">
              Record supplier return
            </Button>
          </Form>
        </Card>
        <Card title="Supplier return history">
          <Typography.Paragraph type="secondary">
            Includes units rejected at QC — those are opened by the Stock In
            page, not this form.
          </Typography.Paragraph>
          <ProTable
            rowKey="id"
            dataSource={db.returns.filter((r) => r.kind === "SUPPLIER")}
            searchPlaceholder="Search code, serial, supplier or reason"
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
                title: "Supplier",
                key: "supplier",
                facet: true,
                searchable: true,
                sortValue: (r) =>
                  db.suppliers.find((s) => s.id === r.supplierId)?.name ?? "—",
                render: (_, r) =>
                  db.suppliers.find((s) => s.id === r.supplierId)?.name ?? "—",
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
                // The owner's ask: a QC rejection is a different kind of event
                // from a considered return, and the two were indistinguishable.
                title: "Origin",
                key: "origin",
                facet: true,
                sortValue: (r) =>
                  r.fromQc ? "Rejected at QC" : "Returned from stock",
                render: (_, r) =>
                  r.fromQc ? (
                    <Tag color="volcano">Rejected at QC</Tag>
                  ) : (
                    <Tag color="blue">Returned from stock</Tag>
                  ),
              },
              {
                title: "Date",
                dataIndex: "date",
                defaultSortOrder: "descend",
                render: fmtDate,
              },
              {
                title: "Expected credit",
                key: "credit",
                align: "right",
                sortValue: (r) => r.expectedCredit ?? 0,
                render: (_, r) => fmtRp(r.expectedCredit ?? 0),
              },
              {
                title: "Status",
                dataIndex: "status",
                facet: true,
                render: (v) => <Tag color="green">{v}</Tag>,
              },
            ]}
          />
        </Card>
      </Flex>
    </PageContainer>
  );
}
