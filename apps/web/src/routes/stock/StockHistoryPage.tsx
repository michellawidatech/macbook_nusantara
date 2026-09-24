/**
 * S/N Tracking — every serial the shop holds, and each one's whole life,
 * append-only: received, QC'd, moved, reserved, sold, returned, serviced,
 * found or lost.
 *
 * ## Two views on one route (owner ask 2026-09-19)
 *
 * Without `?serial=` the page is a LIST of every serial the store holds —
 * Serial, Unit, Warehouse, its last movement, and a *Check history* button.
 * It filters by category, product and unit (one tree, in the Unit column's
 * header — `components/CatalogueFilter`) and by the date of each serial's
 * newest ledger row, which sits above the table: a date range is two
 * calendars, and a header dropdown is no place for two calendars.
 *
 * With `?serial=` it is that serial's history, unchanged: the unit card, the
 * lifecycle and the raw ledger. The history gets a back arrow to the list —
 * there are no breadcrumbs (CLAUDE.md, 2026-08-26) — and the list stays
 * MOUNTED behind it, hidden, so coming back finds the same search, filters,
 * sort and page instead of a list started over. The serial stays in the URL,
 * so a bookmarked `/stock/history?serial=…` still lands on the history; no
 * screen links here any more — a serial elsewhere opens a popup (2026-09-21).
 *
 * A scan opens a serial from either view, and so does Enter in the search box
 * when what was typed names a serial the store holds (`serialToOpen`, which
 * reads the shop's sticker and the case's bare number the way every other
 * serial field does). Anything else typed only narrows the list.
 *
 * *Last movement* is a column the owner did not list, and it is there on
 * purpose: the list filters on it, and a filter on a value nobody can see is a
 * filter nobody can check. It also keeps Warehouse honest — a sold unit still
 * carries the location it left from, and "Sold" beside it is what says the
 * unit is no longer on that shelf.
 *
 * ## Why this reads the store and not the API (2026-09-07)
 *
 * It was migrated to `GET /api/katalog/unit` ahead of every screen that WRITES
 * a unit, and those all still write the browser store. So a unit accepted at
 * Inbound & QC never appeared here — not late, never — and the page could
 * only ever show the seed. The owner reported it as "I accept a product into
 * the inventory and it did not load in the serial tracker", which is exactly
 * what a read migrated ahead of its writes looks like from the shop floor.
 *
 * CLAUDE.md's own rule for the migration is that pages sharing an id space
 * move together — the three inbound pages had to be reverted for the same
 * reason on 2026-09-02. This page and Inbound & QC share the unit and the
 * ledger, so this comes back and they go over together. The list added on
 * 2026-09-19 reads the store for the same reason.
 *
 * Nothing is lost by waiting: `packages/db`'s `unitTimeline`,
 * `GET /api/katalog/unit/:serial` and `lib/unitsApi.ts` all stay, tested, for
 * the day the writes move. Four things are gained meanwhile, and they are the
 * ones a person at the counter notices — the rack, the QC description, the
 * store barcode on a reprint, and a unit appearing the moment it is accepted.
 *
 * The history itself — the unit card, the lifecycle and the raw ledger — is
 * `components/SerialHistory`, since 2026-09-21: every other screen's serial
 * opens it in a popup now (`SerialLink`) instead of linking here, and this
 * page shows the same component in place.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Button, Card, DatePicker, Input, Typography, theme } from "antd";
import { HistoryOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { SerialHistory } from "../../components/SerialHistory";
import {
  CatalogueFilterPanel,
  CatalogueFilterSelect,
} from "../../components/CatalogueFilter";
import { fmtDateTime, fmtNone } from "../../lib/format.js";
import { PAGE_SEARCH_ATTR } from "../../lib/keyboardNav";
import { useDb } from "../../mock/store.js";
import { resolveSerialQuery } from "../../lib/serialInput.js";
import {
  catalogueTree,
  filterTrackerRows,
  serialToOpen,
  trackerRows,
  type TrackerRow,
} from "../../lib/serialTracker.js";
import type { MockDb } from "../../mock/seed.js";
import { useScanTarget } from "../../hooks/useScanTarget.js";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { SPACE, TYPE } from "../../theme/tokens";
import { labelOf, UNIT_EVENT } from "../../i18n/enumLabels.js";
import { draftKey, usePersistentState } from "../../hooks/usePersistentState";
import { asListOf, asString } from "../../lib/draftGuards.js";

/**
 * The nearest ancestor that scrolls — `Layout.Content`, in this app's shell,
 * which is the scroll box for an ordinary page rather than the window.
 */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p !== null; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === "auto" || overflowY === "scroll") return p;
  }
  return null;
}

