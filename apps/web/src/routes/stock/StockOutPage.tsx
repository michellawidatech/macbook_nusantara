/**
 * The till. Sells specific serials, takes the money, and records what was
 * negotiated to get there.
 *
 * A sale can start from nothing or from a reservation. Starting from a
 * reservation is the common case for anything sold over chat: the unit and the
 * customer were agreed days ago, so re-picking them here is re-doing work the
 * shop already did — and re-doing it is where the wrong serial gets sold.
 *
 * ## ONE screen, since 2026-08-27 (owner revision)
 *
 * It was three wizard steps, then two, and is now none: the till is the whole
 * page. The owner's rule is unchanged — *the design should accommodate rapid
 * and lots of new transactions*.
 *
 * ## The 2026-09-01 reshape (owner ask)
 *
 * Three things moved, and they all move in the same direction: the RIGHT pane
 * becomes the sale, and everything that is not the sale goes below it.
 *
 * 1. **The right pane is what is being sold and what it costs.** The basket,
 *    the suggestions that go with it, and the money — nothing else. It is
 *    `position: sticky`, so scrolling a long catalogue on the left no longer
 *    scrolls the total out of sight, and the total panel is pinned to the
 *    BOTTOM of that pane rather than merely being last in it.
 * 2. **A collapsible *Payment detail* section** below the till holds
 *    everything the basket used to carry — discount, trade-in, extra charge,
 *    channel, payment method — plus the customer and attribution fields that
 *    were already down there. One place for "how is this being paid and by
 *    whom", folded shut, because the commonest sale in the shop answers none
 *    of it.
 * 3. **Margin comes off the line and into a dialog.** A live percentage beside
 *    every price was the shop's cost on screen whenever a customer could see
 *    it. The eye button opens the same figures — see `LineDetail`.
 *
 * ## What a negotiated price now records
 *
 * The subtotal is the LIST price and the negotiation is its own line: a
 * *bargain* when a machine goes out under the asking price, an *upsell* when
 * it goes out over. `lib/pos.ts` owns the arithmetic, `Order.listPrices` keeps
 * the snapshot both figures are derived from, and Settings → Salespeople reads
 * the upsell half.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  App,
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Flex,
  Form,
  Input,
  Modal,
  Result,
  Select,
  Table,
  Tag,
  theme,
  Tooltip,
  Typography,
} from "antd";
import {
  ArrowLeftOutlined,
  ArrowUpOutlined,
  PrinterOutlined,
  PlusOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EyeOutlined,
  GiftOutlined,
  ShoppingCartOutlined,
  SwapOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { GradeTag } from "../../components/GradeTag";
import { ProTable } from "../../components/ProTable";
import { MoneyInput } from "../../components/MoneyInput";
import { InvoiceModal } from "../../components/Invoice";
import { fmtRp, fmtDate, fmtDateTime } from "../../lib/format.js";
import {
  BATTERY_GRADE_COLOR,
  batteryGrade,
  fmtBatteryHealth,
  thresholdsFrom,
} from "../../lib/battery.js";
import {
  bundleProgress,
  describeDiscount,
  fitAllDiscounts,
  unusedBundles,
  type BasketLine,
  type DiscountBlocker,
  type DiscountFit,
} from "../../lib/pricing.js";
import {
  saleTotals,
  shelfCategories,
  shelfRows,
  type TradeInLine,
} from "../../lib/pos.js";
import { describeDiscountText } from "../../lib/discountText.js";
import {
  recommendFor,
  type SignalKey,
  type WhyReason,
} from "../../lib/recommend.js";
import {
  activeHolds,
  heldItems,
  reprojectHolds,
} from "../../lib/reservations.js";
import {
  ADDRESS_FIELDS,
  composeAddress,
  EMPTY_ADDRESS,
  missingAddressParts,
  type AddressParts,
} from "../../lib/address.js";
import {
  useDb,
  mutate,
  nextId,
  docCode,
  appendEvent,
  purgeQcPhotos,
} from "../../mock/store.js";
import {
  SALE_CHANNELS,
  holdsFunds,
  marketplacePayMethod,
  channelOf,
  type SaleSource,
} from "../../lib/channels.js";
import { gradeForCondition } from "../../lib/condition.js";
import { resolveScannedSerial } from "../../lib/serialScan.js";
import { useScanTarget } from "../../hooks/useScanTarget.js";
import { useLayoutMode } from "../../layouts/useLayoutMode.js";
import { TradeInDialog } from "./TradeInDialog.js";
import type { Order, OrderFee } from "../../mock/seed.js";
import { useTranslation } from "react-i18next";

interface Line {
  serial?: string;
  /** What this customer is being charged. Undefined means "the list price". */
  price?: number;
}

/**
 * A reservation's channel maps onto the sale's channel where the two mean the
 * same thing. Anything else (a walk-in under another name, a channel the till
 * does not record sales against) leaves the sale source alone rather than
 * guessing.
 *
 * Keyed on the reservation source's NAME because that list is a Settings
 * table — a new marketplace is a row staff add, not a deploy — so there is no
 * id to match on that would survive them renaming it.
 */
const SOURCE_BY_RESERVATION: Record<string, SaleSource> = {
  Instagram: "INSTAGRAM",
  WhatsApp: "WHATSAPP",
  Shopee: "SHOPEE",
  Tokopedia: "TOKOPEDIA",
  TikTok: "TIKTOK",
  "Walk-in": "OFFLINE",
};

/** What a discount's shape is called on screen. */
const DISCOUNT_KIND: Record<string, string> = {
  PCT: "Percentage",
  NOMINAL: "Amount",
  BUNDLE: "Bundle",
};

/**
 * What an extra charge can be for (owner ask 2026-09-01).
 *
 * The charge used to be a free-text box, and free text is how one shop ends up
 * with "ongkir", "Ongkir", "delivery" and "kirim" as four different things in
 * a report. These are the shop's own categories, offered as a list that can
 * still be typed into — a charge nobody anticipated is a real thing, and
 * refusing it would send the cashier back to putting it in the note.
 *
 * They are the English labels and therefore their own catalogue keys, exactly
 * as `SALE_CHANNELS` is — `t()` runs at the render site below.
 */
const EXTRA_CATEGORIES = [
  "Shipping",
  "Shopping bag",
  "Installation",
  "Extended warranty",
  "Data transfer",
] as const;

/**
 * How much of the pane's height the totals panel may take before the basket
 * above it starts scrolling instead.
 *
 * The whole right column is `position: sticky` and bounded by the viewport, so
 * something has to give when a basket runs to fifteen machines. What gives is
 * the basket — it scrolls inside its own box — because the totals are the one
 * thing on this screen that must never require a scroll to read.
 */
const STICKY_INSET = 24;

/**
 * How many suggestions the basket shows before "See more" (owner ask
 * 2026-09-01).
 *
 * Three, because the panel it sits in is the sale: the basket above it and the
 * total below it are what the cashier is working on, and a suggestion list
 * long enough to push either off the screen has stopped being a suggestion.
 * `lib/recommend.ts` already caps its own output per kind — this is the
 * further trim to what fits beside a customer waiting.
 */
const SUGGESTIONS_SHOWN = 3;

/**
 * One row of the discount picker: what the code is, what it is worth here, and
 * — when it is not usable — what would make it usable.
 *
 * A blocker is rendered from its tagged shape rather than from a sentence the
 * pricing module made up, because that module has no `t()` in scope. See
 * `DiscountBlocker`.
 */
function DiscountRow({
  fit,
  selected,
  onPick,
}: {
  fit: DiscountFit;
  selected: boolean;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  const {
    token: {
      colorBorderSecondary,
      colorPrimary,
      colorPrimaryBg,
      colorTextDisabled,
      borderRadius,
    },
  } = theme.useToken();
  const d = fit.discount;

  const say = (b: DiscountBlocker): string => {
    switch (b.kind) {
      case "INACTIVE":
        return t(
          "pos.blockInactive",
          "Switched off. Turn it back on under Discounts.",
        );
      case "NOT_STARTED":
        return t("pos.blockNotStarted", "Does not start until {{date}}.", {
          date: fmtDate(b.date),
        });
      case "ENDED":
        return t("pos.blockEnded", "Ended on {{date}}.", {
          date: fmtDate(b.date),
        });
      case "USED_UP":
        return t(
          "pos.blockUsedUp",
          "All {{limit}} uses have been claimed. Raise the limit under Discounts.",
          { limit: b.limit },
        );
      case "EMPTY_BASKET":
        return t(
          "pos.blockEmptyBasket",
          "Add a unit to the sale first — a discount needs something to come off.",
        );
      case "OUT_OF_SCOPE":
        return t(
          "pos.blockOutOfScope",
          "Nothing on this sale is from “{{scope}}”. Add one and it applies.",
          { scope: b.scope },
        );
      case "BUNDLE_SHORT":
        return t(
          "pos.blockBundleShort",
          "Add {{need}} more unit(s) from “{{scope}}” to complete the bundle.",
          { need: b.need, scope: b.scope },
        );
      case "NO_SAVING":
        return t(
          "pos.blockNoSaving",
          "It applies, but it comes to nothing on this basket.",
        );
    }
  };

  return (
    <button
      type="button"
      // A real button, not a clickable div: an ineligible code has to be
      // reachable by a screen reader and skipped by the Tab key in the same
      // breath, and `disabled` is the one attribute that does both.
      disabled={!fit.eligible}
      aria-pressed={selected}
      onClick={onPick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "start",
        padding: "8px 12px",
        borderRadius,
        border: `1px solid ${selected ? colorPrimary : colorBorderSecondary}`,
        background: selected ? colorPrimaryBg : "transparent",
        cursor: fit.eligible ? "pointer" : "not-allowed",
        // Greyed, not hidden. The row still has to be readable — the sentence
        // under it is the whole point of showing it.
        opacity: fit.eligible ? 1 : 0.55,
        font: "inherit",
        color: "inherit",
      }}
    >
      <Flex justify="space-between" align="flex-start" gap={12} wrap>
        <Flex vertical gap={2} style={{ minWidth: 0 }}>
          <Flex gap={8} align="center" wrap>
            <strong>{d.code}</strong>
            <Tag>{t(DISCOUNT_KIND[d.type] ?? d.type)}</Tag>
            <Typography.Text type="secondary">
              {describeDiscountText(describeDiscount(d), t)}
            </Typography.Text>
          </Flex>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {d.name} · {d.scope || t("pos.allProducts", "All products")}
          </Typography.Text>
          {fit.blockers.map((b) => (
            <Typography.Text
              key={b.kind}
              style={{ fontSize: 12, color: colorTextDisabled }}
            >
              {say(b)}
            </Typography.Text>
          ))}
        </Flex>
        {fit.eligible && (
          <Typography.Text type="success" strong>
            −{fmtRp(fit.saving)}
          </Typography.Text>
        )}
      </Flex>
    </button>
  );
}

