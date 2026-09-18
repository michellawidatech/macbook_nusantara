/**
 * Counting a warehouse — the scan screen, the confirmation, and what a posted
 * count looks like afterwards.
 *
 * ## What is deliberately NOT shown
 *
 * The list of everything the warehouse is supposed to hold. A counter who can
 * see the expected list stops counting and starts ticking, and a stock take
 * that confirms its own expectations is worth nothing. Missing units surface
 * at the confirmation step, once counting is over and the answer can no longer
 * be influenced.
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
 * What a posted count CAN still do is start an adjustment — a machine turns up
 * a week later, or a lost one is found. That is a stock movement with its own
 * event, not an edit to the count, so the button leads to the Stock Movement
 * batch editor rather than unlocking anything here.
 *
 * ## Duplicates
 *
 * Scanning the same serial twice is normal in a long count — a shelf gets
 * revisited. It counts once. Rather than a toast that says so and vanishes,
 * the row already holding that serial is scrolled to and flashed, which
 * answers the counter's actual question ("did that one go in?") by showing
 * them the row.
 */
import { useEffect, useMemo, useRef, useState } from "react";
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
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  PlusOutlined,
  SaveOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { PageContainer } from "../../components/PageContainer";
import { FooterToolbar } from "../../components/FooterToolbar";
import { UnitTimeline } from "../../components/UnitTimeline";
import { UnitPhotos } from "../../components/UnitPhotos";
import { EnumTag } from "../../components/EnumTag";
import { UNIT_STATUS } from "../../i18n/enumLabels.js";
import { fmtDate, fmtTime } from "../../lib/format.js";
import {
  useDb,
  mutate,
  appendEvent,
  ensureReason,
  nextId,
  currentStaffName,
} from "../../mock/store.js";
import { useScanTarget } from "../../hooks/useScanTarget.js";
import { focusScanTarget } from "../../lib/scanner.js";
import { resolveSerialQuery } from "../../lib/serialInput.js";
import { countedSerial, skuTracksSerial } from "../../lib/serialTracking.js";
import {
  inOpnameScope,
  scopeOf,
  soleLocation,
  type OpnameScope,
} from "../../lib/opnameScope.js";
import { ScopeFields } from "./ScopeFields.js";
import {
  CONDITIONS,
  gradeForCondition,
  type UnitCondition,
} from "../../lib/condition.js";
import type { OpnameSurplus } from "../../mock/seed.js";

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

type ScanKind = "COUNTED" | "ELSEWHERE" | "UNREGISTERED";

const KIND_TAG: Record<ScanKind, { color: string; label: string }> = {
  COUNTED: { color: "green", label: "Expected here" },
  ELSEWHERE: { color: "orange", label: "Belongs elsewhere" },
  UNREGISTERED: { color: "red", label: "Not in system" },
};

