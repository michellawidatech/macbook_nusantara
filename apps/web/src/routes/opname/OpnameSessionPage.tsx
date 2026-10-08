/**
 * Counting a warehouse — the scan screen, the review, and what a posted count
 * looks like afterwards.
 *
 * ## Everything the count expects is on screen from the start
 *
 * Owner brief 2026-09-19: *"Show all the unit early, move upward & show status
 * & green/red."* From the moment a draft opens, ONE table lists every unit the
 * count's scope expects plus every scanned serial it did not expect, each with
 * its answer in colour: found (green), not scanned yet (red), belongs
 * elsewhere (orange), not in system (red). `lib/opnameCount.ts` holds what the
 * answers mean and the order they come in.
 *
 * This reverses the screen's first design, a blind count. It listed only what
 * had been scanned and hid the expected units until the counter said they were
 * done, on the argument that somebody who can see the list stops counting and
 * starts ticking. That was this page's own reasoning, never an owner decision,
 * and it kept from the counter the one thing they need in the middle of a
 * count — what is still left to find — until the racks had been walked once
 * already. The worry it answered does not fit this table anyway: there is
 * nothing on it to tick. A row turns green only when its serial comes through
 * the scan box, read off the unit.
 *
 * Scanned rows move to the top, the latest first, so what the last read did is
 * the first thing under the scan box; everything not scanned yet stays below,
 * in shelf order.
 *
 * ## Two steps, not three
 *
 * Counting, then the review that posts. The *expected in this scope* step
 * that sat between them (2026-09-01) existed to show, before posting, what the
 * blind count had hidden — and the counting table now shows it from the first
 * scan. See `phase`.
 *
 * ## History is a dialog, not a column of the page
 *
 * The screen used to be split: the count on the left, and the timeline of
 * whichever serial was last touched pinned to the right. It read well on a
 * laptop and badly everywhere else — the panel took a third of the width from
 * the table that matters, and on anything narrower it wrapped BELOW the count,
 * so seeing a unit's history meant scrolling past every row that had been
 * counted. The owner asked for a popup instead (2026-08-26). A row's history is
 * now an icon button that opens `UnitTimeline` in a modal: same information,
 * none of the width, and it works the same on a phone.
 *
 * ## A posted count is a record, not a document
 *
 * Posting writes events against real units — missing ones are marked lost — so
 * the numbers stop being a working draft and become the account of what was
 * found that day. Two things follow, both owner decisions:
 *
 * 1. **It is read-only.** No editing a serial, no removing a row, no posting
 *    twice. Editing a posted count would silently disagree with the ledger it
 *    already wrote.
 * 2. **It reads its own stored numbers**, and this is the bug behind "there's
 *    missing values". `missing` was recomputed on every render from units
 *    currently in stock — but posting had just set every missing unit to
 *    `HILANG`, which removes it from the expected list. So reopening a posted
 *    count showed zero missing and zero unknown, every time, however many it
 *    had actually found. A draft still recomputes, because a draft is exactly
 *    the thing that should follow the stock as it moves.
 *
 * That is also why a posted count opens on the review's record of what was
 * found rather than on the counting table: the table is computed from the
 * stock as it is NOW, which posting changed.
 *
 * What a posted count CAN still do is start an adjustment — a unit turns up a
 * week later, or a lost one is found. That is a stock movement with its own
 * event, not an edit to the count, so the button leads to the Stock Movement
 * batch editor rather than unlocking anything here.
 *
 * ## Duplicates
 *
 * Scanning the same serial twice is normal in a long count — a shelf gets
 * revisited. It counts once. Rather than a toast that says so and vanishes,
 * the row already holding that serial moves back to the top, where the latest
 * scan always is, and flashes — which answers the counter's actual question
 * ("did that one go in?") by showing them the row.
 */
import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  App,
  Alert,
  AutoComplete,
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
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import type { InputRef } from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  EnvironmentOutlined,
  HistoryOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { PageContainer } from "../../components/PageContainer";
import { FooterToolbar } from "../../components/FooterToolbar";
import { DataTable } from "../../components/DataTable";
import { LongText } from "../../components/LongText";
import { UnitTimeline } from "../../components/UnitTimeline";
import { UnitPhotos } from "../../components/UnitPhotos";
import { EnumTag } from "../../components/EnumTag";
import { UNIT_STATUS } from "../../i18n/enumLabels.js";
import { fmtDate, fmtNone, fmtTime } from "../../lib/format.js";
import {
  useDb,
  mutate,
  appendEvent,
  ensureReason,
  nextId,
  currentStaffName,
  qcPhotosOf,
} from "../../mock/store.js";
import { useScanTarget } from "../../hooks/useScanTarget.js";
import { resolveSerialQuery } from "../../lib/serialInput.js";
import { skuTracksSerial } from "../../lib/serialTracking.js";
import { averageCost, stockLevels } from "../../lib/stock.js";
import {
  countedInScope,
  inOpnameScope,
  scopeOf,
  soleLocation,
  type OpnameScope,
} from "../../lib/opnameScope.js";
import {
  countRows,
  recordScan,
  removeScan,
  restoreScans,
  scanStatus,
  type CountStatus,
} from "../../lib/opnameCount.js";
import { ScopeFields } from "./ScopeFields.js";
import {
  CONDITIONS,
  gradeForCondition,
  type UnitCondition,
} from "../../lib/condition.js";
import type { OpnameSurplus, Unit } from "../../mock/seed.js";
import { COLUMN } from "../../theme/tokens";
import { warehouseLabel, warehouseLabelOf } from "../../lib/warehouses.js";

/** Statuses that mean the warehouse should physically be holding the unit. */
const IN_STOCK = ["TERSEDIA", "DIRESERVASI", "QC"];

/**
 * How long after the last change the draft writes itself.
 *
 * Long enough that a scanner burst and a typed sentence each land as one
 * save, short enough that a lid closed in irritation loses a second of work
 * rather than a shelf's worth.
 */
const AUTOSAVE_DELAY_MS = 1200;

/** How long a re-scanned row stays lit. A hint, not a state — see `flash`. */
const FLASH_MS = 1600;

/**
 * The attribute each row of the counting table carries its serial in — on the
 * `<tr>` on a desktop, on the card on a phone, because `DataTable` hands the
 * same `onRow` props to both. It is how the page finds the top row to bring
 * into view after a scan.
 */
const ROW_ATTR = "data-count-row";

/** The props that put `ROW_ATTR` on a row. A function so antd's `onRow` can spread it. */
const rowAttrs = (serial: string) => ({ [ROW_ATTR]: serial });

/** One row of the counting table. `lib/opnameCount.ts` decides `status`. */
interface LiveRow {
  serial: string;
  status: CountStatus;
  /** The unit carrying this serial, when the shop has one. */
  unit: Unit | undefined;
  /** The most recent scan — always the top row, while anything is scanned. */
  latest: boolean;
}

/**
 * Taking an unrecorded unit into stock — the dialog behind "Add to inventory"
 * (owner ask 2026-08-31).
 *
 * ## Why it asks four questions and not one
 *
 * The button's name makes it sound like one click, and the serial alone cannot
 * do the job. A serial raises nobody's stock count: inventory in this app is
 * counted per PRODUCT — `lib/inventory.ts` rolls units up by SKU — so a unit
 * with no product is a row that appears in no total and answers no question.
 * The reason is the shop's own record of why it owns something it never
 * booked in, and it goes on the managed `ADJUSTMENT` list so that six of them
 * can be read together later. The condition decides the grade a unit starts
 * with, and the warehouse is only asked when the count spans more than one
 * and therefore cannot answer it.
 *
 * ## A dialog, not four inline cells
 *
 * A surplus is rare — most counts find none — and the row it hangs off is
 * already carrying a serial, a product, a location and a status. Four more
 * controls in that row would be paid for by every count that finds nothing.
 *
 * ## Its own component, so the form is fresh each time
 *
 * Mounted per serial via `destroyOnHidden`, which is what lets the fields be
 * seeded from `initial` in `useState` rather than pushed in by an effect. The
 * page around it re-renders on every keystroke of a note; a form living up
 * there would have to defend itself against that.
 */
