/**
 * The serial tracker — one serial's whole life, append-only: received,
 * QC'd, moved, reserved, sold, returned, serviced, found or lost.
 *
 * The timeline *enriches* each event by looking sideways at the order,
 * reservation and return tables — a sale shows the channel it came through and
 * who bought it, a hold shows who it is being held for. None of that is stored
 * on the event: it is joined at render time, so the ledger below stays exactly
 * what was written and this stays a reading of it. The raw ledger card is the
 * unembellished truth, and it is deliberately still on the page.
 */
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Card,
  Descriptions,
  Empty,
  Flex,
  Select,
  Tag,
  Timeline,
  Typography,
} from "antd";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { FilterBar } from "../../components/FilterBar";
import { fmtRp, fmtDateTime } from "../../lib/format.js";
import { useDb } from "../../mock/store.js";
import type { MockDb, UnitEvent } from "../../mock/seed.js";

const EVENT_LABEL: Record<string, string> = {
  // Owner's wording: a unit that has just arrived has NOT been through QC yet,
  // so calling this "received into QC" claimed a step that had not happened.
  DITERIMA: "Pending to QC",
  QC_SELESAI: "QC passed — entered inventory",
  DICATAT: "Note",
  DIPINDAH: "Moved",
  DIRESERVASI: "Reserved",
  RESERVASI_BATAL: "Reservation cancelled",
  TERJUAL: "Sold",
  RETUR_PELANGGAN: "Returned by customer",
  RETUR_SUPPLIER: "Returned to supplier",
  OPNAME_HILANG: "Missing at opname",
  OPNAME_DITEMUKAN: "Found at opname",
  KOREKSI: "Adjustment",
};

const SOURCE_LABEL: Record<string, string> = {
  OFFLINE: "in store",
  SHOPEE: "on Shopee",
  INSTAGRAM: "via Instagram",
  WHATSAPP: "via WhatsApp",
};

/**
 * The one-line context for an event, joined from whatever table actually knows
 * it. Returns null when there is nothing to add, so the timeline does not grow
 * a row of empty grey text under every entry.
 */