export function StockHistoryPage() {
  const { t } = useTranslation();
  const db = useDb();
  const [params, setParams] = useSearchParams();
  const serial = params.get("serial") ?? undefined;
  const top = useRef<HTMLDivElement>(null);

  /** Every origin code the shop has issued, for reading a store barcode. */
  const supplierCodes = useMemo(
    () => db.suppliers.map((x) => x.code).filter((c): c is string => !!c),
    [db.suppliers],
  );
  /** Every serial the store holds — what a query is resolved against. */
  const knownSerials = useMemo(() => db.units.map((u) => u.serial), [db.units]);

  /** Open one serial's history. A push, so the browser's Back returns here. */
  const open = (next: string) => setParams({ serial: next });

  /*
   * A scan jumps straight to the serial, from the list or from another
   * serial's history, and it is resolved first (owner ask 2026-09-08).
   *
   * A unit carries both barcodes and the counter reads whichever faces them,
   * so a scan of the shop's own sticker has to have its origin code taken off
   * before it can find anything. `resolveSerialQuery` also puts the marker
   * back on a bare read, which is the case a plain lookup missed: the store
   * holds `SC02740137JKM` and the case prints `C02740137JKM`. A serial the
   * store does not hold is still opened — the history answers it with the
   * "not in the system" card and the way to intake.
   */
  useScanTarget((scanned) => {
    const clean = resolveSerialQuery(scanned, knownSerials, supplierCodes);
    if (clean) open(clean);
  });

  /*
   * Each view starts at its top. The two share one scroll box, so without
   * this a history opened from row forty of the list would open forty rows
   * down — past the unit card, which is the part somebody came for.
   */
  useEffect(() => {
    const box = scrollParent(top.current);
    if (box !== null) box.scrollTop = 0;
  }, [serial]);

  return (
    <PageContainer
      title={t("snTracking.sNTracking", "S/N Tracking")}
      {...(serial === undefined ? {} : { backTo: "/stock/history" })}
    >
      <div ref={top}>
        <div hidden={serial !== undefined}>
          <SerialList db={db} supplierCodes={supplierCodes} onOpen={open} />
        </div>
        {serial !== undefined && (
          <SerialHistory db={db} serial={serial} onBack={() => setParams({})} />
        )}
      </div>
    </PageContainer>
  );
}

/**
 * Every serial the store holds (owner ask 2026-09-19) — see the page's
 * docblock for what it shows and why.
 *
 * The search, the tree and the date range narrow the rows HERE, before
 * `ProTable` sees them, because none of the three is something `ProTable`
 * can hold: its search cannot be asked what Enter should open, and its
 * header filters are flat lists of a column's own values. `ProTable` still
 * sorts and pages what it is handed.
 */
