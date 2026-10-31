/**
 * Correcting a recorded sale — the facts on it, and the units that went out.
 *
 * > *"This edit button will allow to edit the ref ID, date, channel, customer,
 * > edit serial (automatically fill in the unit) or unit (automatically empty
 * > the serial when the unit is changed so the user will fill again), payment
 * > method, amount, and actual paid or reference number."*
 * > — owner, 2026-09-23
 *
 * ## Swapping a unit rewrites the ledger
 *
 * The owner's decision, taken against the alternative of appending a
 * correction: a sale that went out with the wrong serial should read as though
 * it never did. So the unit coming off has its `TERJUAL` event REMOVED — it
 * goes back to the shelf with nothing on its timeline about this receipt — and
 * the unit going on gets one of its own.
 *
 * ⚠️ This is the one place the append-only rule in CLAUDE.md does not hold.
 * `packages/db`'s events adapter permits it for exactly this shape: the LAST
 * event of a unit, never leaving a unit with no history at all.
 *
 * ## Everything on it is correctable (owner, 2026-10-22)
 *
 * > *"The transaction history should be editable … Do not implement append
 * > only. This is an environment where they input amount / product / channel
 * > wrongly. So all things should be recoverable and a mistake should not cost
 * > lots of additional steps."*
 *
 * So a unit's PRICE is a box on its line, and a counted product — a MagSafe,
 * a charger, anything with no serial — is a line of its own with a quantity
 * and a price per piece. It could not be added here before, which is the bug
 * the owner reported. Its pieces leave and return on the stock ledger the way
 * the till's do: more pieces is a `TERJUAL` from the shelf, fewer (or the line
 * gone) is a `KOREKSI` putting them back at the cost they went out at. The
 * sale's subtotal and total are re-derived from the lines on save, so the
 * money on every other screen follows.
 *
 * Money is `PaymentsPanel`, the same grid the till and the payment dialog use.
 */
import { useEffect, useMemo, useState } from "react";
import {
  App,
  DatePicker,
  Divider,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Table,
  Typography,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button } from "antd";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { PaymentsPanel } from "../../components/PaymentsPanel";
import { MoneyInput } from "../../components/MoneyInput";
import { averageCost, takeFrom } from "../../lib/stock.js";
import { skuTracksSerial } from "../../lib/serialTracking.js";
import { isLiveSku } from "../../lib/skuCode.js";
import { fmtRp } from "../../lib/format.js";
import { priceOf } from "../../lib/unitPrice.js";
import {
  SALE_CHANNELS,
  holdsFunds,
  type SaleSource,
} from "../../lib/channels.js";
import { upsertSettlement } from "../../lib/payouts.js";
import type { SettlementFee } from "../../lib/marketplace.js";
import { customerLine } from "../../lib/customers.js";
import { isSaleLocked } from "../../lib/bookClose.js";
import { resolveSerialQuery } from "../../lib/serialInput.js";
import {
  billAfterReturns,
  isSettled,
  paymentsOf,
  refundedOf,
  type SalePayment,
} from "../../lib/salePayments.js";
import { diffPayments } from "../../lib/paymentEdits.js";
import { saleRowsOf, takeUnitOffSale } from "../../lib/saleDeletion.js";
import {
  appendEvent,
  currentStaffName,
  mutate,
  nextId,
  useDb,
} from "../../mock/store.js";
import type { Order, OrderFee } from "../../mock/seed.js";
import { totalAfterTradeIn, type TradeInLine } from "../../lib/pos.js";
import {
  bookTradeIn,
  isGross,
  isTradeInPayment,
  newTradeInPayment,
  payoutsOf,
  TRADE_IN_EXPENSE,
  tradeInCredit,
  tradeInPaid,
  tradeInUnitMovedOn,
  withTradeInPaid,
} from "../../lib/tradeIn.js";
import { ensureQcDescription } from "../../mock/store.js";
import { TradeInDialog } from "../stock/TradeInDialog.js";
import { COLUMN, SPACE, TYPE } from "../../theme/tokens";

/** A trade-in on the sale, while it is being edited (2026-10-31). */
interface TradeEdit {
  readonly key: string;
  readonly line: TradeInLine;
  /** Its value when the dialog opened; undefined for one added here. */
  readonly wasValue: number | undefined;
  readonly removed: boolean;
}

/** Money the shop handed the customer for the trade-in, while edited. */
interface PayoutEdit {
  readonly key: string;
  /** The `Expense` behind it; undefined for one added here. */
  readonly id: string | undefined;
  readonly amount: number;
  readonly method: "TUNAI" | "TRANSFER";
  readonly note: string;
  readonly ref: string;
  readonly wasAmount: number;
  readonly removed: boolean;
}

/** One unit line on the sale, while it is being edited. */
interface UnitLine {
  readonly key: string;
  /** The serial as stored when the dialog opened; "" for a line being added. */
  readonly was: string;
  /** What the box holds now. */
  readonly serial: string;
  /** The variant, which the serial decides — or which empties the serial. */
  readonly skuId: string | undefined;
  /** What this unit is charged on the sale. */
  readonly price: number;
}

/** One row of the Items table: a unit, an accessory, or one not picked yet. */
type ItemRow =
  | {
      readonly kind: "unit";
      readonly key: string;
      readonly skuId?: string;
      readonly line: UnitLine;
    }
  | {
      readonly kind: "counted";
      readonly key: string;
      readonly skuId?: string;
      readonly line: CountLine;
    }
  | { readonly kind: "new"; readonly key: string };

/** A counted product's line — an accessory, by quantity (no serial). */
interface CountLine {
  readonly key: string;
  /** `OrderLine.id`; a new line gets one at save. */
  readonly id: string | undefined;
  readonly skuId: string | undefined;
  readonly qty: number;
  /** Per piece. */
  readonly price: number;
  /** Pieces on the sale when the dialog opened; 0 for a new line. */
  readonly wasQty: number;
  readonly listPrice?: number;
  readonly returnedQty?: number;
}

