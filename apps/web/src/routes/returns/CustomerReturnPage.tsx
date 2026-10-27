/**
 * Returns and exchanges from customers (owner brief 2026-09-19, reshaped
 * 2026-09-21, simplified 2026-09-25, the charge moved 2026-09-26).
 *
 * ## The form — ONE transaction, and a picker
 *
 * *"Make it simpler, the user only need to fill: Transaction number (only 1
 * transaction at a time). When we typed & enter, it will open up a popup
 * modal, showing all the unit … and a select button on each product, by
 * default is select all, then 'Select {n} unit'. Then it will add the units
 * to the table."*
 *
 * So the form asks one question. The box takes the shop's own transaction
 * number, the marketplace order number the customer quotes, or a serial read
 * off the unit in their hand — one question (*which sale is this?*) asked
 * three ways — and Enter opens the picker: every unit still out on that sale
 * with its name, serial, price and grade, scrolling past a screenful, each
 * with a tick and all of them ticked. *Select n units* puts them in the
 * table: **Unit name | Unit serial**, and the button that takes a row off.
 *
 * What went, and why it could: the LIST of sales (a return spanning two
 * transactions is now two returns), the Transaction column that told one
 * sale's rows from another's, the per-row Condition Select (see `Pick.grade`),
 * and the price column — a unit is worth what it sold for, which is a fact
 * about the sale rather than something to read off a row while recording one.
 *
 * ## The charge — one per return, or one per exchange unit (2026-09-26)
 *
 * *"The additional price is per exchange unit, and if no exchange, we can add
 * 1 additional fee per return (not per product). Make the exchange unit price
 * read only in that return window."*
 *
 * It used to be a money box on every row of the return table, which asked the
 * bench to decide how a single restocking charge divided over three units
 * coming back on one receipt. It is one figure now: **Additional fee** under
 * the return table on a plain return, and a per-row **Additional price**
 * column on the exchange table when something goes out — because there the
 * charge is about the unit the customer is taking.
 *
 * Either way it is `feeTotal`, and it comes off the CREDIT (`creditOf`), not
 * off the replacement's price: what a replacement goes out at is the unit's
 * own asking price and this window no longer edits it. The two readings are
 * the same money — a smaller credit and a dearer replacement move the refund
 * and the top-up by exactly the same amount — and taking it off the credit
 * leaves `Order.prices` saying what the shop asks, so the sale invents
 * neither a bargain nor an upsell out of a swap fee.
 *
 * ## The exchange — asked for, not assumed
 *
 * *"Add '+ Exchange unit' and it will show another table below it, but do not
 * show all the unit first — make it like a dropdown showing the serial &
 * name. The table shows: Unit name | Serial Unit | price."*
 *
 * Under the return table, and hidden behind one button until somebody presses
 * it: most returns exchange for nothing, and the always-open list of the
 * whole shelf was the tallest thing on the dialog. The dropdown searches the
 * same fields the list used to and takes a scanned serial the same way, since
 * a Select's search box is an input like any other. The button is disabled
 * until something is coming back, which is the 2026-09-19 rule: *"only then,
 * show the unit for replacement."*
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
 * ## Receiving the unit — there is no step (owner ask 2026-09-23)
 *
 * *"Auto record it, no need to add additional to receive it."* A return is
 * ARRIVED as it is recorded: the row, the regrade and the `RETUR_PELANGGAN`
 * are ONE transaction, because a moment in which a unit that went out New is
 * back on the shelf still graded New is the moment somebody sells it.
 *
 * ## Refunds in a Shopee file
 *
 * *Check a Shopee file*, in the page header, reads the seller balance report
 * for orders Shopee refunded and offers to record each one's return —
 * `ShopeeRefundCheck.tsx`. The dialog is here and the button is on
 * `ReturnsPage`, so `checkOpen` is a prop.
 *
 * The reason list is Settings' (`db.reasons`, activity `RETURN_CUSTOMER`);
 * "Other" asks for a sentence.
 */
import { useMemo, useState } from "react";
import { warehouseLabel } from "../../lib/warehouses";
import {
  Alert,
  App,
  AutoComplete,
  Button,
  DatePicker,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Table,
  Typography,
} from "antd";
import {
  CloseOutlined,
  DeleteOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { MoneyInput } from "../../components/MoneyInput";
import { GradeTag } from "../../components/GradeTag";
import { fmtRp, fmtDate, fmtNone } from "../../lib/format.js";
import { customerLabel } from "../../lib/customers.js";
import { gradeForCondition } from "../../lib/condition.js";
import { resolveSerialQuery } from "../../lib/serialInput.js";
import { skuTracksSerial } from "../../lib/serialTracking.js";
import { priceOf } from "../../lib/unitPrice.js";
import {
  billAfterReturns,
  isSettled,
  paymentsOf,
  refundedOf,
} from "../../lib/salePayments.js";
import { paymentRefOf } from "../../lib/saleStatus.js";
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
  ensureReason,
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
  asBoolean,
  asListOf,
  asOneOf,
  asString,
  hasShape,
  isRecord,
} from "../../lib/draftGuards.js";
import { COLUMN, TYPE } from "../../theme/tokens";
import { ShopeeRefundCheck } from "./ShopeeRefundCheck";

/** The label that turns on the "specify" field. Matched case-insensitively. */
const OTHER = "other";

