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
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { App, Card, Dropdown, Flex, Tag, Tooltip, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { OrphanQcCard } from "../../components/OrphanQcCard";
import { fmtRp, fmtDate } from "../../lib/format.js";
import { mutate, useDb } from "../../mock/store.js";
import {
  PO_PAYMENT_STATUS_COLOR,
  PO_PAYMENT_STATUS_LABEL,
  PO_PAYMENT_STATUSES,
  poDeletion,
  poPaymentStatus,
  poTotals,
  type PoPaymentStatus,
} from "../../lib/inbound.js";
import { useTranslation } from "react-i18next";

interface Row {
  readonly id: string;
  readonly code: string;
  readonly supplier: string;
  readonly invoice: string;
  readonly date: string;
  /** Where the MONEY stands — the column that replaced Stage (2026-09-15). */
  readonly payment: PoPaymentStatus;
  readonly paymentLabel: string;
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
  const { message, modal } = App.useApp();
  /**
   * The row a right-click landed on, and where the pointer was (owner ask
   * 2026-09-15: *"Make the inbound deletable. with right click and add modal
   * popup confirmation"*).
   *
   * A controlled `Dropdown` anchored to the pointer rather than a menu
   * declared per row: `ProTable` owns its rows, and a menu rendered inside
   * every cell would be a thousand menus on a list of a thousand invoices.
   * `null` is closed.
   *
   * The context-menu KEY fires the same DOM event, so this is reachable from
   * the keyboard as well as from the mouse.
   */
  const [menu, setMenu] = useState<{
    readonly id: string;
    readonly x: number;
    readonly y: number;
  } | null>(null);

  /**
   * Delete an invoice — which means cancel it. See `poDeletion` for what goes
   * with it and what refuses it.
   */
  const askDelete = (id: string) => {
    const po = db.pos.find((p) => p.id === id);
    if (po === undefined) return;
    const { takes, blockers, allowed } = poDeletion(po, db.units);
    if (!allowed) {
      modal.info({
        title: t(
          "inboundList.cannotDeleteTitle",
          "{{code}} cannot be deleted",
          { code: po.code },
        ),
        content: t(
          "inboundList.cannotDeleteBody",
          "{{count}} machine(s) on it have already left QC: {{serials}}. An invoice is the only record of what a machine cost, so deal with those first — reopen them in QC, or adjust them out of stock.",
          { count: blockers.length, serials: blockers.join(", ") },
        ),
      });
      return;
    }
    modal.confirm({
      title: t("inboundList.deleteTitle", "Delete {{code}}?", {
        code: po.code,
      }),
      content:
        takes.length === 0
          ? t(
              "inboundList.deleteBody",
              "Its lines and its payments stop counting. Money already paid stays on the supplier's account.",
            )
          : t(
              "inboundList.deleteBodyWithUnits",
              "Its lines and its payments stop counting, and {{count}} machine(s) still waiting in QC go with it. Money already paid stays on the supplier's account.",
              { count: takes.length },
            ),
      okText: t("inboundList.delete", "Delete"),
      okButtonProps: { danger: true },
      onOk: () => {
        mutate((d) => {
          // The units FIRST, in the same commit: an invoice that still names
          // a machine is refused by the server, and a machine whose invoice
          // has gone is one nothing explains.
          const going = new Set(takes);
          d.units = d.units.filter((u) => !going.has(u.serial));
          d.pos = d.pos.filter((p) => p.id !== id);
        });
        message.success(
          t("inboundList.deleted", "{{code}} deleted.", { code: po.code }),
        );
      },
    });
  };

  const rows = useMemo<Row[]>(
    () =>
      [...db.pos]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((po) => {
          const totals = poTotals(po);
          const payment = poPaymentStatus(po);
          return {
            id: po.id,
            code: po.code,
            supplier:
              db.suppliers.find((s) => s.id === po.supplierId)?.name ?? "—",
            // The escape hatch the owner kept: an invoice number, or an
            // explicit "none", never a silently blank cell.
            invoice: po.noInvoice ? "No invoice" : po.invoice,
            date: po.date,
            payment,
            // Translated HERE rather than at the cell, because a facet and a
            // sort both read this string: an untranslated label would give
            // the filter English options on an Indonesian page, which is
            // exactly the leak `test/i18n.test.ts` exists to catch.
            paymentLabel: t(PO_PAYMENT_STATUS_LABEL[payment]),
            lines: po.items.length,
            total: totals.total,
            paid: totals.paid,
            outstanding: totals.outstanding,
            warehouse:
              db.warehouses.find((w) => w.id === po.locationId)?.name ?? "—",
          };
        }),
    [db, t],
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
      {/*
       * Anchored to the pointer by a zero-size element, which is how antd
       * positions a menu somewhere that is not a child of anything. It is
       * `fixed` because the coordinates are the viewport's.
       */}
      <Dropdown
        open={menu !== null}
        onOpenChange={(open) => {
          if (!open) setMenu(null);
        }}
        trigger={[]}
        menu={{
          items: [
            {
              key: "delete",
              danger: true,
              icon: <DeleteOutlined />,
              label: t("inboundList.deleteOrder", "Delete this order"),
            },
          ],
          onClick: () => {
            const id = menu?.id;
            setMenu(null);
            if (id) askDelete(id);
          },
        }}
      >
        <span
          aria-hidden
          style={{
            position: "fixed",
            left: menu?.x ?? 0,
            top: menu?.y ?? 0,
            width: 0,
            height: 0,
          }}
        />
      </Dropdown>
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
          // The row is a control, so it is reachable from the keyboard
          // (owner ask 2026-09-15): Tab lands on it, ↑ ↓ walk the list, Enter
          // opens it. The label is what a screen reader reads instead of the
          // row's cells run together.
          keyboardRows={(r) =>
            t("inboundList.openOrder", "Open {{code}}", { code: r.code })
          }
          onRow={(r) => ({
            style: { cursor: "pointer" },
            onClick: () => navigate(`/inbound/${r.id}`),
            onContextMenu: (e) => {
              e.preventDefault();
              setMenu({ id: r.id, x: e.clientX, y: e.clientY });
            },
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
              /*
               * Payment, not stage (owner revision 2026-09-15). What staff
               * bring to this list is "who are we still paying?" — where the
               * GOODS have got to is answered by the Products column beside
               * it and by the order's own page. See `poPaymentStatus`.
               */
              title: t("inboundList.paymentStatus", "Payment status"),
              dataIndex: "paymentLabel",
              facet: true,
              sortValue: (r) => PO_PAYMENT_STATUSES.indexOf(r.payment),
              render: (_: unknown, r) => (
                <Tag color={PO_PAYMENT_STATUS_COLOR[r.payment]}>
                  {r.paymentLabel}
                </Tag>
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
