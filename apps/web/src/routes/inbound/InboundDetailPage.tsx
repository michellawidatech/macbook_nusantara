/**
 * One inbound order, from raised to on-the-shelf.
 *
 * ## The flow (owner revision 2026-09-20)
 *
 * > *"Do not show all detail in 1 page. Do the same with the initial adding
 * > product flow — display the unit and qty and price first, then the detail.
 * > Either seeing inbound detail and adding new inbound will have the same
 * > display for the unit and it should only have that."*
 *
 * Three blocks, top to bottom, in the order the work is done:
 *
 * 1. **The invoice's facts** — supplier, number, date, warehouse, status —
 *    every one editable in place.
 * 2. **Units**: the invoice's lines, one row each — product, quantity, one
 *    unit price, a discount, the line total and its COGS. It is the SAME
 *    component the order form's second step draws
 *    (`PurchaseLinesTable`), which is what the owner's ask is about, and
 *    everything about the machines behind a line is in the popup behind it
 *    (`UnitDetailsModal`): serial, grade, battery, description, sell price,
 *    photos and the row's decisions.
 * 3. **Purchase**: the goods, every expense (`ExpenseModal`), and the
 *    payments.
 *
 * ## What went, and why
 *
 * The collapsed *Inbound* section and the list of one row per unit were two
 * readings of the same lines, and the owner asked for one. The discrepancy
 * panel under them went with them — *"the user will handle it manually (add
 * new product, changed product no need to flag, mark as not arrived, and
 * remove the line)"* — and with it the per-row product picker: a product is a
 * fact about the LINE now, and correcting one relabels every unit of it still
 * in QC. `invoiceChanges` in `lib/inboundRows.ts` is what drew that panel; it
 * stays, tested and dormant, because nothing about it was wrong.
 *
 * ## Any order (owner revision 2026-09-19, unchanged)
 *
 * A row becomes a unit the moment its serial is read (2026-08-26;
 * `lib/inboundQc.ts` has why a unit without a serial is not a unit), so what
 * the popup is told before that — battery, description, grade, photos, sell
 * price — is held against the row and written onto the unit in the SAME
 * mutation that mints it (`identify`). Only the decisions (accept, service,
 * return) wait for the serial, because they are about a particular unit.
 * The first serial read against the order marks it arrived.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { SerialLink } from "../../components/SerialLink";
import dayjs from "dayjs";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Dropdown,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Result,
  Select,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { MenuProps } from "antd";
import {
  CameraOutlined,
  CheckCircleFilled,
  CheckOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  FileAddOutlined,
  InboxOutlined,
  LockOutlined,
  MoreOutlined,
  PlusOutlined,
  PrinterOutlined,
  StopOutlined,
  ToolOutlined,
  UndoOutlined,
  UnlockOutlined,
} from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { useTranslation } from "react-i18next";
import { MoneyInput } from "../../components/MoneyInput";
import { CommitMoneyInput } from "../../components/CommitMoneyInput";
import { EditableTable } from "../../components/EditableTable";
import { EnumTag } from "../../components/EnumTag";
import { PrintLabelsModal } from "../../components/LabelSheet";
import { isPriceInRange } from "../../lib/unitPrice.js";
import { labelsFor, type LabelDatum } from "../../lib/labels.js";
import { fmtRp, fmtDate, fmtNone } from "../../lib/format.js";
import {
  INBOUND_STAGE_LABEL,
  PO_PAYMENT_STATUS_COLOR,
  PO_PAYMENT_STATUS_LABEL,
  PO_STATUS_LABEL,
  PO_STATUSES,
  canReopenQc,
  payTargetOfFee,
  paymentFor,
  poClosed,
  poPaymentStatus,
  poTotals,
  unitStage,
  unitsOfPo,
  type Standing,
} from "../../lib/inbound.js";
import {
  joinDescription,
  qcReady,
  splitDescription,
} from "../../lib/inboundQc.js";
import {
  batteryDraftOf,
  batteryPatch,
  defaultBatteryModeOfSku,
  isBatteryDraftInRange,
  readUnitBattery,
  BATTERY_FIELD_RANGE,
  type BatteryDraft,
  type BatteryField,
  type BatteryMode,
} from "../../lib/battery.js";
import {
  NEW_GRADE,
  needsDescription,
  conditionOf,
} from "../../lib/condition.js";
import { GRADES } from "../../lib/grading.js";
import {
  normaliseLines,
  receivingRows,
  receivingState,
  receivingSummary,
  type ReceivingRow,
} from "../../lib/inboundRows.js";
import {
  insertAfterGroup,
  linesToDrop,
  purchaseLines,
  spreadDiscount,
  type PurchaseLine,
} from "../../lib/invoiceLines.js";
import { poRowShares, rowKey } from "../../lib/landedCost.js";
import { costBreakdown, serviceLocationOf } from "../../lib/service.js";
import {
  CODE128_HINT,
  BASE_MAX_LENGTH,
  BASE_MIN_LENGTH,
  normaliseScan,
  SERIAL_FIELD_MAX_LENGTH,
  readBarcode,
  type ScanRejection,
} from "../../lib/serialScan.js";
import { readSerialInput, serialConditionOf } from "../../lib/serialInput.js";
import { skuTracksSerial } from "../../lib/serialTracking.js";
import { arrivedQty, onHand } from "../../lib/stock.js";
import { BatteryFields } from "../../components/BatteryFields";
import { GradeTag } from "../../components/GradeTag";
import { UnitPhotos } from "../../components/UnitPhotos";
import { UNIT_STATUS } from "../../i18n/enumLabels.js";
import { RP_SYMBOL, moneyFormatter, moneyParser } from "../../components/money";
import { planSerialFill, type FillPlan } from "../../lib/scanFill.js";
import { rendered } from "../../lib/rendered.js";
import { useScanTarget } from "../../hooks/useScanTarget.js";
import { wasScannedText } from "../../lib/scanner.js";
import { COLUMN, SPACE, TYPE } from "../../theme/tokens";
import {
  PO_FEE_KIND_LABEL,
  PO_PAYMENT_FOR_LABEL,
  type MockDb,
  type Po,
  type PoFee,
  type PoItem,
  type PoPayment,
  type PoPaymentFor,
} from "../../mock/seed.js";
import {
  useDb,
  getDb,
  mutate,
  nextId,
  docCode,
  appendEvent,
  ensureReason,
  currentStaffName,
  ensureQcDescription,
  addQcPhoto,
  qcPhotosOf,
} from "../../mock/store.js";
import {
  AddLineBar,
  InvoiceExceptions,
  PurchaseLinesTable,
  lineCostFieldId,
} from "./PurchaseLinesTable.js";
import { InboxSlashOutlined } from "../../components/InboxSlashIcon";
import { UnitDetailsModal } from "../../components/UnitDetailsModal";
import { ExpenseModal } from "./ExpenseModal.js";
import { draftKey, usePersistentState } from "../../hooks/usePersistentState";
import { isRecord } from "../../lib/draftGuards.js";

/**
 * The DOM ids of a row's boxes — what Enter and the scanner hand the caret
 * to. Row keys are line ids, so the id outlives a re-render. A line's own
 * price box is `lineCostFieldId`.
 */
const serialFieldId = (key: string) => `receiving-serial-${key}`;
const descFieldId = (key: string) => `receiving-desc-${key}`;
const gradeFieldId = (key: string) => `receiving-grade-${key}`;
const sellFieldId = (key: string) => `receiving-sell-${key}`;

/**
 * The statuses in which a machine's money can still be corrected here.
 *
 * In QC, and on the shelf unsold. Reserved or sold, the cost and the price
 * are already on somebody's hold or receipt, and correcting them belongs to
 * that document; on the bench or back with the supplier, the machine is not
 * this invoice's to reprice.
 */
const MONEY_EDITABLE: readonly string[] = ["QC", "TERSEDIA"];

/**
 * Is a variant COUNTED rather than identified in this store — an accessory
 * (2026-09-19)? Its lines are quantities that arrive on the stock ledger, not
 * rows of units, so every row reading leaves them out.
 */
const countedIn =
  (store: Parameters<typeof skuTracksSerial>[0]) =>
  (skuId: string): boolean =>
    skuId !== "" && !skuTracksSerial(store, skuId);

/** Hand the caret to a field once React has drawn what the last change did. */
function focusSoon(id: string): void {
  // A microtask, not a timer: React flushes a keystroke's render in a
  // microtask queued during the handler, and this one is queued after it.
  queueMicrotask(() => {
    const el = document.getElementById(id);
    if (el instanceof HTMLInputElement) {
      el.focus();
      el.select();
    } else {
      el?.focus();
    }
  });
}

/** A map without one key — the same map when the key was never there. */
function without<T>(
  map: Readonly<Record<string, T>>,
  key: string,
): Readonly<Record<string, T>> {
  if (!(key in map)) return map;
  const rest = { ...map };
  delete rest[key];
  return rest;
}

/** What one edit of the order can reach, one machine per line already. */
interface OrderEdit {
  readonly d: MockDb;
  readonly order: Po;
  /** The line behind a row the page rendered, wherever normalising put it. */
  readonly lineOf: (row: ReceivingRow) => PoItem | undefined;
  /** The key the page's drafts hold for a row derived inside this edit. */
  readonly draftKeyOf: (row: ReceivingRow) => string;
}

/**
 * What a payment is for, as the payment dialog's one Select holds it: the
 * goods, an expense (`fee:<id>`), or — only for a payment recorded before
 * expenses had names — the bucket it was filed under.
 */
type PayTarget = "ORDER" | "SHIPPING" | "TAX" | `fee:${string}`;

const targetOf = (p: PoPayment): PayTarget =>
  p.feeId !== undefined ? `fee:${p.feeId}` : paymentFor(p);

/**
 * QC answered on a row whose serial is not in yet — held against the row and
 * written onto the unit by `identify`. `grade` carries the condition: `NEW`
 * is sealed stock, a letter is graded second-hand, absent is second-hand not
 * graded yet (`lib/condition.ts`).
 */
interface QcDraft {
  readonly grade?: string;
  readonly battery?: BatteryDraft;
  readonly description?: readonly string[];
  readonly photos?: readonly { readonly id: string; readonly url: string }[];
}

/*
 * What is typed on this order and not written yet — a serial being typed, a
 * price or QC answers held for a row with no serial — kept on this device per
 * order (owner ask 2026-09-21: "all the things of the user input will be
 * saved locally"). The in-app tab strip used to keep them in memory while
 * somebody looked elsewhere; leaving the order now brings them back with it.
 * `forget` and `rekey` work on them exactly as before.
 *
 * Photos ride along when they fit: a data URL can outgrow the browser's
 * storage, and a refused write leaves the page working as it did before.
 */
const INBOUND_DRAFT = (poId: string, name: string) =>
  draftKey(`inbound.${poId}.${name}`);
const mapOf =
  <T,>(item: (v: unknown) => boolean) =>
  (v: unknown): Record<string, T> | undefined =>
    isRecord(v)
      ? (Object.fromEntries(
          Object.entries(v).filter(([, x]) => item(x)),
        ) as Record<string, T>)
      : undefined;

/** The grade picker's choices: sealed, then the letters. */
const GRADE_CHOICES = [NEW_GRADE, ...GRADES] as const;

/**
 * The timeline's line for a grade given at QC. In English, like every ledger
 * note: a `UnitEvent` is append-only, and its text is frozen as written.
 */
function gradeNote(grade: string | undefined): string {
  if (grade === NEW_GRADE) return "Marked new — sealed stock";
  if (grade === undefined) return "Marked second-hand";
  return `Graded ${grade}`;
}

