/**
 * The serial tracker — one serial's whole life, append-only: received,
 * QC'd, moved, reserved, sold, returned, serviced, found or lost.
 *
 * ## Why this reads the store and not the API (2026-09-07)
 *
 * It was migrated to `GET /api/katalog/unit` ahead of every screen that WRITES
 * a unit, and those all still write the browser store. So a machine accepted
 * at Inbound & QC never appeared here — not late, never — and the page could
 * only ever show the seed. The owner reported it as "I accept a product into
 * the inventory and it did not load in the serial tracker", which is exactly
 * what a read migrated ahead of its writes looks like from the shop floor.
 *
 * CLAUDE.md's own rule for the migration is that pages sharing an id space
 * move together — the three inbound pages had to be reverted for the same
 * reason on 2026-09-02. This page and Inbound & QC share the unit and the
 * ledger, so this comes back and they go over together.
 *
 * Nothing is lost by waiting: `packages/db`'s `unitTimeline`,
 * `GET /api/katalog/unit/:serial` and `lib/unitsApi.ts` all stay, tested, for
 * the day the writes move. Four things are gained meanwhile, and they are the
 * ones a person at the counter notices — the rack, the QC description, the
 * store barcode on a reprint, and a machine appearing the moment it is
 * accepted.
 *
 * The timeline *enriches* each event by looking sideways at the order,
 * reservation, purchase order and return tables. None of that is stored on the
 * event: it is joined at render time through the document CODE the event
 * carries, so the ledger below stays exactly what was written and this stays a
 * reading of it. The raw ledger card is the unembellished truth, and it is
 * deliberately still on the page.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Button,
  Card,
  Descriptions,
  Empty,
  Flex,
  Result,
  Select,
  Timeline,
  Typography,
} from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { LongText } from "../../components/LongText";
import { EnumTag } from "../../components/EnumTag";
import { GradeTag } from "../../components/GradeTag";
import { FilterBar } from "../../components/FilterBar";
import { PrintLabelsModal } from "../../components/LabelSheet";
import { fmtRp, fmtDateTime } from "../../lib/format.js";
import { labelFor } from "../../lib/labels.js";
import { useDb } from "../../mock/store.js";
import { resolveSerialQuery } from "../../lib/serialInput.js";
import type { MockDb, UnitEvent } from "../../mock/seed.js";
import { useScanTarget } from "../../hooks/useScanTarget.js";
import { labelOf, UNIT_EVENT, UNIT_STATUS } from "../../i18n/enumLabels.js";

/**
 * What an event was part of, resolved from the document code it carries.
 *
 * A hold is named on the way in AND on the way out, so a machine held,
 * released, and held again by somebody else narrates the right person on all
 * four rows. The page used to search the store for a reservation mentioning
 * the serial and take the first match, which named whoever was first on every
 * one of them.
 *
 * Keyed on the event TYPE as well as the code, because the same purchase order
 * is on a machine's arrival and on its QC pass, and only the first of those is
 * "arrived from". An event with no document says nothing rather than guessing:
 * a line of grey text under every entry is noise, and a wrong one is worse.
 */
type Context =
  | { kind: "SALE"; orderCode: string; customerName?: string; price?: number }
  | { kind: "HOLD"; customerName?: string; channelName?: string }
  | { kind: "SUPPLIER_RETURN"; returnCode: string; supplierName: string }
  | { kind: "ARRIVAL"; supplierName: string }
  | null;

function contextOf(db: MockDb, e: UnitEvent): Context {
  const ref = e.refCode;
  if (ref === undefined || ref === "") return null;

  if (e.type === "TERJUAL") {
    const order = db.orders.find((o) => o.code === ref);
    if (!order) return null;
    const customer = db.customers.find((c) => c.id === order.customerId);
    return {
      kind: "SALE",
      orderCode: order.code,
      ...(customer ? { customerName: customer.name } : {}),
      // What THIS machine was charged, not what the receipt totalled: a
      // receipt with a laptop and a mouse on it would otherwise narrate the
      // mouse as having sold for both.
      ...(order.prices[e.serial] === undefined
        ? {}
        : { price: order.prices[e.serial] }),
    };
  }

  if (e.type === "DIRESERVASI" || e.type === "RESERVASI_BATAL") {
    const hold = db.reservations.find((r) => r.code === ref);
    if (!hold) return null;
    const customer = db.customers.find((c) => c.id === hold.customerId);
    const channel = db.reservationSources.find((s) => s.id === hold.sourceId);
    return {
      kind: "HOLD",
      ...(customer ? { customerName: customer.name } : {}),
      ...(channel ? { channelName: channel.name } : {}),
    };
  }

  if (e.type === "RETUR_SUPPLIER") {
    const ret = db.returns.find((r) => r.code === ref);
    const supplier = db.suppliers.find((s) => s.id === ret?.supplierId);
    if (!ret || !supplier) return null;
    return {
      kind: "SUPPLIER_RETURN",
      returnCode: ret.code,
      supplierName: supplier.name,
    };
  }

  if (e.type === "DITERIMA") {
    const po = db.pos.find((p) => p.code === ref);
    const supplier = db.suppliers.find((s) => s.id === po?.supplierId);
    if (!supplier) return null;
    return { kind: "ARRIVAL", supplierName: supplier.name };
  }

  return null;
}

