/**
 * Manage discounts — usage, window, status. A discount no sale has redeemed
 * can be deleted outright (owner decision 2026-10-02); one that has been used
 * is named on a receipt, so it is switched off instead.
 * Clicking a discount opens where it was actually redeemed, which is the
 * question the `used` counter raises and cannot answer: 12 uses is a number,
 * "12 uses, all of them in the first three days, all on MacBook Air" is a
 * decision about whether to run it again.
 */
import { countedLineLabels, piecesSold } from "../../lib/stock.js";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Flex,
  Popconfirm,
  Statistic,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { fmtRp, fmtDate, fmtDateTime } from "../../lib/format.js";
import { describeDiscount, scopeKindOf } from "../../lib/pricing.js";
import { describeDiscountText } from "../../lib/discountText.js";
import { useDb, mutate } from "../../mock/store.js";
import type { Discount } from "../../mock/seed.js";
import { useTranslation } from "react-i18next";
import { COLUMN, SPACE } from "../../theme/tokens";

/**
 * The state a discount is in.
 *
 * A plain function, not a hook, so there is no `t` here — the labels stay
 * English and ARE their own catalogue keys, which the caller runs through
 * `t()`. Same arrangement as the nav labels; `i18n/catalogue.ts` says why.
 */
function statusOf(d: Discount): { label: string; color: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (!d.active) return { label: "Off", color: "default" };
  if (d.toDate && d.toDate < today)
    return { label: "Expired", color: "default" };
  if (d.fromDate && d.fromDate > today)
    return { label: "Scheduled", color: "blue" };
  if (d.usageLimit && d.used >= d.usageLimit)
    return { label: "Used up", color: "red" };
  return { label: "Running", color: "green" };
}

