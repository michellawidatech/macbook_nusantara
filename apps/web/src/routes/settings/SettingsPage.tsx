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
  Divider,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { EditOutlined } from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { CategorySettings } from "./CategorySettings.js";
import { GradingSettings } from "./GradingSettings.js";
import { ScannerSettings } from "./ScannerSettings.js";
import { StaffAccountsSettings } from "./StaffAccountsSettings.js";
import { ChangePasswordForm } from "../../components/ChangePasswordForm.js";
import { useSession } from "../../lib/session.js";
import { DataTable } from "../../components/DataTable";
import { ProTable } from "../../components/ProTable";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { fmtRp } from "../../lib/format.js";
import { upsellOn } from "../../lib/pos.js";
import {
  SUPPLIER_CODE_LENGTH,
  SUPPLIER_CODE_PATTERN,
} from "../../lib/serialScan.js";
import { useDb, mutate, nextId } from "../../mock/store.js";
import {
  BATTERY_GRADE_COLOR,
  batteryBands,
  batterySettingsFrom,
  cycleBands,
  CYCLE_COUNT_MAX,
  thresholdsFrom,
} from "../../lib/battery.js";
import { FORM_CENTRE, SPACE } from "../../theme/tokens";
import { Link } from "react-router-dom";
import { SALE_CHANNELS } from "../../lib/channels.js";
import { commissionPctOf } from "../../lib/marketplace.js";
import { DEFAULT_MARKETPLACE_MARKUP_PCT } from "../../lib/unitPrice.js";
import type { ReasonActivity, Supplier } from "../../mock/seed.js";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const db = useDb();
  // Cached by the auth gate; the Settings page never renders without it.
  const me = useSession().data ?? null;
  const { message, modal } = App.useApp();
  const { compact } = useLayoutMode();
  const [whForm] = Form.useForm<{ name: string }>();
  const [rackForm] = Form.useForm<{ warehouseId: string; name: string }>();
  const [supForm] = Form.useForm<{
    name: string;
    phone?: string;
    address?: string;
    /** The two-letter serial prefix. See `Supplier.code`. */
    code?: string;
  }>();
  const [reasonForm] = Form.useForm<{ label: string }>();
  const [rsvForm] = Form.useForm<{ name: string }>();
  const [refForm] = Form.useForm<{ name: string }>();
  const [smForm] = Form.useForm<{ name: string }>();
  const [shopForm] = Form.useForm<{
    shopName: string;
    shopTagline: string;
    shopAddress: string;
    shopContact: string;
  }>();
  const [activity, setActivity] = useState<ReasonActivity>("ADJUSTMENT");
  /**
   * The supplier open in the edit dialog, or null when it is closed.
   *
   * Suppliers get a dialog where every other list on this page gets an inline
   * rename, and the difference is how many fields a row has. A warehouse or a
   * salesperson IS its name, so antd's `Typography.Text editable` — a pencil
   * beside the word — is exactly right. A supplier has three editable fields,
   * which the same treatment turned into three pencils on one row: three
   * separate edits, three separate saves, and no way to tell at a glance which
   * pencil belonged to which value (owner report 2026-08-26). One button per
   * row, one dialog, one save.
   */
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [supEditForm] = Form.useForm<{
    name: string;
    phone?: string;
    address?: string;
    code?: string;
  }>();

  const unitsIn = (warehouseId: string) =>
    db.units.filter(
      (u) =>
        u.locationId === warehouseId &&
        !["TERJUAL", "RETUR_SUPPLIER"].includes(u.status),
    ).length;

  const warehouses = (
    <Flex vertical gap={16}>
      <Card title={t("settings.warehouses", "Warehouses")}>
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
            rules={[{ required: true, message: t("form.nameIt", "Name it") }]}
          >
            <Input
              placeholder={t("settings.newWarehouseName", "New warehouse name")}
              style={{ width: 260 }}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            {t("settings.add", "Add")}
          </Button>
        </Form>
        <DataTable
          rowKey="id"
          dataSource={db.warehouses}
          columns={[
            {
              title: t("settings.name", "Name"),
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
                    tooltip: t("settings.rename", "Rename"),
                  }}
                >
                  {w.name}
                </Typography.Text>
              ),
            },
            {
              title: t("settings.unitsHeld", "Units held"),
              key: "units",
              render: (_, w) => unitsIn(w.id),
            },
            {
              title: t("settings.racks", "Racks"),
              key: "racks",
              render: (_, w) =>
                db.racks.filter((r) => r.warehouseId === w.id && r.active)
                  .length,
            },
            {
              title: t("settings.active", "Active"),
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

      <Card
        title={t(
          "settings.locationsInsideAWarehouse",
          "Locations inside a warehouse",
        )}
      >
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
            rules={[{ required: true, message: t("form.nameIt", "Name it") }]}
          >
            <Input
              placeholder={t("settings.eGRack4", "e.g. Rack 4")}
              style={{ width: 200 }}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            {t("settings.add", "Add")}
          </Button>
        </Form>
        <ProTable
          rowKey="id"
          dataSource={db.racks}
          searchPlaceholder={t("settings.searchALocation", "Search a location")}
          columns={[
            {
              title: t("settings.warehouse", "Warehouse"),
              key: "wh",
              facet: true,
              sortValue: (r) =>
                db.warehouses.find((w) => w.id === r.warehouseId)?.name,
              render: (_, r) =>
                db.warehouses.find((w) => w.id === r.warehouseId)?.name,
            },
            {
              title: t("settings.location", "Location"),
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
                    tooltip: t("settings.rename", "Rename"),
                  }}
                >
                  {r.name}
                </Typography.Text>
              ),
            },
            {
              title: t("settings.unitsOnIt", "Units on it"),
              key: "units",
              sortValue: (r) =>
                db.units.filter((u) => u.rackId === r.id).length,
              render: (_, r) =>
                db.units.filter((u) => u.rackId === r.id).length,
            },
            {
              title: t("settings.active", "Active"),
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

  /**
   * Opens the dialog on a supplier.
   *
   * Deliberately does NOT call `setFieldsValue`: the Modal below is
   * `destroyOnHidden`, so its Form does not exist yet at this point and
   * rc-field-form warns that the instance is "not connected to any Form
   * element". The dialog seeds itself from `initialValues` on mount instead,
   * which is the supported pairing with a destroyed-on-close Modal.
   */
  const openSupplierEdit = (supplier: Supplier) => setEditingSupplier(supplier);

  /**
   * Saves all three fields at once.
   *
   * Only reached once `validateFields` passes, and the duplicate-name rule is
   * one of those validators — see the dialog. That matters for more than
   * tidiness: a check done HERE could only refuse with a toast, and because
   * antd closes a Modal whose `onOk` resolves, the refusal would take the
   * half-typed name down with it. As a field rule it rejects the validation,
   * so the dialog stays open and the reason renders under the input that
   * caused it.
   */
  const saveSupplierEdit = () =>
    supEditForm.validateFields().then((v) => {
      const target = editingSupplier!;
      mutate((d) => {
        const row = d.suppliers.find((x) => x.id === target.id)!;
        row.name = v.name.trim();
        // An emptied optional field goes back to absent rather than being
        // stored as "", so "—" keeps meaning "nobody filled this in".
        row.phone = v.phone?.trim() || undefined;
        row.address = v.address?.trim() || undefined;
        row.code = v.code?.trim().toUpperCase() || undefined;
      });
      setEditingSupplier(null);
      message.success(t("settings.supplierSaved", "Supplier updated."));
    });

  /**
   * What antd's `onOk` is handed.
   *
   * `saveSupplierEdit` rejects when a field rule fails — that is how the dialog
   * is kept open — and antd does not catch it, so a duplicate name printed
   * "Uncaught (in promise)" in the console every time. Swallowing it here is
   * right rather than lazy: `validateFields` has already painted the offending
   * field with its reason, so there is nothing left to report.
   */
  const onSupplierOk = () => saveSupplierEdit().catch(() => undefined);

  const suppliers = (
    <Card
      title={t("settings.suppliers", "Suppliers")}
      /*
       * The money moved out on 2026-09-08 (owner ask). What is left here is
       * the address book — a name, a phone, a code — which is genuinely a
       * setting: it changes once a year. What the shop OWES a supplier, and
       * which invoice a deposit settles, is checked before every transfer, and
       * a screen you visit annually is the wrong place for it.
       */
      extra={
        <Link to="/suppliers">
          {t("settings.supplierAccounts", "Invoices, deposits & what we owe")}
        </Link>
      }
    >
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
          const code = (v.code ?? "").trim().toUpperCase();
          if (code !== "" && !SUPPLIER_CODE_PATTERN.test(code)) {
            return void message.warning(
              t(
                "settings.supplierCodeShape",
                "A supplier code is exactly two capital letters.",
              ),
            );
          }
          if (code !== "" && db.suppliers.some((x) => x.code === code)) {
            return void message.warning(
              t(
                "settings.supplierCodeTaken",
                "{{code}} already belongs to another supplier.",
                { code },
              ),
            );
          }
          mutate((d) => {
            d.suppliers.push({
              id: nextId("sup"),
              name: v.name.trim(),
              phone: v.phone?.trim() || undefined,
              address: v.address?.trim() || undefined,
              code: code || undefined,
            });
          });
          supForm.resetFields();
          message.success("Supplier added.");
        }}
      >
        <Form.Item
          name="name"
          label={compact ? "Supplier name" : undefined}
          rules={[{ required: true, message: t("form.nameIt", "Name it") }]}
        >
          <Input
            placeholder={t("settings.supplierName", "Supplier name")}
            style={{ width: 240 }}
          />
        </Form.Item>
        {/*
         * The two-letter origin code that goes on the front of every serial
         * scanned in from this supplier (owner ask 2026-08-28) — see
         * `lib/serialScan.ts`. Suggested from the name as it is typed, and
         * only suggested: the shop's codes are the shop's to choose, and two
         * suppliers can easily suggest the same two letters.
         */}
        <Form.Item name="code" label={compact ? "Code" : undefined}>
          <Input
            placeholder={t("settings.supplierCodePlaceholder", "Code (AS)")}
            maxLength={SUPPLIER_CODE_LENGTH}
            style={{ width: 110, textTransform: "uppercase" }}
          />
        </Form.Item>
        <Form.Item
          name="phone"
          label={compact ? "Phone (optional)" : undefined}
        >
          <Input
            placeholder={t("settings.phoneOptional", "Phone (optional)")}
            style={{ width: 200 }}
          />
        </Form.Item>
        <Form.Item
          name="address"
          label={compact ? "Address (optional)" : undefined}
        >
          <Input
            placeholder={t("settings.addressOptional", "Address (optional)")}
            style={{ width: 280 }}
          />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          {t("settings.add", "Add")}
        </Button>
      </Form>
      <ProTable
        rowKey="id"
        dataSource={db.suppliers}
        searchPlaceholder={t(
          "settings.searchSupplierPhoneOrAddress",
          "Search supplier, phone or address",
        )}
        columns={[
          {
            title: t("settings.supplier", "Supplier"),
            key: "name",
            searchable: true,
            sortValue: (s) => s.name,
            render: (_, s) => <Typography.Text>{s.name}</Typography.Text>,
          },
          {
            /*
             * The prefix every serial scanned in from this supplier carries
             * (owner ask 2026-08-28). A supplier without one is not broken —
             * every supplier in the shop predates the scheme — but intake
             * cannot take a SCANNED serial for it, so the gap is worth
             * showing rather than leaving as an empty cell.
             */
            title: t("settings.supplierCode", "Code"),
            key: "code",
            width: 120,
            searchable: true,
            sortValue: (s) => s.code ?? "",
            render: (_, s) =>
              s.code ? (
                <Tag style={{ fontFamily: "monospace", marginInlineEnd: 0 }}>
                  {s.code}
                </Tag>
              ) : (
                <Tooltip
                  title={t(
                    "settings.supplierCodeMissing",
                    "Serials scanned in from this supplier will be refused until it has a two-letter code.",
                  )}
                >
                  <Typography.Text type="secondary">—</Typography.Text>
                </Tooltip>
              ),
          },
          {
            title: t("settings.phone", "Phone"),
            key: "phone",
            searchable: true,
            sortValue: (s) => s.phone ?? "",
            // Plain text now, and the muted dash is the only thing left of the
            // old inline editor: an unset optional field should still read as
            // "nobody filled this in" rather than as data.
            render: (_, s) => (
              <Typography.Text type={s.phone ? undefined : "secondary"}>
                {s.phone ?? "—"}
              </Typography.Text>
            ),
          },
          {
            title: t("settings.address", "Address"),
            key: "address",
            searchable: true,
            sortValue: (s) => s.address ?? "",
            render: (_, s) => (
              <Typography.Text type={s.address ? undefined : "secondary"}>
                {s.address ?? "—"}
              </Typography.Text>
            ),
          },
          {
            title: t("settings.purchaseOrders", "Purchase orders"),
            key: "pos",
            sortValue: (s) =>
              db.pos.filter((p) => p.supplierId === s.id).length,
            render: (_, s) =>
              db.pos.filter((p) => p.supplierId === s.id).length,
          },
          {
            title: t("settings.openReturns", "Open returns"),
            key: "returns",
            sortValue: (s) =>
              db.returns.filter((r) => r.supplierId === s.id).length,
            render: (_, s) => {
              const n = db.returns.filter((r) => r.supplierId === s.id).length;
              return n > 0 ? <Tag color="orange">{n}</Tag> : "—";
            },
          },
          {
            // Blank title — this codebase's convention for an actions column,
            // and what `DataTable` looks for when it drops the column to the
            // foot of a card on a phone.
            title: "",
            key: "actions",
            width: 60,
            render: (_, s) => (
              <Tooltip title={t("settings.editSupplier", "Edit supplier")}>
                <Button
                  type="text"
                  icon={<EditOutlined />}
                  aria-label={t("settings.editSupplierAria", "Edit {{name}}", {
                    name: s.name,
                  })}
                  onClick={() => openSupplierEdit(s)}
                />
              </Tooltip>
            ),
          },
        ]}
      />

      <Modal
        open={editingSupplier !== null}
        title={t("settings.editSupplier", "Edit supplier")}
        okText={t("settings.save", "Save")}
        onCancel={() => setEditingSupplier(null)}
        onOk={onSupplierOk}
        // Rebuilt per supplier rather than kept alive: the form is seeded in
        // `openSupplierEdit`, and a retained instance would show the previous
        // row's values for the frame before that lands.
        destroyOnHidden
      >
        <Form
          form={supEditForm}
          layout="vertical"
          // Seeded here rather than by `setFieldsValue`, because
          // `destroyOnHidden` means this Form mounts fresh for each supplier —
          // see `openSupplierEdit`.
          initialValues={{
            name: editingSupplier?.name ?? "",
            phone: editingSupplier?.phone ?? "",
            address: editingSupplier?.address ?? "",
            code: editingSupplier?.code ?? "",
          }}
        >
          <Form.Item
            name="name"
            label={t("settings.supplierName", "Supplier name")}
            rules={[
              {
                required: true,
                whitespace: true,
                message: t("settings.nameIt", "Name it"),
              },
              {
                // The same uniqueness rule the Add form applies, minus the row
                // being edited — without that exclusion, saving a supplier
                // without touching its name would refuse on the grounds that
                // it already exists.
                validator: (_, value: string | undefined) => {
                  const clean = (value ?? "").trim().toLowerCase();
                  const clash = db.suppliers.some(
                    (x) =>
                      x.id !== editingSupplier?.id &&
                      x.name.toLowerCase() === clean,
                  );
                  return clash
                    ? Promise.reject(
                        new Error(
                          t(
                            "settings.supplierExists",
                            "A supplier with that name already exists.",
                          ),
                        ),
                      )
                    : Promise.resolve();
                },
              },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="code"
            label={t("settings.supplierCodeLabel", "Serial code (optional)")}
            // Both rules are field validators rather than checks in `onOk`,
            // for the reason `saveSupplierEdit` explains: antd closes a Modal
            // whose `onOk` resolves, so a refusal there would take the
            // half-typed value down with it.
            rules={[
              {
                validator: (_, value: string | undefined) => {
                  const clean = (value ?? "").trim().toUpperCase();
                  if (clean === "") return Promise.resolve();
                  if (!SUPPLIER_CODE_PATTERN.test(clean)) {
                    return Promise.reject(
                      new Error(
                        t(
                          "settings.supplierCodeShape",
                          "A supplier code is exactly two capital letters.",
                        ),
                      ),
                    );
                  }
                  // Unique, because the code IS part of a serial: two
                  // suppliers sharing `AS` would put two different machines
                  // under one string, which is the one thing this database
                  // cannot have.
                  const clash = db.suppliers.some(
                    (x) => x.id !== editingSupplier?.id && x.code === clean,
                  );
                  return clash
                    ? Promise.reject(
                        new Error(
                          t(
                            "settings.supplierCodeTaken",
                            "{{code}} already belongs to another supplier.",
                            { code: clean },
                          ),
                        ),
                      )
                    : Promise.resolve();
                },
              },
            ]}
            extra={t(
              "settings.supplierCodeHelp",
              "Goes on the front of every serial scanned in from this supplier. A machine whose own barcode reads SBJ347203KLM is stored — and its sticker printed — as ASBJ347203KLM, and the scanner takes either.",
            )}
          >
            <Input
              maxLength={SUPPLIER_CODE_LENGTH}
              placeholder={t("settings.supplierCodePlaceholder", "Code (AS)")}
              style={{ width: 120, textTransform: "uppercase" }}
            />
          </Form.Item>
          <Form.Item
            name="phone"
            label={t("settings.phoneOptional", "Phone (optional)")}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="address"
            label={t("settings.addressOptional", "Address (optional)")}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );

  const current = REASON_ACTIVITIES.find((a) => a.value === activity)!;
  const rows = db.reasons.filter((r) => r.activity === activity);

  const reasons = (
    <Card title={t("settings.reasonsPerActivity", "Reasons per activity")}>
      <Typography.Paragraph type="secondary">
        {current.help}
      </Typography.Paragraph>
      <Segmented
        value={activity}
        onChange={(v) => setActivity(v as ReasonActivity)}
        // Translated HERE, not in the constant: `REASON_ACTIVITIES` is a
        // module-level array with no hook in scope, and its English IS the
        // catalogue key — the same arrangement `layouts/navigation.tsx` uses
        // for the nav labels, and for the same reason.
        options={REASON_ACTIVITIES.map((a) => ({
          value: a.value,
          label: t(a.label),
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
          rules={[{ required: true, message: t("form.nameIt", "Name it") }]}
        >
          <Input
            placeholder={`New ${current.label.toLowerCase()} reason`}
            style={{ width: 280 }}
          />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          {t("settings.add", "Add")}
        </Button>
      </Form>
      {rows.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t(
            "settings.noReasonsOnThisList",
            "No reasons on this list yet.",
          )}
        />
      ) : (
        <DataTable
          rowKey="id"
          dataSource={rows}
          columns={[
            {
              title: t("settings.reason", "Reason"),
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
                    tooltip: t("settings.rename", "Rename"),
                  }}
                >
                  {r.label}
                </Typography.Text>
              ),
            },
            {
              title: t("settings.usedBy", "Used by"),
              key: "used",
              render: (_, r) => {
                const n =
                  db.adjustments.filter((a) => a.reasonId === r.id).length +
                  db.returns.filter((x) => x.reason === r.label).length;
                return n > 0 ? `${n} record(s)` : "—";
              },
            },
            {
              title: t("settings.offered", "Offered"),
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
      <Card title={t("settings.reservationChannels", "Reservation channels")}>
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
            rules={[{ required: true, message: t("form.nameIt", "Name it") }]}
          >
            <Input
              placeholder={t(
                "settings.eGFacebookMarketplace",
                "e.g. Facebook Marketplace",
              )}
              style={{ width: 260 }}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            {t("settings.add", "Add")}
          </Button>
        </Form>
        <DataTable
          rowKey="id"
          dataSource={db.reservationSources}
          columns={[
            { title: t("settings.channel", "Channel"), dataIndex: "name" },
            {
              title: t("settings.reservations", "Reservations"),
              key: "n",
              render: (_, s) =>
                db.reservations.filter((r) => r.sourceId === s.id).length,
            },
            {
              title: t("settings.active", "Active"),
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

      <Card title={t("settings.referralSources", "Referral sources")}>
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
            rules={[{ required: true, message: t("form.nameIt", "Name it") }]}
          >
            <Input
              placeholder={t("settings.eGGoogleMaps", "e.g. Google Maps")}
              style={{ width: 260 }}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            {t("settings.add", "Add")}
          </Button>
        </Form>
        <DataTable
          rowKey="id"
          dataSource={db.referralSources}
          columns={[
            { title: t("settings.source", "Source"), dataIndex: "name" },
            {
              title: t("settings.customers", "Customers"),
              key: "n",
              render: (_, r) =>
                db.customers.filter((c) => c.referralSourceId === r.id).length,
            },
            {
              title: t("settings.active", "Active"),
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
      upsell: orders.reduce((t, o) => t + upsellOn(o), 0),
    };
  };

  const salespeople = (
    <Card title={t("settings.salespeople", "Salespeople")}>
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
          rules={[{ required: true, message: t("form.nameThem", "Name them") }]}
        >
          <Input
            placeholder={t("settings.fullName", "Full name")}
            style={{ width: 260 }}
          />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          {t("settings.add", "Add")}
        </Button>
      </Form>
      <ProTable
        rowKey="id"
        dataSource={db.salesmen}
        searchPlaceholder={t("settings.searchAName", "Search a name")}
        columns={[
          {
            title: t("settings.name", "Name"),
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
                  tooltip: t("settings.rename", "Rename"),
                }}
              >
                {x.name}
              </Typography.Text>
            ),
          },
          {
            title: t("settings.sales", "Sales"),
            key: "orders",
            align: "right",
            sortValue: (x) => salesStats(x.id).orders,
            render: (_, x) => salesStats(x.id).orders,
          },
          {
            title: t("settings.unitsSold", "Units sold"),
            key: "units",
            align: "right",
            sortValue: (x) => salesStats(x.id).units,
            render: (_, x) => salesStats(x.id).units,
          },
          {
            title: t("settings.unitSold", "Unit Sold"),
            key: "revenue",
            align: "right",
            defaultSortOrder: "descend",
            sortValue: (x) => salesStats(x.id).revenue,
            render: (_, x) => fmtRp(salesStats(x.id).revenue),
          },
          {
            /*
             * What they sold ABOVE the asking price (owner ask 2026-09-01).
             *
             * Revenue beside it says how much passed through their hands, and
             * that is mostly a fact about who was on shift when an expensive
             * machine sold. This is the part the salesperson actually did: the
             * shop asked X, they got X plus, and the difference is theirs.
             *
             * A sale that went out UNDER the list price does not subtract from
             * it — that is a bargain, and it lives on the sale's own record.
             * Netting the two would let one haggled machine erase a month of
             * upselling, which is not what the figure is for.
             */
            title: t("settings.upsell", "Upsell"),
            key: "upsell",
            align: "right",
            sortValue: (x) => salesStats(x.id).upsell,
            render: (_, x) => {
              const { upsell } = salesStats(x.id);
              return upsell > 0 ? (
                <Typography.Text type="success">
                  {fmtRp(upsell)}
                </Typography.Text>
              ) : (
                "—"
              );
            },
          },
          {
            title: t("settings.active", "Active"),
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
    <Flex vertical gap={SPACE.lg}>
      <Card title={t("settings.myAccount", "My account")}>
        <Form layout="vertical" style={{ ...FORM_CENTRE, maxWidth: 420 }}>
          <Form.Item
            label={t("settings.defaultWarehouse", "Default warehouse")}
            tooltip={t(
              "settings.stockInFromThisAccount",
              "Stock In from this account goes here",
            )}
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
      {me !== null && (
        <Card title={t("settings.changePassword", "Change password")}>
          <div style={{ ...FORM_CENTRE, maxWidth: 420 }}>
            <ChangePasswordForm
              username={me.username}
              onChanged={() =>
                message.success(
                  t(
                    "settings.passwordChanged",
                    "Password changed. Every other device signed in as you has been signed out.",
                  ),
                )
              }
            />
          </div>
        </Card>
      )}
    </Flex>
  );

  /**
   * Battery bands, for both eras (owner ask 2026-09-08).
   *
   * Two numbers per era, not three ranges — the owner's original bands
   * overlapped, and two thresholds make that unrepresentable. The previews
   * below are built by the same functions the Inventory column uses, so what
   * is shown here is literally what the table will say rather than a
   * description of it.
   *
   * The two pairs run OPPOSITE ways and the card says so: a health percentage
   * is a floor (higher is better) and a cycle count is a ceiling (fewer is
   * better). A screen offering four boxes that all read "Good from" would get
   * a cycle ceiling typed into it as if it were a floor.
   */
  const battery = (() => {
    const thresholds = thresholdsFrom(db.settings);
    const cycles = batterySettingsFrom(db.settings).cycles;
    return (
      <Card
        title={t("settings.batteryBands", "Battery bands")}
        extra={
          <Typography.Text type="secondary">
            {t(
              "settings.batteryEraHint",
              "2020 and earlier are recorded as cycles; 2021 and later as health.",
            )}
          </Typography.Text>
        }
      >
        <Typography.Text strong>
          {t("settings.batteryHealthBands", "Battery health bands")}
        </Typography.Text>
        <Flex
          gap={SPACE.lg}
          wrap
          align="flex-end"
          style={{ marginTop: SPACE.sm }}
        >
          <Flex vertical gap={SPACE.xs}>
            <Typography.Text type="secondary">Good from</Typography.Text>
            <InputNumber
              min={1}
              max={100}
              addonAfter="%"
              value={db.settings.batteryGoodMin}
              onChange={(v: number | null) =>
                v != null &&
                mutate((d) => {
                  d.settings.batteryGoodMin = v;
                  // A fair floor at or above the good floor leaves the fair
                  // band empty. Pull it down with the good floor rather than
                  // letting Settings save a state the table cannot render.
                  if (d.settings.batteryFairMin >= v)
                    d.settings.batteryFairMin = Math.max(1, v - 1);
                })
              }
            />
          </Flex>
          <Flex vertical gap={SPACE.xs}>
            <Typography.Text type="secondary">Fair from</Typography.Text>
            <InputNumber
              min={1}
              max={db.settings.batteryGoodMin - 1}
              addonAfter="%"
              value={db.settings.batteryFairMin}
              onChange={(v: number | null) =>
                v != null &&
                mutate((d) => {
                  d.settings.batteryFairMin = Math.min(
                    v,
                    d.settings.batteryGoodMin - 1,
                  );
                })
              }
            />
          </Flex>
          <Flex gap={SPACE.sm} wrap>
            {batteryBands(thresholds).map((b) => (
              <Tag key={b.grade} color={BATTERY_GRADE_COLOR[b.grade]}>
                {b.label}
              </Tag>
            ))}
          </Flex>
        </Flex>

        <Divider />

        <Typography.Text strong>
          {t("settings.cycleBands", "Charge cycle bands")}
        </Typography.Text>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t(
            "settings.cycleBandsHint",
            "Fewer cycles is a better battery, so these are ceilings.",
          )}
        </Typography.Paragraph>
        <Flex
          gap={SPACE.lg}
          wrap
          align="flex-end"
          style={{ marginTop: SPACE.sm }}
        >
          <Flex vertical gap={SPACE.xs}>
            <Typography.Text type="secondary">
              {t("settings.goodUpTo", "Good up to")}
            </Typography.Text>
            <InputNumber
              min={1}
              max={CYCLE_COUNT_MAX}
              addonAfter={t("settings.cyclesUnit", "cycles")}
              value={cycles.goodMax}
              onChange={(v: number | null) =>
                v != null &&
                mutate((d) => {
                  d.settings.cycleGoodMax = v;
                  // A fair ceiling at or below the good ceiling leaves the
                  // fair band empty — the mirror of the health clamp above.
                  if ((d.settings.cycleFairMax ?? 0) <= v)
                    d.settings.cycleFairMax = v + 1;
                })
              }
            />
          </Flex>
          <Flex vertical gap={SPACE.xs}>
            <Typography.Text type="secondary">
              {t("settings.fairUpTo", "Fair up to")}
            </Typography.Text>
            <InputNumber
              min={cycles.goodMax + 1}
              max={CYCLE_COUNT_MAX}
              addonAfter={t("settings.cyclesUnit", "cycles")}
              value={cycles.fairMax}
              onChange={(v: number | null) =>
                v != null &&
                mutate((d) => {
                  d.settings.cycleFairMax = Math.max(v, cycles.goodMax + 1);
                })
              }
            />
          </Flex>
          <Flex gap={SPACE.sm} wrap>
            {cycleBands(cycles).map((b) => (
              <Tag key={b.grade} color={BATTERY_GRADE_COLOR[b.grade]}>
                {b.label}
              </Tag>
            ))}
          </Flex>
        </Flex>
      </Card>
    );
  })();

  /**
   * The two percentages the marketplace features run on (owner ask
   * 2026-09-08).
   *
   * They point in opposite directions and the card keeps them apart:
   *
   * - **The listing markup** goes ON TOP of a machine's counter price to make
   *   its marketplace price, so the shop nets what the counter would have
   *   taken. It is one number for every channel, because Shopee, Tokopedia and
   *   TikTok are within a point of each other and a shop maintaining three
   *   price lists maintains none.
   * - **The commission** comes OFF a payout, and is per channel, because that
   *   is what each platform actually publishes.
   *
   * Both are starting points a person overrides: a marketplace price can be
   * typed per machine, and a withdrawal's fees are typed per payout. Neither
   * is a rule the app enforces against what the bank says.
   */
  const marketplace = (
    <Card title={t("settings.marketplace", "Marketplace pricing & fees")}>
      <Flex vertical gap={SPACE.lg}>
        <Flex vertical gap={SPACE.xs}>
          <Typography.Text strong>
            {t("settings.listingMarkup", "Listing markup")}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t(
              "settings.listingMarkupHint",
              "Added to a machine's store price to suggest its marketplace price. Overridable per machine.",
            )}
          </Typography.Text>
          <InputNumber
            min={0}
            max={100}
            addonAfter="%"
            style={{ width: 160 }}
            aria-label={t("settings.listingMarkup", "Listing markup")}
            value={
              db.settings.marketplaceMarkupPct ?? DEFAULT_MARKETPLACE_MARKUP_PCT
            }
            onChange={(v: number | null) =>
              v != null &&
              mutate((d) => {
                d.settings.marketplaceMarkupPct = v;
              })
            }
          />
        </Flex>

        <Divider style={{ margin: 0 }} />

        <Flex vertical gap={SPACE.xs}>
          <Typography.Text strong>
            {t("settings.commissions", "What each marketplace charges")}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t(
              "settings.commissionsHint",
              "Deducted from a payout. A withdrawal opens with this figure and every other charge is typed.",
            )}
          </Typography.Text>
          <Flex gap={SPACE.lg} wrap>
            {SALE_CHANNELS.filter((c) => c.holdsFunds).map((c) => (
              <Flex vertical gap={SPACE.xs} key={c.value}>
                <Typography.Text type="secondary">{c.label}</Typography.Text>
                <InputNumber
                  min={0}
                  max={100}
                  addonAfter="%"
                  style={{ width: 140 }}
                  aria-label={t("settings.commissionFor", "{{channel}} fee", {
                    channel: c.label,
                  })}
                  value={commissionPctOf(c.value, db.settings.marketplaceFees)}
                  onChange={(v: number | null) =>
                    v != null &&
                    mutate((d) => {
                      d.settings.marketplaceFees = {
                        ...(d.settings.marketplaceFees ?? {}),
                        [c.value]: v,
                      };
                    })
                  }
                />
              </Flex>
            ))}
          </Flex>
        </Flex>
      </Flex>
    </Card>
  );

  /**
   * Who the shop is, as printed at the top of every faktur.
   *
   * These four were a `const SHOP` inside `components/Invoice.tsx`, under a
   * comment reading "Hard-coded for now — Settings does not own shop identity
   * yet". This is that card. Nothing about the receipt changed: the same four
   * strings are the seeded values and the invoice's fallback, so a shop that
   * never opens this page prints exactly what it printed before.
   *
   * Saved as a form rather than field-by-field like the battery bands: an
   * address is retyped, not nudged, and committing on every keystroke would
   * clone the whole store once per character. Blank is allowed and means "use
   * the default" — see `shopOf` in Invoice.tsx.
   */
  const shopIdentity = (
    <Card title={t("settings.shopIdentity", "Shop identity")}>
      <Typography.Paragraph type="secondary">
        {t(
          "settings.shopIdentityHint",
          "Printed at the top of every invoice. Leave a field empty to use the default.",
        )}
      </Typography.Paragraph>
      <Form
        form={shopForm}
        layout="vertical"
        style={{ ...FORM_CENTRE, maxWidth: 480 }}
        initialValues={{
          shopName: db.settings.shopName ?? "",
          shopTagline: db.settings.shopTagline ?? "",
          shopAddress: db.settings.shopAddress ?? "",
          shopContact: db.settings.shopContact ?? "",
        }}
        onFinish={(values) => {
          mutate((d) => {
            d.settings.shopName = values.shopName.trim();
            d.settings.shopTagline = values.shopTagline.trim();
            d.settings.shopAddress = values.shopAddress.trim();
            d.settings.shopContact = values.shopContact.trim();
          });
          message.success(
            t("settings.shopIdentitySaved", "Shop identity saved."),
          );
        }}
      >
        <Form.Item name="shopName" label={t("settings.shopName", "Name")}>
          <Input placeholder={t("settings.shopNameEg", "NUSANTARA")} />
        </Form.Item>
        <Form.Item
          name="shopTagline"
          label={t("settings.shopTagline", "Tagline")}
        >
          <Input
            placeholder={t(
              "settings.shopTaglineEg",
              "Second-hand Apple — sales, trade-in and service",
            )}
          />
        </Form.Item>
        <Form.Item
          name="shopAddress"
          label={t("settings.shopAddress", "Address")}
        >
          <Input
            placeholder={t("settings.shopAddressEg", "Jakarta, Indonesia")}
          />
        </Form.Item>
        <Form.Item
          name="shopContact"
          label={t("settings.shopContact", "Contact")}
        >
          <Input
            placeholder={t(
              "settings.shopContactEg",
              "WhatsApp +62 811 2233 44 · @nusantara",
            )}
          />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          {t("settings.save", "Save")}
        </Button>
      </Form>
    </Card>
  );

  return (
    <PageContainer title={t("settings.settings", "Settings")}>
      <Tabs
        items={[
          {
            key: "wh",
            label: t("settings.tabWarehouses", "Warehouses & locations"),
            children: warehouses,
          },
          {
            key: "bat",
            label: t("settings.tabBattery", "Battery bands"),
            children: battery,
          },
          {
            key: "mkt",
            label: t("settings.tabMarketplace", "Marketplace"),
            children: marketplace,
          },
          {
            key: "shop",
            label: t("settings.tabShop", "Shop identity"),
            children: shopIdentity,
          },
          {
            key: "cat",
            label: t("settings.tabCategories", "Product categories"),
            children: <CategorySettings />,
          },
          {
            key: "grading",
            label: t("settings.tabGrading", "Grading"),
            children: <GradingSettings />,
          },
          {
            key: "sup",
            label: t("settings.tabSuppliers", "Suppliers"),
            children: suppliers,
          },
          {
            key: "rsn",
            label: t("settings.tabReasons", "Reasons"),
            children: reasons,
          },
          {
            key: "src",
            label: t("settings.tabChannels", "Channels"),
            children: sources,
          },
          {
            key: "sm",
            label: t("settings.tabSalespeople", "Salespeople"),
            children: salespeople,
          },
          {
            key: "acc",
            label: t("settings.tabAccount", "Account"),
            children: account,
          },
          // The owner's alone (08 §9: staff management). `/api/staff` refuses
          // anybody else whatever this tab does.
          ...(me?.role === "OWNER"
            ? [
                {
                  key: "staff",
                  label: t("settings.tabStaffAccounts", "Staff accounts"),
                  children: <StaffAccountsSettings me={me} />,
                },
              ]
            : []),
          {
            key: "scan",
            label: t("settings.tabScanner", "Scanner"),
            children: <ScannerSettings />,
          },
        ]}
      />
    </PageContainer>
  );
}