/**
 * The one-line context for an event.
 *
 * The WORDING lives here because it is user-facing copy and has to go through
 * the catalogue. Returns null when there is nothing to add, so the timeline
 * does not grow a row of empty grey text under every entry.
 */
function contextLine(
  ctx: Context,
  locationName: string | undefined,
  t: (k: string, d: string, v?: Record<string, unknown>) => string,
): string | null {
  if (!ctx) return locationName ?? null;
  if (ctx.kind === "SALE") {
    return [
      t("snTracking.ctxSold", "Sold on {{code}}", { code: ctx.orderCode }),
      ctx.customerName &&
        t("snTracking.ctxSoldTo", "to {{who}}", { who: ctx.customerName }),
      ctx.price != null &&
        t("snTracking.ctxSoldFor", "for {{amount}}", {
          amount: fmtRp(Number(ctx.price)),
        }),
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (ctx.kind === "HOLD") {
    return [
      ctx.customerName
        ? t("snTracking.ctxHeldFor", "Held for {{who}}", {
            who: ctx.customerName,
          })
        : t("snTracking.ctxHeld", "Held"),
      ctx.channelName &&
        t("snTracking.ctxCameFrom", "— came in from {{channel}}", {
          channel: ctx.channelName,
        }),
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (ctx.kind === "SUPPLIER_RETURN") {
    return t("snTracking.ctxReturned", "{{code}} → {{supplier}}", {
      code: ctx.returnCode,
      supplier: ctx.supplierName,
    });
  }
  return t(
    "snTracking.ctxArrived",
    "Waiting for QC — arrived from {{supplier}}",
    {
      supplier: ctx.supplierName,
    },
  );
}

/** How many serials the picker offers before it asks for a narrower search. */
const PICKER_LIMIT = 50;

export function StockHistoryPage() {
  const [printing, setPrinting] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const { t } = useTranslation();
  const navigate = useNavigate();
  const db = useDb();
  const [params, setParams] = useSearchParams();
  const serial = params.get("serial") ?? undefined;

  /** Every origin code the shop has issued, for reading a store barcode. */
  const supplierCodes = useMemo(
    () => db.suppliers.map((x) => x.code).filter((c): c is string => !!c),
    [db.suppliers],
  );
  /** Every serial the store holds — what a query is resolved against. */
  const knownSerials = useMemo(() => db.units.map((u) => u.serial), [db.units]);

  /*
   * A scan jumps straight to the serial rather than going through the picker,
   * and it is resolved first (owner ask 2026-09-08).
   *
   * A machine carries both barcodes and the counter reads whichever faces
   * them, so a scan of the shop's own sticker has to have its origin code
   * taken off before it can find anything. `resolveSerialQuery` also puts the
   * marker back on a bare read, which is the case a plain lookup missed: the
   * store holds `SC02740137JKM` and the case prints `C02740137JKM`.
   */
  const resolve = (raw: string) =>
    resolveSerialQuery(raw, knownSerials, supplierCodes);

  useScanTarget((scanned) => {
    const clean = resolve(scanned);
    if (clean) setParams({ serial: clean });
  });

  const unit = db.units.find((u) => u.serial === serial);
  const sku = db.skus.find((s) => s.id === unit?.skuId);
  const model = db.models.find((m) => m.id === sku?.modelId);
  const po = db.pos.find((p) => p.id === unit?.poId);
  const supplier = db.suppliers.find((s) => s.id === po?.supplierId);

  /** This unit's ledger, oldest first — the order it was written in. */
  const events = useMemo(
    () =>
      db.events
        .filter((e) => e.serial === serial)
        .slice()
        .sort((a, b) => a.seq - b.seq),
    [db.events, serial],
  );

  /**
   * The picker's options.
   *
   * Filtered over the store rather than asked of a server, and capped: a shop
   * with thousands of serials would otherwise render every one of them into a
   * dropdown on every keystroke.
   */
  const options = useMemo(() => {
    const typed = pickerQuery.trim();
    /*
     * Matched against BOTH what was typed and what it resolves to.
     *
     * Somebody typing the number off the case types `C02740…`, which is not a
     * substring of anything the store holds only because the marker is
     * missing from the front — so a substring search alone finds nothing and
     * the picker looks empty. Resolving first means the machine appears while
     * the marker is still absent from the box.
     */
    const q = typed.toLowerCase();
    const hit = typed === "" ? "" : resolve(typed).toLowerCase();
    return db.units
      .filter((u) => {
        if (q === "") return true;
        const s = db.skus.find((k) => k.id === u.skuId);
        const serial = u.serial.toLowerCase();
        return (
          serial.includes(q) ||
          serial === hit ||
          (s?.name ?? "").toLowerCase().includes(q) ||
          (s?.variantLabel ?? "").toLowerCase().includes(q)
        );
      })
      .slice(0, PICKER_LIMIT)
      .map((u) => {
        const s = db.skus.find((k) => k.id === u.skuId);
        return {
          value: u.serial,
          label:
            `${u.serial} — ${s?.name ?? ""} ${s?.variantLabel ?? ""}`.trim(),
        };
      });
    // `resolve` closes over the store, which changes identity every render;
    // the query and the serials are what actually decide this list. This
    // project's eslint config has no exhaustive-deps rule to disable, so the
    // reason is stated rather than suppressed.
  }, [db.units, db.skus, pickerQuery, knownSerials, supplierCodes]);

  /** A serial that was asked for and is not in the store. */
  const missing = serial !== undefined && unit === undefined;

  const locationNameOf = (id: string | undefined) =>
    db.warehouses.find((w) => w.id === id)?.name;

  return (
    <PageContainer title={t("snTracking.sNTracking", "S/N Tracking")}>
      <Flex vertical gap={16}>
        <Card>
          <FilterBar>
            <Select
              showSearch
              allowClear
              style={{ width: 480 }}
              value={serial}
              placeholder={t(
                "snTracking.searchASerialNumberTo",
                "Search a serial number to see its full lifecycle",
              )}
              optionFilterProp="label"
              filterOption={false}
              onSearch={setPickerQuery}
              options={options}
              onChange={(v) => setParams(v ? { serial: v } : {})}
            />
          </FilterBar>
        </Card>
        {!unit && serial === undefined && (
          <Card>
            <Empty
              description={t(
                "snTracking.pickASerialEveryUnit",
                "Pick a serial — every unit is tracked from the day it arrives, forever.",
              )}
            />
          </Card>
        )}
        {/* A serial that was asked for and does not exist is a recoverable
            state, not an error: the value stays on screen, and the two things
            worth doing next are one click away. */}
        {missing && (
          <Card>
            <Result
              status="404"
              title={serial}
              subTitle={t(
                "snTracking.noUnitWithThisSerial",
                "No unit with this serial is in the system. If it has just arrived, it may still be waiting at intake.",
              )}
              extra={[
                <Button
                  key="intake"
                  type="primary"
                  onClick={() => navigate("/inbound")}
                >
                  {t("snTracking.checkIntake", "Check intake")}
                </Button>,
                <Button key="clear" onClick={() => setParams({})}>
                  {t("snTracking.clear", "Clear")}
                </Button>,
              ]}
            />
          </Card>
        )}
        {unit && (
          <>
            <Card
              title={`${unit.serial} — ${sku?.name ?? ""} ${sku?.variantLabel ?? ""}`.trim()}
              // The one screen that shows a single serial in full is the one
              // where a staff member has already found the unit they want a
              // sticker for, so the action belongs in the card's own corner.
              extra={
                <Button
                  icon={<PrinterOutlined />}
                  onClick={() => setPrinting(true)}
                >
                  {t("snTracking.printLabel", "Print label")}
                </Button>
              }
            >
              <Descriptions
                // Facts about one unit: three across on a desktop, two on a
                // tablet, and one per line on a phone, where a three-column
                // description list wraps its own labels off their values.
                column={{ xs: 1, sm: 2, md: 3 }}
                items={[
                  {
                    key: "st",
                    label: t("snTracking.status", "Status"),
                    children: <EnumTag map={UNIT_STATUS} value={unit.status} />,
                  },
                  {
                    key: "wh",
                    label: t("snTracking.warehouse", "Warehouse"),
                    children: locationNameOf(unit.locationId) ?? "—",
                  },
                  {
                    key: "rk",
                    label: t("snTracking.location", "Location"),
                    children:
                      db.racks.find((r) => r.id === unit.rackId)?.name ?? "—",
                  },
                  {
                    // New or a letter (owner ask 2026-08-28). This is the one
                    // screen that shows a single machine in full, and it is
                    // also where a regrade lands: a unit that went out sealed
                    // and came back second-hand is graded at the return desk,
                    // and this is where somebody looks it up afterwards.
                    key: "g",
                    label: t("snTracking.grade", "Grade"),
                    children: <GradeTag grade={unit.grade} />,
                  },
                  {
                    key: "b",
                    label: t("snTracking.buyPrice", "Buy price"),
                    children: fmtRp(unit.buy),
                  },
                  {
                    key: "p",
                    label: t("snTracking.sellingPrice", "Selling price"),
                    // The variant's price. This machine has no price of its
                    // own since 2026-08-27, and what it eventually SOLD for is
                    // on the order, not here.
                    children: sku ? fmtRp(sku.price) : "—",
                  },
                  {
                    key: "d",
                    label: t("snTracking.description", "Description"),
                    children: unit.description === "" ? "—" : unit.description,
                  },
                  {
                    key: "po",
                    label: t("snTracking.fromPo", "From PO"),
                    children: po?.code ?? "—",
                  },
                ]}
              />
            </Card>
            <Card title={t("snTracking.lifecycle", "Lifecycle")}>
              <Timeline
                items={events.map((e) => {
                  const context = contextLine(
                    contextOf(db, e),
                    locationNameOf(e.locationId),
                    t,
                  );
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
                          {labelOf(UNIT_EVENT, e.type, t)}
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
            <Card
              title={t(
                "snTracking.rawLedgerAppendOnly",
                "Raw ledger (append-only)",
              )}
            >
              <ProTable
                rowKey="id"
                size="small"
                dataSource={events}
                searchPlaceholder={t(
                  "snTracking.searchEventNoteOrReference",
                  "Search event, note or reference",
                )}
                // One unit's whole life. Long-lived serials run to dozens of
                // events, so the ledger loads in pages like every other list.
                resetKey={serial}
                columns={[
                  { title: "#", dataIndex: "seq", width: 50 },
                  {
                    title: t("snTracking.when", "When"),
                    dataIndex: "at",
                    render: fmtDateTime,
                  },
                  {
                    title: t("snTracking.event", "Event"),
                    dataIndex: "type",
                    facet: true,
                    searchable: true,
                    sortValue: (e) => labelOf(UNIT_EVENT, e.type, t),
                    render: (v) => labelOf(UNIT_EVENT, v, t),
                  },
                  {
                    title: t("snTracking.from", "From"),
                    dataIndex: "fromStatus",
                    facet: true,
                  },
                  {
                    title: t("snTracking.to", "To"),
                    dataIndex: "toStatus",
                    facet: true,
                  },
                  {
                    title: t("snTracking.ref", "Ref"),
                    dataIndex: "refCode",
                    searchable: true,
                    render: (v) => v ?? "—",
                  },
                  {
                    title: t("snTracking.note", "Note"),
                    dataIndex: "note",
                    searchable: true,
                    width: 340,
                    render: (v: string | undefined) => <LongText>{v}</LongText>,
                  },
                  {
                    title: t("snTracking.by", "By"),
                    dataIndex: "staff",
                    facet: true,
                  },
                ]}
              />
            </Card>

            <PrintLabelsModal
              open={printing}
              onClose={() => setPrinting(false)}
              // The store form of the barcode, which is what the shop's own
              // phones scan. The supplier's origin code is two hops the page
              // already holds — unit → purchase order → supplier — and it is
              // why a reprint from here now matches a reprint from Inventory.
              labels={[labelFor(unit, sku, model, supplier?.code)]}
            />
          </>
        )}
      </Flex>
    </PageContainer>
  );
}