/**
 * Taking an unrecorded machine into stock — the dialog behind "Add to
 * inventory" (owner ask 2026-08-31).
 *
 * ## Why it asks four questions and not one
 *
 * The button's name makes it sound like one click, and the serial alone cannot
 * do the job. A serial raises nobody's stock count: inventory in this app is
 * counted per PRODUCT — `lib/inventory.ts` rolls units up by SKU — so a
 * machine with no product is a row that appears in no total and answers no
 * question. The reason is the shop's own record of why it owns something it
 * never booked in, and it goes on the managed `ADJUSTMENT` list so that six of
 * them can be read together later. The condition decides the grade a machine
 * starts with, and the warehouse is only asked when the count spans more than
 * one and therefore cannot answer it.
 *
 * ## A dialog, not four inline cells
 *
 * A surplus is rare — most counts find none — and the row it hangs off is
 * already carrying a serial, a product, a location and a note. Four more
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
        message={t("opname.surplusExplainTitle", "It enters QC, not the shelf")}
        description={t(
          "opname.surplusExplainBody",
          "Nothing is created until this count is posted. The machine then waits in QC with no grade and no cost, because nobody has inspected it yet — grade it in Inbound & QC to put it on sale.",
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
                  "A serial on its own raises no product's stock count. Say which machine this is.",
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
                  "Say why the shop has a machine it never booked in.",
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
         * warehouse knows where the machine was found; one spanning two, or
         * scoped only by category, does not — and guessing the location is
         * guessing the one fact a stock take exists to establish.
         */}
        {defaultLocationId === undefined && (
          <Form.Item
            label={t("opname.surplusWarehouse", "Found in")}
            required
            extra={t(
              "opname.surplusWarehouseHint",
              "This count covers more than one warehouse, so it cannot say where the machine turned up.",
            )}
            validateStatus={tried && missingWhere ? "error" : undefined}
          >
            <Select
              value={locationId}
              onChange={setLocationId}
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

export function OpnameSessionPage() {
  const { opnameId = "" } = useParams();
  const db = useDb();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { message, modal } = App.useApp();

  const session = db.opnames.find((o) => o.id === opnameId);
  const posted = session?.status === "POSTED";

  const [serials, setSerials] = useState<string[]>(session?.counted ?? []);
  /** The serial whose timeline is open in the dialog; null when it is closed. */
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [scan, setScan] = useState("");
  /**
   * Three steps since 2026-09-01, not two.
   *
   * `EXPECTED` sits between counting and the confirmation, and it is the
   * owner's "before Review & Finish, show all the product that is supposed to
   * be in that scope". The docblock above explains why that list is not on the
   * COUNTING screen and that reason is unchanged — a counter who can see the
   * expected list stops counting and starts ticking. Here the counting is
   * over: the scan box is behind them, and what the step buys is the check
   * nobody could make before, which is whether the scope was the one they
   * meant. "We expect six Airs and you found one" is a question about the
   * SCOPE, and it has to be askable while the scope can still be changed.
   */
  const [phase, setPhase] = useState<"COUNT" | "EXPECTED" | "CONFIRM">(
    // A posted count has nothing to count. Opening it on the scan screen would
    // offer a scan box that refuses every scan.
    session?.status === "POSTED" ? "CONFIRM" : "COUNT",
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
  const rowRefs = useRef<Record<string, HTMLElement | null>>({});

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

  useEffect(() => {
    if (posted) return;
    if (!settled.current) {
      settled.current = true;
      return;
    }
    setSaveState("DIRTY");
    // Debounced, because the two things that change here are a scan burst and
    // somebody typing a sentence into a note — both of which would otherwise
    // clone the whole store per keystroke.
    const timer = setTimeout(() => {
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

  const scannedSet = useMemo(() => new Set(serials), [serials]);

  /** One counted serial, however it arrived — typed, or scanned anywhere. */
  const countSerial = (raw: string) => {
    /*
     * Resolved, not merely upper-cased. A machine on a shelf carries the shop's
     * own label AND Apple's, and a counter working down a rack with a phone
     * reads whichever faces them. The answer is always a serial the database
     * holds — `resolveSerialQuery` finds one or hands the input straight back,
     * in which case it lands on the unknown list exactly as it did before.
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
    if (posted) return;
    /*
     * A product the shop counts is not scanned into a count (owner ask
     * 2026-09-15). Refused out loud rather than silently ignored: the serial
     * is a handle the app minted, so a counter who somehow has one in front of
     * them needs to know the shelf is answered with a number instead — and
     * accepting it would count the same box twice, once here and once in the
     * quantity above.
     */
    const known = db.units.find((u) => u.serial === s);
    if (known !== undefined && !tracksSerial(known.skuId)) {
      setScan("");
      message.info(
        t(
          "opname.countedByQty",
          "{{product}} is counted by quantity — put the number in the Counted by quantity card instead.",
          { product: skuName(known.skuId) },
        ),
      );
      focusScanTarget();
      return;
    }
    setScan("");
    setFocused(s);
    if (scannedSet.has(s)) {
      // Already counted. Show them the row rather than telling them about it.
      setFlash(s);
      rowRefs.current[s]?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    } else {
      // Functional update: during a scan burst several resolve before React
      // re-renders, and `[...serials, s]` would have each overwrite the last.
      setSerials((prev) => (prev.includes(s) ? prev : [...prev, s]));
    }
    focusScanTarget();
  };

  useScanTarget(countSerial);

  // The flash is a hint, not a state worth keeping. Clearing it on a timer
  // rather than on the next scan means two scans of the same row still blink
  // twice.
  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(timer);
  }, [flash]);

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
    const sku = db.skus.find((k) => k.id === skuId);
    return sku && db.models.find((m) => m.id === sku.modelId)?.category;
  };

  /** Is this variant identified one by one, or counted? See `lib/serialTracking.ts`. */
  const tracksSerial = (skuId: string) => skuTracksSerial(db, skuId);

  const inScope = db.units.filter(
    (u) => IN_STOCK.includes(u.status) && inOpnameScope(u, scope, categoryOf),
  );
  /**
   * The machines this count SCANS. Accessories are not among them (owner ask
   * 2026-09-15), and keeping them out here is the whole fix: they have no
   * serial anybody could read, so leaving them in `expected` reported every
   * sleeve in the shop as missing the moment a count was posted.
   */
  const expected = inScope.filter((u) => tracksSerial(u.skuId));
  /** …and the ones it counts. Grouped into `countedProducts` below. */
  const countedStock = inScope.filter((u) => !tracksSerial(u.skuId));
  const expectedSerials = new Set(expected.map((u) => u.serial));

  /**
   * The warehouse a surplus machine is filed under, when the count names one.
   *
   * Undefined for a count spanning several warehouses or scoped only by
   * category — and then the dialog asks, because guessing where a machine was
   * found is guessing the one fact a stock take exists to establish.
   */
  const surplusHome = soleLocation(scope);

  const kindOf = (serial: string): ScanKind => {
    if (expectedSerials.has(serial)) return "COUNTED";
    // "Unknown" is two different facts, and the difference is what staff need:
    // a unit that belongs to another warehouse is a transfer nobody recorded,
    // while one the system has never seen is stock that was never booked in.
    return db.units.some((u) => u.serial === serial)
      ? "ELSEWHERE"
      : "UNREGISTERED";
  };

  /**
   * The three numbers, from the right source for this count's state.
   *
   * A posted count reads what it stored; a draft recomputes. See the docblock —
   * recomputing a posted count is what made every one of them report zero
   * missing.
   */
  const counted = posted
    ? session.counted
    : serials.filter((s) => kindOf(s) === "COUNTED");
  const unknown = posted
    ? session.unknown
    : serials.filter((s) => kindOf(s) !== "COUNTED");
  const missing = posted
    ? session.missing
    : expected.filter((u) => !scannedSet.has(u.serial)).map((u) => u.serial);

  /**
   * Every discrepancy needs an answer before the count can post — but a
   * surplus decision IS an answer.
   *
   * A serial the counter has taken into stock already carries a reason off the
   * managed list, which is the same question the note asks and a better-formed
   * version of it. Demanding both would make the commonest unknown — a machine
   * the shop has and never booked in — the only one needing two explanations.
   */
  const needsNote = posted
    ? []
    : [...missing, ...unknown].filter(
        (s) => !(notes[s] ?? "").trim() && surplus[s] === undefined,
      );

  /** A product's name, from its id — what a surplus decision has to show. */
  const skuName = (skuId: string) => {
    const k = db.skus.find((s) => s.id === skuId);
    return k ? `${k.name} ${k.variantLabel}` : "—";
  };

  const skuOf = (serial: string) => {
    const u = db.units.find((x) => x.serial === serial);
    return u ? skuName(u.skuId) : "—";
  };

  /**
   * Where the system thinks a unit is — down to the rack.
   *
   * The rack matters more now that a count can be scoped to one: "it is in
   * this warehouse" is not an explanation for a machine that turned up on a
   * shelf the count does not cover, and the rack is.
   */
  const whereOf = (serial: string) => {
    const u = db.units.find((x) => x.serial === serial);
    if (!u) return "—";
    const where = db.warehouses.find((w) => w.id === u.locationId)?.name ?? "—";
    const rack = db.racks.find((r) => r.id === u.rackId)?.name;
    return rack ? `${where} · ${rack}` : where;
  };

  const persist = (status: "DRAFT" | "POSTED") =>
    mutate((d) => {
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
      // would otherwise mint a machine nobody counted.
      o.surplus = Object.fromEntries(
        Object.entries(surplus).filter(([serial]) => unknown.includes(serial)),
      );
      o.at = new Date().toISOString();
      o.status = status;
    });

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
                "{{count}} product(s) counted by quantity do not match: short ones are marked lost, extra ones are created in QC.",
                { count: countedOff.length },
              )}
            </span>
          )}
          {taking.length > 0 && (
            // Said before the button rather than only after it. Posting is
            // where a surplus stops being a note and becomes a machine in the
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
           * machine (owner ask 2026-08-31).
           *
           * Written at post and nowhere else. A draft touches no unit, and a
           * button that minted one mid-count would also make it *expected* —
           * moving the missing and counted figures under the hands of somebody
           * still walking the racks.
           *
           * QC, not the shelf, by owner decision: a machine found with no
           * paperwork has no grade, no description and no cost, and a
           * second-hand shop that puts such a thing straight on sale is
           * selling a machine nobody has looked at. `unitState.ts` carries the
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
              // No rack: QC gives a machine its shelf when it accepts it, and
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
           * The products counted by quantity (owner ask 2026-09-15).
           *
           * A shortfall marks that many of them lost, and a surplus mints
           * that many into QC — the same two outcomes a scanned count has,
           * reached by arithmetic instead of by serial. WHICH of a variant's
           * boxes is the lost one is a question with no answer and no
           * consequence: they are interchangeable by construction, which is
           * the whole reason this category is counted rather than tracked.
           * Oldest first, so the ones that have sat longest are the ones
           * reported gone.
           */
          for (const row of countedOff) {
            const note = (notes[row.skuId] ?? "").trim();
            if (row.delta < 0) {
              const mine = countedStock
                .filter((u) => u.skuId === row.skuId)
                .map((u) => u.serial)
                .sort();
              for (const serial of mine.slice(0, -row.delta)) {
                appendEvent(d, serial, {
                  type: "OPNAME_HILANG",
                  toStatus: "HILANG",
                  note: `Short on a counted shelf at opname — ${note}`,
                  refCode: session.code,
                });
              }
              continue;
            }
            // A surplus. The reason goes on the managed list first, so
            // nothing ever points at a reason Settings has not heard of.
            const reason = t("opname.countSurplusReason", "Found in a count");
            ensureReason(d, "ADJUSTMENT", reason);
            const home =
              surplusHome ?? session.locationIds[0] ?? db.myWarehouseId;
            for (let i = 0; i < row.delta; i += 1) {
              // A handle, not a serial: nothing is printed on the box. The
              // count's own code is in it, so two counts of one shelf cannot
              // mint the same one twice.
              const serial = countedSerial(
                `${row.skuId}-${session.code}`,
                i + 1,
              );
              if (d.units.some((u) => u.serial === serial)) continue;
              d.units.push({
                serial,
                skuId: row.skuId,
                // QC, as every surplus is: a box found with no paperwork has
                // no cost and nobody has looked at it.
                status: "QC",
                locationId: home,
                buy: 0,
                description: "",
                poId: null,
              });
              d.events.push({
                id: nextId("ev"),
                serial,
                seq: 1,
                type: "OPNAME_DITEMUKAN",
                at,
                fromStatus: "-",
                toStatus: "QC",
                locationId: home,
                note: `Found at opname — ${reason}${note ? ` — ${note}` : ""}`,
                refCode: session.code,
                staff: currentStaffName(),
              });
            }
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
   * What the count is supposed to find, rolled up per PRODUCT.
   *
   * Per product rather than per serial, because that is the owner's word —
   * "show all the product that is supposed to be in that scope" — and it is
   * also the only shape a person can check a shelf against. Forty serials is
   * a list nobody reads; "6 × MacBook Air M1 8/256" is a number somebody can
   * look at a rack and agree or disagree with.
   *
   * Each row carries how many of that product were counted, so the step is a
   * reconciliation and not just an inventory listing. The serials behind a row
   * are in the expansion, marked found or not, for the moment the count and
   * the expectation disagree and somebody has to work out which one.
   */
  /**
   * The products this count counts, and what was found of each.
   *
   * Every counted-category variant with stock in scope, plus any the counter
   * added by hand — a box of cables the system has never heard of is exactly
   * the surplus a stock take exists to find, and without the picker there
   * would be nowhere to record it.
   *
   * `expected` is on the row but is NOT shown while counting. The page's own
   * docblock says why: a counter who can see the expected number stops
   * counting and starts agreeing with it.
   */
  const countedProducts = (() => {
    const bySku = new Map<string, number>();
    for (const u of countedStock) {
      bySku.set(u.skuId, (bySku.get(u.skuId) ?? 0) + 1);
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

  /** The counted products whose number does not match, once answered. */
  const countedOff = countedProducts.filter((r) => r.answered && r.delta !== 0);
  /**
   * A counted product whose number disagrees with the shelf needs a line too.
   *
   * The same rule as a missing serial, and for the same reason: posting turns
   * the difference into `HILANG` events or into machines in QC, and a number
   * nobody explained is a number nobody can audit. Keyed by SKU rather than by
   * serial, so it shares `notes` without colliding — a serial and a variant id
   * are different shapes.
   */
  const countsNeedingNote = posted
    ? []
    : countedOff
        .filter((r) => !(notes[r.skuId] ?? "").trim())
        .map((r) => r.skuId);

  const expectedByProduct = (() => {
    // Plain, not `useMemo`: everything from `scope` down is computed after the
    // `if (!session)` return above, where a hook cannot go. It is a group-by
    // over the units of one warehouse, which is not a cost worth breaking the
    // rules of hooks for.
    const bySku = new Map<string, typeof expected>();
    for (const u of expected) {
      const held = bySku.get(u.skuId);
      if (held) held.push(u);
      else bySku.set(u.skuId, [u]);
    }
    return [...bySku.entries()]
      .map(([skuId, units]) => ({
        skuId,
        product: skuName(skuId),
        expected: units.length,
        counted: units.filter((u) => scannedSet.has(u.serial)).length,
        units: [...units].sort((a, b) => a.serial.localeCompare(b.serial)),
      }))
      .sort((a, b) => a.product.localeCompare(b.product));
  })();

  /**
   * Change what the count covers, mid-count (owner ask 2026-09-01).
   *
   * Allowed on a DRAFT and refused on a posted count, which is the same line
   * every other edit on this page is drawn at. The reason it is safe here and
   * would not have been before is that a draft writes nothing: the scope only
   * decides which units are `expected`, and `expected` is recomputed from the
   * store on every render. Widening a scope makes more machines expected —
   * anything already scanned stays counted — and narrowing it moves machines
   * out of `missing` rather than losing a scan.
   *
   * Scans are deliberately NOT dropped when the scope narrows. A serial that
   * falls outside the new scope becomes "belongs elsewhere" rather than
   * vanishing, which is the truth: somebody walked past that machine and read
   * its label, and a count that quietly forgot the evidence would be worse
   * than one that has to explain it.
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
                (id) => db.warehouses.find((w) => w.id === id)?.name ?? "—",
              ),
              t("opname.allWarehouses", "All warehouses"),
            ),
          },
          {
            key: "rk",
            label: t("opname.racks", "Racks"),
            children: axisChips(
              scope.rackIds.map(
                (id) => db.racks.find((r) => r.id === id)?.name ?? "—",
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
            children: session.label ?? "—",
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
   * The shelves this count answers with a NUMBER (owner ask 2026-09-15).
   *
   * > *"Accessories do not have serial number, and in stock opname, they will
   * > only be counted and validated by qty, not serial."*
   *
   * Renders nothing when the scope holds none, which is most counts. The
   * expected number is deliberately absent from this card and present on the
   * review step: the page's own docblock is that a counter who can see what
   * they are supposed to find stops counting and starts agreeing.
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
                title: t("opname.foundQty", "How many are there?"),
                key: "found",
                align: "right" as const,
                width: 190,
                render: (_: unknown, r: (typeof countedProducts)[number]) => (
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

  const countPhase = (
    <Card
      title={t("opname.counted", "Counted")}
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
      <Input.Search
        value={scan}
        onChange={(e) => setScan(e.target.value)}
        // `onSearch` only. antd fires it on Enter as well as on the button,
        // so an `onPressEnter` beside it would run the same scan twice — and
        // would read `scan` from state rather than taking the value it is
        // handed, which during a scanner burst is a tick behind.
        onSearch={countSerial}
        enterButton={t("opname.count", "Count")}
        placeholder={t(
          "opname.scanHint",
          "Scan or type a serial, then Enter — keep scanning, no dialogs in between",
        )}
        style={{ marginBottom: 12 }}
      />
      <Table
        rowKey="serial"
        size="small"
        pagination={false}
        dataSource={serials.map((s) => ({ serial: s, kind: kindOf(s) }))}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t(
                "opname.nothingCounted",
                "Nothing counted yet. Start scanning.",
              )}
            />
          ),
        }}
        onRow={(r) => ({
          ref: (el: HTMLElement | null) => {
            rowRefs.current[r.serial] = el;
          },
          onClick: () => setFocused(r.serial),
          style: {
            cursor: "pointer",
            // The duplicate flash. A background rather than a border so the
            // row does not change height and shove the list under the hand.
            transition: "background-color 400ms ease",
            backgroundColor:
              flash === r.serial
                ? "var(--nusantara-gold)"
                : focused === r.serial
                  ? "rgba(0,0,0,0.03)"
                  : undefined,
          },
        })}
        columns={[
          {
            title: t("opname.serial", "Serial"),
            dataIndex: "serial",
            render: (v: string) => (
              <Input
                size="small"
                value={v}
                style={{ fontFamily: "monospace" }}
                onClick={(e) => e.stopPropagation()}
                // Editable after the fact: a mistyped serial is the most
                // common counting error, and forcing a delete-and-retype
                // loses its place in the list.
                onChange={(e) =>
                  setSerials((prev) =>
                    prev.map((s) =>
                      s === v ? e.target.value.toUpperCase() : s,
                    ),
                  )
                }
              />
            ),
          },
          {
            title: t("opname.product", "Product"),
            render: (_, r) => skuOf(r.serial),
          },
          {
            /*
             * The machine's own photograph, beside the serial the counter has
             * just read off it (owner decision 2026-08-26).
             *
             * A stock take is the one job in this app done away from the desk,
             * holding the thing being recorded, and a serial is fourteen
             * characters that all look alike at arm's length on a cold shelf.
             * The picture taken at QC is what turns "is this the right row?"
             * into a glance.
             *
             * Editable while the count is a draft: a counter who finds a
             * machine damaged has the evidence in their hand and no better
             * moment to record it. A posted count is a record and takes
             * nothing new.
             */
            title: t("opname.photo", "Photo"),
            width: 170,
            render: (_, r) => (
              <div onClick={(e) => e.stopPropagation()}>
                <UnitPhotos serial={r.serial} editable={!posted} size={36} />
              </div>
            ),
          },
          {
            title: t("opname.check", "Check"),
            width: 170,
            render: (_, r) => (
              <Tag color={KIND_TAG[r.kind].color}>
                {t(KIND_TAG[r.kind].label)}
              </Tag>
            ),
          },
          {
            title: "",
            width: 96,
            render: (_, r) => (
              <Flex justify="end">
                {historyButton(r.serial)}
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  aria-label={t("opname.removeAria", "Remove {{serial}}", {
                    serial: r.serial,
                  })}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSerials((prev) => prev.filter((s) => s !== r.serial));
                  }}
                />
              </Flex>
            ),
          },
        ]}
      />
    </Card>
  );

  /**
   * The rack the system files a unit on, when it knows one.
   *
   * Worth a column on the counted list specifically: the warehouse is the same
   * for every counted row by definition — it is the warehouse being counted —
   * so it says nothing, while the rack is what tells a counter where the
   * machine was supposed to be sitting.
   */
  const rackOf = (serial: string) => {
    const u = db.units.find((x) => x.serial === serial);
    return (u && db.racks.find((r) => r.id === u.rackId)?.name) || "—";
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
      /** The machine's QC photograph, for a list of real machines. */
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
                  // counting screen with the machine in hand.
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
                    const u = db.units.find((x) => x.serial === s);
                    // A serial the system has never seen has no status to
                    // show — which only happens on the unknown list, but the
                    // column has to survive it either way.
                    return u ? (
                      <EnumTag map={UNIT_STATUS} value={u.status} />
                    ) : (
                      "—"
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
                      <Typography.Text>{notes[s] || "—"}</Typography.Text>
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
                  /*
                   * Take an unrecorded machine into stock (owner ask
                   * 2026-08-31).
                   *
                   * Offered only for a serial the system has never seen. A
                   * unit that belongs to another warehouse is already the
                   * shop's — it is in the wrong place, which is a movement,
                   * not a machine to create — and a second row for it would
                   * be a duplicate of a laptop that exists.
                   */
                  title: t("opname.takeIntoStock", "Take into stock"),
                  width: 220,
                  render: (s: string) => {
                    if (db.units.some((u) => u.serial === s)) {
                      return (
                        <Typography.Text type="secondary">
                          {t("opname.alreadyOurs", "Already ours — move it")}
                        </Typography.Text>
                      );
                    }
                    const decision = surplus[s];
                    if (posted) {
                      return decision ? (
                        <Typography.Text>
                          {t("opname.addedToQc", "Added to QC — {{reason}}", {
                            reason: decision.reason,
                          })}
                        </Typography.Text>
                      ) : (
                        "—"
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
                          <Typography.Text
                            type="secondary"
                            style={{ fontSize: 12 }}
                          >
                            {skuName(decision.skuId)} · {decision.reason}
                          </Typography.Text>
                        )}
                      </Flex>
                    );
                  },
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

  const confirmPhase = (
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

      {/*
       * What was actually found, listed — not just totalled.
       *
       * Added 2026-08-26 at the owner's request. The review step used to show
       * only the two discrepancy lists, so "Counted: 47" was a number with
       * nothing behind it: there was no way to check whether a particular
       * serial had been counted, and on a POSTED count — which opens straight
       * on this view — the counted serials were not visible anywhere in the
       * app at all. The scan list that holds them exists only in the counting
       * phase, which a posted count never renders.
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
    </Flex>
  );

  /**
   * The step between counting and the confirmation (owner ask 2026-09-01).
   *
   * It answers one question — is this the count I meant to run — and it is the
   * last moment the answer can change anything, because the next screen posts.
   * So the Edit scope button is on the card as well as in the header: somebody
   * who has just discovered they were counting the wrong rack should not have
   * to scroll back up to fix it.
   */
  const expectedPhase = (
    <Card
      title={t("opname.expectedTitle", "Expected in this count ({{count}})", {
        count: expected.length,
      })}
      extra={
        <Typography.Text type="secondary">
          {t(
            "opname.expectedSubtitle",
            "What the shop's records say is inside this scope",
          )}
        </Typography.Text>
      }
    >
      <Flex vertical gap={12}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t(
            "opname.expectedHint",
            "Check the scope before you post. A product you did not expect to see here — or one you expected and cannot find at all — usually means the count covers more or less than you meant.",
          )}
        </Typography.Paragraph>
        <Table
          rowKey="skuId"
          size="small"
          pagination={false}
          dataSource={expectedByProduct}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t(
                  "opname.expectedNothing",
                  "Nothing is expected inside this scope. Widen it, or every serial you scanned will read as unexpected.",
                )}
              />
            ),
          }}
          expandable={{
            // The serials, one level down. A row is the answer; this is the
            // working behind it, and it is only ever opened for the one
            // product whose numbers do not agree.
            expandedRowRender: (r) => (
              <Flex gap={6} wrap>
                {r.units.map((u) => (
                  <Tag
                    key={u.serial}
                    color={scannedSet.has(u.serial) ? "green" : "default"}
                    style={{ fontFamily: "monospace" }}
                  >
                    {u.serial}
                  </Tag>
                ))}
              </Flex>
            ),
          }}
          columns={[
            {
              title: t("opname.product", "Product"),
              dataIndex: "product",
            },
            {
              title: t("opname.expectedQty", "Expected"),
              dataIndex: "expected",
              align: "right" as const,
              width: 110,
            },
            {
              title: t("opname.countedQty", "Counted"),
              dataIndex: "counted",
              align: "right" as const,
              width: 110,
            },
            {
              title: t("opname.difference", "Difference"),
              key: "diff",
              align: "right" as const,
              width: 120,
              render: (_: unknown, r: (typeof expectedByProduct)[number]) => {
                const diff = r.counted - r.expected;
                if (diff === 0)
                  return (
                    <Typography.Text type="success">
                      {t("opname.allFound", "All found")}
                    </Typography.Text>
                  );
                return (
                  <Typography.Text type="danger">
                    {t("opname.shortBy", "{{count}} short", {
                      count: -diff,
                    })}
                  </Typography.Text>
                );
              },
            },
          ]}
        />
        {/*
         * The counted shelves, on the same step and in the same shape (owner
         * ask 2026-09-15). Here the expected number IS shown — the counting
         * is over, and checking the scope is what this step is for.
         */}
        {countedProducts.length > 0 && (
          <>
            <Typography.Text strong>
              {t("opname.byQuantityTitle", "Counted by quantity")}
            </Typography.Text>
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
                  width: 110,
                },
                {
                  title: t("opname.countedQty", "Counted"),
                  key: "found",
                  align: "right" as const,
                  width: 110,
                  render: (_: unknown, r: (typeof countedProducts)[number]) =>
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
                  align: "right" as const,
                  width: 120,
                  render: (_: unknown, r: (typeof countedProducts)[number]) => {
                    if (!r.answered)
                      return (
                        <Typography.Text type="warning">
                          {t("opname.notCountedYet", "not counted")}
                        </Typography.Text>
                      );
                    if (r.delta === 0)
                      return (
                        <Typography.Text type="success">
                          {t("opname.allFound", "All found")}
                        </Typography.Text>
                      );
                    return (
                      <Typography.Text type="danger">
                        {r.delta < 0
                          ? t("opname.shortBy", "{{count}} short", {
                              count: -r.delta,
                            })
                          : t("opname.overBy", "{{count}} extra", {
                              count: r.delta,
                            })}
                      </Typography.Text>
                    );
                  },
                },
                {
                  // The line the post gate asks for. On this step rather than
                  // on the counting one, because it is here that the number
                  // and the expectation are beside each other — which is when
                  // somebody can actually say why they differ.
                  title: t("opname.note", "Note"),
                  key: "note",
                  width: 260,
                  render: (_: unknown, r: (typeof countedProducts)[number]) =>
                    !r.answered || r.delta === 0 ? null : (
                      <Input
                        disabled={posted}
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
          </>
        )}
      </Flex>
    </Card>
  );

  return (
    // The code, not the batch label: `PageContainer` runs its title through
    // `t()`, and a staff-typed label that happened to match a catalogue key
    // would come back translated. The label is on the card below.
    <PageContainer title={session.code} backTo="/stock/opname">
      <Flex vertical gap={16}>
        {header}
        {posted ? (
          confirmPhase
        ) : phase === "COUNT" ? (
          <Flex vertical gap={16}>
            {countPhase}
            {countedCard}
          </Flex>
        ) : phase === "EXPECTED" ? (
          expectedPhase
        ) : (
          confirmPhase
        )}
      </Flex>

      <FooterToolbar
        info={
          <Typography.Text>
            {t(
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
          // Movement batch editor rather than unlocking this page — a machine
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
                        "Check the expected list, then review what is missing and what turned up unexpectedly",
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
                  // Lands on the expected list, not the confirmation. Same
                  // button, one step earlier — see the `phase` docblock.
                  onClick={() => setPhase("EXPECTED")}
                >
                  {t("opname.review", "Review & finish")}
                </Button>
              </Tooltip>
            ) : phase === "EXPECTED" ? (
              <>
                <Button onClick={() => setPhase("COUNT")}>
                  {t("opname.backToCounting", "Back to counting")}
                </Button>
                <Button type="primary" onClick={() => setPhase("CONFIRM")}>
                  {t("opname.continueToReview", "Continue to review")}
                </Button>
              </>
            ) : (
              <>
                <Button onClick={() => setPhase("EXPECTED")}>
                  {t("opname.backToExpected", "Back to the expected list")}
                </Button>
                <Button type="primary" onClick={post}>
                  {t("opname.postOk", "Post count")}
                </Button>
              </>
            )}
          </>
        )}
      </FooterToolbar>

      {/*
       * The history dialog the side panel became.
       *
       * `destroyOnHidden` so the timeline is rebuilt for each serial rather
       * than kept for every one ever opened during a long count — and so an
       * adjustment made while the count is open is reflected the next time the
       * same serial's history is asked for.
       */}
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
                  "Widening the scope adds machines to what this count expects; narrowing it takes them away. A serial you scanned that falls outside the new scope is not deleted — it moves to the unknown list, because somebody did read it off a machine.",
                )}
              />
            </ScopeFields>
          </Form>
        )}
      </Modal>

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
