/**
 * Inventory & Stock Movement — what the shop holds, and every hand that moved
 * it.
 *
 * Two nav items until 2026-08-26. "Inventory" counted stock by product;
 * "Stock Movement" listed it by serial and owned the adjustment machinery. The
 * owner asked for one screen with one table, and `InventoryTable` is that
 * table: a row per product, expanding to the serials behind it. This file is
 * what remains — the page frame, the movement log, and the two modals that
 * actually write.
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
 *   away at service, or written off. `UnitStatus` has no "adjusted out" member
 *   and this file does not invent one; the header names the destination so what
 *   the log says and what the unit's status says cannot disagree.
 *
 * The reason is created here, and the managed list in Settings learns it FIRST:
 * `ensureReason` runs inside the same `mutate` as the adjustment rows, so there
 * is no instant at which an adjustment points at a reason the settings page has
 * never heard of. That is why an adjustment stores a `reasonId` and not text.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import {
  App,
  AutoComplete,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  LoginOutlined,
  LogoutOutlined,
} from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { ProTable } from "../../components/ProTable";
import { EditableTable } from "../../components/EditableTable";
import { InventoryTable } from "./InventoryTable";
import { EnumTag } from "../../components/EnumTag";
import { LongText } from "../../components/LongText";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import { fmtDateTime } from "../../lib/format.js";
import {
  batteryBandOf,
  batteryDraftOf,
  defaultBatteryModeOfSku,
  batteryPatch,
  batterySettingsFrom,
  isBatteryDraftInRange,
  readBattery,
  releaseYearOfSku,
  type BatteryDraft,
  type BatteryMode,
} from "../../lib/battery.js";
import {
  BatteryFields,
  batteryFieldsLabel,
} from "../../components/BatteryFields.js";
import { HELD_STATUSES } from "../../lib/inventory.js";
import { reprojectHolds } from "../../lib/reservations.js";
import {
  batchProblems,
  normaliseSerial as normalise,
} from "../../lib/adjustmentBatch.js";
import { rendered } from "../../lib/rendered.js";
import { useScanTarget } from "../../hooks/useScanTarget.js";
import {
  useDb,
  mutate,
  appendEvent,
  ensureReason,
  nextId,
  currentStaffName,
} from "../../mock/store.js";
import { tagOf, UNIT_STATUS } from "../../i18n/enumLabels.js";
import { SPACE, TYPE } from "../../theme/tokens";
import type {
  Adjustment,
  AdjustmentKind,
  MockDb,
  Unit,
  UnitStatus,
} from "../../mock/seed.js";

/** Rows the modal opens with — the owner's "typically three or four". */
const BLANK_ROWS = 3;

/** Where an OUT adjustment leaves the unit. */
type OutStatus = Extract<UnitStatus, "HILANG" | "SERVIS">;

const OUT_STATUSES: { value: OutStatus; label: string; hint: string }[] = [
  {
    value: "HILANG",
    label: "Lost / written off",
    hint: "the unit is gone: shrinkage, damaged beyond sale, taken for internal use",
  },
  {
    value: "SERVIS",
    label: "On service",
    hint: "the unit is away at a repairer and is expected back",
  },
];

interface BatchRow {
  key: string;
  serial: string;
  /** Only for a serial no unit carries: what staff say the machine is. */
  modelId?: string;
  skuId?: string;
  /**
   * Which reading this row is being taken in, once somebody has flicked the
   * switch on it (owner ask 2026-09-15). Absent means the product's own
   * default decides — see `batchModeOf`.
   *
   * On the ROW rather than derived, because this grid is whatever four
   * machines somebody happens to be adjusting at once: a row switched to
   * cycles must stay on cycles while the row beside it stays on health.
   */
  batteryMode?: BatteryMode;
  /** An Apple silicon or 2021-or-later machine's reading, as a percentage. */
  batteryHealth?: number;
  /** An older Intel machine's, in cycles… */
  cycleCount?: number;
  /** …and its capacity in mAh. */
  fcc?: number;
  description: string;
}

