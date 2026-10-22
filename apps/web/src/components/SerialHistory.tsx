/**
 * One serial's whole history — the unit card, the lifecycle and the raw
 * ledger.
 *
 * Moved out of `StockHistoryPage` on 2026-09-21, when the owner asked for
 * every clickable serial to open a popup instead of leaving the page: *"for
 * any serial number that is clickable, when clicked, should have popup modal
 * instead of redirecting."* S/N Tracking still shows it in place under
 * `?serial=`; everywhere else a serial is a `SerialLink`, which opens this in
 * the one dialog the shell mounts (`SerialHistoryHost`).
 *
 * The timeline *enriches* each event by looking sideways at the order,
 * reservation, purchase order and return tables. None of that is stored on
 * the event: it is joined at render time through the document CODE the event
 * carries, so the ledger below stays exactly what was written and this stays
 * a reading of it. The raw ledger card is the unembellished truth, and it is
 * deliberately still here.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  App,
  Button,
  Card,
  Descriptions,
  Dropdown,
  Flex,
  Result,
  Timeline,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  MoreOutlined,
  PrinterOutlined,
} from "@ant-design/icons";
import { ProTable } from "./ProTable";
import { LongText } from "./LongText";
import { EnumTag } from "./EnumTag";
import { GradeTag } from "./GradeTag";
import { UnitPhotos } from "./UnitPhotos";
import { PrintLabelsModal } from "./LabelSheet";
import { fmtRp, fmtDateTime, fmtNone } from "../lib/format.js";
import { customerLabel } from "../lib/customers.js";
import { labelFor } from "../lib/labels.js";
import { priceOf } from "../lib/unitPrice.js";
import type { MockDb, UnitEvent } from "../mock/seed.js";
import { mutate, qcPhotosOf, removeEvent } from "../mock/store.js";
import { historyRowBlock } from "../lib/saleDeletion.js";
import { COLUMN, TYPE } from "../theme/tokens";
import { labelOf, UNIT_EVENT, UNIT_STATUS } from "../i18n/enumLabels.js";
import { warehouseLabelOf } from "../lib/warehouses.js";

/**
 * What an event was part of, resolved from the document code it carries.
 *
 * A hold is named on the way in AND on the way out, so a unit held, released,
 * and held again by somebody else narrates the right person on all four rows.
 * The page used to search the store for a reservation mentioning the serial
 * and take the first match, which named whoever was first on every one of
 * them.
 *
 * Keyed on the event TYPE as well as the code, because the same purchase order
 * is on a unit's arrival and on its QC pass, and only the first of those is
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
    /*
     * A unit handed over in an EXCHANGE names the return it went out for
     * (2026-09-21: that is how a return lists several replacements with no
     * schema change) — and it went out on the sale that return undid, which
     * is the sale carrying it.
     */
    const order =
      db.orders.find((o) => o.code === ref) ??
      (db.returns.some((r) => r.code === ref)
        ? db.orders
            .filter((o) => o.serials.includes(e.serial) && o.ts <= e.at)
            .sort((a, b) => b.ts.localeCompare(a.ts))[0]
        : undefined);
    if (!order) return null;
    const customer = db.customers.find((c) => c.id === order.customerId);
    return {
      kind: "SALE",
      orderCode: order.code,
      ...(customer ? { customerName: customerLabel(customer) } : {}),
      // What THIS unit was charged, not what the receipt totalled: a receipt
      // with a laptop and a mouse on it would otherwise narrate the mouse as
      // having sold for both.
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
      ...(customer ? { customerName: customerLabel(customer) } : {}),
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

/** A ledger row's from/to status: the raw value, or None for "-" or none. */
const statusCell = (v: string | undefined): string =>
  v === undefined || v === "" || v === "-" ? fmtNone() : v;

/**
 * One serial's history — the view S/N Tracking always was, unchanged but for
 * the selling price (per serial since 2026-09-08) and the way back.
 *
 * `inDialog` is the popup's reading of it: the raw ledger keeps no search or
 * filter on this device (a list inside a dialog never does — CLAUDE.md), and
 * the way back is *Close* rather than *Clear*.
 */
export function SerialHistory({
  db,
  serial,
  onBack,
  inDialog = false,
}: {
  db: MockDb;
  serial: string;
  /** Back to the list, or — in a dialog — close it. */
  onBack: () => void;
  inDialog?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [printing, setPrinting] = useState(false);
  const { modal, message } = App.useApp();

  /** Why a row's ⋯ → Delete is off, in words; undefined when it is on. */
  const deleteBlockText = (e: UnitEvent) => {
    switch (historyRowBlock(db, e)) {
      case "ONLY_ROW":
        return t(
          "snTracking.deleteOnlyRow",
          "A unit always keeps at least one history row.",
        );
      case "LIVE_SALE":
        return t(
          "snTracking.deleteLiveSale",
          "This unit is still on {{code}}. Delete the transaction in Transaction History instead.",
          { code: e.refCode ?? "" },
        );
      default:
        return undefined;
    }
  };

  /*
   * One row out of the unit's history (owner ask 2026-10-22). Behind a ⋯
   * menu and a confirm, because a deleted row is not coming back; the newest
   * row going puts the unit back to what the row before it says.
   */
  const deleteRow = (e: UnitEvent) =>
    modal.confirm({
      title: t("snTracking.deleteRowTitle", "Delete this history row?"),
      content: t(
        "snTracking.deleteRowBody",
        "“{{event}}” on {{date}} is removed from this unit's history for good.",
        { event: labelOf(UNIT_EVENT, e.type, t), date: fmtDateTime(e.at) },
      ),
      okText: t("snTracking.deleteRowOk", "Delete row"),
      okButtonProps: { danger: true },
      onOk: () => {
        let done = false;
        mutate((d) => {
          const now = d.events.find((x) => x.id === e.id);
          if (now === undefined || historyRowBlock(d, now) !== undefined)
            return;
          done = removeEvent(d, e.id);
        });
        if (done)
          message.success(t("snTracking.rowDeleted", "History row deleted."));
      },
    });

  const unit = db.units.find((u) => u.serial === serial);
  const sku = db.skus.find((s) => s.id === unit?.skuId);
  const model = db.models.find((m) => m.id === sku?.modelId);
  const po = db.pos.find((p) => p.id === unit?.poId);

  /** This unit's ledger, oldest first — the order it was written in. */
  const events = useMemo(
    () =>
      db.events
        .filter((e) => e.serial === serial)
        .slice()
        .sort((a, b) => a.seq - b.seq),
    [db.events, serial],
  );

  const locationNameOf = (id: string | undefined) =>
    warehouseLabelOf(db.warehouses, id);

  /*
   * A serial that was asked for and does not exist is a recoverable state, not
   * an error: the value stays on screen, and the two things worth doing next
   * are one click away.
   */
  if (unit === undefined) {
    return (
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
              onClick={() => {
                onBack();
                navigate("/inbound");
              }}
            >
              {t("snTracking.checkIntake", "Check intake")}
            </Button>,
            <Button key="clear" onClick={onBack}>
              {inDialog
                ? t("common.close", "Close")
                : t("snTracking.clear", "Clear")}
            </Button>,
          ]}
        />
      </Card>
    );
  }

  /*
   * What THIS unit asks (per serial since 2026-09-08 — `lib/unitPrice.ts`).
   * The card showed the variant's `Sku.price` until 2026-09-19, which is the
   * figure a unit STARTS from, not what two units of one variant ask once QC
   * has priced them apart. A unit nobody has priced yet — still in QC, or
   * taken in before the per-serial price — quotes its variant's asking price,
   * and says so, rather than passing that off as its own.
   */
  const price = sku === undefined ? unit.price : priceOf(unit, sku.price);

  return (
    <Flex vertical gap={16}>
      <Card
        title={`${unit.serial} — ${sku?.name ?? ""} ${sku?.variantLabel ?? ""}`.trim()}
        // The one screen that shows a single serial in full is the one where
        // a staff member has already found the unit they want a sticker for,
        // so the action belongs in the card's own corner.
        extra={
          <Button icon={<PrinterOutlined />} onClick={() => setPrinting(true)}>
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
              children: locationNameOf(unit.locationId) ?? fmtNone(),
            },
            {
              key: "rk",
              label: t("snTracking.location", "Location"),
              children:
                db.racks.find((r) => r.id === unit.rackId)?.name ?? fmtNone(),
            },
            {
              // New or a letter (owner ask 2026-08-28). This is the one
              // screen that shows a single unit in full, and it is also
              // where a regrade lands: a unit that went out sealed and came
              // back second-hand is graded at the return desk, and this is
              // where somebody looks it up afterwards.
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
              // What it eventually SOLD for is on the order, and the
              // timeline's "Sold on …" line says it; this is the asking.
              children:
                price === undefined ? (
                  fmtRp(0)
                ) : (
                  <>
                    {fmtRp(price)}
                    {unit.price === undefined && (
                      <Typography.Text
                        type="secondary"
                        style={{ display: "block", fontSize: TYPE.sm }}
                      >
                        {t(
                          "snTracking.variantPriceHint",
                          "Not priced yet — the variant's asking price",
                        )}
                      </Typography.Text>
                    )}
                  </>
                ),
            },
            {
              key: "d",
              label: t("snTracking.description", "Description"),
              children: unit.description === "" ? fmtNone() : unit.description,
            },
            {
              key: "po",
              label: t("snTracking.fromPo", "From PO"),
              children: po?.code ?? fmtNone(),
            },
            {
              // Every QC photograph, larger than a list's thumbnails: this is
              // the one screen that shows a single unit in full (owner ask
              // 2026-09-29). Purged at the sale, so a sold unit says None.
              // A unit the shop still holds can be photographed here too
              // (owner ask 2026-10-21) — not a sold one, whose photos the
              // sale purged on purpose.
              key: "ph",
              label: t("snTracking.photos", "Photos"),
              span: "filled",
              children: ["QC", "TERSEDIA", "DIRESERVASI", "SERVIS"].includes(
                unit.status,
              ) ? (
                <UnitPhotos serial={unit.serial} size={72} max={8} editable />
              ) : qcPhotosOf(db, unit.serial).length === 0 ? (
                fmtNone()
              ) : (
                <UnitPhotos serial={unit.serial} size={72} max={8} />
              ),
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
                  : e.type === "OPNAME_HILANG" || e.type === "RETUR_SUPPLIER"
                    ? "red"
                    : e.type === "QC_SELESAI"
                      ? "green"
                      : e.type === "DITERIMA"
                        ? "orange"
                        : "gray",
              // `content`, antd 6's name for what `children` was.
              content: (
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
      <Card title={t("snTracking.rawLedger", "Raw ledger")}>
        <ProTable
          {...(inDialog ? {} : { persistKey: "serials.history" })}
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
              // A unit's first row comes from nowhere, and the store writes
              // that as "-" — which is data, and prints as None.
              facetValue: (e) => statusCell(e.fromStatus),
              render: (v?: string) => statusCell(v),
            },
            {
              title: t("snTracking.to", "To"),
              dataIndex: "toStatus",
              facet: true,
              facetValue: (e) => statusCell(e.toStatus),
              render: (v?: string) => statusCell(v),
            },
            {
              title: t("snTracking.ref", "Ref"),
              dataIndex: "refCode",
              searchable: true,
              render: (v) => v ?? fmtNone(),
            },
            {
              title: t("snTracking.note", "Note"),
              dataIndex: "note",
              searchable: true,
              width: 200,
              render: (v: string | undefined) => <LongText>{v}</LongText>,
            },
            {
              title: t("snTracking.by", "By"),
              dataIndex: "staff",
              facet: true,
            },
            {
              title: "",
              key: "more",
              width: COLUMN.action,
              render: (_: unknown, e: UnitEvent) => {
                const blocked = deleteBlockText(e);
                return (
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items: [
                        {
                          key: "delete",
                          danger: true,
                          icon: <DeleteOutlined />,
                          disabled: blocked !== undefined,
                          label:
                            blocked ?? t("snTracking.deleteRow", "Delete row"),
                        },
                      ],
                      onClick: ({ key, domEvent }) => {
                        domEvent.stopPropagation();
                        if (key === "delete") deleteRow(e);
                      },
                    }}
                  >
                    <Button
                      size="small"
                      type="text"
                      icon={<MoreOutlined />}
                      aria-label={t(
                        "snTracking.rowMenu",
                        "More for row {{seq}}",
                        {
                          seq: e.seq,
                        },
                      )}
                      onClick={(ev) => ev.stopPropagation()}
                    />
                  </Dropdown>
                );
              },
            },
          ]}
        />
      </Card>

      <PrintLabelsModal
        open={printing}
        onClose={() => setPrinting(false)}
        // The serial as stored — the same sticker Inventory reprints.
        labels={[labelFor(unit, sku, model)]}
      />
    </Flex>
  );
}
