/**
 * Inventory & Stock Movement — what the shop holds, and every hand that moved
 * it.
 *
 * Two nav items until 2026-08-26. "Inventory" counted stock by product;
 * "Stock Movement" listed it by serial and owned the adjustment machinery. The
 * owner asked for one screen with one table, and `InventoryTable` is that
 * table: flat since 2026-09-19 — a line per variant, grade and warehouse, its
 * units nested under it. This file is what remains — the page frame, the stock
 * movement history (every row of it editable since 2026-09-24, through
 * `StockMovementEditModal`), the stock export (`StockExportModal`), and the
 * two modals that actually write.
 *
 * **Counted categories have no battery.** An accessory (a category with
 * `tracksSerial` off, 2026-09-15) has no battery to read and no serial anybody
 * reads, so neither the batch grid nor the single-unit Adjust asks for one on
 * it (2026-09-19) — a box nobody can fill is a box somebody fills with a
 * guess.
 *
 * **The batch is the flow.** Staff do not adjust one unit. They come back from
 * the back room having moved three or four machines for one reason, and the
 * single-unit form this page used to open made that four trips through the same
 * two fields. So the modal is one act: a direction and a reason at the top,
 * chosen once, and a grid of units below them. The scanner fills that grid the
 * way it fills Inbound's.
 *
 * **What a direction does to a unit**, because the log has to mean something:
 *
 * - **In** makes the unit sellable in the chosen warehouse. If nothing in the
 *   system carries that serial the row is marked *Unknown* and staff say what
 *   it is — product and specs — and the adjustment CREATES the unit. That is
 *   the real case this replaces: a machine turns up in the shop that no PO ever
 *   covered, and until now the only way in was inventing a purchase order.
 * - **Out** takes the unit out of stock to the status picked in the header —
 *   written off (a repair is *Send to service* on the unit's row since
 *   2026-10-26). `UnitStatus` has no "adjusted out" member
 *   and this file does not invent one; the header names the destination so what
 *   the log says and what the unit's status says cannot disagree.
 *
 * The reason is created here, and the managed list in Settings learns it FIRST:
 * `ensureReason` runs inside the same `mutate` as the adjustment rows, so there
 * is no instant at which an adjustment points at a reason the settings page has
 * never heard of. That is why an adjustment stores a `reasonId` and not text.
 */
import { useEffect, useRef, useState } from "react";
import { isLiveSku } from "../../lib/skuCode.js";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { SerialLink } from "../../components/SerialLink";
import {
  App,
  AutoComplete,
  Button,
  Card,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  UploadOutlined,
  EditOutlined,
  LoginOutlined,
  LogoutOutlined,
} from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { EditableTable } from "../../components/EditableTable";
import { InventoryTable } from "./InventoryTable";
import { StockExportModal } from "./StockExportModal";
import { PriceImportModal } from "./PriceImportModal";
import { StockMovementEditModal } from "./StockMovementEditModal";
import {
  stockHistoryRows,
  stockHistorySkuId,
  type StockHistoryRow,
} from "../../lib/stockHistory.js";
import { skuTracksSerial } from "../../lib/serialTracking.js";
import {
  averageCost,
  onHand,
  takeFrom,
  withStockOnHand,
} from "../../lib/stock.js";
import { EnumTag } from "../../components/EnumTag";
import { LongText } from "../../components/LongText";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { fmtDateTime, fmtNone } from "../../lib/format.js";
import {
  batteryBandOf,
  defaultBatteryModeOfSku,
  batteryPatch,
  batterySettingsFrom,
  readBattery,
  releaseYearOfSku,
  type BatteryMode,
} from "../../lib/battery.js";
import { BatteryFields } from "../../components/BatteryFields.js";
import { HELD_STATUSES } from "../../lib/inventory.js";
import { reprojectHolds } from "../../lib/reservations.js";
import {
  batchProblems,
  IN_STOCK,
  normaliseSerial as normalise,
} from "../../lib/adjustmentBatch.js";
import { rendered } from "../../lib/rendered.js";
import { useScanTarget } from "../../hooks/useScanTarget.js";
import { draftKey, usePersistentState } from "../../hooks/usePersistentState";
import {
  FIELD,
  asBoolean,
  asListOf,
  asOneOf,
  asString,
  hasShape,
} from "../../lib/draftGuards.js";
import {
  useDb,
  mutate,
  appendEvent,
  ensureReason,
  nextId,
  currentStaffName,
} from "../../mock/store.js";
import { tagOf, UNIT_STATUS } from "../../i18n/enumLabels.js";
import { COLUMN, SPACE, TYPE } from "../../theme/tokens";
import type {
  Adjustment,
  AdjustmentKind,
  MockDb,
  UnitStatus,
} from "../../mock/seed.js";
import { warehouseLabel, warehouseLabelOf } from "../../lib/warehouses.js";

/** Rows the modal opens with — the owner's "typically three or four". */
const BLANK_ROWS = 1;

/**
 * Where an OUT adjustment leaves the unit — a write-off, and nothing else.
 *
 * "On service" left this list on 2026-10-26 (owner ask): a unit going to a
 * repairer goes through *Send to service* on its row, the one dialog every
 * door opens, which asks where and how each charge was paid. Stock out asked
 * neither, so the two doors disagreed about what a visit is.
 */
type OutStatus = Extract<UnitStatus, "HILANG">;

const OUT_STATUSES: { value: OutStatus; label: string; hint: string }[] = [
  {
    value: "HILANG",
    label: "Lost / written off",
    hint: "the unit is gone: shrinkage, damaged beyond sale, taken for internal use",
  },
];

interface BatchRow {
  key: string;
  serial: string;
  /** Only for a serial no unit carries: what staff say the machine is. */
  modelId?: string;
  skuId?: string;
  /** An Apple silicon or 2021-or-later machine's reading, as a percentage. */
  batteryHealth?: number;
  /** An older Intel machine's, in cycles… */
  cycleCount?: number;
  /** …and its capacity in mAh. */
  fcc?: number;
  description: string;
}

let rowSeq = 0;
/**
 * A row's key is unique across reloads, not just within one: a batch is kept
 * on this device (below), and a counter that restarts at one would hand a new
 * row the key of a row already in the restored batch.
 */