/**
 * `BatteryFields` as an antd form field.
 *
 * antd injects `value` and `onChange` into a `Form.Item`'s single child, and
 * `BatteryFields` already takes exactly those — but it requires them, and a
 * form's first render passes neither. This fills in the blanks rather than
 * making them optional on the component, which every other caller does supply.
 */
function BatteryFieldsField({
  fallback,
  value,
  onChange,
}: {
  fallback: BatteryMode;
  value?: BatteryDraft;
  onChange?: (next: BatteryDraft) => void;
}) {
  return (
    <BatteryFields
      fallback={fallback}
      size="middle"
      idPrefix="unit-edit-battery"
      value={value ?? {}}
      onChange={(next) => onChange?.(next)}
    />
  );
}

let rowSeq = 0;
const blankRow = (): BatchRow => ({
  key: `batch-${++rowSeq}`,
  serial: "",
  description: "",
});
const blankRows = () => Array.from({ length: BLANK_ROWS }, blankRow);

/** A row is in play once anything has been typed into it. */
const touched = (r: BatchRow) =>
  r.serial.trim() !== "" ||
  r.description.trim() !== "" ||
  r.batteryHealth != null ||
  r.cycleCount != null ||
  r.fcc != null ||
  r.batteryMode !== undefined ||
  r.skuId !== undefined;

