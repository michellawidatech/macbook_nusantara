/**
 * Today — the approver's morning screen (owner ask 2026-11-13).
 *
 * > *"Have a separate page for him at the top, 'Today', to see the stock for
 * > all units where he can filter per warehouse, per category, and sort (like
 * > a normal table). On top he can see which needs restock and the bank
 * > balance as of today, and whether or not it has been reconciled."* — and:
 * > *"in his daily report, all the requests to edit/delete a transaction as
 * > well."*
 *
 * - **Who sees it**: the account that approves edits (`Staff.canApprove`).
 *   The nav offers it to nobody else (`navSectionsFor`), and the page itself
 *   answers anybody else with a refusal — a bookmark or a pasted link is not
 *   a way in. The screen never names a person: the switch is what decides.
 * - **Top row**: *Needs restock* (`lib/restock.ts` holds the rule),
 *   *Bank balance today* — the same `cashflowRows` → `balancesOfRows` the
 *   Income & Expense Bank card reads, dotted until the eye is pressed, with
 *   whether today's bank count is done (`unreconciledPots`) — drawn only for
 *   an account with finance access, because the API sends nobody else the
 *   expenses that balance is made of; and *Waiting for your approval*
 *   (`TodayApprovalsCard`).
 * - **Below**: every unit the shop holds as one ordinary list
 *   (`lib/todayStock.ts`), filterable in its headers by warehouse, category
 *   and status, sortable, searchable; counted products as quantity rows.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import { Button, Card, Empty, Flex, Result, Tag, Typography } from "antd";
import {
  BankOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { GradeTag } from "../../components/GradeTag";
import { EnumTag } from "../../components/EnumTag";
import { SerialLink } from "../../components/SerialLink";
import { useDb } from "../../mock/store.js";
import { useSession } from "../../lib/session.js";
import { fmtNone, fmtRp } from "../../lib/format.js";
import { needsRestock } from "../../lib/restock.js";
import { todayStockRows, type TodayStockRow } from "../../lib/todayStock.js";
import { balancesOfRows, cashflowRows } from "../../lib/cashflowRows.js";
import { unreconciledPots } from "../../lib/reconciliation.js";
import { warehouseLabelOf } from "../../lib/warehouses.js";
import { UNIT_STATUS, tagOf } from "../../i18n/enumLabels.js";
import { COLUMN, SPACE, TYPE } from "../../theme/tokens";
import {
  TodayApprovalsCard,
  type TodayApprovalRequest,
} from "./TodayApprovalsCard";

/** How many restock rows the card lists before it says how many more. */
const RESTOCK_SHOWN = 6;

/** What `/today` shows to an account that does not approve edits. */
export function TodayLocked() {
  const { t } = useTranslation();
  return (
    <Result
      status="403"
      title={t("today.lockedTitle", "Today is restricted")}
      subTitle={t(
        "today.lockedBody",
        "Only an account that can approve edits sees this page.",
      )}
    />
  );
}

export function TodayPage() {
  const session = useSession();
  const staff = session.data ?? null;
  if (!staff?.canApprove) return <TodayLocked />;
  return <TodayBody canViewFinance={staff.canViewFinance} />;
}