export interface EditTransactionModalProps {
  readonly open: boolean;
  readonly order: Order | null;
  readonly onClose: () => void;
}

export function EditTransactionModal({
  open,
  order,
  onClose,
}: EditTransactionModalProps) {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();

  const [ref, setRef] = useState("");
  const [at, setAt] = useState(() => dayjs());
  const [source, setSource] = useState<SaleSource>("OFFLINE");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [lines, setLines] = useState<UnitLine[]>([]);
  const [counted, setCounted] = useState<CountLine[]>([]);
  /** Rows added and not given a product yet — they become one or the other. */
  const [fresh, setFresh] = useState<string[]>([]);
  /** The sale's additional charges (delivery, a bag…), as rows. */
  const [fees, setFees] = useState<OrderFee[]>([]);
  const [payments, setPayments] = useState<SalePayment[]>([]);
  /**
   * Each marketplace payment's deductions, by payment id (owner ask
   * 2026-10-22: deductions are entered under the payment, here, not on a
   * page of their own). Seeded from the payment's settlement.
   */
  const [deductions, setDeductions] = useState<Record<string, SettlementFee[]>>(
    {},
  );
  /** The trade-ins and their payouts (owner 2026-10-31, `lib/tradeIn.ts`). */
  const [trades, setTrades] = useState<TradeEdit[]>([]);
  const [payouts, setPayouts] = useState<PayoutEdit[]>([]);
  const [tradeOpen, setTradeOpen] = useState(false);

  useEffect(() => {
    if (!open || order === null) return;
    const paid = paymentsOf(order);
    setRef(paid.find((p) => p.ref?.trim())?.ref ?? "");
    setAt(dayjs(order.ts));
    setSource(order.source as SaleSource);
    setCustomerId(order.customerId);
    setLines(
      order.serials.map((serial, i) => ({
        key: `l-${i}-${serial}`,
        was: serial,
        serial,
        skuId: db.units.find((u) => u.serial === serial)?.skuId,
        price: order.prices[serial] ?? 0,
      })),
    );
    setCounted(
      (order.lines ?? []).map((l) => ({
        key: `c-${l.id}`,
        id: l.id,
        skuId: l.skuId,
        qty: l.qty,
        price: l.price,
        wasQty: l.qty,
        ...(l.listPrice !== undefined ? { listPrice: l.listPrice } : {}),
        ...(l.returnedQty !== undefined ? { returnedQty: l.returnedQty } : {}),
      })),
    );
    // The trade-in's own payment is not money and is not typed: it is kept
    // at the trade-in less its payouts, on save.
    setPayments(
      paid.filter((p) => !isTradeInPayment(p)).map((p) => ({ ...p })),
    );
    setTrades(
      (order.tradeIns ?? []).map((x) => ({
        key: x.id,
        line: { ...x },
        wasValue: x.value,
        removed: false,
      })),
    );
    setPayouts(
      payoutsOf(db, order.id).map((e) => ({
        key: e.id,
        id: e.id,
        amount: e.amount,
        method: e.method === "TRANSFER" ? "TRANSFER" : "TUNAI",
        note: e.note ?? "",
        ref: e.ref ?? "",
        wasAmount: e.amount,
        removed: false,
      })),
    );
    setFresh([]);
    setFees(
      order.fees?.map((f) => ({ ...f })) ??
        ((order.extra ?? 0) > 0
          ? [
              {
                id: `fee-${order.id}`,
                label: order.extraNote ?? "Extra",
                amount: order.extra!,
              },
            ]
          : []),
    );
    setDeductions(
      Object.fromEntries(
        db.settlements
          .filter((s) => s.orderId === order.id)
          .map((s) => [s.paymentId, s.fees.map((f) => ({ ...f }))]),
      ),
    );
  }, [open, order?.id]);

  /**
   * A sale-level reference box only where nothing else carries one: a
   * marketplace CHANNEL (Shopee, Tokopedia, TikTok) with no marketplace
   * payment row — TikTok, or Shopee taken in cash. A marketplace payment
   * carries its own under its method; any other sale has none at all.
   */
  const saleRefShown =
    holdsFunds(source) && !payments.some((p) => p.channel !== undefined);

  const setDeductionsOf = (paymentId: string, list: SettlementFee[]) =>
    setDeductions((all) => ({ ...all, [paymentId]: list }));

  /** Every serial the shop knows, for reading a typed or scanned one back. */
  const knownSerials = useMemo(() => db.units.map((u) => u.serial), [db.units]);

  /** Variants identified by serial, and the ones counted by quantity. */
  const [skuOptions, countedOptions] = useMemo(() => {
    const opts = db.skus
      .filter(isLiveSku)
      .map((k) => ({
        value: k.id,
        label: `${k.name} ${k.variantLabel}`.trim(),
        tracked: skuTracksSerial(db, k.id),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [opts.filter((o) => o.tracked), opts.filter((o) => !o.tracked)];
  }, [db.skus, db.models, db.categories]);

  /** Every live variant, tracked and counted, for the one Item picker. */
  const itemOptions = useMemo(
    () =>
      [...skuOptions, ...countedOptions].sort((a, b) =>
        a.label.localeCompare(b.label),
      ),
    [skuOptions, countedOptions],
  );
  const isCounted = (skuId: string) =>
    countedOptions.some((o) => o.value === skuId);

  const itemRows: ItemRow[] = [
    ...lines.map((l) => ({
      kind: "unit" as const,
      key: l.key,
      ...(l.skuId !== undefined ? { skuId: l.skuId } : {}),
      line: l,
    })),
    ...counted.map((c) => ({
      kind: "counted" as const,
      key: c.key,
      ...(c.skuId !== undefined ? { skuId: c.skuId } : {}),
      line: c,
    })),
    ...fresh.map((key) => ({ kind: "new" as const, key })),
  ];

  /** A new counted line for `skuId`, at its asking price. */
  const countedFor = (key: string, skuId: string): CountLine => ({
    key,
    id: undefined,
    skuId,
    qty: 1,
    price: db.skus.find((k) => k.id === skuId)?.price ?? 0,
    wasQty: 0,
  });

  /** Picking the product decides what the row is: a unit or an accessory. */
  const pickItem = (r: ItemRow, skuId: string) => {
    const counts = isCounted(skuId);
    if (r.kind === "new") {
      setFresh((rows) => rows.filter((k) => k !== r.key));
      if (counts) setCounted((rows) => [...rows, countedFor(r.key, skuId)]);
      else
        setLines((rows) => [
          ...rows,
          { key: r.key, was: "", serial: "", skuId, price: 0 },
        ]);
      return;
    }
    if (r.kind === "unit") {
      if (!counts) return pickSku(r.line, skuId);
      setLines((rows) => rows.filter((x) => x.key !== r.key));
      setCounted((rows) => [...rows, countedFor(`${r.key}-c`, skuId)]);
      return;
    }
    if (counts) {
      const sku = db.skus.find((k) => k.id === skuId);
      setCount(r.key, {
        skuId,
        ...(r.line.wasQty === 0 ? { price: sku?.price ?? 0 } : {}),
      });
      return;
    }
    setCounted((rows) => rows.filter((x) => x.key !== r.key));
    setLines((rows) => [
      ...rows,
      { key: `${r.key}-u`, was: "", serial: "", skuId, price: 0 },
    ]);
  };

  const removeItem = (r: ItemRow) => {
    if (r.kind === "unit")
      setLines((rows) => rows.filter((x) => x.key !== r.key));
    else if (r.kind === "counted")
      setCounted((rows) => rows.filter((x) => x.key !== r.key));
    else setFresh((rows) => rows.filter((k) => k !== r.key));
  };

  const setCount = (key: string, patch: Partial<CountLine>) =>
    setCounted((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );

  const setLine = (key: string, patch: Partial<UnitLine>) =>
    setLines((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );

  /** A serial names its unit, so picking one fills the product in. */
  const commitSerial = (line: UnitLine, raw: string) => {
    const serial = resolveSerialQuery(raw, knownSerials);
    const unit = db.units.find((u) => u.serial === serial);
    const sku = unit && db.skus.find((k) => k.id === unit.skuId);
    setLine(line.key, {
      serial,
      ...(unit ? { skuId: unit.skuId } : {}),
      // A unit new to the sale starts at its own asking price; one already on
      // it keeps what it was charged.
      ...(unit && serial !== line.was
        ? { price: priceOf(unit, sku?.price ?? 0) }
        : {}),
    });
  };

  /** Changing the product empties the serial — the old one is not that unit. */
  const pickSku = (line: UnitLine, skuId: string) =>
    setLine(line.key, { skuId, serial: "" });

  /**
   * The trade-in can be edited on a sale recorded gross, or one that has
   * none yet (which becomes gross). One recorded before 2026-10-31 netted it
   * off its total, and is left as it was written.
   */
  const tradeEditable =
    order !== null && (isGross(order) || (order.tradeIns ?? []).length === 0);
  const liveTrades = trades.filter((x) => !x.removed);
  const livePayouts = payouts.filter((x) => !x.removed);
  const creditNow = liveTrades.reduce(
    (n, x) => n + Math.max(0, x.line.value),
    0,
  );
  const payoutNow = livePayouts.reduce((n, x) => n + Math.max(0, x.amount), 0);
  /**
   * What the trade-in pays of the bill after the edit: what it paid, moved by
   * exactly the change of the trade-in and of the money handed back — the
   * invariant `lib/tradeIn.ts` names.
   */
  const tradePaidNow =
    order === null
      ? 0
      : Math.max(
          0,
          tradeInPaid(order) +
            (creditNow - tradeInCredit(order)) -
            (payoutNow -
              payouts.reduce((n, x) => n + (x.id ? x.wasAmount : 0), 0)),
        );

  /** The subtotal and total the lines on screen add up to. */
  const draftTotals = (o: Order) => {
    const unitsSum = lines
      .filter((l) => l.serial.trim() !== "")
      .reduce((n, l) => n + l.price, 0);
    const countedSum = counted
      .filter((c) => c.skuId !== undefined && c.qty > 0)
      .reduce((n, c) => n + c.price * c.qty, 0);
    const extra = fees.reduce((n, f) => n + f.amount, 0);
    const trade = (o.tradeIns ?? []).reduce((n, x) => n + x.value, 0);
    const bill = unitsSum + countedSum - o.discount + extra;
    // Recorded gross (2026-10-31): the total is the whole bill.
    if (tradeEditable && (isGross(o) || liveTrades.length > 0))
      return { bill, total: bill };
    // A sale from before 2026-10-31 that netted a bigger trade-in to 0 stays
    // netted: it collected nothing, and the bill would make it a debt.
    const legacyNet = trade > 0 && o.total === 0;
    return {
      bill,
      total: legacyNet
        ? Math.max(0, bill - trade)
        : Math.max(0, totalAfterTradeIn(bill, trade)),
    };
  };
  const bill = order
    ? billAfterReturns({ ...order, total: draftTotals(order).total })
    : 0;
  const gross =
    order !== null &&
    tradeEditable &&
    (isGross(order) || liveTrades.length > 0);
  /** What money still has to cover, once the trade-in has paid its part. */
  const moneyBill = gross ? Math.max(0, bill - tradePaidNow) : bill;
  /** The trade-in and the money already in, past the bill: owed back. */
  const settledMoney = payments
    .filter((p) => p.state === "SETTLED")
    .reduce((n, p) => n + p.amount, 0);
  const shopOwes = gross ? Math.max(0, tradePaidNow + settledMoney - bill) : 0;

  const save = () => {
    if (order === null) return;
    // The book, closed over this date (owner ask 2026-09-24). Transaction
    // History already disables the button; this is the writer refusing, so no
    // other door into this dialog can get around it.
    if (isSaleLocked(order, db.settings)) {
      message.error(
        t(
          "editSale.bookClosed",
          "The book is closed over this date. Reopen it on Transaction History first.",
        ),
      );
      return;
    }
    // A unit row with its product picked and no serial used to be dropped on
    // save without a word — which is how an item "disappeared" (owner report
    // 2026-10-22). It is refused instead, and says which.
    const serialless = lines.find(
      (l) => l.serial.trim() === "" && l.skuId !== undefined,
    );
    if (serialless !== undefined) {
      const sku = db.skus.find((k) => k.id === serialless.skuId);
      message.error(
        t("editSale.needsSerial", "Type the serial of {{item}}.", {
          item: sku ? `${sku.name} ${sku.variantLabel}`.trim() : "",
        }),
      );
      return;
    }
    const kept = lines.filter((l) => l.serial.trim() !== "");
    const serials = kept.map((l) => l.serial.trim());
    if (new Set(serials).size !== serials.length) {
      message.error(
        t("editSale.duplicateSerial", "The same serial is on two lines."),
      );
      return;
    }
    const unknown = serials.filter(
      (s) => !db.units.some((u) => u.serial === s),
    );
    if (unknown.length > 0) {
      message.error(
        t("editSale.unknownSerial", "No unit carries {{serial}}.", {
          serial: unknown[0]!,
        }),
      );
      return;
    }
    const gone = lines
      .map((l) => l.was)
      .filter((s) => s !== "" && !serials.includes(s));
    // A unit that has moved on since the sale (returned, held, sold again)
    // cannot simply come off it: its later rows belong to other documents.
    const movedOn = gone.filter(
      (s) => saleRowsOf(db.events, s, order.code) === null,
    );
    if (movedOn.length > 0) {
      message.error(
        t(
          "editSale.unitMovedOn",
          "{{serial}} has moved on since this sale, so it cannot be taken off it here.",
          { serial: movedOn[0]! },
        ),
      );
      return;
    }
    const added = serials.filter((s) => !lines.some((l) => l.was === s));
    const taken = added.filter((s) => {
      const u = db.units.find((x) => x.serial === s);
      return u !== undefined && u.status === "TERJUAL";
    });
    if (taken.length > 0) {
      message.error(
        t("editSale.alreadySold", "{{serial}} is already on another sale.", {
          serial: taken[0]!,
        }),
      );
      return;
    }
    // Only a unit on the shelf can be added here: one in QC, held for a
    // customer, in service or gone back to its supplier belongs to that
    // document first (audit 2026-10-23). The server refuses the same.
    const offShelf = added.filter((s) => {
      const u = db.units.find((x) => x.serial === s);
      return u !== undefined && u.status !== "TERSEDIA";
    });
    if (offShelf.length > 0) {
      message.error(
        t(
          "editSale.notOnShelf",
          "{{serial}} is not on the shelf, so it cannot be added to a sale.",
          { serial: offShelf[0]! },
        ),
      );
      return;
    }

    const countedKept = counted.filter(
      (c) => c.skuId !== undefined && c.qty > 0,
    );
    if (counted.some((c) => c.skuId === undefined && c.qty > 0)) {
      message.error(
        t("editSale.pickProduct", "Pick the product on every accessory line."),
      );
      return;
    }
    if (countedKept.some((c) => c.qty < (c.returnedQty ?? 0))) {
      message.error(
        t(
          "editSale.belowReturned",
          "A line cannot hold fewer pieces than have already come back.",
        ),
      );
      return;
    }
    // More pieces than before have to come off a shelf that holds them.
    const want = new Map<string, number>();
    for (const c of counted) {
      if (c.skuId === undefined) continue;
      const delta = (c.skuId ? Math.max(0, c.qty) : 0) - c.wasQty;
      if (delta > 0) want.set(c.skuId, (want.get(c.skuId) ?? 0) + delta);
    }
    for (const [skuId, qty] of want) {
      if (takeFrom(db.stockMoves, skuId, qty, db.myWarehouseId) === null) {
        const sku = db.skus.find((k) => k.id === skuId);
        message.error(
          t(
            "editSale.notEnoughStock",
            "Not enough {{product}} in stock for {{qty}} more.",
            { product: sku ? `${sku.name} ${sku.variantLabel}` : skuId, qty },
          ),
        );
        return;
      }
    }
    const { total: newTotal } = draftTotals(order);
    // A trade-in whose unit has moved on is a fact other documents stand on.
    const stuck = trades.find(
      (x) =>
        x.wasValue !== undefined &&
        (x.removed || x.line.value !== x.wasValue) &&
        tradeInUnitMovedOn(db, x.line.serial),
    );
    if (stuck !== undefined) {
      message.error(
        t(
          "editSale.tradeInMovedOn",
          "{{serial}} has moved on since it was traded in, so its trade-in cannot change here.",
          { serial: stuck.line.serial ?? stuck.line.label },
        ),
      );
      return;
    }

    const before = paymentsOf(order);
    const refText = ref.trim();
    const stamp = new Date().toISOString();
    mutate((d) => {
      const o = d.orders.find((x) => x.id === order.id);
      if (!o) return;
      o.ts = at.toISOString();
      o.source = source as Order["source"];
      o.customerId = customerId;

      /*
       * The units that left the sale. Their TERJUAL comes OFF (owner decision
       * 2026-09-23) and the unit goes back to whatever its previous event
       * said, which for a sold unit is the shelf it was picked from.
       */
      for (const serial of gone) {
        takeUnitOffSale(d, serial, o.code);
        delete o.prices[serial];
        if (o.listPrices) delete o.listPrices[serial];
      }
      o.serials = serials;
      // Every unit's price is what its line says now — a typo in the amount
      // is corrected here, not with another document.
      for (const l of kept) o.prices[l.serial.trim()] = l.price;
      for (const serial of added) {
        appendEvent(d, serial, {
          type: "TERJUAL",
          toStatus: "TERJUAL",
          refCode: o.code,
        });
      }

      // The counted lines, and their pieces on the stock ledger.
      const staff = currentStaffName();
      const soldCost = (lineId: string) => {
        const m = d.stockMoves.find(
          (x) => x.orderLineId === lineId && x.type === "TERJUAL",
        );
        return m?.cost;
      };
      const nextLines: NonNullable<Order["lines"]> = [];
      for (const c of counted) {
        const id = c.id ?? nextId("ol");
        const skuId = c.skuId;
        const qty = skuId === undefined ? 0 : Math.max(0, c.qty);
        const was = c.wasQty;
        const original = (order.lines ?? []).find((l) => l.id === c.id);
        // A product changed on an existing line is the old pieces back and
        // the new ones out.
        const swapped =
          original !== undefined &&
          skuId !== undefined &&
          original.skuId !== skuId;
        const backQty = swapped ? was : Math.max(0, was - qty);
        const outQty = swapped ? qty : Math.max(0, qty - was);
        if (backQty > 0 && original !== undefined) {
          const home =
            d.stockMoves.find(
              (x) => x.orderLineId === original.id && x.type === "TERJUAL",
            )?.locationId ?? d.myWarehouseId;
          d.stockMoves.push({
            id: nextId("sm"),
            skuId: original.skuId,
            locationId: home,
            qty: backQty,
            cost: soldCost(original.id) ?? averageCost(d, original.skuId),
            type: "KOREKSI",
            at: stamp,
            refCode: o.code,
            orderId: o.id,
            orderLineId: original.id,
            note: `Transaction ${o.code} corrected — ${staff}`,
            staff,
          });
        }
        if (outQty > 0 && skuId !== undefined) {
          const cost = averageCost(d, skuId);
          for (const part of takeFrom(
            d.stockMoves,
            skuId,
            outQty,
            d.myWarehouseId,
          ) ?? []) {
            d.stockMoves.push({
              id: nextId("sm"),
              skuId,
              locationId: part.locationId,
              qty: -part.qty,
              cost,
              type: "TERJUAL",
              at: stamp,
              refCode: o.code,
              orderId: o.id,
              orderLineId: id,
              staff,
            });
          }
        }
        if (qty > 0 && skuId !== undefined) {
          nextLines.push({
            id,
            skuId,
            qty,
            price: c.price,
            ...(c.listPrice !== undefined && !swapped
              ? { listPrice: c.listPrice }
              : {}),
            ...(c.returnedQty ? { returnedQty: c.returnedQty } : {}),
          });
        }
      }
      if (nextLines.length > 0) o.lines = nextLines;
      else delete o.lines;
      // The charges: the rows, their total as `extra` and its label — what
      // the invoice prints (2026-09-01: `extra` is the denormalised total).
      const charges = fees.filter((f) => f.amount > 0);
      if (charges.length > 0) {
        o.fees = charges.map((f) => ({
          ...f,
          label: f.label.trim() || "Extra",
        }));
        o.extra = charges.reduce((n, f) => n + f.amount, 0);
        o.extraNote =
          charges.length === 1 ? o.fees[0]!.label : `${charges.length} charges`;
      } else {
        delete o.fees;
        delete o.extra;
        delete o.extraNote;
      }
      o.total = newTotal;

      /*
       * The trade-ins (2026-10-31). A unit removed goes with its rows — the
       * shop never bought it — and a counted piece goes back off the shelf;
       * a value changed is what the unit cost; one added here is booked as
       * the till books one.
       */
      if (gross) {
        for (const x of trades) {
          if (x.wasValue === undefined) continue;
          const serial = (x.line.serial ?? "").trim().toUpperCase();
          const unit = d.units.find((u) => u.serial === serial);
          if (x.removed) {
            if (unit !== undefined) {
              d.units = d.units.filter((u) => u.serial !== serial);
              d.events = d.events.filter((e) => e.serial !== serial);
            } else if (x.line.skuId && !skuTracksSerial(d, x.line.skuId)) {
              d.stockMoves.push({
                id: nextId("sm"),
                skuId: x.line.skuId,
                locationId: d.myWarehouseId,
                qty: -1,
                cost: x.wasValue,
                type: "KOREKSI",
                at: stamp,
                refCode: o.code,
                orderId: o.id,
                note: `Trade-in removed from ${o.code} — ${staff}`,
                staff,
              });
            }
          } else if (unit !== undefined && x.line.value !== x.wasValue) {
            unit.buy = x.line.value;
          }
        }
        for (const x of trades) {
          if (x.wasValue !== undefined || x.removed) continue;
          bookTradeIn(d, x.line, {
            code: o.code,
            orderId: o.id,
            at: stamp,
            staff,
            nextId,
            appendEvent,
            ensureQcDescription,
            receivedNote: t(
              "pos.ledgerTradeIn",
              "Trade-in on {{code}}: {{label}}",
              { code: o.code, label: x.line.label },
            ),
            qcNote: t("editSale.ledgerTradeInQc", "QC on {{code}}", {
              code: o.code,
            }),
          });
        }
        const kept = trades
          .filter((x) => !x.removed)
          .map(({ line: { qc: _qc, ...rest } }) => ({ ...rest }));
        if (kept.length > 0) o.tradeIns = kept;
        else delete o.tradeIns;
        o.tradeInGross = true;
        // The money handed back: each payout is a real expense.
        for (const x of payouts) {
          if (x.id !== undefined && x.removed) {
            d.expenses = d.expenses.filter((e) => e.id !== x.id);
            continue;
          }
          if (x.removed || x.amount <= 0) continue;
          const fields = {
            amount: x.amount,
            method: x.method,
            ...(x.note.trim() ? { note: x.note.trim() } : {}),
            ...(x.ref.trim() ? { ref: x.ref.trim() } : {}),
          };
          const e = x.id ? d.expenses.find((y) => y.id === x.id) : undefined;
          if (e !== undefined) {
            delete e.note;
            delete e.ref;
            Object.assign(e, fields);
          } else {
            d.expenses.unshift({
              id: nextId("e"),
              kind: TRADE_IN_EXPENSE,
              date: dayjs(stamp).format("YYYY-MM-DD"),
              orderId: o.id,
              createdAt: stamp,
              ...fields,
            });
          }
        }
      }

      // A marketplace part keeps its own number (typed under its method). The
      // sale-level box writes onto the parts only when it is shown; a sale
      // moved off a marketplace (Shopee → Instagram, paid by transfer) keeps
      // no reference anywhere (owner, 2026-10-22).
      const next = payments.map((p) => {
        if (p.channel !== undefined) return p;
        const { ref: _drop, ...rest } = p;
        return saleRefShown && refText !== ""
          ? { ...rest, ref: refText }
          : rest;
      });
      const withTrade = gross
        ? withTradeInPaid(next, tradePaidNow, () =>
            newTradeInPayment(nextId("pay"), stamp),
          )
        : next;
      o.payments = withTrade;
      o.settled = isSettled(billAfterReturns(o), withTrade, refundedOf(o));
      // The deductions under each marketplace payment, into its settlement.
      for (const p of next) {
        if (p.channel === undefined) continue;
        const fees = (deductions[p.id] ?? []).filter((f) => f.amount !== 0);
        const had = d.settlements.some((s) => s.paymentId === p.id);
        if (fees.length === 0 && !had && p.state !== "SETTLED") continue;
        upsertSettlement(
          d,
          {
            paymentId: p.id,
            orderId: o.id,
            channel: p.channel,
            gross: p.amount,
            fees,
            at: p.at,
          },
          { staff: currentStaffName(), nextId },
        );
      }
      for (const row of diffPayments(before, withTrade, {
        at: stamp,
        staff: currentStaffName(),
      })) {
        d.paymentLog.push({ id: nextId("plog"), ...row });
      }
    });
    message.success(t("editSale.saved", "Transaction updated."));
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={980}
      title={t("editSale.title", "Edit transaction — {{code}}", {
        code: order?.code ?? "",
      })}
      okText={t("editSale.save", "Save")}
      onOk={save}
      destroyOnHidden
    >
      <Form layout="vertical">
        <Flex gap={SPACE.md} wrap>
          {saleRefShown && (
            <Form.Item
              label={t("editSale.ref", "Reference ID")}
              style={{ flex: "1 1 220px" }}
            >
              <Input
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder={t(
                  "editSale.refPlaceholder",
                  "The marketplace's order number",
                )}
              />
            </Form.Item>
          )}
          <Form.Item
            label={t("editSale.date", "Date")}
            style={{ flex: "1 1 200px" }}
          >
            <DatePicker
              showTime
              format="DD MMM YYYY HH:mm"
              style={{ width: "100%" }}
              value={at}
              onChange={(d) => d && setAt(d)}
              allowClear={false}
            />
          </Form.Item>
          <Form.Item
            label={t("editSale.channel", "Channel")}
            style={{ flex: "1 1 180px" }}
          >
            <Select<SaleSource>
              value={source}
              onChange={setSource}
              options={SALE_CHANNELS.map((c) => ({
                value: c.value,
                label: t(c.label),
              }))}
            />
          </Form.Item>
          <Form.Item
            label={t("editSale.customer", "Customer")}
            style={{ flex: "1 1 220px" }}
          >
            <Select<string | null>
              showSearch
              allowClear
              optionFilterProp="label"
              value={customerId}
              onChange={(v) => setCustomerId(v ?? null)}
              placeholder={t("piutang.walkIn", "Walk-in")}
              options={db.customers.map((c) => ({
                value: c.id,
                label: customerLine(c),
              }))}
            />
          </Form.Item>
        </Flex>
      </Form>

      <Divider style={{ marginTop: 0 }}>{t("editSale.items", "Items")}</Divider>

      {/*
       * One table for everything on the sale (owner ask 2026-10-22: *"item
       * name first, then serial or qty"*). A unit tracked by serial asks for
       * its serial; an accessory (a counted product — a MagSafe, a charger)
       * asks for a quantity, and its price is per piece. Picking a product
       * decides which the row is.
       */}
      <Table<ItemRow>
        size="small"
        rowKey="key"
        dataSource={itemRows}
        pagination={false}
        columns={[
          {
            title: t("editSale.item", "Item"),
            key: "item",
            render: (_, r) => (
              <Select<string>
                size="small"
                showSearch
                optionFilterProp="label"
                style={{ width: "100%" }}
                value={r.kind === "new" ? undefined : r.skuId}
                aria-label={t("editSale.itemFor", "Item")}
                placeholder={t("editSale.pickItem", "Pick an item")}
                options={itemOptions}
                onChange={(v) => pickItem(r, v)}
              />
            ),
          },
          {
            title: t("editSale.serialOrQty", "Serial / Qty"),
            key: "serial",
            width: COLUMN.serial + 40,
            render: (_, r) =>
              r.kind === "unit" ? (
                <Input
                  size="small"
                  style={{ textTransform: "uppercase" }}
                  defaultValue={r.line.serial}
                  key={r.line.serial}
                  placeholder={t("editSale.serialPlaceholder", "Serial number")}
                  aria-label={t("editSale.serialFor", "Serial number")}
                  onBlur={(e) => commitSerial(r.line, e.target.value)}
                  onPressEnter={(e) =>
                    commitSerial(r.line, (e.target as HTMLInputElement).value)
                  }
                />
              ) : r.kind === "counted" ? (
                <InputNumber<number>
                  size="small"
                  min={1}
                  precision={0}
                  value={r.line.qty}
                  addonAfter={t("editSale.pcs", "pcs")}
                  aria-label={t("editSale.qtyFor", "Quantity")}
                  onChange={(v) => setCount(r.line.key, { qty: v ?? 1 })}
                  style={{ width: "100%" }}
                />
              ) : (
                <Typography.Text type="secondary">
                  {t("editSale.pickItemFirst", "Pick the item first")}
                </Typography.Text>
              ),
          },
          {
            title: t("editSale.price", "Price"),
            key: "price",
            width: COLUMN.moneyInput + 40,
            render: (_, r) =>
              r.kind === "new" ? null : (
                <Flex vertical gap={0}>
                  <MoneyInput
                    value={r.line.price}
                    aria-label={
                      r.kind === "counted"
                        ? t("editSale.piecePriceFor", "Price per piece")
                        : t("editSale.priceFor", "Price")
                    }
                    onChange={(v) =>
                      r.kind === "counted"
                        ? setCount(r.line.key, { price: v ?? 0 })
                        : setLine(r.line.key, { price: v ?? 0 })
                    }
                  />
                  {r.kind === "counted" && r.line.qty > 1 && (
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: TYPE.sm }}
                    >
                      {t("editSale.lineTotal", "{{qty}} × = {{total}}", {
                        qty: r.line.qty,
                        total: fmtRp(r.line.qty * r.line.price),
                      })}
                    </Typography.Text>
                  )}
                </Flex>
              ),
          },
          {
            title: "",
            key: "remove",
            width: COLUMN.action,
            render: (_, r) => (
              <Button
                type="text"
                icon={<DeleteOutlined />}
                aria-label={t("editSale.removeItem", "Take this item off")}
                onClick={() => removeItem(r)}
              />
            ),
          },
        ]}
      />
      <Button
        size="small"
        icon={<PlusOutlined />}
        style={{ marginTop: SPACE.sm }}
        onClick={() =>
          setFresh((rows) => [...rows, `n-${rows.length}-${Date.now()}`])
        }
      >
        {t("editSale.addItem", "Add an item")}
      </Button>
      {lines.some((l) => l.was !== "" && l.was !== l.serial) && (
        <Typography.Text
          type="warning"
          style={{ display: "block", marginTop: SPACE.sm, fontSize: TYPE.sm }}
        >
          {t(
            "editSale.swapWarning",
            "A unit taken off goes back on the shelf, and this sale leaves its timeline.",
          )}
        </Typography.Text>
      )}

      <Divider>{t("editSale.charges", "Additional charges")}</Divider>
      {fees.map((f, i) => (
        <Flex key={f.id} gap={SPACE.sm} style={{ marginBottom: SPACE.xs }}>
          <Input
            size="small"
            value={f.label}
            placeholder={t("editSale.chargeName", "Charge, e.g. Delivery")}
            aria-label={t("editSale.chargeNameFor", "Charge name")}
            onChange={(e) =>
              setFees((rows) =>
                rows.map((x, j) =>
                  j === i ? { ...x, label: e.target.value } : x,
                ),
              )
            }
          />
          <MoneyInput
            value={f.amount}
            aria-label={t("editSale.chargeAmountFor", "Charge amount")}
            style={{ width: 200 }}
            onChange={(v) =>
              setFees((rows) =>
                rows.map((x, j) => (j === i ? { ...x, amount: v ?? 0 } : x)),
              )
            }
          />
          <Button
            size="small"
            type="text"
            icon={<DeleteOutlined />}
            aria-label={t("editSale.removeCharge", "Remove charge")}
            onClick={() => setFees((rows) => rows.filter((_, j) => j !== i))}
          />
        </Flex>
      ))}
      <Button
        size="small"
        icon={<PlusOutlined />}
        onClick={() =>
          setFees((rows) => [
            ...rows,
            { id: nextId("fee"), label: "", amount: 0 },
          ])
        }
      >
        {t("editSale.addCharge", "Add a charge")}
      </Button>
      <Typography.Text
        strong
        style={{ display: "block", marginTop: SPACE.sm, textAlign: "right" }}
      >
        {t("editSale.newTotal", "Total {{total}}", { total: fmtRp(bill) })}
      </Typography.Text>
      {lines.some((l) => l.was !== "" && l.was !== l.serial) && (
        <Typography.Text
          type="warning"
          style={{ display: "block", marginTop: SPACE.sm, fontSize: TYPE.sm }}
        >
          {t(
            "editSale.swapWarning",
            "A unit taken off goes back on the shelf, and this sale leaves its timeline.",
          )}
        </Typography.Text>
      )}

      {tradeEditable ? (
        <>
          <Divider>{t("editSale.tradeIns", "Trade-in")}</Divider>
          {trades
            .filter((x) => !x.removed)
            .map((x) => {
              const moved =
                x.wasValue !== undefined &&
                tradeInUnitMovedOn(db, x.line.serial);
              const counted =
                !!x.line.skuId && !skuTracksSerial(db, x.line.skuId);
              return (
                <Flex
                  key={x.key}
                  gap={SPACE.sm}
                  align="center"
                  style={{ marginBottom: SPACE.xs }}
                >
                  <Typography.Text style={{ flex: 1 }}>
                    {x.line.label}
                    {x.line.serial ? ` · ${x.line.serial}` : ""}
                  </Typography.Text>
                  <MoneyInput
                    value={x.line.value}
                    disabled={moved || (counted && x.wasValue !== undefined)}
                    aria-label={t("editSale.tradeInValue", "Trade-in value")}
                    style={{ width: COLUMN.moneyInput }}
                    onChange={(v) =>
                      setTrades((rows) =>
                        rows.map((y) =>
                          y.key === x.key
                            ? { ...y, line: { ...y.line, value: v ?? 0 } }
                            : y,
                        ),
                      )
                    }
                  />
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={moved}
                    aria-label={t(
                      "editSale.removeTradeIn",
                      "Remove trade-in {{label}}",
                      { label: x.line.label },
                    )}
                    onClick={() =>
                      setTrades((rows) =>
                        x.wasValue === undefined
                          ? rows.filter((y) => y.key !== x.key)
                          : rows.map((y) =>
                              y.key === x.key ? { ...y, removed: true } : y,
                            ),
                      )
                    }
                  />
                </Flex>
              );
            })}
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setTradeOpen(true)}
          >
            {t("editSale.addTradeIn", "Add a trade-in")}
          </Button>
          {gross && (
            <>
              <Typography.Text
                strong
                style={{ display: "block", marginTop: SPACE.md }}
              >
                {t("editSale.payouts", "Paid to the customer")}
              </Typography.Text>
              {payouts
                .filter((x) => !x.removed)
                .map((x) => (
                  <Flex
                    key={x.key}
                    gap={SPACE.sm}
                    align="center"
                    wrap
                    style={{ marginTop: SPACE.xs }}
                  >
                    <Segmented<"TUNAI" | "TRANSFER">
                      size="small"
                      value={x.method}
                      options={[
                        { value: "TUNAI", label: t("pos.methodCash", "Cash") },
                        {
                          value: "TRANSFER",
                          label: t("pos.methodTransfer", "Transfer"),
                        },
                      ]}
                      onChange={(m) =>
                        setPayouts((rows) =>
                          rows.map((y) =>
                            y.key === x.key ? { ...y, method: m } : y,
                          ),
                        )
                      }
                    />
                    <MoneyInput
                      value={x.amount}
                      aria-label={t("editSale.payoutAmount", "Amount paid")}
                      style={{ width: COLUMN.moneyInput }}
                      onChange={(v) =>
                        setPayouts((rows) =>
                          rows.map((y) =>
                            y.key === x.key ? { ...y, amount: v ?? 0 } : y,
                          ),
                        )
                      }
                    />
                    <Input
                      value={x.note}
                      aria-label={t("pos.payoutTo", "Paid to")}
                      placeholder={t("pos.payoutTo", "Paid to")}
                      style={{ flex: "1 1 160px" }}
                      onChange={(e) =>
                        setPayouts((rows) =>
                          rows.map((y) =>
                            y.key === x.key
                              ? { ...y, note: e.target.value }
                              : y,
                          ),
                        )
                      }
                    />
                    <Input
                      value={x.ref}
                      aria-label={t("pos.payoutRef", "Transfer reference")}
                      placeholder={t("pos.payoutRef", "Transfer reference")}
                      style={{ flex: "1 1 140px" }}
                      onChange={(e) =>
                        setPayouts((rows) =>
                          rows.map((y) =>
                            y.key === x.key ? { ...y, ref: e.target.value } : y,
                          ),
                        )
                      }
                    />
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={t("editSale.removePayout", "Remove payout")}
                      onClick={() =>
                        setPayouts((rows) =>
                          x.id === undefined
                            ? rows.filter((y) => y.key !== x.key)
                            : rows.map((y) =>
                                y.key === x.key ? { ...y, removed: true } : y,
                              ),
                        )
                      }
                    />
                  </Flex>
                ))}
              <Button
                size="small"
                icon={<PlusOutlined />}
                style={{ marginTop: SPACE.xs }}
                onClick={() =>
                  setPayouts((rows) => [
                    ...rows,
                    {
                      key: nextId("po"),
                      id: undefined,
                      amount: shopOwes,
                      method: "TRANSFER",
                      note: "",
                      ref: "",
                      wasAmount: 0,
                      removed: false,
                    },
                  ])
                }
              >
                {t("editSale.addPayout", "Add money paid to the customer")}
              </Button>
              <Typography.Text
                type="secondary"
                style={{
                  display: "block",
                  marginTop: SPACE.sm,
                  fontSize: TYPE.sm,
                }}
              >
                {t(
                  "editSale.tradeInPays",
                  "The trade-in pays {{paid}} of the bill.",
                  { paid: fmtRp(tradePaidNow) },
                )}
              </Typography.Text>
              {shopOwes > 0 && (
                <Typography.Text
                  type="warning"
                  style={{ display: "block", fontSize: TYPE.sm }}
                >
                  {t(
                    "editSale.shopOwes",
                    "The shop still owes the customer {{amount}} — record it above.",
                    { amount: fmtRp(shopOwes) },
                  )}
                </Typography.Text>
              )}
            </>
          )}
          <TradeInDialog
            open={tradeOpen}
            db={db}
            onCancel={() => setTradeOpen(false)}
            onAdd={(draft) => {
              const id = nextId("ti");
              setTrades((rows) => [
                ...rows,
                {
                  key: id,
                  line: { id, ...draft },
                  wasValue: undefined,
                  removed: false,
                },
              ]);
              setTradeOpen(false);
            }}
          />
        </>
      ) : (order?.tradeIns ?? []).length > 0 ? (
        <Typography.Text
          type="secondary"
          style={{ display: "block", marginTop: SPACE.sm, fontSize: TYPE.sm }}
        >
          {t(
            "editSale.tradeInLegacy",
            "This sale's trade-in was recorded before 31 Oct 2026 and is left as it was written.",
          )}
        </Typography.Text>
      ) : null}

      <Divider>{t("editSale.payment", "Payment")}</Divider>

      <PaymentsPanel
        orderId={order?.id ?? ""}
        total={moneyBill}
        value={payments}
        onChange={setPayments}
        deductions={deductions}
        onDeductionsChange={setDeductionsOf}
      />
    </Modal>
  );
}
