/**
 * Returns and exchanges from customers (owner brief 2026-09-19, reshaped
 * 2026-09-21).
 *
 * ## The form
 *
 * *"Either they input the serial or the transaction. Only then, show the unit
 * for replacement in the inventory."* A serial scanned or typed finds the sale
 * it is out on, adds it to the return and ticks it; a sale can also be added
 * by hand. One return can take units back from SEVERAL sales — *"even with 2
 * transactions the units can be mixed (1 from transaction 1, 1 from
 * transaction 2)"* — so every sale is its own block: its units still with the
 * customer, what each sold for, and an additional expense charged against it
 * (a missing charger, a cracked corner). Counted products come back by
 * quantity.
 *
 * Once a sale is on the form, *Exchange for* searches the inventory — scan a
 * serial, or type a product, a variant or a code — and any number of units and
 * counted products can go out instead: *"it could have 1 unit to return but 2
 * units to be exchanged. It will still sit in the same sale."* With units back
 * from more than one sale, the form asks which sale the replacements go out
 * on; the newest is the default.
 *
 * Laid out as two TABLES side by side since 2026-09-21 (owner: *"enlarge/widen
 * the modal popup, and make it table instead of per individual and put reason
 * as well as the date on top. Make the return on the left then the exchange
 * on the right"*): the reason and the date across the top, what comes back
 * on the left — every listed sale's units in one table, each sale's code
 * spanning its rows — and what goes out on the right. They stack on a
 * narrow screen.
 *
 * ## The history
 *
 * One row per return, three columns (owner, same day: *"do not make it
 * complicated"*): the transaction number with its marketplace reference, every
 * product that came back on its own line, and the units that went out
 * instead, each with its condition. Every serial opens its history in a
 * popup (`SerialLink`). Receiving a unit is a button on its own line.
 *
 * ## The money — `lib/returns.ts`
 *
 * A unit is worth what it sold for, less its expense. The "Refund value" box,
 * the return/buy-back tag and the "cancels …" sentences are gone (owner,
 * 2026-09-21, pointing at a screenshot): what is left on screen is only what
 * somebody has to DO — hand money back on a plain return, or take the
 * difference on an exchange that costs more. An exchange that costs less says
 * nothing about money, because none moves: *"the money will not return so no
 * need to bring it back."* `planReturn` is the rule, and everything — the
 * returns, the adjustments, the replacements going out, every sale's payments
 * and their log — is ONE mutation.
 *
 * ## Receiving the unit — unchanged (owner ask 2026-08-28)
 *
 * A recorded return waits for the unit. *Receive* opens the QC panel under
 * the return: condition, description and a grade, then back into stock — the
 * description, the regrade and the `RETUR_PELANGGAN` in ONE transaction,
 * because a moment in which a unit that went out New is back on the shelf
 * still graded New is the moment somebody sells it.
 *
 * ## Refunds in a Shopee file
 *
 * *Check a Shopee file*, on the history card, reads the seller balance report
 * for orders Shopee refunded and offers to record each one's return —
 * `ShopeeRefundCheck.tsx`.
 *
 * The reason list is Settings' (`db.reasons`, activity `RETURN_CUSTOMER`);
 * "Other" asks for a sentence.
 */
import { useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Col,
  DatePicker,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Table,
  Typography,
} from "antd";
import {
  CloseOutlined,
  DeleteOutlined,
  SearchOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { MoneyInput } from "../../components/MoneyInput";
import { GradeTag } from "../../components/GradeTag";
import { fmtRp, fmtDate } from "../../lib/format.js";
import { gradeForCondition } from "../../lib/condition.js";
import { resolveSerialQuery, serialNamedBy } from "../../lib/serialInput.js";
import { skuTracksSerial } from "../../lib/serialTracking.js";
import { priceOf } from "../../lib/unitPrice.js";
import {
  billAfterReturns,
  isSettled,
  paymentsOf,
  refundedOf,
} from "../../lib/salePayments.js";
import { diffPayments } from "../../lib/paymentEdits.js";
import {
  averageCost,
  lineCost,
  onHand,
  stockLevels,
  takeFrom,
} from "../../lib/stock.js";
import {
  marketplaceRefs,
  planReturn,
  returnableSerials,
  saleOfSerial,
  splitByWeight,
  type ReturnSaleInput,
} from "../../lib/returns.js";
import {
  useDb,
  mutate,
  nextId,
  docCode,
  appendEvent,
  currentStaffName,
  purgeQcPhotos,
} from "../../mock/store.js";
import type {
  MockDb,
  Order,
  OrderLine,
  ReturnRec,
  Sku,
  Unit,
} from "../../mock/seed.js";
import { useTranslation } from "react-i18next";
import { draftKey, usePersistentState } from "../../hooks/usePersistentState";
import {
  FIELD,
  asListOf,
  asOneOf,
  asString,
  hasShape,
  isRecord,
} from "../../lib/draftGuards.js";
import { ShopeeRefundCheck } from "./ShopeeRefundCheck";

/** The label that turns on the "specify" field. Matched case-insensitively. */
const OTHER = "other";

/** How a refund is handed back, and a top-up taken — the till's two. */
const MONEY_METHODS = ["TUNAI", "TRANSFER"] as const;
type MoneyMethod = (typeof MONEY_METHODS)[number];

/** One unit of a sale, as the form's checklist holds it. */
interface Pick {
  readonly on: boolean;
  /** Charged against the unit — comes off what it is worth back. */
  readonly expense: number | null;
  /**
   * The grade the unit is coming back in (owner ask 2026-09-21, evening).
   *
   * A returned unit is second-hand and its grade often changes on the way in;
   * the return form used to defer that to the receive-QC step, but the owner
   * wants it decided at the moment the return is recorded. `undefined` leaves
   * the unit's current grade alone, which is also the empty state a new pick
   * opens in.
   */
  readonly grade?: string | null;
}

/** Pieces of a counted line coming back, and what is charged against them. */
interface QtyPick {
  readonly qty: number;
  readonly expense: number | null;
}

/**
 * Something going out in exchange, as the form holds it. `price` null is the
 * default: a unit's own price, a counted product's per piece.
 */
type Replacement =
  | {
      readonly kind: "UNIT";
      readonly serial: string;
      readonly price: number | null;
    }
  | {
      readonly kind: "COUNTED";
      readonly skuId: string;
      readonly qty: number;
      readonly price: number | null;
    };

/** One thing coming back, as the submit writes it. */
type Back =
  | {
      readonly kind: "UNIT";
      readonly saleId: string;
      readonly serial: string;
      readonly expense: number | null;
    }
  | {
      readonly kind: "COUNTED";
      readonly saleId: string;
      readonly lineId: string;
      readonly qty: number;
      readonly expense: number | null;
    };

/** A replacement, resolved against the store. */
interface ChosenRow {
  readonly key: string;
  readonly replacement: Replacement;
  readonly sku: Sku | undefined;
  readonly unit?: Unit;
  /** What a person reads: product and variant. */
  readonly label: string;
  /** Pieces — 1 for a unit. */
  readonly qty: number;
  /** A counted product's on-hand, which caps `qty`. */
  readonly held?: number;
  /** The asking price — a unit's own, a counted product's per piece. */
  readonly ask: number;
  /** What it goes out at, per piece. */
  readonly price: number;
}

/** A listed sale, as the form reads it. */
interface SaleView {
  readonly sale: Order;
  /** Its units still out with the customer — what can come back on it. */
  readonly returnable: string[];
  readonly ticked: string[];
  /** Its counted lines with pieces still out. */
  readonly countedOut: OrderLine[];
  readonly countedBack: {
    readonly line: OrderLine;
    readonly qty: number;
    readonly expense: number | null;
  }[];
  /** What its ticked units and lines are worth back. */
  readonly credit: number;
}

/**
 * One row of the form's return table: a unit, a counted line, or a sale with
 * nothing left out — which still needs a row, or it could not be taken off.
 */
type BackRow = {
  readonly key: string;
  readonly sale: Order;
  /** How many rows the sale's code spans: all of them on its first, 0 after. */
  readonly span: number;
} & (
  | { readonly kind: "UNIT"; readonly serial: string }
  | { readonly kind: "COUNTED"; readonly line: OrderLine }
  | { readonly kind: "EMPTY" }
);

/*
 * The return being recorded, kept on this device (owner ask 2026-09-21: "all
 * the things of the user input will be saved locally"). Leaving the page
 * mid-return — to look the sale up in Transaction History, say — brings the
 * form back as it was. `reset` is still what clears it, on save and on close.
 *
 * The keys for the sale LIST, the replacements and the sale they go on are
 * new (2026-09-21): a draft of the old one-sale form is never read into them.
 */
const RETURN_DRAFT = (name: string) => draftKey(`returns.customer.${name}`);
const isMoney = (v: unknown) =>
  v === null || (typeof v === "number" && Number.isFinite(v));
const recordOf =
  <T,>(item: (v: unknown) => v is T) =>
  (v: unknown): Record<string, T> | undefined =>
    isRecord(v)
      ? (Object.fromEntries(
          Object.entries(v).filter(([, x]) => item(x)),
        ) as Record<string, T>)
      : undefined;
const parsePicks = recordOf((v): v is Pick =>
  hasShape(v, { on: FIELD.boolean, expense: isMoney }),
);
/** The set of grade letters (plus NEW) the condition Select offers. */
const GRADE_OPTIONS: readonly string[] = ["NEW", "A", "B", "C"];
const parseQtyPicks = recordOf((v): v is QtyPick =>
  hasShape(v, { qty: FIELD.number, expense: isMoney }),
);
const parseIds = asListOf((v): v is string => typeof v === "string");
const parseReplacements = asListOf(
  (v): v is Replacement =>
    hasShape(v, {
      kind: (k) => k === "UNIT",
      serial: FIELD.string,
      price: isMoney,
    }) ||
    hasShape(v, {
      kind: (k) => k === "COUNTED",
      skuId: FIELD.string,
      qty: FIELD.number,
      price: isMoney,
    }),
);
/** A picked date travels as its ISO string. */
const parseDay = (v: unknown): string | undefined =>
  typeof v === "string" && dayjs(v).isValid() ? v : undefined;

/** How many of the replacement search's rows show before it scrolls. */
const RESULT_ROWS = 8;
const RESULT_ROW_HEIGHT = 38;

/** What one thing coming back is worth on its sale: price less expense. */
function worthOn(order: Order, back: Back): number {
  if (back.kind === "UNIT") {
    return Math.max(0, (order.prices[back.serial] ?? 0) - (back.expense ?? 0));
  }
  const line = order.lines?.find((l) => l.id === back.lineId);
  return line === undefined
    ? 0
    : Math.max(0, line.price * back.qty - (back.expense ?? 0));
}

export function CustomerReturnPanel({
  addOpen,
  onCloseAdd,
  onOpenAdd,
}: {
  addOpen: boolean;
  onCloseAdd: () => void;
  /** Open the Add-return form — what a Shopee refund's *Record return* does. */
  onOpenAdd: () => void;
}) {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();

  // ── The form's state ────────────────────────────────────────────────────
  const [lookup, setLookup] = usePersistentState<string>(
    RETURN_DRAFT("lookup"),
    "",
    asString,
  );
  const [lookupMiss, setLookupMiss] = useState<string | null>(null);
  /** The sales on this return, in the order they were added. */
  const [saleIds, setSaleIds] = usePersistentState<string[]>(
    RETURN_DRAFT("sales"),
    [],
    parseIds,
  );
  const [picks, setPicks] = usePersistentState<Record<string, Pick>>(
    RETURN_DRAFT("picks"),
    {},
    parsePicks,
  );
  /**
   * Counted products coming back — accessories, by quantity, per sale line
   * (2026-09-19). They have no serial to tick, only a number.
   */
  const [qtyPicks, setQtyPicks] = usePersistentState<Record<string, QtyPick>>(
    RETURN_DRAFT("qtyPicks"),
    {},
    parseQtyPicks,
  );
  const [reason, setReason] = usePersistentState<string | undefined>(
    RETURN_DRAFT("reason"),
    undefined,
    asString,
  );
  const [reasonDetail, setReasonDetail] = usePersistentState<string>(
    RETURN_DRAFT("reasonDetail"),
    "",
    asString,
  );
  /*
   * Only a date somebody PICKED is kept. "Today" is not a value to store: a
   * form reopened tomorrow would otherwise open on yesterday.
   */
  const [datePicked, setDatePicked] = usePersistentState<string | undefined>(
    RETURN_DRAFT("date"),
    undefined,
    parseDay,
  );
  const date = datePicked === undefined ? dayjs() : dayjs(datePicked);
  const setDate = (d: dayjs.Dayjs) => setDatePicked(d.toISOString());
  const [refundMethod, setRefundMethod] = usePersistentState<MoneyMethod>(
    RETURN_DRAFT("refundMethod"),
    "TUNAI",
    asOneOf<MoneyMethod>(MONEY_METHODS),
  );
  /**
   * The payment reference the shop writes on the adjustment (owner ask
   * 2026-09-21, evening). *"The description is the payment reference."* A
   * customer's bank-transfer number, or the receipt slip a courier signed —
   * something a reconciliation later can key on. Optional here, but if it is
   * typed it becomes the description of the Refund income/expense adjustment.
   */
  const [paymentRef, setPaymentRef] = usePersistentState<string>(
    RETURN_DRAFT("paymentRef"),
    "",
    asString,
  );
  /** What goes out in exchange — any number of units and counted products. */
  const [replacements, setReplacements] = usePersistentState<Replacement[]>(
    RETURN_DRAFT("replacements"),
    [],
    parseReplacements,
  );
  /** The sale the replacements go out on, when the return spans several. */
  const [into, setInto] = usePersistentState<string | undefined>(
    RETURN_DRAFT("into"),
    undefined,
    asString,
  );
  const [query, setQuery] = useState("");
  const [tried, setTried] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);

  const reasons = db.reasons.filter(
    (r) => r.activity === "RETURN_CUSTOMER" && r.active,
  );
  const needsDetail = (reason ?? "").trim().toLowerCase() === OTHER;

  const unitBySerial = useMemo(
    () => new Map(db.units.map((u) => [u.serial, u])),
    [db.units],
  );
  const skuById = useMemo(
    () => new Map(db.skus.map((s) => [s.id, s])),
    [db.skus],
  );
  const allSerials = useMemo(() => db.units.map((u) => u.serial), [db.units]);
  const supplierCodes = useMemo(
    () => db.suppliers.map((s) => s.code ?? "").filter(Boolean),
    [db.suppliers],
  );
  const unitOf = (serial: string) => unitBySerial.get(serial);
  const skuOfSerial = (serial: string) =>
    skuById.get(unitBySerial.get(serial)?.skuId ?? "");
  const skuLabel = (sku: Sku | undefined, fallback: string) =>
    sku ? `${sku.name} ${sku.variantLabel}` : fallback;
  /** What the unit IS — product and variant. */
  const productLabel = (serial: string) =>
    skuLabel(skuOfSerial(serial), serial);
  const customerName = (o: Order) =>
    db.customers.find((c) => c.id === o.customerId)?.name;

  /** Serials already on a return that has not been received yet. */
  const pendingBack = useMemo(
    () =>
      new Set(
        db.returns
          .filter((r) => r.kind === "CUSTOMER" && r.status === "PENDING")
          .map((r) => r.serial),
      ),
    [db.returns],
  );
  const statusOf = (serial: string) => unitBySerial.get(serial)?.status;
  const countedOutOf = (sale: Order) =>
    (sale.lines ?? []).filter((l) => l.qty - (l.returnedQty ?? 0) > 0);

  // ── The sales on the return ────────────────────────────────────────────
  const views: SaleView[] = saleIds.flatMap((id) => {
    const sale = db.orders.find((o) => o.id === id);
    if (sale === undefined) return [];
    const returnable = returnableSerials(
      sale,
      db.orders,
      statusOf,
      pendingBack,
    );
    const ticked = returnable.filter((s) => picks[s]?.on);
    const countedOut = countedOutOf(sale);
    const countedBack = countedOut.flatMap((line) => {
      const pick = qtyPicks[line.id];
      const qty = Math.min(line.qty - (line.returnedQty ?? 0), pick?.qty ?? 0);
      return qty > 0 ? [{ line, qty, expense: pick?.expense ?? null }] : [];
    });
    const credit =
      ticked.reduce(
        (n, serial) =>
          n +
          worthOn(sale, {
            kind: "UNIT",
            saleId: id,
            serial,
            expense: picks[serial]?.expense ?? null,
          }),
        0,
      ) +
      countedBack.reduce(
        (n, x) =>
          n +
          worthOn(sale, {
            kind: "COUNTED",
            saleId: id,
            lineId: x.line.id,
            qty: x.qty,
            expense: x.expense,
          }),
        0,
      );
    return [{ sale, returnable, ticked, countedOut, countedBack, credit }];
  });
  /** The sales something is actually coming back from. */
  const involved = views.filter(
    (v) => v.ticked.length > 0 || v.countedBack.length > 0,
  );

  // ── What goes out in exchange ──────────────────────────────────────────
  const chosen: ChosenRow[] = replacements.flatMap((r): ChosenRow[] => {
    if (r.kind === "UNIT") {
      const unit = unitBySerial.get(r.serial);
      // Sold, reserved or taken off the shelf since it was picked: it is not
      // going out on this return, whatever the draft remembered.
      if (unit === undefined || unit.status !== "TERSEDIA") return [];
      const sku = skuById.get(unit.skuId);
      const ask = priceOf(unit, sku?.price ?? 0);
      return [
        {
          key: `u:${r.serial}`,
          replacement: r,
          sku,
          unit,
          label: skuLabel(sku, r.serial),
          qty: 1,
          ask,
          price: r.price ?? ask,
        },
      ];
    }
    const sku = skuById.get(r.skuId);
    const held = onHand(db.stockMoves, r.skuId);
    if (sku === undefined || held <= 0) return [];
    return [
      {
        key: `c:${r.skuId}`,
        replacement: r,
        sku,
        label: skuLabel(sku, r.skuId),
        qty: Math.max(1, Math.min(held, r.qty)),
        held,
        ask: sku.price,
        price: r.price ?? sku.price,
      },
    ];
  });
  const replacementTotal = chosen.reduce((n, c) => n + c.price * c.qty, 0);
  /** Picked, and gone from the shelf since — said, not silently dropped. */
  const stale = replacements
    .filter((r) => !chosen.some((c) => c.replacement === r))
    .map((r) =>
      r.kind === "UNIT" ? r.serial : skuLabel(skuById.get(r.skuId), r.skuId),
    );
  const chosenSerials = new Set(
    replacements.flatMap((r) => (r.kind === "UNIT" ? [r.serial] : [])),
  );

  /** The sale the replacements go out on: the one named, else the newest. */
  const target: SaleView | undefined =
    involved.find((v) => v.sale.id === into) ??
    involved.reduce<SaleView | undefined>(
      (a, b) => (a === undefined || b.sale.ts > a.sale.ts ? b : a),
      undefined,
    );

  const inputOf = (v: SaleView): ReturnSaleInput => ({
    id: v.sale.id,
    code: v.sale.code,
    bill: billAfterReturns(v.sale),
    payments: paymentsOf(v.sale),
    refunded: refundedOf(v.sale),
    credit: v.credit,
  });
  /** What the return does to the money, for the lines that ask for action. */
  const preview =
    involved.length === 0
      ? undefined
      : planReturn({
          sales: involved.map(inputOf),
          ...(chosen.length > 0 && target !== undefined
            ? {
                exchange: { total: replacementTotal, into: target.sale.id },
              }
            : {}),
          method: refundMethod,
          at: "",
          code: "",
          newId: () => "",
        });

  // ── The inventory the replacement search offers ────────────────────────
  const counted = useMemo(() => {
    const out: { sku: Sku; held: number }[] = [];
    for (const skuId of stockLevels(db.stockMoves).keys()) {
      if (skuTracksSerial(db, skuId)) continue;
      const sku = skuById.get(skuId);
      const held = onHand(db.stockMoves, skuId);
      if (sku === undefined || held <= 0) continue;
      out.push({ sku, held });
    }
    return out.sort((a, b) =>
      skuLabel(a.sku, "").localeCompare(skuLabel(b.sku, "")),
    );
    // `db` is read only for the catalogue `skuTracksSerial` walks.
  }, [db.stockMoves, db.skus, db.models, db.categories, skuById]);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (...fields: (string | undefined)[]) => {
    if (words.length === 0) return true;
    const hay = fields.filter(Boolean).join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const unitResults = db.units
    .filter((u) => u.status === "TERSEDIA" && !chosenSerials.has(u.serial))
    .filter((u) => {
      const sku = skuById.get(u.skuId);
      return matches(u.serial, sku?.name, sku?.variantLabel, sku?.code);
    })
    .sort(
      (a, b) =>
        productLabel(a.serial).localeCompare(productLabel(b.serial)) ||
        a.serial.localeCompare(b.serial),
    );
  const countedResults = counted.filter((c) =>
    matches(c.sku.name, c.sku.variantLabel, c.sku.code),
  );

  const reset = () => {
    setLookup("");
    setLookupMiss(null);
    setSaleIds([]);
    setPicks({});
    setQtyPicks({});
    setReason(undefined);
    setReasonDetail("");
    setDatePicked(undefined);
    setReplacements([]);
    setInto(undefined);
    setQuery("");
    setTried(false);
    setPaymentRef("");
  };

  const close = () => {
    reset();
    onCloseAdd();
  };

  /** Put a sale on the return, if it is not on it already. */
  const addSale = (id: string) =>
    setSaleIds((ids) => (ids.includes(id) ? ids : [...ids, id]));

  /** Take a sale off the return, with whatever was ticked on it. */
  const removeSale = (sale: Order) => {
    setSaleIds((ids) => ids.filter((x) => x !== sale.id));
    setPicks((m) => {
      const next = { ...m };
      for (const s of sale.serials) delete next[s];
      return next;
    });
    setQtyPicks((m) => {
      const next = { ...m };
      for (const l of sale.lines ?? []) delete next[l.id];
      return next;
    });
    if (into === sale.id) setInto(undefined);
  };

  /** A serial scanned or typed: add the sale it is out on, ticked. */
  const find = () => {
    const serial = resolveSerialQuery(lookup, allSerials, supplierCodes);
    const order = serial ? saleOfSerial(db.orders, serial) : undefined;
    if (!order || statusOf(serial) !== "TERJUAL" || pendingBack.has(serial)) {
      setLookupMiss(serial || lookup);
      return;
    }
    setLookupMiss(null);
    addSale(order.id);
    setPicks((m) => ({
      ...m,
      [serial]: { on: true, expense: m[serial]?.expense ?? null },
    }));
    setLookup("");
  };

  /**
   * Open the form on a sale a Shopee file says was refunded, every unit and
   * counted piece still out on it ticked.
   */
  const recordFromShopee = (saleId: string) => {
    const sale = db.orders.find((o) => o.id === saleId);
    if (sale === undefined) return;
    const out = returnableSerials(sale, db.orders, statusOf, pendingBack);
    const lines = countedOutOf(sale);
    addSale(saleId);
    setPicks((m) => ({
      ...m,
      ...Object.fromEntries(
        out.map((s) => [s, { on: true, expense: m[s]?.expense ?? null }]),
      ),
    }));
    setQtyPicks((m) => ({
      ...m,
      ...Object.fromEntries(
        lines.map((l) => [
          l.id,
          {
            qty: l.qty - (l.returnedQty ?? 0),
            expense: m[l.id]?.expense ?? null,
          },
        ]),
      ),
    }));
    setCheckOpen(false);
    onOpenAdd();
  };

  // ── Picking replacements ───────────────────────────────────────────────
  const addUnit = (serial: string) => {
    if (chosenSerials.has(serial)) {
      message.info(
        t(
          "returnCustomer.alreadyChosen",
          "{{serial}} is already in the exchange.",
          { serial },
        ),
      );
      return;
    }
    setReplacements((list) =>
      list.some((r) => r.kind === "UNIT" && r.serial === serial)
        ? list
        : [...list, { kind: "UNIT", serial, price: null }],
    );
  };

  /** A counted product: one more piece, never more than the shop holds. */
  const addCounted = (skuId: string, held: number) =>
    setReplacements((list) => {
      const at = list.findIndex(
        (r) => r.kind === "COUNTED" && r.skuId === skuId,
      );
      if (at < 0)
        return [...list, { kind: "COUNTED", skuId, qty: 1, price: null }];
      return list.map((r, i) =>
        i === at && r.kind === "COUNTED"
          ? { ...r, qty: Math.min(held, r.qty + 1) }
          : r,
      );
    });

  const editReplacement = (
    key: string,
    patch: { price?: number | null; qty?: number },
  ) =>
    setReplacements((list) =>
      list.map((r) =>
        (r.kind === "UNIT" ? `u:${r.serial}` : `c:${r.skuId}`) !== key
          ? r
          : r.kind === "UNIT"
            ? {
                ...r,
                ...(patch.price !== undefined ? { price: patch.price } : {}),
              }
            : {
                ...r,
                ...(patch.price !== undefined ? { price: patch.price } : {}),
                ...(patch.qty !== undefined ? { qty: patch.qty } : {}),
              },
      ),
    );

  const removeReplacement = (key: string) =>
    setReplacements((list) =>
      list.filter(
        (r) => (r.kind === "UNIT" ? `u:${r.serial}` : `c:${r.skuId}`) !== key,
      ),
    );

  /** The unit on the shelf a scan or a typed serial names, if one does. */
  const sellableSerial = (text: string): string | undefined => {
    const serial = resolveSerialQuery(text, allSerials, supplierCodes);
    return statusOf(serial) === "TERSEDIA" ? serial : undefined;
  };

  /**
   * The search box. A whole serial — scanned, or typed to its last character —
   * goes straight in and the box clears; but not while a LONGER serial could
   * still be being typed, or a half-typed one would be grabbed the moment it
   * happened to spell a shorter one.
   */
  const onQuery = (text: string) => {
    // The till's rule (`serialNamedBy`), so the two boxes cannot disagree.
    const serial = serialNamedBy(text, allSerials);
    if (serial !== null && statusOf(serial) === "TERSEDIA") {
      addUnit(serial);
      setQuery("");
      return;
    }
    setQuery(text);
  };

  /** Enter: whatever serial the box holds, whole or not. */
  const onQueryEnter = () => {
    const serial = sellableSerial(query);
    if (serial !== undefined) {
      addUnit(serial);
      setQuery("");
      return;
    }
    const known = resolveSerialQuery(query, allSerials, supplierCodes);
    if (unitBySerial.has(known)) {
      message.warning(
        t(
          "returnCustomer.notForSale",
          "{{serial}} is not on the shelf to sell.",
          { serial: known },
        ),
      );
    }
  };

  const submit = () => {
    setTried(true);
    if (involved.length === 0) {
      message.error(
        t(
          "returnCustomer.pickAUnit",
          "Tick at least one unit that is coming back.",
        ),
      );
      return;
    }
    if (!reason || (needsDetail && reasonDetail.trim() === "")) {
      message.error(
        t("returnCustomer.needReason", "Say why it is coming back."),
      );
      return;
    }

    const now = new Date().toISOString();
    const day = date.format("YYYY-MM-DD");
    const staff = currentStaffName();
    const why = [reason, needsDetail ? reasonDetail.trim() : ""]
      .filter(Boolean)
      .join(": ");

    // Units first, sale by sale, then the counted lines: the FIRST code is a
    // unit's return whenever a unit comes back, which is what the
    // replacements' ledger rows point at.
    const unitBacks: Extract<Back, { kind: "UNIT" }>[] = involved.flatMap((v) =>
      v.ticked.map((serial) => ({
        kind: "UNIT" as const,
        saleId: v.sale.id,
        serial,
        expense: picks[serial]?.expense ?? null,
      })),
    );
    const countedBacks: Extract<Back, { kind: "COUNTED" }>[] = involved.flatMap(
      (v) =>
        v.countedBack.map((x) => ({
          kind: "COUNTED" as const,
          saleId: v.sale.id,
          lineId: x.line.id,
          qty: x.qty,
          expense: x.expense,
        })),
    );
    const codeOf = new Map<Back, string>();
    for (const b of [...unitBacks, ...countedBacks])
      codeOf.set(b, docCode("SG"));
    const allCodes = [...codeOf.values()];
    const firstCode = allCodes[0]!;
    const labelOf = (b: Back): string => {
      if (b.kind === "UNIT") return b.serial;
      const sale = involved.find((v) => v.sale.id === b.saleId)?.sale;
      const line = sale?.lines?.find((l) => l.id === b.lineId);
      const sku = line ? skuById.get(line.skuId) : undefined;
      return `${sku?.name ?? line?.skuId ?? b.lineId} ×${b.qty}`;
    };
    const backLabel = [...unitBacks, ...countedBacks].map(labelOf).join(", ");

    const exchange = chosen.length > 0 && target !== undefined;
    const intoId = exchange ? target.sale.id : undefined;
    const goingOut = chosen.map((c) => ({ ...c }));
    const firstReplacement = goingOut.find((c) => c.unit !== undefined)?.unit
      ?.serial;
    const outcome = { refund: 0, topUp: 0 };

    const write = (d: MockDb) => {
      /*
       * The store re-runs this against the server's rows when another till
       * changed one of them first. It must not guess then: a unit no longer
       * out with the customer, or a replacement no longer on the shelf,
       * refuses the whole return — the money was planned with them.
       */
      for (const b of unitBacks) {
        const status = d.units.find((u) => u.serial === b.serial)?.status;
        const waiting = d.returns.some(
          (r) =>
            r.kind === "CUSTOMER" &&
            r.status === "PENDING" &&
            r.serial === b.serial,
        );
        if (status !== "TERJUAL" || waiting) {
          throw new Error(
            t(
              "returnCustomer.notOutAnymore",
              "{{serial}} is no longer out with the customer.",
              { serial: b.serial },
            ),
          );
        }
      }
      for (const c of goingOut) {
        const gone =
          c.unit !== undefined
            ? d.units.find((u) => u.serial === c.unit!.serial)?.status !==
              "TERSEDIA"
            : c.sku === undefined || onHand(d.stockMoves, c.sku.id) < c.qty;
        if (gone) {
          throw new Error(
            t(
              "returnCustomer.replacementGone",
              "{{item}} is no longer on the shelf — pick another replacement.",
              { item: c.unit?.serial ?? c.label },
            ),
          );
        }
      }

      const orderOf = (id: string) => d.orders.find((o) => o.id === id);
      /** A counted line's product, for the words on its RETUR. */
      const countedName = (order: Order, lineId: string) => {
        const skuId = order.lines?.find((l) => l.id === lineId)?.skuId;
        return d.skus.find((s) => s.id === skuId)?.name ?? lineId;
      };
      const saleOrder = involved
        .map((v) => v.sale.id)
        .filter((id) => orderOf(id) !== undefined);
      const backsOn = (id: string): Back[] => [
        ...unitBacks.filter((b) => b.saleId === id),
        ...countedBacks.filter((b) => b.saleId === id),
      ];
      // What each sale's money looked like BEFORE the return — for the log,
      // and for the marketplace numbers its RETUR keeps.
      const before = new Map(
        saleOrder.map((id) => [id, paymentsOf(orderOf(id)!)] as const),
      );
      const plan = planReturn({
        sales: saleOrder.map((id) => {
          const o = orderOf(id)!;
          return {
            id,
            code: o.code,
            bill: billAfterReturns(o),
            payments: paymentsOf(o),
            refunded: refundedOf(o),
            credit: backsOn(id).reduce((n, b) => n + worthOn(o, b), 0),
          };
        }),
        ...(intoId === undefined
          ? {}
          : { exchange: { total: replacementTotal, into: intoId } }),
        method: refundMethod,
        at: now,
        code: firstCode,
        newId: () => nextId("pay"),
      });
      outcome.refund = plan.refund;
      outcome.topUp = plan.topUp;

      // One return per unit, each waiting for the unit — unchanged.
      d.returns.unshift(
        ...unitBacks.map((b, i): ReturnRec => {
          const currentGrade = d.units.find(
            (u) => u.serial === b.serial,
          )?.grade;
          const chosenGrade = picks[b.serial]?.grade;
          const afterGrade =
            chosenGrade === null || chosenGrade === undefined
              ? undefined
              : chosenGrade;
          return {
            id: nextId("r"),
            code: codeOf.get(b)!,
            kind: "CUSTOMER",
            serial: b.serial,
            reason: reason!,
            reasonDetail: needsDetail ? reasonDetail.trim() : undefined,
            date: day,
            // ARRIVED at once (owner ask 2026-09-23): *"auto record it, no
            // need to add additional to receive it."* The form already asks
            // the condition per unit, which was the only thing the receive
            // step added.
            status: "ARRIVED",
            ...(firstReplacement === undefined
              ? {}
              : { exchangeSerial: firstReplacement }),
            ...(i === 0 && plan.topUp > 0 ? { fee: plan.topUp } : {}),
            // Grade snapshot (owner ask 2026-09-21): the "before" is what the
            // unit was graded before this row wrote its `afterGrade`; the
            // "after" is what was chosen on the form, or absent if unchanged.
            ...(currentGrade === undefined
              ? {}
              : { beforeGrade: currentGrade }),
            ...(afterGrade === undefined ? {} : { afterGrade }),
            // Signed adjustment recorded on the FIRST unit only, so a return
            // with three units back does not add its refund up three times.
            ...(i === 0 && plan.topUp > 0 ? { adjustment: plan.topUp } : {}),
            ...(i === 0 && plan.refund > 0 ? { adjustment: -plan.refund } : {}),
          };
        }),
      );

      /*
       * Straight back onto the shelf (owner ask 2026-09-23). The unit is
       * regraded to what the form chose — a unit that went out sealed comes
       * back second-hand, which is `gradeForCondition` — and the
       * `RETUR_PELANGGAN` that says so is written in this same mutation, the
       * rule every unit move in this app follows. Counted pieces already came
       * back this way.
       */
      for (const b of unitBacks) {
        const u = d.units.find((x) => x.serial === b.serial);
        const chosen = picks[b.serial]?.grade;
        const grade =
          chosen === null || chosen === undefined
            ? gradeForCondition("SECOND", u?.grade)
            : chosen;
        if (u) u.grade = grade as typeof u.grade;
        appendEvent(d, b.serial, {
          type: "RETUR_PELANGGAN",
          toStatus: "TERSEDIA",
          toLocationId: d.myWarehouseId,
          note: [why, `restocked on arrival (${codeOf.get(b)!})`]
            .filter(Boolean)
            .join(" — "),
          refCode: codeOf.get(b)!,
        });
      }

      for (const sp of plan.sales) {
        const order = orderOf(sp.id);
        if (order === undefined) continue;
        const was = before.get(sp.id) ?? [];
        const refs = marketplaceRefs(was, order.source);
        const said = refs.length === 0 ? "" : ` (${refs.join(", ")})`;
        const here = backsOn(sp.id);
        // What this sale gives up, unit by unit and line by line — adding
        // back up exactly. A unit may take nothing; a zero adjustment is a
        // record that it came back.
        const shares = splitByWeight(
          sp.applied,
          here.map((b) => worthOn(order, b)),
        );
        order.adjustments = [
          ...(order.adjustments ?? []),
          ...here.map((b, k) => ({
            id: nextId("adj"),
            type: "RETUR" as const,
            code: codeOf.get(b)!,
            amount: shares[k] ?? 0,
            reason:
              b.kind === "UNIT"
                ? `Returned ${b.serial} — ${why}${said}`
                : `Returned ${b.qty} × ${countedName(order, b.lineId)} — ${why}${said}`,
            at: now,
          })),
        ];
        /*
         * Counted pieces come straight back onto the shelf, on the stock
         * ledger, at what they cost when they went out — there is no unit to
         * QC and nothing to wait for (2026-09-19). A damaged one is taken off
         * again with an adjustment.
         */
        for (const b of here) {
          if (b.kind !== "COUNTED") continue;
          const line = order.lines?.find((l) => l.id === b.lineId);
          if (!line) continue;
          line.returnedQty = (line.returnedQty ?? 0) + b.qty;
          const each =
            line.qty > 0
              ? Math.round(lineCost(d.stockMoves, line.id) / line.qty)
              : 0;
          d.stockMoves.push({
            id: nextId("sm"),
            skuId: line.skuId,
            locationId: d.myWarehouseId,
            qty: b.qty,
            cost: each,
            type: "RETUR_PELANGGAN",
            at: now,
            refCode: codeOf.get(b)!,
            orderId: order.id,
            orderLineId: line.id,
            note: why,
            staff,
          });
        }
        // Written out every time, changed or not: a sale a return has touched
        // is read by its own list from then on (`paymentsOf`), so a sale from
        // before payments were a list must not be left without one.
        order.payments = sp.payments;
        if (sp.refund > 0) {
          order.refunds = [
            ...(order.refunds ?? []),
            {
              id: nextId("rf"),
              method: refundMethod,
              amount: sp.refund,
              at: now,
              note: `Returned ${here.map(labelOf).join(", ")} (${here
                .map((b) => codeOf.get(b)!)
                .join(", ")})`,
            },
          ];
        }
      }

      /*
       * The replacements go out on ONE sale, at their price. A unit's ledger
       * row names the RETURN (its first code): against the server that is the
       * event's foreign key to the return, which is how the history lists
       * every replacement of an exchange. With no unit coming back there is
       * no return row to name, and the row names the sale instead.
       */
      const onto = intoId === undefined ? undefined : orderOf(intoId);
      if (onto !== undefined) {
        const firstUnitCode =
          unitBacks[0] === undefined ? undefined : codeOf.get(unitBacks[0]);
        const note = `Exchange for ${backLabel} (${allCodes.join(", ")})`;
        const sold: string[] = [];
        for (const c of goingOut) {
          if (c.unit !== undefined) {
            const serial = c.unit.serial;
            onto.serials = [...onto.serials, serial];
            onto.prices = { ...onto.prices, [serial]: c.price };
            onto.listPrices = { ...(onto.listPrices ?? {}), [serial]: c.ask };
            onto.total += c.price;
            appendEvent(d, serial, {
              type: "TERJUAL",
              toStatus: "TERJUAL",
              refCode: firstUnitCode ?? onto.code,
              note,
            });
            sold.push(serial);
            continue;
          }
          if (c.sku === undefined) continue;
          const skuId = c.sku.id;
          const lineId = nextId("ol");
          onto.lines = [
            ...(onto.lines ?? []),
            { id: lineId, skuId, qty: c.qty, price: c.price, listPrice: c.ask },
          ];
          onto.total += c.price * c.qty;
          // Exactly as the till writes a counted line out: one TERJUAL per
          // location, this desk's own first, at the moving average.
          const cost = averageCost(d, skuId);
          for (const part of takeFrom(
            d.stockMoves,
            skuId,
            c.qty,
            d.myWarehouseId,
          ) ?? []) {
            d.stockMoves.push({
              id: nextId("sm"),
              skuId,
              locationId: part.locationId,
              qty: -part.qty,
              cost,
              type: "TERJUAL",
              at: now,
              refCode: firstCode,
              orderId: onto.id,
              orderLineId: lineId,
              note,
              staff,
            });
          }
        }
        // CLAUDE.md's one sanctioned hard delete: a unit's QC photographs go
        // the moment it is sold, and a replacement going out is a sale. The
        // ledger row above keeps the sale itself.
        purgeQcPhotos(d, sold);
      }

      // Every sale's payments logged, and `settled` projected over them —
      // after the replacements, which changed one sale's bill.
      for (const id of saleOrder) {
        const order = orderOf(id);
        if (order === undefined) continue;
        // Its own list, empty or not — it carries a RETUR now (`paymentsOf`).
        const after = paymentsOf(order);
        for (const row of diffPayments(before.get(id) ?? [], after, {
          at: now,
          staff,
          reason: `Return ${allCodes.join(", ")}`,
        })) {
          d.paymentLog.push({ id: nextId("plog"), ...row });
        }
        order.settled = isSettled(
          billAfterReturns(order),
          after,
          refundedOf(order),
        );
      }

      /*
       * A returned unit's condition, applied HERE (owner ask 2026-09-21).
       *
       * The form asks for the grade the unit is coming in AT — worn on the way
       * back, opened box on a NEW sale — and the shelf must reflect that as
       * soon as the receive-QC completes. Written on the unit ONLY when staff
       * picked something different from what is stored; leaving the current
       * grade alone is the safe default, and rewriting it with itself would
       * still be a write the store had to replay.
       */
      for (const b of unitBacks) {
        const g = picks[b.serial]?.grade;
        if (g === undefined || g === null) continue;
        const u = d.units.find((x) => x.serial === b.serial);
        if (u && u.grade !== g) u.grade = g;
      }

      /*
       * The cash side of the return, as an adjustment (owner ask 2026-09-21).
       *
       * *"The money will go to income adjustment with the income under the
       * category 'Refund', then the description is the payment reference."* A
       * plain return, or a cheaper exchange, hands money BACK — an EXPENSE
       * with kind REFUND. A dearer exchange takes money IN — a ManualIncome
       * with reason REFUND. Either way the RETUR adjustment on the sale is
       * untouched, so the sale's ledger still says a unit came back and this
       * row only records where the rupiah went.
       */
      const description = paymentRef.trim() || `Return ${allCodes.join(", ")}`;
      if (outcome.refund > 0) {
        d.expenses.unshift({
          id: nextId("e"),
          kind: "REFUND",
          amount: outcome.refund,
          date: day,
          method: refundMethod,
          note: description,
        });
      }
      if (outcome.topUp > 0) {
        d.incomes.unshift({
          id: nextId("mi"),
          reason: "REFUND",
          amount: outcome.topUp,
          date: day,
          method: refundMethod,
          note: description,
        });
      }
    };

    try {
      void mutate(write);
    } catch (e) {
      // Only reachable if the store moved between this render and the press.
      message.error(e instanceof Error ? e.message : String(e));
      return;
    }

    message.success(
      exchange
        ? outcome.topUp > 0
          ? t(
              "returnCustomer.recordedExchangeTopUp",
              "Exchange recorded — take {{amount}} from the customer. Receive the returned units when they are back.",
              { amount: fmtRp(outcome.topUp) },
            )
          : t(
              "returnCustomer.recordedExchange",
              "Exchange recorded — receive the returned units when they are back.",
            )
        : outcome.refund > 0
          ? t(
              "returnCustomer.recordedRefund",
              "Return recorded — hand back {{amount}}. Receive the unit when it is back.",
              { amount: fmtRp(outcome.refund) },
            )
          : t(
              "returnCustomer.recorded",
              "Return recorded — receive the unit when it is back.",
            ),
    );
    close();
  };

  const methodChips = (
    <Flex gap={6} wrap>
      {MONEY_METHODS.map((m) => (
        <Button
          key={m}
          size="small"
          shape="round"
          type={refundMethod === m ? "primary" : "default"}
          aria-pressed={refundMethod === m}
          onClick={() => setRefundMethod(m)}
        >
          {m === "TUNAI"
            ? t("pos.methodCash", "Cash")
            : t("pos.methodTransfer", "Transfer")}
        </Button>
      ))}
    </Flex>
  );

  // ── The form's left table: what can come back ──────────────────────────
  /*
   * Every listed sale's units and counted lines in ONE table (owner ask
   * 2026-09-21: "make it table instead of per individual"). A sale's rows sit
   * together and its code spans them, with the button that takes the sale off
   * the return; a sale with nothing left out gets one row that says so, so it
   * can still be taken off.
   */
  const backRows: BackRow[] = views.flatMap((v): BackRow[] => {
    const rows = [
      ...v.returnable.map((serial) => ({
        key: `u:${serial}`,
        kind: "UNIT" as const,
        sale: v.sale,
        serial,
      })),
      ...v.countedOut.map((line) => ({
        key: `c:${line.id}`,
        kind: "COUNTED" as const,
        sale: v.sale,
        line,
      })),
    ];
    if (rows.length === 0) {
      return [{ key: `e:${v.sale.id}`, kind: "EMPTY", sale: v.sale, span: 1 }];
    }
    return rows.map((r, i) => ({ ...r, span: i === 0 ? rows.length : 0 }));
  });

  const setExpense = (row: BackRow, value: number | null) => {
    if (row.kind === "UNIT") {
      setPicks((m) => ({
        ...m,
        [row.serial]: { on: true, expense: value },
      }));
    } else if (row.kind === "COUNTED") {
      setQtyPicks((m) => ({
        ...m,
        [row.line.id]: { qty: m[row.line.id]?.qty ?? 0, expense: value },
      }));
    }
  };

  const returnTable = (
    <div
      role="group"
      aria-label={t("returnCustomer.returnTable", "Units coming back")}
    >
      <Table<BackRow>
        size="small"
        rowKey="key"
        pagination={false}
        dataSource={backRows}
        locale={{
          emptyText: t(
            "returnCustomer.nothingListed",
            "Scan the serial coming back, or add its sale.",
          ),
        }}
        columns={[
          {
            key: "pick",
            width: 64,
            render: (_: unknown, r: BackRow) => {
              if (r.kind === "UNIT") {
                return (
                  <Checkbox
                    checked={picks[r.serial]?.on ?? false}
                    aria-label={t(
                      "returnCustomer.tickAria",
                      "{{serial}} is coming back",
                      { serial: r.serial },
                    )}
                    onChange={(e) =>
                      setPicks((m) => ({
                        ...m,
                        [r.serial]: {
                          on: e.target.checked,
                          expense: m[r.serial]?.expense ?? null,
                        },
                      }))
                    }
                  />
                );
              }
              if (r.kind === "COUNTED") {
                const left = r.line.qty - (r.line.returnedQty ?? 0);
                return (
                  <InputNumber
                    size="small"
                    min={0}
                    max={left}
                    precision={0}
                    style={{ width: 60 }}
                    value={qtyPicks[r.line.id]?.qty ?? 0}
                    aria-label={t(
                      "returnCustomer.qtyBackAria",
                      "How many {{product}} are coming back",
                      {
                        product: skuLabel(
                          skuById.get(r.line.skuId),
                          r.line.skuId,
                        ),
                      },
                    )}
                    onChange={(value) => {
                      const qty = Math.max(
                        0,
                        Math.min(left, Math.floor(value ?? 0)),
                      );
                      setQtyPicks((m) => ({
                        ...m,
                        [r.line.id]: {
                          qty,
                          expense: m[r.line.id]?.expense ?? null,
                        },
                      }));
                    }}
                  />
                );
              }
              return null;
            },
          },
          {
            title: t("returnCustomer.transaction", "Transaction"),
            key: "sale",
            width: 196,
            onCell: (r: BackRow) => ({ rowSpan: r.span }),
            render: (_: unknown, r: BackRow) => (
              <Flex gap={4} align="flex-start" justify="space-between">
                <Flex vertical gap={0} style={{ minWidth: 0 }}>
                  <Typography.Text strong style={{ whiteSpace: "nowrap" }}>
                    {r.sale.code}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {[customerName(r.sale), fmtDate(r.sale.ts)]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography.Text>
                </Flex>
                <Button
                  type="text"
                  size="small"
                  icon={<CloseOutlined />}
                  aria-label={t(
                    "returnCustomer.removeSale",
                    "Take {{code}} off this return",
                    { code: r.sale.code },
                  )}
                  onClick={() => removeSale(r.sale)}
                />
              </Flex>
            ),
          },
          {
            title: t("returnCustomer.unitCol", "Unit"),
            key: "unit",
            onCell: (r: BackRow) => (r.kind === "EMPTY" ? { colSpan: 3 } : {}),
            render: (_: unknown, r: BackRow) => {
              if (r.kind === "EMPTY") {
                return (
                  <Typography.Text type="secondary">
                    {t(
                      "returnCustomer.nothingOut",
                      "Every unit of this sale is already back, or on its way.",
                    )}
                  </Typography.Text>
                );
              }
              if (r.kind === "COUNTED") {
                const sku = skuById.get(r.line.skuId);
                return (
                  <Flex vertical gap={0}>
                    <Typography.Text>
                      {skuLabel(sku, r.line.skuId)}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t(
                        "returnCustomer.countedOut",
                        "{{code}} · {{count}} still with the customer",
                        {
                          code: sku?.code ?? "",
                          count: r.line.qty - (r.line.returnedQty ?? 0),
                        },
                      )}
                    </Typography.Text>
                  </Flex>
                );
              }
              return (
                <Flex vertical gap={0}>
                  <Typography.Text>{productLabel(r.serial)}</Typography.Text>
                  <Flex gap={6} align="center" wrap>
                    <GradeTag grade={unitOf(r.serial)?.grade} plain />
                    <Typography.Text
                      type="secondary"
                      style={{ fontFamily: "monospace", fontSize: 12 }}
                    >
                      {r.serial}
                    </Typography.Text>
                  </Flex>
                </Flex>
              );
            },
          },
          {
            // Condition of the unit as it comes back (owner ask 2026-09-21).
            // Editable per row so a machine returned worn can be regraded
            // here, and the shelf reflects that as soon as the receive-QC
            // completes. Ignored for counted lines — a piece has no grade.
            title: t("returnCustomer.conditionCol", "Condition"),
            key: "grade",
            width: 130,
            onCell: (r: BackRow) => (r.kind === "EMPTY" ? { colSpan: 0 } : {}),
            render: (_: unknown, r: BackRow) => {
              if (r.kind !== "UNIT") return null;
              const off = !(picks[r.serial]?.on ?? false);
              const current =
                picks[r.serial]?.grade ?? unitOf(r.serial)?.grade ?? null;
              return (
                <Select
                  size="small"
                  disabled={off}
                  value={current}
                  aria-label={t(
                    "returnCustomer.conditionAria",
                    "Condition of {{serial}} on return",
                    { serial: r.serial },
                  )}
                  style={{ width: 110 }}
                  options={GRADE_OPTIONS.map((g) => ({ value: g, label: g }))}
                  onChange={(v: string) =>
                    setPicks((m) => ({
                      ...m,
                      [r.serial]: {
                        on: m[r.serial]?.on ?? true,
                        expense: m[r.serial]?.expense ?? null,
                        grade: v,
                      },
                    }))
                  }
                />
              );
            },
          },
          {
            title: t("returnCustomer.priceCol", "Price"),
            key: "price",
            align: "right" as const,
            onCell: (r: BackRow) => (r.kind === "EMPTY" ? { colSpan: 0 } : {}),
            render: (_: unknown, r: BackRow) =>
              r.kind === "UNIT" ? (
                <Typography.Text style={{ whiteSpace: "nowrap" }}>
                  {fmtRp(r.sale.prices[r.serial] ?? 0)}
                </Typography.Text>
              ) : r.kind === "COUNTED" ? (
                <Typography.Text style={{ whiteSpace: "nowrap" }}>
                  {t("returnCustomer.eachPrice", "{{price}} each", {
                    price: fmtRp(r.line.price),
                  })}
                </Typography.Text>
              ) : null,
          },
          {
            title: t("returnCustomer.expenseCol", "Additional expense"),
            key: "expense",
            width: 150,
            onCell: (r: BackRow) => (r.kind === "EMPTY" ? { colSpan: 0 } : {}),
            render: (_: unknown, r: BackRow) => {
              if (r.kind === "EMPTY") return null;
              const name =
                r.kind === "UNIT"
                  ? r.serial
                  : skuLabel(skuById.get(r.line.skuId), r.line.skuId);
              const off =
                r.kind === "UNIT"
                  ? !(picks[r.serial]?.on ?? false)
                  : (qtyPicks[r.line.id]?.qty ?? 0) === 0;
              const value =
                r.kind === "UNIT"
                  ? picks[r.serial]?.expense
                  : qtyPicks[r.line.id]?.expense;
              return (
                <Form.Item noStyle>
                  <MoneyInput
                    disabled={off}
                    value={value ?? undefined}
                    aria-label={t(
                      "returnCustomer.expenseFor",
                      "Additional expense on {{serial}}",
                      { serial: name },
                    )}
                    onChange={(v) => setExpense(r, v)}
                  />
                </Form.Item>
              );
            },
          },
        ]}
      />
    </div>
  );

  // ── The form's right table: what goes out instead ──────────────────────
  /** The search's result list — units on the shelf, then counted products. */
  const resultList = (
    <div
      role="group"
      aria-label={t("returnCustomer.inventoryList", "Units in the inventory")}
      style={{
        maxHeight: RESULT_ROWS * RESULT_ROW_HEIGHT,
        overflowY: "auto",
      }}
    >
      {unitResults.length === 0 && countedResults.length === 0 ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("returnCustomer.noMatch", "Nothing in stock matches.")}
        </Typography.Text>
      ) : null}
      {unitResults.map((u) => {
        const sku = skuById.get(u.skuId);
        return (
          <Button
            key={u.serial}
            type="text"
            block
            aria-label={t("returnCustomer.addReplacement", "Add {{item}}", {
              item: u.serial,
            })}
            onClick={() => addUnit(u.serial)}
            style={{
              height: "auto",
              minHeight: RESULT_ROW_HEIGHT,
              paddingBlock: 4,
              paddingInline: 8,
            }}
          >
            <Flex align="center" gap={8} style={{ width: "100%", minWidth: 0 }}>
              <Typography.Text
                ellipsis
                style={{ flex: 1, minWidth: 0, textAlign: "left" }}
              >
                {skuLabel(sku, u.serial)}
              </Typography.Text>
              <GradeTag grade={u.grade} plain />
              <Typography.Text
                type="secondary"
                style={{ fontFamily: "monospace", fontSize: 12 }}
              >
                {u.serial}
              </Typography.Text>
              <Typography.Text style={{ whiteSpace: "nowrap" }}>
                {fmtRp(priceOf(u, sku?.price ?? 0))}
              </Typography.Text>
            </Flex>
          </Button>
        );
      })}
      {countedResults.map((c) => (
        <Button
          key={c.sku.id}
          type="text"
          block
          aria-label={t("returnCustomer.addReplacement", "Add {{item}}", {
            item: skuLabel(c.sku, c.sku.id),
          })}
          onClick={() => addCounted(c.sku.id, c.held)}
          style={{
            height: "auto",
            minHeight: RESULT_ROW_HEIGHT,
            paddingBlock: 4,
            paddingInline: 8,
          }}
        >
          <Flex align="center" gap={8} style={{ width: "100%", minWidth: 0 }}>
            <Typography.Text
              ellipsis
              style={{ flex: 1, minWidth: 0, textAlign: "left" }}
            >
              {skuLabel(c.sku, c.sku.id)}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("returnCustomer.onHand", "{{count}} on hand", {
                count: c.held,
              })}
            </Typography.Text>
            <Typography.Text style={{ whiteSpace: "nowrap" }}>
              {t("returnCustomer.eachPrice", "{{price}} each", {
                price: fmtRp(c.sku.price),
              })}
            </Typography.Text>
          </Flex>
        </Button>
      ))}
    </div>
  );

  /** What is going out, each with its price. */
  const exchangeTable = (
    <div
      role="group"
      aria-label={t("returnCustomer.exchangeTable", "Units going out")}
    >
      <Table<ChosenRow>
        size="small"
        rowKey="key"
        pagination={false}
        dataSource={chosen}
        locale={{
          emptyText: t(
            "returnCustomer.nothingOutYet",
            "Nothing goes out — a plain return.",
          ),
        }}
        columns={[
          {
            title: t("returnCustomer.unitCol", "Unit"),
            key: "unit",
            render: (_: unknown, c: ChosenRow) => {
              const item = c.unit?.serial ?? c.label;
              return (
                <Flex vertical gap={0}>
                  <Typography.Text>{c.label}</Typography.Text>
                  {c.unit !== undefined ? (
                    <Flex gap={6} align="center" wrap>
                      <GradeTag grade={c.unit.grade} plain />
                      <Typography.Text
                        type="secondary"
                        style={{ fontFamily: "monospace", fontSize: 12 }}
                      >
                        {c.unit.serial}
                      </Typography.Text>
                    </Flex>
                  ) : (
                    <Flex gap={6} align="center">
                      <InputNumber
                        size="small"
                        min={1}
                        max={c.held}
                        precision={0}
                        style={{ width: 60 }}
                        value={c.qty}
                        aria-label={t(
                          "returnCustomer.replacementQtyFor",
                          "How many {{item}}",
                          { item },
                        )}
                        onChange={(value) =>
                          editReplacement(c.key, {
                            qty: Math.max(
                              1,
                              Math.min(c.held ?? 1, Math.floor(value ?? 1)),
                            ),
                          })
                        }
                      />
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12 }}
                      >
                        {t("returnCustomer.onHand", "{{count}} on hand", {
                          count: c.held ?? 0,
                        })}
                      </Typography.Text>
                    </Flex>
                  )}
                </Flex>
              );
            },
          },
          {
            title: t("returnCustomer.priceCol", "Price"),
            key: "price",
            width: 170,
            render: (_: unknown, c: ChosenRow) => (
              <Form.Item noStyle>
                <MoneyInput
                  value={c.price}
                  aria-label={t(
                    "returnCustomer.replacementPriceFor",
                    "Price of {{item}}",
                    { item: c.unit?.serial ?? c.label },
                  )}
                  onChange={(value) => editReplacement(c.key, { price: value })}
                />
              </Form.Item>
            ),
          },
          {
            key: "remove",
            width: 44,
            render: (_: unknown, c: ChosenRow) => (
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                aria-label={t(
                  "returnCustomer.removeReplacement",
                  "Remove {{item}}",
                  { item: c.unit?.serial ?? c.label },
                )}
                onClick={() => removeReplacement(c.key)}
              />
            ),
          },
        ]}
      />
    </div>
  );

  // ── The history ────────────────────────────────────────────────────────
  /** The index the Exchange unit column reads: SG code → what went out. */

  /*
   * One row per RETURN, not per unit (owner ask 2026-09-21: "do not make it
   * complicated … if a lot of product then display all in separate rows").
   * A return is what one press of *Record return* wrote: its RETUR
   * adjustments all carry the same instant, across every sale it touched.
   * A return from before adjustments existed falls back to the exchange it
   * was part of, then to its own code — which is also how the B2Soft import
   * groups a document's lines, since they share one code.
   */

  return (
    <>
      <Flex vertical gap={16}>
        <Modal
          open={addOpen}
          onCancel={close}
          // Wide, because the two tables sit side by side (owner ask
          // 2026-09-21); antd caps it at the viewport on a smaller screen.
          width={1360}
          title={t("returnCustomer.recordAReturn", "Record a return")}
          destroyOnHidden
          okText={t("returnCustomer.recordReturn", "Record return")}
          onOk={submit}
        >
          <Form layout="vertical" component="div">
            {/* Reason and date first — they are about the whole return. */}
            <Flex gap={12} wrap>
              <Form.Item
                label={t("returnCustomer.reason", "Reason")}
                required
                style={{ flex: "1 1 260px", marginBottom: 12 }}
                validateStatus={tried && !reason ? "error" : undefined}
              >
                <Select
                  showSearch
                  value={reason}
                  optionFilterProp="label"
                  placeholder={t(
                    "returnCustomer.pickOrSearchAReason",
                    "Pick or search a reason",
                  )}
                  aria-label={t("returnCustomer.reason", "Reason")}
                  options={reasons.map((r) => ({
                    value: r.label,
                    label: r.label,
                  }))}
                  onChange={setReason}
                />
              </Form.Item>
              {needsDetail && (
                <Form.Item
                  label={t(
                    "returnCustomer.specifyTheReason",
                    "Specify the reason",
                  )}
                  required
                  style={{ flex: "2 1 320px", marginBottom: 12 }}
                  validateStatus={
                    tried && reasonDetail.trim() === "" ? "error" : undefined
                  }
                >
                  <Input
                    value={reasonDetail}
                    onChange={(e) => setReasonDetail(e.target.value)}
                    aria-label={t(
                      "returnCustomer.specifyTheReason",
                      "Specify the reason",
                    )}
                    placeholder={t(
                      "returnCustomer.whatWasWrongWithIt",
                      "What was wrong with it?",
                    )}
                  />
                </Form.Item>
              )}
              <Form.Item
                label={t("returnCustomer.date", "Date")}
                style={{ flex: "0 0 auto", marginBottom: 12 }}
              >
                <DatePicker
                  format="DD MMM YYYY"
                  value={date}
                  allowClear={false}
                  onChange={(d) => d && setDate(d)}
                />
              </Form.Item>
            </Flex>

            <Row gutter={[24, 16]}>
              {/* Return, on the left: what comes back. */}
              <Col xs={24} xl={14}>
                <Flex vertical gap={8}>
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    {t("returnCustomer.returnSide", "Return")}
                  </Typography.Title>
                  {/* A serial adds the sale it is out on; or add the sale. */}
                  <Flex gap={8} wrap align="flex-start">
                    <Form.Item
                      style={{ flex: "1 1 220px", marginBottom: 0 }}
                      validateStatus={lookupMiss ? "warning" : undefined}
                      help={
                        lookupMiss
                          ? t(
                              "returnCustomer.notSold",
                              "{{serial}} is not a unit out with a customer. Pick the sale below instead.",
                              { serial: lookupMiss },
                            )
                          : undefined
                      }
                    >
                      <Input
                        value={lookup}
                        onChange={(e) =>
                          setLookup(e.target.value.toUpperCase())
                        }
                        onPressEnter={(e) => {
                          e.preventDefault();
                          find();
                        }}
                        placeholder={t(
                          "returnCustomer.scanSerial",
                          "Scan or type the serial coming back",
                        )}
                        style={{ fontFamily: "monospace" }}
                        aria-label={t("returnCustomer.serialLookup", "Serial")}
                        data-scan-target=""
                      />
                    </Form.Item>
                    <Button icon={<SearchOutlined />} onClick={find}>
                      {t("returnCustomer.findSale", "Find the sale")}
                    </Button>
                  </Flex>
                  <Select
                    showSearch
                    value={null}
                    optionFilterProp="label"
                    placeholder={t(
                      "returnCustomer.addSale",
                      "Add a sale — code or customer",
                    )}
                    aria-label={t("returnCustomer.transaction", "Transaction")}
                    options={db.orders
                      .filter((o) => !saleIds.includes(o.id))
                      .map((o) => ({
                        value: o.id,
                        label: [o.code, customerName(o), fmtDate(o.ts)]
                          .filter(Boolean)
                          .join(" — "),
                      }))}
                    onChange={(id: string | null) => {
                      if (id) addSale(id);
                    }}
                  />
                  {returnTable}
                </Flex>
              </Col>

              {/* Exchange, on the right: what goes out instead. */}
              <Col xs={24} xl={10}>
                <Flex vertical gap={8}>
                  <Flex vertical gap={0}>
                    <Typography.Title level={5} style={{ margin: 0 }}>
                      {t("returnCustomer.exchangeFor", "Exchange for")}
                    </Typography.Title>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t(
                        "returnCustomer.exchangeHint",
                        "Optional. Scan or search what the customer takes instead.",
                      )}
                    </Typography.Text>
                  </Flex>
                  {/* Only once something is coming back (owner, 2026-09-21:
                      "only then, show the unit for replacement"). */}
                  {views.length === 0 ? (
                    <Typography.Text type="secondary">
                      {t(
                        "returnCustomer.exchangeWaits",
                        "Add the unit coming back first.",
                      )}
                    </Typography.Text>
                  ) : (
                    <>
                      <Input
                        allowClear
                        value={query}
                        prefix={<SearchOutlined />}
                        onChange={(e) => onQuery(e.target.value)}
                        onPressEnter={(e) => {
                          e.preventDefault();
                          onQueryEnter();
                        }}
                        placeholder={t(
                          "returnCustomer.searchReplacement",
                          "Scan a serial, or search product, variant or code",
                        )}
                        aria-label={t(
                          "returnCustomer.searchReplacementAria",
                          "Find a replacement in the inventory",
                        )}
                        data-scan-target=""
                      />
                      {resultList}
                      {exchangeTable}
                      {stale.length > 0 && (
                        <Alert
                          type="warning"
                          showIcon
                          title={t(
                            "returnCustomer.staleReplacements",
                            "No longer on the shelf, so left out: {{list}}",
                            { list: stale.join(", ") },
                          )}
                        />
                      )}
                      {involved.length > 1 && chosen.length > 0 && (
                        <Form.Item
                          label={t(
                            "returnCustomer.putOn",
                            "Put the replacements on",
                          )}
                          style={{ marginBottom: 0 }}
                        >
                          <Select
                            value={target?.sale.id}
                            aria-label={t(
                              "returnCustomer.putOn",
                              "Put the replacements on",
                            )}
                            options={involved.map((v) => ({
                              value: v.sale.id,
                              label: [v.sale.code, customerName(v.sale)]
                                .filter(Boolean)
                                .join(" — "),
                            }))}
                            onChange={(id: string) => setInto(id)}
                          />
                        </Form.Item>
                      )}
                    </>
                  )}
                </Flex>
              </Col>
            </Row>

            {/* The money — only what somebody has to act on. */}
            {preview !== undefined &&
              !preview.exchange &&
              preview.refund > 0 && (
                <Flex gap={12} align="center" wrap style={{ marginTop: 16 }}>
                  <Typography.Text strong>
                    {t("returnCustomer.handBack", "Hand back {{amount}}", {
                      amount: fmtRp(preview.refund),
                    })}
                  </Typography.Text>
                  {methodChips}
                </Flex>
              )}
            {preview !== undefined && preview.exchange && preview.topUp > 0 && (
              <Flex gap={12} align="center" wrap style={{ marginTop: 16 }}>
                <Typography.Text strong>
                  {t(
                    "returnCustomer.customerPays",
                    "Customer pays {{amount}} for the exchange",
                    { amount: fmtRp(preview.topUp) },
                  )}
                </Typography.Text>
                {methodChips}
              </Flex>
            )}
            {/*
             * Payment reference (owner ask 2026-09-21, evening).
             *
             * Only drawn once money is going to move — a plain return with no
             * refund does not need one. Whatever is typed becomes the
             * description of the Refund adjustment written when the form is
             * saved, so a reconciliation later can key on it. Empty falls
             * back to the return's SG codes.
             */}
            {preview !== undefined &&
              ((!preview.exchange && preview.refund > 0) ||
                (preview.exchange && preview.topUp > 0)) && (
                <Form.Item
                  style={{ marginTop: 12, marginBottom: 0 }}
                  label={t("returnCustomer.paymentRef", "Payment reference")}
                  tooltip={t(
                    "returnCustomer.paymentRefHint",
                    "Written on the Refund adjustment. A bank slip, a courier's receipt, or the message ID the customer sent.",
                  )}
                >
                  <Input
                    value={paymentRef}
                    onChange={(e) => setPaymentRef(e.target.value)}
                    placeholder={t(
                      "returnCustomer.paymentRefPlaceholder",
                      "e.g. BCA 20260921-4711, or the courier's receipt number",
                    )}
                    aria-label={t(
                      "returnCustomer.paymentRef",
                      "Payment reference",
                    )}
                  />
                </Form.Item>
              )}
          </Form>
        </Modal>

        {/* The history card this button used to sit on is gone (owner ask
            2026-09-23 — one combined table on the page); the check itself is
            unchanged. */}
        <div>
          <Button icon={<UploadOutlined />} onClick={() => setCheckOpen(true)}>
            {t("returnCustomer.checkShopee", "Check a Shopee file")}
          </Button>
        </div>
        <ShopeeRefundCheck
          open={checkOpen}
          onClose={() => setCheckOpen(false)}
          onRecordReturn={recordFromShopee}
        />
      </Flex>
    </>
  );
}