const blankRow = (): BatchRow => ({
  key: `batch-${Date.now().toString(36)}-${++rowSeq}`,
  serial: "",
  description: "",
});
const blankRows = () => Array.from({ length: BLANK_ROWS }, blankRow);

/*
 * The batch being typed, kept on this device (owner ask 2026-09-21: "all the
 * things of the user input will be saved locally"). The in-app tab strip used
 * to keep it alive while somebody looked something up; now leaving the page,
 * or reloading it, brings the dialog back open with what was typed.
 */
const BATCH_DRAFT = (name: string) => draftKey(`inventory.batch.${name}`);
const isBatchRow = (v: unknown): v is BatchRow =>
  hasShape(v, {
    key: FIELD.string,
    serial: FIELD.string,
    description: FIELD.string,
    modelId: FIELD.optString,
    skuId: FIELD.optString,
    batteryHealth: FIELD.optNumber,
    cycleCount: FIELD.optNumber,
    fcc: FIELD.optNumber,
  });
interface CountedRow {
  key: string;
  skuId?: string;
  qty: number | null;
}
const isCountedRow = (v: unknown): v is CountedRow =>
  hasShape(v, {
    key: FIELD.string,
    skuId: FIELD.optString,
    qty: (q) => q === null || (typeof q === "number" && Number.isFinite(q)),
  });
const parseBatchRows = (v: unknown): BatchRow[] | undefined => {
  const rows = asListOf(isBatchRow)(v);
  return rows === undefined || rows.length === 0 ? undefined : rows;
};

/** A row is in play once anything has been typed into it. */
const touched = (r: BatchRow) =>
  r.serial.trim() !== "" ||
  r.description.trim() !== "" ||
  r.batteryHealth != null ||
  r.cycleCount != null ||
  r.fcc != null ||
  r.skuId !== undefined;

