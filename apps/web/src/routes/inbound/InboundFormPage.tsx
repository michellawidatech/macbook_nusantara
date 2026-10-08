/**
 * Raising a purchase order — three steps, in the order the owner described
 * (2026-08-24).
 *
 * ## Why products are optional
 *
 * The shape of this form is dictated by how the shop actually buys. The owner
 * deals with suppliers; the staff enter the paperwork. Often the owner simply
 * says "transfer this much to that supplier", and nobody at a keyboard knows
 * what it buys until the boxes arrive days later.
 *
 * So step 1 asks only for what is knowable on the day the money moves —
 * supplier, invoice, what was paid — and step 2, the products, can be left
 * empty and filled in from the Inbound detail screen when the goods land. The
 * previous version required at least one priced line before it would let you
 * past step 1, which meant staff invented lines to get an order saved.
 *
 * ## Where the money lives
 *
 * On the order, as a payment. That reverses the note in the old page saying the
 * owner had removed "amount paid" because "a PO's total IS its lines" — true
 * only when the lines are known first. With products optional, the transfer is
 * the ONLY fact available on day one, and deriving it from lines that do not
 * exist yet would record it as zero.
 *
 * Paying less than the invoice is normal, not an error: a deposit now and the
 * balance on delivery is how the shop buys. The order carries the outstanding
 * balance rather than refusing the entry.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import dayjs, { type Dayjs } from "dayjs";
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Flex,
  Form,
  Input,
  InputNumber,
  Segmented,
  Select,
  Steps,
  Typography,
} from "antd";
import { DeleteOutlined, SaveOutlined } from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { FooterToolbar } from "../../components/FooterToolbar";
import { skuFullName } from "../../components/SkuPicker";
import { skuTracksSerial } from "../../lib/serialTracking.js";
import { MoneyInput } from "../../components/MoneyInput";
import { CommitMoneyInput } from "../../components/CommitMoneyInput";
import { RP_SYMBOL } from "../../components/money";
import { fmtRp, fmtNone } from "../../lib/format.js";
import { startingPrice } from "../../lib/unitPrice.js";
import { BatteryFields } from "../../components/BatteryFields";
import { UnitDetailsModal } from "../../components/UnitDetailsModal";
import { PurchaseLinesTable } from "./PurchaseLinesTable.js";
import { pieceCosts, type PurchaseLine } from "../../lib/invoiceLines.js";
import {
  batteryPatch,
  defaultBatteryModeOfSku,
  type BatteryDraft,
  type BatteryMode,
} from "../../lib/battery.js";
import {
  NEW_GRADE,
  conditionOf,
  needsDescription,
} from "../../lib/condition.js";
import { GRADES } from "../../lib/grading.js";
import { joinDescription } from "../../lib/inboundQc.js";
import {
  BASE_MAX_LENGTH,
  BASE_MIN_LENGTH,
  normaliseScan,
  SERIAL_FIELD_MAX_LENGTH,
} from "../../lib/serialScan.js";
import { readSerialInput, serialConditionOf } from "../../lib/serialInput.js";
import { wasScannedText } from "../../lib/scanner.js";
import { SPACE, TYPE, COLUMN } from "../../theme/tokens";
import {
  useDb,
  mutate,
  nextId,
  docCode,
  appendEvent,
  ensureQcDescription,
} from "../../mock/store.js";
import { FORM_CENTRE } from "../../theme/tokens";
import { usePersistentState } from "../../hooks/usePersistentState";
import {
  INBOUND_DRAFT_KEY,
  inboundDraftHasContent,
  parseInboundDraft,
  type InboundDraft,
} from "../../lib/inboundDraft.js";
import { useTranslation } from "react-i18next";
import type { MockDb, Po, PoItem } from "../../mock/seed.js";
import { warehouseLabel, warehouseLabelOf } from "../../lib/warehouses.js";

/**
 * What the popup behind a line has been told about one of its units (owner
 * ask 2026-09-20: *"a modal popup for the user to fill: Serial, grade,
 * battery, sell price"*, plus the description that gates acceptance).
 *
 * Held here until the order is saved, and written onto the unit the serial
 * mints in the same mutation — the order's own page does the same thing with
 * its `qcDrafts`.
 */
interface UnitDraft {
  key: string;
  /** What is in the serial box — judged once the unit has a grade. */
  serial: string;
  /**
   * The text in the box has not been judged yet, and how it arrived: it is
   * being typed, or it waits for the grade (2026-09-21) — and on a new unit a
   * scan and a typed serial are held to different rules. Absent once judged.
   */
  pending?: "scan" | "typed";
  grade?: string;
  battery: BatteryDraft;
  description: string[];
  price?: number;
}

/**
 * One LINE of the order (owner ask 2026-09-20: *"user will input: unit, qty,
 * price … it will not automatically expand the unit below it"*).
 *
 * This reverses the one-row-per-unit shape of 2026-09-19. A line is a product,
 * a quantity, one price and a discount; two units of one product that cost
 * different money are two lines, which is the owner's own answer to the
 * question. The units behind it live in `units`, filled in from the popup.
 */
interface Line {
  key: string;
  skuId?: string;
  qty: number;
  unitCost?: number;
  discount?: number;
  units: UnitDraft[];
}

const blankUnit = (): UnitDraft => ({
  key: nextId("qcd"),
  serial: "",
  battery: {},
  description: [],
});

/** As many unit drafts as the line has pieces — never fewer, never more. */
function sized(units: readonly UnitDraft[], qty: number): UnitDraft[] {
  const want = Math.max(0, Math.floor(qty));
  if (units.length === want) return [...units];
  if (units.length > want) return units.slice(0, want);
  return [
    ...units,
    ...Array.from({ length: want - units.length }, () => blankUnit()),
  ];
}

const STEPS = [
  { title: "Order & payment" },
  { title: "Products" },
  { title: "Review" },
];