export function InboundDetailPage() {
  const { poId = "" } = useParams();
  const db = useDb();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  /**
   * The payment dialog: closed, adding, or correcting one already recorded
   * (owner ask 2026-09-15 — *"All the payment/Purchase history should be
   * editable and deletable"*). `id` is the payment being edited.
   */
  const [paying, setPaying] = useState<{ readonly id?: string } | null>(null);
  /**
   * Undefined is a method nobody has picked (owner ask 2026-09-15), so the box
   * can be cleared while somebody decides. The OK is what refuses to record
   * money that does not say how it moved.
   */
  const [payMethod, setPayMethod] = useState<string | undefined>("TUNAI");
  const [payAmount, setPayAmount] = useState<number>();
  /**
   * Did the money pass through the shop's cash or bank? (owner answer
   * 2026-09-22 — `PoPayment.inBalance`.) Off for a supplier the owner paid
   * from their own account: the invoice is settled, the balance untouched.
   */
  const [payInBalance, setPayInBalance] = useState(true);
  /** What the payment being recorded is settling. */
  const [payTarget, setPayTarget] = useState<PayTarget>("ORDER");
  /** The expense dialog: closed, `"new"`, or the id of the one being edited. */
  const [expense, setExpense] = useState<string | null>(null);
  const [printing, setPrinting] = useState<LabelDatum[] | null>(null);
  /**
   * Serials being typed, keyed by row.
   *
   * Not written to the store until the field is left or Enter is pressed:
   * committing per keystroke re-keyed the row, React remounted the input and
   * the caret went with it — one click per digit, which is how the owner
   * reported it. A half-typed serial is not a machine.
   */
  const [draft, setDraft] = usePersistentState<Record<string, string>>(
    INBOUND_DRAFT(poId, "serials"),
    {},
    mapOf<string>((x) => typeof x === "string"),
  );
  /**
   * Rows whose serial was refused for its SHAPE, keyed by row. The field
   * carries the refusal — a red outline for as long as the text is still
   * wrong, and the reason under it — because a toast is gone in four seconds
   * (owner report 2026-09-01). Only shape faults: a collision reverts the box
   * to what the store holds, and outlining THAT would accuse the wrong string.
   */
  const [serialFault, setSerialFault] = useState<
    Record<string, { fault: ScanRejection; scanned: boolean }>
  >({});
  /**
   * Whether the serial held in a row's box arrived as a SCAN (2026-09-21).
   *
   * A sealed unit's scan and its typed serial are held to different rules,
   * and a serial read before its row has a grade is held until one is picked
   * — by which time `wasScannedText` (a five-second memory) has long
   * forgotten. So the answer is written down when the text arrives, kept with
   * the text on this device, and cleared the moment somebody edits the box.
   */
  const [heldScan, setHeldScan] = usePersistentState<Record<string, boolean>>(
    INBOUND_DRAFT(poId, "serialScanned"),
    {},
    mapOf<boolean>((x) => typeof x === "boolean"),
  );
  const clearSerialFault = (key: string) =>
    setSerialFault((f) => without(f, key));
  /** A sell price: typed on a unit row, or held for a waiting one. `null` is an emptied box. */
  const [prices, setPrices] = usePersistentState<Record<string, number | null>>(
    INBOUND_DRAFT(poId, "prices"),
    {},
    mapOf<number | null>(
      (x) => x === null || (typeof x === "number" && Number.isFinite(x)),
    ),
  );
  /** QC answered before the serial, by row — see `QcDraft`. */
  const [qcDrafts, setQcDrafts] = usePersistentState<Record<string, QcDraft>>(
    INBOUND_DRAFT(poId, "qc"),
    {},
    mapOf<QcDraft>(isRecord),
  );
  /** Battery boxes being typed on a unit's row — written when left. */
  const [batteryTyping, setBatteryTyping] = usePersistentState<
    Record<string, BatteryDraft>
  >(INBOUND_DRAFT(poId, "battery"), {}, mapOf<BatteryDraft>(isRecord));
  /** Which line's units are open, or null. */
  const [detailsKey, setDetailsKey] = useState<string | null>(null);
  /** The row whose photos are open, or null. */
  const [photosRow, setPhotosRow] = useState<string | null>(null);
  /*
   * ⚠️ `checklists` — the grading answers each row was last graded with —
   * lived here until 2026-09-20, when the owner asked for the grading
   * configuration and its checklists to be hidden. The grade is picked by
   * hand; `components/GradingModal` and `lib/grading.ts` are untouched on
   * disk, and this is the state to bring back with them.
   */
  /**
   * The machine the Send-to-service dialog is open on, or null. Both fees are
   * asked for there (owner revision 2026-09-09): the courier's number is on
   * the desk at the moment somebody decides a machine needs a repair.
   */
  const [sendingToService, setSendingToService] = useState<string | null>(null);
  const [serviceForm] = Form.useForm<{
    ship: boolean;
    shippingFee?: number;
    serviceFee?: number;
    note?: string;
  }>();
  /**
   * Where normalising moved a row's key (old key → line id).
   *
   * An older invoice's line of quantity three is three rows keyed
   * `line#0…#2` until its first edit splits it into three lines. Handlers
   * created before that render still hold the old key; this is how they find
   * the row it became.
   */
  const aliases = useRef<Record<string, string>>({});

  const po = db.pos.find((p) => p.id === poId);
  const units = useMemo(() => (po ? unitsOfPo(db, po.id) : []), [db, po]);

  /**
   * Arriving from the list's *Add payment* (owner brief 2026-09-19): the
   * payment dialog opens by itself. Carried as navigation STATE rather than a
   * query parameter, so nothing has to navigate from an effect to clear it.
   */
  const location = useLocation();
  const payOnArrival = useRef(
    (location.state as { pay?: boolean } | null)?.pay === true,
  );
  useEffect(() => {
    if (!payOnArrival.current) return;
    payOnArrival.current = false;
    if (!po || poClosed(po)) return;
    setPaying({});
    setPayMethod("TUNAI");
    setPayAmount(undefined);
    setPayTarget("ORDER");
    setPayInBalance(true);
    // Once, on arrival — not every time the order re-renders.
  }, []);

  /**
   * The rows: every machine the invoice lists, and every machine on it that
   * no line accounts for. Derived, never stored — see `lib/inboundRows.ts`.
   */
  const rows = useMemo(
    () => (po ? receivingRows(po, db.units, countedIn(db)) : []),
    [po, db],
  );
  const summary = useMemo(() => receivingSummary(rows), [rows]);
  /** Each waiting row's share of the invoice's COGS expenses. */
  const shares = useMemo(
    () => (po ? poRowShares(po, db.units) : new Map<string, number>()),
    [po, db.units],
  );

  /**
   * Every machine on this invoice that could be accepted right now — the same
   * `qcReady` gate as the QC dialog's Done. `status === "QC"` keeps a machine
   * already decided out of the list.
   */
  const readyToAccept = useMemo(
    () =>
      db.units.filter(
        (u) => u.poId === po?.id && u.status === "QC" && qcReady(u),
      ),
    [db.units, po?.id],
  );

  /**
   * Accept the lot, in ONE mutation — a partial failure halfway through a loop
   * of them would leave the invoice in a state nobody chose. Confirmed first:
   * it moves a whole invoice's worth of stock onto the shelf in one press.
   */
  const acceptAll = () => {
    if (!po) return;
    const serials = readyToAccept.map((u) => u.serial);
    if (serials.length === 0) return;
    modal.confirm({
      title: t("inbound.acceptAllTitle", "Accept {{count}} unit(s)?", {
        count: serials.length,
      }),
      content: t(
        "inbound.acceptAllBody",
        "They go into sellable stock now. Anything still missing a description is not included, and any one of these can be put back into QC afterwards.",
      ),
      okText: t("inbound.acceptAllOk", "Accept them"),
      cancelText: t("inbound.cancel", "Cancel"),
      onOk: () => {
        mutate((d) => {
          for (const serial of serials) {
            appendEvent(d, serial, {
              type: "QC_SELESAI",
              toStatus: "TERSEDIA",
              refCode: po.code,
              note: "QC passed",
            });
          }
        });
        message.success(
          t("inbound.acceptAllDone", "{{count}} unit(s) accepted into stock.", {
            count: serials.length,
          }),
        );
      },
    });
  };

  const skuOf = (skuId: string) => db.skus.find((s) => s.id === skuId);
  const skuLabel = (skuId: string) => {
    const sku = skuOf(skuId);
    return sku ? `${sku.name} ${sku.variantLabel}` : fmtNone();
  };
  /** The printed code, which is what the shop reads off a shelf. */
  const skuCode = (skuId: string) => skuOf(skuId)?.code ?? fmtNone();
  /**
   * Is this product identified one by one, or merely counted (owner ask
   * 2026-09-15)? A counted product — an accessory — has no serial anybody
   * reads, so this desk neither asks for one nor waits for one.
   */
  const tracksSerial = (skuId: string) => skuTracksSerial(db, skuId);

  /**
   * What a row's machine IS: the unit's own product once it exists, and what
   * the invoice says before that.
   *
   * There is no longer a third answer. Until 2026-09-20 a waiting row could
   * be told it had turned out to be something else, held in the page until
   * the serial arrived; the product is a fact about the LINE now (owner:
   * *"changed product no need to flag"*), and correcting a line relabels
   * every unit of it still in QC. The two can still disagree on an invoice
   * edited before that, which is why this asks the unit first.
   */
  const actualSkuOf = (row: ReceivingRow): string =>
    row.unit?.skuId ?? row.expectedSkuId;

  /**
   * Waiting for a serial: expected, not marked as never sent, with a product
   * that is identified one by one. What a scan fills and Enter moves to.
   */
  const awaitsSerial = (row: ReceivingRow): boolean => {
    if (row.unit !== null || row.notArrived || row.orphan) return false;
    const sku = actualSkuOf(row);
    return sku !== "" && tracksSerial(sku);
  };

  /** The row's position, as the # column counts it. */
  const numberOf = (row: ReceivingRow) =>
    rows.findIndex((r) => r.key === row.key) + 1;

  /** The row as the store has it NOW, rather than as the last render drew it. */
  const liveRow = (key: string): ReceivingRow | undefined => {
    const live = getDb();
    const order = live.pos.find((p) => p.id === poId);
    if (!order) return undefined;
    const k = aliases.current[key] ?? key;
    return receivingRows(order, live.units, countedIn(live)).find(
      (r) => r.key === k,
    );
  };

  /**
   * Move every draft to the key its row has now — after an edit that split an
   * older invoice's lines, which gives pieces 1…n new line ids.
   */
  const rekey = (moved: Readonly<Record<string, string>>) => {
    aliases.current = { ...aliases.current, ...moved };
    const move = <T,>(map: Readonly<Record<string, T>>): Record<string, T> => {
      let changed = false;
      const out: Record<string, T> = {};
      for (const [key, value] of Object.entries(map)) {
        const to = moved[key];
        if (to !== undefined && to !== key) changed = true;
        out[to ?? key] = value;
      }
      return changed ? out : (map as Record<string, T>);
    };
    setDraft(move);
    setHeldScan(move);
    setSerialFault(move);
    setPrices(move);
    setQcDrafts(move);
    setBatteryTyping(move);
  };

  /** Drop everything the page was holding for a row — it is a machine now, or gone. */
  const forget = (key: string) => {
    const k = aliases.current[key] ?? key;
    setDraft((m) => without(m, k));
    setHeldScan((m) => without(m, k));
    setSerialFault((m) => without(m, k));
    setPrices((m) => without(m, k));
    setQcDrafts((m) => without(m, k));
    setBatteryTyping((m) => without(m, k));
  };

  /**
   * Change this order — one machine per line first.
   *
   * Every edit of the rows goes through here, so an older invoice written with
   * quantities is split into one line per machine at the moment somebody
   * first changes it (`normaliseLines`), inside the same mutation as the
   * change itself. Opening the page never writes.
   */
  const editOrder = (fn: (edit: OrderEdit) => void): Promise<boolean> => {
    let moved: Record<string, string> = {};
    const done = mutate((d) => {
      const order = d.pos.find((p) => p.id === poId);
      if (!order) return;
      moved = normaliseLines(order, d.units, () => nextId("poi"), countedIn(d));
      const back = new Map(
        Object.entries(moved).map(([from, to]) => [to, from]),
      );
      fn({
        d,
        order,
        lineOf: (row) => {
          if (row.itemId === null) return undefined;
          const id = moved[row.key] ?? aliases.current[row.key] ?? row.itemId;
          return order.items.find((i) => i.id === id);
        },
        draftKeyOf: (row) => back.get(row.key) ?? row.key,
      });
    });
    if (Object.keys(moved).length > 0) rekey(moved);
    return done;
  };

  /**
   * A row becomes a unit. The only place intake creates one.
   *
   * The `DITERIMA` event is written in the same mutation as the row, because a
   * unit that exists without one is a row the timeline cannot explain. The
   * machine gets the product the bench said it IS, and the line keeps the one
   * the invoice said — the line's serial ties the two, so the difference stays
   * visible after a reload. And the order is marked arrived if it was not: a
   * machine in hand is the proof the goods came.
   */
  const identify = (
    d: MockDb,
    order: Po,
    line: PoItem | undefined,
    skuId: string,
    unitCost: number,
    serial: string,
    /** A sell price typed before the serial, written in the SAME push. */
    price?: number,
    /** QC answered before the serial — written in this same mutation. */
    qc?: QcDraft,
  ) => {
    d.units.push({
      serial,
      skuId,
      status: "QC",
      locationId: order.locationId,
      buy: unitCost,
      description: "",
      poId: order.id,
      /*
       * Priced from the moment the machine exists: what the bench typed, or
       * what the shop asks for the product it turned out to be. It is the
       * asking price, and QC's job is to move it where the machine deserves.
       */
      price: price ?? d.skus.find((x) => x.id === skuId)?.price ?? 0,
    });
    if (line) line.serial = serial;
    appendEvent(d, serial, {
      type: "DITERIMA",
      toStatus: "QC",
      refCode: order.code,
      note: `Received against ${order.code}`,
    });
    if (qc) applyQcDraft(d, order.code, serial, qc);
    if (order.status !== "RECEIVED") order.status = "RECEIVED";
  };

  /**
   * What the bench answered on a row before its serial was read, onto the
   * unit that has just been minted for it — the battery, the description (its
   * phrases joining the vocabulary in the same mutation), the photos, and the
   * grade with its line on the timeline.
   */
  const applyQcDraft = (
    d: MockDb,
    poCode: string,
    serial: string,
    qc: QcDraft,
  ) => {
    const u = d.units.find((x) => x.serial === serial);
    if (!u) return;
    if (qc.battery) {
      const next = batteryPatch(
        qc.battery,
        defaultBatteryModeOfSku(d, u.skuId),
      );
      u.batteryHealth = next.batteryHealth;
      u.cycleCount = next.cycleCount;
      u.fcc = next.fcc;
    }
    if (qc.description && qc.description.length > 0) {
      u.description = joinDescription(
        qc.description.map((p) => ensureQcDescription(d, p)).filter(Boolean),
      );
    }
    for (const photo of qc.photos ?? []) addQcPhoto(d, serial, photo.url);
    if (qc.grade !== undefined) {
      u.grade = qc.grade;
      appendEvent(d, serial, {
        type: "DICATAT",
        refCode: poCode,
        note: gradeNote(qc.grade),
      });
    }
  };

  /** Say so when the first machine marked the order arrived by itself. */
  const noteArrival = (wasArrived: boolean) => {
    if (wasArrived) return;
    const order = getDb().pos.find((p) => p.id === poId);
    if (order?.status === "RECEIVED") {
      message.info(t("inbound.autoArrived", "The order is marked as arrived."));
    }
  };

  /**
   * Correcting a mistyped serial, ledger and all. A unit is referred to by its
   * serial everywhere, so the events move with it, and so does the line's
   * link. Only reachable while the unit is in QC.
   */
  const renameUnit = (d: MockDb, from: string, to: string) => {
    const unit = d.units.find((u) => u.serial === from);
    if (!unit) return;
    unit.serial = to;
    for (const e of d.events) if (e.serial === from) e.serial = to;
    const order = d.pos.find((p) => p.id === poId);
    for (const item of order?.items ?? []) {
      if (item.serial === from) item.serial = to;
    }
  };

  /**
   * Why a scan was refused, in a sentence somebody at the bench can act on —
   * four rejections and four different remedies.
   */
  const scanRefusal = (
    reason: ScanRejection,
    scanned: string,
    length: number,
  ): string => {
    if (reason === "empty") {
      return t("inbound.scanEmpty", "Nothing was scanned.");
    }
    if (reason === "length") {
      // Only a NEW unit's scan is judged at all (2026-09-21).
      return t(
        "inbound.scanLength",
        "“{{scanned}}” is {{n}} characters. A new unit's barcode is an S and then {{min}}–{{max}} more — a short read is a scanner that came away early, a long one two scans with no Enter between.",
        { scanned, n: length, min: BASE_MIN_LENGTH, max: BASE_MAX_LENGTH },
      );
    }
    if (reason === "no-marker") {
      // The underside of a box carries a regulatory code and a part number of
      // much the same shape, and the S is what tells the serial from them.
      return t(
        "inbound.scanNoMarker",
        "“{{scanned}}” does not begin with S. Aim at the barcode whose number starts with S.",
        { scanned },
      );
    }
    /*
     * There is no `confusable` refusal any more (owner revision 2026-09-21):
     * an `I` or an `O` in a READ is mapped to a `1` or a `0` and the scan is
     * recorded. See `correctScanConfusables`.
     */
    return t(
      "inbound.scanCharset",
      "“{{scanned}}” is not a serial — capitals and digits only. Check the scanner is set to {{symbology}} and that this is the unit's own barcode.",
      { scanned, symbology: CODE128_HINT },
    );
  };

  /**
   * Why a NEW unit's serial was refused, in one sentence. A second-hand one is
   * taken as read and never gets here (owner, 2026-09-21).
   */
  const serialFaultText = (
    fault: ScanRejection,
    serial: string,
    scanned: boolean,
  ): string => {
    if (fault === "no-marker") {
      // Only a SCAN is refused for this: a typed serial is the number off the
      // case, which never had an S.
      return t(
        "inbound.serialNoMarker",
        "“{{serial}}” does not begin with S. A new unit's barcode carries one — the scanner was aimed at the regulatory code or the part number beside it.",
        { serial },
      );
    }
    if (fault === "charset") {
      return t(
        "inbound.serialCharset",
        "“{{serial}}” has something other than capitals and digits in it.",
        { serial },
      );
    }
    return scanned
      ? t(
          "inbound.serialShape",
          "“{{serial}}” is {{n}} characters. A new unit's barcode is an S and then {{min}}–{{max}} more.",
          {
            serial,
            n: serial.length,
            min: BASE_MIN_LENGTH,
            max: BASE_MAX_LENGTH,
          },
        )
      : t(
          "inbound.serialLengthTyped",
          "“{{serial}}” is {{n}} characters. A new unit's serial is {{min}}–{{max}} characters.",
          {
            serial,
            n: serial.length,
            min: BASE_MIN_LENGTH,
            max: BASE_MAX_LENGTH,
          },
        );
  };

  /** The same refusal, short enough to sit under the serial column. */
  const serialFaultHint = (fault: ScanRejection, scanned: boolean): string => {
    if (fault === "no-marker") {
      return t("inbound.serialHintMarker", "Must start with S");
    }
    if (fault === "charset") {
      return t("inbound.serialHintCharset", "Capitals and digits only");
    }
    return scanned
      ? t("inbound.serialHintLength", "S and then {{min}}–{{max}}", {
          min: BASE_MIN_LENGTH,
          max: BASE_MAX_LENGTH,
        })
      : t("inbound.serialHintBare", "{{min}}–{{max}} characters", {
          min: BASE_MIN_LENGTH,
          max: BASE_MAX_LENGTH,
        });
  };

  /**
   * The next row still waiting for a serial, after `fromKey` — and failing
   * that, the first one above it. Read from the store, because the caller has
   * just changed it.
   */
  const focusNextWaiting = (fromKey: string) => {
    const live = getDb();
    const order = live.pos.find((p) => p.id === poId);
    if (!order) return;
    const all = receivingRows(order, live.units, countedIn(live));
    const from = all.findIndex(
      (r) => r.key === (aliases.current[fromKey] ?? fromKey),
    );
    const next =
      all.slice(from + 1).find((r) => awaitsSerial(r)) ??
      all.slice(0, Math.max(0, from)).find((r) => awaitsSerial(r));
    if (next) focusSoon(serialFieldId(next.key));
  };

  /**
   * A scanned serial lands on the first machine still waiting for one.
   *
   * The plan is worked out against the mutation draft rather than against the
   * render closure, because the store has already moved on by the time the next
   * scan of a burst arrives. It fills in ROW order and nothing else: the
   * scanner reads a serial, not a product, so it cannot know which of two
   * waiting rows the machine belongs to. A machine that turns out to be
   * another product is changed on its row.
   */
  const scanSerial = async (raw: string) => {
    if (raw.trim() === "") return;
    // A locked order takes nothing, and the scanner is the one input on this
    // page that no `disabled` prop can reach — it listens at the document.
    const target = getDb().pos.find((p) => p.id === poId);
    if (target && poClosed(target)) {
      message.info(
        t(
          "inbound.scanClosed",
          "This invoice is closed. Reopen it before recording anything.",
        ),
      );
      return;
    }
    // Read-only means read-only for the scanner too (2026-09-24). It is the
    // one input a `disabled` prop cannot reach, so a bench that scanned onto a
    // page nobody had put into edit would mint units invisibly.
    if (!editing) {
      message.info(
        t(
          "inbound.scanReadOnly",
          "This invoice is read-only. Press Edit invoice before scanning.",
        ),
      );
      return;
    }

    /*
     * Which rule a scan is held to is decided by the ROW it lands on (owner
     * rules 2026-09-21): a NEW unit's barcode must be `S` and ten to twelve,
     * and is filed without its `S`; a second-hand unit's is filed as read; a
     * row with no grade yet holds the scan in its box until one is picked. So
     * the row is found first — on every reading this scan could be filed
     * under, so a double scan is caught whichever way the first was filed.
     */
    const scanned = normaliseScan(raw);
    const barcode = readBarcode(scanned);
    const forms = barcode.ok ? [scanned, barcode.serial] : [scanned];
    const wasArrived = target?.status === "RECEIVED";

    const out: {
      plan: FillPlan | null;
      product: string;
      landed: string;
      serial: string;
      /** A row the scan is waiting on, or was refused for. */
      held: { key: string; fault?: ScanRejection } | null;
    } = { plan: null, product: "", landed: "", serial: scanned, held: null };
    editOrder(({ d, order, draftKeyOf }) => {
      const current = receivingRows(order, d.units, countedIn(d));
      const fill = current
        .filter(
          (r) => awaitsSerial(r) || (r.unit !== null && r.unit.status === "QC"),
        )
        .map((r) => ({
          key: r.key,
          // A serial held in a row's box — waiting for its grade — is that
          // row's; the next scan goes on to the next row.
          shown: r.unit?.serial ?? (draft[draftKeyOf(r)] ?? "").trim(),
        }));
      // A serial already on THIS order is a double scan, and the plan can name
      // the row holding it. `exists` is for one the shop knows from elsewhere.
      const mine = new Set(
        d.units.filter((u) => u.poId === order.id).map((u) => u.serial),
      );
      const plan = planSerialFill(
        forms,
        fill,
        (s) => !mine.has(s) && d.units.some((u) => u.serial === s),
      );
      out.plan = plan;
      if (plan.kind !== "fill") return;
      const row = current.find((r) => r.key === plan.rowKey);
      if (!row || row.unit !== null) {
        out.plan = { kind: "full" };
        return;
      }
      const key = draftKeyOf(row);
      const qc = qcDrafts[key];
      const read = readSerialInput(scanned, {
        scanned: true,
        condition: serialConditionOf(qc?.grade),
      });
      if (!read.ok) {
        out.held =
          read.reason === "needs-grade"
            ? { key: row.key }
            : { key: row.key, fault: read.reason };
        return;
      }
      const sku = actualSkuOf(row);
      const line = order.items.find((i) => i.id === row.itemId);
      identify(
        d,
        order,
        line,
        sku,
        line ? line.unitCost - (line.discount ?? 0) : row.unitCost,
        read.serial,
        prices[key] ?? undefined,
        qc,
      );
      out.serial = read.serial;
      out.product = skuLabel(sku);
      out.landed = row.key;
    });
    if (out.landed !== "") forget(out.landed);

    // Toasts only once the mutation is over — never inside a state updater.
    const held = out.held;
    if (held !== null) {
      setDraft((m) => ({ ...m, [held.key]: scanned }));
      setHeldScan((m) => ({ ...m, [held.key]: true }));
      if (held.fault !== undefined) {
        const fault = held.fault;
        setSerialFault((f) => ({ ...f, [held.key]: { fault, scanned: true } }));
        message.error(
          barcode.ok
            ? serialFaultText(fault, scanned, true)
            : scanRefusal(barcode.reason, barcode.scanned, barcode.length),
        );
      } else {
        message.info(
          t(
            "inbound.serialWaitsForGrade",
            "{{serial}} is kept — pick the unit's grade and it is recorded.",
            { serial: scanned },
          ),
        );
        // Focus stays where it is: the next scan of a run has to reach the
        // page, and a grade picker holding the caret would swallow it.
      }
      // The next scan of a burst must see this row as taken — `draft` is read
      // from the render closure. See `rendered`.
      await rendered();
      return;
    }
    const plan: FillPlan | null = out.plan;
    if (plan === null) return;
    const serial = out.serial;
    if (plan.kind === "fill") {
      message.success(
        t("inbound.scanLandedOriginal", "{{serial}} recorded — {{product}}.", {
          serial,
          product: out.product,
        }),
      );
      noteArrival(wasArrived);
    } else if (plan.kind === "duplicate") {
      message.warning(
        t("inbound.scanDuplicate", "{{serial}} is already on this order.", {
          serial,
        }),
      );
    } else if (plan.kind === "exists") {
      message.error(
        t(
          "inbound.scanExists",
          "{{serial}} already belongs to another unit in the system.",
          { serial },
        ),
      );
    } else {
      message.warning(
        t(
          "inbound.scanFullRowsInbound",
          "Every unit on this order already has a serial. Add the unit in the Inbound section to expect another.",
        ),
      );
    }
    await rendered();
  };

  useScanTarget(scanSerial);

  /**
   * Write a sell price the moment the box is left. Committed on blur rather
   * than per keystroke: Rp9, Rp95, Rp950 on the way to Rp9.500.000 are each a
   * number somebody could have meant. The marketplace price is not asked for
   * here — it is derived from the sell prices elsewhere.
   */
  /**
   * The grade a row is showing — the unit's own once it exists, the draft
   * before that. It is the CONDITION (`lib/condition.ts`), which is why the
   * serial rules read it.
   */
  const gradeShown = (r: ReceivingRow): string | undefined =>
    r.unit ? r.unit.grade : qcDrafts[r.key]?.grade;

  const commitSellPrice = (row: ReceivingRow, value: number | null) => {
    const revert = () => setPrices((d) => without(d, row.key));
    if (!isPriceInRange(value)) {
      message.error(
        t("inbound.priceRefused", "{{value}} is not a price.", { value }),
      );
      return revert();
    }
    // A waiting row keeps it until the serial turns the row into a machine.
    if (row.unit === null) return;
    revert();
    const serial = row.unit.serial;
    const next = value ?? undefined;
    if (next === row.unit.price) return;
    mutate((d) => {
      const u = d.units.find((x) => x.serial === serial)!;
      // Never left blank on a machine that exists: an empty box means "back
      // to what the shop asks", not "unpriced".
      u.price = next ?? d.skus.find((x) => x.id === u.skuId)?.price ?? 0;
    });
  };

  const commitSerial = (
    row: ReceivingRow,
    raw: string,
    advance: boolean,
    /** A grade picked just now, releasing a serial held for want of one. */
    over?: { readonly grade: string | undefined },
  ) => {
    const typed = normaliseScan(raw);
    /*
     * One reader for every serial box in the app, under the owner's rules of
     * 2026-09-21 (`lib/serialInput.ts`): a NEW unit's scan must be `S` and ten
     * to twelve and loses its `S`; a NEW unit's typed serial is ten to twelve;
     * `I`/`O` are read as `1`/`0` on either; a second-hand serial is taken as
     * read. Scan or hand is how fast the characters came — or, for a serial
     * held in its box, what was written down when it arrived.
     */
    const scanned = heldScan[row.key] ?? wasScannedText(typed);
    // Read NOW, not from the render: the blur that follows an Enter would
    // otherwise see a row that has already become the machine it names.
    const live = liveRow(row.key) ?? row;
    const stored = live.unit?.serial ?? "";
    /** Give the box back to what the store says. */
    const revert = () => {
      setDraft((d) => without(d, row.key));
      setHeldScan((m) => without(m, row.key));
    };
    /** Keep the text in its box, as it arrived. */
    const hold = () => {
      setDraft((d) => ({ ...d, [row.key]: typed }));
      setHeldScan((m) => ({ ...m, [row.key]: scanned }));
    };

    if (typed === stored) {
      revert();
      if (advance && stored !== "") focusNextWaiting(live.key);
      return;
    }
    if (typed === "") {
      // Only reachable on a unit row: an empty box on a waiting row is just
      // a row still waiting.
      if (live.unit) {
        message.error(
          t(
            "inbound.serialCannotBeBlank",
            "A serial cannot be blank. Remove the row instead.",
          ),
        );
      }
      return revert();
    }
    const grade = over ? over.grade : gradeShown(row);
    const read = readSerialInput(typed, {
      scanned,
      // A unit that exists with no grade is second-hand not graded yet — it
      // is already a unit, so there is nothing left to wait for.
      condition: serialConditionOf(grade) ?? (live.unit ? "SECOND" : undefined),
    });
    if (!read.ok) {
      if (read.reason === "needs-grade") {
        /*
         * The serial waits for the grade (owner answer 2026-09-21): New and
         * second-hand are held to different rules, and the bench can reach
         * the serial box first. Nothing is minted until the grade is picked —
         * `commitGrade` brings the held text back here.
         */
        hold();
        clearSerialFault(row.key);
        message.info(
          t(
            "inbound.serialWaitsForGrade",
            "{{serial}} is kept — pick the unit's grade and it is recorded.",
            { serial: typed },
          ),
        );
        // Scan, scan, scan: Enter still hands the caret to the next row
        // waiting for a serial, and the grades can be picked after.
        if (advance) focusNextWaiting(live.key);
        return;
      }
      const fault = read.reason;
      message.error(serialFaultText(fault, typed, scanned));
      // The text STAYS: a shape fault is a typo, and this also fires on BLUR,
      // so clicking away mid-serial must not empty the field.
      hold();
      setSerialFault((f) => ({ ...f, [row.key]: { fault, scanned } }));
      return;
    }
    const serial = read.serial;
    if (serial === stored) {
      // A NEW unit's barcode scanned again: the same serial, without its S.
      revert();
      if (advance) focusNextWaiting(live.key);
      return;
    }
    clearSerialFault(row.key);
    if (getDb().units.some((u) => u.serial === serial)) {
      message.error(
        t(
          "inbound.serialTaken",
          "{{serial}} already belongs to another unit.",
          { serial },
        ),
      );
      // Cleared rather than left to be corrected: a serial another unit owns
      // can never be made valid by editing it here.
      return revert();
    }
    /*
     * A serial read before anybody said what the unit IS (owner revision
     * 2026-09-19: any order). It waits in its box, as it arrived — a unit is
     * filed under a product, and committing the box once one is picked
     * records both.
     */
    if (live.unit === null && actualSkuOf(row) === "") {
      hold();
      message.info(
        t(
          "inbound.serialWaitsForProduct",
          "{{serial}} is kept — pick the unit's product and it is recorded.",
          { serial },
        ),
      );
      return;
    }
    revert();
    if (live.unit === null) {
      const wasArrived =
        getDb().pos.find((p) => p.id === poId)?.status === "RECEIVED";
      // Read from the closure BEFORE the mutation: these are what the bench
      // typed into this row while it was still waiting for a serial — and the
      // grade that released it, which `holdQc` has not written yet.
      const price = prices[row.key] ?? undefined;
      const qc = over ? { ...qcDrafts[row.key], grade } : qcDrafts[row.key];
      const sku = actualSkuOf(row);
      let landed = row.key;
      editOrder(({ d, order, lineOf }) => {
        const line = lineOf(row);
        identify(
          d,
          order,
          line,
          sku,
          line ? line.unitCost - (line.discount ?? 0) : row.unitCost,
          serial,
          price,
          qc,
        );
        if (line) landed = line.id;
      });
      forget(landed);
      message.success(
        t("inbound.serialRecorded", "{{serial}} recorded.", { serial }),
      );
      noteArrival(wasArrived);
      if (advance) focusNextWaiting(landed);
    } else {
      mutate((d) => renameUnit(d, stored, serial));
      message.success(
        t("inbound.serialCorrected", "Serial corrected to {{serial}}.", {
          serial,
        }),
      );
      if (advance) focusNextWaiting(live.key);
    }
  };

  // ── QC on the row (owner revision 2026-09-19) ───────────────────────────
  //
  // Each writer answers for both kinds of row: a unit that exists takes the
  // answer at once; a row still waiting for its serial holds it in `qcDrafts`
  // until `identify` carries it over.

  /** Hold an answer against a row that has no unit yet. */
  const holdQc = (key: string, patch: Partial<QcDraft>) =>
    setQcDrafts((m) => ({ ...m, [key]: { ...m[key], ...patch } }));

  /**
   * A row's grade — its condition with it: `NEW` is sealed stock, a letter is
   * graded second-hand, nothing is second-hand not graded yet. One line on
   * the unit's timeline per pick.
   *
   * Picked by hand and nothing else since 2026-09-20 — the checklist that
   * used to fill it in is hidden (owner ask). The parameter that carried the
   * checklist's words onto the timeline went with it.
   */
  const commitGrade = (r: ReceivingRow, grade: string | undefined) => {
    if (!r.unit) {
      holdQc(r.key, { grade });
      // A serial held for want of a grade is judged now, under the rule the
      // grade has just decided (owner answer 2026-09-21).
      const held = draft[r.key];
      if (grade !== undefined && held !== undefined && held.trim() !== "") {
        commitSerial(r, held, false, { grade });
      }
      return;
    }
    const serial = r.unit.serial;
    if (grade === r.unit.grade) return;
    mutate((d) => {
      const u = d.units.find((x) => x.serial === serial);
      if (!u) return;
      u.grade = grade;
      appendEvent(d, serial, {
        type: "DICATAT",
        refCode: po?.code,
        note: gradeNote(grade),
      });
    });
    /*
     * Graded New AFTER its serial was filed, so the serial was taken as a
     * second-hand one and never held to a new unit's shape. It is said, not
     * rewritten: a unit's serial is its name in the ledger, and the serial
     * box is where it is corrected.
     */
    if (grade === NEW_GRADE) {
      const asNew = readSerialInput(serial, {
        scanned: false,
        condition: "NEW",
      });
      if (!asNew.ok || asNew.serial !== serial) {
        message.warning(
          t(
            "inbound.regradeSerialCheck",
            "{{serial}} was taken in as a second-hand serial. A new unit's serial is {{min}}–{{max}} characters with no S — if this one is not, correct it in the serial box.",
            { serial, min: BASE_MIN_LENGTH, max: BASE_MAX_LENGTH },
          ),
        );
      }
    }
  };

  /**
   * The description, as phrases. On a unit the vocabulary is written in the
   * SAME mutation, so a unit is never described by a phrase the list has not
   * heard of, and "mulus" under a seeded "Mulus" does not fork it.
   */
  const commitDescription = (r: ReceivingRow, parts: readonly string[]) => {
    if (!r.unit) return holdQc(r.key, { description: parts });
    const serial = r.unit.serial;
    mutate((d) => {
      const u = d.units.find((x) => x.serial === serial);
      if (!u) return;
      u.description = joinDescription(
        parts.map((p) => ensureQcDescription(d, p)).filter(Boolean),
      );
    });
  };

  /** Which battery reading a row starts on — from its product's chip and year. */
  const batteryFallback = (r: ReceivingRow): BatteryMode =>
    defaultBatteryModeOfSku(db, actualSkuOf(r));

  /** What the battery boxes show: typing, else the unit, else the held draft. */
  const batteryShown = (r: ReceivingRow): BatteryDraft =>
    r.unit
      ? (batteryTyping[r.key] ?? batteryDraftOf(r.unit))
      : (qcDrafts[r.key]?.battery ?? {});

  /** Every keystroke: into the typing buffer, or into the row's draft. */
  const typeBattery = (r: ReceivingRow, next: BatteryDraft) => {
    if (r.unit) setBatteryTyping((m) => ({ ...m, [r.key]: next }));
    else holdQc(r.key, { battery: next });
  };

  /**
   * A box left, or Enter: written, or refused — refused rather than clamped,
   * because a number outside the range is a typo, and 100% is a claim about a
   * NEW battery that a clamp would have made on somebody's behalf.
   */
  const commitBattery = (
    r: ReceivingRow,
    field: BatteryField,
    value: number | null,
  ) => {
    const fallback = batteryFallback(r);
    const draft: BatteryDraft = { ...batteryShown(r), [field]: value };
    if (!isBatteryDraftInRange(draft, fallback)) {
      const [lo, hi] = BATTERY_FIELD_RANGE[field];
      message.error(
        t(
          "inbound.batteryRefused",
          "{{value}} is not a reading this box takes — {{lo}} to {{hi}} only.",
          { value, lo, hi },
        ),
      );
      typeBattery(r, { ...draft, [field]: null });
      return;
    }
    if (!r.unit) return;
    const serial = r.unit.serial;
    const next = batteryPatch(draft, fallback);
    setBatteryTyping((m) => without(m, r.key));
    if (
      next.batteryHealth === r.unit.batteryHealth &&
      next.cycleCount === r.unit.cycleCount &&
      next.fcc === r.unit.fcc
    ) {
      return;
    }
    mutate((d) => {
      const u = d.units.find((x) => x.serial === serial);
      if (!u) return;
      u.batteryHealth = next.batteryHealth;
      u.cycleCount = next.cycleCount;
      u.fcc = next.fcc;
    });
  };

  if (!po) {
    return (
      <PageContainer title={t("inbound.inboundOrder", "Inbound order")}>
        <Result
          status="404"
          title={t("inbound.noSuchOrder", "No such order")}
          subTitle={t(
            "inbound.itMayHaveBeenRemoved",
            "It may have been removed, or the link is wrong.",
          )}
          extra={
            <Button type="primary" onClick={() => navigate("/inbound")}>
              {t("inbound.backToInbound", "Back to Inbound")}
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const totals = poTotals(po);
  /** Where the MONEY stands (owner revision 2026-09-15). */
  const payment = poPaymentStatus(po);
  const supplier = db.suppliers.find((s) => s.id === po.supplierId);
  const arrived = po.status === "RECEIVED";
  /**
   * Filed away, and therefore read-only: the money, the rows, the serials and
   * the scanner all stop taking input together. The way back is the banner's
   * Reopen.
   */
  const closed = poClosed(po);
  /**
   * An open invoice opens READ-ONLY too (owner ask 2026-09-24).
   *
   * > *"When viewing an inbound it should be display only first, and add an
   * > 'Edit Invoice' button to edit it next to Close invoice."*
   *
   * Every field on this page writes on change rather than through a Save
   * (2026-09-15), which is right while somebody is working and wrong the other
   * ninety per cent of the time: an invoice opened to check a figure is one
   * stray keystroke from being a different invoice. So the same gate the
   * closed state already had does the work — one `locked`, everywhere that
   * used to ask `closed` — and *Edit invoice* is what lifts it.
   *
   * It is per visit, not stored: the page is opened to read far more often
   * than to change, so read-only is what it should be on arrival every time.
   * A CLOSED invoice cannot be unlocked at all; reopening it is the way in,
   * which is the whole point of closing it.
   */
  const [editing, setEditing] = useState(false);
  const locked = closed || !editing;

  const bench = serviceLocationOf(db.warehouses);
  const benchName =
    db.warehouses.find((w) => w.id === bench)?.name ?? bench ?? "";

  /** An expense's name as the page shows it: its label, else its kind. */
  const feeName = (fee: PoFee) =>
    fee.label.trim() !== ""
      ? `${t(PO_FEE_KIND_LABEL[fee.kind])} · ${fee.label}`
      : t(PO_FEE_KIND_LABEL[fee.kind]);

  /**
   * A unit that fails QC, and goes back to whoever sold it. The managed reason
   * is written FIRST, so nothing ever points at a reason Settings has not
   * heard of; the claim is opened at what the invoice says it cost, and the
   * decision can be taken back from the row.
   */
  const rejectToSupplier = (serial: string) => {
    modal.confirm({
      title: t("inbound.rejectTitle", "Return this unit to the supplier?"),
      content: t(
        "inbound.rejectBody",
        "{{serial}} will not enter inventory. Its history stays tracked either way, and you can take this back from the row afterwards.",
        { serial },
      ),
      okText: t("inbound.rejectOk", "Return to supplier"),
      onOk: () =>
        mutate((d) => {
          const u = d.units.find((x) => x.serial === serial)!;
          const reasonLabel = "Rejected at QC";
          ensureReason(d, "RETURN_SUPPLIER", reasonLabel);
          const code = docCode("SP");
          d.returns.unshift({
            id: nextId("r"),
            code,
            kind: "SUPPLIER",
            serial,
            reason: reasonLabel,
            date: new Date().toISOString().slice(0, 10),
            status: "DONE",
            fromQc: true,
            supplierId: d.pos.find((p) => p.id === u.poId)?.supplierId,
            expectedCredit: u.buy,
          });
          appendEvent(d, serial, {
            type: "RETUR_SUPPLIER",
            toStatus: "RETUR_SUPPLIER",
            // `refCode` is the return document, not the order. It is what a
            // reopen reads to know which claim to withdraw.
            refCode: code,
            note: reasonLabel,
          });
        }),
    });
  };

  /**
   * A unit that needs a repair.
   *
   * ⚠️ The location moves NOW (owner ask 2026-09-25: *"no need to mark as
   * 'received' first"*), which REVERSES the 2026-09-09 rule that a unit does
   * not arrive by being sent. The confirmation at /stock/service was what
   * wrote `Unit.locationId`, so with it gone something else has to, or the
   * bench's warehouse holds nothing and the shelf it left still counts it.
   * The status goes to SERVIS in the same breath, as it always did — a unit
   * promised to a repairer is not sellable from that moment.
   *
   * The courier fee and the "does it travel" question stay: what a journey
   * COSTS is still a fact, and it is asked for while the number is on the
   * desk. What went is only the second confirmation.
   */
  const sendToService = () => {
    const serial = sendingToService!;
    serviceForm.validateFields().then((v) => {
      const now = new Date().toISOString();
      mutate((d) => {
        const u = d.units.find((x) => x.serial === serial)!;
        const reasonLabel = "On Service";
        ensureReason(d, "ADJUSTMENT", reasonLabel);
        const travelling =
          v.ship && bench !== undefined && bench !== u.locationId;
        /*
         * ⚠️ Read BEFORE the event, which writes the projection. The visit is
         * what sends the unit back afterwards, so `fromLocationId` has to be
         * where it SET OUT from — read after, it is the bench, and *Back in
         * stock* would default to returning it to the bench it is already on.
         * `InventoryPage`'s adjustment reads its `cameFrom` the same way.
         */
        const cameFrom = u.locationId;
        appendEvent(d, serial, {
          type: "DICATAT",
          toStatus: "SERVIS",
          ...(travelling ? { toLocationId: bench } : {}),
          refCode: po.code,
          note: travelling
            ? `Sent to service — ${benchName}`
            : "Sent to service",
        });
        // The rack belongs to the warehouse it is leaving.
        if (travelling) u.rackId = undefined;
        const fees = [];
        if (travelling && (v.shippingFee ?? 0) > 0) {
          fees.push({
            id: nextId("svcf"),
            kind: "SHIPPING" as const,
            // Translated where it is WRITTEN — the string is stored and frozen
            // in whatever language the bench happened to be in.
            label: t("inbound.serviceShipLabel", "Transfer to the bench"),
            amount: v.shippingFee!,
            at: now,
            staff: currentStaffName(),
          });
        }
        if ((v.serviceFee ?? 0) > 0) {
          fees.push({
            id: nextId("svcf2"),
            kind: "LABOUR" as const,
            label: t("inbound.serviceFeeRaised", "Quoted at QC"),
            amount: v.serviceFee!,
            at: now,
            staff: currentStaffName(),
          });
        }
        d.services.push({
          id: nextId("svc"),
          serial,
          fromLocationId: cameFrom,
          openedAt: now,
          // Always. There is no arrival step to set it later (2026-09-25).
          arrivedAt: now,
          fees,
          ...(v.note ? { note: v.note } : {}),
          raisedBy: "QC",
          poId: po.id,
          staff: currentStaffName(),
        });
      });
      setSendingToService(null);
      serviceForm.resetFields();
      message.success(
        v.ship && bench
          ? t(
              "inbound.serviceSentShipping",
              "{{serial}} is now at {{bench}}.",
              { serial, bench: benchName },
            )
          : t(
              "inbound.serviceSentHere",
              "{{serial}} is at the service bench.",
              { serial },
            ),
      );
    });
  };

  /**
   * Take a QC decision back — the owner's fourth ask of 2026-08-27.
   * `QC_DIBUKA` is APPENDED; the decision that was wrong stays on the ledger.
   * A supplier return raised at QC is withdrawn with it (marked `CANCELLED`,
   * not deleted), and an open service visit is closed back to where it set
   * out from.
   */
  const reopenQc = (serial: string) => {
    const unit = getDb().units.find((u) => u.serial === serial);
    // Asked again here, not only of the button: a machine can be sold or
    // reserved in another tab between the last render and the click.
    if (!unit || !canReopenQc(unit)) return;
    const from = unitStage(unit);
    modal.confirm({
      title: t("inbound.reopenTitle", "Put this unit back into QC?"),
      content: t(
        "inbound.reopenBody",
        "{{serial}} is currently {{stage}}. Reopening leaves that on its timeline and adds a correction, so you can grade it again or make a different decision.",
        { serial, stage: t(INBOUND_STAGE_LABEL[from]).toLowerCase() },
      ),
      okText: t("inbound.reopenOk", "Reopen QC"),
      onOk: () =>
        mutate((d) => {
          // The withdrawal first, so no moment exists in which the unit is
          // back on the bench and the claim against the supplier still stands.
          let withdrawn = "";
          if (
            d.units.find((u) => u.serial === serial)?.status ===
            "RETUR_SUPPLIER"
          ) {
            const claim = d.returns.find(
              (r) =>
                r.kind === "SUPPLIER" &&
                r.serial === serial &&
                r.fromQc &&
                r.status !== "CANCELLED",
            );
            if (claim) {
              claim.status = "CANCELLED";
              withdrawn = claim.code;
            }
          }
          const visit = d.services.findIndex(
            (r) => r.serial === serial && r.closedAt === undefined,
          );
          if (visit >= 0) {
            const rec = d.services[visit]!;
            d.services[visit] = {
              ...rec,
              closedAt: new Date().toISOString(),
              toLocationId: rec.fromLocationId,
            };
          }
          appendEvent(d, serial, {
            type: "QC_DIBUKA",
            toStatus: "QC",
            refCode: po.code,
            note: withdrawn
              ? `QC reopened — ${INBOUND_STAGE_LABEL[from]} was wrong; ${withdrawn} withdrawn`
              : `QC reopened — ${INBOUND_STAGE_LABEL[from]} was wrong`,
          });
        }),
    });
  };

  /** QC passed: into sellable stock. `qcReady` is the gate, on the button. */
  const acceptUnit = async (serial: string) => {
    await mutate((d) => {
      appendEvent(d, serial, {
        type: "QC_SELESAI",
        toStatus: "TERSEDIA",
        refCode: po.code,
        note: "QC passed",
      });
    });
    message.success(
      t("inbound.qcAccepted", "{{serial}} passed QC and is in stock.", {
        serial,
      }),
    );
  };

  /*
   * ~~`removeSerial`~~ and ~~`removeFromInvoice`~~ went on 2026-09-24. They
   * were the two halves of *"delete serial → delete row"*, which the owner
   * replaced with one button: `deleteUnitRow` below.
   */

  /**
   * The supplier invoiced it and never sent it — or it did turn up after all.
   * The row stays on the invoice, because it was invoiced, and stops counting
   * towards what is owed (`poTotals`).
   */
  const toggleNotArrived = (row: ReceivingRow) =>
    editOrder(({ lineOf }) => {
      const line = lineOf(row);
      if (!line) return;
      if (line.notReceived) delete line.notReceived;
      else line.notReceived = true;
    });

  /**
   * One button, the whole row (owner ask 2026-09-24).
   *
   * > *"In unit level, the flow is no longer delete serial → delete row, but
   * > immediately delete that unit row."*
   *
   * So the unit, its events, its held QC answers AND its piece of the invoice
   * all go in one confirm, where they used to be `removeSerial` followed by
   * `removeFromInvoice` — two menu items, in an order nobody could guess, the
   * first of which left an empty row behind that looked like a bug.
   *
   * Only ever a row still in QC or still waiting. A unit that has been
   * accepted, reserved or sold is not deletable from anywhere — the invoice is
   * the only record of what it cost — which is the rule `poDeletion` already
   * holds a whole order to, and `actionsCell` never offers the button on such
   * a row.
   */
  const deleteUnitRow = (row: ReceivingRow) => {
    const serial = row.unit?.serial;
    const what =
      serial ?? t("inbound.unitN", "unit {{n}}", { n: numberOf(row) });
    modal.confirm({
      title: t("inbound.deleteUnitRowTitle", "Delete {{what}}?", { what }),
      content: serial
        ? t(
            "inbound.deleteUnitRowBodySerial",
            "The unit, its serial and everything recorded against it go, and the invoice loses the line it stood on. If the supplier billed it and never sent it, mark it Not arrived instead — that keeps it on the invoice.",
          )
        : t(
            "inbound.deleteUnitRowBody",
            "The row comes off the invoice. If the supplier billed it and never sent it, mark it Not arrived instead — that keeps it on the invoice.",
          ),
      okText: t("inbound.deleteUnitRowOk", "Delete unit"),
      okButtonProps: { danger: true },
      onOk: () => {
        editOrder(({ d, order, lineOf }) => {
          if (serial !== undefined) {
            d.units = d.units.filter((x) => x.serial !== serial);
            d.events = d.events.filter((e) => e.serial !== serial);
          }
          const line = lineOf(row);
          if (line) {
            order.items = order.items.filter((i) => i.id !== line.id);
          } else if (serial !== undefined) {
            // A unit with no line of its own — an orphan. Nothing to remove
            // from the invoice, and nothing left pointing at it either.
            for (const item of order.items) {
              if (item.serial === serial) item.serial = null;
            }
          }
        });
        forget(row.key);
      },
    });
  };

  /**
   * A machine on the order that no line accounts for, put on the invoice at
   * what it cost — the supplier sent one more than the paperwork said, and
   * the paperwork is what is corrected.
   */
  const addToInvoice = (row: ReceivingRow) => {
    const unit = row.unit;
    if (!unit) return;
    editOrder(({ order }) => {
      order.items.push({
        id: nextId("poi"),
        skuId: unit.skuId,
        serial: unit.serial,
        qty: 1,
        unitCost: unit.buy,
      });
    });
  };

  // ── Counted products: a quantity, not a row per unit (2026-09-19) ──────

  /**
   * Is this variant counted rather than identified — an accessory? Its line
   * is one quantity at one price, and it arrives on the stock ledger.
   */
  const isCounted = countedIn(db);

  /** Pieces of a counted line on the shelf because of this invoice. */
  const arrivedOf = (itemId: string) => arrivedQty(db.stockMoves, itemId);

  /** More of a counted product: its open line grows, or it gets one. */
  const addCounted = (skuId: string, qty: number, outside = false) => {
    let id = "";
    const mark = outside ? { outsideInvoice: true as const } : {};
    editOrder(({ order }) => {
      const line = order.items.find(
        (i) =>
          i.skuId === skuId &&
          !i.notReceived &&
          (i.outsideInvoice === true) === outside,
      );
      if (line) {
        line.qty += qty;
        id = line.id;
        return;
      }
      id = nextId("poi");
      order.items = insertAfterGroup(
        order.items,
        order.items.filter((i) => i.skuId === skuId),
        [{ id, skuId, serial: null, qty, unitCost: 0, ...mark }],
      );
    });
    if (id) focusSoon(lineCostFieldId(id));
  };

  /**
   * A counted product's sell price is the VARIANT's asking price — the one
   * price an accessory has, and what the till quotes for it (owner ask
   * 2026-09-24: *"make the inbound table to set the price before accepting
   * the unit into the inventory"*). Written on commit, like every other fact
   * on this page; an emptied box is "unpriced", which is what stops the
   * arrival below.
   */
  const sellPriceOfSku = (skuId: string) =>
    db.skus.find((s) => s.id === skuId)?.price ?? 0;
  const sellPriceOfLine = (l: PurchaseLine) => sellPriceOfSku(l.skuId);
  const setSellPrice = (l: PurchaseLine, value: number | null) => {
    if (l.skuId === "") return;
    mutate((d) => {
      const sku = d.skus.find((s) => s.id === l.skuId);
      if (sku) sku.price = value ?? 0;
    });
  };
  /** Can these pieces be confirmed onto the shelf — is there a sell price? */
  const countedPriced = (l: PurchaseLine) => sellPriceOfLine(l) > 0;

  /**
   * The pieces are here: one press per product (owner answer 2026-09-19 —
   * *confirm arrival first*, not per piece). Writes a `MASUK` of whatever
   * has not arrived yet into the invoice's location, and marks the order
   * arrived the way a first scan does.
   */
  const confirmArrival = (itemId: string) => {
    // Unpriced pieces stay off the shelf: the till would quote Rp 0 for them.
    const unpriced = po.items.find(
      (i) => i.id === itemId && sellPriceOfSku(i.skuId) <= 0,
    );
    if (unpriced) {
      message.warning(
        t(
          "inbound.sellPriceFirst",
          "Set the sell price before confirming the arrival.",
        ),
      );
      return;
    }
    const wasArrived = arrived;
    let added = 0;
    mutate((d) => {
      const order = d.pos.find((p) => p.id === po.id);
      const line = order?.items.find((i) => i.id === itemId);
      if (!order || !line || line.notReceived || line.skuId === "") return;
      const missing = line.qty - arrivedQty(d.stockMoves, line.id);
      if (missing <= 0) return;
      d.stockMoves.push({
        id: nextId("sm"),
        skuId: line.skuId,
        locationId: order.locationId,
        qty: missing,
        // Net of the line's own discount (2026-09-20), per piece: this is
        // what the variant's moving average is built from (`lib/stock.ts`).
        cost:
          line.unitCost -
          Math.round((line.discount ?? 0) / Math.max(1, line.qty)),
        type: "MASUK",
        at: new Date().toISOString(),
        refCode: order.code,
        poId: order.id,
        poItemId: line.id,
        staff: currentStaffName(),
      });
      order.status = "RECEIVED";
      added = missing;
    });
    if (added > 0) {
      message.success(
        t("inbound.countedArrived", "{{count}} piece(s) added to stock.", {
          count: added,
        }),
      );
    }
    noteArrival(wasArrived);
  };

  /**
   * Take a confirmation back — the count was wrong, or it was the wrong box.
   * Only what is still on the shelf can go back: a piece already sold is a
   * sale, and the invoice cannot be edited out from under it.
   */
  const undoArrival = (itemId: string) => {
    const line = po.items.find((i) => i.id === itemId);
    if (!line) return;
    const came = arrivedOf(itemId);
    const left = onHand(db.stockMoves, line.skuId, po.locationId);
    if (came <= 0) return;
    if (left < came) {
      message.error(
        t(
          "inbound.undoArrivalRefused",
          "Only {{left}} of the {{came}} are still in {{where}} — the rest have been sold or moved. Correct the stock with an adjustment instead.",
          { left, came, where: warehouseName(po.locationId) },
        ),
      );
      return;
    }
    modal.confirm({
      title: t("inbound.undoArrivalTitle", "Undo the arrival of {{count}}?", {
        count: came,
      }),
      content: t(
        "inbound.undoArrivalBody",
        "They come off the shelf and back onto the invoice as not yet arrived.",
      ),
      okText: t("inbound.undoArrivalOk", "Undo arrival"),
      cancelText: t("inbound.cancel", "Cancel"),
      onOk: () =>
        mutate((d) => {
          const order = d.pos.find((p) => p.id === po.id);
          if (!order) return;
          const now = arrivedQty(d.stockMoves, itemId);
          if (now <= 0) return;
          d.stockMoves.push({
            id: nextId("sm"),
            skuId: line.skuId,
            locationId: order.locationId,
            qty: -now,
            cost: line.unitCost,
            type: "MASUK_BATAL",
            at: new Date().toISOString(),
            refCode: order.code,
            poId: order.id,
            poItemId: itemId,
            staff: currentStaffName(),
          });
        }),
    });
  };

  const warehouseName = (id: string) =>
    db.warehouses.find((w) => w.id === id)?.name ?? id;

  // ── The invoice's lines ─────────────────────────────────────────────────

  /**
   * The lines as both inbound screens draw them: a product at a price, its
   * quantity, its discount and the units behind it (`lib/invoiceLines.ts`).
   */
  // `db` rather than its slices: `isCounted` and `arrivedOf` are made fresh
  // on every render and close over the units, the categories AND the stock
  // moves, so the store is the dependency.
  const lines = useMemo(
    () => purchaseLines(po, db.units, isCounted, arrivedOf),
    [po, db, isCounted, arrivedOf],
  );

  /**
   * A whole line's COGS: what is owed for it plus its pieces' share of the
   * invoice's expenses (owner ask 2026-09-20). A piece that has become a unit
   * reads `costBreakdown`, so a repair already booked against it counts.
   */
  const lineCogs = (l: PurchaseLine) => {
    if (l.counted) {
      // An accessory's pieces share the parcel like everything else, and
      // `poRowShares` files their share under the line's first piece.
      const share = l.lines.reduce(
        (n, i) => n + (shares.get(rowKey(i.id, 0)) ?? 0),
        0,
      );
      return l.total + share;
    }
    // A piece the supplier never sent cost nothing: it is invoiced, not owed
    // (`poTotals`), so it is out of what the line cost the shop.
    return l.units.reduce(
      (n, { row }) => (row.notArrived ? n : n + cogsOf(row).total),
      0,
    );
  };

  /**
   * A line's pieces as they stand INSIDE a mutation.
   *
   * Never by id: `editOrder` runs `normaliseLines` first, which splits an
   * invoice written as "qty 3" into three pieces with two NEW ids, so a
   * filter on the ids the last render saw would find one piece of three and
   * every quantity change would add the difference twice. A line is one
   * product at one price — that is what groups it on screen, and it is what
   * finds it here.
   */
  const piecesOf = (order: Po, l: PurchaseLine) =>
    order.items.filter(
      (i) =>
        i.skuId === l.skuId &&
        i.unitCost === l.unitCost &&
        // On one side of the invoice or the other (2026-09-24): a product the
        // supplier billed and the same product taken in unbilled are two rows,
        // and an edit to one must not reach the other.
        (i.outsideInvoice === true) === l.outsideInvoice,
    );

  /**
   * More of a product: one line of that quantity, never a row per unit
   * (owner ask 2026-09-20). The caret goes to the new line's price, which is
   * the next thing anybody types.
   */
  const addLines = (skuId: string, qty: number, outside = false) => {
    if (locked) return;
    if (isCounted(skuId)) {
      addCounted(skuId, qty, outside);
      return;
    }
    const ids: string[] = [];
    const mark = outside ? { outsideInvoice: true as const } : {};
    editOrder(({ order }) => {
      const added: PoItem[] = [];
      for (let i = 0; i < qty; i += 1) {
        const id = nextId("poi");
        ids.push(id);
        added.push({ id, skuId, serial: null, qty: 1, unitCost: 0, ...mark });
      }
      order.items = insertAfterGroup(
        order.items,
        order.items.filter(
          (i) =>
            i.skuId === skuId &&
            i.unitCost === 0 &&
            (i.outsideInvoice === true) === outside,
        ),
        added,
      );
    });
    const first = ids[0];
    if (first !== undefined) focusSoon(lineCostFieldId(first));
  };

  /**
   * A line's quantity. Up adds pieces at the line's own price — one line is
   * one price (2026-09-20) — and down takes away pieces nobody has scanned
   * yet, from the end: a scanned unit is proof the piece arrived.
   */
  const setLineQty = (l: PurchaseLine, qty: number) => {
    if (l.counted) {
      setCountedQty(l, qty);
      return;
    }
    let refused = false;
    editOrder(({ d, order }) => {
      const mine = piecesOf(order, l);
      if (qty > mine.length) {
        const added: PoItem[] = [];
        for (let i = mine.length; i < qty; i += 1) {
          added.push({
            id: nextId("poi"),
            skuId: l.skuId,
            serial: null,
            qty: 1,
            unitCost: l.unitCost,
          });
        }
        order.items = insertAfterGroup(order.items, mine, added);
      } else {
        const drop = linesToDrop(
          order,
          d.units,
          mine,
          mine.length - qty,
          countedIn(d),
        );
        if (drop === null) {
          refused = true;
          return;
        }
        const going = new Set(drop);
        order.items = order.items.filter((i) => !going.has(i.id));
      }
      spread(order, l, l.unitCost, l.discount);
    });
    if (refused) {
      message.error(
        t(
          "inbound.qtyRefused",
          "Only units without a serial can come off the invoice. Remove a scanned serial first, or mark a unit Not arrived.",
        ),
      );
    }
  };

  /** A counted line's quantity: the last piece takes the change. */
  const setCountedQty = (l: PurchaseLine, qty: number) => {
    const arrived = l.lines.reduce((n, i) => n + arrivedOf(i.id), 0);
    if (qty < arrived) {
      message.error(
        t(
          "inbound.countedQtyRefused",
          "{{count}} of these have already arrived. Undo the arrival first to invoice fewer.",
          { count: arrived },
        ),
      );
      return;
    }
    editOrder(({ order }) => {
      const mine = piecesOf(order, l);
      const last = mine[mine.length - 1];
      if (!last) return;
      const others = mine.slice(0, -1).reduce((n, i) => n + i.qty, 0);
      last.qty = Math.max(arrivedOf(last.id), qty - others, 1);
      spread(order, l, l.unitCost, l.discount);
    });
  };

  /**
   * Write a line's price and discount over its pieces, and onto the units
   * that have already been identified.
   *
   * The discount is spread with `pieceCosts`, so the rupiah add up to what
   * was negotiated and each unit's `buy` is what that machine really cost —
   * which is what every margin in the app is computed against. `Unit.buy` is
   * rewritten alongside the line and not instead of it: the two saying
   * different things is the bug this avoids.
   */
  const spread = (
    order: Po,
    l: PurchaseLine,
    unitCost: number,
    discount: number,
  ): PoItem[] => {
    const mine = piecesOf(order, l);
    if (mine.length === 0) return [];
    // A counted row is a real quantity; an identified row is one piece.
    const each = (line: PoItem) => (l.counted ? Math.max(1, line.qty) : 1);
    const pieces = mine.reduce((n, line) => n + each(line), 0);
    const share = spreadDiscount(
      Math.min(Math.max(0, discount), unitCost * pieces),
      pieces,
    );
    /*
     * By the PIECE, then summed per row. Weighting whole rows would put more
     * on one row than it is worth — a group of an accessory as "1 at 150k"
     * and "11 at 150k" is two rows, and a Rp500.000 discount cannot all sit
     * on the row of one: `PurchaseOrderItem.discount`'s CHECK refuses it.
     */
    let n = 0;
    mine.forEach((line) => {
      line.unitCost = unitCost;
      let off = 0;
      for (let i = 0; i < each(line); i += 1, n += 1) off += share[n] ?? 0;
      if (off > 0) line.discount = off;
      else delete line.discount;
    });
    return mine;
  };

  /** One price for the whole line (owner ask 2026-09-20). */
  const setLineCost = (l: PurchaseLine, value: number | null) => {
    if (value === null || value === l.unitCost) return;
    if (!isPriceInRange(value)) {
      message.error(
        t("inbound.costRefused", "{{value}} is not a cost.", { value }),
      );
      return;
    }
    editOrder(({ d, order }) => {
      const mine = spread(order, l, value, Math.min(l.discount, value * l.qty));
      writeUnitCosts(d, mine);
    });
  };

  /** Money off this line, and off nothing else. */
  const setLineDiscount = (l: PurchaseLine, value: number | null) => {
    const next = Math.max(0, value ?? 0);
    if (next === l.discount) return;
    const room = l.unitCost * l.qty;
    if (next > room) {
      message.error(
        t(
          "inbound.discountTooBig",
          "A discount cannot be more than the line is worth ({{amount}}).",
          { amount: fmtRp(room) },
        ),
      );
      return;
    }
    editOrder(({ d, order }) => {
      const mine = spread(order, l, l.unitCost, next);
      writeUnitCosts(d, mine);
    });
  };

  /** Each identified unit's `buy`, from the piece it stands on. */
  const writeUnitCosts = (d: MockDb, pieces: readonly PoItem[]) => {
    for (const line of pieces) {
      if (!line.serial) continue;
      const u = d.units.find((x) => x.serial === line.serial);
      if (u && MONEY_EDITABLE.includes(u.status)) {
        u.buy = line.unitCost - (line.discount ?? 0);
      }
    }
  };

  /**
   * Correct the product the invoice names — a typo at entry, for the whole
   * line. A unit of it still in QC follows the correction, because the
   * product is a fact about the line now (owner 2026-09-20) and a unit filed
   * under the old one would be a unit the line cannot find.
   */
  const setLineProduct = (l: PurchaseLine, to: string) => {
    const from = l.skuId;
    if (!to || to === from) return;
    const was = skuOf(from);
    const now = skuOf(to);
    /*
     * Counted and identified are different kinds of line (2026-09-19): a
     * quantity on the stock ledger, or a row per unit. A line may change kind
     * only while nothing of it has arrived — after that there are units or
     * stock moves filed under the old product that a relabel would orphan.
     */
    if (from !== "" && isCounted(from) !== isCounted(to)) {
      const started = l.lines.some(
        (i) => arrivedOf(i.id) > 0 || (i.serial !== null && i.serial !== ""),
      );
      if (started) {
        message.error(
          t(
            "inbound.kindChangeRefused",
            "Some of this product has already arrived. Undo that first, then change it to a product that is counted differently.",
          ),
        );
        return;
      }
    }
    editOrder(({ d, order }) => {
      for (const item of piecesOf(order, l)) {
        item.skuId = to;
        if (!item.serial) continue;
        const u = d.units.find((x) => x.serial === item.serial);
        if (!u || u.status !== "QC" || u.skuId !== from) continue;
        // The asking price follows the product until somebody has priced this
        // unit: still the old product's price means nobody has.
        if (u.price !== undefined && u.price === was?.price && now) {
          u.price = now.price;
        }
        u.skuId = to;
        appendEvent(d, u.serial, {
          type: "DICATAT",
          refCode: po.code,
          note: `Product corrected on the invoice: ${was?.code ?? from} → ${now?.code ?? to}`,
        });
      }
    });
  };

  /**
   * The supplier invoiced the whole line and never sent it — or it did turn
   * up after all. It stays on the invoice, because it was invoiced, and stops
   * counting towards what is owed (`poTotals`).
   */
  const toggleLineNotArrived = (l: PurchaseLine) => {
    const marking = l.notArrived === 0;
    editOrder(({ order }) => {
      for (const item of piecesOf(order, l)) {
        // A piece somebody has in their hands has arrived, whatever the paper
        // said — marking it otherwise would take a real unit off the invoice.
        if (marking && item.serial) continue;
        if (marking) item.notReceived = true;
        else delete item.notReceived;
      }
    });
  };

  /** A line that should never have been on the invoice. */
  const removeLine = (l: PurchaseLine) => {
    if (l.counted && l.received > 0) {
      message.error(
        t(
          "inbound.invoiceRemoveArrived",
          "Pieces of this product have arrived. Undo the arrival first.",
        ),
      );
      return;
    }
    return modal.confirm({
      title: t(
        "inbound.invoiceRemoveTitle",
        "Remove {{product}} from the invoice?",
        {
          product: l.skuId
            ? skuLabel(l.skuId)
            : t("inbound.noProductYet", "the unpicked lines"),
        },
      ),
      content: t(
        "inbound.invoiceRemoveBody",
        "Every unit of it comes off the invoice. If the supplier billed it but never sent it, mark the units Not arrived instead — that keeps them on the invoice.",
      ),
      okText: t("inbound.removeRowOk", "Remove from invoice"),
      okButtonProps: { danger: true },
      onOk: () =>
        editOrder(({ d, order }) => {
          const mine = piecesOf(order, l);
          if (l.counted) {
            const going = new Set(mine.map((i) => i.id));
            order.items = order.items.filter((i) => !going.has(i.id));
            return;
          }
          const drop = linesToDrop(
            order,
            d.units,
            mine,
            mine.length,
            countedIn(d),
          );
          if (drop === null) return;
          const going = new Set(drop);
          order.items = order.items.filter((i) => !going.has(i.id));
        }),
    });
  };

  /**
   * Close the invoice, or open it again. Closing warns rather than refuses:
   * an order can genuinely be finished with while it still owes money or
   * holds a machine nobody graded.
   */
  const closeInvoice = () => {
    const loose: string[] = [];
    if (totals.outstanding > 0) {
      loose.push(
        t("inbound.closeOwed", "{{amount}} is still owed on it", {
          amount: fmtRp(totals.outstanding),
        }),
      );
    }
    if (summary.waiting > 0) {
      loose.push(
        t("inbound.closeWaiting", "{{count}} unit(s) have no serial yet", {
          count: summary.waiting,
        }),
      );
    }
    if (summary.inQc > 0) {
      loose.push(
        t("inbound.closeUngraded", "{{count}} unit(s) have not left QC", {
          count: summary.inQc,
        }),
      );
    }
    modal.confirm({
      title: t("inbound.closeTitle", "Close this invoice?"),
      content: (
        <Flex vertical gap={8}>
          <span>
            {t(
              "inbound.closeBody",
              "The order becomes read-only and drops out of the shop's live work. You can reopen it at any time.",
            )}
          </span>
          {loose.length > 0 && (
            <Alert
              type="warning"
              showIcon
              description={t("inbound.closeLoose", "Note that {{what}}.", {
                what: loose.join(t("inbound.closeAnd", ", and ")),
              })}
            />
          )}
        </Flex>
      ),
      okText: t("inbound.closeOk", "Close invoice"),
      onOk: () =>
        mutate((d) => {
          d.pos.find((p) => p.id === po.id)!.closedAt =
            new Date().toISOString();
        }),
    });
  };

  const reopenInvoice = () => {
    mutate((d) => {
      delete d.pos.find((p) => p.id === po.id)!.closedAt;
    });
    message.success(
      t(
        "inbound.reopenedInvoice",
        "Invoice reopened — it takes changes again.",
      ),
    );
  };

  /** The boxes are here, before anybody has read a serial off them. */
  const markArrived = () => {
    modal.confirm({
      title: t("inbound.markThisOrderAsArrived", "Mark this order as arrived?"),
      content: t(
        "inbound.markArrivedBody",
        "{{count}} unit(s) are waiting for a serial. Scanning them marks the order arrived by itself; this only says the boxes are here.",
        { count: summary.waiting },
      ),
      okText: t("inbound.markArrived", "Mark arrived"),
      onOk: () => {
        mutate((d) => {
          d.pos.find((p) => p.id === po.id)!.status = "RECEIVED";
        });
      },
    });
  };

  /**
   * Every fact about the invoice, and every one of them editable (owner ask
   * 2026-09-15). They write on CHANGE rather than through a Save: each field
   * is one fact, and a page with a Save button is a page somebody leaves
   * without pressing it.
   */
  const setPo = (patch: (order: Po) => void) =>
    mutate((d) => {
      patch(d.pos.find((p) => p.id === po.id)!);
    });

  const header = (
    <Card>
      <Descriptions
        column={{ xs: 1, sm: 2, md: 3 }}
        // `vertical` since the fields became editable: a label beside a
        // full-width Select gives the Select about a third of the row.
        layout="vertical"
        items={[
          {
            key: "sup",
            label: t("inbound.supplier", "Supplier"),
            children: (
              <Select
                showSearch
                optionFilterProp="label"
                style={{ width: "100%" }}
                disabled={locked}
                aria-label={t("inbound.supplier", "Supplier")}
                value={supplier?.id}
                placeholder={t("inbound.pickSupplier", "Pick a supplier")}
                options={db.suppliers.map((sup) => ({
                  value: sup.id,
                  label: sup.name,
                }))}
                onChange={(v: string) =>
                  setPo((order) => {
                    order.supplierId = v;
                  })
                }
              />
            ),
          },
          {
            key: "inv",
            label: t("inbound.invoice", "Invoice"),
            children: (
              <Flex vertical gap={4}>
                <Input
                  style={{ width: "100%" }}
                  disabled={locked || po.noInvoice}
                  aria-label={t("inbound.invoice", "Invoice")}
                  placeholder={
                    po.noInvoice
                      ? t("inbound.noInvoiceIssued", "No invoice issued")
                      : t(
                          "inbound.invoiceNumber",
                          "The supplier's invoice number",
                        )
                  }
                  value={po.invoice}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPo((order) => {
                      order.invoice = v;
                    });
                  }}
                />
                {/*
                 * A checkbox that says what it means, the way the order form
                 * asks it (owner ask 2026-09-18). It was a switch reading "No
                 * invoice" whether it was on or off, so nothing on it said
                 * which state the invoice was in.
                 */}
                <Checkbox
                  disabled={locked}
                  checked={po.noInvoice === true}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setPo((order) => {
                      order.noInvoice = on || undefined;
                      if (on) order.invoice = "";
                    });
                  }}
                >
                  <Typography.Text style={{ fontSize: TYPE.sm }}>
                    {t(
                      "inboundForm.thisSupplierIssuedNoInvoice",
                      "This supplier issued no invoice",
                    )}
                  </Typography.Text>
                </Checkbox>
              </Flex>
            ),
          },
          {
            key: "d",
            label: t("inbound.ordered", "Ordered"),
            children: (
              <DatePicker
                style={{ width: "100%" }}
                disabled={locked}
                allowClear={false}
                aria-label={t("inbound.ordered", "Ordered")}
                // A named month cannot be read the American way round.
                format="DD MMM YYYY"
                value={po.date ? dayjs(po.date) : null}
                onChange={(v) => {
                  if (!v) return;
                  const day = v.format("YYYY-MM-DD");
                  setPo((order) => {
                    order.date = day;
                  });
                }}
              />
            ),
          },
          {
            key: "wh",
            label: t("inbound.warehouse", "Warehouse"),
            children: (
              <Select
                style={{ width: "100%" }}
                disabled={locked}
                aria-label={t("inbound.warehouse", "Warehouse")}
                value={po.locationId}
                options={db.warehouses.map((w) => ({
                  value: w.id,
                  label: w.name,
                }))}
                onChange={(v: string) =>
                  setPo((order) => {
                    order.locationId = v;
                  })
                }
              />
            ),
          },
          {
            key: "st",
            label: t("inbound.orderStatus", "Order status"),
            children: (
              <Select
                style={{ width: "100%" }}
                disabled={locked}
                aria-label={t("inbound.orderStatus", "Order status")}
                value={po.status}
                options={PO_STATUSES.map((code) => ({
                  value: code,
                  label: t(PO_STATUS_LABEL[code]),
                }))}
                onChange={(v: Po["status"]) => {
                  // Moving BACK from arrived while machines are already on the
                  // bench says something the rows contradict. Still allowed —
                  // a wrong answer has to be correctable — but it says so.
                  const leaving =
                    po.status === "RECEIVED" &&
                    v !== "RECEIVED" &&
                    summary.received + summary.extra > 0;
                  const apply = () =>
                    setPo((order) => {
                      order.status = v;
                    });
                  if (!leaving) return apply();
                  modal.confirm({
                    title: t(
                      "inbound.unreceiveTitle",
                      "Mark this order as not arrived?",
                    ),
                    content: t(
                      "inbound.unreceiveBodyRows",
                      "Units already received stay on the order with their serial, grade and timeline — only the order's status changes.",
                    ),
                    okText: t("inbound.unreceiveOk", "Mark not arrived"),
                    onOk: apply,
                  });
                }}
              />
            ),
          },
          {
            key: "pay",
            // Derived from the payments below, so it is not a field.
            label: t("inbound.paymentStatus", "Payment status"),
            children: (
              <Flex align="center" style={{ minHeight: 32 }}>
                <Tag color={PO_PAYMENT_STATUS_COLOR[payment]}>
                  {t(PO_PAYMENT_STATUS_LABEL[payment])}
                </Tag>
              </Flex>
            ),
          },
        ]}
      />
    </Card>
  );

  // ── The units ────────────────────────────────────────────────────────────

  /** A row's product and serial are the bench's while it waits or sits in QC. */
  const rowOpen = (r: ReceivingRow) =>
    !locked && (r.unit === null ? !r.notArrived : r.unit.status === "QC");

  /** A row's money is editable a little longer — see `MONEY_EDITABLE`. */
  const moneyOpen = (r: ReceivingRow) =>
    !locked &&
    (r.unit === null ? !r.notArrived : MONEY_EDITABLE.includes(r.unit.status));

  const serialCell = (r: ReceivingRow) => {
    // Past QC the serial is settled: it has a ledger behind it, and correcting
    // it there is a stock movement, not a retype.
    if (r.unit && r.unit.status !== "QC") {
      return (
        <Flex vertical gap={2} align="flex-start">
          <SerialLink serial={r.unit.serial} />
        </Flex>
      );
    }
    if (r.notArrived) {
      return (
        <Tag icon={<StopOutlined aria-hidden />}>
          {t("inbound.stateNotArrived", "Not arrived")}
        </Tag>
      );
    }
    /*
     * No product yet is no reason to wait (owner revision 2026-09-19): the
     * box takes the serial, and `commitSerial` holds it until the product is
     * picked. A product the shop COUNTS never has a row here at all — it is
     * a quantity (2026-09-19; see the counted card below the table).
     */
    const stored = r.unit?.serial ?? "";
    const shown = draft[r.key] ?? stored;
    const fault = serialFault[r.key];
    /** A serial in the box, held until the row has a grade (2026-09-21). */
    const waitsForGrade =
      !fault &&
      r.unit === null &&
      shown.trim() !== "" &&
      serialConditionOf(gradeShown(r)) === undefined;
    return (
      <Flex vertical gap={4}>
        <Input
          id={serialFieldId(r.key)}
          size="small"
          // Tells the scanner this box is where a scan was aimed, so a burst
          // typed into it lands natively instead of being reported as a stray.
          data-scan-target=""
          disabled={locked}
          // Generous on purpose: a second-hand serial is taken as read and
          // held to no length, and a box that stopped short would swallow the
          // end of one without a word.
          maxLength={SERIAL_FIELD_MAX_LENGTH}
          value={shown}
          // Red beats amber: a row still waiting reads as a prompt, a refused
          // serial as a mistake.
          status={
            fault
              ? "error"
              : shown.trim() === "" || waitsForGrade
                ? "warning"
                : undefined
          }
          aria-invalid={fault ? true : undefined}
          aria-errormessage={fault ? `serial-fault-${r.key}` : undefined}
          placeholder={t("inbound.scanOrType", "Scan or type the serial")}
          aria-label={t("inbound.serial", "Serial")}
          aria-required
          onChange={(e) => {
            // Capitals whatever the keyboard is doing (owner ask 2026-09-01).
            setDraft((d) => ({
              ...d,
              [r.key]: e.target.value.toUpperCase(),
            }));
            // The refusal was about the text that WAS in the box, and so was
            // the note of whether it arrived as a scan.
            if (fault) clearSerialFault(r.key);
            if (heldScan[r.key] !== undefined) {
              setHeldScan((m) => without(m, r.key));
            }
          }}
          /*
           * Enter is what a scanner sends: it records the serial and hands the
           * caret to the next row still waiting — scan, scan, scan. Claimed
           * here so the app-wide Enter does not move the caret a second time.
           */
          onPressEnter={(e) => {
            e.preventDefault();
            commitSerial(r, e.currentTarget.value, true);
          }}
          onBlur={(e) => commitSerial(r, e.target.value, false)}
        />
        {fault && (
          <Typography.Text
            type="danger"
            id={`serial-fault-${r.key}`}
            style={{ fontSize: TYPE.sm, lineHeight: 1.3 }}
          >
            {serialFaultHint(fault.fault, fault.scanned)}
          </Typography.Text>
        )}
        {waitsForGrade && (
          <Typography.Text
            type="warning"
            style={{ fontSize: TYPE.sm, lineHeight: 1.3 }}
          >
            {t("inbound.serialHintGrade", "Pick the grade to record it")}
          </Typography.Text>
        )}
      </Flex>
    );
  };

  /**
   * What the unit has cost, all in — the unit price, its share of the
   * invoice's COGS expenses, and its repairs (owner ask 2026-09-18: *"COGS,
   * which will be calculated with the expense like tax or shipping fee or
   * other expense that are divided per unit"*). A unit reads it the way every
   * margin in the app does (`costBreakdown`); a row still waiting reads its
   * own line and its share.
   */
  const cogsOf = (r: ReceivingRow) =>
    r.unit
      ? costBreakdown(r.unit, db)
      : (() => {
          const share =
            r.itemId === null
              ? 0
              : (shares.get(rowKey(r.itemId, r.piece)) ?? 0);
          return {
            buy: r.unitCost,
            shippingTax: share,
            repair: 0,
            total: r.unitCost + share,
          };
        })();

  /**
   * Nothing to show in a cell — a unit that never came, a battery-less item.
   * "None", not a dash (owner 2026-09-21); a missing AMOUNT is `fmtRp(0)`.
   */
  const none = <Typography.Text type="secondary">{fmtNone()}</Typography.Text>;

  /**
   * The battery, typed on the row (owner brief 2026-09-19). Health for Apple
   * silicon or 2021+, otherwise full charge capacity and cycle count — the
   * model decides, nobody switches it (`lib/battery.ts`). An
   * accessory has no battery, and gets no boxes.
   */
  const batteryCell = (r: ReceivingRow) => {
    if (r.notArrived) return none;
    const actual = actualSkuOf(r);
    if (actual !== "" && !tracksSerial(actual)) return none;
    if (!rowOpen(r)) {
      return r.unit ? (
        <Typography.Text>{readUnitBattery(r.unit, db).text}</Typography.Text>
      ) : (
        none
      );
    }
    return (
      <BatteryFields
        fallback={batteryFallback(r)}
        value={batteryShown(r)}
        onChange={(next) => typeBattery(r, next)}
        onCommit={(field, value) => commitBattery(r, field, value)}
        size="small"
        idPrefix={`receiving-battery-${r.key}`}
      />
    );
  };

  /**
   * Enter with nothing typed moves on to the sell price — the column after
   * the description since the popup took the owner's order (serial, grade,
   * battery, description, sell price; 2026-09-20). With something typed the
   * key is the list's — it adds the phrase — and the app's own Enter is
   * switched off on the cell so the two never both answer one key.
   */
  const onDescriptionKey = (e: KeyboardEvent<HTMLDivElement>, key: string) => {
    if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey)
      return;
    if (e.nativeEvent.isComposing) return;
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || input.value.trim() !== "")
      return;
    e.preventDefault();
    e.stopPropagation();
    focusSoon(sellFieldId(key));
  };

  /**
   * The description, as phrases picked from the shop's vocabulary or typed
   * (`MockDb.qcDescriptions`). Needed before a second-hand unit can be
   * accepted, and optional on a sealed one — `qcReady`.
   */
  const descriptionCell = (r: ReceivingRow) => {
    if (r.notArrived) return none;
    const parts = r.unit
      ? splitDescription(r.unit.description)
      : [...(qcDrafts[r.key]?.description ?? [])];
    if (!rowOpen(r)) {
      return parts.length === 0 ? (
        none
      ) : (
        <Typography.Text>{parts.join(", ")}</Typography.Text>
      );
    }
    const grade = gradeShown(r);
    const wants = needsDescription(conditionOf(grade));
    return (
      <div
        data-keyboard-nav="off"
        onKeyDownCapture={(e) => onDescriptionKey(e, r.key)}
      >
        <Select<string[]>
          id={descFieldId(r.key)}
          mode="tags"
          size="small"
          style={{ width: "100%" }}
          value={parts}
          // Amber only on a unit that exists: that is where an empty box is
          // what stands between it and the shelf.
          status={
            wants && r.unit !== null && parts.length === 0
              ? "warning"
              : undefined
          }
          placeholder={
            wants
              ? t(
                  "inbound.conditionPlaceholder",
                  "Condition, marks, what is in the box…",
                )
              : t("inbound.describeOptional", "Optional on a new unit")
          }
          aria-label={t("inbound.description", "Description")}
          aria-required={wants}
          // The comma is the separator in the column, so it is the separator
          // in the box.
          tokenSeparators={[","]}
          options={db.qcDescriptions
            .filter((d) => d.active)
            .map((d) => ({ value: d.label }))}
          filterOption={(input, opt) =>
            String(opt?.value ?? "")
              .toLowerCase()
              .includes(input.toLowerCase())
          }
          onChange={(next: string[]) => commitDescription(r, next)}
        />
      </div>
    );
  };

  /**
   * The grade, picked by hand (owner brief 2026-09-19: *"Grade (manual drop
   * down)"*) — and the condition with it: *New* is sealed stock, a letter is
   * graded second-hand, empty is second-hand not graded yet. The checklist
   * button beside it opens the category's grading checklist, which fills the
   * letter in; a sealed unit has nothing to inspect and gets no button.
   */
  const gradeCell = (r: ReceivingRow) => {
    if (r.notArrived) return none;
    const grade = gradeShown(r);
    if (!rowOpen(r)) return <GradeTag grade={grade} plain />;
    return (
      <Flex gap={2} align="center">
        <Select<string>
          id={gradeFieldId(r.key)}
          size="small"
          style={{ flex: 1, minWidth: 76 }}
          // Typed: "b" narrows the list to B, and Enter takes it.
          showSearch
          allowClear
          optionFilterProp="label"
          value={grade}
          placeholder={t("inbound.gradePlaceholder", "Grade")}
          aria-label={t("inbound.grade", "Grade")}
          options={GRADE_CHOICES.map((g) => ({
            value: g,
            label: g === NEW_GRADE ? t("inbound.gradeNew", "New") : g,
          }))}
          onChange={(v?: string) => commitGrade(r, v)}
        />
      </Flex>
    );
  };

  const sellCell = (r: ReceivingRow) => {
    if (r.notArrived) {
      return <Typography.Text type="secondary">{fmtRp(0)}</Typography.Text>;
    }
    const asking = skuOf(actualSkuOf(r))?.price ?? null;
    const stored = r.unit ? (r.unit.price ?? asking) : asking;
    const typed = prices[r.key];
    const shown = typed !== undefined ? typed : stored;
    if (!moneyOpen(r)) {
      return <Typography.Text>{fmtRp(shown)}</Typography.Text>;
    }
    return (
      <CommitMoneyInput
        id={sellFieldId(r.key)}
        label={t("inbound.sellPrice", "Sell price")}
        value={shown}
        placeholder={asking === null ? undefined : fmtRp(asking)}
        onChange={(v) => setPrices((p) => ({ ...p, [r.key]: v }))}
        onCommit={(v) => commitSellPrice(r, v)}
      />
    );
  };

  /** The row's own name, for every control on it that needs one. */
  const rowName = (r: ReceivingRow) =>
    r.unit
      ? r.unit.serial
      : t("inbound.unitN", "unit {{n}}", { n: numberOf(r) });

  /** How many photos a row holds — the unit's, or the ones held for it. */
  const photoCount = (r: ReceivingRow) =>
    r.unit
      ? qcPhotosOf(db, r.unit.serial).length
      : (qcDrafts[r.key]?.photos?.length ?? 0);

  /**
   * One of the row's decisions, as an icon with its name in a tooltip. A
   * decision is about a particular unit, so on a row with no serial yet it is
   * drawn switched off and says why — the column reads the same on every row.
   */
  const decision = (opts: {
    readonly key: string;
    readonly tip: string;
    readonly aria: string;
    readonly icon: ReactNode;
    readonly label?: string;
    readonly danger?: boolean;
    readonly primary?: boolean;
    readonly disabledWhy?: string | null;
    readonly onClick: () => void;
  }) => (
    <Tooltip key={opts.key} title={opts.disabledWhy ?? opts.tip}>
      <span>
        <Button
          size="small"
          danger={opts.danger}
          icon={opts.icon}
          disabled={!!opts.disabledWhy}
          aria-label={opts.aria}
          onClick={opts.onClick}
        >
          {opts.label}
        </Button>
      </span>
    </Tooltip>
  );

  const actionsCell = (r: ReceivingRow) => {
    const n = numberOf(r);
    const state = receivingState(r);
    const name = rowName(r);
    const more: NonNullable<MenuProps["items"]> = [];
    const onMore: Record<string, () => void> = {};
    const item = (
      key: string,
      label: string,
      icon: ReactNode,
      run: () => void,
      danger = false,
    ) => {
      more.push({ key, label, icon, danger });
      onMore[key] = run;
    };

    const shown: ReactNode[] = [];
    const needsSerial = t(
      "inbound.decisionNeedsSerial",
      "Enter the serial first",
    );
    const accept = (serial: string | null, ready: boolean) =>
      decision({
        key: "accept",
        tip: t("inbound.acceptTip", "QC passed — into sellable stock"),
        aria: t("inbound.acceptAria", "Accept {{serial}}", { serial: name }),
        icon: <CheckOutlined aria-hidden />,
        label: t("inbound.accept", "Accept"),
        disabledWhy:
          serial === null
            ? needsSerial
            : ready
              ? null
              : t(
                  "inbound.acceptNeedsDescription",
                  "Describe this unit first — a second-hand unit needs at least one phrase.",
                ),
        onClick: () => {
          if (serial === null) return;
          void acceptUnit(serial);
        },
      });
    const service = (serial: string | null) =>
      decision({
        key: "service",
        tip: t("inbound.serviceOk", "Send to service"),
        aria: t("inbound.serviceAria", "Send {{serial}} to service", {
          serial: name,
        }),
        icon: <ToolOutlined aria-hidden />,
        disabledWhy: serial === null ? needsSerial : null,
        onClick: () => serial !== null && setSendingToService(serial),
      });
    const giveBack = (serial: string | null) =>
      decision({
        key: "return",
        tip: t("inbound.rejectOk", "Return to supplier"),
        aria: t("inbound.rejectAria", "Return {{serial}} to the supplier", {
          serial: name,
        }),
        icon: <CloseCircleOutlined aria-hidden />,
        danger: true,
        disabledWhy: serial === null ? needsSerial : null,
        onClick: () => serial !== null && rejectToSupplier(serial),
      });

    /**
     * Not arrived, and delete — on the UNIT, on every row that is still open
     * (owner ask 2026-09-24: *"The delete row button, not arrived button
     * should be on unit level and not item SKU level"*).
     *
     * Both used to live on the line, where they were a decision about every
     * piece of a product at once, and the row's own delete was buried in the
     * More menu in two halves: *Remove this serial*, then *Remove from
     * invoice*. *"In unit level, the flow is no longer delete serial → delete
     * row, but immediately delete that unit row."* So there is one button and
     * it takes the whole row — `deleteUnitRow` — and it is drawn, not hidden.
     */
    const notArrived = (r2: ReceivingRow) =>
      decision({
        key: "not-arrived",
        tip: t("inbound.markNotArrived", "Not arrived"),
        aria: t("inbound.notArrivedAria", "Unit {{n}} did not arrive", { n }),
        icon: <InboxSlashOutlined aria-hidden />,
        onClick: () => void toggleNotArrived(r2),
      });
    const deleteRow = (r2: ReceivingRow) =>
      decision({
        key: "delete-row",
        tip: t("inbound.deleteUnitRow", "Delete this unit"),
        aria: t("inbound.deleteUnitRowAria", "Delete unit {{n}}", { n }),
        icon: <DeleteOutlined aria-hidden />,
        danger: true,
        onClick: () => deleteUnitRow(r2),
      });

    if (!locked) {
      if (state === "WAITING" || state === "NO_PRODUCT") {
        shown.push(accept(null, false), service(null), giveBack(null));
        if (r.itemId !== null) shown.push(notArrived(r), deleteRow(r));
      } else if (state === "NOT_ARRIVED") {
        shown.push(
          <Button
            key="arrived"
            size="small"
            icon={<UndoOutlined aria-hidden />}
            aria-label={t(
              "inbound.arrivedAfterAllAria",
              "Unit {{n}} arrived after all",
              { n },
            )}
            onClick={() => void toggleNotArrived(r)}
          >
            {t("inbound.arrivedAfterAll", "It arrived")}
          </Button>,
          deleteRow(r),
        );
      } else if (state === "IN_QC") {
        const serial = r.unit!.serial;
        shown.push(
          accept(serial, qcReady(r.unit!)),
          service(serial),
          giveBack(serial),
        );
        if (r.itemId !== null) shown.push(notArrived(r));
        shown.push(deleteRow(r));
      } else if (r.unit) {
        // Decided. Service and a return are said on the row, because they are
        // why the row stopped taking input; an accepted unit says so quietly.
        if (r.unit.status === "SERVIS" || r.unit.status === "RETUR_SUPPLIER") {
          shown.push(
            <EnumTag key="st" map={UNIT_STATUS} value={r.unit.status} />,
          );
        } else {
          shown.push(
            <Typography.Text
              key="ok"
              type="success"
              style={{ fontSize: TYPE.sm }}
            >
              <CheckCircleFilled aria-hidden />{" "}
              {t("inbound.acceptedShort", "Accepted")}
            </Typography.Text>,
          );
        }
        const serial = r.unit.serial;
        if (canReopenQc(r.unit)) {
          item(
            "reopen",
            t("inbound.reopenQc", "Reopen QC"),
            <UndoOutlined aria-hidden />,
            () => reopenQc(serial),
          );
        }
      }
      if (r.orphan && r.unit) {
        item(
          "add-to-invoice",
          t("inbound.addToInvoice", "Add to the invoice"),
          <FileAddOutlined aria-hidden />,
          () => addToInvoice(r),
        );
      }
    } else if (
      r.unit &&
      (r.unit.status === "SERVIS" || r.unit.status === "RETUR_SUPPLIER")
    ) {
      shown.push(<EnumTag key="st" map={UNIT_STATUS} value={r.unit.status} />);
    }

    const photos = photoCount(r);
    return (
      <Flex gap={SPACE.xs} justify="end" align="center">
        {shown}
        {!r.notArrived && (rowOpen(r) || photos > 0) && (
          <Tooltip title={t("inbound.photosTip", "Photos")}>
            <Button
              size="small"
              type="text"
              icon={<CameraOutlined aria-hidden />}
              aria-label={t("inbound.photosAria", "Photos of {{name}}", {
                name,
              })}
              onClick={() => setPhotosRow(r.key)}
            >
              {photos > 0 ? photos : null}
            </Button>
          </Tooltip>
        )}
        {more.length > 0 && (
          <Dropdown
            trigger={["click"]}
            menu={{ items: more, onClick: ({ key }) => onMore[key]?.() }}
          >
            <Button
              size="small"
              type="text"
              icon={<MoreOutlined aria-hidden />}
              aria-label={t("inbound.moreAria", "More for {{name}}", {
                name,
              })}
            />
          </Dropdown>
        )}
      </Flex>
    );
  };

  /**
   * The units behind one line, as the shared popup draws them (owner ask
   * 2026-09-20). Each cell is the one the bench had on the grid before this
   * revision — the scanner still aims at the serial box, a refusal is still
   * outlined in red, and the row's decisions still sit on the right.
   */
  const openLine = lines.find((l) => l.key === detailsKey);
  const detailsModal = openLine !== undefined && (
    <UnitDetailsModal<{ key: string; n: number; row: ReceivingRow }>
      open
      onClose={() => setDetailsKey(null)}
      product={
        openLine.skuId === ""
          ? t("inbound.noProductYet", "the unpicked lines")
          : `${skuCode(openLine.skuId)} — ${skuLabel(openLine.skuId)}`
      }
      subtitle={t(
        "inbound.detailsSubtitle",
        "{{count}} unit(s) · {{price}} each · {{cogs}} COGS for the line",
        {
          count: openLine.qty,
          price: fmtRp(openLine.unitCost),
          cogs: fmtRp(lineCogs(openLine)),
        },
      )}
      rows={openLine.units.map(({ row, n }) => ({ key: row.key, n, row }))}
      {...(locked
        ? {}
        : {
            /*
             * The quantity follows the serials (owner ask 2026-09-20). The
             * LINE grows, at the line's own price — `addLines` would make a
             * second, unpriced line of the same product, which is a second
             * row on screen and not what "one more of these" means.
             */
            onAddUnit: () => setLineQty(openLine, openLine.qty + 1),
          })}
      serial={({ row }) => serialCell(row)}
      grade={({ row }) => gradeCell(row)}
      battery={({ row }) => batteryCell(row)}
      description={({ row }) => descriptionCell(row)}
      sellPrice={({ row }) => sellCell(row)}
      actions={({ row }) => actionsCell(row)}
    />
  );

  /**
   * Units on the invoice that no line accounts for — the supplier sent one
   * more than the paperwork said, or a line was removed under a unit. They
   * have no line to hide behind, so they keep a table of their own.
   */
  const orphans = rows.filter((r) => r.orphan);
  const orphanCard = orphans.length > 0 && (
    <Flex vertical gap={SPACE.xs}>
      <Typography.Text strong>
        {t("inbound.notOnInvoice", "Not on the invoice")}
      </Typography.Text>
      <EditableTable<ReceivingRow>
        size="small"
        rowKey="key"
        className="qc-table receiving-table"
        rowClassName={() => "row-over-quota"}
        dataSource={orphans}
        rowTitle={(r) => r.unit?.serial ?? ""}
        columns={[
          {
            title: t("inbound.unitCol", "Unit"),
            key: "product",
            width: 220,
            render: (_: unknown, r: ReceivingRow) => (
              <Flex vertical>
                <Typography.Text>{skuCode(actualSkuOf(r))}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                  {skuLabel(actualSkuOf(r))}
                </Typography.Text>
              </Flex>
            ),
          },
          {
            title: t("inbound.serial", "Serial"),
            key: "serial",
            width: COLUMN.serial,
            render: (_: unknown, r: ReceivingRow) => serialCell(r),
          },
          {
            title: t("inbound.grade", "Grade"),
            key: "grade",
            width: COLUMN.grade,
            render: (_: unknown, r: ReceivingRow) => gradeCell(r),
          },
          {
            title: t("inbound.battery", "Battery Health"),
            key: "battery",
            width: 230,
            render: (_: unknown, r: ReceivingRow) => batteryCell(r),
          },
          {
            title: t("inbound.description", "Description"),
            key: "description",
            width: 240,
            render: (_: unknown, r: ReceivingRow) => descriptionCell(r),
          },
          {
            title: t("inbound.sellPrice", "Sell price"),
            key: "sell",
            width: COLUMN.money,
            render: (_: unknown, r: ReceivingRow) => sellCell(r),
          },
          {
            title: "",
            key: "actions",
            width: COLUMN.actions,
            align: "right" as const,
            render: (_: unknown, r: ReceivingRow) => actionsCell(r),
          },
        ]}
      />
    </Flex>
  );

  /** A counted line's arrival, which is the one thing it has instead of units. */
  const countedActions = (l: PurchaseLine) => {
    if (!l.counted || locked || l.notArrived > 0) return null;
    const missing = l.qty - l.received;
    // Every row of the group, not just its first: a line imported as two rows
    // of one product at one price is one row on screen and two on the ledger.
    const owing = l.lines.filter((i) => arrivedOf(i.id) < i.qty);
    const came = l.lines.filter((i) => arrivedOf(i.id) > 0);
    return (
      <>
        {missing > 0 && owing.length > 0 && (
          <Tooltip
            title={
              countedPriced(l)
                ? undefined
                : t(
                    "inbound.sellPriceFirst",
                    "Set the sell price before confirming the arrival.",
                  )
            }
          >
            <span>
              <Button
                size="small"
                type="primary"
                disabled={!countedPriced(l)}
                icon={<CheckOutlined aria-hidden />}
                onClick={() => owing.forEach((i) => confirmArrival(i.id))}
                aria-label={t(
                  "inbound.confirmArrivalAria",
                  "Confirm {{count}} {{product}} arrived",
                  { count: missing, product: skuLabel(l.skuId) },
                )}
              >
                {t("inbound.confirmArrival", "Confirm arrived ({{count}})", {
                  count: missing,
                })}
              </Button>
            </span>
          </Tooltip>
        )}
        {came.length > 0 && (
          <Button
            size="small"
            icon={<UndoOutlined aria-hidden />}
            onClick={() => came.forEach((i) => undoArrival(i.id))}
          >
            {t("inbound.undoArrival", "Undo arrival")}
          </Button>
        )}
      </>
    );
  };

  const unitsCard = (
    <Card
      title={t("inbound.unitsSection", "Units")}
      extra={
        <Flex gap={8} wrap justify="end">
          {!locked && !arrived && summary.waiting > 0 && (
            <Button
              type="primary"
              icon={<InboxOutlined aria-hidden />}
              onClick={markArrived}
            >
              {t("inbound.markArrived", "Mark arrived")}
            </Button>
          )}
          {/*
           * Accept everything that is ready (owner ask 2026-09-01) — pressing
           * each unit's Accept N times, not a different decision: same gate,
           * same event. Disabled rather than hidden when none is ready.
           */}
          {!locked && units.length > 0 && (
            <Tooltip
              title={
                readyToAccept.length === 0
                  ? t(
                      "inbound.acceptAllNoneReady",
                      "Nothing is ready yet. A second-hand unit needs a description before it can be accepted.",
                    )
                  : t(
                      "inbound.acceptAllHint",
                      "Move every graded unit on this invoice into sellable stock",
                    )
              }
            >
              <span>
                <Button
                  type="primary"
                  icon={<CheckOutlined aria-hidden />}
                  disabled={readyToAccept.length === 0}
                  onClick={acceptAll}
                >
                  {t("inbound.acceptAll", "Accept all ({{count}})", {
                    count: readyToAccept.length,
                  })}
                </Button>
              </span>
            </Tooltip>
          )}
          {units.length > 0 && (
            <Button
              type="primary"
              icon={<PrinterOutlined aria-hidden />}
              onClick={() => setPrinting(labelsFor(units, db.skus, db.models))}
            >
              {t("inbound.printLabels", "Print labels")}
            </Button>
          )}
        </Flex>
      }
    >
      <Flex vertical gap={SPACE.md}>
        <PurchaseLinesTable
          lines={lines}
          skus={db.skus}
          closed={locked}
          cogsOf={lineCogs}
          onSetProduct={setLineProduct}
          onSetQty={setLineQty}
          onSetCost={setLineCost}
          onSetDiscount={setLineDiscount}
          onOpenDetails={(l) => setDetailsKey(l.key)}
          sellPriceOf={sellPriceOfLine}
          onSetSellPrice={setSellPrice}
          emptyText={
            <>
              {t("inbound.noUnitsYet", "Nothing on this invoice yet.")}
              <br />
              <Typography.Text type="secondary">
                {t(
                  "inbound.noUnitsYetAdd2",
                  "Add the products the supplier billed below — a line each, with its own price.",
                )}
              </Typography.Text>
            </>
          }
          /*
           * Not arrived and Delete moved to the UNIT on 2026-09-24. They stay
           * on the LINE for a counted product, which has no units to put them
           * on: an accessory line IS the quantity, so the line is the only
           * level at which anybody can say a box of chargers never came.
           */
          // Only while a counted line can be acted on: a column of nothing
          // on every other invoice was width the row could not spare
          // (2026-09-28).
          actionsWidth={COLUMN.actionsWide}
          actions={
            locked || !lines.some((l) => l.counted)
              ? undefined
              : (l) =>
                  !l.counted ? null : (
                    <>
                      {countedActions(l)}
                      <Tooltip
                        title={
                          l.notArrived > 0
                            ? t("inbound.arrivedAfterAll", "It arrived")
                            : t("inbound.markNotArrived", "Not arrived")
                        }
                      >
                        <Button
                          size="small"
                          type="text"
                          icon={
                            l.notArrived > 0 ? (
                              <UndoOutlined aria-hidden />
                            ) : (
                              <InboxSlashOutlined aria-hidden />
                            )
                          }
                          aria-label={
                            l.notArrived > 0
                              ? t(
                                  "inbound.lineArrivedAria",
                                  "{{product}} arrived after all",
                                  { product: skuLabel(l.skuId) },
                                )
                              : t(
                                  "inbound.lineNotArrivedAria",
                                  "{{product}} did not arrive",
                                  { product: skuLabel(l.skuId) },
                                )
                          }
                          onClick={() => toggleLineNotArrived(l)}
                        />
                      </Tooltip>
                      <Tooltip
                        title={t(
                          "inbound.invoiceRemove",
                          "Remove from the invoice",
                        )}
                      >
                        <Button
                          size="small"
                          type="text"
                          danger
                          icon={<DeleteOutlined aria-hidden />}
                          aria-label={t(
                            "inbound.invoiceRemoveAria",
                            "Remove {{product}}",
                            { product: skuLabel(l.skuId) },
                          )}
                          onClick={() => removeLine(l)}
                        />
                      </Tooltip>
                    </>
                  )
          }
        />
        {/* What did not go to plan, product by product (owner ask
            2026-09-24). Nothing when the delivery matched the paper. */}
        <InvoiceExceptions lines={lines} skus={db.skus} />
        {orphanCard}
        {/*
         * A product added from here is a line on the invoice (owner ask
         * 2026-09-19, kept), of a quantity — never a row per unit.
         */}
        {!locked && (
          <AddLineBar
            skus={db.skus}
            onAdd={addLines}
            outsideInvoice
            ariaLabel={t(
              "inbound.addUnitProductAria",
              "Product to add to the units",
            )}
            qtyAriaLabel={t("inbound.addUnitQtyAria", "How many units to add")}
            hint={t(
              "inbound.addLineHint",
              "One line per product at one price. Two units of the same product that cost different money are two lines.",
            )}
          />
        )}
      </Flex>
    </Card>
  );

  // ── Payment ──────────────────────────────────────────────────────────────

  /** What a standing says under its figure — nothing when there is nothing. */
  const standingNote = (s: Standing) =>
    s.paid > 0 && s.owed === 0 ? (
      <Typography.Text type="success" style={{ fontSize: TYPE.sm }}>
        {t("inbound.bucketSettled", "settled")}
      </Typography.Text>
    ) : s.paid > 0 ? (
      <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
        {t("inbound.bucketPartly", "{{paid}} paid, {{owed}} still owed", {
          paid: fmtRp(s.paid),
          owed: fmtRp(s.owed),
        })}
      </Typography.Text>
    ) : null;

  /** One expense: what it is, whether it is in COGS, whether it is paid. */
  const expenseLine = (s: (typeof totals.feeStandings)[number]) => (
    <Flex key={s.fee.id} justify="space-between" align="flex-start" gap={16}>
      <Flex vertical gap={2} style={{ minWidth: 0 }}>
        <Typography.Text>{feeName(s.fee)}</Typography.Text>
        <Flex gap={4} wrap>
          <Tag
            color={s.fee.inCogs ? "blue" : undefined}
            style={{ marginInlineEnd: 0 }}
          >
            {s.fee.inCogs
              ? t("inbound.inCogsTag", "In COGS")
              : t("inbound.notInCogsTag", "Not in COGS")}
          </Tag>
          <Tag
            color={s.owed === 0 ? "green" : s.paid > 0 ? "gold" : "red"}
            style={{ marginInlineEnd: 0 }}
          >
            {s.owed === 0
              ? t("inbound.expensePaidTag", "Paid")
              : s.paid > 0
                ? t("inbound.expensePartlyTag", "Partly paid")
                : t("inbound.expenseUnpaidTag", "Unpaid")}
          </Tag>
        </Flex>
      </Flex>
      <Flex align="center" gap={4}>
        <Typography.Text style={{ whiteSpace: "nowrap" }}>
          {fmtRp(s.due)}
        </Typography.Text>
        {!locked && (
          <Button
            size="small"
            type="text"
            icon={<EditOutlined aria-hidden />}
            aria-label={t("inbound.editExpenseAria", "Edit {{expense}}", {
              expense: feeName(s.fee),
            })}
            onClick={() => setExpense(s.fee.id)}
          />
        )}
      </Flex>
    </Flex>
  );

  /** What a payment settled, as the table says it. */
  const appliedToText = (p: PoPayment) => {
    if (p.feeId !== undefined) {
      const fee = po.fees.find((f) => f.id === p.feeId);
      if (fee) return feeName(fee);
    }
    return t(PO_PAYMENT_FOR_LABEL[paymentFor(p)]);
  };

  const money = (
    <Card
      // "Purchase", matching the order form's review step (owner decision
      // 2026-08-26).
      title={t("inbound.purchase", "Purchase")}
      extra={
        <Flex gap={8} wrap justify="end">
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden />}
            disabled={locked}
            onClick={() => setExpense("new")}
          >
            {t("inbound.addExpense", "Add expense")}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden />}
            disabled={locked}
            onClick={() => {
              setPaying({});
              setPayMethod("TUNAI");
              setPayAmount(undefined);
              setPayTarget("ORDER");
              setPayInBalance(true);
            }}
          >
            {t("inbound.recordPayment", "Record payment")}
          </Button>
        </Flex>
      }
    >
      <Flex gap={32} wrap align="flex-start">
        <Flex vertical gap={10} style={{ minWidth: 300, flex: "1 1 300px" }}>
          <Flex vertical>
            <Flex justify="space-between" gap={16}>
              <span>{t("inbound.productsTotal", "Products")}</span>
              <span>{fmtRp(totals.subtotal)}</span>
            </Flex>
            {/* A discount is negotiated off the GOODS. */}
            {po.discount > 0 && (
              <Flex justify="space-between" gap={16}>
                <Typography.Text type="secondary">
                  {t("inbound.discount", "Discount")}
                </Typography.Text>
                <Typography.Text type="secondary">
                  −{fmtRp(po.discount)}
                </Typography.Text>
              </Flex>
            )}
            <Flex justify="flex-end">{standingNote(totals.goods)}</Flex>
          </Flex>
          {/*
           * What else is owed because of this delivery (owner ask 2026-09-18).
           * Each says whether it is in the machines' cost and whether it is
           * paid; the pencil corrects it, and the dialog can mark it paid.
           */}
          <Flex vertical gap={8}>
            <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
              {t("inbound.expenses", "Expenses")}
            </Typography.Text>
            {totals.feeStandings.length === 0 ? (
              <Typography.Text type="secondary">
                {t(
                  "inbound.noExpenses",
                  "No expenses — add shipping, tax or anything else owed for this delivery.",
                )}
              </Typography.Text>
            ) : (
              totals.feeStandings.map(expenseLine)
            )}
          </Flex>
          <Flex justify="space-between" style={{ fontWeight: 600 }}>
            <span>{t("inbound.invoiced", "Invoiced")}</span>
            <span>{fmtRp(totals.total)}</span>
          </Flex>
          <Flex justify="space-between">
            <span>{t("inbound.paid", "Paid")}</span>
            <span>{fmtRp(totals.paid)}</span>
          </Flex>
          {totals.outstanding > 0 && (
            <Flex justify="space-between">
              <Typography.Text type="danger">
                {t("inbound.stillOwed", "Still owed")}
              </Typography.Text>
              <Typography.Text type="danger" strong>
                {fmtRp(totals.outstanding)}
              </Typography.Text>
            </Flex>
          )}
          {totals.total === 0 && totals.paid > 0 && (
            <Typography.Text type="secondary">
              {t(
                "inbound.paidBeforeTheProductsWere",
                "Paid before the products were known — nothing invoiced yet.",
              )}
            </Typography.Text>
          )}
        </Flex>

        <Table
          size="small"
          rowKey="id"
          style={{ flex: "1 1 320px", minWidth: 280 }}
          dataSource={po.payments}
          pagination={false}
          locale={{
            emptyText: t("inbound.noPaymentsRecorded", "No payments recorded."),
          }}
          columns={[
            {
              title: t("inbound.method", "Method"),
              dataIndex: "method",
              render: (code: string) =>
                db.paymentMethods.find((m) => m.code === code)?.label ?? code,
            },
            {
              title: t("inbound.appliedTo", "Applied to"),
              key: "for",
              render: (_, p) => appliedToText(p),
            },
            {
              title: t("inbound.when", "When"),
              dataIndex: "at",
              render: (v: string) => fmtDate(v),
            },
            {
              title: t("inbound.amount", "Amount"),
              dataIndex: "amount",
              align: "right",
              render: (v: number) => fmtRp(v),
            },
            {
              /*
               * Correct one, or take it back (owner ask 2026-09-15). A payment
               * funded out of a supplier DEPOSIT is an allocation, and
               * unpicking it has to give the money back to the deposit — the
               * Suppliers page's job — so those rows say so.
               */
              title: "",
              key: "actions",
              width: COLUMN.actions,
              render: (_, p) => {
                const fromDeposit = p.fromDepositId !== undefined;
                return (
                  <Flex gap={4} justify="end">
                    <Tooltip
                      title={
                        fromDeposit
                          ? t(
                              "inbound.depositPaymentLocked",
                              "Paid out of a deposit — correct it on the supplier's account, so the money goes back to the deposit.",
                            )
                          : t("inbound.editPayment", "Edit this payment")
                      }
                    >
                      <Button
                        size="small"
                        type="text"
                        disabled={locked || fromDeposit}
                        aria-label={t(
                          "inbound.editPaymentAria",
                          "Edit the payment of {{amount}}",
                          { amount: fmtRp(p.amount) },
                        )}
                        icon={<EditOutlined />}
                        onClick={() => {
                          setPaying({ id: p.id });
                          setPayMethod(p.method);
                          setPayAmount(p.amount);
                          setPayTarget(targetOf(p));
                          setPayInBalance(p.inBalance !== false);
                        }}
                      />
                    </Tooltip>
                    <Tooltip
                      title={
                        fromDeposit
                          ? t(
                              "inbound.depositPaymentLocked",
                              "Paid out of a deposit — correct it on the supplier's account, so the money goes back to the deposit.",
                            )
                          : t("inbound.deletePayment", "Delete this payment")
                      }
                    >
                      <Button
                        size="small"
                        type="text"
                        danger
                        disabled={locked || fromDeposit}
                        aria-label={t(
                          "inbound.deletePaymentAria",
                          "Delete the payment of {{amount}}",
                          { amount: fmtRp(p.amount) },
                        )}
                        icon={<DeleteOutlined />}
                        onClick={() =>
                          modal.confirm({
                            title: t(
                              "inbound.deletePaymentTitle",
                              "Delete this payment?",
                            ),
                            content: t(
                              "inbound.deletePaymentBody",
                              "{{amount}} against {{what}} stops counting towards this invoice, and the balance goes back up by that much. Record it again if it really was paid.",
                              {
                                amount: fmtRp(p.amount),
                                what: appliedToText(p).toLowerCase(),
                              },
                            ),
                            okText: t("inbound.delete", "Delete"),
                            okButtonProps: { danger: true },
                            onOk: () => {
                              mutate((d) => {
                                const order = d.pos.find(
                                  (x) => x.id === po.id,
                                )!;
                                order.payments = order.payments.filter(
                                  (x) => x.id !== p.id,
                                );
                              });
                              message.success(
                                t("inbound.paymentDeleted", "Payment deleted."),
                              );
                            },
                          })
                        }
                      />
                    </Tooltip>
                  </Flex>
                );
              },
            },
          ]}
        />
      </Flex>
    </Card>
  );

  /**
   * What the payment dialog can settle: the goods and every expense, each
   * with what is still owed on it — the number is the reason anybody picks
   * one. A payment recorded before expenses had names keeps its bucket as an
   * option while it is the one being corrected.
   */
  const editingPayment = paying?.id
    ? po.payments.find((p) => p.id === paying.id)
    : undefined;
  const owedText = (owed: number) =>
    owed > 0
      ? t("inbound.owedShort", "{{amount}} owed", { amount: fmtRp(owed) })
      : t("inbound.bucketSettled", "settled");
  const payOptions: { value: PayTarget; label: string }[] = [
    {
      value: "ORDER",
      label: `${t("inbound.productsTotal", "Products")} — ${owedText(totals.goods.owed)}`,
    },
    ...totals.feeStandings.map((s) => ({
      value: `fee:${s.fee.id}` as PayTarget,
      label: `${feeName(s.fee)} — ${owedText(s.owed)}`,
    })),
    ...(editingPayment &&
    editingPayment.feeId === undefined &&
    paymentFor(editingPayment) !== "ORDER"
      ? [
          {
            value: paymentFor(editingPayment) as PayTarget,
            label: t(PO_PAYMENT_FOR_LABEL[paymentFor(editingPayment)]),
          },
        ]
      : []),
  ];
  /** What the selected target still owes — what the quick-fill offers. */
  const owedForTarget = payTarget.startsWith("fee:")
    ? (totals.feeStandings.find((s) => `fee:${s.fee.id}` === payTarget)?.owed ??
      0)
    : payTarget === "ORDER"
      ? totals.goods.owed
      : 0;

  const recordPayment = () => {
    if (!payAmount || payAmount <= 0) {
      message.error(t("inbound.enterHowMuch", "Enter how much was paid."));
      return;
    }
    // Money the shop cannot say the movement of lands in neither the cash
    // pot nor the bank one (`lib/accounts.ts`).
    if (!payMethod) {
      message.error(
        t(
          "inbound.pickAMethod",
          "Say how the money moved before recording it.",
        ),
      );
      return;
    }
    const target = payTarget;
    const feeId = target.startsWith("fee:") ? target.slice(4) : undefined;
    const fee = feeId ? po.fees.find((f) => f.id === feeId) : undefined;
    const appliedTo: PoPaymentFor = fee
      ? payTargetOfFee(fee.kind)
      : (target as PoPaymentFor);
    const method = payMethod;
    const amount = payAmount;
    const editingId = paying?.id;
    const inBalance = payInBalance;
    mutate((d) => {
      const order = d.pos.find((p) => p.id === po.id)!;
      if (editingId === undefined) {
        order.payments.push({
          id: nextId("pp"),
          method,
          amount,
          at: new Date().toISOString(),
          appliedTo,
          ...(fee ? { feeId: fee.id } : {}),
          ...(inBalance ? {} : { inBalance: false }),
        });
        return;
      }
      const row = order.payments.find((x) => x.id === editingId);
      if (row === undefined) return;
      // `at` is left alone: it is when the money MOVED.
      row.method = method;
      row.amount = amount;
      row.appliedTo = appliedTo;
      if (fee) row.feeId = fee.id;
      else delete row.feeId;
      if (inBalance) delete row.inBalance;
      else row.inBalance = false;
    });
    setPayAmount(undefined);
    setPaying(null);
    message.success(
      editingId
        ? t("inbound.paymentUpdated", "Payment updated.")
        : t(
            "inbound.paymentRecordedFor",
            "Payment recorded against {{what}}.",
            {
              what: (fee
                ? feeName(fee)
                : t(PO_PAYMENT_FOR_LABEL[appliedTo])
              ).toLowerCase(),
            },
          ),
    );
    offerToClose();
  };

  /**
   * The invoice has just been paid off — ask whether to close it (owner ask
   * 2026-09-24: *"When the user add payment and the inbound is fully paid, add
   * popup modal to ask the user to close the invoice or not"*).
   *
   * Asked, not done: an invoice can be settled and still have a unit waiting
   * for a serial, and closing it would lock the bench out of the work it is
   * halfway through. Read from the STORE rather than from `totals`, which is
   * the render before this payment.
   */
  const offerToClose = () => {
    const after = getDb().pos.find((p) => p.id === po.id);
    if (!after || poClosed(after) || !poTotals(after).fullyPaid) return;
    modal.confirm({
      title: t("inbound.paidInFullTitle", "This invoice is paid in full"),
      content: t(
        "inbound.paidInFullBody",
        "Close it now? A closed invoice is read-only — its units, its lines and its money all stop taking changes. You can reopen it at any time.",
      ),
      okText: t("inbound.closeOk", "Close invoice"),
      cancelText: t("inbound.keepOpen", "Leave it open"),
      onOk: () =>
        mutate((d) => {
          d.pos.find((p) => p.id === po.id)!.closedAt =
            new Date().toISOString();
        }),
    });
  };

  const photosRowData = photosRow
    ? rows.find((r) => r.key === photosRow)
    : undefined;

  return (
    <PageContainer
      title={po.code}
      backTo="/inbound"
      /*
       * While the invoice is unlocked the code and its two decisions stay on
       * screen (owner ask 2026-09-25): Serials & QC is a long grid, and the
       * bench works down it — the moment *Save invoice* scrolls away is the
       * moment somebody leaves the page open and editable behind them.
       */
      stickyHeader={editing}
      banner={
        editing ? (
          <Alert
            type="warning"
            showIcon
            title={t("inbound.editingBanner", "You're editing this invoice")}
          />
        ) : undefined
      }
      actions={
        closed
          ? undefined
          : [
              /*
               * Edit invoice, beside Close invoice (owner ask 2026-09-24).
               * The page arrives read-only; this is the one thing on it that
               * is not, and pressing it again puts the page back — nothing is
               * saved by leaving edit, because every field writes on change.
               */
              {
                key: "edit",
                // "Save invoice" is the owner's word for it (2026-09-25).
                // Nothing is saved BY it — every field on the page writes on
                // change — but the button that ends an edit is the one staff
                // look for to save, and calling it anything else is a page
                // people leave unlocked.
                label: editing
                  ? t("inbound.saveInvoice", "Save invoice")
                  : t("inbound.editInvoice", "Edit invoice"),
                icon: editing ? <CheckOutlined /> : <EditOutlined />,
                // The page's one call to action, so it is the green one and
                // *Close invoice* beside it is not (owner ask 2026-09-25).
                type: "primary",
                onClick: () => setEditing((v) => !v),
              },
              {
                key: "close",
                label: t("inbound.closeInvoice", "Close invoice"),
                icon: <LockOutlined />,
                onClick: closeInvoice,
              },
            ]
      }
    >
      <Flex vertical gap={16}>
        {closed && (
          /*
           * The banner IS the way back, and it is deliberately one click: a
           * closed order that took three steps to reopen would be an order
           * staff work around by raising a second one.
           */
          <Alert
            type="info"
            showIcon
            title={t("inbound.closedTitle", "This invoice is closed")}
            description={t(
              "inbound.closedBody",
              "Closed {{when}}. Nothing on the order can be changed — reopen it to record a payment, edit a line or grade a unit.",
              { when: fmtDate(po.closedAt!) },
            )}
            action={
              <Button
                size="small"
                icon={<UnlockOutlined />}
                onClick={reopenInvoice}
              >
                {t("inbound.reopenInvoice", "Reopen")}
              </Button>
            }
          />
        )}
        {/*
         * No banner while the page is merely read-only (owner ask
         * 2026-09-25). *Edit invoice* is in the header, beside *Close
         * invoice*, which is where the page's other decisions are and where
         * somebody looks for one; a paragraph under the title saying the page
         * is a page was a line to scroll past on every visit. A CLOSED
         * invoice still gets its banner above — that one reports a state
         * somebody chose and has to undo, and so, since later the same day,
         * does an invoice being EDITED: that one is `banner` on the header,
         * pinned with the code and the two buttons rather than left here to
         * scroll away.
         */}
        {header}
        {unitsCard}
        {money}
      </Flex>

      {detailsModal}

      {/*
       * A row's photos. Before the serial they are held against the row and
       * written onto the unit with it (`applyQcDraft`); a photo taken after
       * the unit has left QC is not evidence of what arrived, so they are
       * added only while it is open.
       */}
      <Modal
        open={photosRowData !== undefined}
        title={
          photosRowData
            ? t("inbound.photosTitle", "Photos · {{what}}", {
                what: `#${numberOf(photosRowData)} · ${skuLabel(actualSkuOf(photosRowData))}`,
              })
            : ""
        }
        onCancel={() => setPhotosRow(null)}
        footer={
          <Button onClick={() => setPhotosRow(null)}>
            {t("common.close", "Close")}
          </Button>
        }
        destroyOnHidden
      >
        {photosRowData &&
          (photosRowData.unit ? (
            <UnitPhotos
              serial={photosRowData.unit.serial}
              editable={rowOpen(photosRowData)}
              size={72}
              max={12}
            />
          ) : (
            <UnitPhotos
              draft={{
                photos: qcDrafts[photosRowData.key]?.photos ?? [],
                onAdd: (urls) =>
                  setQcDrafts((m) => {
                    const key = photosRowData.key;
                    const held = m[key]?.photos ?? [];
                    return {
                      ...m,
                      [key]: {
                        ...m[key],
                        photos: [
                          ...held,
                          ...urls.map((url) => ({ id: nextId("dph"), url })),
                        ],
                      },
                    };
                  }),
                onRemove: (id) =>
                  setQcDrafts((m) => {
                    const key = photosRowData.key;
                    return {
                      ...m,
                      [key]: {
                        ...m[key],
                        photos: (m[key]?.photos ?? []).filter(
                          (p) => p.id !== id,
                        ),
                      },
                    };
                  }),
              }}
              editable={rowOpen(photosRowData)}
              size={72}
              max={12}
            />
          ))}
      </Modal>

      {/*
       * Sending a machine for a repair (owner revision 2026-09-09). A form
       * rather than a `modal.confirm`, because whether the machine has to
       * travel decides whether a courier's charge makes any sense to ask for.
       */}
      <Modal
        open={sendingToService !== null}
        centered
        title={t("inbound.serviceTitle", "Send this unit to service?")}
        okText={t("inbound.serviceOk", "Send to service")}
        onCancel={() => {
          setSendingToService(null);
          serviceForm.resetFields();
        }}
        onOk={sendToService}
        destroyOnHidden
      >
        <Form
          form={serviceForm}
          layout="vertical"
          // Shipped by default: the bench is a different building, and a
          // machine graded in warehouse 1 has to get there.
          initialValues={{ ship: bench !== undefined }}
        >
          <Typography.Paragraph type="secondary">
            {t(
              "inbound.serviceBody",
              "{{serial}} stops being sellable now. You can take this back from the row afterwards.",
              { serial: sendingToService ?? "" },
            )}
          </Typography.Paragraph>
          {bench && (
            <Form.Item
              name="ship"
              valuePropName="checked"
              label={t("inbound.serviceShip", "Send it to {{bench}}", {
                bench: benchName,
              })}
              tooltip={t(
                "inbound.serviceShipHint",
                "Leave this off if the repairer collects it, or if the unit is not moving. Turning it on files the unit at the bench straight away.",
              )}
            >
              <Switch />
            </Form.Item>
          )}
          <Form.Item noStyle shouldUpdate={(a, b) => a.ship !== b.ship}>
            {({ getFieldValue }) =>
              bench && getFieldValue("ship") ? (
                <Form.Item
                  name="shippingFee"
                  label={t(
                    "inbound.serviceShippingFee",
                    "Cost of getting it there",
                  )}
                  tooltip={t(
                    "inbound.serviceShippingFeeHint",
                    "The courier between the two warehouses. It joins what this unit has cost the shop.",
                  )}
                >
                  <InputNumber
                    min={0}
                    precision={0}
                    prefix={RP_SYMBOL}
                    formatter={moneyFormatter}
                    parser={moneyParser}
                    style={{ width: "100%" }}
                  />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item
            name="serviceFee"
            label={t("inbound.serviceFee", "Service fee")}
            tooltip={t(
              "inbound.serviceFeeHint2",
              "Only if you already know it. Anything the repairer bills later is added at the bench, where it can also be corrected.",
            )}
          >
            <InputNumber
              min={0}
              precision={0}
              prefix={RP_SYMBOL}
              formatter={moneyFormatter}
              parser={moneyParser}
              placeholder={t("inbound.serviceFeeHint", "If you know it")}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="note"
            label={t("inbound.serviceProblem", "What is wrong with it")}
          >
            <Input.TextArea
              rows={2}
              placeholder={t(
                "inbound.serviceProblemHint",
                "Optional — what the bench should look at",
              )}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={paying !== null}
        centered
        title={
          paying?.id
            ? t("inbound.editAPayment", "Edit this payment")
            : t("inbound.recordAPayment", "Record a payment")
        }
        okText={
          paying?.id
            ? t("inbound.saveChanges", "Save changes")
            : t("inbound.record", "Record")
        }
        onCancel={() => setPaying(null)}
        onOk={recordPayment}
      >
        <Flex vertical gap={12}>
          <Typography.Text type="secondary">
            {t(
              "inbound.partPaymentNormal",
              "Paying part now and the rest later is normal — the order keeps the outstanding balance.",
            )}
          </Typography.Text>
          <Flex vertical gap={4}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("inbound.method", "Method")}
            </Typography.Text>
            <Select
              value={payMethod}
              onChange={setPayMethod}
              // Clearable (owner ask 2026-09-15). A method already recorded but
              // since deactivated still shows as itself.
              allowClear
              status={payAmount && !payMethod ? "error" : undefined}
              placeholder={t("inbound.pickMethod", "How the money moved")}
              aria-label={t("inbound.method", "Method")}
              options={db.paymentMethods
                .filter((m) => (m.forPo && m.active) || m.code === payMethod)
                .map((m) => ({ value: m.code, label: m.label }))}
            />
            {payAmount !== undefined && payAmount > 0 && !payMethod && (
              <Typography.Text type="danger" style={{ fontSize: 12 }}>
                {t(
                  "inbound.methodNeededForAmount",
                  "An amount needs a method — the balance has to know whether it left the drawer or the bank.",
                )}
              </Typography.Text>
            )}
          </Flex>
          <Flex vertical gap={4}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("inbound.appliedTo", "Applied to")}
            </Typography.Text>
            <Select<PayTarget>
              value={payTarget}
              onChange={setPayTarget}
              aria-label={t("inbound.appliedTo", "Applied to")}
              options={payOptions}
            />
          </Flex>
          <Flex vertical gap={4}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("inbound.amount", "Amount")}
            </Typography.Text>
            <MoneyInput
              value={payAmount}
              onChange={(v) => setPayAmount(v ?? undefined)}
            />
          </Flex>
          <Flex align="flex-start" gap={8}>
            <Switch
              checked={payInBalance}
              onChange={setPayInBalance}
              aria-label={t(
                "debtPay.inBalance",
                "Counts in the shop's balance",
              )}
            />
            <Flex vertical gap={0}>
              <Typography.Text>
                {t("debtPay.inBalance", "Counts in the shop's balance")}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {payInBalance
                  ? t(
                      "inbound.inBalanceOn",
                      "Comes out of the cash drawer or the bank, by its method.",
                    )
                  : t(
                      "debtPay.inBalanceOff",
                      "Settles the debt without moving the cash or bank balance — for money that never passed through the shop's accounts.",
                    )}
              </Typography.Text>
            </Flex>
          </Flex>
          {owedForTarget > 0 && (
            // Fills the balance of what is selected, not the order's.
            <Button size="small" onClick={() => setPayAmount(owedForTarget)}>
              {t(
                "inbound.payWhatIsOwed",
                "Pay what is owed on it — {{amount}}",
                {
                  amount: fmtRp(owedForTarget),
                },
              )}
            </Button>
          )}
        </Flex>
      </Modal>

      <ExpenseModal
        po={po}
        editing={expense}
        onClose={() => setExpense(null)}
      />

      <PrintLabelsModal
        open={printing !== null}
        labels={printing ?? []}
        onClose={() => setPrinting(null)}
      />
    </PageContainer>
  );
}