/** How a refund is handed back, and a top-up taken — the till's two. */
const MONEY_METHODS = ["TUNAI", "TRANSFER"] as const;
type MoneyMethod = (typeof MONEY_METHODS)[number];

/** One unit of a sale, as the form's checklist holds it. */
interface Pick {
  readonly on: boolean;
  /**
   * The grade the unit is coming back in (owner ask 2026-09-21, evening).
   *
   * A returned unit is second-hand and its grade often changes on the way in.
   * ⚠️ The FORM stopped asking on 2026-09-25 — the owner's column list for
   * the row is Unit name, Unit serial and Additional price, and no more — so
   * nothing sets this now and every unit comes back at
   * `gradeForCondition("SECOND", …)`, which is what the shelf said before
   * 2026-09-21. The field, the write path and the draft guard all stay:
   * the history's *Edit* dialog still corrects a return's condition, and it
   * is one Select away from coming back here if the owner asks for it.
   * `undefined` leaves the unit's current grade alone.
   */
  readonly grade?: string | null;
}

/** Pieces of a counted line coming back. */
interface QtyPick {
  readonly qty: number;
}

/**
 * Something going out in exchange, as the form holds it.
 *
 * No price: what a replacement goes out at is the unit's own asking price, and
 * this window cannot change it (owner ask 2026-09-26). `extra` is what the
 * shop charges ON TOP of that for the swap — per exchange unit, which is where
 * the additional price lives now.
 */
type Replacement =
  | {
      readonly kind: "UNIT";
      readonly serial: string;
      readonly extra: number | null;
    }
  | {
      readonly kind: "COUNTED";
      readonly skuId: string;
      readonly qty: number;
      readonly extra: number | null;
    };

/** One thing coming back, as the submit writes it. */
type Back =
  | {
      readonly kind: "UNIT";
      readonly saleId: string;
      readonly serial: string;
    }
  | {
      readonly kind: "COUNTED";
      readonly saleId: string;
      readonly lineId: string;
      readonly qty: number;
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
  /** What it goes out at, per piece. Read-only here: it IS the asking price. */
  readonly price: number;
  /** Charged on top of the whole row for the swap. */
  readonly extra: number;
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
  }[];
  /** What its ticked units and lines are worth back, before the fee. */
  readonly credit: number;
}

/**
 * One row of the form's return table: a unit, or a counted line.
 *
 * Every row is something that IS coming back since 2026-09-25 — the picker
 * decides that, not this table — so there is no longer a row for a sale with
 * nothing left out, and nothing spans anything: one transaction at a time
 * means one sale's code, and it is on the line above the table.
 */
type BackRow = {
  readonly key: string;
  readonly sale: Order;
} & (
  | { readonly kind: "UNIT"; readonly serial: string }
  | { readonly kind: "COUNTED"; readonly line: OrderLine }
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
  hasShape(v, { on: FIELD.boolean }),
);
const parseQtyPicks = recordOf((v): v is QtyPick =>
  hasShape(v, { qty: FIELD.number }),
);
/** A money box that may be empty. The return's own fee is one. */
const parseFee = (v: unknown): number | null | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const parseIds = asListOf((v): v is string => typeof v === "string");
const parseReplacements = asListOf(
  (v): v is Replacement =>
    hasShape(v, {
      kind: (k) => k === "UNIT",
      serial: FIELD.string,
      extra: isMoney,
    }) ||
    hasShape(v, {
      kind: (k) => k === "COUNTED",
      skuId: FIELD.string,
      qty: FIELD.number,
      extra: isMoney,
    }),
);
/** A picked date travels as its ISO string. */
const parseDay = (v: unknown): string | undefined =>
  typeof v === "string" && dayjs(v).isValid() ? v : undefined;

/** How tall the picker's list gets before it scrolls (owner ask). */
const PICKER_HEIGHT = 360;

/**
 * What one thing coming back is worth on its sale: what it sold for.
 *
 * Gross since 2026-09-26. What the shop charges for the return came off here
 * unit by unit until then; it is ONE figure for the whole return now (or one
 * per exchange unit), so it is taken off the sale's credit rather than off
 * each thing on it — and these are also the WEIGHTS the credit is split back
 * over (`splitByWeight`), which have to be the gross prices or a fee would be
 * subtracted twice.
 */
function worthOn(order: Order, back: Back): number {
  if (back.kind === "UNIT") {
    return Math.max(0, order.prices[back.serial] ?? 0);
  }
  const line = order.lines?.find((l) => l.id === back.lineId);
  return line === undefined ? 0 : Math.max(0, line.price * back.qty);
}