export function InventoryPage() {
  const db = useDb();
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { message, modal } = App.useApp();
  const { compact } = useLayoutMode();
  /** The stock export dialog (owner ask 2026-09-19). */
  const [exporting, setExporting] = useState(false);
  const [importingPrices, setImportingPrices] = useState(false);
  /** The history row being corrected (owner ask 2026-09-24). */
  const [editing, setEditing] = useState<StockHistoryRow | null>(null);
  // ── The batch, held as plain state rather than in a Form ──────────────────
  // The grid below is a line-item editor, and antd's Form.List buys validation
  // this page does its own way (one dialog listing every problem at once,
  // as Stock In's bulk accept does) at the cost of addressing every cell
  // through a name path.
  const [adding, setAdding] = usePersistentState<boolean>(
    BATCH_DRAFT("open"),
    false,
    asBoolean,
  );
  const [kind, setKind] = usePersistentState<AdjustmentKind>(
    BATCH_DRAFT("kind"),
    "OUT",
    asOneOf<AdjustmentKind>(["IN", "OUT"]),
  );
  const [reason, setReason] = usePersistentState<string>(
    BATCH_DRAFT("reason"),
    "",
    asString,
  );
  const [outStatus, setOutStatus] = usePersistentState<OutStatus>(
    BATCH_DRAFT("outStatus"),
    "HILANG",
    asOneOf<OutStatus>(["HILANG"]),
  );
  const [locationId, setLocationId] = usePersistentState<string>(
    BATCH_DRAFT("location"),
    db.myWarehouseId,
    asString,
  );
  const [rows, setRows] = usePersistentState<BatchRow[]>(
    BATCH_DRAFT("rows"),
    blankRows,
    parseBatchRows,
  );
  /**
   * Counted products on the batch — accessories, by quantity (2026-09-19).
   * They have no serial to scan, so they are their own short list.
   */
  const [countedRows, setCountedRows] = usePersistentState<CountedRow[]>(
    BATCH_DRAFT("counted"),
    [],
    asListOf(isCountedRow),
  );
  const countedSkus = db.skus.filter(
    (s) => isLiveSku(s) && !skuTracksSerial(db, s.id),
  );
  /*
   * What the counted picker offers (owner ask 2026-10-26). Stock in may bring
   * in any variant; Stock out only one the shop has pieces of — offering the
   * rest is offering a line the batch refuses. Counted anywhere, not only at
   * this desk's warehouse: an OUT batch names no warehouse, and `takeFrom`
   * takes from this desk first and then wherever else holds the product.
   */
  const pickableCounted =
    kind === "OUT" ? withStockOnHand(countedSkus, db.stockMoves) : countedSkus;
  /**
   * One batch, once — a ref rather than state, because that is the only kind
   * of latch that closes in time.
   *
   * Two clicks on the OK button land before React re-renders, so BOTH handlers
   * validate against the `db` snapshot from the render they closed over: the
   * second one cannot see the unit the first one just created, passes the
   * "already in stock" check it should fail, and writes a second adjustment
   * against the same serial. A ref is written synchronously, so the second
   * call reads what the first one set. Reset when the modal is opened.
   */
  const submitted = useRef(false);

  const batterySettings = batterySettingsFrom(db.settings);
  const skuOf = (skuId: string) => db.skus.find((s) => s.id === skuId);
  /**
   * The battery an adjustment recorded, in the units its machine reports.
   *
   * Reads the era off the UNIT, because the adjustment carries the numbers and
   * the unit carries the model that says which of them mean anything. A row
   * whose serial has since been renamed away falls back to health, which is
   * the reading the column showed before the split.
   */
  const adjustmentBattery = (a: Adjustment) =>
    readBattery(
      a,
      releaseYearOfSku(
        db,
        db.units.find((u) => u.serial === a.serial)?.skuId ?? "",
      ),
      batterySettings,
    );

  /**
   * The reading one row of the batch editor STARTS on.
   *
   * A row for a serial the shop already carries takes it from that unit; a row
   * for an unknown serial takes it from the product being chosen on the row
   * itself. Both can be absent while somebody is still typing, and the default
   * is health — the reading the box asked for before the split.
   */
  const batchModeOf = (r: BatchRow): BatteryMode => {
    const skuId = batchSkuOf(r);
    return skuId ? defaultBatteryModeOfSku(db, skuId) : "HEALTH";
  };
  /** The variant a batch row is about: its unit's, or the one picked for an unknown serial. */
  const batchSkuOf = (r: BatchRow): string | undefined =>
    db.units.find((u) => u.serial === r.serial.trim().toUpperCase())?.skuId ??
    r.skuId;
  /**
   * Does this variant have a battery to ask about? Not when its category is
   * counted rather than identified — an accessory (2026-09-19). A row whose
   * variant is not known yet still asks: the safe direction, as
   * `lib/serialTracking.ts` reasons about an unknown category.
   */
  const hasBattery = (skuId: string | undefined) => skuTracksSerial(db, skuId);
  /**
   * A row as it is judged and written. A counted variant's row carries no
   * battery, whatever its hidden boxes last held — a reading typed before the
   * product was changed to a sleeve must not be validated against a field
   * nobody can see, or filed on the sleeve.
   */
  const asWritten = (r: BatchRow): BatchRow =>
    hasBattery(batchSkuOf(r))
      ? r
      : {
          ...r,
          batteryHealth: undefined,
          cycleCount: undefined,
          fcc: undefined,
        };
  const unitOf = (serial: string) =>
    db.units.find((u) => u.serial === normalise(serial));
  const adjustmentReasons = db.reasons.filter(
    (r) => r.activity === "ADJUSTMENT" && r.active,
  );
  const statusLabel = (s: string) => tagOf(UNIT_STATUS, s, t).label;

  const setRow = (key: string, patch: Partial<BatchRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const openAdd = (direction: AdjustmentKind = "OUT") => {
    submitted.current = false;
    setKind(direction);
    setReason("");
    setOutStatus("HILANG");
    setLocationId(db.myWarehouseId);
    setRows(blankRows());
    setCountedRows([]);
    setAdding(true);
  };

  /**
   * A scan drops into the first row still waiting for a serial.
   *
   * Deliberately NOT `planSerialFill`: that plan refuses a serial the system
   * already knows, which is right for an intake — a second unit cannot claim
   * an existing serial — and exactly wrong here, where a known serial is the
   * ordinary case and an unknown one is the exception.
   */
  const scanIntoBatch = async (raw: string) => {
    const serial = normalise(raw);
    if (!serial) return;
    if (!adding) {
      message.info('Open "Add adjustment" first — scans fill the batch.');
      return;
    }
    if (rows.some((r) => normalise(r.serial) === serial)) {
      message.warning(`${serial} is already on this batch.`);
      return;
    }
    const target = rows.find((r) => r.serial.trim() === "");
    if (!target) {
      message.warning("Every row already has a serial — add a row first.");
      return;
    }
    const unit = unitOf(serial);
    setRow(target.key, {
      serial,
      // Prefilled from the unit, so the common case — a batch that only
      // records where four machines went — is a reason and four scans.
      description: unit?.description ?? "",
      batteryHealth: unit?.batteryHealth,
      cycleCount: unit?.cycleCount,
      fcc: unit?.fcc,
    });
    message.success(
      unit
        ? `${serial} — ${skuOf(unit.skuId)?.name ?? "unit"} added.`
        : `${serial} added. It is not in stock: pick its product below.`,
    );
    // Hold the queue until the fill has rendered, or a burst inside one frame
    // picks the same empty row every time. See lib/rendered.ts.
    await rendered();
  };

  useScanTarget(scanIntoBatch);

  /**
   * Everything wrong with the batch. The rules live in lib/adjustmentBatch.ts;
   * this only supplies what the page knows — the store, and how a status is
   * spelled in the current language.
   */
  const countedInput = () =>
    countedRows.map((c) => ({
      ...(c.skuId ? { skuId: c.skuId } : {}),
      label: c.skuId
        ? `${skuOf(c.skuId)?.name ?? ""} ${skuOf(c.skuId)?.variantLabel ?? ""}`.trim()
        : "",
      qty: c.qty,
      onHand: c.skuId ? onHand(db.stockMoves, c.skuId) : 0,
    }));

  const problems = (): string[] =>
    batchProblems(
      {
        kind,
        reason,
        lines: rows.filter(touched).map(asWritten),
        counted: countedInput(),
        ...(kind === "IN" ? { locationId } : {}),
      },
      unitOf,
      statusLabel,
      (id) => warehouseLabelOf(db.warehouses, id) ?? id,
    );

  const submitBatch = () => {
    if (submitted.current) return;
    // Latched BEFORE validation, not after: a double click that fails
    // validation would otherwise stack two identical dialogs. Dismissing the
    // dialog re-arms the button.
    submitted.current = true;
    const errs = problems();
    if (errs.length) {
      // One dialog listing everything, the way Stock In's bulk accept reports
      // a batch: fixing problems one warning at a time is how an operator
      // loses track of which lines they have already been told about.
      return void modal.warning({
        title: `${errs.length} thing${errs.length === 1 ? "" : "s"} to fix`,
        afterClose: () => {
          submitted.current = false;
        },
        content: (
          <Flex vertical gap={4}>
            {errs.slice(0, 8).map((e, i) => (
              <span key={i}>{e}</span>
            ))}
            {errs.length > 8 && <span>…and {errs.length - 8} more.</span>}
          </Flex>
        ),
      });
    }

    const active = rows.filter(touched).map(asWritten);
    const typed = reason.trim();
    const isNewReason = !adjustmentReasons.some(
      (r) => r.label.toLowerCase() === typed.toLowerCase(),
    );
    let created = 0;
    let released = 0;

    mutate((d: MockDb) => {
      // Reason list first, adjustments second — the no-orphan-data rule.
      const reasonId = ensureReason(d, "ADJUSTMENT", typed);
      const label = d.reasons.find((r) => r.id === reasonId)?.label ?? typed;
      const batchId = nextId("adjb");
      const at = new Date().toISOString();

      /*
       * Counted products move on the stock ledger (2026-09-19): IN puts the
       * pieces in the chosen warehouse, OUT takes them from it first and
       * then wherever else holds them — both at the moving average, so an
       * adjustment never moves what a piece is worth.
       */
      for (const c of countedRows) {
        if (!c.skuId || !c.qty) continue;
        const cost = averageCost(d, c.skuId);
        const parts =
          kind === "IN"
            ? [{ locationId, qty: c.qty }]
            : (takeFrom(d.stockMoves, c.skuId, c.qty, locationId) ?? []);
        for (const part of parts) {
          d.stockMoves.push({
            id: nextId("sm"),
            skuId: c.skuId,
            locationId: part.locationId,
            qty: kind === "IN" ? part.qty : -part.qty,
            cost,
            type: "KOREKSI",
            at,
            reasonId,
            note: `${kind === "IN" ? "Adjusted in" : "Adjusted out"} — ${label}`,
            staff: currentStaffName(),
          });
        }
      }

      for (const r of active) {
        const serial = normalise(r.serial);
        const description = r.description.trim();
        const existing = d.units.find((u) => u.serial === serial);
        const isNew = existing === undefined;

        if (isNew) {
          const sku = d.skus.find((s) => s.id === r.skuId)!;
          d.units.push({
            serial,
            skuId: sku.id,
            status: "TERSEDIA",
            locationId,
            // No cost: nobody bought this through a PO, and writing the
            // asking price in as `buy` would invent a margin out of nothing.
            buy: 0,
            description,
            poId: null,
            ...batteryPatch(
              {
                health: r.batteryHealth,
                cycleCount: r.cycleCount,
                fcc: r.fcc,
              },
              defaultBatteryModeOfSku(d, sku.id),
            ),
          });
          // The adjustment IS this unit's intake. Its timeline starts with the
          // correction that created it, not with the DITERIMA of a purchase
          // order it never came off.
          d.events.push({
            id: nextId("ev"),
            serial,
            seq: 1,
            type: "KOREKSI",
            at,
            fromStatus: "-",
            toStatus: "TERSEDIA",
            locationId,
            note: [`Adjusted into stock — ${label}`, description]
              .filter(Boolean)
              .join(" — "),
            staff: currentStaffName(),
          });
          created += 1;
        } else {
          if (description) existing.description = description;
          // Only the fields somebody actually typed. An untouched box must
          // not clear a reading the machine already carries — a batch that
          // records where four machines went is a reason and four scans.
          const mode = defaultBatteryModeOfSku(d, existing.skuId);
          const typed = batteryPatch(
            {
              health: r.batteryHealth,
              cycleCount: r.cycleCount,
              fcc: r.fcc,
            },
            mode,
          );
          if (typed.batteryHealth != null)
            existing.batteryHealth = typed.batteryHealth;
          if (typed.cycleCount != null) existing.cycleCount = typed.cycleCount;
          if (typed.fcc != null) existing.fcc = typed.fcc;
          // What the note will say about the battery, if anything was typed.
          const reading = readBattery(typed, mode, batterySettings);
          if (kind === "IN" && existing.locationId !== locationId) {
            // Same reasoning as the single-unit move above: the rack it was
            // filed on belongs to the warehouse it is leaving.
            existing.rackId = undefined;
          }
          /*
           * ~~A unit adjusted out to SERVICE~~ — not since 2026-10-26: Stock
           * out is write-offs only, and a repair goes through *Send to
           * service* on the unit's row (`components/SendToServiceModal`).
           */
          // A unit already on a shelf is being TRANSFERRED, and keeps its
          // status: a reserved unit moved to another warehouse is still the
          // customer's.
          const transfer = kind === "IN" && IN_STOCK.includes(existing.status);
          appendEvent(d, serial, {
            type: "KOREKSI",
            toStatus:
              kind === "IN"
                ? transfer
                  ? existing.status
                  : "TERSEDIA"
                : outStatus,
            toLocationId: kind === "IN" ? locationId : undefined,
            note: [
              transfer
                ? `Moved ${warehouseLabelOf(d.warehouses, existing.locationId) ?? existing.locationId} → ${warehouseLabelOf(d.warehouses, locationId) ?? locationId} — ${label}`
                : `${kind === "IN" ? "Adjusted in" : "Adjusted out"} — ${label}`,
              kind === "OUT" ? statusLabel(outStatus) : undefined,
              description,
              reading.grade === null ? undefined : reading.text,
            ]
              .filter(Boolean)
              .join(" — "),
          });
          // A unit that has left stock cannot stay on hold for a customer. The
          // reservation is closed in the same transaction as the event, or the
          // Reservation page goes on offering a machine that is not there.
          if (kind === "OUT") {
            // Only the ITEM for this machine goes. A hold covering three
            // machines does not collapse because one of them was written off
            // — the customer is still owed the other two, and the header's
            // status is re-derived from what is left.
            for (const rsv of d.reservations) {
              const mine = rsv.items.filter((it) => it.serial === serial);
              if (mine.length === 0) continue;
              rsv.items = rsv.items.filter((it) => it.serial !== serial);
              // A hold with nothing left on it is cancelled here, by name:
              // an item-less reservation is otherwise a VISIT (2026-10-27),
              // whose status `reprojectHolds` leaves alone.
              if (rsv.items.length === 0) rsv.status = "CANCELLED";
              released += mine.length;
            }
            reprojectHolds(d);
          }
        }

        d.adjustments.unshift({
          id: nextId("adj"),
          serial,
          description,
          reasonId,
          at,
          staff: currentStaffName(),
          kind,
          batchId,
          batteryHealth: r.batteryHealth,
          cycleCount: r.cycleCount,
          fcc: r.fcc,
          newUnit: isNew,
        });
      }
    });

    const pieces = countedRows.reduce((n, c) => n + (c.qty ?? 0), 0);
    message.success(
      [
        active.length > 0 &&
          `${active.length} unit${active.length === 1 ? "" : "s"} adjusted ${kind === "IN" ? "in" : "out"}.`,
        pieces > 0 &&
          `${pieces} counted piece${pieces === 1 ? "" : "s"} adjusted ${kind === "IN" ? "in" : "out"}.`,
        created > 0 &&
          `${created} new serial${created === 1 ? " was" : "s were"} created in stock.`,
        released > 0 &&
          `${released} reservation${released === 1 ? " was" : "s were"} released.`,
        isNewReason && `"${typed}" was added to the reason list in Settings.`,
      ]
        .filter(Boolean)
        .join(" "),
    );
    setAdding(false);
  };

  const addAction = (
    <Flex gap={SPACE.sm}>
      <Button
        type="primary"
        icon={<LoginOutlined />}
        onClick={() => openAdd("IN")}
      >
        {t("stock.stockIn", "Stock in")}
      </Button>
      <Button
        type="primary"
        icon={<LogoutOutlined />}
        onClick={() => openAdd("OUT")}
      >
        {t("stock.stockOut", "Stock out")}
      </Button>
    </Flex>
  );

  /**
   * The stock tab's actions: the two movements, and the export beside them
   * (owner ask 2026-09-19) — on the stock tab only, because it exports the
   * stock, not the movement history.
   */
  const stockActions = (
    <Flex gap={SPACE.sm} wrap>
      <Button icon={<DownloadOutlined />} onClick={() => setExporting(true)}>
        {t("stockExport.button", "Export stock")}
      </Button>
      <Button
        icon={<UploadOutlined />}
        onClick={() => setImportingPrices(true)}
      >
        {t("priceImport.button", "Import sell prices")}
      </Button>
      {addAction}
    </Flex>
  );

  /**
   * The one table the merge produced: a flat line per variant, grade and
   * warehouse since 2026-09-19, its units nested under it.
   *
   * The nested units carry their own per-unit buttons since 2026-09-23 — price change
   * and edit unit — so nothing about one unit comes back up to this page.
   */
  const stockTab = (
    <Card>
      <InventoryTable
        // The buttons sit at the top right of the table itself on a desktop;
        // on a phone PageContainer turns them into the float button instead,
        // so this half is hidden there to avoid rendering them twice.
        extra={compact ? undefined : stockActions}
      />
    </Card>
  );

  /**
   * The history's rows: every unit adjusted, and every counted product
   * adjusted by quantity (2026-09-19) — an accessory's adjustment is a
   * `KOREKSI` stock move, and it belongs in the same history as a unit's.
   * `lib/stockHistory.ts` builds them, and applies the edit behind each row.
   */
  const logRows: StockHistoryRow[] = stockHistoryRows(db);
  const logProduct = (a: StockHistoryRow) => {
    const skuId = stockHistorySkuId(db, a);
    const k = skuId ? skuOf(skuId) : undefined;
    return k ? `${k.name} ${k.variantLabel}` : fmtNone();
  };
  /** What a row is about, for the edit button's name: the serial, or the product. */
  const logSubject = (a: StockHistoryRow) =>
    a.counted ? logProduct(a) : a.serial;

  const logTab = (
    <Card>
      <ProTable<StockHistoryRow>
        persistKey="inventory.adjustments"
        rowKey="id"
        dataSource={logRows}
        searchPlaceholder={t(
          "stock.searchSerialDescriptionOrReason",
          "Search serial, description or reason",
        )}
        extra={compact ? undefined : addAction}
        columns={[
          {
            title: t("stock.when", "When"),
            dataIndex: "at",
            defaultSortOrder: "descend",
            render: fmtDateTime,
          },
          {
            title: t("stock.type", "Type"),
            key: "kind",
            width: COLUMN.status,
            facet: true,
            facetLabel: t("stock.inAndOut", "In and out"),
            sortValue: (a) =>
              a.kind === "IN" ? t("stock.in", "In") : t("stock.out", "Out"),
            render: (_, a) => (
              <Tag color={a.kind === "IN" ? "green" : "volcano"}>
                {a.kind === "IN" ? t("stock.in", "In") : t("stock.out", "Out")}
              </Tag>
            ),
          },
          {
            title: t("stock.serial", "Serial"),
            dataIndex: "serial",
            searchable: true,
            render: (v, a) =>
              a.counted ? (
                // A counted product has no serial: the log says how many.
                <Typography.Text>×{a.counted.qty}</Typography.Text>
              ) : (
                <Flex align="center" gap={SPACE.xs} wrap>
                  <SerialLink serial={v} />
                  {a.newUnit && (
                    <Tooltip
                      title={t(
                        "stock.thisSerialWasNotIn",
                        "This serial was not in the system; the adjustment created it",
                      )}
                    >
                      <Tag color="blue">new</Tag>
                    </Tooltip>
                  )}
                </Flex>
              ),
          },
          {
            title: t("stock.product", "Product"),
            key: "product",
            facet: true,
            sortValue: (a) => logProduct(a),
            render: (_, a) => logProduct(a),
          },
          {
            title: t("stock.description", "Description"),
            dataIndex: "description",
            searchable: true,
            width: 200,
            render: (v) => <LongText>{v}</LongText>,
          },
          {
            /*
             * The reading recorded by this adjustment, in whichever units the
             * machine's era reports (2026-09-08).
             *
             * Read through the UNIT rather than off the adjustment alone,
             * because an adjustment carries the numbers and the unit carries
             * the model that says which of them mean anything.
             */
            title: t("stock.battery", "Battery"),
            key: "battery",
            width: 140,
            align: "right",
            sortValue: (a) => a.batteryHealth ?? a.cycleCount,
            facet: true,
            facetLabel: t("stock.anyBattery", "Any battery"),
            facetValue: (a) =>
              a.counted ? fmtNone() : batteryBandOf(adjustmentBattery(a)),
            render: (_, a) =>
              a.counted ? fmtNone() : adjustmentBattery(a).text,
          },
          {
            title: t("stock.reason", "Reason"),
            key: "reason",
            facet: true,
            searchable: true,
            sortValue: (a) =>
              db.reasons.find((r) => r.id === a.reasonId)?.label ?? a.reasonId,
            render: (_, a) => (
              <Tag>
                {db.reasons.find((r) => r.id === a.reasonId)?.label ??
                  a.reasonId}
              </Tag>
            ),
          },
          { title: t("stock.by", "By"), dataIndex: "staff", facet: true },
          {
            // Blank by convention: DataTable drops an untitled column to
            // the foot of the card on a phone, where buttons belong.
            title: "",
            key: "actions",
            width: COLUMN.actions,
            render: (_, a) => (
              <Tooltip title={t("stock.editMovement", "Edit")}>
                <Button
                  size="small"
                  aria-label={t(
                    "stock.editMovementAria",
                    "Edit the movement of {{what}}",
                    { what: logSubject(a) },
                  )}
                  icon={<EditOutlined />}
                  onClick={() => setEditing(a)}
                />
              </Tooltip>
            ),
          },
        ]}
      />
    </Card>
  );

  /**
   * `?adjust=IN` (or `OUT`) opens the batch editor on arrival.
   *
   * How a posted stock opname says "record this movement": the count itself is
   * read-only, so its Add adjustment button links here rather than unlocking
   * anything of its own. The param is cleared as soon as it is consumed, so a
   * refresh — or a back button — does not reopen the dialog over work the
   * operator has since done.
   */
  useEffect(() => {
    const want = params.get("adjust");
    if (want !== "IN" && want !== "OUT") return;
    // A batch already open is one somebody was typing — kept on this device
    // and brought back — and arriving here must not wipe it.
    if (!adding) openAdd(want);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("adjust");
        return next;
      },
      { replace: true },
    );
    // `openAdd` and `setParams` are stable enough for this to run once per
    // arrival: the effect is gated on a param it then removes.
  }, [params]);

  const activeRows = rows.filter(touched).length;

  return (
    <PageContainer
      title={t("stock.inventory", "Inventory")}
      // Compact only — the desktop button lives at the top right of the table
      // itself. See PageContainer's docblock on the ListToolbar arrangement.
      actions={
        compact
          ? [
              {
                key: "export",
                label: t("stockExport.button", "Export stock"),
                icon: <DownloadOutlined />,
                onClick: () => setExporting(true),
              },
              {
                key: "import-prices",
                label: t("priceImport.button", "Import sell prices"),
                icon: <UploadOutlined />,
                onClick: () => setImportingPrices(true),
              },
              {
                key: "in",
                label: t("stock.stockIn", "Stock in"),
                icon: <LoginOutlined />,
                // A peer of Stock out, so it is green too (owner ask
                // 2026-09-25) — one green and one white beside it said one of
                // the two doors was the lesser one, which it is not.
                type: "primary",
                onClick: () => openAdd("IN"),
              },
              {
                key: "out",
                label: t("stock.stockOut", "Stock out"),
                icon: <LogoutOutlined />,
                type: "primary",
                onClick: () => openAdd("OUT"),
              },
            ]
          : undefined
      }
    >
      <Tabs
        items={[
          {
            key: "stock",
            label: t("stock.tabStock", "Stock"),
            children: stockTab,
          },
          {
            key: "log",
            label: t("stock.tabHistory", "Stock Movement History"),
            children: logTab,
          },
        ]}
      />

      <Modal
        title={
          kind === "IN"
            ? t(
                "stock.stockInTitle",
                "Stock in — transfer or bring units into a warehouse",
              )
            : t("stock.stockOutWriteOffTitle", "Stock out — write units off")
        }
        open={adding}
        onCancel={() => setAdding(false)}
        onOk={submitBatch}
        okText={
          activeRows === 0
            ? t("stock.logAdjustments", "Log adjustments")
            : activeRows === 1
              ? t("stock.logOneAdjustment", "Log 1 adjustment")
              : t("stock.logNAdjustments", "Log {{count}} adjustments", {
                  count: activeRows,
                })
        }
        // Wide enough for a serial, a product, a count and a sentence on one
        // line. A batch editor in a 520px dialog is four columns of ellipsis.
        width={compact ? "100%" : 1080}
        destroyOnHidden
      >
        <Form layout="vertical" className="responsive-controls">
          {/*
           * No direction control (owner ask 2026-09-23). Inventory opens this
           * from *Stock in* or *Stock out*, so it is already answered — and a
           * toggle that repeats the button somebody just pressed is a second
           * chance to get it wrong. The title says which one this is.
           */}
          <Flex wrap gap={SPACE.md} align="flex-start">
            <Form.Item
              label={t("stock.reason", "Reason")}
              required
              tooltip={t(
                "stock.pickOneOrTypeA",
                "Pick one, or type a new reason — a new one is added to Settings automatically",
              )}
              style={{ marginBottom: SPACE.md, minWidth: 280, flex: 1 }}
            >
              <AutoComplete
                value={reason}
                onChange={(v: string) => setReason(v)}
                options={adjustmentReasons.map((r) => ({ value: r.label }))}
                filterOption={(input, opt) =>
                  String(opt?.value ?? "")
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
                placeholder={t(
                  "stock.searchAReasonOrType",
                  "Search a reason, or type a new one",
                )}
                style={{ width: "100%" }}
              />
            </Form.Item>

            {kind === "IN" ? (
              <Form.Item
                label={t("stock.intoWarehouse", "Into warehouse")}
                required
                style={{ marginBottom: SPACE.md, minWidth: 220 }}
              >
                <Select
                  value={locationId}
                  onChange={setLocationId}
                  options={db.warehouses
                    .filter((w) => w.active)
                    .map((w) => ({ value: w.id, label: warehouseLabel(w) }))}
                  style={{ width: "100%" }}
                />
              </Form.Item>
            ) : (
              <Form.Item
                label={t("stock.unitsBecome", "Units become")}
                required
                tooltip={t(
                  "stock.whatTheUnitSStatus",
                  "What the unit's status becomes. The log and the status have to agree.",
                )}
                style={{ marginBottom: SPACE.md, minWidth: 220 }}
              >
                <Select<OutStatus>
                  value={outStatus}
                  onChange={setOutStatus}
                  // Translated here rather than in the constant — see
                  // SettingsPage's REASON_ACTIVITIES for why.
                  options={OUT_STATUSES.map((o) => ({
                    value: o.value,
                    label: t(o.label),
                  }))}
                  style={{ width: "100%" }}
                />
              </Form.Item>
            )}
          </Flex>

          {/* A heading, not a paragraph (owner ask 2026-09-23). The sentence
              that was here explained what "stock in" means to somebody who had
              just pressed Stock in. */}
          <Typography.Text strong style={{ display: "block" }}>
            {t("stock.serialisedProducts", "Serialised products")}
          </Typography.Text>

          <EditableTable<BatchRow>
            rowKey="key"
            dataSource={rows}
            size="small"
            /*
             * A line-item editor: these columns ARE the form. It kept a grid
             * on a phone behind a sideways scroll until 2026-09-01, when the
             * owner asked for rows instead — `EditableTable` stacks each line
             * into a card of labelled full-width fields below `md`, adds a
             * line on ⌘⏎ from inside any cell, and lands the caret in the new
             * line's serial box.
             */
            onAdd={() => setRows((rs) => [...rs, blankRow()])}
            addLabel={t("stock.addLine", "Add line")}
            rowTitle={(r, i) =>
              normalise(r.serial) ||
              t("editableTable.line", "Line {{n}}", { n: i + 1 })
            }
            columns={[
              {
                // A real element, not a fragment: this table sets `scroll.x`,
                // and rc-table hangs a resize observer off the header cell's
                // child — which React 19 refuses to attach to a Fragment,
                // warning on every render.
                title: (
                  <span>
                    Product <Typography.Text type="danger">*</Typography.Text>
                  </span>
                ),
                key: "product",
                width: 420,
                render: (_, r) => {
                  const serial = normalise(r.serial);
                  const unit = serial ? unitOf(serial) : undefined;
                  const sku = unit && skuOf(unit.skuId);
                  return (
                    <Flex vertical gap={SPACE.xs}>
                      <AutoComplete
                        value={r.serial}
                        onChange={(v: string) => setRow(r.key, { serial: v })}
                        // Selecting from the list also prefills what the unit
                        // already says about itself, exactly as a scan does.
                        onSelect={(v: string) => {
                          const picked = unitOf(v);
                          setRow(r.key, {
                            serial: v,
                            description: picked?.description ?? "",
                            batteryHealth: picked?.batteryHealth,
                            cycleCount: picked?.cycleCount,
                            fcc: picked?.fcc,
                          });
                        }}
                        // `label` is the serial and only the serial, because
                        // AutoComplete paints the label into the box once a
                        // row is picked and antd 6 drops `optionLabelProp`,
                        // which is the usual way out. The product staff are
                        // actually scanning for goes in `optionRender`, which
                        // decorates the LIST and not the field — and in the
                        // filter, so typing "Pro 14" still finds the serial.
                        options={db.units
                          .filter(
                            (u) =>
                              // Never a unit in QC. The reason used to be the
                              // schema's price CHECK, which went with the
                              // per-unit price on 2026-08-27; the reason now
                              // is simply that a unit still being graded
                              // belongs to Stock In, which owns that stage.
                              u.status !== "QC" &&
                              u.status !== "SERVIS" &&
                              (kind === "IN"
                                ? u.status !== "TERJUAL"
                                : HELD_STATUSES.includes(u.status)),
                          )
                          .map((u) => ({
                            value: u.serial,
                            label: u.serial,
                            product: `${skuOf(u.skuId)?.name} · ${skuOf(u.skuId)?.variantLabel}`,
                          }))}
                        optionRender={(opt) => (
                          <Flex vertical>
                            <span>{String(opt.value)}</span>
                            <Typography.Text
                              type="secondary"
                              style={{ fontSize: TYPE.sm }}
                            >
                              {String(opt.data.product ?? "")}
                            </Typography.Text>
                          </Flex>
                        )}
                        filterOption={(input, opt) =>
                          `${opt?.value ?? ""} ${opt?.product ?? ""}`
                            .toLowerCase()
                            .includes(input.toLowerCase())
                        }
                        placeholder={t(
                          "stock.scanOrTypeASerial",
                          "Scan or type a serial number",
                        )}
                        style={{ width: "100%" }}
                      />
                      {serial === "" ? null : unit ? (
                        <Flex align="center" gap={SPACE.xs} wrap>
                          <Typography.Text
                            type="secondary"
                            style={{ fontSize: TYPE.sm }}
                          >
                            {sku?.name} · {sku?.variantLabel}
                          </Typography.Text>
                          <EnumTag map={UNIT_STATUS} value={unit.status} />
                        </Flex>
                      ) : (
                        <Flex vertical gap={SPACE.xs}>
                          <Flex align="center" gap={SPACE.xs}>
                            <Tag color="orange">Unknown</Tag>
                            <Typography.Text
                              type="secondary"
                              style={{ fontSize: TYPE.sm }}
                            >
                              {kind === "IN"
                                ? "not in stock — say what it is"
                                : "not in the system"}
                            </Typography.Text>
                          </Flex>
                          {kind === "IN" && (
                            <Flex gap={SPACE.xs} wrap>
                              <Select
                                showSearch
                                value={r.modelId}
                                optionFilterProp="label"
                                placeholder={t("stock.product", "Product")}
                                // Choosing another product invalidates the
                                // variant under it, so the specs go with it.
                                onChange={(v: string) =>
                                  setRow(r.key, {
                                    modelId: v,
                                    skuId: undefined,
                                  })
                                }
                                // Only what is identified by serial: a
                                // counted product is added below, by
                                // quantity (2026-09-19).
                                options={db.models
                                  .filter(
                                    (m) =>
                                      !countedSkus.some(
                                        (s) => s.modelId === m.id,
                                      ),
                                  )
                                  .map((m) => ({
                                    value: m.id,
                                    label: m.name,
                                  }))}
                                style={{ minWidth: 180, flex: 1 }}
                              />
                              <Select
                                showSearch
                                value={r.skuId}
                                optionFilterProp="label"
                                disabled={!r.modelId}
                                placeholder={t("stock.specs", "Specs")}
                                onChange={(v: string) =>
                                  setRow(r.key, { skuId: v })
                                }
                                options={db.skus
                                  .filter((s) => s.modelId === r.modelId)
                                  .map((s) => ({
                                    value: s.id,
                                    label: s.variantLabel,
                                  }))}
                                style={{ minWidth: 150, flex: 1 }}
                              />
                            </Flex>
                          )}
                        </Flex>
                      )}
                    </Flex>
                  );
                },
              },
              {
                /*
                 * The battery, in whichever units the row's machine reports
                 * (2026-09-08).
                 *
                 * A row for a serial the shop already carries takes its era
                 * from that unit; a row for an unknown serial takes it from
                 * the product being chosen two columns to the left, and starts
                 * on the health box until one is picked. Nothing is lost by
                 * that default — a reading typed against the wrong era is
                 * dropped by `batchProblems`, not filed.
                 */
                // Neutral, unlike the QC grid's: that page groups by product
                // so a block starts on one reading, while this grid is
                // whatever four machines somebody happens to be adjusting at
                // once — and each row's model decides its own reading.
                title: t("stock.battery", "Battery"),
                key: "battery",
                // The cycle reading is two boxes on ONE row since 2026-09-20
                // (owner ask); this is the width they need side by side.
                width: 230,
                render: (_, r) =>
                  // An accessory's row has nothing to read (2026-09-19): the
                  // box is replaced by a "None" that says so, and whatever the
                  // row's hidden boxes last held is dropped by `asWritten`.
                  !hasBattery(batchSkuOf(r)) ? (
                    <Tooltip
                      title={t(
                        "stock.noBatteryCounted",
                        "Counted, not identified — no battery to record",
                      )}
                    >
                      <Typography.Text type="secondary">
                        {fmtNone()}
                      </Typography.Text>
                    </Tooltip>
                  ) : (
                    <BatteryFields
                      fallback={batchModeOf(r)}
                      idPrefix={`batch-battery-${r.key}`}
                      value={{
                        health: r.batteryHealth ?? null,
                        cycleCount: r.cycleCount ?? null,
                        fcc: r.fcc ?? null,
                      }}
                      // No `onCommit`: the grid validates every row at OK
                      // (`batchProblems`), so there is nothing to do per box.
                      onChange={(next) =>
                        setRow(r.key, {
                          batteryHealth: next.health ?? undefined,
                          cycleCount: next.cycleCount ?? undefined,
                          fcc: next.fcc ?? undefined,
                        })
                      }
                    />
                  ),
              },
              {
                title: t(
                  "stock.descriptionCondition",
                  "Description / condition",
                ),
                key: "description",
                // Declared, like every column here, so `EditableTable` can sum
                // them into the grid's own width — one column leaving it open
                // sends the whole grid back to `max-content`, where a long
                // product name would bid for room the counted columns need.
                width: 260,
                render: (_, r) => (
                  <Input
                    aria-label={t(
                      "stock.descriptionCondition",
                      "Description / condition",
                    )}
                    value={r.description}
                    placeholder={t(
                      "stock.conditionBatteryHealthCompleteness",
                      "Condition, battery health, completeness…",
                    )}
                    onChange={(e) =>
                      setRow(r.key, { description: e.target.value })
                    }
                  />
                ),
              },
              {
                title: "",
                key: "remove",
                width: COLUMN.action,
                render: (_, r) => (
                  <Tooltip
                    title={t("stock.removeThisLine", "Remove this line")}
                  >
                    <Button
                      type="text"
                      aria-label={t("stock.removeThisLine", "Remove this line")}
                      icon={<DeleteOutlined />}
                      disabled={rows.length === 1}
                      onClick={() =>
                        setRows((rs) => rs.filter((x) => x.key !== r.key))
                      }
                    />
                  </Tooltip>
                ),
              },
            ]}
          />

          {/*
           * Counted products — accessories — by quantity (2026-09-19), drawn
           * as the same kind of grid as the serials above (owner ask
           * 2026-09-23). It was a bare row of controls with no headers, so two
           * lists doing the same job on one dialog read as two different
           * things.
           */}
          <Typography.Text
            strong
            style={{ display: "block", marginTop: SPACE.md }}
          >
            {t("stock.countedProducts", "Counted products")}
          </Typography.Text>
          <EditableTable<CountedRow>
            rowKey="key"
            dataSource={countedRows}
            onAdd={() =>
              setCountedRows((rs) => [
                ...rs,
                { key: `cnt-${++rowSeq}`, qty: 1 },
              ])
            }
            addLabel={t("stock.addLine", "Add line")}
            emptyText={t(
              "stock.noCounted",
              "No counted products on this batch.",
            )}
            columns={[
              {
                title: t("stock.product", "Product"),
                key: "sku",
                render: (_, c) => (
                  <Select
                    showSearch
                    optionFilterProp="label"
                    style={{ width: "100%" }}
                    value={c.skuId}
                    placeholder={t("stock.pickCountedProduct", "Product")}
                    aria-label={t(
                      "stock.countedProductAria",
                      "Counted product",
                    )}
                    options={pickableCounted.map((s) => ({
                      value: s.id,
                      label: `${s.name} ${s.variantLabel} · ${onHand(db.stockMoves, s.id)}`,
                    }))}
                    onChange={(v: string) =>
                      setCountedRows((rs) =>
                        rs.map((x) =>
                          x.key === c.key ? { ...x, skuId: v } : x,
                        ),
                      )
                    }
                  />
                ),
              },
              {
                title: t("stock.qty", "Qty"),
                key: "qty",
                width: COLUMN.qty,
                render: (_, c) => (
                  <InputNumber
                    min={1}
                    precision={0}
                    style={{ width: "100%" }}
                    value={c.qty}
                    aria-label={t("stock.countedQtyAria", "How many")}
                    onChange={(v) =>
                      setCountedRows((rs) =>
                        rs.map((x) =>
                          x.key === c.key ? { ...x, qty: v ?? null } : x,
                        ),
                      )
                    }
                  />
                ),
              },
              {
                title: "",
                key: "remove",
                width: COLUMN.action,
                render: (_, c) => (
                  <Tooltip
                    title={t("stock.removeThisLine", "Remove this line")}
                  >
                    <Button
                      type="text"
                      aria-label={t("stock.removeThisLine", "Remove this line")}
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        setCountedRows((rs) =>
                          rs.filter((x) => x.key !== c.key),
                        )
                      }
                    />
                  </Tooltip>
                ),
              },
            ]}
          />
        </Form>
      </Modal>

      <StockExportModal open={exporting} onClose={() => setExporting(false)} />
      <PriceImportModal
        open={importingPrices}
        onClose={() => setImportingPrices(false)}
      />
      <StockMovementEditModal
        open={editing !== null}
        row={editing}
        onClose={() => setEditing(null)}
      />
    </PageContainer>
  );
}
