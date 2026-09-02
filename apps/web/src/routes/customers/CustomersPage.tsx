/** Customers — contact, referral, and their transaction history. */
import { useState } from "react";
import {
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Tag,
  Tooltip,
} from "antd";
import { EditOutlined, HistoryOutlined, PlusOutlined } from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { DataTable } from "../../components/DataTable";
import { FilterBar } from "../../components/FilterBar";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { fmtRp, fmtDateTime } from "../../lib/format.js";
import { useDb, mutate, nextId } from "../../mock/store.js";
import type { Customer } from "../../mock/seed.js";
import { useTranslation } from "react-i18next";

export function CustomersPage() {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();
  const { compact } = useLayoutMode();
  const [form] = Form.useForm();
  const [viewing, setViewing] = useState<Customer | null>(null);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [q, setQ] = useState("");

  const rows = db.customers.filter((c) =>
    `${c.name} ${c.phone}`.toLowerCase().includes(q.toLowerCase()),
  );
  const ordersOf = (id: string) => db.orders.filter((o) => o.customerId === id);
  const refName = (id?: string) =>
    db.referralSources.find((r) => r.id === id)?.name;

  const save = () =>
    form.validateFields().then((v) => {
      mutate((d) => {
        if (editing === "new") {
          d.customers.unshift({
            id: nextId("c"),
            createdAt: new Date().toISOString(),
            ...v,
          });
        } else if (editing) {
          Object.assign(
            d.customers.find((c) => c.id === editing.id)!,
            v,
          );
        }
      });
      message.success("Customer saved.");
      setEditing(null);
    });

  return (
    <PageContainer
      title={t("customers.customers", "Customers")}
      actions={[
        {
          key: "add",
          label: t("customers.addCustomer", "Add customer"),
          icon: <PlusOutlined />,
          type: "primary",
          onClick: () => {
            setEditing("new");
            form.resetFields();
          },
        },
      ]}
    >
      <Card>
        <FilterBar>
          <Input.Search
            placeholder={t(
              "customers.searchNameOrPhone",
              "Search name or phone",
            )}
            style={{ width: 320 }}
            allowClear
            onChange={(e) => setQ(e.target.value)}
          />
        </FilterBar>
        <DataTable
          rowKey="id"
          dataSource={rows}
          // A new search is a new question: send the window back to the first
          // page rather than answering it with 200 rows already loaded.
          resetKey={q}
          columns={[
            { title: t("customers.name", "Name"), dataIndex: "name" },
            { title: t("customers.phone", "Phone"), dataIndex: "phone" },
            {
              title: t("customers.address", "Address"),
              dataIndex: "address",
              ellipsis: true,
              render: (v) => v || "—",
            },
            {
              title: t("customers.knowsUsFrom", "Knows us from"),
              render: (_, c) =>
                refName(c.referralSourceId) ? (
                  <Tag>{refName(c.referralSourceId)}</Tag>
                ) : (
                  "—"
                ),
            },
            {
              title: t("customers.orders", "Orders"),
              render: (_, c) => ordersOf(c.id).length,
            },
            {
              title: t("customers.totalSpend", "Total spend"),
              align: "right",
              render: (_, c) =>
                fmtRp(ordersOf(c.id).reduce((t, o) => t + o.total, 0)),
            },
            {
              // Icons, not words (owner decision 2026-08-26). Two labelled
              // buttons repeated down every row is a column of the same two
              // words over and over; the tooltip and the `aria-label` say more
              // than the text did, because they name the customer.
              title: "",
              width: 96,
              render: (_, c) => (
                <Flex gap={4} justify="end">
                  <Tooltip title={t("customers.history", "History")}>
                    <Button
                      size="small"
                      type="text"
                      icon={<HistoryOutlined />}
                      aria-label={t(
                        "customers.historyAria",
                        "Purchase history for {{name}}",
                        { name: c.name },
                      )}
                      onClick={() => setViewing(c)}
                    />
                  </Tooltip>
                  <Tooltip title={t("customers.edit", "Edit")}>
                    <Button
                      size="small"
                      type="text"
                      icon={<EditOutlined />}
                      aria-label={t("customers.editAria", "Edit {{name}}", {
                        name: c.name,
                      })}
                      onClick={() => {
                        setEditing(c);
                        form.setFieldsValue(c);
                      }}
                    />
                  </Tooltip>
                </Flex>
              ),
            },
          ]}
        />
      </Card>

      <Drawer
        title={viewing?.name}
        open={viewing !== null}
        // A 560px drawer over a 375px screen is a drawer with 185px of it off
        // the edge. Full width on a phone; the header's close button is the
        // way back, since there is no page left beside it to tap.
        width={compact ? "100%" : 560}
        onClose={() => setViewing(null)}
      >
        {viewing && (
          <>
            <Descriptions
              column={1}
              items={[
                {
                  key: "p",
                  label: t("customers.phone", "Phone"),
                  children: viewing.phone,
                },
                {
                  key: "a",
                  label: t("customers.address", "Address"),
                  children: viewing.address || "—",
                },
                {
                  key: "r",
                  label: t("customers.referral", "Referral"),
                  children: refName(viewing.referralSourceId) ?? "—",
                },
              ]}
            />
            <DataTable
              rowKey="id"
              size="small"
              style={{ marginTop: 16 }}
              dataSource={ordersOf(viewing.id)}
              columns={[
                { title: t("customers.order", "Order"), dataIndex: "code" },
                {
                  title: t("customers.when", "When"),
                  dataIndex: "ts",
                  render: fmtDateTime,
                },
                {
                  title: t("customers.serials", "Serials"),
                  render: (_, o) => o.serials.join(", "),
                },
                {
                  title: t("customers.total", "Total"),
                  align: "right",
                  render: (_, o) => fmtRp(o.total),
                },
                {
                  title: t("customers.money", "Money"),
                  render: (_, o) =>
                    o.settled ? (
                      <Tag color="green">settled</Tag>
                    ) : (
                      <Tag color="orange">pending</Tag>
                    ),
                },
              ]}
            />
          </>
        )}
      </Drawer>

      <Modal
        title={editing === "new" ? "Add customer" : "Edit customer"}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={save}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={t("customers.name", "Name")}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="phone"
            label={t("customers.phoneNumber", "Phone number")}
            rules={[{ required: true }]}
          >
            <Input placeholder="+62…" />
          </Form.Item>
          <Form.Item name="address" label={t("customers.address", "Address")}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            name="referralSourceId"
            label={t(
              "customers.whereDoTheyKnowThe",
              "Where do they know the store from?",
            )}
          >
            <Select
              allowClear
              options={db.referralSources
                .filter((r) => r.active)
                .map((r) => ({ value: r.id, label: r.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
