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
import { useQuery } from "@tanstack/react-query";
import { listPurchaseOrders, poListKey } from "../../lib/inboundApi.js";
import {
  INBOUND_STAGE_COLOR,
  INBOUND_STAGE_LABEL,
  poStageFromCounts,
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
  const navigate = useNavigate();

  // The server sorts, so the page does not. It orders by `orderedAt` desc and
  // then by code, which the mock could not do — a string compare on a date is
  // only a sort while every date is the same length.
  const query = useQuery({
    queryKey: poListKey("", undefined),
    queryFn: ({ signal }) => listPurchaseOrders({ perPage: 100 }, signal),
  });

  const rows = useMemo<Row[]>(
    () =>
      (query.data?.rows ?? []).map((po) => {
        const stage = poStageFromCounts(po);
        return {
          id: po.id,
          code: po.code,
          supplier: po.supplierName,
          // The escape hatch the owner kept: an invoice number, or an
          // explicit "none", never a silently blank cell.
          invoice: po.noInvoice ? "No invoice" : (po.invoice ?? ""),
          date: po.orderedAt.slice(0, 10),
          stage,
          stageLabel: INBOUND_STAGE_LABEL[stage],
          // Machines, not lines. A line of qty 3 is three machines to account
          // for, and the column has always meant the work outstanding.
          lines: po.qty,
          // Money arrives as decimal strings of whole rupiah; this table's Row
          // is numeric, so the conversion happens here where it is visible.
          total: Number(po.total),
          paid: Number(po.paid),
          outstanding: Number(po.total) - Number(po.paid),
          warehouse: po.locationId,
        };
      }),
    [query.data],
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