function contextFor(db: MockDb, e: UnitEvent, serial: string): string | null {
  if (e.type === "TERJUAL") {
    const order = db.orders.find((o) => o.serials.includes(serial));
    if (!order) return null;
    const who = db.customers.find((c) => c.id === order.customerId)?.name;
    const paid = order.prices[serial];
    return [
      `Sold ${SOURCE_LABEL[order.source] ?? order.source.toLowerCase()}`,
      who && `to ${who}`,
      paid != null && `for ${fmtRp(paid)}`,
      `on ${order.code}`,
      !order.settled && "— money not withdrawn yet",
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (e.type === "DIRESERVASI") {
    const rsv = db.reservations.find((r) => r.serial === serial);
    if (!rsv) return null;
    const who = db.customers.find((c) => c.id === rsv.customerId)?.name;
    const channel = db.reservationSources.find(
      (s) => s.id === rsv.sourceId,
    )?.name;
    return ["Held", who && `for ${who}`, channel && `— came in from ${channel}`]
      .filter(Boolean)
      .join(" ");
  }
  if (e.type === "RESERVASI_BATAL") {
    const rsv = db.reservations.find((r) => r.serial === serial);
    const who = rsv && db.customers.find((c) => c.id === rsv.customerId)?.name;
    return who ? `Hold for ${who} released — back in sellable stock` : null;
  }
  if (e.type === "RETUR_SUPPLIER" || e.type === "RETUR_PELANGGAN") {
    const ret = db.returns.find((r) => r.serial === serial);
    if (!ret) return null;
    const sup = db.suppliers.find((s) => s.id === ret.supplierId)?.name;
    return [ret.code, sup && `→ ${sup}`, ret.fromQc && "— rejected at QC"]
      .filter(Boolean)
      .join(" ");
  }
  if (e.type === "DITERIMA") {
    const unit = db.units.find((u) => u.serial === serial);
    const po = db.pos.find((p) => p.id === unit?.poId);
    const sup = db.suppliers.find((s) => s.id === po?.supplierId)?.name;
    return sup ? `Waiting for QC — arrived from ${sup}` : "Waiting for QC";
  }
  if (e.type === "QC_SELESAI") {
    const unit = db.units.find((u) => u.serial === serial);
    const rack = db.racks.find((r) => r.id === unit?.rackId)?.name;
    const wh = db.warehouses.find((w) => w.id === unit?.locationId)?.name;
    return [wh, rack].filter(Boolean).join(" · ") || null;
  }
  return null;
}

export function StockHistoryPage() {
  const db = useDb();
  const [params, setParams] = useSearchParams();
  const serial = params.get("serial") ?? undefined;

  const unit = db.units.find((u) => u.serial === serial);
  const sku = unit && db.skus.find((s) => s.id === unit.skuId);
  const events = useMemo(
    () =>
      db.events
        .filter((e) => e.serial === serial)
        .sort((a, b) => b.seq - a.seq),
    [db.events, serial],
  );

  return (
    <PageContainer title="S/N Tracking">
      <Flex vertical gap={16}>
        <Card>
          <FilterBar>
            <Select
              showSearch
              allowClear
              style={{ width: 480 }}
              value={serial}
              placeholder="Search a serial number to see its full lifecycle"
              optionFilterProp="label"
              options={db.units.map((u) => {
                const k = db.skus.find((s) => s.id === u.skuId)!;
                return {
                  value: u.serial,
                  label: `${u.serial} — ${k.name} ${k.variantLabel}`,
                };
              })}
              onChange={(v) => setParams(v ? { serial: v } : {})}
            />
          </FilterBar>
        </Card>
        {!unit && (
          <Card>
            <Empty description="Pick a serial — every unit is tracked from the day it arrives, forever." />
          </Card>
        )}
        {unit && sku && (
          <>
            <Card title={`${unit.serial} — ${sku.name} ${sku.variantLabel}`}>
              <Descriptions
                // Facts about one unit: three across on a desktop, two on a
                // tablet, and one per line on a phone, where a three-column
                // description list wraps its own labels off their values.
                column={{ xs: 1, sm: 2, md: 3 }}
                items={[
                  {
                    key: "st",
                    label: "Status",
                    children: <Tag>{unit.status}</Tag>,
                  },
                  {
                    key: "wh",
                    label: "Warehouse",
                    children: db.warehouses.find(
                      (w) => w.id === unit.locationId,
                    )?.name,
                  },
                  {
                    key: "rk",
                    label: "Location",
                    children:
                      db.racks.find((r) => r.id === unit.rackId)?.name ?? "—",
                  },
                  { key: "b", label: "Buy price", children: fmtRp(unit.buy) },
                  {
                    key: "p",
                    label: "Selling price",
                    children: fmtRp(unit.price),
                  },
                  {
                    key: "d",
                    label: "Description",
                    children: unit.description || "—",
                  },
                  {
                    key: "po",
                    label: "From PO",
                    children:
                      db.pos.find((p) => p.id === unit.poId)?.code ?? "—",
                  },
                ]}
              />
            </Card>
            <Card title="Lifecycle">
              <Timeline
                items={events.map((e) => {
                  const context = contextFor(db, e, unit.serial);
                  return {
                    color:
                      e.type === "TERJUAL"
                        ? "blue"
                        : e.type === "OPNAME_HILANG" ||
                            e.type === "RETUR_SUPPLIER"
                          ? "red"
                          : e.type === "QC_SELESAI"
                            ? "green"
                            : e.type === "DITERIMA"
                              ? "orange"
                              : "gray",
                    children: (
                      <>
                        <Typography.Text strong>
                          {EVENT_LABEL[e.type] ?? e.type}
                        </Typography.Text>{" "}
                        <Typography.Text type="secondary">
                          · {fmtDateTime(e.at)} · {e.staff}
                          {e.refCode ? ` · ${e.refCode}` : ""}
                        </Typography.Text>
                        {context && <div>{context}</div>}
                        {e.note && (
                          <Typography.Text
                            type="secondary"
                            style={{ display: "block" }}
                          >
                            {e.note}
                          </Typography.Text>
                        )}
                      </>
                    ),
                  };
                })}
              />
            </Card>
            <Card title="Raw ledger (append-only)">
              <ProTable
                rowKey="id"
                size="small"
                dataSource={events}
                searchPlaceholder="Search event, note or reference"
                // One unit's whole life. Long-lived serials run to dozens of
                // events, so the ledger loads in pages like every other list.
                resetKey={serial}
                columns={[
                  { title: "#", dataIndex: "seq", width: 50 },
                  { title: "When", dataIndex: "at", render: fmtDateTime },
                  {
                    title: "Event",
                    dataIndex: "type",
                    facet: true,
                    searchable: true,
                    sortValue: (e) => EVENT_LABEL[e.type] ?? e.type,
                    render: (v) => EVENT_LABEL[v] ?? v,
                  },
                  { title: "From", dataIndex: "fromStatus", facet: true },
                  { title: "To", dataIndex: "toStatus", facet: true },
                  {
                    title: "Ref",
                    dataIndex: "refCode",
                    searchable: true,
                    render: (v) => v ?? "—",
                  },
                  {
                    title: "Note",
                    dataIndex: "note",
                    searchable: true,
                    ellipsis: true,
                  },
                  { title: "By", dataIndex: "staff", facet: true },
                ]}
              />
            </Card>
          </>
        )}
      </Flex>
    </PageContainer>
  );
}
