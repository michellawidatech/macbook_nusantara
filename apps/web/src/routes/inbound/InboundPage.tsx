/**
 * Inbound — every purchase order the shop has ever raised, and how far each one
 * has got.
 *
 * Replaced the separate Purchase Order and Stock In (QC) menu items on
 * 2026-08-24. They were one job seen twice: an order is raised, goods turn up,
 * serials are graded onto a shelf. Splitting them meant "where is that order up
 * to?" had no screen that could answer it — you had to know an order existed,
 * go to one page for its lines and another for its units, and hold the join in
 * your head.
 *
 * History first, with the form behind a button. Every other screen in this
 * rebuild works that way now (owner decision 2026-08-24): the list is what
 * staff open the page for, and a form occupying the top of it is a form they
 * scroll past all day.
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Flex, Tag, Tooltip, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { OrphanQcCard } from "../../components/OrphanQcCard";
import { fmtRp, fmtDate } from "../../lib/format.js";
import { useDb } from "../../mock/store.js";
import {
  INBOUND_STAGE_COLOR,
  INBOUND_STAGE_LABEL,
  poStage,
  poTotals,
  type InboundStage,
} from "../../lib/inbound.js";
import { useTranslation } from "react-i18next";

interface Row {
  readonly id: string;
  readonly code: string;
  readonly supplier: string;
  readonly invoice: string;
  readonly date: string;
  readonly stage: InboundStage;
  readonly stageLabel: string;
  readonly lines: number;
  readonly total: number;
  readonly paid: number;
  readonly outstanding: number;
  readonly warehouse: string;
}

export function InboundPage() {
  const { t } = useTranslation();
  const db = useDb();
  const navigate = useNavigate();

  const rows = useMemo<Row[]>(
    () =>
      [...db.pos]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((po) => {
          const t = poTotals(po);
          const stage = poStage(po, db.units);
          return {
            id: po.id,
            code: po.code,
            supplier:
              db.suppliers.find((s) => s.id === po.supplierId)?.name ?? "—",
            // The escape hatch the owner kept: an invoice number, or an
            // explicit "none", never a silently blank cell.
            invoice: po.noInvoice ? "No invoice" : po.invoice,
            date: po.date,
            stage,
            stageLabel: INBOUND_STAGE_LABEL[stage],
            lines: po.items.length,
            total: t.total,
            paid: t.paid,
            outstanding: t.outstanding,
            warehouse:
              db.warehouses.find((w) => w.id === po.locationId)?.name ?? "—",
          };
        }),
    [db],
  );

  return (
    <PageContainer
      title={t("inboundList.inbound", "Inbound")}
      actions={[
        {
          key: "new",
          label: t("inboundList.newOrder", "New order"),
          icon: <PlusOutlined />,
          type: "primary",
          onClick: () => navigate("/inbound/new"),
        },
      ]}
    >
      {/*
       * Machines waiting in QC that came off no order — a stock take's
       * surplus. Renders nothing when there are none, which is most days.
       * Above the list because it is work outstanding, and the list behind it
       * is a record. See `components/OrphanQcCard.tsx`.
       */}
      <OrphanQcCard />
      <Card>
        <ProTable<Row>
          rowKey="id"
          dataSource={rows}
          searchPlaceholder={t(
            "inboundList.searchOrderSupplierOrInvoice",
            "Search order, supplier or invoice number",
          )}
          // No row selection (owner decision 2026-08-26). It only ever produced
          // a running total, and it fought the row click below: every attempt
          // to tick an order opened it instead, because the checkbox is a 16px
          // target inside a row whose whole job is to navigate. A list where
          // clicking anywhere goes somewhere cannot also be a list you select
          // from.
          //
          // The whole row opens the order. A purchase order's code is the thing
          // you would click, and making one cell clickable is a target people
          // miss.
          onRow={(r) => ({
            style: { cursor: "pointer" },
            onClick: () => navigate(`/inbound/${r.id}`),
          })}
          columns={[
            {
              title: t("inboundList.order", "Order"),
              dataIndex: "code",
              searchable: true,
              sortValue: (r) => r.code,
              defaultSortOrder: "descend",
              render: (v: string, r) => (
                <>
                  <Typography.Text strong>{v}</Typography.Text>
                  <Typography.Text
                    type="secondary"
                    style={{ display: "block", fontSize: 12 }}
                  >
                    {r.invoice}
                  </Typography.Text>
                </>
              ),
            },
            {
              title: t("inboundList.supplier", "Supplier"),
              dataIndex: "supplier",
              facet: true,
              searchable: true,
            },
            {
              title: t("inboundList.ordered", "Ordered"),
              dataIndex: "date",
              sortValue: (r) => r.date,
              render: (v: string) => fmtDate(v),
            },
            {
              title: t("inboundList.warehouse", "Warehouse"),
              dataIndex: "warehouse",
              facet: true,
            },
            {
              title: t("inboundList.stage", "Stage"),
              dataIndex: "stageLabel",
              facet: true,
              sortValue: (r) => r.stageLabel,
              render: (_: unknown, r) => (
                <Tag color={INBOUND_STAGE_COLOR[r.stage]}>{r.stageLabel}</Tag>
              ),
            },
            {
              title: t("inboundList.products", "Products"),
              dataIndex: "lines",
              align: "right",
              width: 110,
              sortValue: (r) => r.lines,
              // A dash, not a zero. An order with no lines is the owner's
              // paid-first case, and "0" reads as a mistake someone made
              // rather than a step that has not happened yet.
              render: (v: number) =>
                v === 0 ? (
                  <Tooltip
                    title={t(
                      "inboundList.productsNotEnteredYetAdd",
                      "Products not entered yet — add them when the goods arrive",
                    )}
                  >
                    <Typography.Text type="secondary">—</Typography.Text>
                  </Tooltip>
                ) : (
                  v
                ),
            },
            {
              title: t("inboundList.invoiced", "Invoiced"),
              dataIndex: "total",
              align: "right",
              sortValue: (r) => r.total,
              render: (v: number) =>
                v === 0 ? (
                  <Typography.Text type="secondary">—</Typography.Text>
                ) : (
                  fmtRp(v)
                ),
            },
            {
              title: t("inboundList.paid", "Paid"),
              dataIndex: "paid",
              align: "right",
              sortValue: (r) => r.paid,
              render: (v: number, r) => (
                <Flex vertical align="end">
                  <span>{v === 0 ? "—" : fmtRp(v)}</span>
                  {r.outstanding > 0 && (
                    <Typography.Text
                      type="danger"
                      style={{ fontSize: 12, whiteSpace: "nowrap" }}
                    >
                      {fmtRp(r.outstanding)} owed
                    </Typography.Text>
                  )}
                  {v > 0 && r.total === 0 && (
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: 12, whiteSpace: "nowrap" }}
                    >
                      {t(
                        "inboundList.nothingInvoicedYet",
                        "nothing invoiced yet",
                      )}
                    </Typography.Text>
                  )}
                </Flex>
              ),
            },
          ]}
        />
      </Card>
    </PageContainer>
  );
}