function SurplusDialog({
  serial,
  initial,
  skus,
  reasons,
  warehouses,
  defaultLocationId,
  onCancel,
  onSave,
}: {
  serial: string;
  initial?: OpnameSurplus;
  readonly skus: readonly { id: string; label: string; code: string }[];
  readonly reasons: readonly string[];
  readonly warehouses: readonly { id: string; name: string }[];
  /** The count's warehouse, when it has exactly one. See `soleLocation`. */
  defaultLocationId?: string;
  onCancel: () => void;
  onSave: (decision: OpnameSurplus) => void;
}) {
  const { t } = useTranslation();
  const [skuId, setSkuId] = useState(initial?.skuId);
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [condition, setCondition] = useState<UnitCondition>(
    initial?.condition ?? "SECOND",
  );
  const [locationId, setLocationId] = useState(
    initial?.locationId ?? defaultLocationId ?? warehouses[0]?.id,
  );
  /** Named on the fields only once somebody has tried to save. */
  const [tried, setTried] = useState(false);

  const missingSku = skuId === undefined;
  const missingReason = reason.trim() === "";
  const missingWhere = locationId === undefined;

  const save = () => {
    setTried(true);
    if (missingSku || missingReason || missingWhere) return;
    onSave({
      skuId: skuId!,
      locationId: locationId!,
      reason: reason.trim(),
      condition,
    });
  };

  return (
    <Modal
      open
      destroyOnHidden
      onCancel={onCancel}
      onOk={save}
      okText={t("opname.surplusOk", "Add to QC")}
      title={t("opname.surplusTitle", "Take {{serial}} into stock", { serial })}
      width={520}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title={t("opname.surplusExplainTitle", "It enters QC, not the shelf")}
        description={t(
          "opname.surplusExplainBody",
          "Nothing is created until this count is posted. The unit then waits in QC with no grade and no cost, because nobody has inspected it yet — grade it in Inbound & QC to put it on sale.",
        )}
      />
      <Form layout="vertical">
        <Form.Item
          label={t("opname.surplusProduct", "Product")}
          required
          validateStatus={tried && missingSku ? "error" : undefined}
          help={
            tried && missingSku
              ? t(
                  "opname.surplusProductHelp",
                  "A serial on its own raises no product's stock count. Say which unit this is.",
                )
              : undefined
          }
        >
          <Select
            showSearch
            value={skuId}
            onChange={setSkuId}
            placeholder={t("opname.surplusPickProduct", "Search a product")}
            // Matched against the printed product code as well as the name,
            // because the code is what is on the box in front of the counter.
            filterOption={(input, opt) =>
              `${opt?.label ?? ""} ${opt?.code ?? ""}`
                .toLowerCase()
                .includes(input.toLowerCase())
            }
            options={skus.map((k) => ({
              value: k.id,
              label: k.label,
              code: k.code,
            }))}
          />
        </Form.Item>
        <Form.Item
          label={t("opname.surplusReason", "Reason")}
          required
          validateStatus={tried && missingReason ? "error" : undefined}
          help={
            tried && missingReason
              ? t(
                  "opname.surplusReasonHelp",
                  "Say why the shop has a unit it never booked in.",
                )
              : undefined
          }
        >
          {/*
           * Searchable AND free-typed, the way the stock adjustment editor
           * does it. A reason nobody has used before joins the managed list
           * at post through `ensureReason`, so the vocabulary is the staff's
           * own rather than one somebody guessed in advance.
           */}
          <AutoComplete
            value={reason}
            onChange={setReason}
            placeholder={t(
              "opname.surplusReasonPlaceholder",
              "e.g. Bought over the counter, never entered",
            )}
            options={reasons.map((r) => ({ value: r }))}
            filterOption={(input, opt) =>
              String(opt?.value ?? "")
                .toLowerCase()
                .includes(input.toLowerCase())
            }
          />
        </Form.Item>
        <Form.Item label={t("opname.surplusCondition", "Condition")}>
          <Segmented<UnitCondition>
            value={condition}
            onChange={setCondition}
            options={CONDITIONS.map((c) => ({
              value: c,
              label:
                c === "NEW"
                  ? t("opname.conditionNew", "New")
                  : t("opname.conditionSecond", "Second"),
            }))}
          />
        </Form.Item>
        {/*
         * Only asked when the count cannot answer it. A count of one
         * warehouse knows where the unit was found; one spanning two, or
         * scoped only by category, does not — and guessing the location is
         * guessing the one fact a stock take exists to establish.
         */}
        {defaultLocationId === undefined && (
          <Form.Item
            label={t("opname.surplusWarehouse", "Found in")}
            required
            extra={t(
              "opname.surplusWarehouseHint",
              "This count covers more than one warehouse, so it cannot say where the unit turned up.",
            )}
            validateStatus={tried && missingWhere ? "error" : undefined}
          >
            <Select
              value={locationId}
              onChange={setLocationId}
              options={warehouses.map((w) => ({
                value: w.id,
                label: warehouseLabel(w),
              }))}
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

/**
 * The scan box, holding its own text.
 *
 * Its own component so that a keystroke re-renders the box and nothing else.
 * Since 2026-09-19 the page around it draws every unit the count expects, and
 * a scanner types a whole serial in one burst — a dozen renders of that table
 * for a value nobody reads until Enter.
 *
 * Marked `data-scan-target`, which is how `lib/scanner.ts` knows a burst
 * landing here is this page's own and lets the field type it natively.
 * Unmarked, a scan into the box was ALSO reported as a scan into "another
 * field", and the scanner chip offered to count a serial the box had just
 * counted; and the chip's click-to-reclaim, which looks for the mark to put
 * focus back into, found nothing and took focus out of the box instead. The
 * page's own refocus after a scan goes through a ref, not the mark — with
 * every open tab kept mounted, the first marked field in the document can
 * belong to another page.
 */
function ScanBox({
  inputRef,
  onScan,
}: {
  inputRef: Ref<InputRef>;
  onScan: (raw: string) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  return (
    <Input.Search
      ref={inputRef}
      data-scan-target=""
      value={value}
      onChange={(e) => setValue(e.target.value)}
      // `onSearch` only. antd fires it on Enter as well as on the button, so
      // an `onPressEnter` beside it would run the same scan twice — and would
      // read the value from state rather than taking the one it is handed,
      // which during a scanner burst is a tick behind.
      onSearch={(v) => {
        setValue("");
        onScan(v);
      }}
      enterButton={t("opname.count", "Count")}
      placeholder={t(
        "opname.scanHint",
        "Scan or type a serial, then Enter — keep scanning, no dialogs in between",
      )}
      // A browser offering yesterday's serials under the box would sit on top
      // of the very rows the counter is reading.
      autoComplete="off"
      style={{ marginBottom: 12 }}
    />
  );
}

export function OpnameSessionPage() {
  const { opnameId = "" } = useParams();
  const db = useDb();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const { token } = theme.useToken();

  const session = db.opnames.find((o) => o.id === opnameId);
  const posted = session?.status === "POSTED";

  /**
   * Every serial read so far, oldest first — expected or not. See
   * `recordScan`, and `restoreScans` for why a saved draft is read back from
   * both of its lists.
   */
  const [serials, setSerials] = useState<readonly string[]>(() =>
    restoreScans(session?.counted, session?.unknown),
  );
  /** The serial whose timeline is open in the dialog; null when it is closed. */
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  /**
   * Bumped by every scan. It sends the table back to its first page — where
   * the scan just landed, at the top — and brings that row into view.
   */
  const [scanTick, setScanTick] = useState(0);
  /**
   * Two steps since 2026-09-19: counting, then the review that posts.
   *
   * There were three from 2026-09-01, when an *expected in this scope* step
   * sat between them — the owner's "before Review & Finish, show all the
   * product that is supposed to be in that scope", answered at the only point
   * the blind count allowed. The counting table now shows every expected unit
   * from the start (see the docblock), so the check that step existed for —
   * whether the scope is the one the counter meant — is made while counting,
   * where "we expect six Airs and you found one" is five red rows and the
   * scope can still be changed. What else the step carried, the notes for
   * products counted by quantity, moved to the review, beside the notes for
   * missing and unknown serials.
   */
  const [phase, setPhase] = useState<"COUNT" | "REVIEW">(
    // A posted count has nothing to count. Opening it on the scan screen would
    // offer a scan box that refuses every scan.
    session?.status === "POSTED" ? "REVIEW" : "COUNT",
  );
  const [notes, setNotes] = useState<Record<string, string>>(
    session?.notes ?? {},
  );
  /**
   * Unregistered serials the counter has decided the shop owns, and what it
   * decided about each (owner ask 2026-08-31).
   *
   * Held on the draft, exactly like `notes`, and acted on at POST. Nothing here
   * is a unit yet — see `OpnameSurplus` and `post`.
   */
  const [surplus, setSurplus] = useState<Record<string, OpnameSurplus>>(
    session?.surplus ?? {},
  );
  /**
   * What was found of each product the shop COUNTS rather than scans (owner
   * ask 2026-09-15: *"in stock opname, they will only be counted and validated
   * by qty, not serial"*).
   *
   * By variant id. A variant with no entry is one nobody reached; **zero is a
   * shelf somebody looked at and found empty**, which is a discrepancy the
   * count has to explain. The two are different answers, which is why an
   * untouched row is absent rather than 0.
   */
  const [counts, setCounts] = useState<Record<string, number>>(
    session?.counts ?? {},
  );
  /** The serial the surplus dialog is open for, or null when it is closed. */
  const [surplusFor, setSurplusFor] = useState<string | null>(null);
  /**
   * The scope editor (owner ask 2026-09-01), and the draft it is holding.
   *
   * Null when closed. Held apart from the stored scope so a half-made change
   * — clearing the warehouses before picking the right one — does not
   * momentarily redefine the count under a counter's hands: `expected`,
   * `missing` and every figure on the page are derived from the STORED scope,
   * and nothing moves until Apply.
   */
  const [scopeDraft, setScopeDraft] = useState<OpnameScope | null>(null);
  const scanInput = useRef<InputRef>(null);
  /** Wraps the counting table, so the page can find its top row. */
  const tableHost = useRef<HTMLDivElement>(null);

  /**
   * Whether the draft on screen matches the draft in the store.
   *
   * A real count runs for an hour across a cold warehouse on somebody's
   * laptop, and until 2026-08-26 the only thing standing between that hour and
   * a closed lid was a *Save as draft* button at the foot of the page. The
   * owner asked for the count to save itself and to say so — so it does, and
   * the button stays as the fallback for the moment somebody wants to be sure
   * rather than told.
   */
  const [saveState, setSaveState] = useState<"SAVED" | "DIRTY" | "SAVING">(
    "SAVED",
  );
  const [savedAt, setSavedAt] = useState<string | null>(session?.at ?? null);
  /**
   * The autosave, held as a ref for one reason: hooks cannot run after the
   * `if (!session)` return below, and `persist` cannot be written before it —
   * it reads figures derived from the session. So the effect is declared up
   * here where it is unconditional, and the function it calls is hung on this
   * ref further down, once there is one to hang.
   */
  const autosave = useRef<() => void>(() => {});
  /** No autosave on mount: opening a draft is not editing it. */
  const settled = useRef(false);
  /** A change is waiting out the debounce and has not been saved yet. */
  const unsaved = useRef(false);

  useEffect(() => {
    if (posted) {
      unsaved.current = false;
      return;
    }
    if (!settled.current) {
      settled.current = true;
      return;
    }
    setSaveState("DIRTY");
    unsaved.current = true;
    // Debounced, because the two things that change here are a scan burst and
    // somebody typing a sentence into a note — both of which would otherwise
    // clone the whole store per keystroke.
    const timer = setTimeout(() => {
      unsaved.current = false;
      setSaveState("SAVING");
      autosave.current();
      setSavedAt(new Date().toISOString());
      setSaveState("SAVED");
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // Deliberately NOT keyed on the store: `missing` moves whenever stock
    // moves anywhere in the app, and saving a draft because someone else sold
    // a laptop is not a change this counter made.
  }, [serials, notes, surplus, counts, posted]);

  /*
   * Leaving the page saves what the debounce was still holding.
   *
   * The timer above is cleared on unmount, so the last scans before somebody
   * clicked away used to go with it. The in-app tabs hid that for a while —
   * a hidden tab stayed mounted and its timer fired — and since they went
   * (2026-09-21) leaving the count is an unmount again. Declared after the
   * debounce so its cleanup runs after the timer's.
   */
  useEffect(
    () => () => {
      if (!unsaved.current) return;
      unsaved.current = false;
      autosave.current();
    },
    [],
  );

  const scannedSet = useMemo(() => new Set(serials), [serials]);
  /**
   * Units and variants by id, built once per change to the store.
   *
   * The counting table asks "which unit is this serial, which product is it"
   * for every row it draws, and sorts the whole expected list by shelf and
   * product. A `find` per question is a scan of every unit per row per
   * render; a count of the whole shop is a few hundred of each.
   */
  const unitBySerial = useMemo(
    () => new Map(db.units.map((u) => [u.serial, u])),
    [db.units],
  );
  const skuById = useMemo(
    () => new Map(db.skus.map((k) => [k.id, k])),
    [db.skus],
  );

  const focusScan = () => scanInput.current?.focus();

  /** One counted serial, however it arrived — typed, or scanned anywhere. */
  const countSerial = (raw: string) => {
    if (!session || posted) return;
    /*
     * Resolved, not merely upper-cased. A unit on a shelf carries the shop's
     * own label AND Apple's, and a counter working down a rack with a phone
     * reads whichever faces them. The answer is always a serial the database
     * holds — `resolveSerialQuery` finds one or hands the input straight back,
     * in which case it lands on the table as not in system, exactly as it did
     * before.
     *
     * Through `resolveSerialQuery` since 2026-09-08 rather than
     * `resolveScannedSerial`: this box is TYPED into as often as it is scanned
     * into — a counter with no phone works down the rack keying serials off the
     * cases — and the case prints the number with no marker. The old helper
     * only ever stripped a store prefix, so every typed serial in a count
     * landed on the unknown list.
     */
    const s = resolveSerialQuery(
      raw,
      db.units.map((u) => u.serial),
      db.suppliers.map((x) => x.code).filter((c): c is string => !!c),
    );
    if (!s) return;
    /*
     * A product the shop counts is not scanned into a count (owner ask
     * 2026-09-15). Refused out loud rather than silently ignored: the serial
     * is a handle the app minted, so a counter who somehow has one in front of
     * them needs to know the shelf is answered with a number instead — and
     * accepting it would count the same box twice, once here and once in the
     * quantity below.
     */
    const known = unitBySerial.get(s);
    if (known !== undefined && !tracksSerial(known.skuId)) {
      message.info(
        t(
          "opname.countedByQty",
          "{{product}} is counted by quantity — put the number in the Counted by quantity card instead.",
          { product: skuName(known.skuId) },
        ),
      );
      focusScan();
      return;
    }
    // Already counted: it moves back to the top and flashes, rather than a
    // toast saying so. See the docblock on duplicates.
    if (scannedSet.has(s)) setFlash(s);
    // Functional update: during a scan burst several resolve before React
    // re-renders, and a list built from `serials` would have each overwrite
    // the last.
    setSerials((prev) => recordScan(prev, s));
    setScanTick((n) => n + 1);
    focusScan();
  };

  useScanTarget(countSerial);

  // The flash is a hint, not a state worth keeping. Clearing it on a timer
  // rather than on the next scan means two scans of the same row still blink
  // twice, once the first has faded.
  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  /*
   * After a scan, the row it produced is the table's first. A counter reading
   * down the list for what is left, with the scanner still firing, may have
   * scrolled past it — so it is brought back into view. `nearest`, so a row
   * already on screen does not move and the page does not jump under the
   * hand of somebody typing into the box right above it.
   */
  useEffect(() => {
    if (scanTick === 0) return;
    const top = tableHost.current?.querySelector<HTMLElement>(`[${ROW_ATTR}]`);
    // jsdom lays nothing out and has no `scrollIntoView`.
    if (top && typeof top.scrollIntoView === "function") {
      top.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [scanTick]);

  if (!session) {
    return (
      <PageContainer title={t("opname.stockOpname", "Stock Opname")}>
        <Result
          status="404"
          title={t("opname.notFound", "No such count")}
          extra={
            <Button type="primary" onClick={() => navigate("/stock/opname")}>
              {t("opname.backToList", "Back to Stock Opname")}
            </Button>
          }
        />
      </PageContainer>
    );
  }

  /**
   * What this count covers (owner ask 2026-08-31).
   *
   * Read through `scopeOf` rather than off the record directly, so a count
   * written before the four axes existed reads as "the whole shop" instead of
   * throwing on an absent array. `lib/opnameScope.ts` is the grammar.
   */
  const scope = scopeOf(session);

  /** unit → category, the two hops the scope filter deliberately does not know. */
  const categoryOf = (skuId: string) => {
    const sku = skuById.get(skuId);
    return sku && db.models.find((m) => m.id === sku.modelId)?.category;
  };

  /** Is this variant identified one by one, or counted? See `lib/serialTracking.ts`. */
  const tracksSerial = (skuId: string) => skuTracksSerial(db, skuId);

  const inScope = db.units.filter(
    (u) => IN_STOCK.includes(u.status) && inOpnameScope(u, scope, categoryOf),
  );
  /**
   * The units this count SCANS. Accessories are not among them (owner ask
   * 2026-09-15), and keeping them out here is the whole fix: they have no
   * serial anybody could read, so leaving them in `expected` reported every
   * sleeve in the shop as missing the moment a count was posted.
   */
  const expected = inScope.filter((u) => tracksSerial(u.skuId));
  /**
   * …and what it counts: the stock ledger's shelves of counted products
   * inside the scope, `sku → location → qty` (2026-09-19 — accessories are
   * quantities, not units).
   */
  const countedStock = new Map<string, Map<string, number>>();
  for (const [skuId, at] of stockLevels(db.stockMoves)) {
    for (const [loc, qty] of at) {
      if (qty <= 0 || !countedInScope(skuId, loc, scope, categoryOf)) continue;
      let mine = countedStock.get(skuId);
      if (!mine) countedStock.set(skuId, (mine = new Map()));
      mine.set(loc, qty);
    }
  }
  const expectedSerials = new Set(expected.map((u) => u.serial));

  /**
   * The warehouse a surplus unit is filed under, when the count names one.
   *
   * Undefined for a count spanning several warehouses or scoped only by
   * category — and then the dialog asks, because guessing where a unit was
   * found is guessing the one fact a stock take exists to establish.
   */
  const surplusHome = soleLocation(scope);

  const isKnown = (serial: string) => unitBySerial.has(serial);
  /**
   * What a scanned serial is to this count. "Unknown" is two different facts,
   * and the difference is what staff need: a unit filed outside this scope is
   * a move nobody recorded, while one the system has never seen is stock that
   * was never booked in. See `lib/opnameCount.ts`.
   */
  const statusOf = (serial: string) =>
    scanStatus(serial, expectedSerials, isKnown);

  /**
   * The three numbers, from the right source for this count's state.
   *
   * A posted count reads what it stored; a draft recomputes. See the docblock —
   * recomputing a posted count is what made every one of them report zero
   * missing.
   */
  const counted = posted
    ? session.counted
    : serials.filter((s) => statusOf(s) === "FOUND");
  const unknown = posted
    ? session.unknown
    : serials.filter((s) => statusOf(s) !== "FOUND");
  const missing = posted
    ? session.missing
    : expected.filter((u) => !scannedSet.has(u.serial)).map((u) => u.serial);

  /**
   * Every discrepancy needs an answer before the count can post — but a
   * surplus decision IS an answer.
   *
   * A serial the counter has taken into stock already carries a reason off the
   * managed list, which is the same question the note asks and a better-formed
   * version of it. Demanding both would make the commonest unknown — a unit
   * the shop has and never booked in — the only one needing two explanations.
   */
  const needsNote = posted
    ? []
    : [...missing, ...unknown].filter(
        (s) => !(notes[s] ?? "").trim() && surplus[s] === undefined,
      );

  /** A product's name, from its id — what a surplus decision has to show. */
  const skuName = (skuId: string) => {
    const k = skuById.get(skuId);
    return k ? `${k.name} ${k.variantLabel}` : fmtNone();
  };

  const skuOf = (serial: string) => {
    const u = unitBySerial.get(serial);
    return u ? skuName(u.skuId) : fmtNone();
  };

  /**
   * Where the system thinks a unit is — down to the rack.
   *
   * The rack matters more now that a count can be scoped to one: "it is in
   * this warehouse" is not an explanation for a unit that turned up on a shelf
   * the count does not cover, and the rack is.
   */
  const whereOf = (serial: string) => {
    const u = unitBySerial.get(serial);
    if (!u) return fmtNone();
    const where = warehouseLabelOf(db.warehouses, u.locationId) ?? fmtNone();
    const rack = db.racks.find((r) => r.id === u.rackId)?.name;
    return rack ? `${where} · ${rack}` : where;
  };

  const persist = (status: "DRAFT" | "POSTED") => {
    // Whatever was waiting on the debounce is in this write — and a count
    // posted within the wait must not be saved back as a draft on the way out.
    unsaved.current = false;
    return mutate((d) => {
      const o = d.opnames.find((x) => x.id === session.id)!;
      o.counted = counted;
      // Only the products still in this count's scope. Narrowing a scope
      // mid-count must not leave a number behind for a shelf nobody is
      // counting any more — the same filter `surplus` gets below.
      o.counts = Object.fromEntries(
        countedProducts
          .filter((r) => r.answered)
          .map((r) => [r.skuId, r.found!] as const),
      );
      o.missing = missing;
      o.unknown = unknown;
      o.notes = { ...notes };
      // Only the decisions that still refer to something found on this count.
      // A serial removed from the scan list after its dialog was filled in
      // would otherwise mint a unit nobody counted.
      o.surplus = Object.fromEntries(
        Object.entries(surplus).filter(([serial]) => unknown.includes(serial)),
      );
      o.at = new Date().toISOString();
      o.status = status;
    });
  };

  /**
   * What the debounced effect above actually calls.
   *
   * Assigned during render rather than in an effect because the effect that
   * uses it is declared before the early return and this line cannot be — see
   * the `autosave` ref. Writing a ref during render is safe here: it changes
   * nothing that is rendered, and the only reader runs later, on a timer.
   */
  autosave.current = () => persist("DRAFT");

  const saveDraft = () => {
    persist("DRAFT");
    setSavedAt(new Date().toISOString());
    setSaveState("SAVED");
    message.success(
      t(
        "opname.savedDraft",
        "Saved as draft. Pick it up from the Stock Opname list.",
      ),
    );
  };

  /**
   * The one line that says whether the work is safe.
   *
   * Shown beside the count rather than only in the footer, because the footer
   * is where the button people no longer have to press lives — and the whole
   * point of an autosave is that the reassurance has to arrive without anyone
   * going looking for it.
   */
  const saveStatus = posted ? null : (
    <Typography.Text
      type={saveState === "DIRTY" ? "warning" : "secondary"}
      style={{ fontSize: 12 }}
      // Announced when it changes, so the reassurance reaches a screen reader
      // too — but politely: it must never interrupt a scan.
      aria-live="polite"
    >
      {saveState === "SAVING"
        ? t("opname.saving", "Saving…")
        : saveState === "DIRTY"
          ? t("opname.unsaved", "Unsaved changes")
          : savedAt
            ? t("opname.savedAt", "Draft saved {{time}}", {
                time: fmtTime(savedAt),
              })
            : t("opname.savedNothingYet", "Draft saved")}
    </Typography.Text>
  );

  const post = () => {
    if (needsNote.length > 0) {
      return void modal.warning({
        title: t(
          "opname.needNotesTitle",
          "{{count}} unit(s) still need a description",
          { count: needsNote.length },
        ),
        content: t(
          "opname.needNotesBody",
          "Every missing and unknown unit needs a line saying what happened to it before the count can be posted.",
        ),
      });
    }
    if (countsNeedingNote.length > 0) {
      return modal.info({
        title: t(
          "opname.needCountNotes",
          "{{count}} product(s) counted differently need a note",
          { count: countsNeedingNote.length },
        ),
        content: t(
          "opname.needCountNotesBody",
          "A shelf that holds a different number from the one the system expects needs a line saying why before the count can be posted.",
        ),
      });
    }
    // Only the decisions attached to a serial still on the unknown list, which
    // is the same filter `persist` applies — the two have to agree or the
    // record would disagree with the units it created.
    const taking = unknown.filter((s) => surplus[s] !== undefined);
    modal.confirm({
      title: t("opname.postTitle", "Post this count?"),
      content: (
        <Flex vertical gap={8}>
          <span>
            {t(
              "opname.postBody",
              "{{counted}} counted · {{missing}} missing · {{unknown}} unknown. Missing units are marked lost, and the count becomes read-only.",
              {
                counted: counted.length,
                missing: missing.length,
                unknown: unknown.length,
              },
            )}
          </span>
          {countedOff.length > 0 && (
            <span>
              {t(
                "opname.postBodyCounted",
                "{{count}} product(s) counted by quantity do not match: the stock is corrected to what was counted.",
                { count: countedOff.length },
              )}
            </span>
          )}
          {taking.length > 0 && (
            // Said before the button rather than only after it. Posting is
            // where a surplus stops being a note and becomes a unit in the
            // shop's stock, and that is not a consequence to discover in a
            // toast that has already gone.
            <span>
              {t(
                "opname.postBodySurplus",
                "{{count}} unit(s) will be created in QC — they still need grading before they can be sold.",
                { count: taking.length },
              )}
            </span>
          )}
        </Flex>
      ),
      okText: t("opname.postOk", "Post count"),
      onOk: () => {
        persist("POSTED");
        mutate((d) => {
          for (const s of missing) {
            appendEvent(d, s, {
              type: "OPNAME_HILANG",
              toStatus: "HILANG",
              note: `Not found at opname — ${notes[s]}`,
              refCode: session.code,
            });
          }
          for (const s of counted) {
            appendEvent(d, s, {
              type: "DICATAT",
              note: "Counted at opname",
              refCode: session.code,
            });
          }

          /*
           * The surplus, and it is the only thing on this page that CREATES a
           * unit (owner ask 2026-08-31).
           *
           * Written at post and nowhere else. A draft touches no unit, and a
           * button that minted one mid-count would also make it *expected* —
           * moving the missing and counted figures under the hands of somebody
           * still walking the racks.
           *
           * QC, not the shelf, by owner decision: a unit found with no
           * paperwork has no grade, no description and no cost, and a
           * second-hand shop that puts such a thing straight on sale is
           * selling a unit nobody has looked at. `unitState.ts` carries the
           * arrow for it — `OPNAME_DITEMUKAN` from nothing.
           */
          const at = new Date().toISOString();
          for (const serial of taking) {
            const decision = surplus[serial]!;
            // The reason row first, then the thing pointing at it — the
            // no-orphan-data rule, and why this is inside the same `mutate`.
            ensureReason(d, "ADJUSTMENT", decision.reason);
            d.units.push({
              serial,
              skuId: decision.skuId,
              status: "QC",
              locationId: decision.locationId,
              // No rack: QC gives a unit its shelf when it accepts it, and
              // this one has not been accepted yet.
              // No cost either — nobody bought it through an order, and
              // writing the asking price in as `buy` would invent a margin out
              // of nothing. `InventoryPage` reasons the same way.
              buy: 0,
              description: "",
              poId: null,
              grade: gradeForCondition(decision.condition, undefined),
            });
            // Pushed rather than appended through `appendEvent`, which reads
            // the unit's CURRENT status as `fromStatus` and would file this
            // genesis as "QC → QC". `-` is what the mock writes for a unit
            // that did not exist, exactly as an adjustment-in does.
            d.events.push({
              id: nextId("ev"),
              serial,
              seq: 1,
              type: "OPNAME_DITEMUKAN",
              at,
              fromStatus: "-",
              toStatus: "QC",
              locationId: decision.locationId,
              note: `Found at opname — ${decision.reason}${
                (notes[serial] ?? "").trim() ? ` — ${notes[serial]}` : ""
              }`,
              refCode: session.code,
              staff: currentStaffName(),
            });
          }

          /*
           * The products counted by quantity (owner ask 2026-09-15; on the
           * stock ledger since 2026-09-19).
           *
           * The shelf is corrected to what was counted: one `OPNAME` move per
           * shelf, short or over, at the moving average — no unit is marked
           * lost and none is minted, because there are no units. WHICH of a
           * variant's boxes is the lost one is a question with no answer and
           * no consequence: they are interchangeable by construction, which
           * is the whole reason this category is counted.
           */
          for (const row of countedOff) {
            const note = (notes[row.skuId] ?? "").trim();
            const cost = averageCost(d, row.skuId);
            const move = (locationId: string, qty: number) =>
              d.stockMoves.push({
                id: nextId("sm"),
                skuId: row.skuId,
                locationId,
                qty,
                cost,
                type: "OPNAME",
                at,
                refCode: session.code,
                opnameId: session.id,
                note:
                  qty < 0
                    ? `Short on a counted shelf at opname — ${note}`
                    : `Found at opname — ${note}`,
                staff: currentStaffName(),
              });
            if (row.delta < 0) {
              // Off the fullest shelf in scope first; the pieces are
              // interchangeable, so which shelf lost them is bookkeeping.
              let short = -row.delta;
              const shelves = [...(countedStock.get(row.skuId) ?? [])].sort(
                ([a, x], [b, y]) => y - x || a.localeCompare(b),
              );
              for (const [loc, held] of shelves) {
                if (short <= 0) break;
                const take = Math.min(held, short);
                move(loc, -take);
                short -= take;
              }
              continue;
            }
            // A surplus goes where the count was taken — the pieces are
            // sealed stock, sellable at once, at the average they share.
            const home =
              surplusHome ?? session.locationIds[0] ?? db.myWarehouseId;
            move(home, row.delta);
          }

          // Everything else that turned up unexpectedly. A unit that belongs
          // to another warehouse gets its note; an unregistered serial nobody
          // took into stock is not a unit this system knows, so `appendEvent`
          // is a no-op for it — which is the honest outcome.
          for (const s of unknown) {
            if (surplus[s] !== undefined) continue;
            appendEvent(d, s, {
              type: "DICATAT",
              note: `Found at opname — ${notes[s]}`,
              refCode: session.code,
            });
          }
        });
        message.success(
          taking.length === 0
            ? t("opname.posted", "Opname posted.")
            : t(
                "opname.postedWithSurplus",
                "Opname posted. {{count}} unit(s) added to QC — grade them in Inbound & QC before they can be sold.",
                { count: taking.length },
              ),
        );
        navigate("/stock/opname");
      },
    });
  };

  /**
   * The history button, on every row of every table on this page.
   *
   * An icon rather than the word it used to be (owner decision): it repeats on
   * every row of three tables, and a column of the word "History" is a column
   * of noise. The tooltip and `aria-label` carry the word for anyone who needs
   * it, which a text button never did for a screen reader — it said "History"
   * without saying whose.
   */
  const historyButton = (serial: string) => (
    <Tooltip title={t("opname.history", "History")}>
      <Button
        type="text"
        icon={<HistoryOutlined />}
        aria-label={t("opname.historyAria", "History of {{serial}}", {
          serial,
        })}
        onClick={(e) => {
          e.stopPropagation();
          setHistoryFor(serial);
        }}
      />
    </Tooltip>
  );

  /**
   * Take a scan back (owner brief 2026-09-19: "Delete" on a scanned row).
   *
   * It removes the READ from this draft and nothing else — no unit is touched,
   * because a draft writes nothing until it is posted. An expected unit goes
   * back to not scanned yet, below the line; a serial nobody expected leaves
   * the table, and any take-into-stock decision on it lapses with it (see
   * `persist`). No confirmation: undoing it is scanning the label again.
   *
   * Focus goes back to the scan box, so the next serial can be typed without
   * reaching for the mouse.
   */
  const deleteScanButton = (serial: string) => (
    <Tooltip
      title={t(
        "opname.deleteScan",
        "Delete this scan — the unit is not touched",
      )}
    >
      <Button
        type="text"
        danger
        icon={<DeleteOutlined />}
        aria-label={t(
          "opname.deleteScanAria",
          "Delete the scan of {{serial}}",
          {
            serial,
          },
        )}
        onClick={() => {
          setSerials((prev) => removeScan(prev, serial));
          focusScan();
        }}
      />
    </Tooltip>
  );

  /**
   * Take an unrecorded unit into stock (owner ask 2026-08-31) — the button,
   * or what was decided once it has been pressed.
   *
   * Offered only for a serial the system has never seen. A unit that belongs
   * elsewhere is already the shop's — it is in the wrong place, which is a
   * movement, not a unit to create — and a second row for it would be a
   * duplicate of a laptop that exists. The callers make that check; this only
   * draws the answer.
   */
  const surplusAction = (s: string) => {
    const decision = surplus[s];
    if (posted) {
      return decision ? (
        <Typography.Text>
          {t("opname.addedToQc", "Added to QC — {{reason}}", {
            reason: decision.reason,
          })}
        </Typography.Text>
      ) : (
        fmtNone()
      );
    }
    return (
      <Flex vertical align="start" gap={2}>
        <Button
          size="small"
          type={decision ? "default" : "primary"}
          icon={<PlusOutlined />}
          onClick={() => setSurplusFor(s)}
        >
          {decision
            ? t("opname.surplusEdit", "Change")
            : t("opname.surplusAdd", "Add to inventory")}
        </Button>
        {decision && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {skuName(decision.skuId)} · {decision.reason}
          </Typography.Text>
        )}
      </Flex>
    );
  };

  /**
   * A row's answer, in its colour (owner brief 2026-09-19: "show status &
   * green/red").
   *
   * Written out per status rather than kept in a table of labels, so that
   * every word is a literal `t()` call the i18n sweep can read — a table
   * indexed by a variable is invisible to it (see `lib/serialInput.ts`). The
   * icon repeats what the colour says, for anyone who cannot tell this red
   * from that green.
   *
   * Not scanned yet is red because it is what the count still owes, and
   * worded for the middle of a count, when it usually means "not reached".
   * It is called missing only at the review, once the counter says they are
   * done.
   */
  const statusTag = (status: CountStatus) => {
    switch (status) {
      case "FOUND":
        return (
          <Tag color="green" icon={<CheckCircleOutlined />}>
            {t("opname.statusFound", "Found")}
          </Tag>
        );
      case "NOT_SCANNED":
        return (
          <Tag color="red" icon={<ClockCircleOutlined />}>
            {t("opname.statusNotScanned", "Not scanned yet")}
          </Tag>
        );
      case "ELSEWHERE":
        return (
          <Tag color="orange" icon={<EnvironmentOutlined />}>
            {t("opname.statusElsewhere", "Belongs elsewhere")}
          </Tag>
        );
      case "UNREGISTERED":
        return (
          <Tag color="red" icon={<QuestionCircleOutlined />}>
            {t("opname.statusUnregistered", "Not in system")}
          </Tag>
        );
    }
  };

  /** One axis of the scope as a row of tags, or the word that means "all". */
  const axisChips = (values: readonly string[], all: string) =>
    values.length === 0 ? (
      <Typography.Text type="secondary">{all}</Typography.Text>
    ) : (
      <>
        {values.map((v) => (
          <Tag key={v} style={{ marginInlineEnd: 4 }}>
            {v}
          </Tag>
        ))}
      </>
    );

  const conditionWord = (c: UnitCondition) =>
    c === "NEW"
      ? t("opname.conditionNew", "New")
      : t("opname.conditionSecond", "Second");

  /**
   * The products this count counts, and what was found of each.
   *
   * Every counted-category variant with stock in scope, plus any the counter
   * added by hand — a box of cables the system has never heard of is exactly
   * the surplus a stock take exists to find, and without the picker there
   * would be nowhere to record it.
   *
   * `expected` is shown beside the box while counting since 2026-09-19, for
   * the reason the serial table shows its expected units — see the docblock.
   */
  const countedProducts = (() => {
    const bySku = new Map<string, number>();
    for (const [skuId, at] of countedStock) {
      let n = 0;
      for (const q of at.values()) n += q;
      bySku.set(skuId, n);
    }
    for (const skuId of Object.keys(counts)) {
      if (!bySku.has(skuId)) bySku.set(skuId, 0);
    }
    return [...bySku.entries()]
      .map(([skuId, expectedQty]) => {
        const found = counts[skuId];
        return {
          skuId,
          product: skuName(skuId),
          expected: expectedQty,
          /** Undefined until somebody answers. Zero is an answer. */
          found,
          /** Positive is a surplus, negative a shortfall, 0 agreement. */
          delta: found === undefined ? 0 : found - expectedQty,
          answered: found !== undefined,
        };
      })
      .sort((a, b) => a.product.localeCompare(b.product));
  })();
  type CountedProduct = (typeof countedProducts)[number];

  /** The counted products whose number does not match, once answered. */
  const countedOff = countedProducts.filter((r) => r.answered && r.delta !== 0);
  /**
   * A counted product whose number disagrees with the shelf needs a line too.
   *
   * The same rule as a missing serial, and for the same reason: posting turns
   * the difference into `HILANG` events or into units in QC, and a number
   * nobody explained is a number nobody can audit. Keyed by SKU rather than by
   * serial, so it shares `notes` without colliding — a serial and a variant id
   * are different shapes.
   */
  const countsNeedingNote = posted
    ? []
    : countedOff
        .filter((r) => !(notes[r.skuId] ?? "").trim())
        .map((r) => r.skuId);

  /**
   * A counted shelf's answer, in the serial table's colours: green when the
   * number agrees, red when it is short or nobody has counted it yet, orange
   * when there are more than the system knows of — the counted-shelf version
   * of a unit that should not be here.
   */
  const countedStatusTag = (r: CountedProduct) => {
    if (!r.answered)
      return (
        <Tag color="red" icon={<ClockCircleOutlined />}>
          {t("opname.statusNotCounted", "Not counted yet")}
        </Tag>
      );
    if (r.delta === 0)
      return (
        <Tag color="green" icon={<CheckCircleOutlined />}>
          {t("opname.allFound", "All found")}
        </Tag>
      );
    return r.delta < 0 ? (
      <Tag color="red">
        {t("opname.shortBy", "{{count}} short", { count: -r.delta })}
      </Tag>
    ) : (
      <Tag color="orange">
        {t("opname.overBy", "{{count}} extra", { count: r.delta })}
      </Tag>
    );
  };

  /**
   * Change what the count covers, mid-count (owner ask 2026-09-01).
   *
   * Allowed on a DRAFT and refused on a posted count, which is the same line
   * every other edit on this page is drawn at. The reason it is safe here and
   * would not have been before is that a draft writes nothing: the scope only
   * decides which units are `expected`, and `expected` is recomputed from the
   * store on every render. Widening a scope makes more units expected —
   * anything already scanned stays counted — and narrowing it takes units off
   * the table rather than losing a scan.
   *
   * Scans are deliberately NOT dropped when the scope narrows. A serial that
   * falls outside the new scope stays on the table as "belongs elsewhere"
   * rather than vanishing, which is the truth: somebody walked past that unit
   * and read its label, and a count that quietly forgot the evidence would be
   * worse than one that has to explain it.
   */
  const applyScope = () => {
    const next = scopeDraft;
    if (!next || posted) return;
    mutate((d) => {
      const o = d.opnames.find((x) => x.id === session.id)!;
      o.locationIds = [...next.locationIds];
      o.rackIds = [...next.rackIds];
      o.categories = [...next.categories];
      o.conditions = [...next.conditions];
      o.at = new Date().toISOString();
    });
    setScopeDraft(null);
    message.success(
      t(
        "opname.scopeUpdated",
        "Scope updated. Nothing already counted was lost.",
      ),
    );
  };

  const header = (
    <Card
      extra={
        !posted && (
          <Tooltip
            title={t(
              "opname.editScopeHint",
              "Change what this count covers. Nothing already scanned is lost.",
            )}
          >
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => setScopeDraft(scope)}
            >
              {t("opname.editScope", "Edit scope")}
            </Button>
          </Tooltip>
        )
      }
    >
      <Descriptions
        column={{ xs: 1, sm: 2, md: 4 }}
        items={[
          {
            key: "w",
            label: t("opname.warehouse", "Warehouse"),
            children: axisChips(
              scope.locationIds.map(
                (id) => warehouseLabelOf(db.warehouses, id) ?? fmtNone(),
              ),
              t("opname.allWarehouses", "All warehouses"),
            ),
          },
          {
            key: "rk",
            label: t("opname.racks", "Racks"),
            children: axisChips(
              scope.rackIds.map(
                (id) => db.racks.find((r) => r.id === id)?.name ?? fmtNone(),
              ),
              t("opname.allRacks", "All racks"),
            ),
          },
          {
            key: "cat",
            label: t("opname.categories", "Categories"),
            children: axisChips(
              scope.categories,
              t("opname.allCategories", "All categories"),
            ),
          },
          {
            key: "cond",
            label: t("opname.condition", "Condition"),
            children: axisChips(
              scope.conditions.map(conditionWord),
              t("opname.allConditions", "New and second"),
            ),
          },
          {
            key: "d",
            label: t("opname.countedFor", "Counted for"),
            children: fmtDate(session.date),
          },
          {
            key: "b",
            label: t("opname.batch", "Batch"),
            children: session.label ?? fmtNone(),
          },
          {
            key: "s",
            label: t("opname.status", "Status"),
            children: posted ? (
              <Tag color="green">{t("opname.postedTag", "Posted")}</Tag>
            ) : (
              <Tag color="gold">{t("opname.draftTag", "Draft")}</Tag>
            ),
          },
        ]}
      />
    </Card>
  );

  /**
   * The units still to find, in the order somebody walks them: warehouse and
   * rack first — a count works a shelf at a time — then product, then serial,
   * so two units of one product on one shelf sit side by side. Units still in
   * QC have no rack and sort ahead of the racks of their warehouse.
   */
  const shelfOrder =
    phase === "COUNT" && !posted
      ? expected
          .map((u) => ({
            serial: u.serial,
            where: whereOf(u.serial),
            product: skuName(u.skuId),
          }))
          .sort(
            (a, b) =>
              a.where.localeCompare(b.where, undefined, { numeric: true }) ||
              a.product.localeCompare(b.product) ||
              a.serial.localeCompare(b.serial),
          )
          .map((x) => x.serial)
      : [];

  /** The counting table's rows — see `lib/opnameCount.ts` for the order. */
  const liveRows: LiveRow[] =
    phase === "COUNT" && !posted
      ? countRows(serials, shelfOrder, isKnown).map((r, i) => ({
          ...r,
          unit: unitBySerial.get(r.serial),
          latest: i === 0 && r.status !== "NOT_SCANNED",
        }))
      : [];

  /**
   * The unit's QC photographs, under its description (owner decision
   * 2026-08-26: the picture beside the serial the counter has just read).
   *
   * A stock take is the one job in this app done away from the desk, holding
   * the thing being recorded, and a serial is fourteen characters that all look
   * alike at arm's length on a cold shelf. The picture taken at QC is what
   * turns "is this the right row?" into a glance.
   *
   * Addable on a row that has been scanned — the counter has that unit in hand,
   * and a damaged one has no better moment to be recorded. A row not scanned
   * yet shows what it has and offers nothing: the unit is somewhere on a shelf,
   * not in front of anybody. Nothing is drawn for a row with no photograph and
   * nothing to add, which is most of them.
   */
  const photosOf = (r: LiveRow) => {
    if (!r.unit) return null;
    const editable = r.status !== "NOT_SCANNED";
    if (!editable && qcPhotosOf(db, r.serial).length === 0) return null;
    return (
      <UnitPhotos serial={r.serial} editable={editable} size={32} max={2} />
    );
  };

  /**
   * The counting screen: one scan box over one table (owner brief 2026-09-19).
   *
   * Columns in the owner's order — Unit, Serial, Warehouse, Status,
   * Description, Action. `DataTable` rather than antd's `Table`, because a
   * stock take is done on a phone as often as at a desk, and on a phone this
   * becomes one card per unit instead of six columns scrolling sideways. It
   * also pages, with a size the counter picks: a count of the whole shop is a
   * few hundred rows. Every scan sends it back to page one, where the scan
   * lands.
   *
   * No row is a focus stop (no `keyboardRows`): nothing here opens by row,
   * and the scan box has to stay where the keyboard is.
   */
  const countPhase = (
    <Card
      title={t("opname.unitsTitle", "Units in this count")}
      extra={
        <Flex align="center" gap={12} wrap>
          {saveStatus}
          <Typography.Text type="secondary">
            {t("opname.nScanned", "{{count}} scanned", {
              count: serials.length,
            })}
          </Typography.Text>
        </Flex>
      }
    >
      <ScanBox inputRef={scanInput} onScan={countSerial} />
      <div ref={tableHost}>
        {liveRows.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              // A count of accessories alone is a real count (2026-09-15):
              // its units are all in the quantity card below, and telling
              // that counter to widen the scope would be wrong advice.
              countedProducts.length > 0
                ? t(
                    "opname.onlyCountedByQty",
                    "Nothing in this scope has a serial to scan — count it by quantity below.",
                  )
                : t(
                    "opname.expectedNothing",
                    "Nothing is expected inside this scope. Widen it, or every serial you scanned will read as unexpected.",
                  )
            }
          />
        ) : (
          <DataTable<LiveRow>
            rowKey="serial"
            size="small"
            dataSource={liveRows}
            resetKey={scanTick}
            onRow={(r) => ({
              ...rowAttrs(r.serial),
              style: {
                // The re-scan flash, and a quieter mark on the latest scan.
                // Backgrounds rather than borders, so a row does not change
                // height and shove the list under the hand; and theme tokens
                // rather than a spot colour, so both stay legible in dark
                // mode — and neither is green, which a Found tag would sit on.
                transition: "background-color 400ms ease",
                backgroundColor:
                  flash === r.serial
                    ? token.colorWarningBg
                    : r.latest
                      ? token.colorFillTertiary
                      : undefined,
              },
            })}
            columns={[
              {
                title: t("opname.colUnit", "Unit"),
                key: "unit",
                render: (_: unknown, r: LiveRow) => {
                  if (r.unit) return skuName(r.unit.skuId);
                  // Not in the system — but if the counter has already said
                  // what it is, that is the most useful thing to show here.
                  const decision = surplus[r.serial];
                  return decision ? (
                    skuName(decision.skuId)
                  ) : (
                    <Typography.Text type="secondary">
                      {t("opname.unknownUnit", "Unknown unit")}
                    </Typography.Text>
                  );
                },
              },
              {
                title: t("opname.serial", "Serial"),
                key: "serial",
                render: (_: unknown, r: LiveRow) => (
                  <Typography.Text style={{ fontFamily: "monospace" }}>
                    {r.serial}
                  </Typography.Text>
                ),
              },
              {
                // Where the SYSTEM files the unit, down to the rack. For a
                // unit that belongs elsewhere this is the whole explanation:
                // it says where it should have been.
                title: t("opname.warehouse", "Warehouse"),
                key: "where",
                render: (_: unknown, r: LiveRow) => whereOf(r.serial),
              },
              {
                title: t("opname.status", "Status"),
                key: "status",
                render: (_: unknown, r: LiveRow) =>
                  // A unit found on a shelf that the system says was sold,
                  // lost or sent back is filed in no stock at all, and
                  // "belongs elsewhere" alone would hide the actual news.
                  // Its own status goes beside the answer.
                  r.status === "ELSEWHERE" &&
                  r.unit !== undefined &&
                  !IN_STOCK.includes(r.unit.status) ? (
                    <Flex gap={4} wrap>
                      {statusTag(r.status)}
                      <EnumTag map={UNIT_STATUS} value={r.unit.status} />
                    </Flex>
                  ) : (
                    statusTag(r.status)
                  ),
              },
              {
                // The unit's QC description — what it was graded as, which
                // is how somebody holding two of the same product tells
                // them apart. Two lines, as every description column is
                // (owner decision 2026-08-26, see `LongText`).
                title: t("opname.description", "Description"),
                key: "description",
                width: 280,
                render: (_: unknown, r: LiveRow) =>
                  r.unit ? (
                    <Flex vertical gap={6}>
                      <LongText>{r.unit.description}</LongText>
                      {photosOf(r)}
                    </Flex>
                  ) : (
                    fmtNone()
                  ),
              },
              {
                title: t("opname.action", "Action"),
                key: "action",
                render: (_: unknown, r: LiveRow) => (
                  <Flex gap={4} align="center" wrap>
                    {r.status === "UNREGISTERED"
                      ? surplusAction(r.serial)
                      : historyButton(r.serial)}
                    {r.status !== "NOT_SCANNED" && deleteScanButton(r.serial)}
                  </Flex>
                ),
              },
            ]}
          />
        )}
      </div>
    </Card>
  );

  /**
   * The shelves this count answers with a NUMBER (owner ask 2026-09-15).
   *
   * > *"Accessories do not have serial number, and in stock opname, they will
   * > only be counted and validated by qty, not serial."*
   *
   * Renders nothing when the scope holds none, which is most counts. The
   * expected number and a green/red answer sit beside the box since
   * 2026-09-19, for the reason the serial table lists its expected units — the
   * blind count is gone (see the docblock). The line explaining a difference
   * is asked for at the review, with every other discrepancy.
   */
  const countedCard =
    countedProducts.length === 0 ? null : (
      <Card
        title={t("opname.byQuantityTitle", "Counted by quantity")}
        extra={
          <Typography.Text type="secondary">
            {t("opname.byQuantityOf", "{{count}} product(s)", {
              count: countedProducts.length,
            })}
          </Typography.Text>
        }
      >
        <Flex vertical gap={12}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {t(
              "opname.byQuantityHint",
              "These have no serial to scan. Put in how many are actually on the shelf — leave a row blank if you have not counted it yet, and put 0 if you looked and found none.",
            )}
          </Typography.Paragraph>
          <Table
            rowKey="skuId"
            size="small"
            pagination={false}
            dataSource={countedProducts}
            columns={[
              {
                title: t("opname.product", "Product"),
                dataIndex: "product",
              },
              {
                title: t("opname.expectedQty", "Expected"),
                dataIndex: "expected",
                align: "right" as const,
                width: COLUMN.money,
              },
              {
                title: t("opname.foundQty", "How many are there?"),
                key: "found",
                align: "right" as const,
                width: 190,
                render: (_: unknown, r: CountedProduct) => (
                  <InputNumber
                    min={0}
                    precision={0}
                    disabled={posted}
                    style={{ width: "100%" }}
                    aria-label={t(
                      "opname.foundQtyAria",
                      "How many {{product}}",
                      {
                        product: r.product,
                      },
                    )}
                    placeholder={t("opname.notCountedYet", "not counted")}
                    value={r.found ?? null}
                    onChange={(v: number | null) =>
                      setCounts((prev) => {
                        // An emptied box is "not counted yet" again, which is
                        // a different answer from zero and has to be able to
                        // get back to being one.
                        if (v === null) {
                          const { [r.skuId]: _gone, ...rest } = prev;
                          return rest;
                        }
                        return {
                          ...prev,
                          [r.skuId]: Math.max(0, Math.trunc(v)),
                        };
                      })
                    }
                  />
                ),
              },
              {
                title: t("opname.status", "Status"),
                key: "status",
                width: COLUMN.choice,
                render: (_: unknown, r: CountedProduct) => countedStatusTag(r),
              },
            ]}
          />
          {/* Adding one by hand is how a box of cables the system has never
              heard of gets recorded at all — the surplus a stock take exists
              to find. */}
          {!posted && (
            <Flex gap={8} wrap align="center">
              <Select
                showSearch
                optionFilterProp="label"
                style={{ minWidth: 260, flex: "1 1 260px" }}
                value={null}
                placeholder={t(
                  "opname.addCountedProduct",
                  "Add a product that is not on this list",
                )}
                aria-label={t(
                  "opname.addCountedProduct",
                  "Add a product that is not on this list",
                )}
                options={db.skus
                  .filter(
                    (k) =>
                      !tracksSerial(k.id) &&
                      !countedProducts.some((r) => r.skuId === k.id),
                  )
                  .map((k) => ({ value: k.id, label: skuName(k.id) }))}
                onChange={(v: string) =>
                  setCounts((prev) => ({ ...prev, [v]: prev[v] ?? 0 }))
                }
              />
            </Flex>
          )}
        </Flex>
      </Card>
    );

  /**
   * The rack the system files a unit on, when it knows one.
   *
   * Worth a column on the counted list specifically: the warehouse is the same
   * for every counted row by definition — it is the warehouse being counted —
   * so it says nothing, while the rack is what tells a counter where the unit
   * was supposed to be sitting.
   */
  const rackOf = (serial: string) => {
    const u = unitBySerial.get(serial);
    return (u && db.racks.find((r) => r.id === u.rackId)?.name) || fmtNone();
  };

  /**
   * One of the three result tables. They differ only in which columns they
   * need, so they are one function rather than three near-copies:
   *
   * - **Counted** — serial, product, status, rack. Read-only; it is the record
   *   of what was found.
   * - **Missing** — plus a note, which is required before the count can post.
   * - **Unknown** — plus a note AND where the system thought the unit was,
   *   which is the fact that explains how it turned up here.
   *
   * `paginate` is on for the counted list and off for the other two, and the
   * split is deliberate rather than an oversight. Counted is a record nobody
   * edits and can run to hundreds of rows in a real stock take, so paging it is
   * a kindness. Missing and unknown are a WORKLIST — every row needs an answer
   * typed into it before Post will accept the count — and hiding half of them
   * behind a pager would mean the "3 units still need a description" warning
   * pointing at rows that are not on screen.
   */
  const resultTable = (
    rows: string[],
    emptyText: string,
    opts: {
      status?: boolean;
      rack?: boolean;
      where?: boolean;
      note?: boolean;
      paginate?: boolean;
      /** The unit's QC photograph, for a list of real units. */
      photo?: boolean;
      /** The take-it-into-stock column. Unknown list only. */
      surplus?: boolean;
    } = {},
  ) =>
    rows.length === 0 ? (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
    ) : (
      <Table
        rowKey={(s) => s}
        size="small"
        pagination={
          opts.paginate && rows.length > 20
            ? { pageSize: 20, size: "small", showSizeChanger: false }
            : false
        }
        dataSource={rows}
        columns={[
          {
            title: t("opname.serial", "Serial"),
            render: (s: string) => (
              <Typography.Text style={{ fontFamily: "monospace" }}>
                {s}
              </Typography.Text>
            ),
          },
          {
            title: t("opname.product", "Product"),
            render: (s: string) => skuOf(s),
          },
          ...(opts.photo
            ? [
                {
                  // Read-only here: this table is the record of what was
                  // found, and the moment for adding evidence was on the
                  // counting screen with the unit in hand.
                  title: t("opname.photo", "Photo"),
                  width: 150,
                  render: (s: string) => (
                    <UnitPhotos serial={s} size={36} max={2} />
                  ),
                },
              ]
            : []),
          ...(opts.status
            ? [
                {
                  title: t("opname.status", "Status"),
                  width: 140,
                  render: (s: string) => {
                    const u = unitBySerial.get(s);
                    // A serial the system has never seen has no status to
                    // show — which only happens on the unknown list, but the
                    // column has to survive it either way.
                    return u ? (
                      <EnumTag map={UNIT_STATUS} value={u.status} />
                    ) : (
                      fmtNone()
                    );
                  },
                },
              ]
            : []),
          ...(opts.rack
            ? [
                {
                  title: t("opname.location", "Location"),
                  width: 140,
                  render: (s: string) => rackOf(s),
                },
              ]
            : []),
          ...(opts.where
            ? [
                {
                  title: t("opname.systemSays", "System says it is at"),
                  render: (s: string) => whereOf(s),
                },
              ]
            : []),
          ...(opts.note
            ? [
                {
                  title: t("opname.whatHappened", "What happened"),
                  width: 320,
                  render: (s: string) =>
                    posted ? (
                      // Read-only once posted, and shown as text rather than a
                      // disabled input: a greyed-out field invites a click that
                      // does nothing, and this note is now part of the record.
                      <Typography.Text>{notes[s] || fmtNone()}</Typography.Text>
                    ) : (
                      <Input
                        placeholder={t(
                          "opname.notePlaceholder",
                          "Required — say what happened to this unit",
                        )}
                        status={(notes[s] ?? "").trim() ? undefined : "error"}
                        value={notes[s] ?? ""}
                        onChange={(e) =>
                          setNotes((n) => ({ ...n, [s]: e.target.value }))
                        }
                      />
                    ),
                },
              ]
            : []),
          ...(opts.surplus
            ? [
                {
                  // See `surplusAction`: offered only for a serial the system
                  // has never seen.
                  title: t("opname.takeIntoStock", "Take into stock"),
                  width: 220,
                  render: (s: string) =>
                    unitBySerial.has(s) ? (
                      <Typography.Text type="secondary">
                        {t("opname.alreadyOurs", "Already ours — move it")}
                      </Typography.Text>
                    ) : (
                      surplusAction(s)
                    ),
                },
              ]
            : []),
          {
            title: "",
            width: 60,
            render: (s: string) => historyButton(s),
          },
        ]}
      />
    );

  /**
   * The review before posting, and the record a posted count opens on.
   *
   * Every discrepancy is answered here, in one place: a note for each missing
   * and each unknown serial, a take-into-stock decision for a serial the
   * system has never seen, and — since 2026-09-19, when the step that carried
   * them was folded away — a note for each product counted by quantity whose
   * number disagrees.
   */
  const reviewPhase = (
    <Flex vertical gap={16}>
      <Card>
        <Flex gap={48} wrap>
          <Statistic
            title={t("opname.counted", "Counted")}
            value={counted.length}
          />
          <Statistic
            title={t("opname.missing", "Missing")}
            value={missing.length}
            styles={
              missing.length ? { content: { color: "#cf1322" } } : undefined
            }
          />
          <Statistic
            title={t("opname.unknown", "Unknown")}
            value={unknown.length}
            styles={
              unknown.length ? { content: { color: "#d46b08" } } : undefined
            }
          />
        </Flex>
      </Card>

      {posted && (
        <Alert
          type="success"
          showIcon
          title={t("opname.postedTitle", "This count is posted")}
          description={t(
            "opname.postedBody",
            "Posted Stock Opname is no longer editable. Adjust stock instead if needed.",
          )}
        />
      )}

      {needsNote.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title={t(
            "opname.needNotesTitle",
            "{{count}} unit(s) still need a description",
            { count: needsNote.length },
          )}
          description={t(
            "opname.needNotesWhy",
            "A count that records a discrepancy without saying why is a count nobody can act on later.",
          )}
        />
      )}

      {countsNeedingNote.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title={t(
            "opname.needCountNotes",
            "{{count}} product(s) counted differently need a note",
            { count: countsNeedingNote.length },
          )}
          description={t(
            "opname.needCountNotesBody",
            "A shelf that holds a different number from the one the system expects needs a line saying why before the count can be posted.",
          )}
        />
      )}

      {/*
       * What was actually found, listed — not just totalled.
       *
       * Added 2026-08-26 at the owner's request. The review step used to show
       * only the two discrepancy lists, so "Counted: 47" was a number with
       * nothing behind it: there was no way to check whether a particular
       * serial had been counted, and on a POSTED count — which opens straight
       * on this view — the counted serials were not visible anywhere in the
       * app at all. The counting table that holds them exists only in the
       * counting phase, which a posted count never renders.
       *
       * First of the three, because it is the result and the other two are the
       * exceptions to it.
       */}
      <Card
        title={t("opname.countedTitle", "Counted ({{count}})", {
          count: counted.length,
        })}
      >
        {resultTable(
          counted,
          t("opname.nothingCountedYet", "Nothing was counted in this session."),
          { status: true, rack: true, paginate: true, photo: true },
        )}
      </Card>

      <Card
        title={t("opname.missingTitle", "Missing ({{count}})", {
          count: missing.length,
        })}
      >
        {resultTable(
          missing,
          t(
            "opname.nothingMissing",
            "Nothing missing. Every expected unit was counted.",
          ),
          { note: true },
        )}
      </Card>

      <Card
        title={t("opname.unknownTitle", "Unknown ({{count}})", {
          count: unknown.length,
        })}
      >
        {resultTable(
          unknown,
          t("opname.nothingUnexpected", "Nothing unexpected was found."),
          { where: true, note: true, surplus: true },
        )}
      </Card>

      {/*
       * The counted shelves (owner ask 2026-09-15), reconciled: what the
       * system expected, what was counted, and a line for any that differ —
       * the line the post gate asks for. Here rather than on the counting
       * card because this is where every other discrepancy is explained.
       *
       * A draft only. The expected numbers are recomputed from stock as it is
       * now, and posting has just changed that stock — the same reason a
       * posted count reads its own stored lists (see the docblock).
       */}
      {!posted && countedProducts.length > 0 && (
        <Card title={t("opname.byQuantityTitle", "Counted by quantity")}>
          <Table
            rowKey="skuId"
            size="small"
            pagination={false}
            dataSource={countedProducts}
            columns={[
              {
                title: t("opname.product", "Product"),
                dataIndex: "product",
              },
              {
                title: t("opname.expectedQty", "Expected"),
                dataIndex: "expected",
                align: "right" as const,
                width: COLUMN.money,
              },
              {
                title: t("opname.countedQty", "Counted"),
                key: "found",
                align: "right" as const,
                width: 110,
                render: (_: unknown, r: CountedProduct) =>
                  r.answered ? (
                    r.found
                  ) : (
                    <Typography.Text type="secondary">
                      {t("opname.notCountedYet", "not counted")}
                    </Typography.Text>
                  ),
              },
              {
                title: t("opname.difference", "Difference"),
                key: "diff",
                width: 160,
                render: (_: unknown, r: CountedProduct) => countedStatusTag(r),
              },
              {
                title: t("opname.note", "Note"),
                key: "note",
                width: 260,
                render: (_: unknown, r: CountedProduct) =>
                  !r.answered || r.delta === 0 ? null : (
                    <Input
                      status={
                        (notes[r.skuId] ?? "").trim() ? undefined : "error"
                      }
                      aria-label={t(
                        "opname.countNoteAria",
                        "Why the count of {{product}} differs",
                        { product: r.product },
                      )}
                      placeholder={t(
                        "opname.countNotePlaceholder",
                        "Why does it differ?",
                      )}
                      value={notes[r.skuId] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setNotes((prev) => ({ ...prev, [r.skuId]: v }));
                      }}
                    />
                  ),
              },
            ]}
          />
        </Card>
      )}
    </Flex>
  );

  const counting = phase === "COUNT" && !posted;

  return (
    // The code, not the batch label: `PageContainer` runs its title through
    // `t()`, and a staff-typed label that happened to match a catalogue key
    // would come back translated. The label is on the card below.
    <PageContainer title={session.code} backTo="/stock/opname">
      <Flex vertical gap={16}>
        {header}
        {counting ? (
          <Flex vertical gap={16}>
            {countPhase}
            {countedCard}
          </Flex>
        ) : (
          reviewPhase
        )}
      </Flex>

      <FooterToolbar
        info={
          <Typography.Text>
            {counting
              ? // The counting table's own words. "Missing" is what a unit
                // not scanned yet becomes at the review, not what it is while
                // the racks are still being walked.
                t(
                  "opname.tallyCounting",
                  "{{found}} found · {{notYet}} not scanned yet · {{unexpected}} unexpected",
                  {
                    found: counted.length,
                    notYet: missing.length,
                    unexpected: unknown.length,
                  },
                )
              : t(
                  "opname.tally",
                  "{{counted}} counted · {{missing}} missing · {{unknown}} unknown",
                  {
                    counted: counted.length,
                    missing: missing.length,
                    unknown: unknown.length,
                  },
                )}
          </Typography.Text>
        }
      >
        {posted ? (
          // The one thing a posted count can still start. It leads to the Stock
          // Movement batch editor rather than unlocking this page — a unit
          // that turned up later is a movement with its own event, not a
          // correction to what was found on the day.
          <Tooltip
            title={t(
              "opname.adjustHint",
              "Record a unit into or out of stock — this count stays as it is",
            )}
          >
            <Button
              type="primary"
              icon={<SwapOutlined />}
              onClick={() => navigate("/stock/inventory?adjust=IN")}
            >
              {t("opname.addAdjustment", "Add adjustment")}
            </Button>
          </Tooltip>
        ) : (
          <>
            {/* The fallback, not the mechanism. Kept because "it saves
                itself" is a promise, and a promise about somebody's last hour
                of work should come with a way to check it. */}
            <Tooltip
              title={t(
                "opname.saveDraftHint",
                "The count saves itself as you go — this writes it now.",
              )}
            >
              <Button icon={<SaveOutlined />} onClick={saveDraft}>
                {t("opname.saveDraft", "Save now")}
              </Button>
            </Tooltip>
            {phase === "COUNT" ? (
              <Tooltip
                title={
                  serials.length === 0 &&
                  !countedProducts.some((r) => r.answered)
                    ? t(
                        "opname.countOneFirst",
                        "Count at least one serial or quantity first",
                      )
                    : t(
                        "opname.reviewHint",
                        "Review what is missing and what turned up unexpectedly",
                      )
                }
              >
                <Button
                  type="primary"
                  // A count of nothing but accessories has no scanned serial
                  // and is a real count (2026-09-15).
                  disabled={
                    serials.length === 0 &&
                    !countedProducts.some((r) => r.answered)
                  }
                  onClick={() => setPhase("REVIEW")}
                >
                  {t("opname.review", "Review & finish")}
                </Button>
              </Tooltip>
            ) : (
              <>
                <Button onClick={() => setPhase("COUNT")}>
                  {t("opname.backToCounting", "Back to counting")}
                </Button>
                <Button type="primary" onClick={post}>
                  {t("opname.postOk", "Post count")}
                </Button>
              </>
            )}
          </>
        )}
      </FooterToolbar>

      {surplusFor !== null && (
        <SurplusDialog
          serial={surplusFor}
          initial={surplus[surplusFor]}
          defaultLocationId={surplusHome}
          skus={db.skus.map((k) => ({
            id: k.id,
            label: `${k.name} ${k.variantLabel}`,
            code: k.code,
          }))}
          reasons={db.reasons
            .filter((r) => r.activity === "ADJUSTMENT" && r.active)
            .map((r) => r.label)}
          warehouses={db.warehouses.filter((w) => w.active)}
          onCancel={() => setSurplusFor(null)}
          onSave={(decision) => {
            setSurplus((prev) => ({ ...prev, [surplusFor]: decision }));
            setSurplusFor(null);
          }}
        />
      )}

      {/*
       * The scope editor.
       *
       * `ScopeFields` is the very form the start dialog uses — one definition,
       * because the cascade between warehouses and racks and the
       * empty-means-all rule are not things to write twice.
       *
       * Nothing applies until the button. See `applyScope`.
       */}
      <Modal
        open={scopeDraft !== null}
        title={t("opname.editScopeTitle", "Change what this count covers")}
        okText={t("opname.applyScope", "Apply")}
        onCancel={() => setScopeDraft(null)}
        onOk={applyScope}
        width={560}
      >
        {scopeDraft !== null && (
          <Form layout="vertical">
            <ScopeFields
              value={scopeDraft}
              onChange={setScopeDraft}
              warehouses={db.warehouses}
              racks={db.racks}
              models={db.models}
            >
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                title={t(
                  "opname.scopeChangeTitle",
                  "Everything already scanned is kept",
                )}
                description={t(
                  "opname.scopeChangeBody",
                  "Widening the scope adds units to what this count expects; narrowing it takes them away. A serial you scanned that falls outside the new scope is not deleted — it stays on the list as Belongs elsewhere, because somebody did read it off a unit.",
                )}
              />
            </ScopeFields>
          </Form>
        )}
      </Modal>

      {/*
       * The history dialog the side panel became.
       *
       * `destroyOnHidden` so the timeline is rebuilt for each serial rather
       * than kept for every one ever opened during a long count — and so an
       * adjustment made while the count is open is reflected the next time the
       * same serial's history is asked for.
       */}
      <Modal
        open={historyFor !== null}
        onCancel={() => setHistoryFor(null)}
        footer={null}
        destroyOnHidden
        width={560}
        title={t("opname.historyOf", "History — {{serial}}", {
          serial: historyFor ?? "",
        })}
      >
        <UnitTimeline serial={historyFor} />
      </Modal>
    </PageContainer>
  );
}