export function StockOutPage() {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();
  const { compact } = useLayoutMode();
  const [params, setParams] = useSearchParams();
  const [lines, setLines] = useState<Line[]>([
    { serial: params.get("serial") ?? undefined },
  ]);
  const [customerId, setCustomerId] = useState<string>();
  /**
   * The discount, as a code and nothing else (owner revision 2026-09-01).
   *
   * The picker used to also offer a free percentage and a free amount, and
   * both are gone at the owner's ask. They were a second way of doing what a
   * discount code does, with none of what a code carries — no name on the
   * receipt, no window, no usage limit, nothing for the discount report to
   * group by. A price agreed at the counter is now a *bargain* on the line it
   * was agreed on, which is what it always actually was.
   */
  const [discountId, setDiscountId] = useState<string>();
  const [source, setSource] = useState<SaleSource>("OFFLINE");
  const [referralId, setReferralId] = useState<string>();
  const [shipped, setShipped] = useState(false);
  /**
   * The shipping address, held in parts and composed on submit.
   *
   * `lib/address.ts` explains why: the order stores one line, but asking for
   * one line is how half of them arrived without a postcode.
   */
  const [address, setAddress] = useState<AddressParts>(EMPTY_ADDRESS);
  /**
   * A saved address of the chosen customer, when one was picked from the
   * dropdown (owner ask 2026-09-01). Held as the composed line rather than
   * parsed back into parts: `composeAddress` is one-way, and guessing which
   * comma was the kecamatan is exactly the mess the parts form exists to end.
   */
  const [savedAddressId, setSavedAddressId] = useState<string>();
  const [payMethod, setPayMethod] = useState("Cash");
  const [salesmanId, setSalesmanId] = useState<string>();
  /**
   * Which of the till's two steps is on screen (owner revision 2026-09-01).
   *
   * It was a collapsible *Payment detail* accordion under the catalogue, and
   * the owner's verdict was that the collapsing was the problem rather than
   * the placement: *"instead of drop down of payment detail I think after the
   * 1st page we can just redirect to the payment detail"*. Six sections that
   * each have to be opened is six decisions about what to look at before any
   * of them can be answered.
   *
   * So it is two steps, and the RIGHT pane is on both. `PRODUCTS` is the
   * catalogue and the basket; `PAYMENT` swaps the catalogue for every
   * remaining field, all of them open, with the same sale still visible beside
   * them. Not a wizard — the sale can be finished from either step, and *Go
   * back to products* is one click.
   */
  const [step, setStep] = useState<"PRODUCTS" | "PAYMENT">("PRODUCTS");
  /** Scroll target, so moving between steps starts at the top. */
  const detailsRef = useRef<HTMLDivElement>(null);
  const goToPayment = () => {
    setStep("PAYMENT");
    /*
     * After the section has rendered — a ref cannot be scrolled to before the
     * node exists.
     *
     * Feature-checked, not just null-checked. `scrollIntoView` is absent in
     * jsdom and in a couple of older mobile browsers, and this is decoration:
     * the step has already changed by the time it runs, so throwing here would
     * cost the user nothing except an error in the console. The test suite
     * caught exactly that.
     */
    requestAnimationFrame(() => {
      const node = detailsRef.current;
      if (typeof node?.scrollIntoView === "function") {
        node.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  };
  const [shelfQuery, setShelfQuery] = useState("");
  /** The catalogue's category chip. Undefined is "Semua". */
  const [category, setCategory] = useState<string>();
  /**
   * Which variant's serials are being chosen between.
   *
   * The chooser opens whenever there is a CHOICE (owner answer 2026-08-27) —
   * grade, battery and shelf are worth reading before a particular second-hand
   * laptop goes out of the door. When one machine is all that is left of a
   * variant there is nothing to choose, so tapping the row puts that machine
   * straight in the basket (owner revision 2026-08-27) — see `pickFromRow`.
   */
  const [pickingSku, setPickingSku] = useState<string>();
  /**
   * The charges the shop is adding on top (owner ask 2026-09-01: *"additional
   * fee could be more than 1"*).
   *
   * A list, because shipping and a shopping bag are two different things on
   * one receipt. Each row carries its own category and amount; `saleTotals`
   * sums them and `Order.fees` stores the breakdown.
   */
  const [fees, setFees] = useState<OrderFee[]>([]);
  const addFee = () =>
    setFees((prev) => [...prev, { id: nextId("fee"), label: "", amount: 0 }]);
  const setFee = (id: string, patch: Partial<OrderFee>) =>
    setFees((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const dropFee = (id: string) =>
    setFees((prev) => prev.filter((f) => f.id !== id));
  /** Fees worth charging for: named or not, they have to be worth something. */
  const liveFees = fees.filter((f) => f.amount > 0);
  /** How many suggestions are shown before "See more". */
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  /** Machines taken in against the bill. See `TradeInDialog`. */
  const [tradeIns, setTradeIns] = useState<TradeInLine[]>([]);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  /** The basket line whose price breakdown is open — the eye button. */
  const [inspecting, setInspecting] = useState<number | null>(null);
  /**
   * Whether the "record this sale?" dialog is open (owner ask 2026-09-01).
   *
   * This replaces the two-press dance a below-cost line used to require —
   * press once for a warning toast, press again to mean it. That worked and
   * was easy to miss: the warning was a toast, and the second press looked
   * exactly like the first. The dialog states the same fact where it cannot
   * be scrolled past, and a sale is a thing worth confirming whether or not
   * anything is under cost.
   */
  const [confirming, setConfirming] = useState(false);
  /**
   * The sale that was just written, held so the page can say so.
   *
   * Separate from `invoiceFor` because they answer different questions: this
   * is "it is recorded, here is its number", and that is "here is the paper".
   * One is always shown and the other is offered.
   */
  const [recorded, setRecorded] = useState<Order | null>(null);
  const thresholds = thresholdsFrom(db.settings);
  /**
   * The sale that was just recorded, held only so its invoice can be offered.
   * Cleared when the modal closes — the order itself lives in the store, and
   * keeping a second copy around after the print would be two sources of truth
   * for one receipt.
   */
  const [invoiceFor, setInvoiceFor] = useState<Order | null>(null);
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [reservationPickerOpen, setReservationPickerOpen] = useState(false);
  /**
   * The catalogue as a dialog, on a phone (owner ask 2026-09-01).
   *
   * Never opened on a desktop, where the catalogue is a column. `compact` is
   * what decides which of the two the page renders — see `mobileLayout`.
   */
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  /** Reservations this sale is fulfilling, so submitting can close them. */
  const [fromReservations, setFromReservations] = useState<string[]>([]);
  const [ncForm] = Form.useForm<{ name: string; phone: string }>();

  const sellable = useMemo(
    () =>
      db.units.filter(
        (u) => u.status === "TERSEDIA" || u.status === "DIRESERVASI",
      ),
    [db.units],
  );
  const activeReservations = useMemo(() => activeHolds(db), [db]);

  const skuOf = (serial?: string) =>
    db.skus.find(
      (s) => s.id === db.units.find((u) => u.serial === serial)?.skuId,
    );
  const customer = db.customers.find((c) => c.id === customerId);

  /**
   * Fill the form from one or more reservations: the units become the lines,
   * the customer becomes the sale's customer, and the reservation's channel
   * becomes the sale's channel where the two agree. Prices are left to autofill
   * from the unit, exactly as a hand-picked line does.
   *
   * Prefill only ever *fills blanks*. If the operator already picked a customer
   * it is not overwritten — a prefill that clobbers a deliberate choice is
   * worse than no prefill.
   */
  const applyReservations = (ids: string[], only?: readonly string[]) => {
    const picked = db.reservations.filter((r) => ids.includes(r.id));
    if (!picked.length) return;
    // A hold can be collected in pieces (owner decision 2026-08-26), so the
    // caller may name which machines are being taken. Naming none takes
    // everything still on hold, which is what "sell this reservation" means.
    const wanted = only ? new Set(only) : null;
    const serials = picked.flatMap((r) =>
      heldItems(db, r)
        .filter((i) => !wanted || wanted.has(i.serial))
        .map((i) => i.serial),
    );
    if (serials.length === 0) {
      message.info(
        t(
          "pos.nothingLeftOnHold",
          "Nothing on that reservation is still being held.",
        ),
      );
      return;
    }
    setLines((prev) => {
      const kept = prev.filter((l) => l.serial && !serials.includes(l.serial));
      return [...kept, ...serials.map((serial) => ({ serial }))];
    });
    setCustomerId((prev) => prev ?? picked[0]!.customerId);
    const channel = db.reservationSources.find(
      (s) => s.id === picked[0]!.sourceId,
    )?.name;
    const mapped = channel ? SOURCE_BY_RESERVATION[channel] : undefined;
    if (mapped) setSource((prev) => (prev === "OFFLINE" ? mapped : prev));
    setFromReservations((prev) => [
      ...new Set([...prev, ...picked.map((r) => r.id)]),
    ]);
    setReservationPickerOpen(false);
    message.success(
      t("pos.loadedFromHold", "Loaded {{count}} unit(s) from {{code}}.", {
        count: serials.length,
        code: picked.map((r) => r.code).join(", "),
      }),
    );
  };

  // Arriving from the Reservations page's "sell this now" button. The param is
  // cleared once consumed so a refresh does not re-apply it over later edits.
  const reservationParam = params.get("reservation");
  // Which machines out of that hold. Absent means all of them — see
  // `applyReservations`. The Reservations page sends this when the operator
  // ticked some but not all of a batch.
  const reservationSerials = params.get("serials");
  useEffect(() => {
    if (!reservationParam) return;
    applyReservations(
      [reservationParam],
      reservationSerials ? reservationSerials.split(",") : undefined,
    );
    const next = new URLSearchParams(params);
    next.delete("reservation");
    next.delete("serials");
    setParams(next, { replace: true });
    // Runs once per distinct incoming id; `applyReservations` reads fresh state
    // through the setter callbacks above rather than closing over it.
  }, [reservationParam]);

  /**
   * What this serial is LISTED at — the price of its variant, since
   * 2026-08-27.
   *
   * The per-line override is a different thing entirely and is what makes a
   * bargain: this is what the shop asks, and the override is what it settled
   * for once, on this sale, with this customer.
   */
  const priceOf = (serial?: string) => skuOf(serial)?.price ?? undefined;

  /**
   * The basket, resolved to the prices that will actually be charged.
   *
   * Bundle discounts need to know WHICH units are being bought, not merely what
   * they add up to, so the basket — not the subtotal — is what the pricing
   * rules are handed.
   */
  const basket: BasketLine[] = useMemo(
    () =>
      lines
        .filter((l) => l.serial)
        .map((l) => ({
          serial: l.serial!,
          price: l.price ?? priceOf(l.serial) ?? 0,
        })),
    // `db.skus` as well as `db.units`: an un-overridden line is priced through
    // `priceOf` → `skuOf` → `db.skus`, so a variant repriced on the Products
    // page while this sale is open must reach the basket. Without it the
    // basket, the discount fits, the suggestions and the totals all go on
    // quoting the old asking price. `totals` below already lists both.
    [lines, db.units, db.skus],
  );
  const rule = db.discounts.find((x) => x.id === discountId);

  /**
   * Every discount the shop has, scored against this basket.
   *
   * All of them, eligible or not (owner decision 2026-08-26) — see
   * `fitAllDiscounts`. The picker below renders this list directly, so what is
   * on screen and what the till would actually charge come from one
   * calculation rather than two that can disagree.
   */
  const fits = useMemo(() => fitAllDiscounts(db, basket), [db, basket]);
  const chosenFit = fits.find((f) => f.discount.id === discountId);
  // The FIT's saving, not `discountAmount`'s: the fit is zero when the code is
  // blocked, and it can be blocked for reasons the arithmetic never looks at —
  // an expired date, a used-up limit. A basket still holding a selection whose
  // window closed while the sale was open must charge full price rather than
  // honour it silently.
  const discountValue = chosenFit?.saving ?? 0;

  /**
   * The whole sale's arithmetic, in `lib/pos.ts` rather than here.
   *
   * The list prices go in alongside the charged ones since 2026-09-01, which
   * is what lets the subtotal stay the shop's own price list while the total
   * follows what was actually agreed.
   */
  const totals = useMemo(
    () =>
      saleTotals({
        prices: basket.map((l) => l.price),
        listPrices: basket.map((l) => priceOf(l.serial) ?? l.price),
        costs: basket.map(
          (l) => db.units.find((u) => u.serial === l.serial)?.buy ?? 0,
        ),
        discount: discountValue,
        extra: liveFees,
        tradeIns,
      }),
    [basket, db.units, db.skus, discountValue, liveFees, tradeIns],
  );
  const total = totals.total;

  /** The catalogue, and the chips above it. */
  const catalogue = useMemo(
    () =>
      shelfRows(db, {
        query: shelfQuery,
        category,
        taken: lines.map((l) => l.serial).filter(Boolean) as string[],
      }),
    [db, shelfQuery, category, lines],
  );
  /** Chips come from ALL sellable stock, so they do not vanish as you filter. */
  const categories = useMemo(() => shelfCategories(shelfRows(db)), [db]);

  /** How the chosen bundle is landing, so the form can narrate it. */
  const chosenBundle =
    rule?.type === "BUNDLE" ? bundleProgress(db, rule, basket) : null;
  /** Live bundles this basket already earns but has not claimed. */
  const missedBundles = useMemo(
    () => unusedBundles(db, basket, discountId),
    [db.discounts, basket, discountId],
  );
  const suggestions = useMemo(() => recommendFor(db, basket), [db, basket]);
  /**
   * A recommendation's reason, said in the operator's own language.
   *
   * `lib/recommend.ts` hands back a tagged `WhyReason` rather than a sentence,
   * for the reason `DiscountBlocker` does: a lib has no `t()` in scope, and a
   * sentence built there is both untranslatable and invisible to
   * `test/i18n.test.ts`, which finds missing Indonesian by reading `t()` call
   * sites. So the four phrasings live here, where the sweep can see them.
   */
  const whyText = (why: WhyReason): string => {
    switch (why.kind) {
      case "STEP_UP":
        return t(
          "pos.whyStepUp",
          "{{step}} more than the {{name}} {{variant}} on this sale.",
          {
            step: fmtRp(why.step),
            name: why.fromName,
            variant: why.fromVariant,
          },
        );
      case "MODEL_RULE":
        return t(
          "pos.whyModelRule",
          "{{pct}}% of past sales of what is in this basket also took one of these.",
          { pct: Math.round(why.confidence * 100) },
        );
      case "CATEGORY_RULE":
        return t(
          "pos.whyCategoryRule",
          "Bought alongside {{category}} on {{count}} past sale(s).",
          { category: why.category, count: why.support },
        );
      case "NO_HISTORY":
        return t(
          "pos.whyNoHistory",
          "Goes alongside the {{products}} on this sale — no past receipt has carried both yet.",
          { products: why.withProducts },
        );
    }
  };
  const shownSuggestions = showAllSuggestions
    ? suggestions
    : suggestions.slice(0, SUGGESTIONS_SHOWN);

  /** Lines priced under what the shop paid — flagged, never silently allowed. */
  const belowCost = lines.filter((l) => {
    if (!l.serial) return false;
    const unit = db.units.find((u) => u.serial === l.serial);
    const asking = l.price ?? priceOf(l.serial) ?? 0;
    return unit !== undefined && asking > 0 && asking < unit.buy;
  });

  const submit = () => {
    const chosen = lines.filter((l) => l.serial);
    if (chosen.length === 0)
      return void message.warning(
        t("pos.pickAtLeastOne", "Pick at least one unit from inventory."),
      );
    // A loss-making line is sometimes deliberate — clearing dead stock,
    // honouring a promise — so it is named in the confirmation dialog rather
    // than refused here. What it will not do is go through unnoticed.
    // The salesperson stopped being required on 2026-08-27, and it was the
    // owner's call about which fields a fast sale may skip. It cost a hole in
    // the per-staff figures either way: staff faced with a blocking dialog on
    // a queue picked whichever name was first in the list, which is a worse
    // hole than an empty one because it looks like data.
    //
    // The channel is still required, and is in the payment-detail section with
    // a default of "In store" — which is what nine sales in ten are.

    // Names the fields rather than saying "add the address": the form is six
    // boxes, and "incomplete" without saying which one is a hunt.
    if (shipped) {
      const missing = missingAddressParts(address);
      if (missing.length > 0) {
        goToPayment();
        return void message.warning(
          t(
            "pos.addressStillNeeds",
            "The shipping address still needs: {{fields}}.",
            { fields: missing.join(", ") },
          ),
        );
      }
    }

    /*
     * Every charge, with a name.
     *
     * A fee typed as an amount and left unlabelled is still a real charge —
     * refusing it would lose money the shop is owed — so it is given the
     * generic word rather than dropped. The category list is what usually
     * fills this in.
     */
    const namedFees: OrderFee[] = liveFees.map((f) => ({
      ...f,
      label: f.label.trim() || t("pos.extra", "Extra"),
    }));

    // The order is built BEFORE the mutation rather than inside it, because the
    // invoice needs the very row that was written. Reaching back into the store
    // for "the newest order" would be a guess that a second till could break.
    const code = docCode("SI");
    const prices: Record<string, number> = {};
    const listPrices: Record<string, number> = {};
    for (const l of chosen) {
      const listed = priceOf(l.serial) ?? 0;
      prices[l.serial!] = l.price ?? listed;
      // Snapshotted, because `Sku.price` is what the shop asks TODAY and a
      // repriced variant would otherwise rewrite history. See `Order.listPrices`.
      listPrices[l.serial!] = listed;
    }
    const order: Order = {
      id: nextId("o"),
      code,
      ts: new Date().toISOString(),
      customerId: customerId ?? null,
      serials: chosen.map((l) => l.serial!),
      prices,
      listPrices,
      discount: discountValue,
      discountId,
      source,
      salesmanId,
      referralSourceId: referralId,
      // Composed here, from the parts the form collected — see lib/address.ts.
      shippingAddress: shipped ? composeAddress(address) : undefined,
      // A marketplace sale has no payment method to pick — the customer paid
      // the marketplace — so the field records which one is holding it.
      payMethod: holdsFunds(source) ? marketplacePayMethod(source) : payMethod,
      settled: !holdsFunds(source),
      extra: totals.extra || undefined,
      /*
       * `extra` above is the TOTAL and this is its label; `fees` below is the
       * breakdown. Both, because prisma has the first pair and the second is
       * mock-only — see `Order.fees` — and because the invoice has always
       * printed one line.
       *
       * The label names the charge rather than storing an unlabelled number:
       * an `extra` with no note is a figure on an invoice nobody can account
       * for a month later. With several fees it says so and the breakdown
       * carries the detail.
       */
      extraNote:
        totals.extra > 0
          ? namedFees.length === 1
            ? namedFees[0]!.label
            : namedFees.length > 1
              ? t("pos.severalCharges", "{{count}} charges", {
                  count: namedFees.length,
                })
              : shipped
                ? t("Shipping")
                : t("pos.extra", "Extra")
          : undefined,
      fees: namedFees.length > 0 ? namedFees.map((f) => ({ ...f })) : undefined,
      tradeIns:
        tradeIns.length > 0 ? tradeIns.map((x) => ({ ...x })) : undefined,
      total,
      reservationId: fromReservations[0],
    };

    let closed = 0;
    mutate((d) => {
      for (const l of chosen) {
        const unit = d.units.find((u) => u.serial === l.serial)!;
        const price = prices[l.serial!]!;
        // Measured against the variant's asking price. The ledger note is the
        // same promise as before: this sale went out at a different number and
        // here is what it was, on the serial that left the shop.
        const asking = d.skus.find((k) => k.id === unit.skuId)?.price;
        if (asking !== undefined && price !== asking) {
          /*
           * Translated at the moment it is WRITTEN, and that is the trade.
           *
           * A `UnitEvent` is append-only, so whatever goes in this column is
           * what the timeline shows for the life of the serial — a sentence
           * built here in whatever language the till happened to be in is
           * frozen in it. The right fix is a structured note the reader
           * phrases (the shape `packages/db/src/units.ts` uses for its
           * `TimelineContext`), but `UnitEvent.note` is a single free-text
           * column and CLAUDE.md forbids inventing schema for it.
           *
           * So: the operator's own language, chosen once, by the person who
           * was actually standing there. It at least reads correctly to the
           * shop that recorded it, which the English never did.
           */
          appendEvent(d, l.serial!, {
            type: "DICATAT",
            note:
              price < asking
                ? t(
                    "pos.ledgerBargain",
                    "Bargain on {{code}}: {{from}} → {{to}} (this transaction only)",
                    { code, from: fmtRp(asking), to: fmtRp(price) },
                  )
                : t(
                    "pos.ledgerUpsell",
                    "Upsell on {{code}}: {{from}} → {{to}} (this transaction only)",
                    { code, from: fmtRp(asking), to: fmtRp(price) },
                  ),
          });
        }
        // Nothing is written onto the hold here, and that is the point of the
        // 2026-08-26 reshape: the item's state IS the unit's status, so
        // `TERJUAL` below is what marks it collected. What still has to happen
        // is the HEADER projection, and it happens once, after the loop, in
        // this same mutation — see `reprojectHolds`.
        if (
          d.reservations.some((r) =>
            r.items.some(
              (i) => i.serial === l.serial && unit.status === "DIRESERVASI",
            ),
          )
        ) {
          closed += 1;
        }
        appendEvent(d, l.serial!, {
          type: "TERJUAL",
          toStatus: "TERJUAL",
          refCode: code,
        });
      }
      if (rule) {
        const r = d.discounts.find((x) => x.id === rule.id);
        if (r) r.used += 1;
      }
      // Header projections, in the same transaction as the sale that moved the
      // units. A hold whose last machine has just gone reads DONE; one with
      // machines left stays ACTIVE, which is what partial collection is.
      reprojectHolds(
        d,
        chosen.map((l) => l.serial!),
      );
      // CLAUDE.md's one sanctioned hard delete: the QC photographs of a
      // machine go, row and file, the moment it is sold. The `UnitEvent`
      // ledger above still records the sale, so the timeline is intact —
      // only the images go. `purgeQcPhotos` carries the reasoning.
      purgeQcPhotos(
        d,
        chosen.map((l) => l.serial!),
      );

      /*
       * A traded machine the shop is KEEPING becomes stock, here, in the same
       * mutation as the sale that bought it.
       *
       * "Tukar tambah / beli unit pelanggan" is two things wearing one button,
       * and the serial is what tells them apart. With one, the shop has bought
       * a machine and it enters at QC with the allowance as its cost —
       * identical in every respect to a machine off a purchase order, because
       * that is what it is. Without one, the trade-in is only a number off the
       * bill: an old phone knocked off the price and taken away by whoever
       * wanted it, with nothing for the shop to track.
       *
       * QC, not TERSEDIA. A machine bought across a counter in the middle of a
       * sale is exactly the one that should not reach the shelf before
       * somebody opens it — even when the dialog has already asked for a
       * grade, because a grade taken at a busy counter is a grade worth
       * confirming at the bench.
       */
      for (const x of tradeIns) {
        const serial = (x.serial ?? "").trim().toUpperCase();
        if (serial === "") continue;
        if (d.units.some((u) => u.serial === serial)) continue;
        d.units.push({
          serial,
          // The variant when the dialog recognised one, and "" when it did
          // not. An unrecognised machine is assigned its product at QC, which
          // is what QC is for — inventing a SKU at the till to hold it would
          // put a product in the catalogue nobody chose to sell.
          skuId: x.skuId ?? "",
          status: "QC",
          locationId: d.myWarehouseId,
          buy: x.value,
          description: x.label,
          poId: null,
          ...(gradeForCondition(x.condition ?? "SECOND", x.grade)
            ? { grade: gradeForCondition(x.condition ?? "SECOND", x.grade)! }
            : {}),
        });
        appendEvent(d, serial, {
          type: "DITERIMA",
          toStatus: "QC",
          refCode: code,
          note: t("pos.ledgerTradeIn", "Trade-in on {{code}}: {{label}}", {
            code,
            label: x.label,
          }),
        });
      }

      /*
       * A new address the customer has not used before is remembered
       * (owner ask 2026-09-01).
       *
       * On the customer, not on the order — the order already stores the line
       * it shipped to. This is what makes the dropdown useful on the SECOND
       * order, and it is why re-typing six fields for a repeat customer stops
       * happening. Deduped on the composed line, so shipping to the same place
       * twice does not grow the list.
       */
      if (shipped && customerId) {
        const line = composeAddress(address);
        const c = d.customers.find((x) => x.id === customerId);
        if (c && line !== "") {
          const held = c.addresses ?? [];
          if (!held.some((a) => a.line === line)) {
            c.addresses = [...held, { id: nextId("ca"), line }];
          }
        }
      }

      d.orders.unshift(order);
    });
    message.success(
      [
        t("pos.saleRecorded", "Sale recorded."),
        closed > 0 &&
          t("pos.holdsCollected", "{{count}} held unit(s) collected.", {
            count: closed,
          }),
        holdsFunds(source) &&
          t(
            "pos.marketplacePendingToast",
            "{{channel}} has not released the balance yet — confirm it in Income & Expense once it lands.",
            { channel: channelOf(source)?.label ?? source },
          ),
      ]
        .filter(Boolean)
        .join(" "),
    );
    // Say it landed, and offer the paper from there. Printing straight away is
    // a dialog nobody asked for — plenty of sales want no receipt at all — and
    // a toast alone is a confirmation that scrolls past while somebody is
    // counting change.
    setRecorded(order);
    setLines([{}]);
    setCustomerId(undefined);
    setDiscountId(undefined);
    setShipped(false);
    setAddress(EMPTY_ADDRESS);
    setSavedAddressId(undefined);
    setFees([]);
    setShowAllSuggestions(false);
    setTradeIns([]);
    setStep("PRODUCTS");
    setFromReservations([]);
    // The channel, the payment method and the salesperson are deliberately NOT
    // reset. They are the same answer for a whole shift — a counter selling
    // ten machines in an afternoon sells all ten offline, in cash, under one
    // name — and a till that forgets them between sales asks the same three
    // questions ten times.
  };

  /** Put a unit on the sale as a new line. */
  const addSuggestion = (serial: string) => {
    setLines((prev) => [...prev.filter((l) => l.serial), { serial }]);
    message.success(
      t("pos.addedToSale", "{{serial}} added to the sale.", { serial }),
    );
  };

  /**
   * A catalogue row was tapped: choose, or take the only one.
   *
   * The chooser exists for the choice (owner answer 2026-08-27) — but when a
   * variant has exactly one machine left there is no choice to make, and a
   * dialog offering one option is a tap the queue pays for nothing (owner
   * revision 2026-08-27). The single machine goes straight in the basket.
   */
  const pickFromRow = (row: (typeof catalogue)[number]) => {
    const taken = new Set(lines.map((l) => l.serial));
    const left = row.units.filter((u) => !taken.has(u.serial));
    if (left.length === 1) {
      addSuggestion(left[0]!.serial);
      return;
    }
    setPickingSku(row.sku.id);
  };

  /**
   * Scan straight onto the sale.
   *
   * The three ways a scan can fail here are genuinely different things, and a
   * counter with a customer waiting needs to be told which one it is: a serial
   * nobody has ever seen, a real unit that is not for sale, and a unit already
   * on this sale. None of them is a dialog — the next scan has to work.
   */
  const scanOntoSale = (raw: string) => {
    // Resolved rather than merely upper-cased: the machine in the customer's
    // hands carries the shop's own label AND Apple's, and until 2026-08-31 a
    // scan of the second one answered "not a unit we know" about a laptop on
    // the counter. The answer is still always a stored serial — see
    // `resolveScannedSerial`, which finds one or hands the scan straight back.
    const serial = resolveScannedSerial(
      raw,
      db.units.map((u) => u.serial),
    );
    if (!serial) return;

    if (lines.some((l) => l.serial === serial)) {
      message.warning(
        t("pos.alreadyOnSale", "{{serial}} is already on this sale.", {
          serial,
        }),
      );
      return;
    }
    const unit = db.units.find((u) => u.serial === serial);
    if (unit === undefined) {
      message.error(
        t("pos.notAUnit", "{{serial}} is not a unit we know.", { serial }),
      );
      return;
    }
    if (!sellable.some((u) => u.serial === serial)) {
      message.warning(
        t("pos.cannotBeSold", "{{serial}} is {{status}} — it cannot be sold.", {
          serial,
          status: unit.status,
        }),
      );
      return;
    }
    addSuggestion(serial);
  };

  useScanTarget(scanOntoSale);

  /**
   * The catalogue — one row per variant, with what is left of it.
   *
   * It listed every sellable SERIAL until 2026-08-27, one row each, and that
   * was honest and useless: a customer points at a machine and says "the Air,
   * the silver one", and the screen answered with forty rows of C02XY… that
   * all looked the same. A till lists models. WHICH machine goes out is a
   * separate question, asked whenever there is a choice — `pickingSku` opens
   * the chooser where a serial's grade and battery are worth reading. A row
   * down to its last machine skips it (owner revision 2026-08-27); see
   * `pickFromRow`.
   *
   * A row with nothing left stays visible, at zero. Rows that vanish as they
   * are clicked move the next one under the cursor, and "we had one of those"
   * is a question the counter asks out loud.
   */
  const cataloguePanel = (
    <Card
      // In the phone's dialog the Modal supplies the title and the frame, so
      // the Card is only here to keep ONE definition of the catalogue. Its
      // chrome would otherwise be a second heading inside the first.
      {...(compact
        ? { variant: "borderless" as const, styles: { body: { padding: 0 } } }
        : {
            title: t("pos.stockCatalogue", "Stock catalogue"),
            style: {
              flex: "1 1 520px",
              minWidth: 320,
              display: "flex",
              flexDirection: "column",
            },
            styles: { body: { flex: 1, minHeight: 0 } },
          })}
      extra={
        compact ? undefined : (
        <Tooltip
          title={
            activeReservations.length
              ? t(
                  "pos.loadFromHold",
                  "Load a unit and customer from a reservation",
                )
              : t("pos.nothingOnHold", "Nothing is on hold right now")
          }
        >
          <span>
            <Button
              icon={<ClockCircleOutlined />}
              disabled={activeReservations.length === 0}
              onClick={() => setReservationPickerOpen(true)}
            >
              {t("pos.fromReservations", "Reservations ({{count}})", {
                count: activeReservations.length,
              })}
            </Button>
          </span>
        </Tooltip>
        )
      }
    >
      <Input.Search
        allowClear
        value={shelfQuery}
        onChange={(e) => setShelfQuery(e.target.value)}
        placeholder={t(
          "pos.searchOrScan",
          "Search a product or variant — or scan a serial, which drops straight into the basket",
        )}
        style={{ marginBottom: 12 }}
      />

      {/*
       * Category chips. Built from ALL sellable stock rather than from the
       * filtered rows, so the chip you are standing on does not disappear as
       * the search narrows and leave you with no way back to "Semua".
       */}
      <Flex gap={8} wrap style={{ marginBottom: 12 }}>
        <Button
          size="small"
          shape="round"
          type={category === undefined ? "primary" : "default"}
          onClick={() => setCategory(undefined)}
        >
          {t("pos.allCategories", "All")}
        </Button>
        {categories.map((c) => (
          <Button
            key={c}
            size="small"
            shape="round"
            type={category === c ? "primary" : "default"}
            onClick={() => setCategory(category === c ? undefined : c)}
          >
            {c}
          </Button>
        ))}
      </Flex>

      {catalogue.length === 0 ? (
        <Typography.Text type="secondary">
          {t("pos.nothingMatchesThat", "Nothing matches that.")}
        </Typography.Text>
      ) : (
        <Flex vertical>
          {catalogue.map((row) => {
            const out = row.remaining === 0;
            return (
              <Flex
                key={row.sku.id}
                align="center"
                gap={12}
                className="pos-shelf-row"
                // A row, not a button, because it holds several things worth
                // reading — but the whole of it is the target. A cashier
                // aiming at a 60px "Add" button with a customer waiting is a
                // cashier who misses it.
                role="button"
                tabIndex={out ? -1 : 0}
                aria-disabled={out || undefined}
                aria-label={t("pos.pickFrom", "Choose a {{product}}", {
                  product: `${row.sku.name} ${row.sku.variantLabel}`,
                })}
                style={{
                  padding: "10px 8px",
                  cursor: out ? "not-allowed" : "pointer",
                  opacity: out ? 0.45 : 1,
                }}
                onClick={() => !out && pickFromRow(row)}
                onKeyDown={(e) => {
                  if (out) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    pickFromRow(row);
                  }
                }}
              >
                <Flex vertical style={{ flex: 1, minWidth: 0 }}>
                  <Typography.Text strong ellipsis>
                    {row.sku.name}
                  </Typography.Text>
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: 12 }}
                    ellipsis
                  >
                    {row.sku.variantLabel}
                  </Typography.Text>
                </Flex>

                {/*
                 * The grades present, not a price per grade. Two machines of
                 * one variant in different condition ask the same money (owner
                 * revision 2026-08-27) — the grade is recorded, shown, and
                 * does not move the number.
                 */}
                <Flex gap={4}>
                  {row.grades.map((g) => (
                    // `plain`: a tooltip on every chip of a catalogue row that
                    // is itself one big button would fire on the way past.
                    <GradeTag key={g} grade={g} plain />
                  ))}
                </Flex>

                <Typography.Text
                  type={out ? "danger" : "warning"}
                  style={{ fontSize: 12, whiteSpace: "nowrap" }}
                >
                  {out
                    ? t("pos.noneLeft", "None left")
                    : t("pos.remaining", "{{count}} left", {
                        count: row.remaining,
                      })}
                </Typography.Text>

                <Typography.Text strong style={{ whiteSpace: "nowrap" }}>
                  {fmtRp(row.sku.price)}
                </Typography.Text>
              </Flex>
            );
          })}
        </Flex>
      )}
    </Card>
  );

  /**
   * One line of the basket: what it is, which machine, and what it is being
   * charged.
   *
   * The margin used to live here as a live percentage beside the price box.
   * It is behind the eye button since 2026-09-01 (owner ask): the number it
   * shows is what the shop PAID, and a customer leaning over the counter to
   * agree a price could read it.
   */
  const cartLine = (l: Line, i: number) => {
    const sku = skuOf(l.serial);
    const listed = priceOf(l.serial) ?? 0;
    const charged = l.price ?? listed;
    const negotiated = charged !== listed && listed > 0;
    return (
      <Flex vertical gap={6} key={l.serial ?? `blank-${i}`}>
        <Flex justify="space-between" align="flex-start" gap={8}>
          <Flex vertical style={{ minWidth: 0 }}>
            <Typography.Text strong ellipsis>
              {sku ? sku.name : t("pos.pickAUnit", "No unit picked")}
            </Typography.Text>
            {/* Product name and variant, then the serial — the owner's order,
                and the order somebody reads a receipt in: what it is, then
                which one. */}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {sku?.variantLabel ?? "—"}
            </Typography.Text>
            <Typography.Text
              type="secondary"
              style={{ fontSize: 12, fontFamily: "monospace" }}
            >
              {l.serial ?? "—"}
            </Typography.Text>
          </Flex>
          <Flex gap={0}>
            <Tooltip
              title={t(
                "pos.inspectLine",
                "List price, what this is being sold for, and the margin",
              )}
            >
              <Button
                type="text"
                size="small"
                aria-label={t("pos.inspectAria", "Price detail for {{serial}}", {
                  serial: l.serial ?? "",
                })}
                icon={<EyeOutlined />}
                disabled={!l.serial}
                onClick={() => setInspecting(i)}
              />
            </Tooltip>
            <Tooltip title={t("pos.removeThisLine", "Remove this line")}>
              <Button
                type="text"
                danger
                size="small"
                aria-label={t("pos.removeLineAria", "Remove {{serial}}", {
                  serial: l.serial ?? t("pos.emptyLine", "empty line"),
                })}
                icon={<DeleteOutlined />}
                onClick={() => setLines(lines.filter((_, j) => j !== i))}
              />
            </Tooltip>
          </Flex>
        </Flex>
        <Flex gap={8} align="center">
          <MoneyInput
            style={{ flex: 1 }}
            value={l.price ?? priceOf(l.serial)}
            disabled={!l.serial}
            aria-label={t("pos.linePrice", "Price for {{serial}}", {
              serial: l.serial ?? "",
            })}
            onChange={(v) =>
              setLines(
                lines.map((x, j) =>
                  j === i ? { ...x, price: v ?? undefined } : x,
                ),
              )
            }
          />
          {/*
           * Says only that the price has MOVED and in which direction, never
           * by how much against cost. The amount is in the dialog, which is
           * the whole point of the change: the cashier needs to see at a
           * glance that this line is not the list price, and needs to open
           * something deliberate to see what the shop paid.
           */}
          {negotiated && (
            <Tag
              color={charged < listed ? "orange" : "green"}
              style={{ marginInlineEnd: 0 }}
            >
              {charged < listed
                ? t("pos.bargained", "Bargain")
                : t("pos.upsold", "Upsell")}
            </Tag>
          )}
        </Flex>
      </Flex>
    );
  };

  /**
   * Suggestions, under the basket in the right pane (owner ask 2026-09-01).
   *
   * They used to sit in the optional details section, which is folded shut on
   * the sale they are for: a cashier who never opened it never saw them. Here
   * they are directly under the thing they are about, at the moment the
   * customer is still standing there.
   *
   * Narrow, so the table is two columns and the reasoning is stacked inside
   * the first rather than spread across four. `lib/recommend.ts` is where the
   * ranking is decided; this only draws it.
   */
  const suggestionCard = suggestions.length > 0 && (
    <Card
      size="small"
      title={t("pos.worthOffering", "Worth offering with this sale")}
      extra={
        // Only when there is more to see. A "See more" that reveals nothing is
        // a control that teaches people not to press it.
        suggestions.length > SUGGESTIONS_SHOWN && (
          <Button
            type="link"
            size="small"
            style={{ paddingInline: 0 }}
            onClick={() => setShowAllSuggestions((v) => !v)}
          >
            {showAllSuggestions
              ? t("pos.seeFewer", "See fewer")
              : t("pos.seeMore", "See {{count}} more", {
                  count: suggestions.length - SUGGESTIONS_SHOWN,
                })}
          </Button>
        )
      }
    >
      <Table
        rowKey="serial"
        dataSource={shownSuggestions}
        pagination={false}
        size="small"
        showHeader={false}
        columns={[
          {
            key: "unit",
            render: (_, r) => (
              <Flex vertical gap={2}>
                <Flex gap={6} align="center" wrap>
                  {r.kind === "UPGRADE" ? (
                    <Tag color="geekblue" icon={<ArrowUpOutlined />}>
                      {t("pos.upgrade", "Upgrade")}
                    </Tag>
                  ) : (
                    <Tag color="purple" icon={<GiftOutlined />}>
                      {t("pos.addOn", "Add-on")}
                    </Tag>
                  )}
                  <Typography.Text strong>
                    {r.title} {r.variant}
                  </Typography.Text>
                </Flex>
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 12, fontFamily: "monospace" }}
                >
                  {r.serial}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {whyText(r.why)}
                </Typography.Text>
                {r.bundle && (
                  <Typography.Text type="success" style={{ fontSize: 12 }}>
                    {t(
                      "pos.suggestCompletesBundle",
                      "Adding this completes {{code}} — {{name}}.",
                      { code: r.bundle.code, name: r.bundle.name },
                    )}
                  </Typography.Text>
                )}
              </Flex>
            ),
          },
          {
            key: "add",
            width: 120,
            align: "right" as const,
            render: (_, r) => (
              <Flex vertical gap={4} align="flex-end">
                <Typography.Text strong style={{ whiteSpace: "nowrap" }}>
                  {fmtRp(r.price)}
                </Typography.Text>
                <Button size="small" onClick={() => addSuggestion(r.serial)}>
                  {t("pos.addToSale", "Add")}
                </Button>
              </Flex>
            ),
          },
        ]}
      />
    </Card>
  );

  /**
   * The total, on its own dark surface, pinned to the bottom of the pane.
   *
   * Not decoration: this is the number the cashier reads out loud and the
   * customer checks, and it has to be the one thing the eye lands on. The
   * colour comes from the theme token so it is the same green in both modes.
   */
  const totalPanel = (
    <Card
      className="pos-total"
      styles={{ body: { padding: 20 } }}
      // Capped on a phone, where this is anchored to the bottom of the screen:
      // a long breakdown — bargain, discount, extra, trade-in — would
      // otherwise take half the viewport and leave no basket above it.
      style={{
        flex: "0 0 auto",
        ...(compact ? { maxHeight: "50vh", overflow: "auto" } : {}),
      }}
    >
      <Flex vertical gap={8}>
        <Flex justify="space-between">
          <span>{t("pos.subtotal", "Subtotal")}</span>
          <span>{fmtRp(totals.subtotal)}</span>
        </Flex>
        {/*
         * The negotiation, as its own line (owner ask 2026-09-01). The
         * subtotal above is the shop's price list, so a haggled sale can now
         * show what was given away instead of quietly showing a smaller
         * subtotal — which is what the customer is owed a sight of, and what
         * the salesperson's report is made of.
         */}
        {totals.bargain > 0 && (
          <Flex justify="space-between">
            <span>{t("pos.bargain", "Bargain")}</span>
            <span>−{fmtRp(totals.bargain)}</span>
          </Flex>
        )}
        {totals.upsell > 0 && (
          <Flex justify="space-between">
            <span>{t("pos.upsell", "Sold above list")}</span>
            <span>+{fmtRp(totals.upsell)}</span>
          </Flex>
        )}
        {totals.discount > 0 && (
          <Flex justify="space-between">
            <span>{t("pos.discount", "Discount")}</span>
            <span>−{fmtRp(totals.discount)}</span>
          </Flex>
        )}
        {/* One line per charge, not one line for all of them: "Extra
            Rp 165.000" against shipping plus a bag is exactly the receipt line
            nobody can account for later. */}
        {liveFees.map((f) => (
          <Flex key={f.id} justify="space-between">
            <span>{f.label.trim() || t("pos.extra", "Extra")}</span>
            <span>{fmtRp(f.amount)}</span>
          </Flex>
        ))}
        {totals.tradeCredit > 0 && (
          <Flex justify="space-between">
            <span>{t("pos.tradeCredit", "Trade-in")}</span>
            <span>−{fmtRp(totals.tradeCredit)}</span>
          </Flex>
        )}
        <Flex justify="space-between" align="baseline">
          <Typography.Text style={{ fontSize: 16 }}>
            {t("pos.total", "Total")}
          </Typography.Text>
          <Typography.Text strong style={{ fontSize: 26 }}>
            {fmtRp(totals.total)}
          </Typography.Text>
        </Flex>
        {belowCost.length > 0 && (
          <Typography.Text type="danger" style={{ fontSize: 12 }}>
            {t(
              "pos.linesBelowCost",
              "{{count}} line(s) priced below what the shop paid.",
              { count: belowCost.length },
            )}
          </Typography.Text>
        )}

        {/*
         * One button on step one, two on step two (owner revision
         * 2026-09-01).
         *
         * *Pay & finish* used to sit here on BOTH steps, so a sale could be
         * recorded from the catalogue without the payment page ever being
         * seen. The owner removed it: step one now ends in *Continue* and
         * nothing else, which makes the two steps a sequence rather than two
         * places the same thing can be done. It also means the channel and
         * the payment method — the two answers every sale needs — are on a
         * page the cashier has actually looked at.
         */}
        {/*
         * `wrap` + a flex basis rather than `block` on each button. `block` is
         * `width: 100%`, and two of those in one row each asked for the whole
         * card: the pair overflowed the panel and *Pay & finish* was clipped
         * by its right edge. A basis lets them share the row where it fits and
         * stack where it does not, which is the same pair of buttons the CSS
         * beside them is written for.
         */}
        <Flex gap={8} wrap style={{ marginTop: 8 }}>
          {step === "PRODUCTS" ? (
            /*
             * White text when there is nothing to sell (owner ask
             * 2026-09-01). antd greys a disabled button's label against a grey
             * fill, and on this dark green panel that read as a smudge rather
             * than as a button waiting for a product. `.pos-pay-btn` gives it
             * a translucent white ground and a white label.
             */
            <Button
              block
              size="large"
              type="primary"
              className="pos-pay-btn"
              disabled={basket.length === 0}
              onClick={goToPayment}
            >
              {t("pos.continue", "Continue")}
            </Button>
          ) : (
            <>
              <Button
                size="large"
                className="pos-detail-btn"
                style={{ flex: "1 1 180px" }}
                icon={<ArrowLeftOutlined />}
                onClick={() => setStep("PRODUCTS")}
              >
                {t("pos.backToProducts", "Go back to products")}
              </Button>
              <Button
                size="large"
                type="primary"
                className="pos-pay-btn"
                style={{ flex: "1 1 180px" }}
                disabled={basket.length === 0}
                danger={belowCost.length > 0}
                onClick={() => setConfirming(true)}
              >
                {t("pos.payAndFinish", "Pay & finish")}
              </Button>
            </>
          )}
        </Flex>
      </Flex>
    </Card>
  );

  /**
   * The right pane: what is being sold, what else to offer, and what it costs.
   *
   * Sticky (owner ask 2026-09-01) — scrolling the catalogue on the left no
   * longer scrolls the money away. The pane is bounded by the viewport and the
   * basket scrolls INSIDE it, so the totals stay pinned to the bottom however
   * long the basket gets. On a phone the two panes stack and stickiness is
   * meaningless, so it is switched off there.
   */
  /**
   * The sale itself — what is in it, and what else to offer.
   *
   * Split out from the pane around it so the phone can reuse it: on a desktop
   * it is the scrolling half of the right column, and on a phone it IS the
   * page. Everything in here is the same either way, which is the point of
   * their being one definition.
   */
  const cartBody = (
    <>
      {/*
       * The two ways to put a machine on the sale, on a phone (owner ask
       * 2026-09-01).
       *
       * There is no room for a catalogue column beside the basket on a 375px
       * screen, and stacking it above meant scrolling past forty products to
       * reach the sale. So the catalogue becomes a full-screen dialog behind a
       * button and the basket gets the page — which is also the honest shape:
       * on a phone, adding a product IS a separate task rather than a panel
       * you glance at.
       */}
      {compact && step === "PRODUCTS" && (
        <Flex gap={8}>
          <Button
            block
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCatalogueOpen(true)}
          >
            {t("pos.addProduct", "Add product")}
          </Button>
          <Button
            block
            icon={<ClockCircleOutlined />}
            disabled={activeReservations.length === 0}
            onClick={() => setReservationPickerOpen(true)}
          >
            {t("pos.fromReservations", "Reservations ({{count}})", {
              count: activeReservations.length,
            })}
          </Button>
        </Flex>
      )}
        {fromReservations.length > 0 && (
          <Alert
            type="info"
            showIcon
            title={t(
              "pos.closesHolds",
              "This sale closes {{count}} reservation(s).",
              { count: fromReservations.length },
            )}
            description={t(
              "pos.recordingItMarksThoseUnits",
              "Recording it marks those units as bought and releases the hold.",
            )}
            closable
            onClose={() => setFromReservations([])}
          />
        )}

        {missedBundles.map(({ discount, progress }) => (
          <Alert
            key={discount.id}
            type="success"
            showIcon
            icon={<GiftOutlined />}
            title={t("pos.qualifiesFor", "This basket qualifies for {{code}}", {
              code: discount.code,
            })}
            description={t(
              "pos.bundleWorth",
              "{{count}} bundle(s) of {{per}}, worth {{saving}} off. Not applied yet.",
              {
                count: progress.complete,
                per: progress.perBundle,
                saving: fmtRp(progress.saving),
              },
            )}
            action={
              <Button
                size="small"
                type="primary"
                onClick={() => setDiscountId(discount.id)}
              >
                {t("pos.applyIt", "Apply it")}
              </Button>
            }
          />
        ))}

        <Card
          title={
            <Flex align="center" gap={8}>
              <ShoppingCartOutlined />
              <span>{t("pos.basket", "Basket")}</span>
            </Flex>
          }
          extra={
            <Typography.Text type="secondary">
              {t("pos.itemCount", "{{count}} item(s)", {
                count: basket.length,
              })}
            </Typography.Text>
          }
          styles={{ body: { paddingBottom: 12 } }}
        >
          {basket.length === 0 ? (
            <Typography.Text type="secondary">
              {t(
                "pos.basketEmpty",
                "Nothing in the basket. Pick a product on the left, or scan a serial.",
              )}
            </Typography.Text>
          ) : (
            <Flex vertical gap={16}>
              {lines.map((l, i) => (l.serial ? cartLine(l, i) : null))}
            </Flex>
          )}
        </Card>

        {suggestionCard}
    </>
  );

  /**
   * The right pane on a desktop: the sale, and the money pinned under it.
   *
   * Sticky (owner ask 2026-09-01) — scrolling the catalogue on the left no
   * longer scrolls the money away. The pane is bounded by the viewport and the
   * basket scrolls INSIDE it, so the totals stay pinned to the bottom however
   * long the basket gets.
   */
  const cartPanel = (
    <Flex
      vertical
      gap={12}
      style={{
        // `0 0 auto` with a clamped basis rather than `0 1 460px`: with the
        // row no longer wrapping, a shrinkable basis let the sale panel be
        // squeezed towards nothing on a narrow window instead of the catalogue
        // giving way. The clamp keeps it readable at 360 and lets it take 460
        // when there is room.
        flex: "0 0 auto",
        width: "clamp(320px, 34%, 460px)",
        alignSelf: "flex-start",
        position: "sticky",
        top: 0,
        maxHeight: `calc(100vh - ${STICKY_INSET * 2}px)`,
      }}
    >
      {/* The scrolling half. `minHeight: 0` is what lets it actually shrink —
          a flex child refuses to go below its content without it, and the
          totals below would be pushed off the bottom of the pane. */}
      <Flex
        vertical
        gap={12}
        style={{ flex: 1, minHeight: 0, overflow: "auto" }}
      >
        {cartBody}
      </Flex>

      {totalPanel}
    </Flex>
  );

  /**
   * Everything that is not the basket, in one folded section
   * (owner ask 2026-09-01).
   *
   * Five groups, and the grouping is by the question being answered rather
   * than by which control it happens to use: what comes off the bill, what
   * goes on it, how it is being paid, who is buying, and who gets the credit.
   *
   * Nothing here is required except the channel, which has a default. The
   * commonest sale in the shop — one machine, cash, walk-in, no receipt — is
   * finished from the basket without this ever opening.
   */
  /**
   * Everything that is not the basket — step two, all of it on one screen
   * (owner revision 2026-09-01).
   *
   * Five sections, grouped by the question being answered rather than by which
   * control it happens to use: what comes off the bill, what goes on it, how
   * it is being paid, who is buying, and who gets the credit.
   *
   * It was a `Collapse` and every section was shut. The owner's verdict was
   * that the collapsing was the problem: *"all of the collapsed information is
   * no longer collapsed but in 1 screen"*. Six decisions about what to look at
   * before any of them can be answered is five more than a person filling in a
   * form should have to make — and the sections are short enough that the
   * whole of step two fits a scroll.
   *
   * Nothing here is required except the channel, which has a default. The
   * commonest sale in the shop — one machine, cash, walk-in, no receipt — is
   * finished from step one and never sees this.
   */
  const paymentDetail = (
    <Flex
      vertical
      gap={16}
      ref={detailsRef}
      /*
       * The same flex sizing the catalogue has, which is the owner's *"make
       * the next page ... to be at the left panel (like the previous product
       * page, currently it is full screen)"*.
       *
       * It was `width: 100%`, and that is exactly what made it full screen: a
       * flex item at 100% of the row leaves nothing for the panel beside it,
       * so the basket wrapped underneath and step two lost the sale it is
       * about. `1 1 520px` makes it a column that shares the row and gives way
       * first, `minWidth: 0` lets it actually shrink, and the panel beside it
       * keeps its own width.
       */
      /*
       * On a phone this sits in a COLUMN, where `flex-basis` is a height —
       * `1 1 520px` there would give the form a 520px minimum height and let
       * it grow, which is a statement about the wrong axis entirely. Full
       * width and natural height is what the owner asked for: *"all the
       * section should be full span in mobile"*.
       */
      style={
        compact
          ? { width: "100%" }
          : { flex: "1 1 520px", minWidth: 0 }
      }
    >
      <Typography.Text type="secondary">
        {t(
          "pos.paymentDetailHint",
          "None of this is required — the sale can be finished from the panel beside it.",
        )}
      </Typography.Text>
      <Card
        key="money"
        title={t("pos.moneyOffTheBill", "Discount & trade-in")}
        extra={
          <Typography.Text type="secondary">
                {totals.discount + totals.tradeCredit > 0
                  ? t("pos.comingOff", "−{{amount}}", {
                      amount: fmtRp(totals.discount + totals.tradeCredit),
                    })
                  : t("pos.nothingOff", "Nothing off")}
              </Typography.Text>
        }
      >
        <Flex vertical gap={16}>
                <Flex vertical gap={8}>
                  <Flex justify="space-between" align="center" gap={8}>
                    <Typography.Text strong>
                      {t("pos.storeDiscount", "Store discount")}
                    </Typography.Text>
                    <Typography.Text strong>
                      −{fmtRp(totals.discount)}
                    </Typography.Text>
                  </Flex>
                  <Button block onClick={() => setDiscountOpen(true)}>
                    {rule
                      ? rule.code
                      : t("pos.addDiscount", "Pick a discount code")}
                  </Button>
                  {rule && (
                    <Button
                      type="link"
                      size="small"
                      style={{ alignSelf: "flex-start", paddingInline: 0 }}
                      onClick={() => setDiscountId(undefined)}
                    >
                      {t("pos.clearDiscount", "Take the code off")}
                    </Button>
                  )}
                  {/* Said here rather than left to be discovered: the manual
                      percentage and amount boxes were removed on 2026-09-01,
                      and somebody who used them needs to know where that
                      conversation now lives. */}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t(
                      "pos.negotiateOnTheLine",
                      "Agreeing a price at the counter is not a discount — type it on the line in the basket, and it books as a bargain.",
                    )}
                  </Typography.Text>
                </Flex>

                <Flex vertical gap={8}>
                  <Button
                    block
                    type="dashed"
                    icon={<SwapOutlined />}
                    onClick={() => setTradeOpen(true)}
                  >
                    {t("pos.tradeIn", "Trade-in (take the customer's machine)")}
                  </Button>
                  {tradeIns.map((x) => (
                    <Flex
                      key={x.id}
                      justify="space-between"
                      align="center"
                      gap={8}
                    >
                      <Typography.Text ellipsis style={{ minWidth: 0 }}>
                        {x.label}
                        {x.serial ? ` · ${x.serial}` : ""}
                      </Typography.Text>
                      <Flex align="center" gap={4}>
                        <Typography.Text>−{fmtRp(x.value)}</Typography.Text>
                        <Button
                          type="text"
                          danger
                          size="small"
                          aria-label={t(
                            "pos.removeTradeIn",
                            "Remove trade-in {{label}}",
                            { label: x.label },
                          )}
                          icon={<DeleteOutlined />}
                          onClick={() =>
                            setTradeIns((prev) =>
                              prev.filter((y) => y.id !== x.id),
                            )
                          }
                        />
                      </Flex>
                    </Flex>
                  ))}
                </Flex>
              </Flex>
      </Card>
      <Card
        key="charge"
        title={t("pos.additionalFee", "Additional fee")}
        extra={
          <Typography.Text type="secondary">
            {totals.extra > 0 ? fmtRp(totals.extra) : "—"}
          </Typography.Text>
        }
      >
        {/*
         * As many charges as the sale has (owner ask 2026-09-01: *"additional
         * fee could be more than 1"*).
         *
         * Shipping and a shopping bag are two things on one receipt, and the
         * single-charge field this replaces forced them into one line nobody
         * could account for later. Each row is a category and an amount; the
         * totals panel lists them separately and `Order.fees` stores them.
         */}
        <Flex vertical gap={12}>
          {fees.length === 0 && (
            <Typography.Text type="secondary">
              {t(
                "pos.noFeesYet",
                "Nothing extra on this sale. Add a charge for delivery, a bag, a setup — anything the customer is paying for beyond the machines.",
              )}
            </Typography.Text>
          )}
          {fees.map((f) => (
            <Flex key={f.id} gap={8} align="center" wrap>
              {/*
               * Searchable AND typable. The list is the shop's own categories,
               * which is what stops "ongkir", "Ongkir" and "delivery" becoming
               * three things in a report — and free text is still allowed,
               * because a charge nobody anticipated is a real charge.
               */}
              <Select
                showSearch
                allowClear
                style={{ flex: "1 1 220px" }}
                value={f.label || undefined}
                onChange={(v: string[] | string | undefined) =>
                  // `tags` mode hands back an array; one entry is all this
                  // takes, and `maxCount` is what keeps it to one.
                  setFee(f.id, {
                    label: Array.isArray(v) ? (v[0] ?? "") : (v ?? ""),
                  })
                }
                mode="tags"
                maxCount={1}
                aria-label={t("pos.feeCategory", "What for")}
                placeholder={t("pos.feePlaceholder", "e.g. Shipping")}
                options={EXTRA_CATEGORIES.map((c) => ({
                  value: t(c),
                  label: t(c),
                }))}
              />
              <MoneyInput
                style={{ flex: "0 1 180px" }}
                value={f.amount || undefined}
                aria-label={t("pos.extraAmount", "Extra charge amount")}
                onChange={(v) => setFee(f.id, { amount: v ?? 0 })}
              />
              <Tooltip title={t("pos.removeFee", "Remove this charge")}>
                <Button
                  type="text"
                  danger
                  aria-label={t("pos.removeFeeAria", "Remove charge {{n}}", {
                    n: f.label || t("pos.extra", "Extra"),
                  })}
                  icon={<DeleteOutlined />}
                  onClick={() => dropFee(f.id)}
                />
              </Tooltip>
            </Flex>
          ))}
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={addFee}
            style={{ alignSelf: "flex-start" }}
          >
            {t("pos.addFee", "Add a charge")}
          </Button>
        </Flex>
      </Card>
      <Card
        key="pay"
        title={t("pos.channelAndPayment", "Channel & payment method")}
        extra={
          <Typography.Text type="secondary">
                {[
                  channelOf(source)?.label ?? source,
                  holdsFunds(source)
                    ? t("pos.escrow", "escrow")
                    : payMethod,
                ].join(" · ")}
              </Typography.Text>
        }
      >
        <Flex vertical gap={16}>
                {/* The one field every sale must answer. Chips rather than a
                    select: six channels, and the answer is the same all
                    afternoon. */}
                <Flex vertical gap={6}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t("pos.channel", "CHANNEL")}
                  </Typography.Text>
                  <Flex gap={6} wrap>
                    {SALE_CHANNELS.map((c) => (
                      <Button
                        key={c.value}
                        size="small"
                        shape="round"
                        type={source === c.value ? "primary" : "default"}
                        onClick={() => setSource(c.value)}
                      >
                        {t(c.label)}
                      </Button>
                    ))}
                  </Flex>
                </Flex>

                <Flex vertical gap={6}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t("pos.paymentUpper", "PAYMENT")}
                  </Typography.Text>
                  {holdsFunds(source) ? (
                    <Typography.Text type="warning" style={{ fontSize: 12 }}>
                      {t(
                        "pos.marketplaceHolds",
                        "{{channel}} is holding the money — confirm it in Income & Expense once it lands.",
                        { channel: channelOf(source)?.label ?? source },
                      )}
                    </Typography.Text>
                  ) : (
                    <Flex gap={6} wrap>
                      {db.paymentMethods
                        .filter((m) => m.forSale && m.active)
                        .map((m) => (
                          <Button
                            key={m.code}
                            size="small"
                            shape="round"
                            type={payMethod === m.label ? "primary" : "default"}
                            onClick={() => setPayMethod(m.label)}
                          >
                            {m.label}
                          </Button>
                        ))}
                    </Flex>
                  )}
                </Flex>
              </Flex>
      </Card>
      <Card
        key="delivery"
        title={t("pos.customerDetail", "Customer detail")}
        extra={
          <Typography.Text type="secondary">
                {customer
                  ? `${customer.name} · ${customer.phone}`
                  : t("pos.noCustomer", "Not recorded")}
              </Typography.Text>
        }
      >
        <Form layout="vertical">
                <Flex gap={12} align="end" wrap>
                  <Form.Item
                    label={t("pos.customer", "Customer")}
                    style={{ flex: "1 1 320px", marginBottom: 12 }}
                  >
                    <Select
                      showSearch
                      allowClear
                      value={customerId}
                      optionFilterProp="label"
                      placeholder={t(
                        "pos.searchNameOrPhone",
                        "Search name or phone",
                      )}
                      options={db.customers.map((c) => ({
                        value: c.id,
                        label: `${c.name} · ${c.phone}`,
                      }))}
                      onChange={(v) => {
                        setCustomerId(v);
                        // A saved address belongs to the person who saved it.
                        setSavedAddressId(undefined);
                      }}
                    />
                  </Form.Item>
                  <Form.Item style={{ marginBottom: 12 }}>
                    <Button
                      icon={<UserAddOutlined />}
                      onClick={() => setNewCustomerOpen(true)}
                    >
                      {t("pos.addCustomer", "Add customer")}
                    </Button>
                  </Form.Item>
                </Flex>

                {customer && (
                  <Descriptions
                    size="small"
                    column={{ xs: 1, sm: 2 }}
                    style={{ marginBottom: 12 }}
                    items={[
                      {
                        key: "n",
                        label: t("pos.name", "Name"),
                        children: customer.name,
                      },
                      {
                        key: "p",
                        label: t("pos.phoneNumber", "Phone number"),
                        children: customer.phone,
                      },
                    ]}
                  />
                )}

                <Checkbox
                  checked={shipped}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setShipped(on);
                    /*
                     * A courier costs money on every shipped sale, so ticking
                     * this offers the charge — the amount is left blank for
                     * whatever the courier actually quoted.
                     *
                     * Only when there is no shipping row already. A cashier
                     * who has typed one is not asking for a second, and now
                     * that fees are a list a blind append would give them one
                     * per tick of the box.
                     */
                    const word = t("Shipping");
                    if (on && !fees.some((f) => f.label.trim() === word)) {
                      setFees((prev) => [
                        ...prev,
                        { id: nextId("fee"), label: word, amount: 0 },
                      ]);
                    }
                  }}
                >
                  {t("pos.thisOrderIsShipped", "This order is shipped")}
                </Checkbox>

                {!shipped && (
                  <Typography.Paragraph
                    type="secondary"
                    style={{ marginTop: 8, marginBottom: 0 }}
                  >
                    {t(
                      "pos.theCustomerIsTakingIt",
                      "The customer is taking it with them — no address needed.",
                    )}
                  </Typography.Paragraph>
                )}

                {shipped && (
                  <Flex vertical gap={12} style={{ marginTop: 16 }}>
                    {/*
                     * A customer's saved addresses (owner ask 2026-09-01).
                     *
                     * A person has a home and an office, and the shop delivers
                     * to whichever they say this time. Picking one fills the
                     * street box with the whole composed line and clears the
                     * rest — deliberately, because `composeAddress` is one-way
                     * and splitting a stored line back into six fields by
                     * guessing which comma was the kecamatan is exactly the
                     * mess the parts form exists to end. What is picked is
                     * what gets shipped to.
                     */}
                    {(customer?.addresses?.length ?? 0) > 0 && (
                      <Form.Item
                        label={t("pos.savedAddress", "Saved address")}
                        style={{ marginBottom: 0 }}
                        extra={t(
                          "pos.savedAddressHint",
                          "Or leave it and fill the fields below for somewhere new.",
                        )}
                      >
                        <Select
                          allowClear
                          value={savedAddressId}
                          placeholder={t(
                            "pos.pickASavedAddress",
                            "Deliver to an address on file",
                          )}
                          options={(customer?.addresses ?? []).map((a) => ({
                            value: a.id,
                            label: a.label ? `${a.label} — ${a.line}` : a.line,
                          }))}
                          onChange={(id) => {
                            setSavedAddressId(id);
                            const picked = customer?.addresses?.find(
                              (a) => a.id === id,
                            );
                            setAddress(
                              picked
                                ? { ...EMPTY_ADDRESS, street: picked.line }
                                : EMPTY_ADDRESS,
                            );
                          }}
                        />
                      </Form.Item>
                    )}

                    {/* Two per row on a wide screen, one on a phone. The fields
                        come from ADDRESS_FIELDS so the form, the composed line
                        and the completeness check cannot drift apart. */}
                    <Flex gap={12} wrap>
                      {ADDRESS_FIELDS.map((field) => (
                        <Form.Item
                          key={field.key}
                          label={field.label}
                          required={field.required}
                          style={{
                            flex: field.long ? "1 1 100%" : "1 1 220px",
                            marginBottom: 0,
                          }}
                        >
                          {field.long ? (
                            <Input.TextArea
                              rows={2}
                              placeholder={field.placeholder}
                              value={address[field.key]}
                              onChange={(e) =>
                                setAddress((a) => ({
                                  ...a,
                                  [field.key]: e.target.value,
                                }))
                              }
                            />
                          ) : (
                            <Input
                              placeholder={field.placeholder}
                              value={address[field.key]}
                              onChange={(e) =>
                                setAddress((a) => ({
                                  ...a,
                                  [field.key]: e.target.value,
                                }))
                              }
                            />
                          )}
                        </Form.Item>
                      ))}
                    </Flex>

                    {/* The one line that actually gets stored and printed,
                        shown as it is built. Six boxes with no preview is six
                        boxes nobody can check against the courier's form. */}
                    <Typography.Paragraph
                      type="secondary"
                      style={{ marginBottom: 0 }}
                    >
                      {t("pos.willBeSavedAs", "Will be saved as:")}{" "}
                      <Typography.Text>
                        {composeAddress(address) || "—"}
                      </Typography.Text>
                    </Typography.Paragraph>
                    {customerId && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {t(
                          "pos.addressWillBeRemembered",
                          "A new address is saved to this customer when the sale is recorded.",
                        )}
                      </Typography.Text>
                    )}
                  </Flex>
                )}
              </Form>
      </Card>
      <Card
        key="sales"
        title={t("pos.salesDetail", "Sales detail")}
        extra={
          <Typography.Text type="secondary">
                {db.salesmen.find((x) => x.id === salesmanId)?.name ??
                  t("pos.unattributed", "Nobody named")}
              </Typography.Text>
        }
      >
        <Form layout="vertical">
                <Flex gap={12} wrap>
                  <Form.Item
                    label={t("pos.salesperson", "Salesperson")}
                    style={{ flex: "1 1 260px", marginBottom: 0 }}
                    tooltip={t(
                      "pos.whoGetsCreditForThis",
                      "Who gets credit for this sale. Managed in Settings → Salespeople.",
                    )}
                  >
                    <Select
                      showSearch
                      allowClear
                      value={salesmanId}
                      optionFilterProp="label"
                      placeholder={t(
                        "pos.whoMadeThisSale",
                        "Who made this sale?",
                      )}
                      options={db.salesmen
                        .filter((x) => x.active)
                        .map((x) => ({ value: x.id, label: x.name }))}
                      onChange={setSalesmanId}
                    />
                  </Form.Item>
                  <Form.Item
                    label={t("pos.referral", "Referral")}
                    style={{ flex: "1 1 220px", marginBottom: 0 }}
                  >
                    <Select
                      allowClear
                      value={referralId}
                      placeholder={t(
                        "pos.whereDidTheyHearOf",
                        "Where did they hear of us?",
                      )}
                      options={db.referralSources
                        .filter((r) => r.active)
                        .map((r) => ({ value: r.id, label: r.name }))}
                      onChange={setReferralId}
                    />
                  </Form.Item>
                </Flex>
                {totals.upsell > 0 && salesmanId && (
                  <Typography.Text
                    type="success"
                    style={{ fontSize: 12, display: "block", marginTop: 12 }}
                  >
                    {t(
                      "pos.upsellCredit",
                      "{{amount}} above the list price on this sale is credited to them.",
                      { amount: fmtRp(totals.upsell) },
                    )}
                  </Typography.Text>
                )}
              </Form>
      </Card>
    </Flex>
  );

  /**
   * The whole page on a phone (owner ask 2026-09-01).
   *
   * One column, everything full width, and the money **anchored to the bottom
   * of the screen** — which is what the owner asked for and what a till on a
   * phone wants: the total is the number being read out, and it must not be
   * something you scroll to find.
   *
   * Anchored by being the last child of a full-height flex column rather than
   * by `position: fixed`. A fixed bar needs the scrolling content padded by
   * exactly its own height, which nothing can know without measuring it — and
   * a measurement that is a few pixels out either hides the last card or
   * leaves a gap. `PageContainer`'s `fill` gives this column the viewport, the
   * part above scrolls, and the panel simply sits at the end of it.
   */
  const mobileLayout = (
    <Flex vertical gap={12} style={{ flex: 1, minHeight: 0 }}>
      <Flex
        vertical
        gap={12}
        style={{ flex: 1, minHeight: 0, overflow: "auto" }}
      >
        {step === "PRODUCTS" ? cartBody : paymentDetail}
      </Flex>
      {totalPanel}
    </Flex>
  );

  /** The line whose price breakdown the eye button opened. */
  const inspected = inspecting === null ? undefined : lines[inspecting];

  return (
    /*
     * `fill` on a phone, so the page owns the viewport and the money can be
     * anchored to the bottom of it — see `mobileLayout`. On a desktop the page
     * scrolls normally and the right pane is sticky instead.
     */
    <PageContainer
      title={t("pos.pointOfSale", "New Transaction")}
      fill={compact}
    >
      {compact ? (
        mobileLayout
      ) : (
        /*
         * Two steps, one right pane, and they never wrap (owner asks
         * 2026-09-01).
         *
         * The LEFT half swaps — the catalogue on step one, every remaining
         * field on step two — and the sale stays put beside it. Browser zoom
         * shrinks the effective viewport, so a `wrap` here dropped the basket
         * under the catalogue the moment somebody zoomed past about 125%, on a
         * screen physically wide enough for both. Below `md` there is genuinely
         * no room for two columns, and that case is `mobileLayout` rather than
         * a wrap.
         */
        <Flex gap={16} align="stretch" style={{ flex: 1, minWidth: 0 }}>
          {step === "PRODUCTS" ? cataloguePanel : paymentDetail}
          {cartPanel}
        </Flex>
      )}

      {/*
       * The catalogue, as a dialog on a phone.
       *
       * The same panel the desktop shows in a column — one definition, so the
       * search, the category chips and the "one machine left skips the
       * chooser" rule cannot drift between the two. It stays open as machines
       * are added, for the reason the serial chooser does: somebody buying
       * three things should not have to reopen it three times.
       */}
      <Modal
        open={catalogueOpen}
        onCancel={() => setCatalogueOpen(false)}
        footer={
          <Button type="primary" onClick={() => setCatalogueOpen(false)}>
            {t("pos.done", "Done")}
          </Button>
        }
        title={t("pos.stockCatalogue", "Stock catalogue")}
        width="100%"
        style={{ top: 8, maxWidth: "calc(100vw - 16px)" }}
        styles={{ body: { maxHeight: "70vh", overflow: "auto" } }}
        destroyOnHidden
      >
        {cataloguePanel}
      </Modal>

      {/*
       * What a line is actually worth (owner ask 2026-09-01).
       *
       * The list price, what it is being sold for, and the margin — the three
       * the owner named — plus the cost the margin is computed from, because a
       * percentage with no basis is a number nobody can check.
       *
       * Behind a button rather than beside the price, which is the whole
       * change: `Unit.buy` is what the shop paid, and it used to be rendered
       * on the counter-facing screen for every line of every sale.
       */}
      <Modal
        open={inspecting !== null}
        title={t("pos.priceDetail", "Price detail")}
        footer={
          <Button type="primary" onClick={() => setInspecting(null)}>
            {t("pos.close", "Close")}
          </Button>
        }
        onCancel={() => setInspecting(null)}
        width={480}
      >
        {inspected?.serial &&
          (() => {
            const sku = skuOf(inspected.serial);
            const unit = db.units.find((u) => u.serial === inspected.serial);
            const listed = sku?.price ?? 0;
            const charged = inspected.price ?? listed;
            const cost = unit?.buy ?? 0;
            const margin = charged > 0 ? ((charged - cost) / charged) * 100 : null;
            const move = charged - listed;
            return (
              <Flex vertical gap={12}>
                <Typography.Text type="secondary">
                  {sku ? `${sku.name} ${sku.variantLabel}` : ""} ·{" "}
                  <Typography.Text style={{ fontFamily: "monospace" }}>
                    {inspected.serial}
                  </Typography.Text>
                </Typography.Text>
                <Descriptions
                  column={1}
                  size="small"
                  bordered
                  items={[
                    {
                      key: "list",
                      label: t("pos.listPriceLabel", "Original price"),
                      children: fmtRp(listed),
                    },
                    {
                      key: "sell",
                      label: t("pos.sellPrice", "Sell price"),
                      children: (
                        <Flex gap={8} align="center" wrap>
                          <Typography.Text strong>
                            {fmtRp(charged)}
                          </Typography.Text>
                          {move !== 0 && (
                            <Tag color={move < 0 ? "orange" : "green"}>
                              {move < 0
                                ? t("pos.bargainOf", "{{amount}} off", {
                                    amount: fmtRp(-move),
                                  })
                                : t("pos.upsellOf", "{{amount}} above list", {
                                    amount: fmtRp(move),
                                  })}
                            </Tag>
                          )}
                        </Flex>
                      ),
                    },
                    {
                      key: "cost",
                      label: t("pos.whatWePaid", "What the shop paid"),
                      children: cost > 0 ? fmtRp(cost) : "—",
                    },
                    {
                      key: "margin",
                      label: t("pos.margin", "Margin"),
                      children:
                        margin === null ? (
                          "—"
                        ) : (
                          <Typography.Text
                            strong
                            type={margin < 0 ? "danger" : "success"}
                          >
                            {margin.toFixed(1)}%
                          </Typography.Text>
                        ),
                    },
                  ]}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t(
                    "pos.marginOfRevenue",
                    "Margin is of what this sells for, not of cost — the convention the P&L uses.",
                  )}
                </Typography.Text>
              </Flex>
            );
          })()}
      </Modal>

      {/*
       * Which machine, exactly.
       *
       * A catalogue row is a variant and a count; this is where the count
       * becomes a particular second-hand laptop. Grade, battery, shelf and the
       * QC note are all here because they are what makes one of three
       * identical-looking machines the right one to hand over — and because a
       * machine on hold for somebody else has to say so before it is sold to
       * the person standing at the counter.
       *
       * It STAYS OPEN as machines are picked (owner ask 2026-09-01). A
       * customer buying three of the same variant used to have to reopen the
       * dialog per machine, and the dialog reopens on a list that has shifted
       * under them. Picked rows leave the list as they are taken, the count in
       * the title comes down, and *Done* closes it — or it closes itself when
       * there is nothing left to pick.
       */}
      <Modal
        open={pickingSku !== undefined}
        title={t("pos.whichMachine", "Which machine?")}
        footer={
          <Button type="primary" onClick={() => setPickingSku(undefined)}>
            {t("pos.done", "Done")}
          </Button>
        }
        width={720}
        onCancel={() => setPickingSku(undefined)}
      >
        {(() => {
          const row = catalogue.find((r) => r.sku.id === pickingSku);
          if (!row) return null;
          const taken = new Set(lines.map((l) => l.serial));
          const left = row.units.filter((u) => !taken.has(u.serial));
          const chosen = row.units.filter((u) => taken.has(u.serial));
          return (
            <Flex vertical gap={12}>
              <Typography.Text type="secondary">
                {row.sku.name} {row.sku.variantLabel} · {fmtRp(row.sku.price)}
              </Typography.Text>
              {/* What this dialog has already put on the sale, so somebody
                  taking three of a kind can see how many they have without
                  closing it to look at the basket. */}
              {chosen.length > 0 && (
                <Alert
                  type="success"
                  showIcon
                  title={t(
                    "pos.alreadyOnThisSale",
                    "{{count}} on this sale: {{serials}}",
                    {
                      count: chosen.length,
                      serials: chosen.map((u) => u.serial).join(", "),
                    },
                  )}
                />
              )}
              {left.length === 0 && (
                <Typography.Text type="secondary">
                  {t(
                    "pos.allOnThisSale",
                    "Every one of these is already on this sale.",
                  )}
                </Typography.Text>
              )}
              {left.map((u) => {
                const grade = batteryGrade(u.batteryHealth, thresholds);
                const held = u.status === "DIRESERVASI";
                return (
                  <Flex
                    key={u.serial}
                    align="center"
                    gap={12}
                    style={{ padding: "8px 0" }}
                  >
                    <Flex vertical style={{ flex: 1, minWidth: 0 }}>
                      <Typography.Text style={{ fontFamily: "monospace" }}>
                        {u.serial}
                      </Typography.Text>
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12 }}
                        ellipsis
                      >
                        {u.description || t("pos.noNote", "No QC note")}
                      </Typography.Text>
                    </Flex>
                    <GradeTag grade={u.grade} />
                    {grade !== null && (
                      <Tag color={BATTERY_GRADE_COLOR[grade]}>
                        {fmtBatteryHealth(u.batteryHealth)}
                      </Tag>
                    )}
                    {held && (
                      <Tooltip
                        title={t(
                          "pos.heldForSomeone",
                          "On hold for a customer. Selling it here releases the hold.",
                        )}
                      >
                        <Tag color="orange">{t("pos.onHold", "On hold")}</Tag>
                      </Tooltip>
                    )}
                    <Button
                      type="primary"
                      size="small"
                      // Three buttons reading "Pick" down a dialog of three
                      // near-identical machines are three buttons a screen
                      // reader cannot tell apart — and the serial is the whole
                      // point of the dialog.
                      aria-label={t("pos.pickAria", "Pick {{serial}}", {
                        serial: u.serial,
                      })}
                      onClick={() => {
                        addSuggestion(u.serial);
                        // Closes only when this was the last one. Otherwise it
                        // stays open for the next machine — see the docblock.
                        if (left.length === 1) setPickingSku(undefined);
                      }}
                    >
                      {t("pos.pickThisOne", "Pick")}
                    </Button>
                  </Flex>
                );
              })}
            </Flex>
          );
        })()}
      </Modal>

      <TradeInDialog
        open={tradeOpen}
        db={db}
        onCancel={() => setTradeOpen(false)}
        onAdd={(draft) => {
          setTradeIns((prev) => [...prev, { id: nextId("ti"), ...draft }]);
          setTradeOpen(false);
        }}
      />

      {/*
       * Discount, behind a button rather than permanently on the panel.
       *
       * The list shows EVERY code the shop has, not the redeemable ones (owner
       * decision 2026-08-26). A customer quoting a promotion they saw
       * advertised used to produce a code that was simply not in the list, and
       * the operator had no way to tell "expired last week" from "you need one
       * more accessory on the sale". The second of those is an instruction the
       * shop wants acted on, and it was the one being hidden.
       *
       * The free percentage and free amount that used to sit above this list
       * are gone (owner revision 2026-09-01) — see `discountId`.
       */}
      <Modal
        open={discountOpen}
        title={t("pos.discount", "Discount")}
        footer={
          <Button type="primary" onClick={() => setDiscountOpen(false)}>
            {t("pos.done", "Done")}
          </Button>
        }
        width={640}
        onCancel={() => setDiscountOpen(false)}
      >
        <Flex vertical gap={12}>
          {fits.length === 0 && (
            <Typography.Text type="secondary">
              {t("pos.noDiscountsAtAll", "No discounts have been set up yet.")}
            </Typography.Text>
          )}
          {fits.map((fit) => (
            <DiscountRow
              key={fit.discount.id}
              fit={fit}
              selected={discountId === fit.discount.id}
              onPick={() =>
                setDiscountId((prev) =>
                  // A second press takes it off, which is the only way back to
                  // "no discount" from inside a list of one-choice rows.
                  prev === fit.discount.id ? undefined : fit.discount.id,
                )
              }
            />
          ))}
          {chosenBundle && chosenFit?.eligible && (
            <Typography.Paragraph type="success" style={{ marginBottom: 0 }}>
              {t(
                "pos.bundleLanding",
                "{{count}} × {{code}} on {{units}} qualifying unit(s) — {{saving}} off. Bundles take the dearest units first.",
                {
                  count: chosenBundle.complete,
                  code: rule!.code,
                  units: chosenBundle.qualifying,
                  saving: fmtRp(chosenBundle.saving),
                },
              )}
            </Typography.Paragraph>
          )}
        </Flex>
      </Modal>

      {/*
       * "Record this sale?" — the confirmation the owner asked for
       * (2026-09-01).
       *
       * It restates what is about to be written rather than asking a bare
       * yes/no: the total is the number the customer has just been told, the
       * channel and the payment method are the two answers a sale cannot be
       * without, and a below-cost line is named here because this is the last
       * screen before it becomes a fact. Everything on it is a figure already
       * on the panel behind — the dialog adds no new information, which is
       * what makes it safe to confirm quickly.
       */}
      <Modal
        open={confirming}
        title={t("pos.confirmTitle", "Record this sale?")}
        okText={
          belowCost.length > 0
            ? t("pos.recordAtALoss", "Record at a loss")
            : t("pos.confirmOk", "Record it")
        }
        okButtonProps={{ danger: belowCost.length > 0 }}
        cancelText={t("pos.confirmCancel", "Not yet")}
        onCancel={() => setConfirming(false)}
        onOk={() => {
          setConfirming(false);
          submit();
        }}
        width={480}
      >
        <Flex vertical gap={12}>
          <Descriptions
            column={1}
            size="small"
            items={[
              {
                key: "n",
                label: t("pos.itemsLabel", "Machines"),
                children: t("pos.itemCount", "{{count}} item(s)", {
                  count: basket.length,
                }),
              },
              {
                key: "t",
                label: t("pos.total", "Total"),
                children: (
                  <Typography.Text strong>
                    {fmtRp(totals.total)}
                  </Typography.Text>
                ),
              },
              {
                key: "c",
                label: t("pos.channel", "CHANNEL"),
                children: channelOf(source)?.label ?? source,
              },
              {
                key: "p",
                label: t("pos.paymentUpper", "PAYMENT"),
                children: holdsFunds(source)
                  ? t("pos.escrow", "escrow")
                  : payMethod,
              },
              ...(customer
                ? [
                    {
                      key: "who",
                      label: t("pos.customer", "Customer"),
                      children: customer.name,
                    },
                  ]
                : []),
            ]}
          />
          {belowCost.length > 0 && (
            <Alert
              type="warning"
              showIcon
              title={t(
                "pos.linesBelowCost",
                "{{count}} line(s) priced below what the shop paid.",
                { count: belowCost.length },
              )}
              description={t(
                "pos.belowCostBody",
                "Sometimes deliberate — clearing dead stock, honouring a promise. Recording it is fine; going ahead without noticing is not.",
              )}
            />
          )}
          {holdsFunds(source) && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t(
                "pos.marketplaceHolds",
                "{{channel}} is holding the money — confirm it in Income & Expense once it lands.",
                { channel: channelOf(source)?.label ?? source },
              )}
            </Typography.Text>
          )}
        </Flex>
      </Modal>

      {/*
       * And that it landed.
       *
       * A `Result` rather than a toast, because the owner asked for a
       * confirmation and a toast is the one thing on this screen that goes
       * away by itself — with a queue at the counter it is gone before anybody
       * looks up. The order's own code is on it, which is what somebody quotes
       * when the customer rings back.
       */}
      <Modal
        open={recorded !== null}
        onCancel={() => setRecorded(null)}
        footer={null}
        width={480}
        // No close on a mask click: this is the receipt for money that has
        // just changed hands, and dismissing it by accident loses the code.
        // `mask.closable`, not the deprecated `maskClosable` — antd 6 warns on
        // the old prop, and a warning in every test run is a warning nobody
        // reads.
        mask={{ closable: false }}
      >
        <Result
          status="success"
          title={t("pos.recordedTitle", "Sale recorded")}
          subTitle={t(
            "pos.recordedSubtitle",
            "{{code}} · {{total}} · {{count}} item(s)",
            {
              code: recorded?.code ?? "",
              total: fmtRp(recorded?.total ?? 0),
              count: recorded?.serials.length ?? 0,
            },
          )}
          extra={[
            <Button
              key="invoice"
              icon={<PrinterOutlined />}
              onClick={() => {
                setInvoiceFor(recorded);
                setRecorded(null);
              }}
            >
              {t("pos.printInvoice", "Print the invoice")}
            </Button>,
            <Button
              key="next"
              type="primary"
              onClick={() => setRecorded(null)}
            >
              {t("pos.nextSale", "Next sale")}
            </Button>,
          ]}
        />
      </Modal>

      <InvoiceModal
        db={db}
        {...(invoiceFor ? { order: invoiceFor } : {})}
        open={invoiceFor !== null}
        onClose={() => setInvoiceFor(null)}
        headline={t(
          "pos.theSaleIsAlreadyRecorded",
          "The sale is already recorded. Print this now, or find it again later under Finance → Transaction History.",
        )}
      />

      <Modal
        title={t("pos.sellFromAReservation", "Sell from a reservation")}
        open={reservationPickerOpen}
        onCancel={() => setReservationPickerOpen(false)}
        footer={null}
        // Wide enough that the columns fit without the sideways scroll
        // `DataTable`'s `scroll={{ x: "max-content" }}` otherwise puts them
        // behind. Still inside antd's own `max-width: calc(100vw - 32px)` on a
        // 1280-wide laptop.
        width={1160}
      >
        <Typography.Paragraph type="secondary">
          {t(
            "pos.reservationPickerHint",
            "Picking one loads its unit and customer into the sale below. The hold is released when you record the sale, not now.",
          )}
        </Typography.Paragraph>
        <ProTable
          rowKey="id"
          dataSource={activeReservations}
          searchPlaceholder={t(
            "pos.searchSerialProductOrCustomer",
            "Search serial, product or customer",
          )}
          cards={false}
          columns={[
            {
              title: t("pos.customer", "Customer"),
              key: "customer",
              searchable: true,
              sortValue: (r) =>
                db.customers.find((c) => c.id === r.customerId)?.name,
              render: (_, r) =>
                db.customers.find((c) => c.id === r.customerId)?.name,
            },
            {
              // A hold covers one machine or several, so this column is a
              // list. It reads product-then-serial on each line because the
              // product is what the operator is looking for and the serial is
              // what tells two of them apart.
              title: t("pos.units", "Units"),
              key: "units",
              searchable: true,
              searchValue: (r) =>
                heldItems(db, r)
                  .map(
                    (i) =>
                      `${i.serial} ${skuOf(i.serial)?.name ?? ""} ${skuOf(i.serial)?.variantLabel ?? ""}`,
                  )
                  .join(" "),
              render: (_, r) => (
                <Flex vertical gap={2}>
                  {heldItems(db, r).map((i) => (
                    <span key={i.id}>
                      {skuOf(i.serial)?.name ?? "?"}{" "}
                      {skuOf(i.serial)?.variantLabel ?? ""}{" "}
                      <Typography.Text type="secondary">
                        {i.serial}
                      </Typography.Text>
                    </span>
                  ))}
                </Flex>
              ),
            },
            {
              title: t("pos.cameFrom", "Came from"),
              key: "source",
              facet: true,
              sortValue: (r) =>
                db.reservationSources.find((s) => s.id === r.sourceId)?.name ??
                "—",
              render: (_, r) => {
                const name = db.reservationSources.find(
                  (s) => s.id === r.sourceId,
                )?.name;
                return name ? <Tag>{name}</Tag> : "—";
              },
            },
            {
              title: t("pos.holdUntil", "Hold until"),
              dataIndex: "when",
              render: fmtDateTime,
            },
            {
              title: t("pos.price", "Price"),
              key: "price",
              align: "right",
              // The whole hold, since the button below loads the whole hold.
              sortValue: (r) =>
                heldItems(db, r).reduce(
                  (t2, i) => t2 + (priceOf(i.serial) ?? 0),
                  0,
                ),
              render: (_, r) =>
                fmtRp(
                  heldItems(db, r).reduce(
                    (t2, i) => t2 + (priceOf(i.serial) ?? 0),
                    0,
                  ),
                ),
            },
            {
              title: "",
              key: "actions",
              width: 90,
              render: (_, r) => (
                <Button
                  type="primary"
                  size="small"
                  onClick={() => applyReservations([r.id])}
                >
                  {t("pos.useThis", "Use this")}
                </Button>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        title={t("pos.addCustomer", "Add customer")}
        open={newCustomerOpen}
        onCancel={() => setNewCustomerOpen(false)}
        onOk={() =>
          ncForm.validateFields().then((v) => {
            const id = nextId("c");
            mutate((d) => {
              d.customers.push({
                id,
                name: v.name,
                phone: v.phone,
                createdAt: new Date().toISOString(),
              });
            });
            setCustomerId(id);
            setNewCustomerOpen(false);
            ncForm.resetFields();
            message.success(
              t("pos.customerAdded", "{{name}} added.", { name: v.name }),
            );
          })
        }
      >
        <Form form={ncForm} layout="vertical">
          <Form.Item
            name="name"
            label={t("pos.name", "Name")}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="phone"
            label={t("pos.phoneNumber", "Phone number")}
            rules={[{ required: true }]}
          >
            <Input placeholder="+62…" />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}

/** Re-exported so the explain panel and the tests share one vocabulary. */
export type { SignalKey };