export function CustomerReturnPanel({
  addOpen,
  onCloseAdd,
  onOpenAdd,
  checkOpen = false,
  onCloseCheck,
}: {
  addOpen: boolean;
  onCloseAdd: () => void;
  /** Open the Add-return form — what a Shopee refund's *Record return* does. */
  onOpenAdd: () => void;
  /**
   * Whether the Shopee-file check is open.
   *
   * Controlled from the page, because the button that opens it is in the page
   * header now (owner ask 2026-09-25) and the dialog is here. The panel used
   * to own both; it draws no button of its own any more.
   */
  checkOpen?: boolean;
  onCloseCheck?: () => void;
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
   * Where what comes back goes (owner ask 2026-10-21: *"we should be able to
   * choose the warehouse instead of automatically sending it to warehouse
   * 4"*). It used to be this desk's warehouse, unasked — and an account whose
   * warehouse was the service bench sent every return there. Only a PICKED
   * warehouse is kept; see `returnTo` for the default.
   */
  const [warehousePicked, setWarehousePicked] = usePersistentState<
    string | undefined
  >(RETURN_DRAFT("warehouse"), undefined, asString);
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
  /**
   * The one additional charge on a PLAIN return (owner ask 2026-09-26).
   *
   * *"If no exchange, we can add 1 additional fee per return (not per
   * product)."* A restocking charge, the courier who fetched the unit — one
   * figure about the return, where it used to be a box on every row of it.
   * With something going out in exchange the charge is per exchange unit
   * instead and this is not asked for; the value is kept, so closing the
   * exchange brings it back.
   */
  const [returnFee, setReturnFee] = usePersistentState<number | null>(
    RETURN_DRAFT("fee"),
    null,
    parseFee,
  );
  /** What goes out in exchange — any number of units and counted products. */
  const [replacements, setReplacements] = usePersistentState<Replacement[]>(
    RETURN_DRAFT("replacements"),
    [],
    parseReplacements,
  );
  /**
   * Whether the exchange half is showing (owner ask 2026-09-25).
   *
   * Hidden until *+ Exchange unit* is pressed: most returns are plain, and a
   * search box and an empty table under every one of them was the larger
   * half of the form asking a question nobody had.
   */
  const [exchangeOpen, setExchangeOpen] = usePersistentState<boolean>(
    RETURN_DRAFT("exchangeOpen"),
    false,
    asBoolean,
  );
  /**
   * The sale whose units are being picked, and which of them are ticked.
   *
   * Not kept on this device: it is open for the few seconds between typing a
   * transaction number and pressing *Select n units*, and a dialog that
   * reopens itself on a page somebody came back to is a dialog in the way.
   */
  const [picking, setPicking] = useState<Order | null>(null);
  const [pickSel, setPickSel] = useState<Record<string, boolean>>({});
  const [tried, setTried] = useState(false);

  const reasons = db.reasons.filter(
    (r) => r.activity === "RETURN_CUSTOMER" && r.active,
  );
  const needsDetail = (reason ?? "").trim().toLowerCase() === OTHER;
  /**
   * Where a returned unit can be put: any active warehouse. "Not the bench"
   * (`kind !== "SERVIS"`) went on 2026-10-26 — in the shop's database that
   * kind is on 04, *Gudang Masuk Belum QC*, a real warehouse a return may
   * well go to. A unit with a fault goes to service from its row, by a
   * decision.
   */
  const shelves = db.warehouses.filter((w) => w.active);
  /** This desk's warehouse when it is active; otherwise nothing, and the form asks. */
  const returnTo =
    shelves.find((w) => w.id === warehousePicked)?.id ??
    shelves.find((w) => w.id === db.myWarehouseId)?.id;

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
  const customerName = (o: Order) => {
    const c = db.customers.find((x) => x.id === o.customerId);
    return c ? customerLabel(c) : undefined;
  };

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
      return qty > 0 ? [{ line, qty }] : [];
    });
    const credit =
      ticked.reduce(
        (n, serial) => n + worthOn(sale, { kind: "UNIT", saleId: id, serial }),
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
          price: ask,
          extra: Math.max(0, r.extra ?? 0),
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
        price: sku.price,
        extra: Math.max(0, r.extra ?? 0),
      },
    ];
  });
  const replacementTotal = chosen.reduce((n, c) => n + c.price * c.qty, 0);
  /**
   * What the shop charges for this return, whichever way it was asked for.
   *
   * Per EXCHANGE UNIT when something goes out, ONE figure for the whole return
   * when nothing does (owner ask 2026-09-26). Either way it comes off the
   * credit: the customer gets that much less back, or pays that much more for
   * the swap — the same arithmetic, which is why one number is enough for both.
   */
  const feeTotal =
    chosen.length > 0
      ? chosen.reduce((n, c) => n + c.extra, 0)
      : Math.max(0, returnFee ?? 0);
  /** Picked, and gone from the shelf since — said, not silently dropped. */
  const stale = replacements
    .filter((r) => !chosen.some((c) => c.replacement === r))
    .map((r) =>
      r.kind === "UNIT" ? r.serial : skuLabel(skuById.get(r.skuId), r.skuId),
    );
  const chosenSerials = new Set(
    replacements.flatMap((r) => (r.kind === "UNIT" ? [r.serial] : [])),
  );

  /**
   * The sale the replacements go out on — the one the form is about.
   *
   * One transaction at a time since 2026-09-25 (owner ask), so there is no
   * longer anything to choose between: the list that used to hold several
   * sales holds one, and the "Put the replacements on" Select that asked
   * which of them a replacement belonged to is gone with it. `views` and
   * `involved` are still lists because `planReturn` takes one and the
   * submit walks it.
   */
  const target: SaleView | undefined = involved[0];

  /**
   * A sale's credit with the return's fee taken off it.
   *
   * Off the FIRST sale only: the fee is one charge for the return, and a
   * return holds one transaction since 2026-09-25 — but `planReturn` still
   * takes a list, so saying which one it lands on is what stops a second sale
   * ever being charged the same fee twice.
   */
  const creditOf = (gross: number, first: boolean) =>
    Math.max(0, gross - (first ? feeTotal : 0));

  const inputOf = (v: SaleView, i: number): ReturnSaleInput => ({
    id: v.sale.id,
    code: v.sale.code,
    bill: billAfterReturns(v.sale),
    payments: paymentsOf(v.sale),
    refunded: refundedOf(v.sale),
    credit: creditOf(v.credit, i === 0),
  });
  /** What the return does to the money, for the lines that ask for action. */
  const preview =
    involved.length === 0
      ? undefined
      : planReturn({
          sales: involved.map((v, i) => inputOf(v, i)),
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

  /**
   * The sales the transaction box offers while somebody types.
   *
   * The whole list, filtered by antd against the label — a shop with three
   * years of receipts has a few thousand, which a virtualised Select renders
   * without complaint. The label is what the box searches: the shop's code,
   * the customer, the date, and the marketplace order number the customer
   * quotes when the return came through Shopee.
   */
  const saleOptions = db.orders.map((o) => ({
    value: o.id,
    label: [o.code, paymentRefOf(paymentsOf(o)), customerName(o), fmtDate(o.ts)]
      .filter(Boolean)
      .join(" — "),
  }));

  const reset = () => {
    setLookup("");
    setLookupMiss(null);
    setSaleIds([]);
    setPicks({});
    setQtyPicks({});
    setReason(undefined);
    setReasonDetail("");
    setWarehousePicked(undefined);
    setDatePicked(undefined);
    setReplacements([]);
    setReturnFee(null);
    setExchangeOpen(false);
    setPicking(null);
    setPickSel({});
    setTried(false);
    setPaymentRef("");
  };

  const close = () => {
    reset();
    onCloseAdd();
  };

  /**
   * Put a sale on the return, REPLACING whatever was on it.
   *
   * One transaction at a time (owner ask 2026-09-25): a second number typed
   * into the box is a correction, not a second block, so the first sale's
   * ticks go with it rather than being left behind on a sale nobody can see.
   */
  const addSale = (id: string) => {
    setSaleIds((ids) => (ids[0] === id && ids.length === 1 ? ids : [id]));
    if (saleIds[0] !== id) {
      setPicks({});
      setQtyPicks({});
    }
  };

  /** Take the sale off the return, with everything that was ticked on it. */
  const removeSale = () => {
    setSaleIds([]);
    setPicks({});
    setQtyPicks({});
  };

  /** Everything of a sale that could come back: its units, then its pieces. */
  const openPicker = (order: Order) => {
    const out = returnableSerials(order, db.orders, statusOf, pendingBack);
    const lines = countedOutOf(order);
    if (out.length === 0 && lines.length === 0) {
      setLookupMiss(order.code);
      return;
    }
    setLookupMiss(null);
    // Everything ticked to start with (owner ask 2026-09-25: "by default is
    // select all"). A whole sale coming back is the common return; a partial
    // one is untick-and-count, which is less work than tick-them-all.
    setPickSel({
      ...Object.fromEntries(out.map((serial) => [`u:${serial}`, true])),
      ...Object.fromEntries(lines.map((l) => [`c:${l.id}`, true])),
    });
    setPicking(order);
  };

  /**
   * What the box holds, resolved: the shop's own transaction number, a
   * marketplace's order number, or a serial out with a customer.
   *
   * The owner asked for the transaction number (2026-09-25) and the 2026-09-19
   * brief asked for the serial; they are one box because they are one
   * question — *which sale is this?* — and the bench has whichever of the two
   * is in front of it.
   */
  const find = () => {
    const text = lookup.trim();
    if (text === "") return;
    const wanted = text.toUpperCase();
    const byCode = db.orders.find(
      (o) =>
        o.code.toUpperCase() === wanted ||
        // A marketplace's own order number, which is what a Shopee or
        // Tokopedia return quotes. It lives on the sale's payments, one per
        // marketplace part (2026-09-21).
        (paymentRefOf(paymentsOf(o)) ?? "")
          .toUpperCase()
          .split(", ")
          .includes(wanted),
    );
    if (byCode !== undefined) {
      setLookup("");
      openPicker(byCode);
      return;
    }
    const serial = resolveSerialQuery(lookup, allSerials, supplierCodes);
    const order = serial ? saleOfSerial(db.orders, serial) : undefined;
    if (!order || statusOf(serial) !== "TERJUAL" || pendingBack.has(serial)) {
      setLookupMiss(text);
      return;
    }
    setLookup("");
    openPicker(order);
  };

  /** *Select n units*: what was ticked becomes the return's rows. */
  const confirmPick = () => {
    const order = picking;
    if (order === null) return;
    const out = returnableSerials(order, db.orders, statusOf, pendingBack);
    const lines = countedOutOf(order);
    addSale(order.id);
    setPicks(
      Object.fromEntries(
        out
          .filter((serial) => pickSel[`u:${serial}`])
          .map((serial) => [serial, { on: true }]),
      ),
    );
    setQtyPicks(
      Object.fromEntries(
        lines
          .filter((l) => pickSel[`c:${l.id}`])
          // A counted line comes back whole: the picker is a list of things,
          // not a list of numbers, and a part-returned accessory is a second
          // return rather than a stepper on every row of the dialog.
          .map((l) => [l.id, { qty: l.qty - (l.returnedQty ?? 0) }]),
      ),
    );
    setPicking(null);
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
      ...Object.fromEntries(out.map((s) => [s, { on: true }])),
    }));
    setQtyPicks((m) => ({
      ...m,
      ...Object.fromEntries(
        lines.map((l) => [l.id, { qty: l.qty - (l.returnedQty ?? 0) }]),
      ),
    }));
    onCloseCheck?.();
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
        : [...list, { kind: "UNIT", serial, extra: null }],
    );
  };

  /** A counted product: one more piece, never more than the shop holds. */
  const addCounted = (skuId: string, held: number) =>
    setReplacements((list) => {
      const at = list.findIndex(
        (r) => r.kind === "COUNTED" && r.skuId === skuId,
      );
      if (at < 0)
        return [...list, { kind: "COUNTED", skuId, qty: 1, extra: null }];
      return list.map((r, i) =>
        i === at && r.kind === "COUNTED"
          ? { ...r, qty: Math.min(held, r.qty + 1) }
          : r,
      );
    });

  const editReplacement = (
    key: string,
    patch: { extra?: number | null; qty?: number },
  ) =>
    setReplacements((list) =>
      list.map((r) =>
        (r.kind === "UNIT" ? `u:${r.serial}` : `c:${r.skuId}`) !== key
          ? r
          : r.kind === "UNIT"
            ? {
                ...r,
                ...(patch.extra !== undefined ? { extra: patch.extra } : {}),
              }
            : {
                ...r,
                ...(patch.extra !== undefined ? { extra: patch.extra } : {}),
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
    if (returnTo === undefined) {
      message.error(
        t(
          "returnCustomer.needWarehouse",
          "Pick the warehouse it goes back to.",
        ),
      );
      return;
    }
    const intoWarehouse = returnTo;

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
      })),
    );
    const countedBacks: Extract<Back, { kind: "COUNTED" }>[] = involved.flatMap(
      (v) =>
        v.countedBack.map((x) => ({
          kind: "COUNTED" as const,
          saleId: v.sale.id,
          lineId: x.line.id,
          qty: x.qty,
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
        sales: saleOrder.map((id, i) => {
          const o = orderOf(id)!;
          return {
            id,
            code: o.code,
            bill: billAfterReturns(o),
            payments: paymentsOf(o),
            refunded: refundedOf(o),
            credit: creditOf(
              backsOn(id).reduce((n, b) => n + worthOn(o, b), 0),
              i === 0,
            ),
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

      // A typed reason joins Settings' list in the same write (2026-10-21): a
      // fresh database has none, and a pick-only box refused every return.
      ensureReason(d, "RETURN_CUSTOMER", reason);

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
          toLocationId: intoWarehouse,
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
            locationId: intoWarehouse,
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
          createdAt: new Date().toISOString(),
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
          createdAt: new Date().toISOString(),
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

  // ── The form's table: what is coming back ──────────────────────────────
  /*
   * One row per thing coming back: Unit name | Unit serial, and the button
   * that takes the row off again.
   *
   * The Additional price column left on 2026-09-26 (owner ask): *"the
   * additional price is per exchange unit, and if no exchange, we can add 1
   * additional fee per return (not per product)."* A charge for taking a
   * return is one charge — the courier, the restocking — and asking for it on
   * every row invited it to be typed on every row.
   *
   * This table is the ANSWER now, not the question. Which units come back is
   * decided in the picker that opens off the transaction number, so the
   * whole sale is no longer listed here waiting to be ticked — and with one
   * transaction at a time the Transaction column that told one sale's rows
   * from another's has nothing left to say.
   */
  const backRows: BackRow[] = views.flatMap((v): BackRow[] => [
    ...v.ticked.map((serial) => ({
      key: `u:${serial}`,
      kind: "UNIT" as const,
      sale: v.sale,
      serial,
    })),
    ...v.countedBack.map((x) => ({
      key: `c:${x.line.id}`,
      kind: "COUNTED" as const,
      sale: v.sale,
      line: x.line,
    })),
  ]);

  /** Take one row off the return without reopening the picker. */
  const dropRow = (row: BackRow) => {
    if (row.kind === "UNIT") {
      setPicks((m) => {
        const next = { ...m };
        delete next[row.serial];
        return next;
      });
      return;
    }
    setQtyPicks((m) => {
      const next = { ...m };
      delete next[row.line.id];
      return next;
    });
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
            "returnCustomer.nothingPicked",
            "Type the transaction number above and pick the units.",
          ),
        }}
        columns={[
          {
            title: t("returnCustomer.unitName", "Unit name"),
            key: "unit",
            render: (_: unknown, r: BackRow) =>
              r.kind === "UNIT" ? (
                <Typography.Text>{productLabel(r.serial)}</Typography.Text>
              ) : (
                <Typography.Text>
                  {`${skuLabel(skuById.get(r.line.skuId), r.line.skuId)} ×${
                    qtyPicks[r.line.id]?.qty ?? 0
                  }`}
                </Typography.Text>
              ),
          },
          {
            title: t("returnCustomer.unitSerial", "Unit serial"),
            key: "serial",
            width: COLUMN.serial,
            render: (_: unknown, r: BackRow) =>
              r.kind === "UNIT" ? (
                <Typography.Text
                  style={{ fontFamily: "monospace", fontSize: TYPE.sm }}
                >
                  {r.serial}
                </Typography.Text>
              ) : (
                // A counted product has no serial — it is a quantity
                // (2026-09-19), and the cell says so rather than a dash
                // (2026-09-21).
                <Typography.Text type="secondary">{fmtNone()}</Typography.Text>
              ),
          },
          {
            title: "",
            key: "remove",
            width: COLUMN.action,
            render: (_: unknown, r: BackRow) => (
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                aria-label={t(
                  "returnCustomer.removeBack",
                  "Take {{item}} off",
                  {
                    item:
                      r.kind === "UNIT"
                        ? r.serial
                        : skuLabel(skuById.get(r.line.skuId), r.line.skuId),
                  },
                )}
                onClick={() => dropRow(r)}
              />
            ),
          },
        ]}
      />
    </div>
  );

  // ── The picker: every unit on the sale, all ticked ─────────────────────
  /*
   * Owner ask 2026-09-25: *"When we typed & enter, it will open up a popup
   * modal, showing all the unit (unit name, serial, price, grade), if lots of
   * unit make it scrollable, and a select button on each product, by default
   * is select all, then 'Select {n} unit'."*
   *
   * antd's own `rowSelection` is what draws the ticks, which also gives the
   * header's select-all for free — untick-a-few is the whole point of opening
   * on everything ticked.
   */
  interface PickRow {
    readonly key: string;
    readonly name: string;
    readonly serial: string | undefined;
    readonly price: number;
    readonly grade: string | undefined;
  }
  const pickRows: PickRow[] =
    picking === null
      ? []
      : [
          ...returnableSerials(picking, db.orders, statusOf, pendingBack).map(
            (serial): PickRow => ({
              key: `u:${serial}`,
              name: productLabel(serial),
              serial,
              price: picking.prices[serial] ?? 0,
              grade: unitOf(serial)?.grade,
            }),
          ),
          ...countedOutOf(picking).map((line): PickRow => {
            const left = line.qty - (line.returnedQty ?? 0);
            return {
              key: `c:${line.id}`,
              name: `${skuLabel(skuById.get(line.skuId), line.skuId)} ×${left}`,
              serial: undefined,
              price: line.price * left,
              grade: undefined,
            };
          }),
        ];
  const pickedKeys = pickRows.filter((r) => pickSel[r.key]).map((r) => r.key);

  const pickerModal = (
    <Modal
      open={picking !== null}
      onCancel={() => setPicking(null)}
      onOk={confirmPick}
      destroyOnHidden
      width={720}
      okButtonProps={{ disabled: pickedKeys.length === 0 }}
      okText={t("returnCustomer.selectNUnits", "Select {{count}} units", {
        count: pickedKeys.length,
      })}
      title={t("returnCustomer.pickUnits", "Units on {{code}}", {
        code: picking?.code ?? "",
      })}
    >
      <Table<PickRow>
        size="small"
        rowKey="key"
        pagination={false}
        dataSource={pickRows}
        // Scrolls once the sale is longer than a screenful (owner ask), and
        // the header's tick stays put above it.
        scroll={{ y: PICKER_HEIGHT }}
        rowSelection={{
          selectedRowKeys: pickedKeys,
          onChange: (keys) =>
            setPickSel(Object.fromEntries(keys.map((k) => [String(k), true]))),
        }}
        columns={[
          {
            title: t("returnCustomer.unitName", "Unit name"),
            key: "name",
            render: (_: unknown, r: PickRow) => r.name,
          },
          {
            title: t("returnCustomer.unitSerial", "Unit serial"),
            key: "serial",
            width: COLUMN.serial,
            render: (_: unknown, r: PickRow) =>
              r.serial === undefined ? (
                <Typography.Text type="secondary">{fmtNone()}</Typography.Text>
              ) : (
                <Typography.Text
                  style={{ fontFamily: "monospace", fontSize: TYPE.sm }}
                >
                  {r.serial}
                </Typography.Text>
              ),
          },
          {
            title: t("returnCustomer.priceCol", "Price"),
            key: "price",
            width: COLUMN.money,
            align: "right" as const,
            render: (_: unknown, r: PickRow) => fmtRp(r.price),
          },
          {
            title: t("returnCustomer.gradeCol", "Grade"),
            key: "grade",
            width: COLUMN.grade,
            render: (_: unknown, r: PickRow) =>
              r.grade === undefined ? (
                <Typography.Text type="secondary">{fmtNone()}</Typography.Text>
              ) : (
                <GradeTag grade={r.grade} plain />
              ),
          },
        ]}
      />
    </Modal>
  );

  // ── The exchange, under the return ─────────────────────────────────────
  /*
   * Owner ask 2026-09-25: *"Add '+ Exchange unit' and it will show another
   * table below it, but do not show all the unit first — make it like a
   * dropdown showing the serial & name. The table shows: Unit name | Serial
   * Unit | price."*
   *
   * The always-open list of the whole shelf is gone: it was the tallest thing
   * on a form most of whose returns exchange for nothing. A dropdown asks the
   * same question in one line and searches the same fields — and a scanned
   * serial still lands in it, because a Select's search box takes a
   * keyboard-wedge burst exactly as an Input does.
   */
  const shelfOptions = [
    ...db.units
      .filter((u) => u.status === "TERSEDIA" && !chosenSerials.has(u.serial))
      .map((u) => ({
        value: `u:${u.serial}`,
        label: `${u.serial} — ${skuLabel(skuById.get(u.skuId), u.serial)}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    ...counted.map((c) => ({
      value: `c:${c.sku.id}`,
      label: t("returnCustomer.countedOption", "{{name}} — {{count}} on hand", {
        name: skuLabel(c.sku, c.sku.id),
        count: c.held,
      }),
    })),
  ];

  const pickReplacement = (value: string) => {
    if (value.startsWith("u:")) {
      addUnit(value.slice(2));
      return;
    }
    const skuId = value.slice(2);
    const held = counted.find((c) => c.sku.id === skuId)?.held ?? 0;
    if (held > 0) addCounted(skuId, held);
  };

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
            "Pick what the customer takes instead.",
          ),
        }}
        columns={[
          {
            title: t("returnCustomer.unitName", "Unit name"),
            key: "unit",
            render: (_: unknown, c: ChosenRow) =>
              c.unit !== undefined ? (
                <Flex gap={6} align="center" wrap>
                  <Typography.Text>{c.label}</Typography.Text>
                  <GradeTag grade={c.unit.grade} plain />
                </Flex>
              ) : (
                <Flex gap={6} align="center" wrap>
                  <Typography.Text>{c.label}</Typography.Text>
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
                      { item: c.label },
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
                </Flex>
              ),
          },
          {
            title: t("returnCustomer.serialUnit", "Serial unit"),
            key: "serial",
            width: COLUMN.serial,
            render: (_: unknown, c: ChosenRow) =>
              c.unit === undefined ? (
                <Typography.Text type="secondary">{fmtNone()}</Typography.Text>
              ) : (
                <Typography.Text
                  style={{ fontFamily: "monospace", fontSize: TYPE.sm }}
                >
                  {c.unit.serial}
                </Typography.Text>
              ),
          },
          {
            /*
             * Read-only (owner ask 2026-09-26): *"make the exchange unit price
             * read only in that return window."* A replacement goes out at
             * what the shop asks for it, which is a fact about the unit and is
             * changed where prices are changed. What this window may add is
             * the column beside it.
             */
            title: t("returnCustomer.priceCol", "Price"),
            key: "price",
            width: COLUMN.money,
            align: "right" as const,
            render: (_: unknown, c: ChosenRow) => fmtRp(c.price * c.qty),
          },
          {
            title: t("returnCustomer.expenseCol", "Additional price"),
            key: "extra",
            width: COLUMN.moneyInput,
            render: (_: unknown, c: ChosenRow) => (
              <Form.Item noStyle>
                <MoneyInput
                  value={c.replacement.extra ?? undefined}
                  aria-label={t(
                    "returnCustomer.extraFor",
                    "Additional price on {{item}}",
                    { item: c.unit?.serial ?? c.label },
                  )}
                  onChange={(value) => editReplacement(c.key, { extra: value })}
                />
              </Form.Item>
            ),
          },
          {
            title: "",
            key: "remove",
            width: COLUMN.action,
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
          /*
           * Narrower since 2026-09-25: the exchange table moved UNDER the
           * return table (owner ask), so the dialog is one column of four
           * cells rather than two tables side by side, and 1360px of it was
           * white space either side of a three-column grid.
           */
          width={900}
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
                {/* Pick one, or type a new one — it joins Settings' list. */}
                <AutoComplete
                  value={reason}
                  placeholder={t(
                    "returnCustomer.searchAReasonOrType",
                    "Search a reason, or type a new one",
                  )}
                  aria-label={t("returnCustomer.reason", "Reason")}
                  options={reasons.map((r) => ({ value: r.label }))}
                  filterOption={(input, opt) =>
                    String(opt?.value ?? "")
                      .toLowerCase()
                      .includes(input.toLowerCase())
                  }
                  onChange={(v: string) =>
                    setReason(v.trim() === "" ? undefined : v)
                  }
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
                label={t("returnCustomer.warehouse", "Back to warehouse")}
                required
                style={{ flex: "1 1 220px", marginBottom: 12 }}
                validateStatus={tried && !returnTo ? "error" : undefined}
              >
                <Select
                  value={returnTo}
                  placeholder={t(
                    "returnCustomer.pickAWarehouse",
                    "Pick a warehouse",
                  )}
                  aria-label={t(
                    "returnCustomer.warehouse",
                    "Back to warehouse",
                  )}
                  options={shelves.map((w) => ({
                    value: w.id,
                    label: warehouseLabel(w),
                  }))}
                  onChange={setWarehousePicked}
                />
              </Form.Item>
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

            {/*
             * The one thing the form asks for (owner ask 2026-09-25): *"the
             * user only need to fill: Transaction number (only 1 transaction
             * at a time)."* Enter opens the picker. An AutoComplete rather
             * than a plain box so a half-remembered number offers the sales
             * it could be — and a serial read off the unit in the customer's
             * hand still resolves to the sale it went out on, which is the
             * same question asked with the other label.
             */}
            <Flex gap={8} wrap align="flex-start">
              <Form.Item
                label={t(
                  "returnCustomer.transactionNumber",
                  "Transaction number",
                )}
                required
                style={{ flex: "1 1 320px", marginBottom: 12 }}
                validateStatus={
                  lookupMiss || (tried && involved.length === 0)
                    ? "error"
                    : undefined
                }
                help={
                  lookupMiss
                    ? t(
                        "returnCustomer.noSuchSale",
                        "{{text}} is not a transaction with anything still out.",
                        { text: lookupMiss },
                      )
                    : undefined
                }
              >
                <AutoComplete
                  value={lookup}
                  options={saleOptions}
                  /*
                   * Enter belongs to the BOX, not to the list. With the first
                   * option active by default, a serial typed in full — which
                   * matches no sale's label and so leaves the list showing
                   * whatever it was last filtered to — would open the picker
                   * on whichever sale happened to be highlighted.
                   */
                  defaultActiveFirstOption={false}
                  filterOption={(input, option) =>
                    (option?.label ?? "")
                      .toString()
                      .toLowerCase()
                      .includes(input.trim().toLowerCase())
                  }
                  onChange={(value: string) => {
                    setLookup(value.toUpperCase());
                    setLookupMiss(null);
                  }}
                  onSelect={(value: string) => {
                    setLookup("");
                    const order = db.orders.find((o) => o.id === value);
                    if (order) openPicker(order);
                  }}
                >
                  <Input
                    onPressEnter={(e) => {
                      e.preventDefault();
                      find();
                    }}
                    placeholder={t(
                      "returnCustomer.typeTheTransaction",
                      "Type the transaction number, or scan the serial",
                    )}
                    style={{ fontFamily: "monospace" }}
                    aria-label={t(
                      "returnCustomer.transactionNumber",
                      "Transaction number",
                    )}
                    data-scan-target=""
                  />
                </AutoComplete>
              </Form.Item>
              <Button
                icon={<SearchOutlined />}
                onClick={find}
                style={{ marginTop: 30 }}
              >
                {t("returnCustomer.findSale", "Find the sale")}
              </Button>
            </Flex>

            {/* What is coming back. */}
            {views[0] !== undefined && (
              <Flex
                gap={8}
                align="center"
                wrap
                style={{ marginBottom: 8 }}
                justify="space-between"
              >
                <Typography.Text type="secondary">
                  {[
                    views[0].sale.code,
                    customerName(views[0].sale),
                    fmtDate(views[0].sale.ts),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Typography.Text>
                <Flex gap={8}>
                  <Button
                    size="small"
                    onClick={() => openPicker(views[0]!.sale)}
                  >
                    {t("returnCustomer.changeUnits", "Change the units")}
                  </Button>
                  <Button size="small" onClick={removeSale}>
                    {t("returnCustomer.startOver", "Start over")}
                  </Button>
                </Flex>
              </Flex>
            )}
            {returnTable}

            {/*
             * One charge for the whole return (owner ask 2026-09-26).
             *
             * Drawn only while nothing is going out in exchange: with a
             * replacement on the form the charge is asked for per exchange
             * unit instead, in the column beside its price, and two boxes
             * both meaning "and this much on top" is a sale charged twice.
             */}
            {backRows.length > 0 && chosen.length === 0 && (
              <Form.Item
                style={{ marginTop: 12, marginBottom: 0, maxWidth: 260 }}
                label={t("returnCustomer.returnFee", "Additional fee")}
                tooltip={t(
                  "returnCustomer.returnFeeHint",
                  "Charged for taking the return — it comes off what the customer gets back.",
                )}
              >
                <MoneyInput
                  value={returnFee ?? undefined}
                  aria-label={t("returnCustomer.returnFee", "Additional fee")}
                  onChange={(value) => setReturnFee(value)}
                />
              </Form.Item>
            )}

            {/*
             * The exchange, below (owner ask 2026-09-25). Nothing of it is
             * drawn until somebody asks for it, and it cannot be asked for
             * until something is coming back — the 2026-09-19 rule: *"only
             * then, show the unit for replacement."*
             */}
            <div style={{ marginTop: 16 }}>
              {!exchangeOpen ? (
                <Button
                  icon={<PlusOutlined />}
                  disabled={backRows.length === 0}
                  onClick={() => setExchangeOpen(true)}
                >
                  {t("returnCustomer.addExchangeUnit", "Exchange unit")}
                </Button>
              ) : (
                <Flex vertical gap={8}>
                  <Flex gap={8} align="center" justify="space-between" wrap>
                    <Typography.Title level={5} style={{ margin: 0 }}>
                      {t("returnCustomer.exchangeFor", "Exchange for")}
                    </Typography.Title>
                    <Button
                      type="text"
                      size="small"
                      icon={<CloseOutlined />}
                      aria-label={t(
                        "returnCustomer.closeExchange",
                        "No exchange",
                      )}
                      onClick={() => {
                        setExchangeOpen(false);
                        setReplacements([]);
                      }}
                    />
                  </Flex>
                  <Select
                    showSearch
                    value={null}
                    optionFilterProp="label"
                    options={shelfOptions}
                    placeholder={t(
                      "returnCustomer.pickReplacement",
                      "Pick a unit — serial or name",
                    )}
                    aria-label={t(
                      "returnCustomer.searchReplacementAria",
                      "Find a replacement in the inventory",
                    )}
                    onChange={(value: string) => pickReplacement(value)}
                  />
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
                </Flex>
              )}
            </div>

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

        {pickerModal}

        {/*
         * The check itself is unchanged; only where it is opened from has
         * moved. It sat on a history card (gone 2026-09-23), then loose under
         * the table, where it was below everything it is about — it is in the
         * page header beside the two Add buttons now (owner ask 2026-09-25).
         */}
        <ShopeeRefundCheck
          open={checkOpen}
          onClose={() => onCloseCheck?.()}
          onRecordReturn={recordFromShopee}
        />
      </Flex>
    </>
  );
}
