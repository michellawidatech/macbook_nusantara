/**
 * One inbound order, from raised to on-the-shelf.
 *
 * This is where the PO and QC screens actually merged. The three intake stories
 * the owner described are three paths through this one page:
 *
 * 1. **Goods match.** Lines were entered when the order was raised. Mark
 *    arrived, then grade each serial.
 * 2. **Goods do not match.** Add the product that actually turned up, drop the
 *    one that did not (`Not received` — it stays visible because it was
 *    invoiced), or correct a unit cost to what was really paid.
 * 3. **Paid first.** The order arrives here with a payment and no lines at all.
 *    Add the products now, then mark arrived.
 *
 * "Mark arrived" is the hinge: it opens QC, and QC is where each machine is
 * identified. It does NOT create units — the serial does. Every row in
 * *Serials & QC* is one machine the invoice accounts for, and it becomes a
 * unit at the moment somebody scans or types the serial off its case
 * (2026-08-26; `lib/inboundQc.ts` has the reasoning). Before that a row is a
 * question the paperwork is asking; after it, the machine has a ledger of its
 * own.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Result,
  Segmented,
  Select,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  AuditOutlined,
  CheckOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  InboxOutlined,
  LockOutlined,
  PlusOutlined,
  PrinterOutlined,
  ToolOutlined,
  UndoOutlined,
  UnlockOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { useTranslation } from "react-i18next";
import { MoneyInput } from "../../components/MoneyInput";
import { EditableTable } from "../../components/EditableTable";
import { SkuPicker } from "../../components/SkuPicker";
import { CountInput, COUNT_COLUMN_WIDTH } from "../../components/CountInput";
import { PrintLabelsModal } from "../../components/LabelSheet";
import { UnitPhotos } from "../../components/UnitPhotos";
import { GradeTag } from "../../components/GradeTag";
import { GradingModal } from "../../components/GradingModal";
import { StoreLabelTag } from "../../components/StoreLabelTag";
import {
  BatteryFields,
  batteryFieldsLabel,
} from "../../components/BatteryFields.js";
import {
  PriceFields,
  type PriceDraft,
} from "../../components/PriceFields.js";
import {
  DEFAULT_MARKETPLACE_MARKUP_PCT,
  isPriceInRange,
} from "../../lib/unitPrice.js";
import { labelsFor, type LabelDatum } from "../../lib/labels.js";
import { fmtRp, fmtDate } from "../../lib/format.js";
import {
  BATTERY_GRADE_COLOR,
  batteryDraftOf,
  batteryEra,
  batteryPatch,
  batterySettingsFrom,
  isBatteryDraftInRange,
  readBattery,
  BATTERY_FIELD_RANGE,
  type BatteryDraft,
  type BatteryEra,
} from "../../lib/battery.js";
import {
  INBOUND_STAGE_COLOR,
  INBOUND_STAGE_LABEL,
  canReopenQc,
  paymentFor,
  poClosed,
  poStage,
  poTotals,
  unitStage,
  unitsOfPo,
} from "../../lib/inbound.js";
import {
  joinDescription,
  qcGroups,
  qcReady,
  qcRows,
  reslotDrafts,
  splitDescription,
  type QcGroup,
  type QcRow,
} from "../../lib/inboundQc.js";
import {
  canGrade,
  conditionOf,
  gradeForCondition,
  needsDescription,
  type UnitCondition,
} from "../../lib/condition.js";
import {
  CODE128_HINT,
  BASE_MAX_LENGTH,
  BASE_MIN_LENGTH,
  normaliseScan,
  STORE_MAX_LENGTH,
  readBarcode,
  type ScanRejection,
} from "../../lib/serialScan.js";
import { readSerialInput } from "../../lib/serialInput.js";
import { serviceLocationOf } from "../../lib/service.js";
import { RP_SYMBOL, moneyFormatter, moneyParser } from "../../components/money";
import {
  planSerialFill,
  type FillPlan,
  type FillRow,
} from "../../lib/scanFill.js";
import { rendered } from "../../lib/rendered.js";
import { useScanTarget } from "../../hooks/useScanTarget.js";
import { wasScannedText } from "../../lib/scanner.js";
import {
  PO_PAYMENT_FOR_LABEL,
  type MockDb,
  type PoItem,
  type PoPaymentFor,
} from "../../mock/seed.js";
import {
  useDb,
  mutate,
  nextId,
  docCode,
  appendEvent,
  ensureQcDescription,
  ensureReason,
} from "../../mock/store.js";

export function InboundDetailPage() {
  const { poId = "" } = useParams();
  const db = useDb();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const [payOpen, setPayOpen] = useState(false);
  const [payMethod, setPayMethod] = useState("TUNAI");
  const [payAmount, setPayAmount] = useState<number>();
  /**
   * Which part of the invoice the payment being recorded is settling.
   *
   * Defaults to the goods, which is what the overwhelming majority of
   * transfers are, and what every payment recorded before this field existed
   * is read as — see `paymentFor`.
   */
  const [payFor, setPayFor] = useState<PoPaymentFor>("ORDER");
  const [printing, setPrinting] = useState<LabelDatum[] | null>(null);
  /**
   * Serials being typed, keyed by row.
   *
   * The serial is not written to the store until the field is left or Enter is
   * pressed, and this is where it waits. Committing per keystroke is what broke
   * the field: the table is keyed on the serial, so every character re-keyed
   * the row, React remounted the input and the caret went with it — one click
   * per digit, which is how the owner reported it.
   */
  const [draft, setDraft] = useState<Record<string, string>>({});
  /**
   * Rows whose serial was refused for its SHAPE, keyed by row.
   *
   * The toast was the only thing that said so, and a toast is gone in four
   * seconds — on a bench where the next thing you do is pick up the next
   * machine, the box was left holding a serial that looked accepted (owner
   * report 2026-09-01). The field carries the refusal now: a red outline for
   * as long as the text is still wrong, and the reason under it, so somebody
   * who looked away can still see which of thirty rows is the bad one.
   *
   * Only shape faults live here, and that follows the same reasoning that
   * makes a shape fault the one refusal that does not clear the box. A
   * collision reverts the field to what the store holds, and an emptied unit
   * row does too — in both the text on screen after the refusal is text the
   * store vouches for, and outlining THAT in red would accuse the wrong
   * string.
   */
  const [serialFault, setSerialFault] = useState<
    Record<string, { fault: ScanRejection; scanned: boolean }>
  >({});
  /** Take a row's refusal back — it is being retyped, or it has landed. */
  const clearSerialFault = (key: string) =>
    setSerialFault((f) => {
      if (!(key in f)) return f;
      const rest = { ...f };
      delete rest[key];
      return rest;
    });
  /**
   * Descriptions chosen on rows that are not machines yet, keyed by row.
   *
   * Only slots live here now. The field stopped being a textarea on
   * 2026-08-27 and became a list of phrases picked from the shop's own
   * vocabulary, so there is no longer any per-keystroke cost to defend
   * against: adding a tag is one discrete decision, and a unit row writes it
   * straight to the store. A slot has nowhere to write it YET, which is the
   * only reason this map still exists — `identify` empties it onto the machine
   * the moment the row has a serial.
   */
  const [notes, setNotes] = useState<Record<string, string[]>>({});
  /**
   * Battery readings being typed, keyed by row.
   *
   * The third field held outside the store, and the one that needed it most.
   * A percentage is typed a digit at a time, so committing per keystroke files
   * 1, then 15, then 150 — and the first two are readings of a nearly dead
   * machine that nobody took. The reading is written once, when the box is
   * left or Enter is pressed, and that is also the moment it can be refused:
   * see `commitBattery`.
   *
   * `null` in here is a box somebody emptied, which is not the same as no
   * draft at all — that one shows what the store holds.
   *
   * Keyed by ROW rather than by serial since 2026-08-27, because a row with no
   * serial can now hold a reading: every column is typable before the machine
   * is identified, and a map keyed on the one thing the row does not have yet
   * could not hold it. `identify` carries the reading onto the unit, and
   * `reslotDrafts` keeps the rest on the rows they were typed into.
   */
  const [battery, setBattery] = useState<Record<string, BatteryDraft>>({});
  /**
   * The price given to a row, before it is committed (owner ask 2026-09-08).
   *
   * The fifth draft map, and it exists for the reason the other four do: every
   * column on this grid is typable before the serial is, and a slot has no
   * unit to write onto. `identify` carries the price onto the machine it
   * creates and `reslotDrafts` keeps the rest on the rows they were typed
   * into.
   *
   * A price used to be asked for here, then stopped being (2026-08-27, when
   * the price moved to the variant), and is asked for again now that each
   * machine carries its own. See `lib/unitPrice.ts` for why the pendulum
   * lands here.
   */
  const [prices, setPrices] = useState<Record<string, PriceDraft>>({});
  /**
   * The machine the Send-to-service dialog is open on, or null.
   *
   * The charges it asks for used to be a COLUMN in the grid (2026-09-08), on
   * the argument that the courier's number is on the desk at the moment
   * somebody decides a machine needs a repair. That argument survives; what
   * did not is asking for the number twice. The owner's 2026-09-09 revision
   * put both fees in the confirmation dialog — *"add a field so that they can
   * add additional fee like shipping fee from warehouse 1 to warehouse 4. If
   * the user can already know the service fee, they can add it to"* — which is
   * the same moment, on the screen that is already asking the question, and it
   * gave a column of empty Rp boxes back to a grid the owner had just called
   * too dense.
   */
  const [sendingToService, setSendingToService] = useState<string | null>(null);
  const [serviceForm] = Form.useForm<{
    ship: boolean;
    shippingFee?: number;
    serviceFee?: number;
    note?: string;
  }>();
  /**
   * Grades given to rows that are not machines yet, keyed by row.
   *
   * The fourth draft map, and it exists for the same reason `notes` does: a
   * slot has no unit to write onto, and grading no longer waits for the
   * serial. `identify` carries the letter onto the unit; `reslotDrafts` keeps
   * the rest on the rows they were graded in.
   */
  const [gradeDrafts, setGradeDrafts] = useState<Record<string, string>>({});
  /**
   * New or second — the owner's first ask of 2026-08-28.
   *
   * There is no fifth draft map, and that is the point: the condition IS the
   * grade (`lib/condition.ts`), so a slot marked New is a slot whose
   * `gradeDrafts` entry is `NEW`, and a slot marked Second is one with no
   * entry at all. Second is therefore the default for a row nobody has touched
   * — which is right for a second-hand shop, and is also the safe way round,
   * since it leaves the description gate on until somebody says otherwise.
   */
  const conditionOfRow = (r: QcRow): UnitCondition =>
    conditionOf(r.kind === "unit" ? r.unit.grade : gradeDrafts[r.key]);
  /** The row the grading dialog is open for, or null. */
  const [grading, setGrading] = useState<QcRow | null>(null);

  const po = db.pos.find((p) => p.id === poId);
  const units = useMemo(() => (po ? unitsOfPo(db, po.id) : []), [db, po]);
  const batterySettings = batterySettingsFrom(db.settings);
  const markupPct =
    db.settings.marketplaceMarkupPct ?? DEFAULT_MARKETPLACE_MARKUP_PCT;

  /**
   * The QC rows: machines this order has identified, and the ones it is still
   * waiting on. Derived from the invoice lines rather than stored — see
   * `lib/inboundQc.ts` for why there is no longer any such thing as a unit
   * without a serial.
   */
  const rows = useMemo(
    () => (po?.status === "RECEIVED" ? qcRows(po, db.units) : []),
    [po, db.units],
  );

  /**
   * The same rows, grouped by the product each machine is.
   *
   * What the screen actually renders since 2026-08-27; `rows` stays because
   * three things — the over-quota banner, the close-invoice warning and the
   * scan target — ask questions of the whole order rather than of one product.
   */
  const groups = useMemo(
    () => (po?.status === "RECEIVED" ? qcGroups(po, db.units) : []),
    [po, db.units],
  );

  /**
   * Every machine on this invoice that could be accepted right now.
   *
   * Exactly the rows whose own Accept button is enabled — same `qcReady`
   * gate, read from the store rather than from a draft, for the reason that
   * button's comment gives: a description is a list of tags and every tag is
   * written the moment it is chosen, so there is no uncommitted value to miss.
   *
   * `status === "QC"` is what keeps a machine already accepted, already sent
   * to service or already returned out of the list — the bulk button must not
   * be able to reach a decision somebody has taken.
   */
  const readyToAccept = useMemo(
    () =>
      db.units.filter(
        (u) => u.poId === po?.id && u.status === "QC" && qcReady(u),
      ),
    [db.units, po?.id],
  );

  /**
   * Accept the lot, in ONE mutation.
   *
   * One transaction rather than a loop of them, because that is what the row
   * button does per machine and this is the same act repeated: a partial
   * failure halfway through a loop of `mutate` calls would leave the invoice
   * in a state nobody chose. It also means one re-render for thirty machines
   * instead of thirty.
   *
   * Confirmed first. It is not destructive — every acceptance can be reopened
   * from the row, and `canReopenQc` is what says when — but it moves a whole
   * invoice's worth of stock onto the shelf in one press, and the count is
   * worth reading before that happens rather than after.
   */
  const acceptAll = () => {
    // `po` is guaranteed by the guard further down — this closure only ever
    // runs from a button the guard has already let render — but the compiler
    // cannot see that from up here, and an early return is cheaper than a
    // non-null assertion that would silently outlive the guard.
    if (!po) return;
    const serials = readyToAccept.map((u) => u.serial);
    if (serials.length === 0) return;
    modal.confirm({
      title: t("inbound.acceptAllTitle", "Accept {{count}} machine(s)?", {
        count: serials.length,
      }),
      content: t(
        "inbound.acceptAllBody",
        "They go into sellable stock now. Anything still missing a description is not included, and any one of these can be put back into QC from its row afterwards.",
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
          t(
            "inbound.acceptAllDone",
            "{{count}} machine(s) accepted into stock.",
            { count: serials.length },
          ),
        );
      },
    });
  };

  /**
   * The origin code this order's stickers carry — its own supplier's.
   *
   * Every unit on this page came off one purchase order, so unlike Inventory
   * (which prints across orders) the lookup is a constant here.
   */
  const supplierCodeOf = () =>
    db.suppliers.find((x) => x.id === po?.supplierId)?.code;

  const skuLabel = (skuId: string) => {
    const sku = db.skus.find((s) => s.id === skuId);
    return sku ? `${sku.name} ${sku.variantLabel}` : "—";
  };

  /**
   * Which battery reading this machine's model reports (owner ask 2026-09-08).
   *
   * Off the MODEL's release year, not off which fields happen to be filled in:
   * a 2017 body is a cycles machine whether or not somebody once typed a
   * percentage onto it. Every group on this page is one variant, so the whole
   * block shares an era and the column can say what it is asking for.
   */
  const eraOfSku = (skuId: string): BatteryEra => {
    const sku = db.skus.find((s) => s.id === skuId);
    const model = sku && db.models.find((m) => m.id === sku.modelId);
    return batteryEra(model?.releaseYear);
  };

  /** The product category behind a row — what picks its grading checklist. */
  const categoryOfSku = (skuId: string) => {
    const sku = db.skus.find((s) => s.id === skuId);
    return db.models.find((m) => m.id === sku?.modelId)?.category ?? "";
  };

  /**
   * Open the grading dialog on a row.
   *
   * The dialog clears its own checklist when it opens — see `GradingModal`
   * for why a stored letter is not prefilled back into one.
   */
  const openGrading = (row: QcRow) => setGrading(row);

  /**
   * A slot becomes a unit. The only place intake creates one.
   *
   * The `DITERIMA` event is written in the same mutation as the row, because a
   * unit that exists without one is a row the timeline cannot explain — this
   * codebase's one rule, applied at the only moment a machine enters it.
   */
  const identify = (
    d: MockDb,
    skuId: string,
    unitCost: number,
    serial: string,
    /**
     * What the bench had already written on this row before it had a serial.
     *
     * Grading no longer waits for identification (owner revision 2026-08-27),
     * so by the time a slot becomes a unit it may already carry a description
     * and a battery reading. They are written in the SAME push that creates
     * the unit — a second mutation would put a moment on the clock in which
     * the machine exists and what somebody observed about it does not.
     */
    pending?: {
      description?: readonly string[];
      battery?: BatteryDraft;
      price?: PriceDraft;
      grade?: string;
    },
  ) => {
    const order = d.pos.find((p) => p.id === poId)!;
    // Vocabulary first, machine second — see `writeDescription`.
    const described = joinDescription(
      (pending?.description ?? [])
        .map((phrase) => ensureQcDescription(d, phrase))
        .filter(Boolean),
    );
    // In the units this machine's own era reports — see `batteryEra`. A
    // refused reading never reaches a draft (see `commitBattery`), so
    // `batteryPatch` dropping an out-of-range one is belt and braces against
    // a value arriving by some other door.
    const reading = batteryPatch(pending?.battery ?? {}, eraOfSku(skuId));
    d.units.push({
      serial,
      skuId,
      status: "QC",
      locationId: order.locationId,
      buy: unitCost,
      description: described,
      poId: order.id,
      ...(reading.batteryHealth === undefined
        ? {}
        : { batteryHealth: reading.batteryHealth }),
      ...(reading.cycleCount === undefined
        ? {}
        : { cycleCount: reading.cycleCount }),
      ...(reading.fcc === undefined ? {} : { fcc: reading.fcc }),
      /*
       * Priced from the moment the machine exists.
       *
       * The variant's asking price is the fallback, and it is not a default
       * nobody chose: it is what this shop asks for this model, and QC's job
       * is to move it where the machine deserves. A unit reaching the shelf
       * with no price at all is one the till would quote the catalogue figure
       * for anyway — this makes that explicit and editable instead.
       */
      price:
        pending?.price?.price ??
        d.skus.find((x) => x.id === skuId)?.price ??
        0,
      ...(pending?.price?.marketPrice == null
        ? {}
        : { marketPrice: pending.price.marketPrice }),
      ...(pending?.grade ? { grade: pending.grade } : {}),
    });
    appendEvent(d, serial, {
      type: "DITERIMA",
      toStatus: "QC",
      refCode: order.code,
      note: `Received against ${order.code}`,
    });
  };

  /**
   * Correcting a mistyped serial, ledger and all.
   *
   * The events move with it. A unit is referred to by its serial everywhere in
   * this app, so renaming the row and leaving the event rows behind orphans the
   * machine's whole timeline — its history page would come up empty while the
   * old serial kept a `DITERIMA` nothing pointed at. Only reachable while the
   * unit is in QC, which is before anything but that arrival can have been
   * written about it.
   */
  const renameUnit = (d: MockDb, from: string, to: string) => {
    const unit = d.units.find((u) => u.serial === from);
    if (!unit) return;
    unit.serial = to;
    for (const e of d.events) if (e.serial === from) e.serial = to;
  };

  /**
   * Why a scan was refused, in a sentence somebody at the bench can act on.
   *
   * Four rejections and four different remedies: a short read is a scanner
   * that needs re-aiming, a long one is two scans with no Enter between them,
   * a charset failure is the wrong barcode on the box entirely, an `I` or an
   * `O` is a misread of a `1` or a `0`, and a missing supplier code is a
   * Settings job. A single "invalid barcode" would send all five to the same
   * dead end.
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
      return t(
        "inbound.scanLength",
        "“{{scanned}}” is {{n}} characters. A serial barcode is an S and then {{min}}–{{max}} more — a short read is a scanner that came away early, and a long one is two scans with no Enter between.",
        { scanned, n: length, min: BASE_MIN_LENGTH, max: BASE_MAX_LENGTH },
      );
    }
    if (reason === "no-marker") {
      // The owner's rule, said back to the person holding the scanner: the
      // underside of a Mac carries a regulatory code and a part number of
      // much the same shape, and the S is what tells the serial from them.
      return t(
        "inbound.scanNoMarker",
        "“{{scanned}}” does not begin with S, and is not one of the shop's own stickers either. Aim at the barcode whose number starts with S.",
        { scanned },
      );
    }
    if (reason === "confusable") {
      return t(
        "inbound.scanConfusable",
        "“{{scanned}}” has an I or an O in it. Apple never prints either — they are a misread of 1 and 0, so scan it again.",
        { scanned },
      );
    }
    return t(
      "inbound.scanCharset",
      "“{{scanned}}” is not a serial — capitals and digits only. Check the scanner is set to {{symbology}} and that this is the machine's own barcode.",
      { scanned, symbology: CODE128_HINT },
    );
  };

  /**
   * Why a TYPED serial was refused, in one sentence.
   *
   * The same three sentences the toast has always carried, lifted out of
   * `commitSerial` so the field can say them too — a toast is gone in four
   * seconds and the box it was about is not.
   *
   * Deliberately not `scanRefusal`. The remedies differ: a scan that came up
   * short is a scanner that came away early, a typed serial that came up short
   * is a serial somebody has not finished. Telling a person at a keyboard to
   * re-aim would be advice about a device they are not holding.
   */
  const serialFaultText = (
    fault: ScanRejection,
    serial: string,
    scanned: boolean,
  ): string => {
    if (fault === "no-marker") {
      /*
       * Two different sentences, because by 2026-09-01 the marker means two
       * different things depending on how the text got here.
       *
       * A SCAN without one was aimed at the wrong barcode, and the remedy is
       * to aim again. A TYPED string without one is somebody copying the case,
       * where there is no marker to copy — the app puts it back for them — so
       * reaching this branch on the typed route means the string is not a
       * serial at all, and telling that person to "check the sticker for an S"
       * would send them looking for a character that is not printed there.
       */
      return scanned
        ? t(
            "inbound.serialNoMarker",
            "“{{serial}}” does not begin with S. A barcode carries one — the scanner was aimed at the regulatory code or the part number beside it.",
            { serial },
          )
        : t(
            "inbound.serialNotASerial",
            "“{{serial}}” is not a serial. Type the {{min}}–{{max}} characters printed on the case, or scan the barcode.",
            { serial, min: BASE_MIN_LENGTH, max: BASE_MAX_LENGTH },
          );
    }
    if (fault === "charset") {
      return t(
        "inbound.serialCharset",
        "“{{serial}}” has something other than capitals and digits in it.",
        { serial },
      );
    }
    return t(
      "inbound.serialShape",
      "“{{serial}}” is {{n}} characters. A serial is an S and then {{min}}–{{max}} more.",
      { serial, n: serial.length, min: BASE_MIN_LENGTH, max: BASE_MAX_LENGTH },
    );
  };

  /**
   * The same refusal, short enough to sit under a 176px column.
   *
   * The sentence above quotes the serial and counts its characters, which is
   * right for a toast and four wrapped lines inside the table — on a grid of
   * thirty rows that pushes every other row down the page. The outline says
   * *this one*, this line says *what about it*, and the toast keeps the long
   * version for the moment it happens.
   */
  const serialFaultHint = (fault: ScanRejection, scanned: boolean): string => {
    if (fault === "no-marker") {
      return scanned
        ? t("inbound.serialHintMarker", "Must start with S")
        : t("inbound.serialHintBare", "{{min}}–{{max}} characters", {
            min: BASE_MIN_LENGTH,
            max: BASE_MAX_LENGTH,
          });
    }
    if (fault === "charset") {
      return t("inbound.serialHintCharset", "Capitals and digits only");
    }
    return t("inbound.serialHintLength", "S and then {{min}}–{{max}}", {
      min: BASE_MIN_LENGTH,
      max: BASE_MAX_LENGTH,
    });
  };

  /**
   * A scanned serial lands on the first machine still waiting for one.
   *
   * The plan is worked out against the mutation draft rather than against the
   * render closure, because the store has already moved on by the time the next
   * scan of a burst arrives — reading the closure would pick the same empty row
   * every time and each scan would overwrite the last. `rendered()` on the way
   * out lets the screen catch up before the queue releases the next one.
   */
  const scanSerial = async (raw: string) => {
    if (raw.trim() === "") return;
    // A closed order takes nothing, and the scanner is the one input on this
    // page that no `disabled` prop can reach — it listens at the document.
    const target = db.pos.find((p) => p.id === poId);
    if (target && poClosed(target)) {
      message.info(
        t(
          "inbound.scanClosed",
          "This invoice is closed. Reopen it before recording anything.",
        ),
      );
      return;
    }
    if (target?.status !== "RECEIVED") {
      message.info(
        t(
          "inbound.scanNotArrived",
          "Mark the order arrived first — that is what opens QC.",
        ),
      );
      return;
    }

    /*
     * The barcode is judged before anything is done with it, and what is
     * stored is what was read (owner correction 2026-09-01).
     *
     * Both of a machine's barcodes are taken: Apple's `S` + 10–12, and the
     * shop's own sticker, which is an issued two-letter origin code in front
     * of that same string. Either way the serial that lands in the row is
     * Apple's — nothing is prefixed at intake any more, because the store
     * barcode is DERIVED for the sticker rather than stored. `serialScan.ts`
     * carries the rules and the reasoning.
     *
     * The marker is compulsory here and everywhere, which is the owner's
     * *"begins with S; if not begin with S don't accept"*. The reason is the
     * one they gave on 2026-08-31 and it has not changed: the underside of a
     * Mac carries a regulatory code and a part number of much the same shape,
     * and at the desk where a wrong read MINTS A UNIT the marker is what tells
     * the serial's barcode from its neighbours.
     *
     * A typed serial goes through `validateSerial` in `commitSerial` — the
     * same shape rule, minus the `I`/`O` check, which is about a scanner
     * misreading rather than about a serial.
     */
    const scan = readBarcode(raw, {
      // What makes the shop's own sticker readable here at all. Every issued
      // code, not just this order's: a machine can perfectly well be carried
      // to this bench with another pallet's label already on it, and refusing
      // to READ it would leave the bench with no way to find out.
      supplierCodes: db.suppliers.map((x) => x.code ?? ""),
    });
    if (!scan.ok) {
      message.error(scanRefusal(scan.reason, scan.scanned, scan.length));
      return;
    }
    const serial = scan.serial;

    const out: {
      plan: FillPlan | null;
      product: string;
      /** Set only when a slot was promoted, so the drafts can follow it. */
      moved: { key: string; before: QcRow[]; after: QcRow[] } | null;
    } = {
      plan: null,
      product: "",
      moved: null,
    };
    mutate((d) => {
      const order = d.pos.find((p) => p.id === poId);
      if (!order) return;
      const current = qcRows(order, d.units);
      // A slot is empty by definition: the only text that survives being typed
      // into one is text that became a unit, and that is a unit row now. There
      // is therefore no half-typed serial for a scan to land on top of — see
      // `commitSerial` on why a refused one does not linger either.
      const fill: FillRow[] = current
        .filter((r) => r.kind === "slot" || r.unit.status === "QC")
        .map((r) => ({
          key: r.key,
          shown: r.kind === "unit" ? r.unit.serial : "",
        }));
      // A serial already on THIS order is a double scan, and the plan can name
      // the row holding it. `exists` is for one the shop knows from elsewhere,
      // which is a collision rather than a repeat.
      const mine = new Set(
        d.units.filter((u) => u.poId === order.id).map((u) => u.serial),
      );
      const plan = planSerialFill(
        serial,
        fill,
        (s) => !mine.has(s) && d.units.some((u) => u.serial === s),
      );
      out.plan = plan;
      if (plan.kind !== "fill") return;
      const target = current.find((r) => r.key === plan.rowKey);
      // Only a slot can be empty, so this is belt and braces.
      if (target?.kind !== "slot") {
        out.plan = { kind: "full" };
        return;
      }
      out.product = skuLabel(target.skuId);
      // A scanned machine inherits whatever the bench had already written on
      // the row it lands in, the same as a typed one. Somebody grading three
      // identical MacBooks fills the conditions down the column and then walks
      // the pile with the scanner; the readings must not be left behind.
      identify(d, target.skuId, target.unitCost, serial, {
        description: notes[target.key] ?? [],
        battery: battery[target.key] ?? {},
        price: prices[target.key] ?? {},
        ...(gradeDrafts[target.key] ? { grade: gradeDrafts[target.key] } : {}),
      });
      out.moved = {
        key: target.key,
        before: current,
        after: qcRows(order, d.units),
      };
    });

    const moved = out.moved;
    if (moved) {
      const shift = <T,>(d: Readonly<Record<string, T>>) =>
        reslotDrafts(d, moved.before, moved.after, moved.key);
      setDraft(shift);
      // The refusal follows its row too. A slot's key is positional, so a
      // fault left behind on `slot-2` would end up outlining whichever machine
      // the renumbering moved into that place.
      setSerialFault(shift);
      setNotes(shift);
      setBattery(shift);
      setPrices(shift);
      setGradeDrafts(shift);
    }

    // Toasts only once the mutation is over — never inside a state updater.
    const plan: FillPlan | null = out.plan;
    if (plan === null) return;
    if (plan.kind === "fill") {
      /*
       * Which barcode was read, said back (owner ask 2026-09-01).
       *
       * Both are on the machine and either is a legitimate aim, so the toast's
       * job is to confirm which one landed rather than to congratulate. The
       * two sentences differ in the only way that matters at the bench:
       * Apple's barcode has just been GIVEN an origin code and the sticker
       * still has to be printed, while the shop's own already carried one and
       * the machine is already labelled.
       */
      message.success(
        scan.kind === "STORE"
          ? t(
              "inbound.scanLandedStore",
              "{{serial}} recorded — {{product}}. Read off the shop's own sticker.",
              { serial, product: out.product },
            )
          : t(
              "inbound.scanLandedOriginal",
              "{{serial}} recorded — {{product}}. Read off Apple's barcode; print the shop's sticker when QC accepts it.",
              { serial, product: out.product },
            ),
      );
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
          "inbound.scanFull",
          "Every machine on this order already has a serial. Raise a quantity to expect another.",
        ),
      );
    }
    await rendered();
  };

  useScanTarget(scanSerial);

  /**
   * A typed serial leaves the keyboard and becomes a fact — on blur or Enter,
   * never per keystroke. See `draft` above for what committing early cost.
   */
  /**
   * Write a battery reading, or refuse it and say so.
   *
   * Refusing rather than clamping. antd's `max` would have taken 150 and
   * quietly stored 100 the moment the box was left — but 100% is a claim about
   * a NEW battery, and a machine that arrives second-hand with a brand-new
   * battery is a thing the shop would want to have actually measured. A number
   * outside 0–100 is a typo, so it is named and dropped, exactly as a serial
   * another unit already owns is.
   */
  const commitBattery = (
    row: QcRow,
    field: keyof BatteryDraft,
    value: number | null,
  ) => {
    /** Give the box back to what the store says. */
    const revert = () =>
      setBattery((d) => {
        if (!(row.key in d)) return d;
        const rest = { ...d };
        delete rest[row.key];
        return rest;
      });

    const era = eraOfSku(row.skuId);
    const draft = { ...(battery[row.key] ?? {}), [field]: value };
    if (!isBatteryDraftInRange(draft, era)) {
      const [lo, hi] = BATTERY_FIELD_RANGE[field];
      message.error(
        t(
          "inbound.batteryRefused",
          "{{value}} is not a reading this box takes — {{lo}} to {{hi}} only.",
          { value, lo, hi },
        ),
      );
      return revert();
    }
    // A slot has nowhere to file it yet. The draft IS the reading until a
    // serial turns the row into a unit, so it is kept rather than cleared —
    // clearing it here is what would empty the box under somebody's hand.
    if (row.kind === "slot") return;
    revert();
    const next = batteryPatch(draft, era);
    const unit = row.unit;
    if (
      next.batteryHealth === unit.batteryHealth &&
      next.cycleCount === unit.cycleCount &&
      next.fcc === unit.fcc
    ) {
      return;
    }
    const serial = unit.serial;
    mutate((d) => {
      const u = d.units.find((x) => x.serial === serial)!;
      u.batteryHealth = next.batteryHealth;
      u.cycleCount = next.cycleCount;
      u.fcc = next.fcc;
    });
  };

  /**
   * Write a price the moment the box is left.
   *
   * Committed on blur rather than per keystroke, for the reason the battery
   * boxes are: a price is typed a digit at a time, so committing per keystroke
   * would file Rp9, Rp95, Rp950 … on the way to Rp9.500.000, and every one of
   * those is a number somebody could have meant.
   *
   * An out-of-range figure is refused and named rather than clamped — the same
   * bargain the serial and the battery strike.
   */
  const commitPrice = (
    row: QcRow,
    field: keyof PriceDraft,
    value: number | null,
  ) => {
    const revert = () =>
      setPrices((d) => {
        if (!(row.key in d)) return d;
        const rest = { ...d };
        delete rest[row.key];
        return rest;
      });

    if (!isPriceInRange(value)) {
      message.error(
        t("inbound.priceRefused", "{{value}} is not a price.", { value }),
      );
      return revert();
    }
    // A slot has nowhere to file it yet — the draft IS the price until a
    // serial turns the row into a machine.
    if (row.kind === "slot") return;
    revert();
    const serial = row.unit.serial;
    const next = value ?? undefined;
    if (field === "price" && next === row.unit.price) return;
    if (field === "marketPrice" && next === row.unit.marketPrice) return;
    mutate((d) => {
      const u = d.units.find((x) => x.serial === serial)!;
      if (field === "price") {
        // Never left blank on a machine that exists: an empty box means "back
        // to what the shop asks", not "unpriced".
        u.price = next ?? d.skus.find((x) => x.id === u.skuId)?.price ?? 0;
      } else {
        u.marketPrice = next;
      }
    });
  };

  const commitSerial = (row: QcRow, raw: string) => {
    const typed = normaliseScan(raw);
    /*
     * One reader for every serial box in the app (owner ask 2026-09-08).
     *
     * This desk had the rule written out inline, and it was the only desk that
     * had it: the till, S/N Tracking, Stock Opname and the trade-in dialog
     * each did something slightly different with the same characters.
     * `readSerialInput` is that logic moved somewhere a test reads it, and
     * what it does is exactly what stood here —
     *
     * - either barcode is accepted, because somebody re-keying a graded
     *   machine reads whichever label faces them and on a graded one that is
     *   the shop's own sticker;
     * - a TYPED serial with no marker has one put back, because the `S` is
     *   printed under the bars and not on the case;
     * - a SCANNED one with no marker is refused, because a barcode carries its
     *   marker and a burst without one was aimed at the regulatory code or the
     *   part number beside it — the misread this desk exists to catch.
     *
     * `wasScannedText` tells the two apart the only way a keyboard-wedge
     * scanner can be told apart: by how fast the characters came.
     */
    const read = readSerialInput(typed, {
      scanned: wasScannedText(typed),
      supplierCodes: db.suppliers
        .map((x) => x.code)
        .filter((c): c is string => !!c),
    });
    const serial = read.ok ? read.serial : typed;
    const stored = row.kind === "unit" ? row.unit.serial : "";
    /** Give the box back to what the store says. */
    const revert = () =>
      setDraft((d) => {
        if (!(row.key in d)) return d;
        const rest = { ...d };
        delete rest[row.key];
        return rest;
      });

    if (serial === stored) return revert();
    if (serial === "") {
      // Only reachable on a unit row: an empty box on a slot is just a slot.
      if (row.kind === "unit") {
        message.error(
          t(
            "inbound.serialCannotBeBlank",
            "A serial cannot be blank. Remove the row instead.",
          ),
        );
      }
      return revert();
    }
    /*
     * A TYPED serial is held to the same shape as a scanned one (owner ask
     * 2026-09-01): *"if any barcode is not adhering to this rule then do not
     * accept"*.
     *
     * The old rules deliberately let a hand-keyed serial through on the
     * grounds that a person can see the machine, and only checked its length.
     * That was defensible while a malformed serial was merely unfindable; it
     * stopped being defensible once the sticker is DERIVED from the serial,
     * because `storeBarcodeOf` refuses to build one from a serial that is not
     * a valid original barcode — so a machine keyed in wrongly would silently
     * end up with no label at all.
     *
     * The `I`/`O` rule is not applied to a typed serial and that is deliberate
     * — see `validateSerial`.
     */
    if (!read.ok) {
      const fault = read.reason;
      const scanned = read.source === "scan";
      message.error(serialFaultText(fault, serial, scanned));
      /*
       * The text STAYS. This is the one refusal that must not clear the box.
       *
       * `revert()` exists for the collision below, where clearing is
       * deliberate: a serial another unit owns can never be made valid by
       * editing it here, and a slot has no identity of its own, so leaving
       * text on one means leaving it on a key that is about to renumber. A
       * SHAPE fault is the opposite — it is a typo, the fix is two
       * keystrokes, and wiping it makes somebody retype thirteen characters
       * to correct one. It also fires on BLUR, so clicking away mid-serial
       * used to empty the field.
       */
      setDraft((d) => ({ ...d, [row.key]: serial }));
      // What the toast says, said again by the box itself, and it stays until
      // the text changes. Cleared in `onChange` rather than here on the next
      // commit, so the outline goes the moment somebody starts fixing it.
      setSerialFault((f) => ({ ...f, [row.key]: { fault, scanned } }));
      return;
    }
    clearSerialFault(row.key);
    if (db.units.some((u) => u.serial === serial)) {
      message.error(
        t(
          "inbound.serialTaken",
          "{{serial}} already belongs to another unit.",
          {
            serial,
          },
        ),
      );
      // Cleared rather than left to be corrected, and that is a deliberate
      // trade. A slot has no identity of its own — it is the nth machine of a
      // product that has no unit yet — so the moment any other row is filled
      // the slots renumber, and text parked on one would follow a key that no
      // longer renders. Better to name what was wrong and take the serial
      // again than to show somebody work that is about to vanish.
      return revert();
    }
    revert();
    if (row.kind === "slot") {
      // Read from the closure BEFORE the mutation: these are what the bench
      // typed into this row while it was still waiting for a serial.
      const carry = {
        description: notes[row.key] ?? [],
        battery: battery[row.key] ?? {},
        price: prices[row.key] ?? {},
        ...(gradeDrafts[row.key] ? { grade: gradeDrafts[row.key] } : {}),
      };
      const shape: { before: QcRow[]; after: QcRow[] } = {
        before: [],
        after: [],
      };
      mutate((d) => {
        const order = d.pos.find((p) => p.id === poId)!;
        shape.before = qcRows(order, d.units);
        identify(d, row.skuId, row.unitCost, serial, carry);
        shape.after = qcRows(order, d.units);
      });
      // Functional updaters, so each map is re-keyed from what it holds NOW
      // rather than from a closure `revert()` has already moved on from.
      const move = <T,>(d: Readonly<Record<string, T>>) =>
        reslotDrafts(d, shape.before, shape.after, row.key);
      setDraft(move);
      setSerialFault(move);
      setNotes(move);
      setBattery(move);
      setPrices(move);
      setGradeDrafts(move);
      message.success(
        t("inbound.serialRecorded", "{{serial}} recorded.", { serial }),
      );
    } else {
      mutate((d) => renameUnit(d, stored, serial));
      message.success(
        t("inbound.serialCorrected", "Serial corrected to {{serial}}.", {
          serial,
        }),
      );
    }
  };

  /**
   * Describe a machine: a list of phrases, stored comma-joined.
   *
   * Written on every change rather than on blur, and that is the difference
   * between a tag list and the textarea it replaced. A textarea costs a clone
   * of the whole store per keystroke, which is why descriptions used to wait
   * for the field to be left; adding a phrase is one decision, taken once.
   *
   * `ensureQcDescription` runs INSIDE the same mutation as the write, which is
   * `ensureReason`'s rule applied to the other free-typed field on this page:
   * there is no moment at which a machine is described by a phrase the list
   * has not heard of. It also hands back the STORED spelling, so typing
   * "mulus" under a seeded "Mulus" files the machine under the phrase the list
   * already has instead of forking the vocabulary on a capital letter.
   */
  const writeDescription = (serial: string, parts: readonly string[]) => {
    mutate((d) => {
      const u = d.units.find((x) => x.serial === serial);
      if (!u) return;
      u.description = joinDescription(
        parts.map((phrase) => ensureQcDescription(d, phrase)).filter(Boolean),
      );
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
  const stage = poStage(po, db.units);
  const supplier = db.suppliers.find((s) => s.id === po.supplierId);
  // What says the goods physically turned up. Until 2026-08-26 this read
  // `units.length > 0`, which worked only because arrival minted a placeholder
  // unit per line-quantity. Nothing is minted now, so an order can be received
  // with every serial still unread, and only its own status can say so.
  const arrived = po.status === "RECEIVED";
  /**
   * Filed away, and therefore read-only.
   *
   * One flag rather than a rule per control, because "closed" has to mean the
   * same thing everywhere on the page or it means nothing: the money, the
   * lines, the serials and the scanner all stop taking input together. The way
   * back is the banner's Reopen, which is deliberately one click — see
   * `closeInvoice`.
   */
  const closed = poClosed(po);
  const liveLines = po.items.filter((i) => !i.notReceived);
  /**
   * Machines the paperwork no longer accounts for — a quantity that came down
   * after someone had already graded one. Painted red rather than deleted;
   * `lib/inboundQc.ts` says why.
   */
  const overQuota = rows.filter((r) => r.kind === "unit" && r.overQuota).length;

  const bench = serviceLocationOf(db.warehouses);
  const benchName =
    db.warehouses.find((w) => w.id === bench)?.name ?? bench ?? "";

  /**
   * A unit that fails QC, and goes back to whoever sold it.
   *
   * Carried over from the Stock In screen rather than dropped in the merge:
   * refusing a unit is half of what QC is for. It writes the managed reason
   * FIRST, so nothing ever points at a reason Settings has not heard of.
   *
   * A confirm rather than a form, unlike the service half below: there is
   * nothing to ask. The machine goes back, the claim is opened at what the
   * invoice says it cost, and the decision can be taken back from the row.
   */
  const rejectToSupplier = (serial: string) => {
    modal.confirm({
      title: t("inbound.rejectTitle", "Return this unit to the supplier?"),
      // Says the decision is reversible, because it now is. Staff who believe
      // a click is final either hesitate over every one of them or hide the
      // mistake afterwards, and both are worse than the mistake.
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
            // reopen reads to know which claim to withdraw, and what the
            // machine's own timeline needs to explain where it went.
            refCode: code,
            note: reasonLabel,
          });
        }),
    });
  };

  /**
   * A unit that needs a repair (owner revision 2026-09-09).
   *
   * > *"When the staff press the service button, asks a confirmation modal
   * > that this unit will be sent/not to warehouse 4 for service, then add a
   * > field so that they can add additional fee like shipping fee from
   * > warehouse 1 to warehouse 4. If the user can already know the service
   * > fee, they can add it to."*
   *
   * Three questions, and the first one governs the other two: does the machine
   * have to travel? The shop's warehouses are separate buildings, so sending
   * one to the bench is a courier job with a courier's price — but a machine
   * already IN warehouse 4, or one a repairer collects, travels nowhere and
   * should not be asked what the journey cost.
   *
   * ## The machine does not arrive by being sent
   *
   * This used to move the unit to the bench in the same breath as the status,
   * so `wh-4` showed a machine that was still in a van. The location now moves
   * when somebody at the bench confirms it turned up — see `arrivedAt` in
   * lib/service.ts and the Expected table on /stock/service. What DOES happen
   * immediately is the status: a machine promised to a repairer is not
   * sellable from the moment it is promised, whatever shelf it is on.
   */
  const sendToService = () => {
    const serial = sendingToService!;
    serviceForm.validateFields().then((v) => {
      const now = new Date().toISOString();
      mutate((d) => {
        const u = d.units.find((x) => x.serial === serial)!;
        const reasonLabel = "On Service";
        ensureReason(d, "ADJUSTMENT", reasonLabel);
        // A journey only happens when there is a bench to travel to. A shop
        // whose locations include no service location keeps the machine where
        // it is, which is exactly the behaviour before any of this existed.
        const travelling = v.ship && bench !== undefined && bench !== u.locationId;
        appendEvent(d, serial, {
          type: "DICATAT",
          toStatus: "SERVIS",
          refCode: po.code,
          note: travelling
            ? `Sent to service — on its way to ${benchName}`
            : "Sent to service",
        });
        // The rack belongs to the warehouse it is leaving, and it leaves the
        // shelf the moment it is picked up rather than when it arrives.
        if (travelling) u.rackId = undefined;
        const fees = [];
        if (travelling && (v.shippingFee ?? 0) > 0) {
          fees.push({
            id: nextId("svcf"),
            kind: "SHIPPING" as const,
            // Translated where it is WRITTEN, which is the trade
            // `UnitEvent.note` already makes on this page: the string is
            // stored and is frozen in whatever language the bench happened to
            // be in. The alternative is a structured label the reader phrases,
            // and there is no column for one.
            label: t("inbound.serviceShipLabel", "Transfer to the bench"),
            amount: v.shippingFee!,
            at: now,
            staff: "Michella",
          });
        }
        if ((v.serviceFee ?? 0) > 0) {
          fees.push({
            id: nextId("svcf2"),
            kind: "LABOUR" as const,
            label: t("inbound.serviceFeeRaised", "Quoted at QC"),
            amount: v.serviceFee!,
            at: now,
            staff: "Michella",
          });
        }
        d.services.push({
          id: nextId("svc"),
          serial,
          fromLocationId: u.locationId,
          openedAt: now,
          // A machine that travels has to be signed for at the other end; one
          // that does not is already there, so nothing is waiting to be
          // confirmed and the bench can start work.
          ...(travelling ? {} : { arrivedAt: now }),
          fees,
          ...(v.note ? { note: v.note } : {}),
          raisedBy: "QC",
          poId: po.id,
          staff: "Michella",
        });
      });
      setSendingToService(null);
      serviceForm.resetFields();
      message.success(
        v.ship && bench
          ? t(
              "inbound.serviceSentShipping",
              "{{serial}} is on its way to {{bench}}. Confirm it there when it arrives.",
              { serial, bench: benchName },
            )
          : t("inbound.serviceSentHere", "{{serial}} is at the service bench.", {
              serial,
            }),
      );
    });
  };

  /**
   * New or second, written onto the row (owner ask 2026-08-28).
   *
   * One control writing one column. Marking a machine New writes the schema's
   * own `Grade.NEW`; marking it Second CLEARS that letter rather than guessing
   * another, because an ungraded second-hand machine is an honest state and an
   * invented `A` is exactly the unfounded letter `lib/grading.ts` exists to be
   * rid of. `gradeForCondition` is that rule, and it is shared with the return
   * desk so the two screens cannot disagree.
   *
   * A condition change is filed on the ledger for the same reason a grade is:
   * "why is this listed as sealed?" has to have an answer on the machine
   * itself six weeks later.
   */
  const setCondition = (row: QcRow, condition: UnitCondition) => {
    if (row.kind === "slot") {
      const grade = gradeForCondition(condition, gradeDrafts[row.key]);
      setGradeDrafts((g) => {
        const next = { ...g };
        if (grade === undefined) delete next[row.key];
        else next[row.key] = grade;
        return next;
      });
      return;
    }
    const serial = row.unit.serial;
    const grade = gradeForCondition(condition, row.unit.grade);
    if (grade === row.unit.grade) return;
    mutate((d) => {
      const u = d.units.find((x) => x.serial === serial);
      if (!u) return;
      u.grade = grade;
      appendEvent(d, serial, {
        type: "DICATAT",
        refCode: po.code,
        note:
          condition === "NEW"
            ? "Marked new — sealed stock"
            : "Marked second-hand",
      });
    });
  };

  /** Write a grading decision onto the row the dialog is open for. */
  const applyGrade = (row: QcRow, grade: string, inspection: string) => {
    if (row.kind === "slot") {
      setGradeDrafts((g) => ({ ...g, [row.key]: grade }));
      return;
    }
    const serial = row.unit.serial;
    if (row.unit.grade === grade) return;
    mutate((d) => {
      const u = d.units.find((x) => x.serial === serial);
      if (!u) return;
      u.grade = grade;
      // The inspection goes on the timeline, because the letter alone is a
      // conclusion with no working. Six weeks later "why is this a B?" has an
      // answer on the machine itself.
      appendEvent(d, serial, {
        type: "DICATAT",
        refCode: po.code,
        note: inspection
          ? `Graded ${grade} — ${inspection}`
          : `Graded ${grade}`,
      });
    });
  };

  /**
   * Take a QC decision back — the owner's fourth ask of 2026-08-27.
   *
   * Three machines come off a pallet, two of them the same model, and the
   * person grading accepts the wrong one or sends the wrong one back. Until
   * now the only remedy was a stock adjustment, which files the correction as
   * a different KIND of event from the mistake and leaves the timeline reading
   * "arrived, passed QC, mysteriously adjusted out". A reopen says what
   * actually happened: this decision was wrong, here is the machine back on
   * the bench.
   *
   * `KOREKSI` is the schema's own word for it (`UnitEventType`), and the event
   * is APPENDED — the QC_SELESAI or RETUR_SUPPLIER that was wrong stays on the
   * ledger, because it was really recorded and somebody may need to know it
   * was. Nothing is rewritten.
   *
   * A supplier return raised at QC is withdrawn with it. Leaving it standing
   * would have the shop claiming money from a supplier for a machine sitting
   * on its own bench — and the document is marked `CANCELLED` rather than
   * deleted, because the claim really was raised.
   */
  const reopenQc = (serial: string) => {
    const unit = db.units.find((u) => u.serial === serial);
    // Asked again here, not only of the button. The button's `disabled` is a
    // fact about the last render, and the thing this guards against is a
    // machine that was sold or reserved in another tab between that render and
    // the click — which is the same class of mistake the whole feature exists
    // to undo, and not one worth introducing while undoing another.
    if (!unit || !canReopenQc(unit)) return;
    const from = unitStage(unit);
    modal.confirm({
      title: t("inbound.reopenTitle", "Put this machine back into QC?"),
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
          /*
           * A machine coming back from a service decision has to come off the
           * bench's list as well (2026-09-09).
           *
           * The visit is CLOSED rather than removed — nothing here is hard-
           * deleted, and a courier charge already incurred is still a cost
           * against the machine whatever anybody decided afterwards. It closes
           * back to where it set out from, which is where it still is: a visit
           * with no `arrivedAt` is one nobody has signed for. Without this the
           * bench would go on expecting a machine that is back on the QC grid.
           */
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
            // The schema's own word for it since the migration of 2026-08-27.
            // It was KOREKSI while this lived only in the mock, which read on
            // a timeline as "adjusted" — a different and vaguer thing from a
            // QC decision somebody judged wrong.
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

  /**
   * Close the invoice, or open it again.
   *
   * Closing is the shop saying "we are finished with this piece of paper": the
   * goods are dealt with, the money is settled or written off, and nothing
   * more should be recorded against it. It makes the page read-only, which is
   * the whole feature — an order nobody can edit is an order nobody edits by
   * accident six weeks later while looking for something else.
   *
   * It warns rather than refuses. An order can genuinely be finished with
   * while it still owes a supplier money or still holds a machine nobody
   * graded — a line written off, a unit that walked — and a screen that
   * refuses to file such an order leaves it in the live list forever, which is
   * how the live list stops being read. So the dialog names what is unfinished
   * and lets a person decide.
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
    const ungraded = rows.filter(
      (r) => r.kind === "slot" || r.unit.status === "QC",
    ).length;
    if (ungraded > 0) {
      loose.push(
        t("inbound.closeUngraded", "{{count}} machine(s) have not left QC", {
          count: ungraded,
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

  /**
   * Opens QC.
   *
   * Marking an order arrived says the boxes are on the bench; it does NOT
   * create units. Until 2026-08-26 it minted one `TBD-…` unit per
   * line-quantity, which put rows in the database for machines nobody had yet
   * held — and made the serial the one thing about a unit that was invented
   * rather than read. QC now shows a row per expected machine and each becomes
   * a unit at the moment its serial is scanned or typed. See
   * `lib/inboundQc.ts`.
   */
  const markArrived = () => {
    if (liveLines.length === 0) {
      message.error(
        t(
          "inbound.nothingToReceive",
          "Add the products first — there is nothing to receive.",
        ),
      );
      return;
    }
    // A line whose product was never chosen would ask QC for a serial against
    // an empty SKU, and a row that is not any product is a row no screen can
    // render. Possible since "Add product" stopped guessing at a default
    // (2026-08-26), so it is checked here rather than trusted.
    if (liveLines.some((i) => !i.skuId)) {
      message.error(
        t(
          "inbound.pickEveryProduct",
          "Every line needs a product before the order can be received.",
        ),
      );
      return;
    }
    modal.confirm({
      title: t("inbound.markThisOrderAsArrived", "Mark this order as arrived?"),
      content: `${liveLines.reduce((n, i) => n + i.qty, 0)} machine(s) will be waiting for a serial in QC. Lines marked "not received" are skipped.`,
      okText: t("inbound.markArrived", "Mark arrived"),
      onOk: () => {
        mutate((d) => {
          d.pos.find((p) => p.id === po.id)!.status = "RECEIVED";
        });
        message.success(
          t(
            "inbound.markedArrived",
            "Marked arrived. Scan or type each serial below.",
          ),
        );
      },
    });
  };

  const header = (
    <Card>
      <Flex justify="space-between" align="flex-start" wrap gap={16}>
        <Descriptions
          column={{ xs: 1, sm: 2, md: 3 }}
          items={[
            {
              key: "sup",
              label: t("inbound.supplier", "Supplier"),
              children: supplier?.name ?? "—",
            },
            {
              key: "inv",
              label: t("inbound.invoice", "Invoice"),
              children: po.noInvoice ? (
                <Typography.Text type="secondary">No invoice</Typography.Text>
              ) : (
                po.invoice
              ),
            },
            {
              key: "d",
              label: t("inbound.ordered", "Ordered"),
              children: fmtDate(po.date),
            },
            {
              key: "wh",
              label: t("inbound.warehouse", "Warehouse"),
              children: db.warehouses.find((w) => w.id === po.locationId)?.name,
            },
            {
              key: "st",
              label: t("inbound.stage", "Stage"),
              children: (
                <Tag color={INBOUND_STAGE_COLOR[stage]}>
                  {INBOUND_STAGE_LABEL[stage]}
                </Tag>
              ),
            },
          ]}
        />
      </Flex>
    </Card>
  );

  /**
   * One line of the invoice, and what has actually been paid against it.
   *
   * The sub-line is written only when it has something to say. An order that
   * nobody has paid anything towards does not need "not paid yet" three times
   * — the Paid row below already reads zero — so the note appears once money
   * has moved somewhere on this order, and a fee of nothing never gets one at
   * all.
   */
  const bucketLine = (
    bucket: PoPaymentFor,
    label: string,
    invoiced: number,
    /** Rendered between the amount and the note. Only Products uses it. */
    adjustment?: ReactNode,
  ) => {
    const paid = totals.paidFor[bucket];
    const owed = totals.owedFor[bucket];
    const note =
      paid > 0 && owed === 0
        ? t("inbound.bucketSettled", "settled")
        : paid > 0
          ? t("inbound.bucketPartly", "{{paid}} paid, {{owed}} still owed", {
              paid: fmtRp(paid),
              owed: fmtRp(owed),
            })
          : totals.paid > 0 && invoiced > 0
            ? t("inbound.bucketUnpaid", "not paid yet")
            : "";
    return (
      <Flex vertical>
        <Flex justify="space-between" gap={16}>
          <span>{label}</span>
          <span>{fmtRp(invoiced)}</span>
        </Flex>
        {adjustment}
        {note !== "" && (
          <Typography.Text
            type={paid > 0 && owed === 0 ? "success" : "secondary"}
            style={{ fontSize: 12, textAlign: "right" }}
          >
            {note}
          </Typography.Text>
        )}
      </Flex>
    );
  };

  const money = (
    <Card
      // "Purchase", matching the order form's review step (owner decision
      // 2026-08-26). Everything on the page is money; this card is the
      // purchase's figures.
      title={t("inbound.purchase", "Purchase")}
      extra={
        <Button
          icon={<PlusOutlined />}
          disabled={closed}
          onClick={() => setPayOpen(true)}
        >
          {t("inbound.recordPayment", "Record payment")}
        </Button>
      }
    >
      <Flex gap={32} wrap align="flex-start">
        <Flex vertical gap={6} style={{ minWidth: 280 }}>
          {/*
           * Each line of the invoice now says what has been paid against IT,
           * not just what it costs (owner revision 2026-08-27).
           *
           * Shipping is usually a different party from the supplier — a
           * forwarder, paid on its own day — and tax is a third. One
           * undifferentiated "Paid" figure could not answer the one question
           * the card is ever asked, which is whether the ongkir has been
           * settled. `bucketLine` writes each row and its own balance.
           */}
          {bucketLine(
            "ORDER",
            t("inbound.productsTotal", "Products"),
            totals.subtotal,
            // Inside the Products block, above its paid/owed note. A discount
            // is negotiated off the GOODS, so a reader who works down the
            // column has to meet it before the note that has already
            // subtracted it — with the discount three lines lower, "Rp
            // 31.300.000" and "Rp 27.200.000 still owed" were a hundred
            // thousand rupiah apart with nothing on screen to explain it.
            po.discount > 0 && (
              <Flex justify="space-between" gap={16}>
                <Typography.Text type="secondary">
                  {t("inbound.discount", "Discount")}
                </Typography.Text>
                <Typography.Text type="secondary">
                  −{fmtRp(po.discount)}
                </Typography.Text>
              </Flex>
            ),
          )}
          {bucketLine(
            "SHIPPING",
            t("inbound.shipping", "Shipping"),
            po.shippingFee,
          )}
          {bucketLine("TAX", t("inbound.tax", "Tax"), po.taxFee)}
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
          style={{ flex: 1, minWidth: 280 }}
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
              // What the transfer settled. A payment recorded before this
              // column existed reads as "Products" rather than as a blank —
              // see `paymentFor` for why that is the honest default and not a
              // guess.
              title: t("inbound.appliedTo", "Applied to"),
              key: "for",
              render: (_, p) => t(PO_PAYMENT_FOR_LABEL[paymentFor(p)]),
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
          ]}
        />
      </Flex>
    </Card>
  );

  const products = (
    <Card
      title={t("inbound.products", "Products")}
      extra={
        !arrived && (
          <Button
            type="primary"
            icon={<InboxOutlined />}
            disabled={closed}
            onClick={markArrived}
          >
            {t("inbound.markArrived", "Mark arrived")}
          </Button>
        )
      }
    >
      <EditableTable<PoItem>
        size="small"
        rowKey="id"
        dataSource={po.items}
        /*
         * Under the last row, not in the card header (owner ask 2026-09-01),
         * and ⌘⏎ from inside any cell does the same. `EditableTable` lands the
         * caret in the product picker of the row it creates, which is the only
         * part of "add a line" a keyboard could not do before.
         */
        onAdd={() =>
          mutate((d) => {
            d.pos
              .find((p) => p.id === po.id)!
              .items.push({
                id: nextId("poi"),
                // Deliberately blank. This used to be `db.skus[0].id`, which
                // silently stamped every new line with whatever happened to be
                // first in the catalogue — "MacBook Air M2 8GB / 256GB" — and
                // staff who did not notice saved orders for a product nobody had
                // bought. An empty SKU renders as a placeholder that has to be
                // answered, and `save` and `markArrived` both refuse a line
                // without one.
                skuId: "",
                serial: null,
                qty: 1,
                unitCost: 0,
              });
          })
        }
        addLabel={t("inbound.addProduct", "Add product")}
        addDisabled={closed}
        // On a stacked card the product picker is a field like any other, so
        // the card still needs to say which line it is. The product's name
        // when one is chosen; "Line n" from `EditableTable` when it is not.
        rowTitle={(item, i) =>
          db.skus.find((s) => s.id === item.skuId)?.name ??
          t("editableTable.line", "Line {{n}}", { n: i + 1 })
        }
        emptyText={
          <>
            {t("inbound.noProducts", "No products on this order yet.")}
            <br />
            <Typography.Text type="secondary">
              {t(
                "inbound.noProductsWhy",
                "That is expected when the money was transferred before anyone knew what it bought — add them now that the goods are here.",
              )}
            </Typography.Text>
          </>
        }
        columns={[
          {
            title: t("inbound.product", "Product"),
            key: "product",
            /*
             * Fixed (owner complaint 2026-09-01). A product label runs to
             * seventy characters — `PRO 13" 2016 i5 8/128 NTB — MacBook Pro
             * 13 2016 i5 / 8GB / 128GB / NTB` — and a column sized to hold
             * one on a single line paid for it out of its neighbours: Qty
             * came out narrower than its own stepper arrows, and
             * "Rp 3.900.000" broke across three lines in the Total column.
             * The label takes a second line inside this cell instead.
             */
            width: 340,
            render: (_, item) => (
              // Editable after arrival too, since 2026-08-26. The old rule
              // froze the product the moment goods landed, which meant the
              // owner's second intake story — a different machine turned up
              // than the one invoiced — could only be recorded by deleting
              // the line and losing its price. Correcting it re-derives the
              // QC rows, so the serials follow the product they belong to.
              <SkuPicker
                skus={db.skus}
                disabled={closed}
                aria-label={t("inbound.product", "Product")}
                // A line with no product chosen is the state a fresh row
                // starts in, and it has to look unanswered rather than
                // arbitrary.
                value={item.skuId}
                placeholder={t(
                  "inbound.pickProduct",
                  "Search a product name or SKU code",
                )}
                status={item.skuId ? undefined : "warning"}
                onChange={(v) => {
                  mutate((d) => {
                    d.pos
                      .find((p) => p.id === po.id)!
                      .items.find((i) => i.id === item.id)!.skuId = v;
                  });
                }}
              />
            ),
          },
          {
            title: t("inbound.qty", "Qty"),
            key: "qty",
            width: COUNT_COLUMN_WIDTH,
            render: (_, item) => (
              // Editable after arrival, and this is the change the owner
              // asked for: typing 3 here means three rows in Serials & QC,
              // now rather than only at the moment the order was received.
              // Lowering it never deletes graded work — see
              // `lib/inboundQc.ts`.
              <CountInput
                min={1}
                precision={0}
                value={item.qty}
                disabled={closed}
                aria-label={t("inbound.qtyAria", "Quantity")}
                onChange={(v) => {
                  if (v == null) return;
                  mutate((d) => {
                    d.pos
                      .find((p) => p.id === po.id)!
                      .items.find((i) => i.id === item.id)!.qty = v;
                  });
                }}
              />
            ),
          },
          {
            title: t("inbound.unitCost", "Unit cost"),
            key: "unitCost",
            width: 190,
            render: (_, item) => (
              // Editable even after arrival: the owner's second story is the
              // invoice saying one price and the transfer being another, and
              // the shop's cost of goods has to follow what was really paid.
              <MoneyInput
                value={item.unitCost}
                disabled={closed}
                aria-label={t("inbound.unitCost", "Unit cost")}
                onChange={(v) =>
                  mutate((d) => {
                    d.pos
                      .find((p) => p.id === po.id)!
                      .items.find((i) => i.id === item.id)!.unitCost = v ?? 0;
                  })
                }
              />
            ),
          },
          {
            // "Total", not "Line total" — the same rename the order form
            // got (owner decision 2026-08-26). The column is inside a row;
            // "line" is a word the layout already says.
            title: t("inbound.total", "Total"),
            key: "total",
            align: "right",
            width: 150,
            render: (_, item) =>
              item.notReceived ? (
                <Typography.Text delete type="secondary">
                  {fmtRp(item.unitCost * item.qty)}
                </Typography.Text>
              ) : (
                fmtRp(item.unitCost * item.qty)
              ),
          },
          {
            title: "",
            key: "actions",
            width: 170,
            render: (_, item) => (
              <Flex gap={4} justify="end">
                <Tooltip
                  title={
                    item.notReceived
                      ? t(
                          "inbound.putBackHint",
                          "Put this line back — the goods did turn up",
                        )
                      : t(
                          "inbound.notReceivedHint",
                          "The supplier never sent this. It stays on the order because it was invoiced, but stops counting towards what is owed.",
                        )
                  }
                >
                  <Button
                    size="small"
                    disabled={closed}
                    onClick={() => {
                      mutate((d) => {
                        const i = d.pos
                          .find((p) => p.id === po.id)!
                          .items.find((x) => x.id === item.id)!;
                        i.notReceived = !i.notReceived;
                      });
                    }}
                  >
                    {item.notReceived
                      ? t("inbound.received", "Received")
                      : t("inbound.notReceived", "Not received")}
                  </Button>
                </Tooltip>
                {/*
                 * Removable at any point, not only before arrival. The owner
                 * asked to be able to delete a product row; refusing after
                 * arrival left a wrong line on the order permanently, since
                 * "Not received" says something different (the supplier
                 * failed to send it) and belongs on the invoice.
                 *
                 * After arrival it asks first, because the line's QC rows
                 * outlive it: they are flagged over-quota rather than
                 * deleted, so a graded machine is never lost to a click here.
                 */}
                <Tooltip title={t("inbound.removeLine", "Remove this line")}>
                  <Button
                    size="small"
                    type="text"
                    danger
                    disabled={closed}
                    icon={<DeleteOutlined />}
                    aria-label={t("inbound.removeLine", "Remove this line")}
                    onClick={() => {
                      const drop = () => {
                        mutate((d) => {
                          const order = d.pos.find((p) => p.id === po.id)!;
                          order.items = order.items.filter(
                            (i) => i.id !== item.id,
                          );
                        });
                      };
                      if (!arrived) return drop();
                      modal.confirm({
                        title: t(
                          "inbound.removeLineTitle",
                          "Remove this line from the order?",
                        ),
                        content: t(
                          "inbound.removeLineBody",
                          "Its serials are not deleted. Any that were already graded stay in Serials & QC, marked over quota so you can decide what to do with each one.",
                        ),
                        okText: t("inbound.removeLineOk", "Remove line"),
                        okButtonProps: { danger: true },
                        onOk: drop,
                      });
                    }}
                  />
                </Tooltip>
              </Flex>
            ),
          },
        ]}
      />
    </Card>
  );

  /**
   * Serials & QC.
   *
   * One row per machine the order accounts for. A row with a serial IS a unit;
   * a row without one is a slot, and the only thing it will accept is the
   * serial that turns it into a unit. That order — identify, then grade — is
   * the whole shape of the screen, and it is why `Description` and the rest
   * are inert until the serial is in.
   */
  /**
   * A column header that says the field cannot be left empty.
   *
   * Every required column carries one (owner revision 2026-08-27), and only
   * the required ones do — a star on everything says nothing. It is
   * `aria-hidden`, because "Serial star" is not what a required field is
   * called. The fact itself reaches assistive tech from `aria-required` on the
   * control, which is where a requirement belongs — the star is how the
   * SIGHTED reader learns the same thing without tabbing into the cell.
   */
  const req = (label: string) => (
    <span>
      {label}{" "}
      <Typography.Text type="danger" aria-hidden>
        *
      </Typography.Text>
    </span>
  );

  /**
   * What a row still needs, said as a status rather than as a stage.
   *
   * This column used to render `unitStage`, which answers "how far has this
   * machine got" — a reasonable question, and not the one somebody standing at
   * the bench with a laptop in their hands is asking. They are asking *what do
   * I still have to do to this row*, and a tag reading "Arrived" does not say.
   * The owner put it plainly: the table looked like a report on data that
   * already existed, and left the person filling it in guessing which rows
   * were finished.
   *
   * So the three unfinished states name the missing field, and only a machine
   * that has actually left QC falls through to its stage.
   */
  const rowStatus = (r: QcRow): { label: string; color?: string } => {
    if (r.kind === "slot") {
      return {
        label: t("inbound.needsSerial", "Needs a serial"),
        color: "warning",
      };
    }
    if (r.unit.status !== "QC") {
      const stage = unitStage(r.unit);
      return {
        label: t(INBOUND_STAGE_LABEL[stage]),
        color: INBOUND_STAGE_COLOR[stage],
      };
    }
    if (!qcReady(r.unit)) {
      return {
        label: t("inbound.needsDescription", "Needs a description"),
        color: "warning",
      };
    }
    return {
      label: t("inbound.readyToAccept", "Ready to accept"),
      color: "blue",
    };
  };

  /**
   * The columns of one product's machines.
   *
   * One definition, called once per group. It takes no argument on purpose:
   * every group's table is the same table, and identical widths are what keeps
   * the blocks reading as one grid rather than as several that happen to be
   * stacked. A column that varied by group would break that on the first
   * product with a longer name.
   *
   * Product and Sell price are NOT here any more. Both are facts about the
   * variant, not about the machine, so they were the same value repeated down
   * every row of a group; they belong in the group's heading, said once. What
   * is left is exactly the things that differ per machine, which is what a row
   * was always supposed to be.
   */
  const qcColumns = (era: BatteryEra) => [
    {
      // Which machine of the group this is. The grid used to say "2 of 3
      // expected" inside the Product cell of every waiting row; as a column it
      // numbers the identified ones too, so "the third MacBook Air" is a thing
      // a person can point at across the bench.
      title: "#",
      key: "n",
      width: 48,
      fixed: "left" as const,
      // Grid only. Below `md` the row IS a card and its number is the card's
      // heading, so a field labelled "#" holding the same digit is furniture
      // repeating itself. `EditableTable` reads antd's own `responsive` for
      // this rather than inventing a second way to say it.
      responsive: ["md" as const],
      render: (_: unknown, __: QcRow, i: number) => (
        <Typography.Text type="secondary">{i + 1}</Typography.Text>
      ),
    },
    {
      title: req(t("inbound.serial", "Serial")),
      key: "serial",
      // Sized for what actually goes in it. Apple's longest serial is twelve
      // characters and the field takes fifteen, so the 260px this column had
      // until 2026-08-27 was 100px of white space.
      width: 176,
      fixed: "left" as const,
      render: (_: unknown, r: QcRow) => {
        // Past QC the serial is settled: it has a ledger behind it, and
        // correcting it there is a stock movement, not a retype.
        if (r.kind === "unit" && r.unit.status !== "QC") {
          return (
            <Link to={`/stock/history?serial=${r.unit.serial}`}>
              {r.unit.serial}
            </Link>
          );
        }
        const stored = r.kind === "unit" ? r.unit.serial : "";
        const shown = draft[r.key] ?? stored;
        const fault = serialFault[r.key];
        return (
          <Flex vertical gap={4}>
            <Flex align="center" gap={6}>
              {r.kind === "unit" && r.overQuota && (
                <Tooltip
                  title={t(
                    "inbound.overQuotaRow",
                    "No product line accounts for this machine any more.",
                  )}
                >
                  <WarningOutlined
                    style={{ color: "#d4380d" }}
                    aria-label={t("inbound.overQuotaAria", "Over quota")}
                  />
                </Tooltip>
              )}
              <Input
                size="small"
                // Tells the scanner this box is where a scan was aimed, so a
                // burst typed into it is left alone to land natively instead of
                // being reported as a stray. See lib/scanner.ts.
                data-scan-target=""
                disabled={closed}
                // The owner's number. It is the browser's own refusal — no
                // keystroke past the fifteenth is delivered — and `commitSerial`
                // says the same thing out loud for text that reached the box
                // some other way.
                // The STORE window, not the serial's: the field takes either
                // barcode, and truncating a pasted sticker to thirteen
                // characters would fail it on a length rule it never broke.
                maxLength={STORE_MAX_LENGTH}
                value={shown}
                /*
                 * Red beats amber, and an empty box cannot be both.
                 *
                 * A row still waiting reads as a prompt rather than as data to
                 * be edited around — that is the warning. A refused serial is
                 * not waiting, it is wrong, and the box holds the proof: the
                 * shape fault is the one refusal that leaves the text where it
                 * was typed.
                 */
                status={
                  fault ? "error" : shown.trim() === "" ? "warning" : undefined
                }
                aria-invalid={fault ? true : undefined}
                aria-errormessage={fault ? `serial-fault-${r.key}` : undefined}
                placeholder={t("inbound.scanOrType", "Scan or type the serial")}
                aria-label={t("inbound.serial", "Serial")}
                aria-required
                onChange={(e) => {
                  // Capitals whatever the keyboard is doing (owner ask
                  // 2026-09-01). A serial is stored upper-cased either way —
                  // `normaliseScan` sees to that on commit — but a box showing
                  // `sc02aa` while `SC02AA` is what gets filed is a field
                  // disagreeing with itself, and the mismatch is invisible
                  // until somebody compares the sticker with the screen.
                  setDraft((d) => ({
                    ...d,
                    [r.key]: e.target.value.toUpperCase(),
                  }));
                  // The refusal was about the text that WAS in the box. The
                  // moment it changes the accusation is stale, and a field that
                  // stayed red while somebody fixed it would be reporting a
                  // serial nobody can see any more.
                  if (fault) clearSerialFault(r.key);
                }}
                // Both commit. Enter is what a scanner sends; blur is what a
                // person does by reaching for the next field.
                onPressEnter={(e) => commitSerial(r, e.currentTarget.value)}
                onBlur={(e) => commitSerial(r, e.target.value)}
              />
            </Flex>
            {fault && (
              <Typography.Text
                type="danger"
                id={`serial-fault-${r.key}`}
                style={{ fontSize: 12, lineHeight: 1.3 }}
              >
                {serialFaultHint(fault.fault, fault.scanned)}
              </Typography.Text>
            )}
            {/*
             * The store barcode, under the serial (owner ask 2026-09-01).
             *
             * Derived from the STORED serial rather than from the draft: a
             * half-typed serial is not a fact about the machine yet, and a line
             * that rewrote itself per keystroke would be noise on the one column
             * somebody is typing into all day.
             */}
            {r.kind === "unit" && stored !== "" && (
              <StoreLabelTag serial={stored} supplierCode={supplierCodeOf()} />
            )}
          </Flex>
        );
      },
    },
    {
      /*
       * New or second (owner ask 2026-08-28).
       *
       * First of the fill-in columns, and deliberately so: it is the one
       * answer that changes what the rest of the row asks for. A sealed
       * machine needs no description and has nothing to grade; a second-hand
       * one needs both columns to its right.
       *
       * A Segmented rather than a checkbox reading "New". Two named states
       * beat one named state and its absence — "not ticked" would have to
       * mean second-hand, which is a fact somebody actually decided, not a
       * box they forgot.
       */
      title: t("inbound.condition", "Condition"),
      key: "condition",
      width: 150,
      render: (_: unknown, r: QcRow) => {
        const condition = conditionOfRow(r);
        // Past QC the condition is settled with everything else about the
        // machine: changing it is a regrade, and the way to one is Reopen.
        if (r.kind === "unit" && r.unit.status !== "QC") {
          return (
            <Typography.Text>
              {condition === "NEW"
                ? t("inbound.conditionNew", "New")
                : t("inbound.conditionSecond", "Second")}
            </Typography.Text>
          );
        }
        return (
          <Segmented<UnitCondition>
            size="small"
            disabled={closed}
            value={condition}
            aria-label={t("inbound.condition", "Condition")}
            onChange={(v) => setCondition(r, v)}
            options={[
              {
                value: "SECOND",
                label: t("inbound.conditionSecond", "Second"),
              },
              { value: "NEW", label: t("inbound.conditionNew", "New") },
            ]}
          />
        );
      },
    },
    {
      /*
       * Required for a second-hand machine, optional for a sealed one (owner
       * ask 2026-08-28), which is why the star carries an explanation now.
       *
       * The star stays rather than going: most of what this shop takes in is
       * second-hand, so a header with nothing on it would understate the rule
       * for almost every row. What it cannot do is be silently wrong on the
       * rows where it does not apply — hence the tooltip, and hence the
       * per-row `aria-required` below, which is where a screen reader gets the
       * fact that actually applies to the row it is on.
       */
      title: (
        <Tooltip
          title={t(
            "inbound.descriptionRequiredHint",
            "Required before a second-hand machine can be accepted. Optional on a new one — there is nothing to describe about a sealed box.",
          )}
        >
          <span>{req(t("inbound.description", "Description"))}</span>
        </Tooltip>
      ),
      key: "description",
      width: 360,
      render: (_: unknown, r: QcRow) => {
        if (r.kind === "unit" && r.unit.status !== "QC") {
          // Read-only, but still as the phrases it is made of — the same
          // shape the person who typed it saw.
          const parts = splitDescription(r.unit.description);
          return parts.length === 0 ? (
            "—"
          ) : (
            <Flex gap={4} wrap>
              {parts.map((p) => (
                <Tag key={p}>{p}</Tag>
              ))}
            </Flex>
          );
        }
        const shown =
          r.kind === "unit"
            ? splitDescription(r.unit.description)
            : (notes[r.key] ?? []);
        // A sealed machine's description is optional, so an empty one is not
        // an unanswered question and must not be painted as one.
        const wanted = needsDescription(conditionOfRow(r));
        return (
          /*
           * A list of phrases, not a sentence (owner revision 2026-08-27).
           *
           * "Mulus, fullset dus, charger original" is three facts about one
           * machine, and the shop writes the same facts machine after machine.
           * As free text they were three spellings waiting to happen and
           * nothing anyone could filter on. `mode="tags"` picks from the
           * shop's own vocabulary AND takes a phrase nobody has written before
           * — which joins the vocabulary on its way to the unit
           * (`ensureQcDescription`), so the list is the staff's own rather
           * than one somebody guessed in advance.
           *
           * The column still stores one string. `splitDescription` and
           * `joinDescription` are the whole of the conversion, and the comma
           * is what the shop had already been typing.
           */
          <Select<string[]>
            mode="tags"
            size="small"
            style={{ width: "100%" }}
            disabled={closed}
            value={shown}
            // A row nobody has described reads as an unanswered question
            // rather than as an optional note — but only where an answer is
            // actually owed.
            status={wanted && shown.length === 0 ? "warning" : undefined}
            placeholder={
              wanted
                ? t(
                    "inbound.conditionPlaceholder",
                    "Condition, marks, what is in the box…",
                  )
                : t("inbound.describeOptional", "Optional on a new machine")
            }
            aria-label={t("inbound.description", "Description")}
            aria-required={wanted}
            // The comma is the separator in the column, so it is the separator
            // in the box: pasting "Mulus, fullset dus" makes two tags rather
            // than one tag with a comma in it that would come back as two.
            tokenSeparators={[","]}
            options={db.qcDescriptions
              .filter((d) => d.active)
              .map((d) => ({ value: d.label }))}
            filterOption={(input, opt) =>
              String(opt?.value ?? "")
                .toLowerCase()
                .includes(input.toLowerCase())
            }
            onChange={(parts: string[]) => {
              // A slot has nowhere to write it yet — the draft IS the value
              // until a serial turns the row into a machine, and `identify`
              // carries it across.
              if (r.kind === "slot") {
                setNotes((n) => ({ ...n, [r.key]: parts }));
              } else {
                writeDescription(r.unit.serial, parts);
              }
            }}
          />
        );
      },
    },
    {
      /*
       * The battery, in whichever units this product's era reports (owner ask
       * 2026-09-08).
       *
       * A 2020-or-earlier machine shows two boxes — charge cycles and full
       * charge capacity — and a 2021-or-later one shows the percentage it has
       * always shown. The title says which, because a column headed "Battery
       * Health" over a box wanting a cycle count is a column that gets a
       * percentage typed into it.
       *
       * The one column definition per group that DOES vary, against the rule
       * in `qcColumns`' docblock. The width does not, which is what that rule
       * was protecting: the blocks still line up as one grid.
       */
      title: batteryFieldsLabel(era, t),
      key: "battery",
      width: era === "CYCLES" ? 150 : 120,
      render: (_: unknown, r: QcRow) => {
        if (r.kind === "unit" && r.unit.status !== "QC") {
          const read = readBattery(
            r.unit,
            db.models.find(
              (m) => m.id === db.skus.find((x) => x.id === r.skuId)?.modelId,
            )?.releaseYear,
            batterySettings,
          );
          return read.grade === null ? (
            "—"
          ) : (
            <Tag color={BATTERY_GRADE_COLOR[read.grade]}>{read.text}</Tag>
          );
        }
        const stored =
          r.kind === "unit" ? batteryDraftOf(r.unit) : ({} as BatteryDraft);
        const draft = battery[r.key] ?? {};
        // The draft wins per FIELD, not per row: somebody who typed a cycle
        // count and has not touched the capacity should still see the
        // capacity the store holds.
        const shown: BatteryDraft = {
          health: draft.health === undefined ? stored.health : draft.health,
          cycleCount:
            draft.cycleCount === undefined
              ? stored.cycleCount
              : draft.cycleCount,
          fcc: draft.fcc === undefined ? stored.fcc : draft.fcc,
        };
        return (
          <BatteryFields
            era={era}
            value={shown}
            disabled={closed}
            idPrefix={`battery-${r.key}`}
            onChange={(next) =>
              setBattery((d) => ({ ...d, [r.key]: next }))
            }
            // Both commit, as the serial field's do.
            onCommit={(field, value) => commitBattery(r, field, value)}
          />
        );
      },
    },
    {
      /*
       * What this machine will be asked for (owner ask 2026-09-08).
       *
       * *"Price should be set per serial … and will be determined right after
       * QC."* So it is a column here, which it was until 2026-08-27 and then
       * was not: the price moved to the variant for eight days and has come
       * back to the serial, because two 2017 Airs off one pallet are not worth
       * the same money.
       *
       * The store box starts at what the shop asks for the variant — visible
       * in the block's heading — so the common case is confirming a number
       * rather than inventing one. The marketplace box follows the rule until
       * somebody overrides it.
       */
      title: t("inbound.price", "Price"),
      key: "price",
      // Wider since the two boxes started saying which is which (2026-09-09).
      // "Marketplace price" over an Rp box needs the room, and a caption that
      // wraps onto two lines is a caption that has stopped being a label.
      width: 200,
      render: (_: unknown, r: QcRow) => {
        const sku = db.skus.find((x) => x.id === r.skuId);
        const stored: PriceDraft =
          r.kind === "unit"
            ? {
                price: r.unit.price ?? sku?.price ?? null,
                marketPrice: r.unit.marketPrice ?? null,
              }
            : { price: sku?.price ?? null, marketPrice: null };
        const draft = prices[r.key] ?? {};
        const shown: PriceDraft = {
          price: draft.price === undefined ? stored.price : draft.price,
          marketPrice:
            draft.marketPrice === undefined
              ? stored.marketPrice
              : draft.marketPrice,
        };
        return (
          <PriceFields
            value={shown}
            markupPct={markupPct}
            disabled={closed}
            idPrefix={`qc-price-${r.key}`}
            onChange={(next) => setPrices((d) => ({ ...d, [r.key]: next }))}
            onCommit={(field, value) => commitPrice(r, field, value)}
          />
        );
      },
    },
    {
      /*
       * The grade, and the inspection behind it (owner ask 2026-08-27).
       *
       * Optional, unlike the description: a machine can be accepted ungraded.
       * The button opens the category's checklist — Settings → Grading — and
       * the letter falls out of the rule table, overridable, because a rule
       * table cannot see the machine. Typable before the serial is, like every
       * other column: a slot's letter waits in `gradeDrafts` and `identify`
       * carries it onto the unit.
       */
      title: t("inbound.grade", "Grade"),
      key: "grade",
      width: 110,
      render: (_: unknown, r: QcRow) => {
        const grade = r.kind === "unit" ? r.unit.grade : gradeDrafts[r.key];
        const tag = <GradeTag grade={grade} plain />;
        if (r.kind === "unit" && r.unit.status !== "QC") return tag;
        // Not offered on a sealed machine (owner ask 2026-08-28): there is no
        // screen to look at and no case to mark, so a checklist would be a
        // form asking about a box nobody has opened. Hidden rather than
        // disabled — a control that can never apply is not a control, and the
        // cell already says "New", which is the answer the button would be
        // for.
        if (!canGrade(conditionOfRow(r))) return tag;
        return (
          <Flex align="center" gap={6}>
            {tag}
            <Tooltip
              title={t(
                "inbound.gradeHint",
                "Grade it against the category's checklist",
              )}
            >
              <Button
                size="small"
                type="text"
                disabled={closed}
                icon={<AuditOutlined />}
                aria-label={
                  r.kind === "unit"
                    ? t("inbound.gradeAria", "Grade {{serial}}", {
                        serial: r.unit.serial,
                      })
                    : t("inbound.gradeSlotAria", "Grade this machine")
                }
                onClick={() => openGrading(r)}
              />
            </Tooltip>
          </Flex>
        );
      },
    },
    {
      /*
       * A picture per serial, at QC (owner decision 2026-08-26).
       *
       * Grading a second-hand machine is a claim about its condition, and six
       * weeks later the customer's memory of that condition and the shop's are
       * different memories. Description is one person's word for it; this is
       * the evidence behind the word, taken at the one moment the machine is
       * in somebody's hands with the screen in front of them.
       *
       * The one column a serial still gates, and the gate is the schema's
       * rather than the flow's: a photograph hangs off a `UnitNote`, which
       * points at a unit. Until the serial is in there is no unit to point at.
       *
       * Only while the unit is in QC. Afterwards the pictures are shown but
       * not added to: a photograph dated after the machine reached the shelf
       * is not evidence of what arrived. They are purged outright when it
       * sells — `purgeQcPhotos`.
       */
      title: t("inbound.photo", "Photo"),
      key: "photo",
      width: 150,
      render: (_: unknown, r: QcRow) =>
        r.kind === "slot" ? (
          <Tooltip
            title={t(
              "inbound.photoNeedsSerial",
              "A photo is filed against the machine, so this one needs its serial first.",
            )}
          >
            <Typography.Text type="secondary">
              {t("inbound.afterTheSerial", "After the serial")}
            </Typography.Text>
          </Tooltip>
        ) : (
          <UnitPhotos
            serial={r.unit.serial}
            editable={!closed && r.unit.status === "QC"}
          />
        ),
    },
    {
      title: t("inbound.status", "Status"),
      key: "status",
      width: 176,
      render: (_: unknown, r: QcRow) => {
        const { label, color } = rowStatus(r);
        return <Tag color={color}>{label}</Tag>;
      },
    },
    {
      /*
       * Everything you can DO to a row, in one place at the right edge (owner
       * revision 2026-08-27).
       *
       * Accept used to have a column of its own beside the three icons, which
       * meant the row's actions were split across two column boundaries and
       * neither group was anchored — scroll right for the battery box and the
       * buttons went with it. They are one fixed column now, so the thing you
       * press is in the same place on every row whatever the table is
       * scrolled to.
       */
      title: t("inbound.action", "Action"),
      key: "actions",
      width: 176,
      fixed: "right" as const,
      align: "right" as const,
      render: (_: unknown, r: QcRow) => {
        if (r.kind === "slot" || closed) return null;
        const serial = r.unit.serial;

        // A decision already taken, and the way back out of it.
        if (r.unit.status !== "QC") {
          const can = canReopenQc(r.unit);
          return (
            <Tooltip
              title={
                can
                  ? t(
                      "inbound.reopenHint",
                      "Wrong machine? Put it back into QC and decide again",
                    )
                  : t(
                      "inbound.reopenBlocked",
                      "This machine has been promised or sold. Correct it where that happened, not here.",
                    )
              }
            >
              {/* A span, because a disabled antd Button swallows the pointer
                  events its own tooltip needs — and the tooltip is the entire
                  explanation of why it is disabled. */}
              <span>
                <Button
                  size="small"
                  icon={<UndoOutlined />}
                  disabled={!can}
                  aria-label={t(
                    "inbound.reopenAria",
                    "Reopen QC for {{serial}}",
                    { serial },
                  )}
                  onClick={() => reopenQc(serial)}
                >
                  {t("inbound.reopen", "Reopen")}
                </Button>
              </span>
            </Tooltip>
          );
        }

        // What QC is FOR, and what it therefore cannot skip. The price used to
        // be half of this — the rule the database enforced with a CHECK — and
        // went with the per-unit price on 2026-08-27: a variant is always
        // priced, so there is nothing left for QC to be missing on that count.
        // The description carries the gate alone: a second-hand machine that
        // reaches the shelf without anyone writing down its condition is one
        // nobody can list or answer a question about later.
        //
        // Reads the store, not a draft. A description is a list of tags now
        // and every tag is written the moment it is chosen, so there is no
        // uncommitted value for the gate to miss — which is what the old
        // blur-commit made this read around.
        //
        // `qcReady` since 2026-08-28, so the button, the status tag and the
        // group heading cannot disagree about whether a row is finished — and
        // so that a machine marked New, which owes no description, is
        // acceptable the moment it has a serial.
        const missing = qcReady(r.unit)
          ? []
          : [t("inbound.missingDescription", "a description")];
        return (
          <Flex gap={4} justify="end" align="center">
            <Tooltip
              title={
                missing.length === 0
                  ? t("inbound.acceptHint", "Accept into sellable stock")
                  : t("inbound.needBeforeAccept", "Still needs {{what}}", {
                      what: missing.join(" and "),
                    })
              }
            >
              <span>
                <Button
                  size="small"
                  type="primary"
                  icon={<CheckOutlined />}
                  disabled={missing.length > 0}
                  // The only button in the row that had no name of its own.
                  // Four buttons reading "Accept" down a group of three
                  // MacBook Airs is four buttons a screen reader cannot tell
                  // apart.
                  aria-label={t("inbound.acceptAria", "Accept {{serial}}", {
                    serial,
                  })}
                  onClick={() =>
                    mutate((d) => {
                      appendEvent(d, serial, {
                        type: "QC_SELESAI",
                        toStatus: "TERSEDIA",
                        refCode: po.code,
                        note: "QC passed",
                      });
                    })
                  }
                >
                  {t("inbound.accept", "Accept")}
                </Button>
              </span>
            </Tooltip>
            <Tooltip
              title={t(
                "inbound.serviceHint",
                "Send to the bench instead of the shelf",
              )}
            >
              <Button
                size="small"
                type="text"
                icon={<ToolOutlined />}
                aria-label={t(
                  "inbound.serviceAria",
                  "Send {{serial}} to service",
                  { serial },
                )}
                onClick={() => setSendingToService(serial)}
              />
            </Tooltip>
            <Tooltip
              title={t(
                "inbound.rejectHint",
                "Refuse it and open a supplier return",
              )}
            >
              <Button
                size="small"
                type="text"
                danger
                icon={<CloseCircleOutlined />}
                aria-label={t(
                  "inbound.rejectAria",
                  "Reject {{serial}} back to the supplier",
                  { serial },
                )}
                onClick={() => rejectToSupplier(serial)}
              />
            </Tooltip>
            {/*
             * Deleting a QC row.
             *
             * Offered only while the unit is still in QC, which is the only
             * period in which nothing has happened to it beyond arriving. Once
             * a unit has been accepted, refused or sent to service it has a
             * timeline — and the way to undo one of those is Reopen above,
             * which appends a correction rather than making it as though the
             * machine never arrived. CLAUDE.md's one rule: nothing with a
             * history is hard-deleted.
             *
             * The row it leaves behind is a slot, because the invoice still
             * says the machine is here. That is the point: the order goes on
             * asking for a serial rather than quietly losing a machine.
             */}
            <Tooltip
              title={t(
                "inbound.removeSerial",
                "Remove this machine from the order",
              )}
            >
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label={t("inbound.removeSerialAria", "Remove {{serial}}", {
                  serial,
                })}
                onClick={() =>
                  modal.confirm({
                    title: t(
                      "inbound.removeSerialTitle",
                      "Remove this serial row?",
                    ),
                    content: t(
                      "inbound.removeSerialBody",
                      "{{serial}} and everything recorded against it go. If a product line still expects the machine, the row comes back empty, waiting for a serial.",
                      { serial },
                    ),
                    okText: t("inbound.removeSerialOk", "Remove row"),
                    okButtonProps: { danger: true },
                    onOk: () =>
                      mutate((d) => {
                        d.units = d.units.filter((x) => x.serial !== serial);
                        d.events = d.events.filter((e) => e.serial !== serial);
                      }),
                  })
                }
              />
            </Tooltip>
          </Flex>
        );
      },
    },
  ];

  /**
   * What one product's group of machines still owes, as tags.
   *
   * The heading is where the screen answers "what is left to do here?", and
   * before 2026-08-27 nothing answered it: the person filling the grid in had
   * to read every row and count. Each tag is one outstanding thing, and a
   * group with none of them says so in one word.
   */
  const groupProgress = (g: QcGroup) => {
    const tags: ReactNode[] = [];
    // Worded without a verb, so one machine and four read the same. "1 still
    // need a serial" is what a plural-agnostic sentence costs; a noun phrase
    // costs nothing and is shorter on a tag this size.
    if (g.waiting > 0) {
      tags.push(
        <Tag key="w" color="warning">
          {t("inbound.needSerials", "{{count}} without a serial", {
            count: g.waiting,
          })}
        </Tag>,
      );
    }
    if (g.needDescription > 0) {
      tags.push(
        <Tag key="d" color="warning">
          {t("inbound.needDescriptions", "{{count}} without a description", {
            count: g.needDescription,
          })}
        </Tag>,
      );
    }
    if (g.overQuota > 0) {
      tags.push(
        <Tag key="o" color="error">
          {t("inbound.overQuotaTag", "{{count}} over quota", {
            count: g.overQuota,
          })}
        </Tag>,
      );
    }
    const ready = g.rows.filter(
      (r) => r.kind === "unit" && r.unit.status === "QC" && qcReady(r.unit),
    ).length;
    if (ready > 0) {
      tags.push(
        <Tag key="r" color="blue">
          {t("inbound.readyTag", "{{count}} ready to accept", { count: ready })}
        </Tag>,
      );
    }
    if (tags.length === 0) {
      tags.push(
        <Tag key="ok" color="success" icon={<CheckOutlined />}>
          {t("inbound.groupDone", "All done")}
        </Tag>,
      );
    }
    return tags;
  };

  /**
   * Serials & QC.
   *
   * One row per machine the order accounts for. A row with a serial IS a unit;
   * a row without one is a slot.
   *
   * ## Grouped by product (owner revision 2026-08-27)
   *
   * It was one flat table with a Product column, and the owner's verdict was
   * that it read as a display table rather than as the form it is: every row
   * repeated the product above it, a row still owed looked exactly like a row
   * already filled, and nothing on the screen said how many machines of a
   * product were still outstanding.
   *
   * A group per product says the product once, in a heading, and puts the
   * outstanding counts beside it. The variant's asking price goes up there
   * too, for the same reason — it is a fact about the variant, so as a column
   * it was one number repeated down every row of the group.
   *
   * ## Every column is typable, in any order (owner revision 2026-08-27)
   *
   * It used to be identify-then-grade: Description, Battery and Photo were
   * inert on a slot and said "Enter the serial first". That is not how a
   * machine is graded. The serial is on a sticker on the underside, and a
   * person holding an open laptop reads the battery off the screen and the
   * marks off the lid long before they turn it over. Making the screen insist
   * on the sticker first meant putting the machine down and picking it up
   * again, per machine, all day.
   *
   * So a slot holds what has been typed into it and `identify` carries the lot
   * onto the unit at the moment a serial arrives — see `reslotDrafts` for the
   * one thing that makes that hard. The serial is still REQUIRED, and the star
   * in its header is how the screen says so; it is simply no longer first.
   */
  const qc = (
    <Card
      title={t("inbound.serialsQc", "Serials & QC")}
      extra={
        units.length > 0 && (
          <Flex gap={8} wrap>
            {/*
             * Accept everything that is ready (owner ask 2026-09-01), to the
             * LEFT of Print labels because it is the earlier job: a machine
             * gets onto the shelf and then gets a sticker.
             *
             * It is a shortcut for pressing the row's own Accept N times, not
             * a different decision — same gate (`qcReady`), same event, same
             * status. A row that still owes a description is not in the count
             * and is not touched, which is why the button can be plain about
             * how many it will take: the number IS what will move.
             *
             * Disabled rather than hidden when none is ready. A control that
             * comes and goes as rows are filled in is a control nobody learns
             * is there, and the tooltip is what says why it is off.
             */}
            {!closed && (
              <Tooltip
                title={
                  readyToAccept.length === 0
                    ? t(
                        "inbound.acceptAllNoneReady",
                        "Nothing is ready yet. A second-hand machine needs a description before it can be accepted.",
                      )
                    : t(
                        "inbound.acceptAllHint",
                        "Move every graded machine on this invoice into sellable stock",
                      )
                }
              >
                {/* A span, because a disabled antd Button swallows the pointer
                    events its own tooltip needs. */}
                <span>
                  <Button
                    type="primary"
                    icon={<CheckOutlined />}
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
            <Button
              icon={<PrinterOutlined />}
              onClick={() =>
                setPrinting(
                  labelsFor(units, db.skus, db.models, supplierCodeOf),
                )
              }
            >
              {t("inbound.printLabels", "Print labels")}
            </Button>
          </Flex>
        )
      }
    >
      {overQuota > 0 && (
        // Stated once above the groups as well as marked on each row. A red
        // row says "something is wrong here"; only a sentence can say what,
        // and what to do about it.
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title={t(
            "inbound.overQuotaTitle",
            "{{count}} serial(s) are no longer covered by a product line",
            { count: overQuota },
          )}
          description={t(
            "inbound.overQuotaBody",
            "A quantity came down after these machines were graded, so they were kept rather than deleted. Put the quantity back if it was a mistake, or remove each row once you know where the machine went.",
          )}
        />
      )}
      {!arrived ? (
        <Empty
          description={t(
            "inbound.nothingReceived",
            "Nothing received yet. Mark the order arrived to start recording serials.",
          )}
        />
      ) : groups.length === 0 ? (
        <Empty
          description={t(
            "inbound.nothingExpected",
            "No products on this order yet. Add a line and a row appears here for every machine it expects.",
          )}
        />
      ) : (
        <Flex vertical gap={16}>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            {t(
              "inbound.qcHint",
              "One block per product, one row per machine it expects. Fill a row in whatever order the machine gives it to you — the serial can come last. Scanning with focus anywhere on this page drops a serial into the next row still waiting.",
            )}
          </Typography.Paragraph>
          {groups.map((g) => {
            const sku = db.skus.find((s) => s.id === g.skuId);
            return (
              <Card
                key={g.skuId}
                size="small"
                // The heading answers the two questions a column could not:
                // which product these machines are, and how many of them the
                // invoice is still waiting on.
                title={
                  <Flex align="center" gap={8} wrap>
                    <Typography.Text strong>
                      {skuLabel(g.skuId)}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {t(
                        "inbound.identifiedOf",
                        "{{done}} of {{total}} identified",
                        {
                          done: g.identified,
                          total: Math.max(g.quota, g.identified),
                        },
                      )}
                    </Typography.Text>
                    {groupProgress(g)}
                  </Flex>
                }
                /*
                 * The variant's ASKING price, said once above the machines it
                 * applies to.
                 *
                 * It was the price for eight days (2026-08-27 to 2026-09-08)
                 * and is the starting point again: every row's price box
                 * begins here, and the grading moves it. Kept in the heading
                 * rather than repeated down a column, because it is a fact
                 * about the variant and the column now holds facts about
                 * machines.
                 */
                extra={
                  sku && (
                    <Typography.Text type="secondary">
                      {t("inbound.weAsk", "We ask {{price}}", {
                        price: fmtRp(sku.price),
                      })}
                    </Typography.Text>
                  )
                }
              >
                <EditableTable<QcRow>
                  size="small"
                  rowKey="key"
                  dataSource={g.rows}
                  /*
                   * A line-item editor: these columns ARE the form. It kept a
                   * grid on a phone until 2026-09-01, behind a sideways
                   * scroll — nine columns in 375px is nine slivers, and the
                   * owner asked for rows instead. `EditableTable` stacks each
                   * machine into a card of labelled full-width fields below
                   * `md` and leaves the grid exactly as it was above it.
                   *
                   * The grid's width used to be a hand-maintained constant
                   * that "has to BE the sum" of the columns and drifted the
                   * first time one was resized. It is summed from the columns
                   * now; there is nothing left to keep in step.
                   */
                  rowTitle={(r, i) =>
                    r.kind === "unit" ? r.unit.serial : `#${i + 1}`
                  }
                  // Denser than antd's `small`, which is still built for
                  // reading rather than for filling in. See global.css.
                  className="qc-table"
                  // The red row the owner asked for. A class rather than an
                  // inline style so the colour comes from the theme and
                  // survives dark mode — a hard-coded pink on a dark surface
                  // is unreadable.
                  rowClassName={(r) =>
                    r.kind === "unit" && r.overQuota ? "row-over-quota" : ""
                  }
                  columns={qcColumns(eraOfSku(g.skuId))}
                />
              </Card>
            );
          })}
        </Flex>
      )}
    </Card>
  );

  /** What the selected bucket still owes — what the quick-fill button offers. */
  const owedForPicked = totals.owedFor[payFor];

  return (
    <PageContainer
      title={po.code}
      backTo="/inbound"
      actions={
        closed
          ? undefined
          : [
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
           * The banner IS the way back, and it is deliberately one click.
           *
           * A closed order that took three steps to reopen would be an order
           * staff work around — they would raise a second one rather than
           * correct the first, and the shop would end up with two documents
           * for one purchase. Closing is a filing decision, so undoing it
           * costs what a filing decision costs.
           */
          <Alert
            type="info"
            showIcon
            title={t("inbound.closedTitle", "This invoice is closed")}
            description={t(
              "inbound.closedBody",
              "Closed {{when}}. Nothing on the order can be changed — reopen it to record a payment, edit a line or grade a machine.",
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
        {header}
        {money}
        {products}
        {qc}
      </Flex>

      {/*
       * Sending a machine for a repair (owner revision 2026-09-09).
       *
       * A form rather than a `modal.confirm`, because there are now three
       * things to say and one of them changes the other two: whether the
       * machine has to travel to the bench decides whether a courier's charge
       * makes any sense to ask for. See `sendToService`.
       */}
      <Modal
        open={sendingToService !== null}
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
          // Shipped by default, because the common case is the one that costs
          // money: the bench is a different building, and a machine graded in
          // warehouse 1 has to get there.
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
                "Leave this off if the machine is already at the bench, or if the repairer collects it. The bench confirms the arrival either way before work starts.",
              )}
            >
              <Switch />
            </Form.Item>
          )}
          <Form.Item
            noStyle
            shouldUpdate={(a, b) => a.ship !== b.ship}
          >
            {({ getFieldValue }) =>
              bench && getFieldValue("ship") ? (
                <Form.Item
                  name="shippingFee"
                  label={t("inbound.serviceShippingFee", "Cost of getting it there")}
                  tooltip={t(
                    "inbound.serviceShippingFeeHint",
                    "The courier between the two warehouses. It joins what this machine has cost the shop.",
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
        open={payOpen}
        title={t("inbound.recordAPayment", "Record a payment")}
        okText={t("inbound.record", "Record")}
        onCancel={() => setPayOpen(false)}
        onOk={() => {
          if (!payAmount || payAmount <= 0) {
            message.error(
              t("inbound.enterHowMuch", "Enter how much was paid."),
            );
            return;
          }
          const applied = payFor;
          mutate((d) => {
            d.pos
              .find((p) => p.id === po.id)!
              .payments.push({
                id: nextId("pp"),
                method: payMethod,
                amount: payAmount,
                at: new Date().toISOString(),
                appliedTo: applied,
              });
          });
          setPayAmount(undefined);
          // The bucket is NOT reset. Somebody settling three orders' shipping
          // in one sitting picks "Shipping" once, and a control that snaps
          // back to Products between them is a control they will forget to set
          // on the third.
          setPayOpen(false);
          message.success(
            t("inbound.paymentRecorded", "Payment recorded against {{what}}.", {
              what: t(PO_PAYMENT_FOR_LABEL[applied]).toLowerCase(),
            }),
          );
        }}
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
              aria-label={t("inbound.method", "Method")}
              options={db.paymentMethods
                .filter((m) => m.forPo && m.active)
                .map((m) => ({ value: m.code, label: m.label }))}
            />
          </Flex>
          <Flex vertical gap={4}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("inbound.appliedTo", "Applied to")}
            </Typography.Text>
            {/*
             * The owner's second ask of 2026-08-27. Shipping is paid to a
             * forwarder and tax to the state, and recording either as "paid
             * the supplier" is how an order reads as settled while the ongkir
             * is still outstanding.
             *
             * Each option carries its own balance, because the number is the
             * reason you are picking the bucket at all.
             */}
            <Select<PoPaymentFor>
              value={payFor}
              onChange={setPayFor}
              aria-label={t("inbound.appliedTo", "Applied to")}
              options={(["ORDER", "SHIPPING", "TAX"] as const).map(
                (bucket) => ({
                  value: bucket,
                  label: `${t(PO_PAYMENT_FOR_LABEL[bucket])} — ${
                    totals.owedFor[bucket] > 0
                      ? t("inbound.owedShort", "{{amount}} owed", {
                          amount: fmtRp(totals.owedFor[bucket]),
                        })
                      : t("inbound.bucketSettled", "settled")
                  }`,
                }),
              )}
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
          {owedForPicked > 0 && (
            // Fills the balance of the bucket that is selected, not the
            // order's. Somebody who has just chosen "Shipping" wants the
            // ongkir, and offering them the whole invoice is offering them the
            // wrong number in one click.
            <Button size="small" onClick={() => setPayAmount(owedForPicked)}>
              {t(
                "inbound.payTheBalance",
                "Pay the {{what}} balance — {{amount}}",
                {
                  what: t(PO_PAYMENT_FOR_LABEL[payFor]).toLowerCase(),
                  amount: fmtRp(owedForPicked),
                },
              )}
            </Button>
          )}
        </Flex>
      </Modal>

      {/*
       * The inspection behind a grade.
       *
       * The dialog itself lives in `components/GradingModal` since
       * 2026-08-28, because the return desk grades a machine coming back with
       * exactly the same checklist — see that file for why one dialog rather
       * than two.
       *
       * What stays here is the CONSEQUENCE, which is intake's alone: a C can
       * go back to the supplier or onto the bench, and neither is a thing the
       * return desk can do with a machine the shop already owns. Only a unit
       * gets those buttons; a slot has no serial to reject.
       */}
      {grading && (
        <GradingModal
          open
          onClose={() => setGrading(null)}
          category={categoryOfSku(grading.skuId)}
          subject={`${skuLabel(grading.skuId)} · ${
            grading.kind === "unit"
              ? grading.unit.serial
              : t("inbound.gradeNoSerialYet", "no serial yet")
          }`}
          currentGrade={
            grading.kind === "unit"
              ? grading.unit.grade
              : gradeDrafts[grading.key]
          }
          onApply={(grade, inspection) =>
            applyGrade(grading, grade, inspection)
          }
          cActions={(finish) =>
            grading.kind === "unit" ? (
              <Flex vertical gap={4}>
                <Button
                  size="small"
                  danger
                  onClick={() => {
                    const serial = grading.unit.serial;
                    finish();
                    rejectToSupplier(serial);
                  }}
                >
                  {t("inbound.rejectOk", "Return to supplier")}
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    const serial = grading.unit.serial;
                    finish();
                    setSendingToService(serial);
                  }}
                >
                  {t("inbound.serviceOk", "Send to service")}
                </Button>
              </Flex>
            ) : undefined
          }
        />
      )}

      <PrintLabelsModal
        open={printing !== null}
        labels={printing ?? []}
        onClose={() => setPrinting(null)}
      />
    </PageContainer>
  );
}