export function InventoryPage() {
  const db = useDb();
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { message, modal } = App.useApp();
  const { compact } = useLayoutMode();
  const [editing, setEditing] = useState<Unit | null>(null);
  const [form] = Form.useForm<{
    locationId: string;
    description: string;
    battery: BatteryDraft;
    reason: string;
  }>();

  // ── The batch, held as plain state rather than in a Form ──────────────────
  // The grid below is a line-item editor, and antd's Form.List buys validation
  // this page does its own way (one dialog listing every problem at once,
  // as Stock In's bulk accept does) at the cost of addressing every cell
  // through a name path.
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<AdjustmentKind>("OUT");
  const [reason, setReason] = useState("");
  const [outStatus, setOutStatus] = useState<OutStatus>("HILANG");
  /** Once the destination is chosen by hand, the reason stops guessing at it. */
  const [outTouched, setOutTouched] = useState(false);
  const [locationId, setLocationId] = useState(db.myWarehouseId);
  const [rows, setRows] = useState<BatchRow[]>(blankRows);
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
   *
   * The row's own switch (`batteryMode`) is not read here: this is the
   * FALLBACK handed to `BatteryFields`, which resolves the two itself. Folding
   * the switch in here would make the fallback depend on the override and give
   * `batteryDraftMode` nothing left to decide.
   */
  const batchModeOf = (r: BatchRow): BatteryMode => {
    const known = db.units.find(
      (u) => u.serial === r.serial.trim().toUpperCase(),
    );
    const skuId = known?.skuId ?? r.skuId;
    return skuId ? defaultBatteryModeOfSku(db, skuId) : "HEALTH";
  };
  const unitOf = (serial: string) =>
    db.units.find((u) => u.serial === normalise(serial));
  const warehouseOf = (id: string) =>
    db.warehouses.find((w) => w.id === id)?.name ?? id;
  const adjustmentReasons = db.reasons.filter(
    (r) => r.activity === "ADJUSTMENT" && r.active,
  );
  const statusLabel = (s: string) => tagOf(UNIT_STATUS, s, t).label;

  const setRow = (key: string, patch: Partial<BatchRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const openEdit = (u: Unit) => {
    setEditing(u);
    form.setFieldsValue({
      locationId: u.locationId,
      description: u.description,
      battery: batteryDraftOf(u),
      reason: "",
    });
  };

  const saveEdit = () =>
    form.validateFields().then((v) => {
      mutate((d) => {
        const u = d.units.find((x) => x.serial === editing!.serial)!;
        if (v.locationId !== u.locationId) {
          appendEvent(d, u.serial, {
            type: "DIPINDAH",
            toLocationId: v.locationId,
            note: v.reason || "Moved",
          });
          // The rack belongs to the old warehouse, so a move clears it rather
          // than leaving the unit filed onto a shelf in another building.
          u.rackId = undefined;
        }
        if (v.description !== u.description) {
          appendEvent(d, u.serial, {
            type: "DICATAT",
            note: `Description updated: ${v.description}`,
          });
          u.description = v.description;
        }
        // An emptied number input gives back `null`, and clearing a reading
        // is a real edit — it was wrong and is now nobody's guess. Zero is a
        // genuine reading in both eras (a dead battery, a replaced one) and is
        // never cleared, which is why every comparison here is against
        // `undefined` rather than falsiness.
        const year = releaseYearOfSku(db, u.skuId);
        const next = batteryPatch(
          v.battery ?? {},
          defaultBatteryModeOfSku(db, u.skuId),
        );
        const before = readBattery(u, year, batterySettings).text;
        if (
          next.batteryHealth !== u.batteryHealth ||
          next.cycleCount !== u.cycleCount ||
          next.fcc !== u.fcc
        ) {
          u.batteryHealth = next.batteryHealth;
          u.cycleCount = next.cycleCount;
          u.fcc = next.fcc;
          appendEvent(d, u.serial, {
            type: "KOREKSI",
            note: `Battery ${before} → ${readBattery(u, year, batterySettings).text} — ${v.reason || "adjustment"}`,
          });
        }
      });
      message.success("Adjustment logged on the unit's timeline.");
      setEditing(null);
    });

  /** Open the batch editor, empty. */
  /**
   * Opens the batch editor in a chosen direction.
   *
   * Two buttons rather than one, since the Stock page absorbed stock-in and
   * stock-out on 2026-08-24. The editor was always capable of both — it had an
   * In/Out toggle — but "Add adjustment" named the mechanism rather than the
   * job, so nobody looking to move stock between warehouses would think to
   * open it. Naming the two jobs on the buttons is the whole change; the form
   * behind them is the same one.
   *
   * Note what this deliberately is NOT: a till. Selling to a customer left for
   * the Point of Sale screen (owner decision). What lands here is warehouse
   * work — a transfer in, a write-off, a unit going to the bench.
   */
  const openAdd = (direction: AdjustmentKind = "OUT") => {
    submitted.current = false;
    setKind(direction);
    setReason("");
    setOutStatus(direction === "OUT" ? "HILANG" : "HILANG");
    setOutTouched(false);
    setLocationId(db.myWarehouseId);
    setRows(blankRows());
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
  const problems = (): string[] =>
    batchProblems(
      { kind, reason, lines: rows.filter(touched) },
      unitOf,
      statusLabel,
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

    const active = rows.filter(touched);
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
                ...(r.batteryMode === undefined ? {} : { mode: r.batteryMode }),
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
              ...(r.batteryMode === undefined ? {} : { mode: r.batteryMode }),
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
           * A machine adjusted out to SERVICE opens a visit at the bench,
           * exactly as one rejected at QC does (owner ask 2026-09-08).
           *
           * Without this the two doors into service disagreed: QC opened a
           * visit while an adjustment changed a status and nothing else — so
           * the machine never appeared on the bench and its repair cost
           * nothing.
           *
           * It does NOT move the machine (owner revision 2026-09-09). The
           * bench signs a machine in when it has it in its hands, and that
           * confirmation is what writes the location; until then the machine
           * is honestly still where it was, on the Expected table. The rack
           * goes now, because the machine comes off the shelf when it is
           * picked up.
           */
          const goingToService = kind === "OUT" && outStatus === "SERVIS";
          // Read BEFORE the event, which writes the projection — the visit has
          // to record where the machine set out from.
          const cameFrom = existing.locationId;
          if (goingToService) existing.rackId = undefined;
          appendEvent(d, serial, {
            type: "KOREKSI",
            toStatus: kind === "IN" ? "TERSEDIA" : outStatus,
            toLocationId: kind === "IN" ? locationId : undefined,
            note: [
              `${kind === "IN" ? "Adjusted in" : "Adjusted out"} — ${label}`,
              kind === "OUT" ? statusLabel(outStatus) : undefined,
              description,
              reading.grade === null ? undefined : reading.text,
            ]
              .filter(Boolean)
              .join(" — "),
          });
          if (kind === "OUT" && outStatus === "SERVIS") {
            d.services.push({
              id: nextId("svc"),
              serial,
              fromLocationId: cameFrom,
              openedAt: at,
              fees: [],
              ...(description ? { note: description } : {}),
              raisedBy: "ADJUSTMENT",
              staff: currentStaffName(),
            });
          }
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

    message.success(
      [
        `${active.length} unit${active.length === 1 ? "" : "s"} adjusted ${kind === "IN" ? "in" : "out"}.`,
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
      <Button icon={<LoginOutlined />} onClick={() => openAdd("IN")}>
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
   * The one table the merge produced: products, expanding to their serials.
   *
   * The per-unit Adjust button inside the expansion calls back into `openEdit`
   * here, because the modal it opens is this page's — the table stays a table
   * and never owns a dialog.
   */
  const stockTab = (
    <Card>
      <InventoryTable
        onAdjust={openEdit}
        // The button sits at the top right of the table itself on a desktop;
        // on a phone PageContainer turns it into the float button instead, so
        // this half is hidden there to avoid rendering it twice.
        extra={compact ? undefined : addAction}
      />
    </Card>
  );

  const logTab = (
    <Card>
      <ProTable
        rowKey="id"
        dataSource={db.adjustments}
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
            width: 100,
            facet: true,
            facetLabel: t("stock.inAndOut", "In and out"),
            sortValue: (a) => (a.kind === "IN" ? "In" : "Out"),
            render: (_, a) => (
              <Tag color={a.kind === "IN" ? "green" : "volcano"}>
                {a.kind === "IN" ? "In" : "Out"}
              </Tag>
            ),
          },
          {
            title: t("stock.serial", "Serial"),
            dataIndex: "serial",
            searchable: true,
            render: (v, a) => (
              <Flex align="center" gap={SPACE.xs} wrap>
                <Link to={`/stock/history?serial=${v}`}>{v}</Link>
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
            sortValue: (a) => {
              const u = db.units.find((x) => x.serial === a.serial);
              const k = u && skuOf(u.skuId);
              return k ? `${k.name} ${k.variantLabel}` : "—";
            },
            render: (_, a) => {
              const u = db.units.find((x) => x.serial === a.serial);
              const k = u && skuOf(u.skuId);
              return k ? `${k.name} ${k.variantLabel}` : "—";
            },
          },
          {
            title: t("stock.description", "Description"),
            dataIndex: "description",
            searchable: true,
            width: 320,
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
            facetValue: (a) => batteryBandOf(adjustmentBattery(a)),
            render: (_, a) => adjustmentBattery(a).text,
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
    openAdd(want);
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
  const outHint = t(
    OUT_STATUSES.find((o) => o.value === outStatus)?.hint ?? "",
  );

  return (
    <PageContainer
      title={t("stock.inventoryStockMovement", "Inventory & Stock Movement")}
      // Compact only — the desktop button lives at the top right of the table
      // itself. See PageContainer's docblock on the ListToolbar arrangement.
      actions={
        compact
          ? [
              {
                key: "in",
                label: t("stock.stockIn", "Stock in"),
                icon: <LoginOutlined />,
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
            label: t("stock.tabLog", "Movement log"),
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
            : t(
                "stock.stockOutTitle",
                "Stock out — write off, or send units to service",
              )
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
          {/* Chosen once for the whole batch — that is the point of it. */}
          <Flex wrap gap={SPACE.md} align="flex-start">
            <Form.Item
              label={t("stock.adjustmentType", "Adjustment type")}
              required
              style={{ marginBottom: SPACE.md }}
            >
              <Segmented<AdjustmentKind>
                value={kind}
                onChange={setKind}
                options={[
                  { value: "IN", label: t("stock.in", "In") },
                  { value: "OUT", label: t("stock.out", "Out") },
                ]}
              />
            </Form.Item>

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
                onChange={(v: string) => {
                  setReason(v);
                  // A reason that names service points the destination at
                  // service, until someone says otherwise by hand. It tracks
                  // BOTH ways: a one-way guess would leave "On service"
                  // standing under a reason since retyped to "Internal Use",
                  // which is a wrong status nobody was asked about.
                  if (!outTouched) {
                    setOutStatus(/servi[cs]/i.test(v) ? "SERVIS" : "HILANG");
                  }
                }}
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
                    .map((w) => ({ value: w.id, label: w.name }))}
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
                  onChange={(v) => {
                    setOutStatus(v);
                    setOutTouched(true);
                  }}
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

          {/* Says what the OK button is about to do, in the words of the two
              controls above it. */}
          <Typography.Paragraph type="secondary" style={{ fontSize: TYPE.sm }}>
            {kind === "IN"
              ? `Each unit becomes sellable in ${warehouseOf(locationId)}. A serial nothing carries yet is created as a new unit from the product you pick.`
              : `Each unit leaves stock — ${outHint}. Any hold a customer has on it is released.`}
          </Typography.Paragraph>

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
                              (kind === "IN" ||
                                HELD_STATUSES.includes(u.status)),
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
                                options={db.models.map((m) => ({
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
                // once — and each row carries its own switch.
                title: t("stock.battery", "Battery"),
                key: "battery",
                width: 150,
                render: (_, r) => (
                  <BatteryFields
                    fallback={batchModeOf(r)}
                    idPrefix={`batch-battery-${r.key}`}
                    value={{
                      ...(r.batteryMode === undefined
                        ? {}
                        : { mode: r.batteryMode }),
                      health: r.batteryHealth ?? null,
                      cycleCount: r.cycleCount ?? null,
                      fcc: r.fcc ?? null,
                    }}
                    // No `onCommit`: the grid validates every row at OK
                    // (`batchProblems`), so there is nothing to do per box.
                    onChange={(next) =>
                      setRow(r.key, {
                        batteryMode: next.mode,
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
                width: 56,
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
        </Form>
      </Modal>

      <Modal
        title={`Adjust ${editing?.serial ?? ""}`}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={saveEdit}
        okText={t("stock.logAdjustment", "Log adjustment")}
      >
        <Form form={form} layout="vertical">
          {/* No price field since 2026-08-27. The asking price is the
              variant's, so repricing is an edit on the Product and not on one
              serial — changing it here would have looked like it moved this
              machine's price alone. Where the unit IS, what condition it is in
              and what its battery reads are still per-serial facts, and stay. */}
          <Form.Item
            name="locationId"
            label={t("stock.warehouse", "Warehouse")}
            rules={[{ required: true }]}
          >
            <Select
              options={db.warehouses.map((w) => ({
                value: w.id,
                label: w.name,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="description"
            label={t("stock.description", "Description")}
          >
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            name="battery"
            label={
              editing
                ? batteryFieldsLabel(
                    defaultBatteryModeOfSku(db, editing.skuId),
                    t,
                  )
                : t("stock.battery", "Battery")
            }
            tooltip={t(
              "stock.leaveEmptyWhenNobodyHas",
              "Leave empty when nobody has read it off the machine — that is not the same as zero",
            )}
            // A rule rather than each input's own `max`, for the reason the
            // batch grid gives: a bound snaps the number and says nothing,
            // while a rule refuses it and shows why under the field. Empty
            // still passes — nobody has measured it.
            rules={[
              {
                validator: (_, value: BatteryDraft | undefined) =>
                  !editing ||
                  isBatteryDraftInRange(
                    value ?? {},
                    defaultBatteryModeOfSku(db, editing.skuId),
                  )
                    ? Promise.resolve()
                    : Promise.reject(
                        new Error(
                          t(
                            "stock.batteryOutOfRange",
                            "One of these readings is out of range.",
                          ),
                        ),
                      ),
              },
            ]}
          >
            {/* antd hands a `Form.Item`'s single child `value`/`onChange`, so
                the shared component slots in as a field of its own — the whole
                reading is one form value rather than two or three that a
                validator would have to reassemble. */}
            <BatteryFieldsField
              fallback={
                editing
                  ? defaultBatteryModeOfSku(db, editing.skuId)
                  : "HEALTH"
              }
            />
          </Form.Item>
          <Form.Item
            name="reason"
            label={t("stock.reason", "Reason")}
            tooltip={t(
              "stock.writtenIntoTheAppendOnly",
              "Written into the append-only log",
            )}
          >
            <Input placeholder={t("stock.whyThisChange", "Why this change?")} />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