export function InboundFormPage() {
  const { t } = useTranslation();
  const db = useDb();
  const navigate = useNavigate();
  const { message } = App.useApp();
  /**
   * The wizard, mirrored to this device on every keystroke (owner ask
   * 2026-09-15).
   *
   * Read ONCE, into the ordinary state below, rather than held as the state
   * itself: eleven fields reading and writing one object would rerender the
   * whole form on every character, and every existing control here is written
   * against its own setter. The effect underneath is the mirror. See
   * `lib/inboundDraft.ts` for why auto-save and *Save draft* are two different
   * things.
   */
  const [stored, setStored, clearStored] =
    usePersistentState<InboundDraft | null>(INBOUND_DRAFT_KEY, null, (raw) =>
      raw === null ? null : parseInboundDraft(raw),
    );
  // Read at mount and never again: `stored` changes on every keystroke once
  // the mirror below starts writing, and re-seeding from it would fight the
  // person typing.
  const [restored] = useState(() =>
    stored !== null && inboundDraftHasContent(stored) ? stored : null,
  );
  const [restoreOffered, setRestoreOffered] = useState(restored !== null);

  const [step, setStep] = useState(restored?.step ?? 0);

  const [supplier, setSupplier] = useState<string | undefined>(
    restored?.supplier,
  );
  const [invoice, setInvoice] = useState(restored?.invoice ?? "");
  const [noInvoice, setNoInvoice] = useState(restored?.noInvoice ?? false);
  const [date, setDate] = useState<Dayjs | null>(
    restored?.date ? dayjs(restored.date) : dayjs(),
  );
  const [warehouseId, setWarehouseId] = useState(
    // A warehouse the shop has since removed would leave the Select showing an
    // id, so the stored one is only taken when it is still a place.
    restored?.warehouseId &&
      db.warehouses.some((w) => w.id === restored.warehouseId)
      ? restored.warehouseId
      : db.myWarehouseId,
  );
  const [method, setMethod] = useState<string>(restored?.method ?? "TUNAI");
  const [paid, setPaid] = useState<number | undefined>(restored?.paid);
  const [shippingFee, setShippingFee] = useState<number | undefined>(
    restored?.shippingFee,
  );
  const [taxFee, setTaxFee] = useState<number | undefined>(restored?.taxFee);
  /**
   * The negotiated discount, in whichever unit it was agreed in.
   *
   * Suppliers quote both ways — "I'll knock 500 off" and "5% for cash" — and
   * until 2026-08-26 this form only took rupiah, so a percentage had to be
   * worked out on a phone calculator before it could be typed in. That is a
   * rounding error waiting to happen and, worse, it throws away WHICH deal was
   * struck: 5% of an order whose lines are still unknown is not a number yet.
   *
   * `Po.discount` stays a rupiah figure — it is what the invoice total is
   * built from and no schema column changes — so a percentage is resolved
   * against the subtotal at the moment the order is saved.
   */
  const [discountMode, setDiscountMode] = useState<"RP" | "PCT">(
    restored?.discountMode ?? "RP",
  );
  const [discount, setDiscount] = useState<number | undefined>(
    restored?.discount,
  );
  const [discountPct, setDiscountPct] = useState<number | undefined>(
    restored?.discountPct,
  );
  const [lines, setLines] = useState<Line[]>(() =>
    (restored?.lines ?? []).map((l) => ({
      key: nextId("pol"),
      ...(l.skuId === undefined ? {} : { skuId: l.skuId }),
      qty: Math.max(1, l.qty || 1),
      ...(l.unitCost === undefined ? {} : { unitCost: l.unitCost }),
      ...(l.discount === undefined ? {} : { discount: l.discount }),
      units: (l.units ?? []).map((u) => ({
        key: nextId("qcd"),
        serial: u.serial,
        ...(u.pending === undefined ? {} : { pending: u.pending }),
        ...(u.grade === undefined ? {} : { grade: u.grade }),
        battery: {
          ...(u.health === undefined ? {} : { health: u.health }),
          ...(u.cycleCount === undefined ? {} : { cycleCount: u.cycleCount }),
          ...(u.fcc === undefined ? {} : { fcc: u.fcc }),
        },
        description: [...(u.description ?? [])],
        ...(u.price === undefined ? {} : { price: u.price }),
      })),
    })),
  );
  /** Which line's units are open. Null for none. */
  const [detailsKey, setDetailsKey] = useState<string | null>(null);
  /** Serial boxes whose text was refused — outlined in red until it changes. */
  const [serialFault, setSerialFault] = useState<Record<string, boolean>>({});

  /**
   * The mirror. One effect over every answer, so nothing can be added to the
   * form and quietly left out of what is saved.
   */
  useEffect(() => {
    setStored({
      step,
      ...(supplier === undefined ? {} : { supplier }),
      invoice,
      noInvoice,
      date: date ? date.format("YYYY-MM-DD") : null,
      warehouseId,
      method,
      ...(paid === undefined ? {} : { paid }),
      ...(shippingFee === undefined ? {} : { shippingFee }),
      ...(taxFee === undefined ? {} : { taxFee }),
      discountMode,
      ...(discount === undefined ? {} : { discount }),
      ...(discountPct === undefined ? {} : { discountPct }),
      lines: lines.map((l) => ({
        ...(l.skuId === undefined ? {} : { skuId: l.skuId }),
        qty: l.qty,
        ...(l.unitCost === undefined ? {} : { unitCost: l.unitCost }),
        ...(l.discount === undefined ? {} : { discount: l.discount }),
        units: l.units.map((u) => ({
          serial: u.serial,
          ...(u.pending === undefined ? {} : { pending: u.pending }),
          ...(u.grade === undefined ? {} : { grade: u.grade }),
          ...(u.battery.health == null ? {} : { health: u.battery.health }),
          ...(u.battery.cycleCount == null
            ? {}
            : { cycleCount: u.battery.cycleCount }),
          ...(u.battery.fcc == null ? {} : { fcc: u.battery.fcc }),
          description: u.description,
          ...(u.price === undefined ? {} : { price: u.price }),
        })),
      })),
    });
  }, [
    setStored,
    step,
    supplier,
    invoice,
    noInvoice,
    date,
    warehouseId,
    method,
    paid,
    shippingFee,
    taxFee,
    discountMode,
    discount,
    discountPct,
    lines,
  ]);

  /**
   * `MoneyInput` clears to `null`; this state is `undefined`.
   *
   * One adapter rather than a cast at each of the five call sites — the two
   * values mean the same thing here ("no amount entered") and the difference
   * is antd's, not the form's.
   */
  const money = (set: (v: number | undefined) => void) => (v: number | null) =>
    set(v ?? undefined);

  const poMethods = useMemo(
    () => db.paymentMethods.filter((m) => m.forPo && m.active),
    [db.paymentMethods],
  );
  /** What a line is worth, net of the discount knocked off that line. */
  const lineTotal = (l: Line) =>
    Math.max(0, (l.unitCost ?? 0) * (l.qty || 0) - (l.discount ?? 0));
  const subtotal = lines.reduce((t, l) => t + lineTotal(l), 0);
  /** Pieces on the invoice — what the expenses are spread over. */
  const pieceCount = lines.reduce((n, l) => n + Math.max(0, l.qty || 0), 0);
  const charges = (shippingFee ?? 0) + (taxFee ?? 0);
  /**
   * A line's COGS: what is owed for it plus its share of the invoice's
   * expenses (owner ask 2026-09-20: *"display total (+ COGS based on the tax +
   * shipping fee displayed before)"*). Evenly by the piece, which is how
   * `lib/landedCost.ts` spreads them once the order exists — a courier charges
   * by the box.
   */
  const lineCogs = (l: Line) =>
    lineTotal(l) +
    (pieceCount === 0
      ? 0
      : Math.round((charges * Math.max(0, l.qty || 0)) / pieceCount));
  /**
   * What the discount is worth in rupiah, whichever way it was entered.
   *
   * A percentage bites on the SUBTOTAL, not on the invoiced total: the shop
   * negotiates a discount on the goods, and shipping and tax are the
   * courier's and the state's, not the supplier's to discount. Capped at the
   * subtotal so a mistyped 500% cannot turn an order into money owed to the
   * shop.
   */
  const discountRp =
    discountMode === "PCT"
      ? Math.min(subtotal, Math.round((subtotal * (discountPct ?? 0)) / 100))
      : (discount ?? 0);
  const total = Math.max(
    0,
    subtotal + (shippingFee ?? 0) + (taxFee ?? 0) - discountRp,
  );
  const outstanding = Math.max(0, total - (paid ?? 0));

  /**
   * What blocks step 1, and deliberately nothing else.
   *
   * Supplier, date, and an invoice number OR an explicit "no invoice" — the
   * escape hatch the schema's `noInvoice` column exists for. Products are not
   * here, which is the whole point of the redesign.
   */
  const step1Error = (): string | null => {
    if (!supplier?.trim()) return "Pick or type a supplier.";
    if (!date) return "Pick the date the order was placed.";
    if (!noInvoice && !invoice.trim())
      return "Enter the invoice number, or tick “no invoice”.";
    return null;
  };

  /**
   * One line of the form as the `PoItem`s the store holds.
   *
   * A counted product (an accessory) is ONE row of a quantity — it is never
   * priced or identified piece by piece (2026-09-19). Everything else is one
   * row per piece, because that row is what a unit is pinned to
   * (`PoItem.serial`) and what the invoice's expenses are spread over
   * (`lib/landedCost.ts`). The SCREEN still shows one line, which is the
   * whole of the owner's 2026-09-20 ask — see `lib/invoiceLines.ts`.
   *
   * The line's discount is spread over its pieces, so the rupiah add back up
   * to what was negotiated and each unit's `buy` is what it really cost.
   */
  const itemsOf = (
    l: Line,
    /** The serial a unit is filed under — its box, judged. */
    serialOf: (u: UnitDraft) => string = (u) => u.serial,
  ) => {
    const skuId = l.skuId!;
    const qty = Math.max(1, Math.floor(l.qty || 1));
    const unitCost = l.unitCost ?? 0;
    const discount = Math.min(l.discount ?? 0, unitCost * qty);
    if (!skuTracksSerial(db, skuId)) {
      return [
        {
          id: nextId("poi"),
          skuId,
          serial: null,
          qty,
          unitCost,
          ...(discount > 0 ? { discount } : {}),
        },
      ];
    }
    const costs = pieceCosts(qty, unitCost, discount);
    return Array.from({ length: qty }, (_, i) => {
      const off = unitCost - (costs[i] ?? unitCost);
      const unit = l.units[i];
      const serial = unit ? serialOf(unit).trim() : "";
      return {
        id: nextId("poi"),
        skuId,
        serial: serial === "" ? null : serial,
        qty: 1,
        unitCost,
        ...(off > 0 ? { discount: off } : {}),
      };
    });
  };

  /**
   * The units the form was told about, as real units in QC.
   *
   * The same thing the order's own page does when a serial is read into a row
   * (`identify` in `InboundDetailPage`): the unit and its `DITERIMA` go in one
   * mutation, and what the popup answered — battery, description, grade, sell
   * price — is written onto it in the same breath. Without this the serials
   * somebody typed on the way in would be thrown away at Save.
   *
   * A draft mints nothing. A draft is paperwork nobody has acted on, and a
   * unit is a machine on a shelf.
   *
   * `made` is each line's own `PoItem`s, by line key — never a filter on the
   * product, which would run two lines of one variant together and give the
   * second line's serials the first line's prices.
   */
  const receive = (
    d: MockDb,
    order: Po,
    made: ReadonlyMap<string, readonly PoItem[]>,
    serialOf: (u: UnitDraft) => string,
  ) => {
    let any = false;
    for (const l of lines) {
      if (!l.skuId || !skuTracksSerial(db, l.skuId)) continue;
      const mine = made.get(l.key) ?? [];
      l.units.forEach((u, i) => {
        const serial = serialOf(u).trim();
        const line = mine[i];
        if (serial === "" || line === undefined) return;
        if (d.units.some((x) => x.serial === serial)) return;
        any = true;
        const battery = batteryPatch(
          u.battery,
          defaultBatteryModeOfSku(d, l.skuId!),
        );
        const start =
          u.price ?? startingPrice(d.skus.find((x) => x.id === l.skuId)?.price);
        d.units.push({
          serial,
          skuId: l.skuId!,
          status: "QC",
          locationId: order.locationId,
          buy: line.unitCost - (line.discount ?? 0),
          description:
            u.description.length === 0
              ? ""
              : joinDescription(
                  u.description
                    .map((w) => ensureQcDescription(d, w))
                    .filter(Boolean),
                ),
          poId: order.id,
          // What the bench typed, or what the variant asks — never a Rp 0
          // nobody typed (`startingPrice`).
          ...(start === undefined ? {} : { price: start }),
          ...(u.grade === undefined ? {} : { grade: u.grade }),
          ...battery,
        });
        appendEvent(d, serial, {
          type: "DITERIMA",
          toStatus: "QC",
          refCode: order.code,
          note: `Received against ${order.code}`,
        });
      });
    }
    // A unit in hand is the proof the goods came.
    if (any) order.status = "RECEIVED";
  };

  /**
   * Write the order — as a draft, or as one that has been placed.
   *
   * *Save draft* is the fallback the owner asked for on every step: a real
   * `Po` with `status: "DRAFT"`, which is on the Inbound list, has a code and
   * can be opened from another till. Auto-save cannot do any of that — it is
   * this device's `localStorage` — so the two are not alternatives, they are a
   * short net and a long one. See `lib/inboundDraft.ts`.
   *
   * Both go through the same writer, because a draft and a placed order differ
   * in exactly one field and having two functions is how they come to differ
   * in two.
   */
  const save = (status: "DRAFT" | "ORDERED" = "ORDERED") => {
    const err = step1Error();
    if (err) {
      message.error(err);
      setStep(0);
      return;
    }
    /*
     * A placed order makes a unit of every serial the popup was given, so each
     * has to be recordable NOW (2026-09-21): a grade to say which rule it is
     * held to, and a pass under that rule. Refused rather than dropped — a
     * serial left behind at Save is a serial nobody typed twice. A draft
     * makes no unit and is not asked.
     */
    const judged = new Map<string, string>();
    const notReady: string[] = [];
    if (status !== "DRAFT") {
      for (const l of lines) {
        if (!l.skuId || !skuTracksSerial(db, l.skuId)) continue;
        for (const u of l.units) {
          if (u.serial.trim() === "") continue;
          if (
            u.pending === undefined &&
            serialFault[u.key] !== true &&
            serialConditionOf(u.grade) !== undefined
          ) {
            continue;
          }
          const read = readSerialInput(u.serial, {
            scanned: u.pending === "scan",
            condition: serialConditionOf(u.grade),
          });
          if (read.ok) judged.set(u.key, read.serial);
          else notReady.push(u.key);
        }
      }
    }
    if (notReady.length > 0) {
      setSerialFault((f) => ({
        ...f,
        ...Object.fromEntries(notReady.map((k) => [k, true])),
      }));
      message.error(
        t(
          "inboundForm.serialsNotReady",
          "{{count}} serial(s) cannot be recorded yet — each needs its unit's grade, and a new unit's must pass its check. Open Units on the line to finish them, or save a draft.",
          { count: notReady.length },
        ),
      );
      return;
    }
    const serialOf = (u: UnitDraft) => judged.get(u.key) ?? u.serial;
    const id = nextId("po");
    // Built once, outside the mutation, so the units can be tied back to the
    // very `PoItem`s that were written for their line.
    const made = new Map<string, PoItem[]>(
      lines.filter((l) => l.skuId).map((l) => [l.key, itemsOf(l, serialOf)]),
    );
    mutate((d) => {
      const supplierId =
        d.suppliers.find(
          (s) => s.name.toLowerCase() === supplier!.trim().toLowerCase(),
        )?.id ??
        (() => {
          // A supplier typed rather than picked is a new one. Creating it here
          // beats making staff leave a half-filled order to go and add it.
          const fresh = { id: nextId("sup"), name: supplier!.trim() };
          d.suppliers.push(fresh);
          return fresh.id;
        })();
      d.pos.unshift({
        id,
        code: docCode("PI"),
        supplierId,
        invoice: noInvoice ? "" : invoice.trim(),
        noInvoice,
        date: date!.format("YYYY-MM-DD"),
        locationId: warehouseId,
        items: [...made.values()].flat(),
        payments: paid
          ? [
              {
                id: nextId("pp"),
                method,
                amount: paid,
                at: new Date().toISOString(),
              },
            ]
          : [],
        // The form's two boxes are the invoice's first two expenses; anything
        // else owed on the delivery is added on the order's page, where each
        // expense also says whether it joins the machines' cost (2026-09-18).
        fees: [
          ...(shippingFee
            ? [
                {
                  id: nextId("pof"),
                  kind: "SHIPPING" as const,
                  label: "",
                  amount: shippingFee,
                  inCogs: true,
                },
              ]
            : []),
          ...(taxFee
            ? [
                {
                  id: nextId("pof"),
                  kind: "TAX" as const,
                  label: "",
                  amount: taxFee,
                  inCogs: true,
                },
              ]
            : []),
        ],
        discount: discountRp,
        status,
      });
      const saved = d.pos.find((x) => x.id === id);
      if (saved && status !== "DRAFT") receive(d, saved, made, serialOf);
    });
    // The order IS the draft now, so the device's copy has done its job.
    // Leaving it behind would offer to restore this order onto the next one.
    clearStored();
    message.success(
      status === "DRAFT"
        ? t(
            "inboundForm.draftSaved",
            "Saved as a draft. It is on the Inbound list — finish it whenever.",
          )
        : lines.length === 0
          ? t(
              "inboundForm.savedNoProducts",
              "Order saved. Add the products from the order page when the goods arrive.",
            )
          : t("inboundForm.saved", "Order saved."),
    );
    navigate(`/inbound/${id}`);
  };

  const orderStep = (
    <Card
      title={t("inboundForm.orderPayment", "Order & payment")}
      style={FORM_CENTRE}
    >
      <Form layout="vertical" style={FORM_CENTRE}>
        <Form.Item label={t("inboundForm.supplier", "Supplier")} required>
          <AutoComplete
            value={supplier}
            onChange={setSupplier}
            // Named, because `Form.Item`'s label only binds to a field with an
            // id and none of these have one — see `CountInput` on why an
            // anonymous box in this app is a bug rather than a detail.
            aria-label={t("inboundForm.supplier", "Supplier")}
            placeholder={t(
              "inboundForm.searchOrTypeANew",
              "Search or type a new supplier name",
            )}
            options={db.suppliers.map((s) => ({ value: s.name }))}
            filterOption={(input, option) =>
              (option?.value ?? "").toLowerCase().includes(input.toLowerCase())
            }
          />
        </Form.Item>

        <Form.Item
          label={t("inboundForm.invoiceNumber", "Invoice number")}
          required={!noInvoice}
        >
          <Input
            value={invoice}
            disabled={noInvoice}
            onChange={(e) => setInvoice(e.target.value)}
            placeholder={t("inboundForm.eGInvMj0815", "e.g. INV/MJ/0815")}
          />
        </Form.Item>
        <Form.Item>
          <Checkbox
            checked={noInvoice}
            onChange={(e) => {
              setNoInvoice(e.target.checked);
              if (e.target.checked) setInvoice("");
            }}
          >
            {t(
              "inboundForm.thisSupplierIssuedNoInvoice",
              "This supplier issued no invoice",
            )}
          </Checkbox>
        </Form.Item>

        {/*
         * The six facts about the order that are not the supplier or the
         * invoice, on one grid of equal columns (owner decision 2026-08-26).
         *
         * They were three `Flex` rows of two, each field carrying its own
         * hand-picked pixel width — 180 for the date, 200 for the warehouse,
         * whatever a `MoneyInput` happened to be — so no two columns lined up
         * and the form read as six unrelated boxes. `1fr` columns make the
         * question of how wide a field should be answerable in one place, and
         * `auto-fit` drops the grid to two columns and then one as the measure
         * narrows, so a phone gets a stack rather than six slivers.
         */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            columnGap: 16,
          }}
        >
          <Form.Item
            label={t("inboundForm.dateOfPurchase", "Date of purchase")}
            required
          >
            <DatePicker
              value={date}
              onChange={setDate}
              // "26 Aug 2026", not "26 08 2026" (owner decision 2026-08-26). A
              // named month cannot be read the American way round, which is
              // the whole point: 08 09 2026 is two different days depending on
              // who is looking at it.
              format="DD MMM YYYY"
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item label={t("inboundForm.arrivingAt", "Arriving at")}>
            <Select
              value={warehouseId}
              onChange={setWarehouseId}
              style={{ width: "100%" }}
              options={db.warehouses.map((w) => ({
                value: w.id,
                label: warehouseLabel(w),
              }))}
            />
          </Form.Item>
          <Form.Item label={t("inboundForm.paymentMethod", "Payment method")}>
            <Select
              value={method}
              onChange={setMethod}
              style={{ width: "100%" }}
              options={poMethods.map((m) => ({
                value: m.code,
                label: m.label,
              }))}
            />
          </Form.Item>
          <Form.Item
            label={t("inboundForm.totalPaidNow", "Total paid now")}
            extra={t(
              "inboundForm.paidNowHint",
              "Leave blank if nothing has been transferred yet.",
            )}
          >
            <MoneyInput
              style={{ width: "100%" }}
              aria-label={t("inboundForm.totalPaidNow", "Total paid now")}
              value={paid}
              onChange={money(setPaid)}
            />
          </Form.Item>
          <Form.Item label={t("inboundForm.shippingFee", "Shipping fee")}>
            <MoneyInput
              style={{ width: "100%" }}
              aria-label={t("inboundForm.shippingFee", "Shipping fee")}
              value={shippingFee}
              onChange={money(setShippingFee)}
            />
          </Form.Item>
          <Form.Item label={t("inboundForm.taxFee", "Tax fee")}>
            <MoneyInput
              style={{ width: "100%" }}
              aria-label={t("inboundForm.taxFee", "Tax fee")}
              value={taxFee}
              onChange={money(setTaxFee)}
            />
          </Form.Item>
        </div>
      </Form>
    </Card>
  );

  const editLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const editUnit = (
    lineKey: string,
    unitKey: string,
    patch: Partial<UnitDraft>,
  ) =>
    setLines((ls) =>
      ls.map((l) =>
        l.key === lineKey
          ? {
              ...l,
              units: l.units.map((u) =>
                u.key === unitKey ? { ...u, ...patch } : u,
              ),
            }
          : l,
      ),
    );

  /**
   * The lines as the shared table reads them. The form has no invoice yet —
   * no `PoItem`s, no units — so the counts a saved order fills in are all
   * zero except what the popup has been told.
   */
  const lineViews: PurchaseLine[] = lines.map((l) => {
    const qty = Math.max(0, l.qty || 0);
    const counted = l.skuId !== undefined && !skuTracksSerial(db, l.skuId);
    const total = lineTotal(l);
    return {
      key: l.key,
      skuId: l.skuId ?? "",
      lines: [],
      qty,
      unitCost: l.unitCost ?? 0,
      discount: l.discount ?? 0,
      counted,
      // The order form IS the invoice being typed, so nothing on it can have
      // arrived outside itself (2026-09-24). *Add outside invoice* is on the
      // order's own page, where a delivery is being checked against paper.
      outsideInvoice: false,
      notArrived: 0,
      received: l.units.filter((u) => u.serial.trim() !== "").length,
      subtotal: (l.unitCost ?? 0) * qty,
      total,
      invoiced: total,
      units: [],
    };
  });

  const openLine = lines.find((l) => l.key === detailsKey);
  const openSku = openLine?.skuId;
  const batteryMode: BatteryMode =
    openSku === undefined ? "HEALTH" : defaultBatteryModeOfSku(db, openSku);
  const clearFault = (unitKey: string) =>
    setSerialFault((f) => {
      if (!f[unitKey]) return f;
      const next = { ...f };
      delete next[unitKey];
      return next;
    });

  /**
   * The serial, judged the way every other serial box in the app judges one
   * (`lib/serialInput.ts`, the owner's rules of 2026-09-21): a NEW unit's scan
   * must be `S` and ten to twelve and loses its `S`, its typed serial is ten
   * to twelve, and `I`/`O` read as `1`/`0`; a second-hand one is taken as
   * read. Not judged at all while the unit has no grade — the text waits in
   * its box with a note of whether it was a scan, and `pickGrade` judges it.
   * Refused on blur, so a half-typed serial is not red from its first
   * character, and the box keeps what was typed.
   */
  const commitSerial = (
    lineKey: string,
    u: UnitDraft,
    raw: string,
    /** A grade picked just now, releasing a serial held for want of one. */
    over?: { readonly grade: string | undefined },
  ) => {
    const typed = normaliseScan(raw);
    const gradePatch = over ? { grade: over.grade } : {};
    if (typed === "") {
      clearFault(u.key);
      editUnit(lineKey, u.key, {
        serial: "",
        pending: undefined,
        ...gradePatch,
      });
      return;
    }
    const scanned = u.pending === "scan" ? true : wasScannedText(typed);
    const pending = scanned ? ("scan" as const) : ("typed" as const);
    const grade = over ? over.grade : u.grade;
    const read = readSerialInput(typed, {
      scanned,
      condition: serialConditionOf(grade),
    });
    if (!read.ok) {
      editUnit(lineKey, u.key, { serial: typed, pending, ...gradePatch });
      // Waiting for the grade is not a fault: the amber line under the box
      // says what it waits for.
      if (read.reason === "needs-grade") return clearFault(u.key);
      setSerialFault((f) => ({ ...f, [u.key]: true }));
      message.error(
        t(
          "inboundForm.serialRefused",
          "{{serial}} is not a new unit's serial — the number on the case is {{min}}–{{max}} characters, its barcode an S and then the same.",
          { serial: typed, min: BASE_MIN_LENGTH, max: BASE_MAX_LENGTH },
        ),
      );
      return;
    }
    const clash = lines.some((l) =>
      l.units.some((x) => x.key !== u.key && x.serial === read.serial),
    );
    if (clash) {
      setSerialFault((f) => ({ ...f, [u.key]: true }));
      editUnit(lineKey, u.key, { serial: typed, pending, ...gradePatch });
      message.error(
        t("inboundForm.serialTwice", "{{serial}} is already on this order.", {
          serial: read.serial,
        }),
      );
      return;
    }
    clearFault(u.key);
    editUnit(lineKey, u.key, {
      serial: read.serial,
      pending: undefined,
      ...gradePatch,
    });
  };

  /**
   * A grade — and the serial judged under the rule it decides, when there is
   * something to judge: a serial still waiting, or a second-hand one (taken
   * as read) that is now a new unit's and has to pass a new unit's check. A
   * serial already judged is not judged again under the same rule.
   */
  const pickGrade = (lineKey: string, u: UnitDraft, grade?: string) => {
    const after = serialConditionOf(grade);
    const rejudge =
      after !== undefined &&
      u.serial.trim() !== "" &&
      (u.pending !== undefined ||
        (after === "NEW" && serialConditionOf(u.grade) !== "NEW"));
    if (rejudge) commitSerial(lineKey, u, u.serial, { grade });
    else editUnit(lineKey, u.key, { grade });
  };

  const detailsModal = openLine !== undefined && (
    <UnitDetailsModal<UnitDraft & { n: number }>
      open
      onClose={() => setDetailsKey(null)}
      product={
        openSku === undefined
          ? t("inboundForm.pickAProduct", "Pick a product")
          : (() => {
              const sku = db.skus.find((x) => x.id === openSku);
              return sku ? `${sku.code} — ${skuFullName(sku)}` : openSku;
            })()
      }
      subtitle={t(
        "inboundForm.detailsSubtitle",
        "{{count}} unit(s) · {{price}} each · {{cogs}} COGS for the line",
        {
          count: openLine.qty,
          price: fmtRp(openLine.unitCost ?? 0),
          cogs: fmtRp(lineCogs(openLine)),
        },
      )}
      rows={openLine.units.map((u, i) => ({ ...u, n: i + 1 }))}
      onAddUnit={() =>
        // The quantity follows the serials (owner ask 2026-09-20).
        setLines((ls) =>
          ls.map((l) =>
            l.key === openLine.key
              ? { ...l, qty: l.qty + 1, units: [...l.units, blankUnit()] }
              : l,
          ),
        )
      }
      serial={(u) => (
        <Flex vertical gap={4}>
          <Input
            size="small"
            data-scan-target=""
            maxLength={SERIAL_FIELD_MAX_LENGTH}
            value={u.serial}
            status={
              serialFault[u.key]
                ? "error"
                : u.serial.trim() === "" ||
                    serialConditionOf(u.grade) === undefined
                  ? "warning"
                  : undefined
            }
            aria-invalid={serialFault[u.key] ? true : undefined}
            placeholder={t("inbound.scanOrType", "Scan or type the serial")}
            aria-label={t("inbound.serial", "Serial")}
            onChange={(e) => {
              // Capitals whatever the keyboard is doing (owner ask 2026-09-01).
              // Unjudged until the box is left — and typed, now: a note of a
              // scan was about the old text. A scanner typing into the box is
              // told apart on Enter by `wasScannedText`.
              editUnit(openLine.key, u.key, {
                serial: e.target.value.toUpperCase(),
                pending: "typed",
              });
              clearFault(u.key);
            }}
            onPressEnter={(e) => {
              e.preventDefault();
              commitSerial(openLine.key, u, e.currentTarget.value);
            }}
            onBlur={(e) => commitSerial(openLine.key, u, e.target.value)}
          />
          {serialFault[u.key] && (
            <Typography.Text
              type="danger"
              style={{ fontSize: TYPE.sm, lineHeight: 1.3 }}
            >
              {t("inboundForm.serialFault", "Check this against the sticker.")}
            </Typography.Text>
          )}
          {!serialFault[u.key] &&
            u.serial.trim() !== "" &&
            serialConditionOf(u.grade) === undefined && (
              <Typography.Text
                type="warning"
                style={{ fontSize: TYPE.sm, lineHeight: 1.3 }}
              >
                {t("inbound.serialHintGrade", "Pick the grade to record it")}
              </Typography.Text>
            )}
        </Flex>
      )}
      grade={(u) => (
        <Select<string>
          size="small"
          style={{ width: "100%" }}
          showSearch
          allowClear
          optionFilterProp="label"
          value={u.grade}
          placeholder={t("inbound.gradePlaceholder", "Grade")}
          aria-label={t("inbound.grade", "Grade")}
          options={[NEW_GRADE, ...GRADES].map((g) => ({
            value: g,
            label: g === NEW_GRADE ? t("inbound.gradeNew", "New") : g,
          }))}
          onChange={(v?: string) => pickGrade(openLine.key, u, v)}
        />
      )}
      battery={(u) => (
        <BatteryFields
          fallback={batteryMode}
          value={u.battery}
          size="small"
          idPrefix={`inbound-form-battery-${u.key}`}
          onChange={(next) => editUnit(openLine.key, u.key, { battery: next })}
        />
      )}
      description={(u) => {
        const wants = needsDescription(conditionOf(u.grade));
        return (
          <Select<string[]>
            mode="tags"
            size="small"
            style={{ width: "100%" }}
            value={u.description}
            placeholder={
              wants
                ? t(
                    "inbound.conditionPlaceholder",
                    "Condition, marks, what is in the box…",
                  )
                : t("inbound.describeOptional", "Optional on a new unit")
            }
            aria-label={t("inbound.description", "Description")}
            tokenSeparators={[","]}
            options={db.qcDescriptions
              .filter((x) => x.active)
              .map((x) => ({ value: x.label }))}
            onChange={(next) =>
              editUnit(openLine.key, u.key, { description: next })
            }
          />
        );
      }}
      sellPrice={(u) => {
        const asking =
          openSku === undefined
            ? null
            : (db.skus.find((x) => x.id === openSku)?.price ?? null);
        return (
          <CommitMoneyInput
            id={`inbound-form-sell-${u.key}`}
            label={t("inbound.sellPrice", "Sell price")}
            // The unit's own price; the variant's is the hint behind it, so
            // an emptied box stays empty (owner report 2026-10-08).
            value={u.price ?? null}
            {...(startingPrice(asking) === undefined
              ? {}
              : { placeholder: fmtRp(asking) })}
            onChange={(v) =>
              editUnit(openLine.key, u.key, { price: v ?? undefined })
            }
            onCommit={(v) =>
              editUnit(openLine.key, u.key, { price: v ?? undefined })
            }
          />
        );
      }}
      footer={
        <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
          {t(
            "inboundForm.detailsFooter",
            "Nothing here is required to save the order. Every serial entered becomes a unit in QC the moment the order is saved.",
          )}
        </Typography.Text>
      }
    />
  );

  const productStep = (
    <Card
      // Wider than FORM_CENTRE allows: this step is a line-item grid, not a
      // form read top to bottom — and since 2026-09-24 it takes the whole
      // content column, so every box of a line sits on one row.
      style={{ width: "100%" }}
      title={t("inboundForm.products", "Products")}
    >
      <Typography.Paragraph type="secondary">
        {t(
          "inboundForm.productsOptional",
          "Optional. If the goods have not arrived and nobody knows what was bought, leave this empty — the order saves anyway, and the products get added from the order page when the boxes land.",
        )}
      </Typography.Paragraph>
      <Flex vertical gap={SPACE.md}>
        <PurchaseLinesTable
          lines={lineViews}
          skus={db.skus}
          // A counted product's sell price is the variant's asking price, a
          // fact about the catalogue rather than this order, so it is written
          // the moment it is typed (owner ask 2026-09-24).
          sellPriceOf={(view) =>
            db.skus.find((s) => s.id === view.skuId)?.price ?? 0
          }
          onSetSellPrice={(view, v) => {
            if (view.skuId === "") return;
            mutate((d) => {
              const sku = d.skus.find((s) => s.id === view.skuId);
              if (sku) sku.price = v ?? 0;
            });
          }}
          cogsOf={(view) => {
            const l = lines.find((x) => x.key === view.key);
            return l === undefined ? 0 : lineCogs(l);
          }}
          onSetProduct={(view, skuId) =>
            setLines((ls) =>
              ls.map((l) =>
                l.key === view.key
                  ? {
                      ...l,
                      skuId,
                      units: skuTracksSerial(db, skuId)
                        ? sized(l.units, l.qty)
                        : [],
                    }
                  : l,
              ),
            )
          }
          onSetQty={(view, qty) =>
            setLines((ls) =>
              ls.map((l) =>
                l.key === view.key
                  ? {
                      ...l,
                      qty,
                      units:
                        l.skuId !== undefined && !skuTracksSerial(db, l.skuId)
                          ? []
                          : sized(l.units, qty),
                    }
                  : l,
              ),
            )
          }
          onSetCost={(view, v) =>
            editLine(view.key, { unitCost: v ?? undefined })
          }
          onSetDiscount={(view, v) =>
            editLine(view.key, { discount: v ?? undefined })
          }
          onOpenDetails={(view) => setDetailsKey(view.key)}
          // The one way a product gets onto the order (owner ask
          // 2026-09-20: the separate product-and-quantity bar under the table
          // is gone). Adds a blank line under the last one and lands the caret
          // in its picker; ⌘⏎ from inside any cell does the same.
          onAddLine={() =>
            setLines((ls) => [...ls, { key: nextId("pol"), qty: 1, units: [] }])
          }
          actionsWidth={COLUMN.action}
          actions={(view) => (
            <Button
              type="text"
              danger
              icon={<DeleteOutlined aria-hidden />}
              aria-label={t("inboundForm.removeLine", "Remove line {{n}}", {
                n: lines.findIndex((l) => l.key === view.key) + 1,
              })}
              onClick={() =>
                setLines((ls) => ls.filter((l) => l.key !== view.key))
              }
            />
          )}
          emptyText={t(
            "inboundForm.noLinesYet",
            "No products yet. Add one below, or leave it as is.",
          )}
        />
      </Flex>
    </Card>
  );

  const reviewStep = (
    <Flex vertical gap={16} style={FORM_CENTRE}>
      <Card title={t("inboundForm.review", "Review")}>
        <Descriptions
          column={{ xs: 1, sm: 2 }}
          items={[
            {
              key: "s",
              label: t("inboundForm.supplier", "Supplier"),
              children: supplier ?? fmtNone(),
            },
            {
              key: "i",
              label: t("inboundForm.invoice", "Invoice"),
              children: noInvoice ? "No invoice" : invoice || fmtNone(),
            },
            {
              key: "d",
              label: t("inboundForm.ordered", "Ordered"),
              children: date?.format("DD MMM YYYY") ?? fmtNone(),
            },
            {
              key: "w",
              label: t("inboundForm.arrivingAt", "Arriving at"),
              children: warehouseLabelOf(db.warehouses, warehouseId),
            },
            {
              key: "p",
              label: t("inboundForm.products", "Products"),
              children:
                pieceCount === 0
                  ? t("inboundForm.notEnteredYet", "Not entered yet")
                  : t("inboundForm.unitCount", "{{count}} unit(s)", {
                      count: pieceCount,
                    }),
            },
          ]}
        />
      </Card>
      {/* "Purchase", not "Money" (owner decision 2026-08-26). Every figure on
          this card is money; what tells it apart from the payment fields a
          step earlier is that these are the numbers of the PURCHASE. */}
      <Card title={t("inboundForm.purchase", "Purchase")}>
        <Flex
          vertical
          gap={8}
          style={{ maxWidth: 420, marginInline: "auto", width: "100%" }}
        >
          <Flex justify="space-between">
            <span>Subtotal</span>
            <span>{fmtRp(subtotal)}</span>
          </Flex>
          <Flex justify="space-between">
            <span>Shipping</span>
            <span>{fmtRp(shippingFee ?? 0)}</span>
          </Flex>
          <Flex justify="space-between">
            <span>Tax</span>
            <span>{fmtRp(taxFee ?? 0)}</span>
          </Flex>
          {/* Rupiah or per cent, the supplier's choice. See `discountMode`. */}
          <Form layout="vertical">
            <Form.Item
              label={t("inboundForm.discount", "Discount")}
              style={{ marginBottom: 0 }}
              extra={
                discountMode === "PCT" ? (
                  <span>
                    {t("inboundForm.pctOfSubtotal", "{{pct}}% of {{sub}}", {
                      pct: discountPct ?? 0,
                      sub: fmtRp(subtotal),
                    })}{" "}
                    = <strong>{fmtRp(discountRp)}</strong>
                  </span>
                ) : undefined
              }
            >
              <Flex gap={8} align="center" wrap>
                <Segmented<"RP" | "PCT">
                  value={discountMode}
                  onChange={setDiscountMode}
                  options={[
                    { value: "RP", label: RP_SYMBOL },
                    { value: "PCT", label: "%" },
                  ]}
                />
                {discountMode === "RP" ? (
                  <MoneyInput
                    style={{ flex: 1, minWidth: 160 }}
                    value={discount}
                    onChange={money(setDiscount)}
                  />
                ) : (
                  <InputNumber
                    min={0}
                    max={100}
                    precision={2}
                    suffix="%"
                    style={{ flex: 1, minWidth: 160 }}
                    aria-label={t(
                      "inboundForm.discountPercent",
                      "Discount percentage",
                    )}
                    value={discountPct}
                    onChange={(v) => setDiscountPct(v ?? undefined)}
                  />
                )}
              </Flex>
            </Form.Item>
          </Form>
          <Flex justify="space-between" style={{ fontWeight: 600 }}>
            <span>Invoiced total</span>
            <span>{fmtRp(total)}</span>
          </Flex>
          <Flex justify="space-between">
            <span>Paid now</span>
            <span>{fmtRp(paid ?? 0)}</span>
          </Flex>
          {outstanding > 0 && (
            <Flex justify="space-between">
              <Typography.Text type="danger">
                {t("inboundForm.stillOwed", "Still owed")}
              </Typography.Text>
              <Typography.Text type="danger">
                {fmtRp(outstanding)}
              </Typography.Text>
            </Flex>
          )}
          {total === 0 && (paid ?? 0) > 0 && (
            <Typography.Text type="secondary">
              Nothing invoiced yet — this records the transfer against the
              supplier until the products are known.
            </Typography.Text>
          )}
        </Flex>
      </Card>
    </Flex>
  );

  return (
    <PageContainer
      title={t("inboundForm.newInboundOrder", "New inbound order")}
      backTo="/inbound"
    >
      <Flex vertical gap={16}>
        {/*
         * Auto-save, said out loud (owner ask 2026-09-15).
         *
         * A form that silently refills itself is a form somebody saves twice:
         * they came to raise Tuesday's order and got Monday's, half-typed,
         * with no sign of where it came from. The banner names what happened
         * and offers the one thing the restore cannot guess — that they did
         * not want it.
         */}
        {restoreOffered && (
          <Alert
            type="info"
            showIcon
            closable
            onClose={() => setRestoreOffered(false)}
            title={t(
              "inboundForm.restoredTitle",
              "Picked up where you left off",
            )}
            description={t(
              "inboundForm.restoredBody",
              "This order was still being typed when the page last closed. Nothing has been saved to Inbound yet — press Save draft for that.",
            )}
            action={
              <Button
                size="small"
                onClick={() => {
                  clearStored();
                  setRestoreOffered(false);
                  // A reload rather than eleven setters: the form seeds itself
                  // from storage at mount, and mount is the only moment that
                  // can put every field back to its default at once.
                  navigate(0);
                }}
              >
                {t("inboundForm.startFresh", "Start a fresh order")}
              </Button>
            }
          />
        )}
        <Steps
          current={step}
          onChange={setStep}
          // Translated here rather than in the constant — see StockOutPage.
          items={STEPS.map((x) => ({ title: t(x.title) }))}
          // Every step is reachable. Only step 1 can block saving, and it says
          // so at the point of saving — gating navigation as well would stop
          // someone flicking to Review to check a number.
        />
        {step === 0 && orderStep}
        {step === 1 && productStep}
        {step === 2 && reviewStep}
      </Flex>

      {detailsModal}

      <FooterToolbar
        info={
          <Typography.Text>
            {t("inboundForm.unitCount", "{{count}} unit(s)", {
              count: pieceCount,
            })}{" "}
            · <strong>{fmtRp(total)}</strong>
            {outstanding > 0 && (
              <Typography.Text type="danger">
                {" "}
                ·{" "}
                {t("inboundForm.owedAmount", "{{amount}} owed", {
                  amount: fmtRp(outstanding),
                })}
              </Typography.Text>
            )}
          </Typography.Text>
        }
      >
        <Button
          onClick={() => {
            // Cancelling is a decision, so it takes the auto-saved copy with
            // it: offering to restore an order somebody just abandoned is the
            // banner that teaches people to ignore banners.
            clearStored();
            navigate("/inbound");
          }}
        >
          {t("inboundForm.cancel", "Cancel")}
        </Button>
        {step > 0 && (
          <Button onClick={() => setStep(step - 1)}>
            {t("inboundForm.back", "Back")}
          </Button>
        )}
        {/* On every step (owner ask 2026-09-15), because the reason to save a
            draft — the goods have not arrived, nobody knows the prices yet —
            turns up on step one as often as on step three. */}
        <Button icon={<SaveOutlined />} onClick={() => save("DRAFT")}>
          {t("inboundForm.saveDraft", "Save draft")}
        </Button>
        {step < STEPS.length - 1 && (
          <Button type="primary" onClick={() => setStep(step + 1)}>
            {t("inboundForm.next", "Next")}
          </Button>
        )}
        {step === STEPS.length - 1 && (
          <Button type="primary" onClick={() => save("ORDERED")}>
            {t("inboundForm.saveOrder", "Save order")}
          </Button>
        )}
      </FooterToolbar>
    </PageContainer>
  );
}