function TodayBody({ canViewFinance }: { readonly canViewFinance: boolean }) {
  const { t } = useTranslation();
  const db = useDb();
  const [showBank, setShowBank] = useState(false);

  const restock = useMemo(
    () => needsRestock(db),
    [db.orders, db.units, db.stockMoves, db.skus],
  );
  const stock = useMemo(
    () => todayStockRows(db),
    [
      db.units,
      db.skus,
      db.models,
      db.events,
      db.stockMoves,
      db.pos,
      db.services,
    ],
  );
  const bank = useMemo(
    () =>
      canViewFinance
        ? balancesOfRows(cashflowRows(db, t), db.settings).bank
        : undefined,
    [canViewFinance, db, t],
  );
  const bankReconciled = !unreconciledPots(
    db,
    dayjs().format("YYYY-MM-DD"),
  ).includes("BANK");

  // TODO(approvals): wire usePendingChangeRequests() — Part B ships the hook
  // (pending ChangeRequests for this approver); until then nothing is listed.
  const approvals: readonly TodayApprovalRequest[] = [];

  const warehouse = (id: string) =>
    warehouseLabelOf(db.warehouses, id) ?? fmtNone();
  const statusLabel = (s: string) => tagOf(UNIT_STATUS, s, t).label;

  const restockCard = (
    <Card
      size="small"
      style={{ flex: "1 1 300px", minWidth: 0 }}
      data-testid="today-restock"
      title={
        <Flex align="center" gap={SPACE.xs}>
          {t("today.restockTitle", "Needs restock")}
          {restock.length > 0 && <Tag color="red">{restock.length}</Tag>}
        </Flex>
      }
    >
      {restock.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t(
            "today.restockNone",
            "Nothing sold in the last 30 days is running short.",
          )}
        />
      ) : (
        <Flex vertical gap={SPACE.xs}>
          <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
            {t(
              "today.restockRule",
              "Sold in the last 30 days, with less on the shelf than sold.",
            )}
          </Typography.Text>
          {restock.slice(0, RESTOCK_SHOWN).map((r) => (
            <Flex
              key={r.skuId}
              justify="space-between"
              gap={SPACE.sm}
              data-restock={r.skuId}
            >
              <Typography.Text ellipsis style={{ minWidth: 0 }}>
                {`${r.name} ${r.variantLabel}`.trim()}
              </Typography.Text>
              <Typography.Text style={{ whiteSpace: "nowrap" }}>
                {t("today.restockLine", "{{onHand}} on hand · {{sold}} sold", {
                  onHand: r.onHand,
                  sold: r.sold,
                })}
              </Typography.Text>
            </Flex>
          ))}
          {restock.length > RESTOCK_SHOWN && (
            <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
              {t("today.restockMore", "and {{count}} more", {
                count: restock.length - RESTOCK_SHOWN,
              })}
            </Typography.Text>
          )}
        </Flex>
      )}
    </Card>
  );

  const bankCard = bank !== undefined && (
    <Card
      size="small"
      style={{ flex: "1 1 240px", minWidth: 0 }}
      data-testid="today-bank"
      title={
        <span>
          <BankOutlined /> {t("today.bankTitle", "Bank balance today")}
        </span>
      }
      extra={
        <Button
          type="text"
          size="small"
          icon={showBank ? <EyeInvisibleOutlined /> : <EyeOutlined />}
          aria-label={
            showBank
              ? t("today.hideBank", "Hide the bank balance")
              : t("today.showBank", "Show the bank balance")
          }
          onClick={() => setShowBank((v) => !v)}
        />
      }
    >
      <Flex vertical gap={SPACE.xs}>
        <Typography.Text
          strong
          style={{ fontSize: TYPE.lg }}
          data-testid="today-bank-amount"
        >
          {showBank ? fmtRp(bank) : "Rp ••••••"}
        </Typography.Text>
        {bankReconciled ? (
          <Tag color="green" style={{ alignSelf: "flex-start" }}>
            {t("today.reconciled", "Reconciled today")}
          </Tag>
        ) : (
          <Flex align="center" gap={SPACE.xs} wrap>
            <Tag color="orange" style={{ marginInlineEnd: 0 }}>
              {t("today.notReconciled", "Not reconciled today")}
            </Tag>
            <Link to="/finance/reconciliation?reconcile=today">
              {t("recon.reconcile", "Reconcile")}
            </Link>
          </Flex>
        )}
      </Flex>
    </Card>
  );

  return (
    <PageContainer title={t("today.title", "Today")}>
      <Flex vertical gap={SPACE.md}>
        <Flex gap={SPACE.md} wrap align="stretch">
          {restockCard}
          {bankCard}
          <TodayApprovalsCard requests={approvals} />
        </Flex>

        <Card title={t("today.stockTitle", "Stock")}>
          <ProTable<TodayStockRow>
            persistKey="today.stock"
            rowKey="key"
            dataSource={stock}
            searchPlaceholder={t(
              "today.searchStock",
              "Search product or serial",
            )}
            columns={[
              {
                title: t("today.product", "Product"),
                key: "product",
                searchable: true,
                sortValue: (r) => r.product,
                render: (_, r) => r.product,
              },
              {
                title: t("today.serial", "Serial"),
                key: "serial",
                width: COLUMN.serial,
                searchable: true,
                sortValue: (r) => r.serial ?? "",
                render: (_, r) =>
                  r.serial ? (
                    <SerialLink serial={r.serial} />
                  ) : (
                    <Typography.Text type="secondary">
                      {t("today.qtyPieces", "{{count}} pcs", { count: r.qty })}
                    </Typography.Text>
                  ),
              },
              {
                title: t("today.grade", "Grade"),
                key: "grade",
                width: COLUMN.grade,
                sortValue: (r) => r.grade ?? "",
                render: (_, r) =>
                  r.kind === "UNIT" ? <GradeTag grade={r.grade} /> : fmtNone(),
              },
              {
                title: t("today.warehouse", "Warehouse"),
                key: "warehouse",
                width: COLUMN.choice,
                facet: true,
                sortValue: (r) => warehouse(r.locationId),
                render: (_, r) => warehouse(r.locationId),
              },
              {
                title: t("today.category", "Category"),
                key: "category",
                width: COLUMN.choice,
                facet: true,
                sortValue: (r) => r.category || fmtNone(),
                render: (_, r) => r.category || fmtNone(),
              },
              {
                title: t("today.status", "Status"),
                key: "status",
                width: COLUMN.status,
                facet: true,
                sortValue: (r) => statusLabel(r.status),
                render: (_, r) => (
                  <EnumTag map={UNIT_STATUS} value={r.status} />
                ),
              },
              {
                title: t("today.qty", "Qty"),
                key: "qty",
                width: COLUMN.qty,
                align: "right",
                sortValue: (r) => r.qty,
                render: (_, r) => r.qty,
              },
              {
                title: t("today.sellPrice", "Sell price"),
                key: "price",
                width: COLUMN.money,
                align: "right",
                sortValue: (r) => r.sellPrice ?? -1,
                render: (_, r) =>
                  r.sellPrice !== undefined ? fmtRp(r.sellPrice) : fmtNone(),
              },
              {
                title: t("today.cogs", "COGS"),
                key: "cogs",
                width: COLUMN.money,
                align: "right",
                sortValue: (r) => r.cogs,
                render: (_, r) => fmtRp(r.cogs),
              },
              {
                title: t("today.days", "Days in stock"),
                key: "days",
                width: COLUMN.qty,
                align: "right",
                sortValue: (r) => r.days ?? -1,
                render: (_, r) => (r.days !== undefined ? r.days : fmtNone()),
              },
            ]}
          />
        </Card>
      </Flex>
    </PageContainer>
  );
}