export function DiscountsPage() {
  const { t } = useTranslation();
  const db = useDb();
  /** A discount's scope, saying which of the three it is (2026-10-08). */
  const scopeText = (scope: string) => {
    const kind = scopeKindOf(db, scope);
    if (kind === "ALL") return t("discount.allProducts", "All products");
    return kind === "CATEGORY"
      ? t("discounts.scopeCategoryOf", "Category: {{name}}", { name: scope })
      : t("discounts.scopeProductOf", "Product: {{name}}", { name: scope });
  };
  const navigate = useNavigate();
  const { compact } = useLayoutMode();
  const [opened, setOpened] = useState<Discount | null>(null);

  const discount = opened && db.discounts.find((d) => d.id === opened.id);
  /** Every sale that redeemed this code, newest first. */
  const usage = discount
    ? db.orders
        .filter((o) => o.discountId === discount.id)
        .sort((a, b) => b.ts.localeCompare(a.ts))
    : [];
  const redeemed = usage.reduce((t, o) => t + o.discount, 0);
  /**
   * A discount a sale has redeemed is on a receipt and cannot be deleted. The
   * counter and the order list are both asked, because they can disagree —
   * see the note in the drawer below.
   */
  const isRedeemed = (d: Discount) =>
    d.used > 0 || db.orders.some((o) => o.discountId === d.id);

  return (
    <PageContainer
      title={t("discounts.discount", "Discount")}
      actions={[
        {
          key: "add",
          label: t("discounts.addDiscount", "Add discount"),
          icon: <PlusOutlined />,
          type: "primary",
          onClick: () => navigate("/discounts/new"),
        },
      ]}
    >
      <Card>
        <ProTable
          persistKey="discounts"
          rowKey="id"
          dataSource={db.discounts}
          searchPlaceholder={t(
            "discounts.searchNameCodeOrScope",
            "Search name, code or scope",
          )}
          // The whole row opens the history — a discount's name is the thing
          // you would click, and making only one cell clickable is a target
          // people miss. The switch stops propagation so toggling it on or off
          // does not also open the drawer.
          keyboardRows={(d) =>
            t("discounts.openDiscount", "Open {{name}}", { name: d.name })
          }
          onRow={(d) => ({
            onClick: () => setOpened(d),
            style: { cursor: "pointer" },
          })}
          columns={[
            {
              title: t("discounts.discount", "Discount"),
              key: "name",
              searchable: true,
              sortValue: (d) => d.name,
              searchValue: (d) => `${d.name} ${d.code}`,
              render: (_, d) => (
                <>
                  <strong>{d.name}</strong>
                  <div>
                    <Tag>{d.code}</Tag>
                  </div>
                </>
              ),
            },
            {
              title: t("discounts.takesOff", "Takes off"),
              key: "value",
              // A bundle has no single "amount off" to sort by — what it saves
              // depends on the basket — so it sorts on the bundle price, which
              // is the one figure it does own.
              sortValue: (d) =>
                d.type === "PCT"
                  ? (d.pct ?? 0)
                  : (d.amountRp ?? d.bundlePriceRp ?? 0),
              render: (_, d) => describeDiscountText(describeDiscount(d), t),
            },
            {
              title: t("discounts.kind", "Kind"),
              key: "kind",
              facet: true,
              width: COLUMN.status,
              sortValue: (d) =>
                d.type === "PCT"
                  ? "Percentage"
                  : d.type === "NOMINAL"
                    ? "Amount"
                    : "Bundle",
              render: (_, d) => (
                <Tag color={d.type === "BUNDLE" ? "purple" : "default"}>
                  {d.type === "PCT"
                    ? "Percentage"
                    : d.type === "NOMINAL"
                      ? "Amount"
                      : "Bundle"}
                </Tag>
              ),
            },
            {
              title: t("discounts.used", "Used"),
              key: "used",
              sortValue: (d) => d.used,
              render: (_, d) =>
                `${d.used}${d.usageLimit ? ` / ${d.usageLimit}` : ""}`,
            },
            {
              title: t("discounts.duration", "Duration"),
              key: "duration",
              sortValue: (d) => d.fromDate ?? "",
              render: (_, d) =>
                d.fromDate
                  ? `${fmtDate(d.fromDate)} – ${d.toDate ? fmtDate(d.toDate) : "…"}`
                  : "Always",
            },
            {
              title: t("discounts.appliesTo", "Applies to"),
              dataIndex: "scope",
              facet: true,
              searchable: true,
              render: (v: string) => <Tag>{scopeText(v)}</Tag>,
            },
            {
              title: t("discounts.status", "Status"),
              key: "status",
              facet: true,
              // Translated at the call site — `statusOf` has no hook in scope
              // and returns the English, which is its own catalogue key.
              sortValue: (d) => t(statusOf(d).label),
              render: (_, d) => {
                const s = statusOf(d);
                return <Tag color={s.color}>{t(s.label)}</Tag>;
              },
            },
            {
              // Correcting a discount, and deleting one nobody has used (owner
              // asks 2026-10-02). The row opens its usage history, so this
              // stops the click like the switch.
              title: "",
              key: "edit",
              width: COLUMN.actionsPair,
              render: (_, d) => {
                const redeemed = isRedeemed(d);
                return (
                  <Flex
                    gap={SPACE.xs}
                    justify="end"
                    role="presentation"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      size="small"
                      icon={<EditOutlined />}
                      aria-label={t("discounts.editAria", "Edit {{name}}", {
                        name: d.name,
                      })}
                      onClick={() => navigate(`/discounts/${d.id}/edit`)}
                    >
                      {t("common.edit", "Edit")}
                    </Button>
                    {redeemed ? (
                      <Tooltip
                        title={t(
                          "discounts.deleteBlocked",
                          "Used on a sale, so it stays on record. Switch it off instead.",
                        )}
                      >
                        <span>
                          <Button
                            size="small"
                            danger
                            disabled
                            icon={<DeleteOutlined />}
                            aria-label={t(
                              "discounts.deleteAria",
                              "Delete {{name}}",
                              { name: d.name },
                            )}
                          >
                            {t("common.delete", "Delete")}
                          </Button>
                        </span>
                      </Tooltip>
                    ) : (
                      <Popconfirm
                        title={t(
                          "discounts.deleteConfirm",
                          "Delete {{name}}?",
                          { name: d.name },
                        )}
                        description={t(
                          "deleteAction.confirmDetail",
                          "This cannot be undone.",
                        )}
                        okText={t("common.delete", "Delete")}
                        cancelText={t("common.cancel", "Cancel")}
                        okButtonProps={{ danger: true }}
                        onConfirm={() =>
                          mutate((x) => {
                            x.discounts = x.discounts.filter(
                              (y) => y.id !== d.id,
                            );
                          })
                        }
                      >
                        <Button
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label={t(
                            "discounts.deleteAria",
                            "Delete {{name}}",
                            { name: d.name },
                          )}
                        >
                          {t("common.delete", "Delete")}
                        </Button>
                      </Popconfirm>
                    )}
                  </Flex>
                );
              },
            },
            {
              title: t("discounts.on", "On"),
              key: "on",
              width: 60,
              render: (_, d) => (
                <span
                  role="presentation"
                  // The row opens the drawer; this control does not.
                  onClick={(e) => e.stopPropagation()}
                >
                  <Switch
                    size="small"
                    checked={d.active}
                    aria-label={`${d.active ? "Switch off" : "Switch on"} ${d.name}`}
                    onChange={(on) =>
                      mutate((x) => {
                        x.discounts.find((y) => y.id === d.id)!.active = on;
                      })
                    }
                  />
                </span>
              ),
            },
          ]}
        />
      </Card>

      <Drawer
        title={discount ? `${discount.name} — usage history` : ""}
        open={opened !== null}
        onClose={() => setOpened(null)}
        size={compact ? "large" : "large"}
      >
        {discount && (
          <Flex vertical gap={16}>
            <Descriptions
              column={{ xs: 1, sm: 2 }}
              items={[
                {
                  key: "c",
                  label: t("discounts.code", "Code"),
                  children: <Tag>{discount.code}</Tag>,
                },
                {
                  key: "v",
                  label: t("discounts.takesOff", "Takes off"),
                  children: describeDiscountText(describeDiscount(discount), t),
                },
                {
                  key: "s",
                  label: t("discounts.appliesTo", "Applies to"),
                  children: scopeText(discount.scope),
                },
                {
                  key: "w",
                  label: t("discounts.activePeriod", "Active period"),
                  children: discount.fromDate
                    ? `${fmtDate(discount.fromDate)} – ${discount.toDate ? fmtDate(discount.toDate) : "…"}`
                    : "Always",
                },
              ]}
            />
            <Flex gap={16} wrap>
              <Card size="small" style={{ flex: 1, minWidth: 180 }}>
                <Statistic
                  title={t("discounts.timesRedeemed", "Times redeemed")}
                  value={discount.used}
                  suffix={
                    discount.usageLimit ? `/ ${discount.usageLimit}` : undefined
                  }
                />
              </Card>
              <Card size="small" style={{ flex: 1, minWidth: 180 }}>
                <Statistic
                  title={t("discounts.givenAway", "Given away")}
                  value={fmtRp(redeemed)}
                />
              </Card>
              <Card size="small" style={{ flex: 1, minWidth: 180 }}>
                <Statistic
                  title={t("discounts.salesItAppearsOn", "Sales it appears on")}
                  value={usage.length}
                />
              </Card>
            </Flex>

            {/* The counter and the order list can disagree: `used` is bumped at
                the moment of sale, and a redemption recorded before the order
                table existed has no row here. Saying so beats quietly showing a
                shorter list than the number above it. */}
            {discount.used !== usage.length && (
              <Typography.Text type="secondary">
                The counter says {discount.used} but {usage.length} sale(s)
                carry this code — the difference is redemptions recorded before
                this history was kept.
              </Typography.Text>
            )}

            {usage.length === 0 ? (
              <Empty
                description={t(
                  "discounts.notRedeemedOnAnySale",
                  "Not redeemed on any sale yet.",
                )}
              />
            ) : (
              <ProTable
                rowKey="id"
                dataSource={usage}
                searchPlaceholder={t(
                  "discounts.searchOrderCodeOrCustomer",
                  "Search order code or customer",
                )}
                cards={false}
                columns={[
                  {
                    title: t("discounts.order", "Order"),
                    dataIndex: "code",
                    searchable: true,
                  },
                  {
                    title: t("discounts.when", "When"),
                    dataIndex: "ts",
                    defaultSortOrder: "descend",
                    render: fmtDateTime,
                  },
                  {
                    title: t("discounts.customer", "Customer"),
                    key: "customer",
                    searchable: true,
                    sortValue: (o) =>
                      db.customers.find((c) => c.id === o.customerId)?.name ??
                      "Walk-in",
                    render: (_, o) =>
                      db.customers.find((c) => c.id === o.customerId)?.name ??
                      "Walk-in",
                  },
                  {
                    title: t("discounts.channel", "Channel"),
                    dataIndex: "source",
                    facet: true,
                    render: (v) => <Tag>{v}</Tag>,
                  },
                  {
                    title: t("discounts.units", "Units"),
                    key: "units",
                    sortValue: (o) => piecesSold(o),
                    render: (_, o) =>
                      [
                        ...o.serials,
                        ...countedLineLabels(db.skus, o.lines),
                      ].join(", "),
                  },
                  {
                    title: t("discounts.takenOff", "Taken off"),
                    key: "off",
                    align: "right",
                    sortValue: (o) => o.discount,
                    render: (_, o) => fmtRp(o.discount),
                  },
                  {
                    title: t("discounts.orderTotal", "Order total"),
                    key: "total",
                    align: "right",
                    sortValue: (o) => o.total,
                    render: (_, o) => fmtRp(o.total),
                  },
                ]}
              />
            )}

            <Flex gap={8}>
              <Button onClick={() => setOpened(null)}>Close</Button>
            </Flex>
          </Flex>
        )}
      </Drawer>
    </PageContainer>
  );
}
