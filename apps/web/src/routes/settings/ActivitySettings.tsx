/**
 * Settings → Activity: who did what, newest first (owner ask 2026-10-22:
 * *"add an activity tab that reveals all the activity"*, answered
 * "everything, from now on", owner only).
 *
 * One line per row a till saved — a sale, a price, a product, a setting — plus
 * the sign-ins and staff changes the auth routes have always logged. The
 * server writes the store's lines in the commit's own transaction
 * (packages/db `store/activity.ts`) and pages them; nothing here is in the
 * browser store.
 *
 * ⚠️ It starts on the release that shipped it. Before that the store named a
 * person only where a collection carried one (the unit ledger, stock moves,
 * payments), and inventing lines for those would be a second history that
 * disagrees with the first.
 */
import { useMemo, useState } from "react";
import {
  Alert,
  DatePicker,
  Flex,
  Input,
  Select,
  Table,
  Tag,
  Typography,
} from "antd";
import type { Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";
import {
  readValues,
  useActivity,
  type ActivityAction,
  type ActivityEntry,
} from "../../lib/activityApi.js";
import { useStaffAccounts } from "../../lib/staffApi.js";
import { fmtDateTime, fmtNone, fmtRp } from "../../lib/format.js";
import { customerLabel } from "../../lib/customers.js";
import { useDb } from "../../mock/store.js";
import type { MockDb } from "../../mock/seed.js";
import { COLUMN, SPACE } from "../../theme/tokens";

const PAGE_SIZE = 50;

/** Fields that hold whole rupiah, printed as money. */
const MONEY_FIELDS = new Set([
  "price",
  "marketPrice",
  "buy",
  "landed",
  "total",
  "subtotal",
  "amount",
  "discount",
  "extra",
  "unitCost",
  "cost",
  "cogs",
  "openingBalance",
  "openingCash",
  "openingBank",
]);

const ACTIONS: readonly ActivityAction[] = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "ARCHIVE",
  "LOGIN",
  "LOGIN_GAGAL",
  "EKSPOR",
];

