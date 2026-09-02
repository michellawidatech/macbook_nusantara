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
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Flex,
  Result,
  Select,
  Skeleton,
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
import { useQuery } from "@tanstack/react-query";
import {
  getUnitTimeline,
  searchUnits,
  unitPickerKey,
  unitTimelineKey,
  type TimelineContext,
  type TimelineEvent,
} from "../../lib/unitsApi.js";
import { describeApiError } from "../../i18n/apiErrors.js";
import { ApiRequestError } from "../../lib/api.js";
import { useScanTarget } from "../../hooks/useScanTarget.js";
import { labelOf, UNIT_EVENT, UNIT_STATUS } from "../../i18n/enumLabels.js";


/**
 * The one-line context for an event, rendered from what the server joined.
 *
 * The enrichment itself moved to `packages/db`'s `unitTimeline`, where every
 * join is an id the EVENT carries — `orderId`, `reservationId`,
 * `purchaseOrderId`. This page used to search each mock table for a row
 * mentioning the serial and take the first match, so a machine held, released,
 * and held again by a different customer narrated the wrong person on both
 * events. It could not have known better: nothing recorded which hold an event
 * belonged to until `UnitEvent.reservationId` shipped.
 *
 * What stays here is the WORDING, because it is user-facing copy and has to go
 * through the catalogue. Returns null when there is nothing to add, so the
 * timeline does not grow a row of empty grey text under every entry.
 */
function contextLine(
  ctx: TimelineContext | null,
  t: (k: string, d: string, v?: Record<string, unknown>) => string,
): string | null {
  if (!ctx) return null;
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
  if (ctx.kind === "ARRIVAL") {
    return t("snTracking.ctxArrived", "Waiting for QC — arrived from {{supplier}}", {
      supplier: ctx.supplierName,
    });
  }
  return ctx.locationName;
}

export function StockHistoryPage() {
  const [printing, setPrinting] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const serial = params.get("serial") ?? undefined;

  // A scan jumps straight to the serial rather than going through the picker.
  // The picker is a `Select`, so it can only ever hold a serial that already
  // exists — which is exactly the case a scan needs to survive.
  useScanTarget((scanned) => {
    const clean = scanned.trim().toUpperCase();
    if (clean) setParams({ serial: clean });
  });

  /**
   * The serial's whole life, in one round trip.
   *
   * `enabled` rather than a conditional hook: with no serial chosen there is
   * nothing to ask for, and the page shows its empty state.
   */
  const timeline = useQuery({
    queryKey: unitTimelineKey(serial ?? ""),
    queryFn: ({ signal }) => getUnitTimeline(serial!, signal),
    enabled: serial !== undefined,
    // A serial that does not exist is an ANSWER, not a failure to retry — the
    // page has a recoverable 404 state for exactly that.
    retry: false,
    staleTime: 10_000,
  });

  /** The picker's options, searched server-side rather than over every unit. */
  const picker = useQuery({
    queryKey: unitPickerKey(pickerQuery),
    queryFn: ({ signal }) => searchUnits(pickerQuery, signal),
    staleTime: 30_000,
  });

  const unit = timeline.data?.unit;
  const events: readonly TimelineEvent[] = timeline.data?.events ?? [];
  /** A 404 is "no such serial", which this page answers rather than reports. */
  const missing =
    timeline.isError &&
    timeline.error instanceof ApiRequestError &&
    timeline.error.status === 404;

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
              loading={picker.isPending}
              onSearch={setPickerQuery}
              notFoundContent={picker.isPending ? "…" : null}
              options={(picker.data?.units ?? []).map((u) => ({
                value: u.serial,
                label: `${u.serial} — ${u.productName} ${u.variantLabel ?? ""}`.trim(),
              }))}
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
        {/* First load. A skeleton rather than a spinner: the shape of what is
            coming is known, and this page is mostly one tall card. */}
        {serial !== undefined && timeline.isPending && (
          <Card>
            <Skeleton active paragraph={{ rows: 6 }} />
          </Card>
        )}
        {/* A real failure — not a missing serial — renders as a warning rather
            than as the 404 below, which would tell the operator something
            false about their serial. */}
        {timeline.isError && !missing && (
          <Alert
            type="warning"
            showIcon
            message={describeApiError(timeline.error, t)}
          />
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
                  onClick={() => navigate("/stock/in")}
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
              title={`${unit.serial} — ${unit.productName} ${unit.variantLabel ?? ""}`.trim()}
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
                    children: unit.locationName ?? "—",
                  },
                  {
                    key: "rk",
                    label: t("snTracking.location", "Location"),
                    // Always "—" for now: there is no Rack model in the
                    // schema, so a warehouse and a shelf cannot both be
                    // stored. The row stays because the answer "we do not
                    // record that" is different from the row not existing.
                    children: unit.rackName ?? "—",
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
                    // Money crosses the wire as a decimal string of whole
                    // rupiah; `fmtRp` still takes a number.
                    children: fmtRp(Number(unit.buy)),
                  },
                  {
                    key: "p",
                    label: t("snTracking.sellingPrice", "Selling price"),
                    // The variant's price. This machine has no price of its
                    // own to show since 2026-08-27, and what it eventually
                    // SOLD for is on the order, not here.
                    children: fmtRp(Number(unit.price)),
                  },
                  {
                    key: "d",
                    label: t("snTracking.description", "Description"),
                    // Always "—" for now: `Unit` has no description column,
                    // and the schema's own docblocks disagree about whether
                    // `UnitNote` is its home. An owner decision.
                    children: unit.description ?? "—",
                  },
                  {
                    key: "po",
                    label: t("snTracking.fromPo", "From PO"),
                    children: unit.purchaseOrderCode ?? "—",
                  },
                ]}
              />
            </Card>
            <Card title={t("snTracking.lifecycle", "Lifecycle")}>
              <Timeline
                items={events.map((e) => {
                  const context = contextLine(e.context, t);
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
                          · {fmtDateTime(e.at)} · {e.staffName}
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
              // `labelFor`'s structured-axis path needs `ModelAxisValue`
              // rows, and nothing in the codebase writes any — so the server
              // has none to serve and this is exactly the documented fallback:
              // the model line, then the variant as the shop wrote it.
              labels={[
                {
                  serial: unit.serial,
                  // The bare serial, which is `LabelDatum.barcode`'s documented
                  // fallback. This page is API-backed and the unit it serves
                  // carries a supplier NAME but no origin code, so there is
                  // nothing here to derive a store barcode from — and inventing
                  // one from a name would print a sticker that scans as
                  // nothing. Reprint from Inventory to get the store form.
                  barcode: unit.serial,
                  line1: unit.modelName ?? unit.productName,
                  line2: unit.variantLabel ?? "",
                },
              ]}
            />
          </>
        )}
      </Flex>
    </PageContainer>
  );
}