function SerialList({
  db,
  supplierCodes,
  onOpen,
}: {
  db: MockDb;
  supplierCodes: readonly string[];
  onOpen: (serial: string) => void;
}) {
  const { t } = useTranslation();
  const { compact } = useLayoutMode();
  const {
    token: { colorTextSecondary },
  } = theme.useToken();
  // The list's own search and filters, kept on this device like every other
  // list's (2026-09-21). The date range is left out: a "last movement" window
  // picked yesterday is rarely the question today.
  const [query, setQuery] = usePersistentState<string>(
    draftKey("list.serials.query"),
    "",
    asString,
  );
  const [skus, setSkus] = usePersistentState<string[]>(
    draftKey("list.serials.products"),
    [],
    asListOf((v): v is string => typeof v === "string"),
  );
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);

  const all = useMemo(
    () => trackerRows(db),
    // The five tables the list reads, rather than the store object, whose
    // identity changes whenever anything anywhere in it moves.
    [db.units, db.skus, db.models, db.warehouses, db.events],
  );
  const tree = useMemo(() => catalogueTree(all), [all]);

  // Whole days, in the shop's own time: "moved on the 12th" means any time
  // that day, not the instant the calendar's midnight happens to name.
  const movedFrom = range?.[0]?.startOf("day").valueOf();
  const movedTo = range?.[1]?.endOf("day").valueOf();

  const rows = useMemo(
    () =>
      filterTrackerRows(all, {
        query,
        supplierCodes,
        skuIds: skus,
        movedFrom,
        movedTo,
      }),
    [all, query, supplierCodes, skus, movedFrom, movedTo],
  );

  /** What Enter opens: a serial the store holds, named outright. */
  const openTyped = (value: string) => {
    const hit = serialToOpen(
      value,
      all.map((r) => r.serial),
      supplierCodes,
    );
    if (hit !== null) onOpen(hit);
  };

  const filtering = skus.length > 0 || range !== null;

  return (
    <Card>
      <ProTable<TrackerRow>
        persistKey="serials"
        rowKey="serial"
        dataSource={rows}
        search={false}
        // Search, tree and dates are new questions, so each sends the pager
        // back to page one — see DataTable's `resetKey`.
        resetKey={`${query}|${skus.join()}|${movedFrom ?? ""}|${movedTo ?? ""}`}
        toolbar={
          <>
            <Input.Search
              allowClear
              // What `/` jumps to (owner ask 2026-09-15) — this page's
              // search, in place of the one `ProTable` would draw.
              {...{ [PAGE_SEARCH_ATTR]: "" }}
              value={query}
              placeholder={t(
                "snTracking.searchPlaceholder",
                "Search or scan a serial, product or warehouse",
              )}
              aria-label={t(
                "snTracking.searchPlaceholder",
                "Search or scan a serial, product or warehouse",
              )}
              onChange={(e) => setQuery(e.target.value)}
              onSearch={(value, _e, info) => {
                // The clear button reports as a search of nothing.
                if (info?.source !== "clear") openTyped(value);
              }}
              style={{ width: compact ? undefined : 320 }}
            />
            {/* On a phone there is no column header, so the tree the Unit
                column carries on a desktop is drawn here instead — one
                state, two controls, as ProTable does with its own. */}
            {compact && (
              <CatalogueFilterSelect
                tree={tree}
                value={skus}
                onChange={setSkus}
              />
            )}
            <DatePicker.RangePicker
              value={range}
              onChange={(v) => setRange(v && (v[0] || v[1]) ? v : null)}
              allowEmpty={[true, true]}
              format="DD MMM YYYY"
              placeholder={[
                t("snTracking.movedSince", "Moved since"),
                t("snTracking.movedUntil", "Moved until"),
              ]}
              aria-label={t("snTracking.movedBetween", "Last movement between")}
            />
            {/* Visible from outside the header, because a lit funnel among
                five column titles is easy to set and easy to forget —
                ProTable's own reasoning for its link of the same name. */}
            {filtering && (
              <Button
                type="link"
                size="small"
                onClick={() => {
                  setSkus([]);
                  setRange(null);
                }}
              >
                {t("snTracking.clearFilters", "Clear filters")}
              </Button>
            )}
          </>
        }
        columns={[
          {
            title: t("snTracking.serial", "Serial"),
            dataIndex: "serial",
            render: (v: string) => (
              <Typography.Text style={{ fontFamily: "monospace" }}>
                {v}
              </Typography.Text>
            ),
          },
          {
            title: t("snTracking.unit", "Unit"),
            key: "unit",
            sortValue: (r) => `${r.product} ${r.variant}`,
            render: (_, r) => (
              <>
                <Typography.Text strong>
                  {r.product || fmtNone()}
                </Typography.Text>
                <Typography.Text
                  type="secondary"
                  style={{ display: "block", fontSize: TYPE.sm }}
                >
                  {r.variant}
                </Typography.Text>
              </>
            ),
            // The header filter, on a desktop. antd draws the funnel and
            // the dropdown; the state and the narrowing are the list's.
            ...(compact
              ? {}
              : {
                  filtered: skus.length > 0,
                  filterDropdown: ({ close }: { close: () => void }) => (
                    <CatalogueFilterPanel
                      tree={tree}
                      value={skus}
                      onChange={setSkus}
                      onDone={close}
                    />
                  ),
                }),
          },
          {
            title: t("snTracking.warehouse", "Warehouse"),
            dataIndex: "warehouse",
            render: (v: string) => v || fmtNone(),
          },
          {
            title: t("snTracking.lastMovement", "Last movement"),
            key: "last",
            // Newest first: "what just happened" is the question a list of
            // every serial is most often opened to answer.
            defaultSortOrder: "descend",
            sortValue: (r) =>
              r.last === undefined ? undefined : Date.parse(r.last.at),
            render: (_, r) =>
              r.last === undefined ? (
                fmtNone()
              ) : (
                <>
                  <Typography.Text>
                    {labelOf(UNIT_EVENT, r.last.type, t)}
                  </Typography.Text>
                  <Typography.Text
                    type="secondary"
                    style={{ display: "block", fontSize: TYPE.sm }}
                  >
                    {fmtDateTime(r.last.at)}
                  </Typography.Text>
                </>
              ),
          },
          {
            // Blank by convention: DataTable drops an untitled column to the
            // foot of the card on a phone, where buttons belong.
            title: "",
            key: "actions",
            width: 160,
            render: (_, r) => (
              <Button
                size="small"
                icon={<HistoryOutlined />}
                // The visible words first, so somebody driving the page by
                // voice can say what they see.
                aria-label={t(
                  "snTracking.checkHistoryAria",
                  "Check history of {{serial}}",
                  { serial: r.serial },
                )}
                onClick={() => onOpen(r.serial)}
              >
                {t("snTracking.checkHistory", "Check history")}
              </Button>
            ),
          },
        ]}
      />
      {rows.length !== all.length && (
        <Typography.Text
          style={{
            display: "block",
            marginTop: SPACE.sm,
            fontSize: TYPE.sm,
            color: colorTextSecondary,
          }}
        >
          {t("proTable.narrowed", "Showing {{shown}} of {{total}}", {
            shown: rows.length,
            total: all.length,
          })}
        </Typography.Text>
      )}
    </Card>
  );
}