/** A value as a person reads it. */
function shown(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return fmtNone();
  if (MONEY_FIELDS.has(field) && /^-?\d+$/.test(String(value)))
    return fmtRp(Number(value));
  if (typeof value === "boolean") return value ? "✓" : "✗";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The row a line is about, named the way the screens name it. */
function nameOf(db: MockDb, e: ActivityEntry): string {
  const v = { ...readValues(e.before), ...readValues(e.after) };
  const fromRow =
    (typeof v["code"] === "string" && v["code"]) ||
    (typeof v["serial"] === "string" && v["serial"]) ||
    (typeof v["name"] === "string" && v["name"]) ||
    (typeof v["label"] === "string" && v["label"]) ||
    undefined;
  switch (e.entity) {
    case "orders":
      return (
        db.orders.find((o) => o.id === e.entityId)?.code ??
        fromRow ??
        e.entityId
      );
    case "pos":
      return (
        db.pos.find((p) => p.id === e.entityId)?.code ?? fromRow ?? e.entityId
      );
    case "skus": {
      const s = db.skus.find((x) => x.id === e.entityId);
      return s ? `${s.name} ${s.variantLabel}` : (fromRow ?? e.entityId);
    }
    case "models":
      return (
        db.models.find((m) => m.id === e.entityId)?.name ??
        fromRow ??
        e.entityId
      );
    case "customers": {
      const c = db.customers.find((x) => x.id === e.entityId);
      return c ? customerLabel(c) : (fromRow ?? e.entityId);
    }
    case "suppliers":
      return (
        db.suppliers.find((x) => x.id === e.entityId)?.name ??
        fromRow ??
        e.entityId
      );
    case "warehouses":
      return (
        db.warehouses.find((x) => x.id === e.entityId)?.name ??
        fromRow ??
        e.entityId
      );
    case "settings":
    case "appleDbHidden":
    case "myWarehouseId":
      return "";
    default:
      return fromRow ?? e.entityId;
  }
}

export function ActivitySettings() {
  const { t } = useTranslation();
  const db = useDb();
  const [page, setPage] = useState(1);
  const [staffId, setStaffId] = useState<string>();
  const [action, setAction] = useState<ActivityAction[]>([]);
  const [entity, setEntity] = useState<string>();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [q, setQ] = useState("");
  const staff = useStaffAccounts();

  const filter = useMemo(
    () => ({
      page,
      perPage: PAGE_SIZE,
      staffId,
      action,
      entity,
      from: range ? range[0].startOf("day").toISOString() : undefined,
      // Half-open on the server: the day AFTER the last one picked.
      to: range
        ? range[1].add(1, "day").startOf("day").toISOString()
        : undefined,
      q,
    }),
    [page, staffId, action, entity, range, q],
  );
  const result = useActivity(filter);
  /** Any filter moves the list back to its first page. */
  const refilter =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      setPage(1);
      set(v);
    };

  const actionLabel = (a: string): string => {
    switch (a) {
      case "CREATE":
        return t("activity.created", "Added");
      case "UPDATE":
        return t("activity.updated", "Changed");
      case "DELETE":
        return t("activity.deleted", "Removed");
      case "ARCHIVE":
        return t("activity.archived", "Archived");
      case "LOGIN":
        return t("activity.login", "Signed in");
      case "LOGIN_GAGAL":
        return t("activity.loginFailed", "Sign-in failed");
      case "EKSPOR":
        return t("activity.exported", "Exported");
      default:
        return a;
    }
  };
  const actionColor = (a: string): string | undefined =>
    a === "CREATE"
      ? "green"
      : a === "DELETE"
        ? "red"
        : a === "UPDATE"
          ? "blue"
          : a === "LOGIN_GAGAL"
            ? "orange"
            : undefined;

  // Literal calls, not a table indexed by a variable: test/i18n.test.ts finds
  // copy by reading the source.
  const entityLabel = (e: string): string => {
    switch (e) {
      case "orders":
        return t("activity.e.orders", "Sale");
      case "pos":
        return t("activity.e.pos", "Inbound invoice");
      case "units":
        return t("activity.e.units", "Unit");
      case "events":
        return t("activity.e.events", "Unit history");
      case "stockMoves":
        return t("activity.e.stockMoves", "Stock movement");
      case "unitNotes":
        return t("activity.e.unitNotes", "QC note / photo");
      case "stockIns":
        return t("activity.e.stockIns", "QC decision");
      case "adjustments":
        return t("activity.e.adjustments", "Stock adjustment");
      case "skus":
        return t("activity.e.skus", "Product variant");
      case "models":
        return t("activity.e.models", "Product");
      case "categories":
        return t("activity.e.categories", "Category");
      case "customers":
        return t("activity.e.customers", "Customer");
      case "suppliers":
        return t("activity.e.suppliers", "Supplier");
      case "deposits":
        return t("activity.e.deposits", "Supplier deposit");
      case "reservations":
        return t("activity.e.reservations", "Reservation");
      case "returns":
        return t("activity.e.returns", "Return");
      case "opnames":
        return t("activity.e.opnames", "Stock opname");
      case "services":
        return t("activity.e.services", "Service visit");
      case "settlements":
        return t("activity.e.settlements", "Marketplace payout");
      case "expenses":
        return t("activity.e.expenses", "Expense");
      case "incomes":
        return t("activity.e.incomes", "Income");
      case "paymentLog":
        return t("activity.e.paymentLog", "Payment correction");
      case "settlementLog":
        return t("activity.e.settlementLog", "Payout correction");
      case "discounts":
        return t("activity.e.discounts", "Discount");
      case "warehouses":
        return t("activity.e.warehouses", "Warehouse");
      case "racks":
        return t("activity.e.racks", "Rack");
      case "reasons":
        return t("activity.e.reasons", "Reason");
      case "qcDescriptions":
        return t("activity.e.qcDescriptions", "QC phrase");
      case "paymentMethods":
        return t("activity.e.paymentMethods", "Payment method");
      case "reservationSources":
      case "referralSources":
        return t("activity.e.channels", "Channel");
      case "salesmen":
        return t("activity.e.salesmen", "Salesperson");
      case "gradingCriteria":
      case "gradingRules":
        return t("activity.e.grading", "Grading");
      case "knowledge":
        return t("activity.e.knowledge", "Chatbot answer");
      case "chats":
        return t("activity.e.chats", "Chat");
      case "corrections":
      case "personas":
        return t("activity.e.chatbot", "Chatbot setting");
      case "settings":
        return t("activity.e.settings", "Settings");
      case "appleDbHidden":
        return t("activity.e.appleDb", "AppleDB import");
      case "myWarehouseId":
        return t("activity.e.myWarehouse", "Own warehouse");
      case "Staff":
        return t("activity.e.staff", "Staff account");
      case "WhatsApp":
        return t("activity.e.whatsapp", "WhatsApp connection");
      default:
        return e;
    }
  };

  const details = (e: ActivityEntry) => {
    if (e.action === "UPDATE" && e.field) {
      const before = readValues(e.before);
      const after = readValues(e.after);
      return (
        <Flex vertical gap={0}>
          {e.field.split(", ").map((f) => (
            <Typography.Text key={f} style={{ fontSize: 13 }}>
              <Typography.Text type="secondary">{f}: </Typography.Text>
              {shown(f, before[f])} → {shown(f, after[f])}
            </Typography.Text>
          ))}
        </Flex>
      );
    }
    const v = readValues(e.action === "DELETE" ? e.before : e.after);
    const parts = Object.entries(v).map(([k, x]) => `${k}: ${shown(k, x)}`);
    return parts.length > 0 ? (
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        {parts.join(" · ")}
      </Typography.Text>
    ) : null;
  };

  const entities = [
    "orders",
    "pos",
    "units",
    "events",
    "stockMoves",
    "adjustments",
    "returns",
    "services",
    "skus",
    "models",
    "customers",
    "suppliers",
    "reservations",
    "opnames",
    "expenses",
    "incomes",
    "settlements",
    "discounts",
    "settings",
    "Staff",
    "WhatsApp",
  ];

  return (
    <Flex vertical gap={SPACE.md}>
      <Alert
        type="info"
        showIcon
        title={t(
          "activity.since",
          "Every change is listed from the 22 October 2026 release onwards. Sign-ins and staff account changes go back further.",
        )}
      />
      <Flex gap={SPACE.sm} wrap>
        <Input.Search
          allowClear
          placeholder={t("activity.search", "Search a serial, code or id")}
          aria-label={t("activity.search", "Search a serial, code or id")}
          style={{ width: 260 }}
          onSearch={refilter(setQ)}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder={t("activity.person", "Person")}
          aria-label={t("activity.person", "Person")}
          style={{ width: 200 }}
          value={staffId}
          onChange={refilter(setStaffId)}
          options={(staff.data ?? []).map((s) => ({
            value: s.id,
            label: s.name,
          }))}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder={t("activity.action", "Action")}
          aria-label={t("activity.action", "Action")}
          style={{ minWidth: 180 }}
          value={action}
          onChange={refilter(setAction)}
          options={ACTIONS.map((a) => ({ value: a, label: actionLabel(a) }))}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder={t("activity.what", "What")}
          aria-label={t("activity.what", "What")}
          style={{ width: 200 }}
          value={entity}
          onChange={refilter(setEntity)}
          options={entities.map((e) => ({ value: e, label: entityLabel(e) }))}
        />
        <DatePicker.RangePicker
          format="DD MMM YYYY"
          value={range}
          onChange={(v) =>
            refilter(setRange)(
              v && v[0] && v[1] ? ([v[0], v[1]] as [Dayjs, Dayjs]) : null,
            )
          }
        />
      </Flex>
      {result.isError && (
        <Alert
          type="error"
          showIcon
          title={t("activity.loadFailed", "The activity could not be loaded.")}
        />
      )}
      <Table<ActivityEntry>
        rowKey="id"
        size="small"
        loading={result.isFetching}
        dataSource={[...(result.data?.entries ?? [])]}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total: result.data?.total ?? 0,
          showSizeChanger: false,
          onChange: setPage,
        }}
        columns={[
          {
            title: t("activity.when", "When"),
            key: "at",
            width: COLUMN.date + 40,
            render: (_, e) => fmtDateTime(e.at),
          },
          {
            title: t("activity.person", "Person"),
            key: "who",
            width: 160,
            render: (_, e) => e.staff?.name ?? fmtNone(),
          },
          {
            title: t("activity.action", "Action"),
            key: "action",
            width: COLUMN.status,
            render: (_, e) => (
              <Tag color={actionColor(e.action)} style={{ marginInlineEnd: 0 }}>
                {actionLabel(e.action)}
              </Tag>
            ),
          },
          {
            title: t("activity.what", "What"),
            key: "what",
            width: 260,
            render: (_, e) => (
              <Flex vertical gap={0}>
                <Typography.Text>{entityLabel(e.entity)}</Typography.Text>
                {nameOf(db, e) !== "" && (
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: 13, fontFamily: "monospace" }}
                  >
                    {nameOf(db, e)}
                  </Typography.Text>
                )}
              </Flex>
            ),
          },
          {
            title: t("activity.details", "Details"),
            key: "details",
            render: (_, e) => details(e),
          },
        ]}
      />
    </Flex>
  );
}
