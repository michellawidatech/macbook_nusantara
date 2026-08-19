/**
 * The reference data every other screen reads from: warehouses and their racks,
 * suppliers, the reason lists, and the channels a reservation or a customer can
 * come in through.
 *
 * Nothing here is ever deleted. A warehouse that has held stock, a reason that
 * has been used, a supplier a PO points at — deleting any of them would orphan
 * history, so everything is deactivated instead and stops being offered in new
 * forms while the old records keep resolving.
 */
import { useState } from "react";
import {
  App,
  Button,
  Card,
  Empty,
  Flex,
  Form,
  Input,
  Segmented,
  Select,
  Switch,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { PageContainer } from "../../components/PageContainer";
import { DataTable } from "../../components/DataTable";
import { ProTable } from "../../components/ProTable";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { fmtRp } from "../../lib/format.js";
import { useDb, mutate, nextId } from "../../mock/store.js";
import type { ReasonActivity } from "../../mock/seed.js";

const REASON_ACTIVITIES: {
  value: ReasonActivity;
  label: string;
  help: string;
}[] = [
  {
    value: "ADJUSTMENT",
    label: "Stock adjustment",
    help: "Offered on the Add adjustment form. Typing a new reason there adds it to this list automatically.",
  },
  {
    value: "RETURN_CUSTOMER",
    label: "Return from customer",
    help: "Offered when recording a customer return. A reason named “Other” makes the form ask for details.",
  },
  {
    value: "RETURN_SUPPLIER",
    label: "Return to supplier",
    help: "Offered when returning a unit to its supplier, and used by QC rejections.",
  },
];

export function SettingsPage() {
  const db = useDb();
  const { message, modal } = App.useApp();
  const { compact } = useLayoutMode();
  const [whForm] = Form.useForm<{ name: string }>();
  const [rackForm] = Form.useForm<{ warehouseId: string; name: string }>();
  const [supForm] = Form.useForm<{
    name: string;
    phone?: string;
    address?: string;
  }>();
  const [reasonForm] = Form.useForm<{ label: string }>();
  const [rsvForm] = Form.useForm<{ name: string }>();
  const [refForm] = Form.useForm<{ name: string }>();
  const [smForm] = Form.useForm<{ name: string }>();
  const [activity, setActivity] = useState<ReasonActivity>("ADJUSTMENT");

  const unitsIn = (warehouseId: string) =>
    db.units.filter(
      (u) =>
        u.locationId === warehouseId &&
        !["TERJUAL", "RETUR_SUPPLIER"].includes(u.status),
    ).length;

  const warehouses = (
    <Flex vertical gap={16}>
      <Card title="Warehouses">
        <Typography.Paragraph type="secondary">
          Stock received by an account lands in that account's warehouse. Click
          a name to rename it. A warehouse holding stock can only be switched
          off, never deleted.
        </Typography.Paragraph>
        <Form
          form={whForm}
          layout={compact ? "vertical" : "inline"}
          className="responsive-controls"
          style={{ marginBottom: 16 }}
          onFinish={(v) => {
            mutate((d) => {
              d.warehouses.push({
                id: nextId("wh"),
                name: v.name,
                active: true,
              });
            });
            whForm.resetFields();
            message.success("Warehouse added.");
          }}
        >
          <Form.Item
            name="name"
            rules={[{ required: true, message: "Name it" }]}
          >
            <Input placeholder="New warehouse name" style={{ width: 260 }} />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            Add
          </Button>
        </Form>
        <DataTable
          rowKey="id"
          dataSource={db.warehouses}
          columns={[
            {
              title: "Name",
              key: "name",
              render: (_, w) => (
                <Typography.Text
                  // Rename in place: the owner asked for editable names, and a
                  // modal for one text field is a dialog nobody needs.
                  editable={{
                    onChange: (name) => {
                      const clean = name.trim();
                      if (!clean || clean === w.name) return;
                      mutate((d) => {
                        d.warehouses.find((x) => x.id === w.id)!.name = clean;
                      });
                      message.success("Warehouse renamed.");
                    },
                    tooltip: "Rename",
                  }}
                >
                  {w.name}
                </Typography.Text>
              ),
            },
            {
              title: "Units held",
              key: "units",
              render: (_, w) => unitsIn(w.id),
            },
            {
              title: "Racks",
              key: "racks",
              render: (_, w) =>
                db.racks.filter((r) => r.warehouseId === w.id && r.active)
                  .length,
            },
            {
              title: "Active",
              key: "active",
              render: (_, w) => (
                <Switch
                  size="small"
                  checked={w.active}
                  aria-label={`${w.active ? "Switch off" : "Switch on"} ${w.name}`}
                  onChange={(on) => {
                    if (!on && unitsIn(w.id) > 0) {
                      return void modal.confirm({
                        title: `Switch off ${w.name}?`,
                        content: `It still holds ${unitsIn(w.id)} unit(s). They stay where they are and keep resolving — the warehouse just stops being offered on new forms.`,
                        onOk: () =>
                          mutate((d) => {
                            d.warehouses.find((x) => x.id === w.id)!.active =
                              false;
                          }),
                      });
                    }
                    mutate((d) => {
                      d.warehouses.find((x) => x.id === w.id)!.active = on;
                    });
                  }}
                />
              ),
            },
          ]}
        />
      </Card>

      <Card title="Locations inside a warehouse">
        <Typography.Paragraph type="secondary">
          The racks a unit can be filed onto at QC. Each one belongs to a
          warehouse, because "Rack 1" in Warehouse 2 is a different shelf from
          "Rack 1" in Warehouse 1.
        </Typography.Paragraph>
        <Form
          form={rackForm}
          layout={compact ? "vertical" : "inline"}
          className="responsive-controls"
          style={{ marginBottom: 16 }}
          initialValues={{ warehouseId: db.myWarehouseId }}
          onFinish={(v) => {
            mutate((d) => {
              d.racks.push({
                id: nextId("rack"),
                warehouseId: v.warehouseId,
                name: v.name,
                active: true,
              });
            });
            rackForm.resetFields();
            rackForm.setFieldsValue({ warehouseId: v.warehouseId });
            message.success("Location added.");
          }}
        >
          <Form.Item name="warehouseId" rules={[{ required: true }]}>
            <Select
              style={{ width: 200 }}
              options={db.warehouses.map((w) => ({
                value: w.id,
                label: w.name,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="name"
            rules={[{ required: true, message: "Name it" }]}
          >
            <Input placeholder="e.g. Rack 4" style={{ width: 200 }} />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            Add
          </Button>
        </Form>
        <ProTable
          rowKey="id"
          dataSource={db.racks}
          searchPlaceholder="Search a location"
          columns={[
            {
              title: "Warehouse",
              key: "wh",
              facet: true,
              sortValue: (r) =>
                db.warehouses.find((w) => w.id === r.warehouseId)?.name,
              render: (_, r) =>
                db.warehouses.find((w) => w.id === r.warehouseId)?.name,
            },
            {
              title: "Location",
              key: "name",
              searchable: true,
              sortValue: (r) => r.name,
              render: (_, r) => (
                <Typography.Text
                  editable={{
                    onChange: (name) => {
                      const clean = name.trim();
                      if (!clean || clean === r.name) return;
                      mutate((d) => {
                        d.racks.find((x) => x.id === r.id)!.name = clean;
                      });
                      message.success("Location renamed.");
                    },
                    tooltip: "Rename",
                  }}
                >
                  {r.name}
                </Typography.Text>
              ),
            },
            {
              title: "Units on it",
              key: "units",
              sortValue: (r) =>
                db.units.filter((u) => u.rackId === r.id).length,
              render: (_, r) =>
                db.units.filter((u) => u.rackId === r.id).length,
            },
            {
              title: "Active",
              key: "active",
              render: (_, r) => (
                <Switch
                  size="small"
                  checked={r.active}
                  aria-label={`${r.active ? "Switch off" : "Switch on"} ${r.name}`}
                  onChange={(on) =>
                    mutate((d) => {
                      d.racks.find((x) => x.id === r.id)!.active = on;
                    })
                  }
                />
              ),
            },
          ]}
        />
      </Card>
    </Flex>
  );

  const suppliers = (
    <Card title="Suppliers">
      <Typography.Paragraph type="secondary">
        Who stock is bought from. Only the name is required — a one-off supplier
        at a swap meet has no address to record. Names typed straight into a
        Purchase Order land here too.
      </Typography.Paragraph>
      <Form
        form={supForm}
        layout={compact ? "vertical" : "inline"}
        className="responsive-controls"
        style={{ marginBottom: 16, rowGap: 12 }}
        onFinish={(v) => {
          if (
            db.suppliers.some(
              (s) => s.name.toLowerCase() === v.name.trim().toLowerCase(),
            )
          ) {
            return void message.warning(
              "A supplier with that name already exists.",
            );
          }
          mutate((d) => {
            d.suppliers.push({
              id: nextId("sup"),
              name: v.name.trim(),
              phone: v.phone?.trim() || undefined,
              address: v.address?.trim() || undefined,
            });
          });
          supForm.resetFields();
          message.success("Supplier added.");
        }}
      >
        <Form.Item
          name="name"
          label={compact ? "Supplier name" : undefined}
          rules={[{ required: true, message: "Name it" }]}
        >
          <Input placeholder="Supplier name" style={{ width: 240 }} />
        </Form.Item>
        <Form.Item
          name="phone"
          label={compact ? "Phone (optional)" : undefined}
        >
          <Input placeholder="Phone (optional)" style={{ width: 200 }} />
        </Form.Item>
        <Form.Item
          name="address"
          label={compact ? "Address (optional)" : undefined}
        >
          <Input placeholder="Address (optional)" style={{ width: 280 }} />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          Add
        </Button>
      </Form>
      <ProTable
        rowKey="id"
        dataSource={db.suppliers}
        searchPlaceholder="Search supplier, phone or address"
        columns={[
          {
            title: "Supplier",
            key: "name",
            searchable: true,
            sortValue: (s) => s.name,
            render: (_, s) => (
              <Typography.Text
                editable={{
                  onChange: (name) => {
                    const clean = name.trim();
                    if (!clean || clean === s.name) return;
                    mutate((d) => {
                      d.suppliers.find((x) => x.id === s.id)!.name = clean;
                    });
                    message.success("Supplier renamed.");
                  },
                  tooltip: "Rename",
                }}
              >
                {s.name}
              </Typography.Text>
            ),
          },
          {
            title: "Phone",
            key: "phone",
            searchable: true,
            sortValue: (s) => s.phone ?? "",
            render: (_, s) => (
              <Typography.Text
                type={s.phone ? undefined : "secondary"}
                editable={{
                  onChange: (phone) =>
                    mutate((d) => {
                      d.suppliers.find((x) => x.id === s.id)!.phone =
                        phone.trim() || undefined;
                    }),
                  tooltip: "Edit phone",
                }}
              >
                {s.phone ?? "—"}
              </Typography.Text>
            ),
          },
          {
            title: "Address",
            key: "address",
            searchable: true,
            sortValue: (s) => s.address ?? "",
            render: (_, s) => (
              <Typography.Text
                type={s.address ? undefined : "secondary"}
                editable={{
                  onChange: (address) =>
                    mutate((d) => {
                      d.suppliers.find((x) => x.id === s.id)!.address =
                        address.trim() || undefined;
                    }),
                  tooltip: "Edit address",
                }}
              >
                {s.address ?? "—"}
              </Typography.Text>
            ),
          },
          {
            title: "Purchase orders",
            key: "pos",
            sortValue: (s) =>
              db.pos.filter((p) => p.supplierId === s.id).length,
            render: (_, s) =>
              db.pos.filter((p) => p.supplierId === s.id).length,
          },
          {
            title: "Open returns",
            key: "returns",
            sortValue: (s) =>
              db.returns.filter((r) => r.supplierId === s.id).length,
            render: (_, s) => {
              const n = db.returns.filter((r) => r.supplierId === s.id).length;
              return n > 0 ? <Tag color="orange">{n}</Tag> : "—";
            },
          },
        ]}
      />
    </Card>
  );

  const current = REASON_ACTIVITIES.find((a) => a.value === activity)!;
  const rows = db.reasons.filter((r) => r.activity === activity);

  const reasons = (
    <Card title="Reasons per activity">
      <Typography.Paragraph type="secondary">
        {current.help}
      </Typography.Paragraph>
      <Segmented
        value={activity}
        onChange={(v) => setActivity(v as ReasonActivity)}
        options={REASON_ACTIVITIES.map((a) => ({
          value: a.value,
          label: a.label,
        }))}
        style={{ marginBottom: 16 }}
        block={compact}
      />
      <Form
        form={reasonForm}
        layout={compact ? "vertical" : "inline"}
        className="responsive-controls"
        style={{ marginBottom: 16 }}
        onFinish={(v) => {
          const clean = v.label.trim();
          if (
            db.reasons.some(
              (r) =>
                r.activity === activity &&
                r.label.toLowerCase() === clean.toLowerCase(),
            )
          ) {
            return void message.warning("That reason is already on this list.");
          }
          mutate((d) => {
            d.reasons.push({
              id: nextId("rsn"),
              activity,
              label: clean,
              active: true,
            });
          });
          reasonForm.resetFields();
          message.success(
            `"${clean}" added to ${current.label.toLowerCase()} reasons.`,
          );
        }}
      >
        <Form.Item
          name="label"
          rules={[{ required: true, message: "Name it" }]}
        >
          <Input
            placeholder={`New ${current.label.toLowerCase()} reason`}
            style={{ width: 280 }}
          />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          Add
        </Button>
      </Form>
      {rows.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No reasons on this list yet."
        />
      ) : (
        <DataTable
          rowKey="id"
          dataSource={rows}
          columns={[
            {
              title: "Reason",
              key: "label",
              render: (_, r) => (
                <Typography.Text
                  editable={{
                    onChange: (label) => {
                      const clean = label.trim();
                      if (!clean || clean === r.label) return;
                      mutate((d) => {
                        d.reasons.find((x) => x.id === r.id)!.label = clean;
                      });
                      message.success("Reason renamed.");
                    },
                    tooltip: "Rename",
                  }}
                >
                  {r.label}
                </Typography.Text>
              ),
            },
            {
              title: "Used by",
              key: "used",
              render: (_, r) => {
                const n =
                  db.adjustments.filter((a) => a.reasonId === r.id).length +
                  db.returns.filter((x) => x.reason === r.label).length;
                return n > 0 ? `${n} record(s)` : "—";
              },
            },
            {
              title: "Offered",
              key: "active",
              render: (_, r) => (
                <Switch
                  size="small"
                  checked={r.active}
                  aria-label={`${r.active ? "Stop offering" : "Offer"} ${r.label}`}
                  onChange={(on) =>
                    mutate((d) => {
                      d.reasons.find((x) => x.id === r.id)!.active = on;
                    })
                  }
                />
              ),
            },
          ]}
        />
      )}
    </Card>
  );

  const sources = (
    <Flex vertical gap={16}>
      <Card title="Reservation channels">
        <Typography.Paragraph type="secondary">
          Where a hold came in from — offered on the reservation form, and used
          to prefill the sale's channel when a reservation is sold.
        </Typography.Paragraph>
        <Form
          form={rsvForm}
          layout={compact ? "vertical" : "inline"}
          className="responsive-controls"
          style={{ marginBottom: 16 }}
          onFinish={(v) => {
            mutate((d) => {
              d.reservationSources.push({
                id: nextId("rsvsrc"),
                name: v.name,
                active: true,
              });
            });
            rsvForm.resetFields();
            message.success("Channel added.");
          }}
        >
          <Form.Item
            name="name"
            rules={[{ required: true, message: "Name it" }]}
          >
            <Input
              placeholder="e.g. Facebook Marketplace"
              style={{ width: 260 }}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            Add
          </Button>
        </Form>
        <DataTable
          rowKey="id"
          dataSource={db.reservationSources}
          columns={[
            { title: "Channel", dataIndex: "name" },
            {
              title: "Reservations",
              key: "n",
              render: (_, s) =>
                db.reservations.filter((r) => r.sourceId === s.id).length,
            },
            {
              title: "Active",
              key: "active",
              render: (_, s) => (
                <Switch
                  size="small"
                  checked={s.active}
                  aria-label={`${s.active ? "Switch off" : "Switch on"} ${s.name}`}
                  onChange={(on) =>
                    mutate((d) => {
                      d.reservationSources.find((x) => x.id === s.id)!.active =
                        on;
                    })
                  }
                />
              ),
            },
          ]}
        />
      </Card>

      <Card title="Referral sources">
        <Typography.Paragraph type="secondary">
          How a customer heard of the shop. Marketing spend is scored against
          these on the Cashflow page, so a channel you advertise on should exist
          here.
        </Typography.Paragraph>
        <Form
          form={refForm}
          layout={compact ? "vertical" : "inline"}
          className="responsive-controls"
          style={{ marginBottom: 16 }}
          onFinish={(v) => {
            mutate((d) => {
              d.referralSources.push({
                id: nextId("ref"),
                name: v.name,
                active: true,
              });
            });
            refForm.resetFields();
            message.success("Referral source added.");
          }}
        >
          <Form.Item
            name="name"
            rules={[{ required: true, message: "Name it" }]}
          >
            <Input placeholder="e.g. Google Maps" style={{ width: 260 }} />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            Add
          </Button>
        </Form>
        <DataTable
          rowKey="id"
          dataSource={db.referralSources}
          columns={[
            { title: "Source", dataIndex: "name" },
            {
              title: "Customers",
              key: "n",
              render: (_, r) =>
                db.customers.filter((c) => c.referralSourceId === r.id).length,
            },
            {
              title: "Active",
              key: "active",
              render: (_, r) => (
                <Switch
                  size="small"
                  checked={r.active}
                  aria-label={`${r.active ? "Switch off" : "Switch on"} ${r.name}`}
                  onChange={(on) =>
                    mutate((d) => {
                      d.referralSources.find((x) => x.id === r.id)!.active = on;
                    })
                  }
                />
              ),
            },
          ]}
        />
      </Card>
    </Flex>
  );

  /**
   * Per-salesperson totals.
   *
   * Deliberately three plain numbers rather than a dashboard: this is the list
   * that OWNS the salesperson, and the point of showing sales beside each name
   * is so nobody switches off a person who has half the quarter's revenue
   * attached to them. The real KPI screen, when it arrives, reads the same
   * `salesmanId` this list writes.
   */
  const salesStats = (id: string) => {
    const orders = db.orders.filter((o) => o.salesmanId === id);
    return {
      orders: orders.length,
      units: orders.reduce((t, o) => t + o.serials.length, 0),
      revenue: orders.reduce((t, o) => t + o.total, 0),
    };
  };

  const salespeople = (
    <Card title="Salespeople">
      <Typography.Paragraph type="secondary">
        Who a sale can be credited to on Stock Out. A salesperson who has left
        is switched off, never deleted — the sales they made stay theirs, and
        every per-staff figure is built on this list.
      </Typography.Paragraph>
      <Form
        form={smForm}
        layout={compact ? "vertical" : "inline"}
        className="responsive-controls"
        style={{ marginBottom: 16 }}
        onFinish={(v) => {
          const clean = v.name.trim();
          if (
            db.salesmen.some(
              (x) => x.name.toLowerCase() === clean.toLowerCase(),
            )
          ) {
            return void message.warning(
              "Somebody with that name is already on the list.",
            );
          }
          mutate((d) => {
            d.salesmen.push({ id: nextId("sm"), name: clean, active: true });
          });
          smForm.resetFields();
          message.success(`${clean} added.`);
        }}
      >
        <Form.Item
          name="name"
          rules={[{ required: true, message: "Name them" }]}
        >
          <Input placeholder="Full name" style={{ width: 260 }} />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          Add
        </Button>
      </Form>
      <ProTable
        rowKey="id"
        dataSource={db.salesmen}
        searchPlaceholder="Search a name"
        columns={[
          {
            title: "Salesperson",
            key: "name",
            searchable: true,
            sortValue: (x) => x.name,
            render: (_, x) => (
              <Typography.Text
                editable={{
                  onChange: (name) => {
                    const clean = name.trim();
                    if (!clean || clean === x.name) return;
                    mutate((d) => {
                      d.salesmen.find((y) => y.id === x.id)!.name = clean;
                    });
                    message.success("Name updated.");
                  },
                  tooltip: "Rename",
                }}
              >
                {x.name}
              </Typography.Text>
            ),
          },
          {
            title: "Sales",
            key: "orders",
            align: "right",
            sortValue: (x) => salesStats(x.id).orders,
            render: (_, x) => salesStats(x.id).orders,
          },
          {
            title: "Units sold",
            key: "units",
            align: "right",
            sortValue: (x) => salesStats(x.id).units,
            render: (_, x) => salesStats(x.id).units,
          },
          {
            title: "Revenue",
            key: "revenue",
            align: "right",
            defaultSortOrder: "descend",
            sortValue: (x) => salesStats(x.id).revenue,
            render: (_, x) => fmtRp(salesStats(x.id).revenue),
          },
          {
            title: "Offered",
            key: "active",
            width: 90,
            render: (_, x) => (
              <Switch
                size="small"
                checked={x.active}
                aria-label={`${x.active ? "Switch off" : "Switch on"} ${x.name}`}
                onChange={(on) => {
                  const { orders } = salesStats(x.id);
                  if (!on && orders > 0) {
                    return void modal.confirm({
                      title: `Switch off ${x.name}?`,
                      content: `${orders} sale(s) are credited to them. Those stay exactly as they are — the name just stops being offered on new sales.`,
                      onOk: () =>
                        mutate((d) => {
                          d.salesmen.find((y) => y.id === x.id)!.active = false;
                        }),
                    });
                  }
                  mutate((d) => {
                    d.salesmen.find((y) => y.id === x.id)!.active = on;
                  });
                }}
              />
            ),
          },
        ]}
      />
    </Card>
  );

  const account = (
    <Card title="My account">
      <Form layout="vertical" style={{ maxWidth: 420 }}>
        <Form.Item
          label="Default warehouse"
          tooltip="Stock In from this account goes here"
        >
          <Select
            value={db.myWarehouseId}
            options={db.warehouses
              .filter((w) => w.active)
              .map((w) => ({ value: w.id, label: w.name }))}
            onChange={(v) =>
              mutate((d) => {
                d.myWarehouseId = v;
              })
            }
          />
        </Form.Item>
      </Form>
    </Card>
  );

  return (
    <PageContainer title="Settings">
      <Tabs
        items={[
          { key: "wh", label: "Warehouses & locations", children: warehouses },
          { key: "sup", label: "Suppliers", children: suppliers },
          { key: "rsn", label: "Reasons", children: reasons },
          { key: "src", label: "Channels", children: sources },
          { key: "sm", label: "Salespeople", children: salespeople },
          { key: "acc", label: "Account", children: account },
        ]}
      />
    </PageContainer>
  );
}
