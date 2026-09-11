/**
 * Customers — contact, referral, their transaction history, and their money.
 *
 * ## Taking a payment here (owner ask 2026-09-09)
 *
 * > *"For the user, we can add payment (the user pay for the product, and the
 * > payment can link to specific transaction history), and add a due date of
 * > payment."*
 *
 * A customer who owes for two sales pays for ONE of them, and which one is not
 * a detail — it is the whole fact. So the payment is recorded on the order's
 * own row in this drawer, not against the person: the drawer already lists
 * every sale with what each still owes, which makes "the December one" a thing
 * somebody can point at rather than a sum they have to apportion.
 *
 * It opens `components/PaymentsModal`, the same dialog Transaction History
 * uses. Deliberately the same: a payment recorded from a customer's drawer and
 * one recorded from the receipt are the same event, and two dialogs that write
 * the same rows are two places for the rules to drift. The due date comes free
 * with it — `PaymentsPanel` asks for one on any part marked DUE, which is what
 * makes a promise to pay a date somebody can chase rather than a note.
 */
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
  Typography,
} from "antd";
import {
  EditOutlined,
  HistoryOutlined,
  PlusOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { DataTable } from "../../components/DataTable";
import { FilterBar } from "../../components/FilterBar";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { PaymentsModal } from "../../components/PaymentsModal";
import { fmtRp, fmtDate, fmtDateTime } from "../../lib/format.js";
import {
  customerBalance,
  isSettled,
  paymentsOf,
  saleBalance,
  type SalePayment,
} from "../../lib/salePayments.js";
import { diffPayments } from "../../lib/paymentEdits.js";
import { TYPE } from "../../theme/tokens";
import { useDb, mutate, nextId } from "../../mock/store.js";
import type { Customer, Order } from "../../mock/seed.js";
import { useTranslation } from "react-i18next";

export function CustomersPage() {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();
  const { compact } = useLayoutMode();
  const [form] = Form.useForm();
  const [viewing, setViewing] = useState<Customer | null>(null);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  /** The sale whose money is being recorded or corrected. */
  const [paying, setPaying] = useState<Order | null>(null);
  const [q, setQ] = useState("");

  const rows = db.customers.filter((c) =>
    `${c.name} ${c.phone}`.toLowerCase().includes(q.toLowerCase()),
  );
  const ordersOf = (id: string) => db.orders.filter((o) => o.customerId === id);
  /** What one customer owes across every sale of theirs. */
  const balanceOf = (id: string) => customerBalance(id, db.orders);
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

  /**
   * Write one sale's money back, with a log row per change.
   *
   * The same three steps Transaction History takes, and for the same reasons:
   * `Order.settled` is a PROJECTION over the payments and is rewritten in the
   * same `mutate` that changes them — the rule `Unit.status` follows — and
   * `diffPayments` turns the before and after into the log rows that make an
   * edit safe to allow at all. See `lib/paymentEdits.ts`.
   */
  const savePayments = (order: Order, next: SalePayment[], reason: string) => {
    const rows = diffPayments(paymentsOf(order), next, {
      at: new Date().toISOString(),
      staff: "Michella",
      ...(reason ? { reason } : {}),
    });
    mutate((d) => {
      const o = d.orders.find((x) => x.id === order.id);
      if (!o) return;
      o.payments = next;
      o.settled = isSettled(o.total, next);
      for (const row of rows) {
        d.paymentLog.push({ id: nextId("plog"), ...row });
      }
    });
    setPaying(null);
    message.success(
      rows.length === 0
        ? t("customers.payUnchanged", "Nothing changed.")
        : t("customers.payLogged", "{{n}} change(s) recorded.", {
            n: rows.length,
          }),
    );
  };

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
              /*
               * What this person still owes, and what a marketplace is still
               * holding for their sales (owner ask 2026-09-08).
               *
               * *"In customer management, we know how much a customer still
               * owes us, the pending from tokopedia/shopee, from split
               * payment."* The two are shown apart and only the first is red:
               * a platform sitting on a payout is not this person failing to
               * pay, and a shop that rings them about it loses the customer.
               */
              title: t("customers.owes", "Owes"),
              align: "right",
              width: 190,
              render: (_, c) => {
                const b = balanceOf(c.id);
                if (b.owed === 0 && b.pending === 0) {
                  return <Typography.Text type="secondary">—</Typography.Text>;
                }
                return (
                  <Flex vertical align="flex-end" gap={0}>
                    {b.owed > 0 && (
                      <Typography.Text type="danger" strong>
                        {fmtRp(b.owed)}
                      </Typography.Text>
                    )}
                    {b.pending > 0 && (
                      <Typography.Text
                        type="warning"
                        style={{ fontSize: TYPE.sm }}
                      >
                        {t("customers.pendingWith", "{{amount}} at a marketplace", {
                          amount: fmtRp(b.pending),
                        })}
                      </Typography.Text>
                    )}
                    {b.nextDueAt && (
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: TYPE.sm }}
                      >
                        {t("customers.dueOn", "due {{date}}", {
                          date: fmtDate(b.nextDueAt),
                        })}
                      </Typography.Text>
                    )}
                  </Flex>
                );
              },
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
                  /*
                   * Three answers, not two. The old pair could not tell a
                   * marketplace holding a payout from a customer who has not
                   * paid — which is the only distinction this drawer is for.
                   */
                  title: t("customers.money", "Money"),
                  render: (_, o) => {
                    const b = saleBalance(o.total, paymentsOf(o));
                    if (b.fullySettled) {
                      return (
                        <Tag color="green">
                          {t("customers.moneySettled", "Settled")}
                        </Tag>
                      );
                    }
                    return (
                      <Flex vertical gap={2} align="flex-start">
                        {b.customerOwes > 0 && (
                          <Tag color="red">
                            {t("customers.moneyOwed", "Owes {{amount}}", {
                              amount: fmtRp(b.customerOwes),
                            })}
                          </Tag>
                        )}
                        {b.pending > 0 && (
                          <Tag color="orange">
                            {t("customers.moneyPending", "{{amount}} at a marketplace", {
                              amount: fmtRp(b.pending),
                            })}
                          </Tag>
                        )}
                        {/*
                         * When they promised to pay, on the row of the sale
                         * they promised it for (owner ask 2026-09-09). A due
                         * date against the PERSON would be unchaseable the
                         * moment they owe for two things.
                         */}
                        {b.nextDueAt && (
                          <Typography.Text
                            type="secondary"
                            style={{ fontSize: TYPE.sm }}
                          >
                            {t("customers.dueOn", "due {{date}}", {
                              date: fmtDate(b.nextDueAt),
                            })}
                          </Typography.Text>
                        )}
                      </Flex>
                    );
                  },
                },
                {
                  /*
                   * Taking a payment for THIS sale (owner ask 2026-09-09).
                   *
                   * On the row rather than in the drawer's header, because
                   * which sale the money is for is the fact being recorded.
                   * Offered on a settled sale too: correcting a figure
                   * somebody typed wrong is the other half of what the dialog
                   * is for, and a button that disappears once a bill is paid
                   * is a button nobody can use to fix it.
                   */
                  title: "",
                  width: 56,
                  render: (_, o) => (
                    <Tooltip
                      title={t("customers.recordPayment", "Record a payment")}
                    >
                      <Button
                        size="small"
                        type="text"
                        icon={<WalletOutlined />}
                        aria-label={t(
                          "customers.recordPaymentAria",
                          "Record a payment for {{code}}",
                          { code: o.code },
                        )}
                        onClick={() => setPaying(o)}
                      />
                    </Tooltip>
                  ),
                },
              ]}
            />
          </>
        )}
      </Drawer>

      <PaymentsModal
        open={paying !== null}
        code={paying?.code ?? ""}
        total={paying?.total ?? 0}
        payments={paying ? paymentsOf(paying) : []}
        log={
          paying
            ? db.paymentLog
                .filter((e) =>
                  paymentsOf(paying).some((p) => p.id === e.paymentId),
                )
                .slice()
                .sort((a, b) => b.at.localeCompare(a.at))
            : []
        }
        methods={db.paymentMethods
          .filter((m) => m.forSale && m.active)
          .map((m) => ({ value: m.code, label: m.label }))}
        onClose={() => setPaying(null)}
        onSave={(next, reason) => paying && savePayments(paying, next, reason)}
      />

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
