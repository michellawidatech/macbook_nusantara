/**
 * Record expenses against the six categories the owner set. Marketing spend
 * can name the referral source it feeds, which is what lets Cashflow score a
 * campaign against the customers it actually brought in.
 */
import { useState } from "react";
import dayjs from "dayjs";
import {
  App,
  Button,
  Card,
  DatePicker,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Table,
  Tag,
  Typography,
} from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { MoneyInput } from "../../components/MoneyInput";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { fmtRp, fmtDate } from "../../lib/format.js";
import { useDb, mutate, nextId } from "../../mock/store.js";
import { EXPENSE_CATEGORIES, type ExpenseKind } from "../../mock/seed.js";

const KINDS = EXPENSE_CATEGORIES.map((c) => ({
  value: c.value,
  label: c.label,
}));
const labelOf = (v: string) =>
  EXPENSE_CATEGORIES.find((c) => c.value === v)?.label ?? v;

export function ExpensePage() {
  const db = useDb();
  const { message } = App.useApp();
  const { compact } = useLayoutMode();
  const [form] = Form.useForm();
  const [kind, setKind] = useState<ExpenseKind>("OPERATIONAL");
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <PageContainer title="Expenses">
      <Flex vertical gap={16}>
        <Card title="Add expense">
          <Form
            form={form}
            // Inline is a five-across row on a desktop and five clipped
            // controls on a phone. Vertical stacks them and gives each field
            // its own label, which `layout="inline"` deliberately hides —
            // affordable when the placeholder is right there beside four
            // others, not when it is the only thing on the line.
            layout={compact ? "vertical" : "inline"}
            // Releases the field widths below; see global.css.
            className="responsive-controls"
            style={{ rowGap: 12 }}
            initialValues={{ kind: "OPERATIONAL", date: dayjs() }}
            onFinish={(v) => {
              mutate((d) => {
                d.expenses.unshift({
                  id: nextId("e"),
                  label: v.label,
                  kind: v.kind,
                  amount: v.amount,
                  date: v.date.format("YYYY-MM-DD"),
                  note: v.note,
                  referralSourceId:
                    v.kind === "MARKETING" ? v.referralSourceId : undefined,
                });
              });
              message.success("Expense recorded.");
              form.resetFields();
              setKind("OPERATIONAL");
            }}
          >
            <Form.Item
              name="label"
              label={compact ? "What was it for?" : undefined}
              rules={[{ required: true, message: "What was it for?" }]}
            >
              <Input placeholder="What was it for?" style={{ width: 240 }} />
            </Form.Item>
            {/* The "?" sits immediately after the category field, not up in the
                page header: the question it answers is "which of these six do I
                pick", and that question is asked here, at this control. */}
            <Form.Item name="kind" label={compact ? "Category" : undefined}>
              <Select
                options={KINDS}
                style={{ width: 220 }}
                onChange={setKind}
              />
            </Form.Item>
            <Form.Item label={compact ? " " : undefined}>
              <Button
                icon={<QuestionCircleOutlined />}
                aria-label="What do these categories mean?"
                onClick={() => setGuideOpen(true)}
              />
            </Form.Item>
            {kind === "MARKETING" && (
              <Form.Item
                name="referralSourceId"
                label={compact ? "Which channel?" : undefined}
                tooltip="Links this spend to the customers who said they came from that channel"
              >
                <Select
                  allowClear
                  placeholder="Which channel?"
                  style={{ width: 200 }}
                  options={db.referralSources
                    .filter((r) => r.active)
                    .map((r) => ({ value: r.id, label: r.name }))}
                />
              </Form.Item>
            )}
            <Form.Item
              name="amount"
              label={compact ? "Amount" : undefined}
              rules={[{ required: true, message: "Amount" }]}
            >
              <MoneyInput style={{ width: 200 }} />
            </Form.Item>
            <Form.Item
              name="date"
              label={compact ? "Date" : undefined}
              rules={[{ required: true }]}
            >
              <DatePicker format="DD MMM YYYY" />
            </Form.Item>
            <Form.Item name="note" label={compact ? "Note" : undefined}>
              <Input placeholder="Note (optional)" style={{ width: 180 }} />
            </Form.Item>
            <Button type="primary" htmlType="submit">
              Add
            </Button>
          </Form>
        </Card>
        <Card title="Expense history">
          <ProTable
            rowKey="id"
            dataSource={db.expenses}
            searchPlaceholder="Search expense or note"
            columns={[
              {
                title: "Date",
                dataIndex: "date",
                defaultSortOrder: "descend",
                render: fmtDate,
              },
              { title: "Expense", dataIndex: "label", searchable: true },
              {
                // Narrow on purpose: antd draws a column's own filter and sort
                // controls at the right edge of its header cell, so a wide
                // column parks them a long way from the word they belong to.
                title: "Category",
                dataIndex: "kind",
                width: 210,
                facet: true,
                facetLabel: "Category",
                sortValue: (e) => labelOf(e.kind),
                render: (v) => <Tag>{labelOf(v)}</Tag>,
              },
              {
                title: "Channel",
                key: "channel",
                facet: true,
                sortValue: (e) =>
                  db.referralSources.find((r) => r.id === e.referralSourceId)
                    ?.name ?? "—",
                render: (_, e) =>
                  db.referralSources.find((r) => r.id === e.referralSourceId)
                    ?.name ?? "—",
              },
              {
                title: "Amount",
                key: "amount",
                align: "right",
                sortValue: (e) => e.amount,
                render: (_, e) => fmtRp(e.amount),
              },
              {
                title: "Note",
                dataIndex: "note",
                searchable: true,
                render: (v) => v || "—",
              },
            ]}
          />
        </Card>
      </Flex>

      <Modal
        title="What goes in each category"
        open={guideOpen}
        onCancel={() => setGuideOpen(false)}
        footer={null}
        width={compact ? "100%" : 640}
      >
        <Table
          rowKey="value"
          size="small"
          pagination={false}
          showHeader={false}
          dataSource={[...EXPENSE_CATEGORIES]}
          columns={[
            {
              title: "Category",
              width: 200,
              render: (_, c) => (
                <Typography.Text strong>{c.label}</Typography.Text>
              ),
            },
            { title: "Guide", dataIndex: "guide" },
          ]}
        />
      </Modal>
    </PageContainer>
  );
}
