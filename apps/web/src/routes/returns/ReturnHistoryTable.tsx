/**
 * Every return, both directions, in one table (owner ask 2026-09-23).
 *
 * > *"I think you can just combine the table (so it is 1 table for all from
 * > customer and to supplier), but add the 'Type' which are 'to supplier' and
 * > 'from customer', date, associated transaction/inbound … only display
 * > transaction number/inbound, date, supplier/customer, reason, and when the
 * > row is clicked, it will show a popup of all the unit."*
 *
 * Two tables of the same document, differing in which way the unit travelled,
 * was two vocabularies for one job. The columns are the five facts common to
 * both; everything per unit is behind the row, which is the shape Inventory
 * already uses for the units behind a line.
 *
 * A row is one press of Record return. Customer returns group by the instant
 * their `RETUR` adjustments share — a press can touch several sales — falling
 * back to the exchange they were part of and then to their own code, which is
 * also how a B2Soft document's lines arrive. A supplier return is one row per
 * document, and a counted product's return is a `RETUR_SUPPLIER` stock move
 * with no return row at all.
 */
import { useMemo, useState } from "react";
import { Flex, Modal, Table, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { ProTable } from "../../components/ProTable";
import { SerialLink } from "../../components/SerialLink";
import { GradeTag } from "../../components/GradeTag";
import { fmtDate, fmtNone } from "../../lib/format.js";
import { saleOfReturn } from "../../lib/returns.js";
import { useDb } from "../../mock/store.js";
import { SPACE, TYPE } from "../../theme/tokens";

type Side = "CUSTOMER" | "SUPPLIER";

/** One unit — or one quantity of a counted product — inside a return. */
interface ReturnLine {
  readonly key: string;
  readonly product: string;
  /** Absent on a counted product: there is no serial to show. */
  readonly serial?: string;
  /** The grade it is recorded at. Absent on a counted product. */
  readonly grade?: string;
  /** Pieces, on a counted product. */
  readonly qty?: number;
}

interface HistoryRow {
  readonly key: string;
  readonly side: Side;
  /** The sale's SI code, or the invoice the units came in on. */
  readonly documents: readonly string[];
  /** The return's own SG codes. */
  readonly codes: readonly string[];
  readonly date: string;
  readonly party: string;
  readonly reason: string;
  readonly lines: readonly ReturnLine[];
}

export function ReturnHistoryTable() {
  const { t } = useTranslation();
  const db = useDb();
  const [open, setOpen] = useState<HistoryRow | null>(null);

  const sideLabel = (s: Side) =>
    s === "CUSTOMER"
      ? t("returns.fromCustomer", "From customer")
      : t("returns.toSupplier", "To supplier");

  const rows = useMemo<HistoryRow[]>(() => {
    const skus = new Map(db.skus.map((k) => [k.id, k]));
    const units = new Map(db.units.map((u) => [u.serial, u]));
    const skuName = (id: string | undefined) => {
      const sku = id === undefined ? undefined : skus.get(id);
      return sku ? `${sku.name} ${sku.variantLabel}` : fmtNone();
    };
    /** The row while it is being built: the arrays are still growing. */
    interface Draft {
      key: string;
      side: Side;
      documents: string[];
      codes: string[];
      date: string;
      party: string;
      reason: string;
      lines: ReturnLine[];
    }
    const groups = new Map<string, Draft>();
    const rowFor = (
      key: string,
      seed: Omit<Draft, "key" | "documents" | "codes" | "lines">,
    ): Draft => {
      let row = groups.get(key);
      if (row === undefined) {
        row = { key, ...seed, documents: [], codes: [], lines: [] };
        groups.set(key, row);
      }
      return row;
    };
    const note = (row: Draft, document: string | undefined, code: string) => {
      if (document !== undefined && !row.documents.includes(document))
        row.documents.push(document);
      if (!row.codes.includes(code)) row.codes.push(code);
    };

    for (const r of db.returns) {
      const unit = units.get(r.serial);
      if (r.kind === "CUSTOMER") {
        const sale = saleOfReturn(db.orders, r);
        const adj = sale?.adjustments?.find(
          (a) => a.type === "RETUR" && a.code === r.code,
        );
        const key = adj
          ? `at:${adj.at}`
          : r.exchangeSerial
            ? `ex:${r.exchangeSerial}`
            : `code:${r.code}`;
        const customer =
          sale?.customerId == null
            ? t("piutang.walkIn", "Walk-in")
            : (db.customers.find((c) => c.id === sale.customerId)?.name ??
              t("piutang.walkIn", "Walk-in"));
        const row = rowFor(key, {
          side: "CUSTOMER",
          date: r.date,
          party: customer,
          reason: [r.reason, r.reasonDetail].filter(Boolean).join(": "),
        });
        note(row, sale?.code, r.code);
        row.lines.push({
          key: r.id,
          product: skuName(unit?.skuId),
          serial: r.serial,
          ...((r.afterGrade ?? unit?.grade)
            ? { grade: r.afterGrade ?? unit?.grade }
            : {}),
        });
        continue;
      }
      const po = db.pos.find((p) => p.items.some((i) => i.serial === r.serial));
      const row = rowFor(`sup:${r.code}`, {
        side: "SUPPLIER",
        date: r.date,
        party:
          db.suppliers.find((x) => x.id === r.supplierId)?.name ??
          t("utang.noSupplier", "No supplier named"),
        reason: [r.reason, r.reasonDetail].filter(Boolean).join(": "),
      });
      note(row, po?.code, r.code);
      row.lines.push({
        key: r.id,
        product: skuName(unit?.skuId),
        serial: r.serial,
        ...(unit?.grade ? { grade: unit.grade } : {}),
      });
    }

    // Counted products move on the ledger and have no return row of their own.
    for (const m of db.stockMoves) {
      if (m.type !== "RETUR_PELANGGAN" && m.type !== "RETUR_SUPPLIER") continue;
      const code = m.refCode ?? m.id;
      const customerSide = m.type === "RETUR_PELANGGAN";
      const sale =
        m.orderId === undefined
          ? undefined
          : db.orders.find((o) => o.id === m.orderId);
      const adj = sale?.adjustments?.find(
        (a) => a.type === "RETUR" && a.code === code,
      );
      const po =
        m.poId === undefined ? undefined : db.pos.find((p) => p.id === m.poId);
      const key = customerSide
        ? adj
          ? `at:${adj.at}`
          : `code:${code}`
        : `sup:${code}`;
      const row = rowFor(key, {
        side: customerSide ? "CUSTOMER" : "SUPPLIER",
        date: m.at,
        party: customerSide
          ? sale?.customerId == null
            ? t("piutang.walkIn", "Walk-in")
            : (db.customers.find((c) => c.id === sale.customerId)?.name ??
              t("piutang.walkIn", "Walk-in"))
          : (db.suppliers.find((x) => x.id === po?.supplierId)?.name ??
            t("utang.noSupplier", "No supplier named")),
        reason:
          db.reasons.find((r) => r.id === m.reasonId)?.label ?? m.note ?? "",
      });
      note(row, customerSide ? sale?.code : po?.code, code);
      row.lines.push({
        key: m.id,
        product: skuName(m.skuId),
        qty: Math.abs(m.qty),
      });
    }

    return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [
    db.returns,
    db.stockMoves,
    db.orders,
    db.pos,
    db.units,
    db.skus,
    db.customers,
    db.suppliers,
    db.reasons,
    t,
  ]);

  return (
    <>
      <ProTable<HistoryRow>
        persistKey="returns.history"
        rowKey="key"
        dataSource={rows}
        searchPlaceholder={t(
          "returns.searchHistory",
          "Search a transaction, an invoice, a name or a reason",
        )}
        onRow={(r) => ({
          onClick: () => setOpen(r),
          style: { cursor: "pointer" },
        })}
        keyboardRows={(r) => r.codes.join(", ")}
        columns={[
          {
            title: t("returns.type", "Type"),
            key: "side",
            width: 160,
            facet: true,
            facetLabel: t("returns.type", "Type"),
            facetValue: (r) => sideLabel(r.side),
            sortValue: (r) => sideLabel(r.side),
            render: (_, r) => (
              <Tag color={r.side === "CUSTOMER" ? "purple" : "blue"}>
                {sideLabel(r.side)}
              </Tag>
            ),
          },
          {
            title: t("returns.document", "Transaction / inbound"),
            key: "document",
            width: 240,
            searchable: true,
            searchValue: (r) => [...r.documents, ...r.codes].join(" "),
            sortValue: (r) => r.documents[0] ?? "",
            render: (_, r) => (
              <Flex vertical gap={0}>
                <Typography.Text strong>
                  {r.documents.length === 0
                    ? fmtNone()
                    : r.documents.join(", ")}
                </Typography.Text>
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: TYPE.sm, fontFamily: "monospace" }}
                >
                  {r.codes.join(", ")}
                </Typography.Text>
              </Flex>
            ),
          },
          {
            title: t("returns.date", "Date"),
            key: "date",
            width: 130,
            defaultSortOrder: "descend",
            dateRange: true,
            facetLabel: t("returns.date", "Date"),
            sortValue: (r) => r.date,
            render: (_, r) => fmtDate(r.date),
          },
          {
            title: t("returns.party", "Supplier / customer"),
            key: "party",
            width: 200,
            searchable: true,
            searchValue: (r) => r.party,
            sortValue: (r) => r.party,
            render: (_, r) => r.party,
          },
          {
            title: t("returns.reason", "Reason"),
            key: "reason",
            searchable: true,
            searchValue: (r) => r.reason,
            sortValue: (r) => r.reason,
            render: (_, r) => r.reason || fmtNone(),
          },
        ]}
      />

      <Modal
        open={open !== null}
        onCancel={() => setOpen(null)}
        footer={null}
        width={720}
        title={
          open && (
            <Flex vertical gap={2}>
              <span>{open.codes.join(", ")}</span>
              <Typography.Text
                type="secondary"
                style={{ fontSize: TYPE.sm, fontWeight: 400 }}
              >
                {[sideLabel(open.side), open.party, fmtDate(open.date)].join(
                  " · ",
                )}
              </Typography.Text>
            </Flex>
          )
        }
      >
        <Table<ReturnLine>
          rowKey="key"
          size="small"
          pagination={false}
          dataSource={open?.lines ?? []}
          columns={[
            {
              title: t("returns.product", "Product"),
              key: "product",
              render: (_, l) => (
                <Flex vertical gap={0}>
                  <Typography.Text>{l.product}</Typography.Text>
                  {l.qty !== undefined && (
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: TYPE.sm }}
                    >
                      ×{l.qty}
                    </Typography.Text>
                  )}
                </Flex>
              ),
            },
            {
              title: t("returns.serial", "Serial number"),
              key: "serial",
              width: 220,
              render: (_, l) =>
                l.serial === undefined ? (
                  <Typography.Text type="secondary">
                    {fmtNone()}
                  </Typography.Text>
                ) : (
                  <SerialLink serial={l.serial} />
                ),
            },
            {
              title: t("returns.condition", "Condition"),
              key: "grade",
              width: 130,
              render: (_, l) =>
                // A counted product has no condition — it is a quantity.
                l.serial === undefined || l.grade === undefined ? (
                  <Typography.Text type="secondary">
                    {fmtNone()}
                  </Typography.Text>
                ) : (
                  <GradeTag grade={l.grade} />
                ),
            },
          ]}
        />
        <Typography.Text
          type="secondary"
          style={{ fontSize: TYPE.sm, display: "block", marginTop: SPACE.sm }}
        >
          {open?.reason}
        </Typography.Text>
      </Modal>
    </>
  );
}
