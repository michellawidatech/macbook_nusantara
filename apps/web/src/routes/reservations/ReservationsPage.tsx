/**
 * Phase 5 — reservations put units on hold; cancel releases them, or proceed to
 * Stock Out.
 *
 * Its own nav section since 2026-08-20, which is why this file sits beside the
 * other section folders rather than under `stock/`. The route moved with it:
 * `/reservations`, with `/stock/reservations` redirecting.
 *
 * ## One row per customer, not per serial (owner decision 2026-08-26)
 *
 * A hold is a conversation: somebody asks for two machines to be put aside and
 * comes in on Saturday for one of them. The old page modelled that as two
 * unrelated rows, sorted apart by whatever else was booked in between, so
 * "what is Rina waiting for?" had no answer on screen and cancelling her hold
 * meant finding every row with her name on it.
 *
 * So a row is now a whole hold. The row lists the machines on it — a product
 * and a serial per line, reading across — and picking among them happens in a
 * dialog behind the row's action button (owner revision 2026-08-27). The row
 * itself does not expand.
 *
 * That replaced an expandable row carrying the same tick boxes. Two things
 * were wrong with it. The row LOOKED expandable, because its product and
 * serial columns already stacked several lines, and clicking it opened a
 * second copy of what the reader was already looking at. And the controls that
 * came with it sat at the foot of a row wider than the viewport, which is a
 * place a horizontal scrollbar hides. A dialog is neither: it is the width of
 * the screen, it is the only thing on it, and it is reached by pressing a
 * button that says what it does.
 *
 * `lib/reservations.ts` explains why none of this needs a new column: a
 * machine's state IS its unit's status, and selling two of three leaves the
 * third at `DIRESERVASI` on its own.
 *
 * ## Why the form is a modal
 *
 * It collects a customer, a time, a channel, a note and any number of
 * machines. That is a job with a beginning and an end, and nothing in the
 * table behind it feeds a single field — the definition of a modal rather than
 * an inline form the whole page has to scroll past.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import {
  App,
  Badge,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Flex,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import {
  CheckOutlined,
  PlusOutlined,
  ShoppingCartOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { PageContainer } from "../../components/PageContainer";
import { RequestsTab } from "./RequestsTab";
import { pendingRequestCount } from "../../lib/reservationRequests.js";
import { ProTable } from "../../components/ProTable";
import { EnumTag } from "../../components/EnumTag";
import { GradeTag } from "../../components/GradeTag";
import { LongText } from "../../components/LongText";
import { fmtDate, fmtDateTime, fmtNone, fmtRp } from "../../lib/format.js";
import { customerLabel } from "../../lib/customers.js";
import {
  itemState,
  reprojectHolds,
  softHolds,
} from "../../lib/reservations.js";
import {
  DP_METHODS,
  dpStage,
  keepDp,
  recordDpBlock,
  refundDp,
  type DpMethod,
  type DpStage,
} from "../../lib/dp.js";
import { RecordDpModal } from "../../components/RecordDpModal";
import type { Reservation } from "../../mock/seed.js";
import {
  appendEvent,
  docCode,
  mutate,
  nextId,
  useDb,
} from "../../mock/store.js";
// Types only, and on purpose: the view model below is the SERVER's shape, so
// the render layer does not change when this page goes back to the API.
import type { Hold, HoldItem, HoldState } from "../../lib/reservationsApi.js";
import { tagOf, RESERVATION_STATUS } from "../../i18n/enumLabels.js";
import { COLUMN } from "../../theme/tokens";

/**
 * A row of this page: the server's `Hold`, plus what became of its DP
 * (2026-10-27). Kept beside the server shape rather than in it, because the
 * dormant API does not carry a DP yet.
 */
type HoldRow = Hold & {
  readonly dp?: Reservation["dp"];
  readonly heldUntil?: string;
  readonly dpStage?: DpStage;
};

/**
 * Units still waiting to be collected on this hold — firmly held (a DP) or
 * reserved unpaid, which leaves them on sale (2026-10-27).
 */
const heldOf = (r: Hold): readonly HoldItem[] =>
  r.items.filter((i) => i.state === "HELD" || i.state === "SOFT");

/**
 * A visit — the bot's "janji datang" (2026-10-27): a time and a customer and
 * no units, because the bot holds nothing. Its status is somebody's decision
 * (came, cancelled), not a fact about a unit.
 */
const isVisitRow = (r: Hold) => r.items.length === 0;

/** How far along a hold is, for the one line a table cell can afford. */
const holdProgress = (r: Hold) => ({
  held: r.items.filter((i) => i.state === "HELD" || i.state === "SOFT").length,
  bought: r.items.filter((i) => i.state === "BOUGHT").length,
  released: r.items.filter((i) => i.state === "RELEASED").length,
  total: r.items.length,
});

/**
 * One machine's state, said in the same words as the whole hold's.
 *
 * Mapped onto `RESERVATION_STATUS` rather than given a vocabulary of its own,
 * because the two tags sit inches apart on this screen — the header's in the
 * Status column, the item's in the expanded row — and a hold reading "On hold"
 * above a machine reading "Held" invites the reader to hunt for a distinction
 * that is not there.
 */
const ITEM_STATE: Record<HoldState, string> = {
  HELD: "TERJADWAL",
  // Drawn as its own tag below — "not paid" is the one thing it must say.
  SOFT: "TERJADWAL",
  BOUGHT: "SELESAI",
  RELEASED: "BATAL",
};

/** The shape the modal collects. `serials` is the multi-select. */
interface HoldForm {
  /**
   * The customer, by number and name.
   *
   * Not a picker over an existing list: there is no customers endpoint yet, and
   * the create service already accepts a phone and a name and upserts on the
   * number — create-only, so a bot or a cashier may add somebody the shop has
   * never met and neither may rewrite a customer staff maintain.
   */
  phone: string;
  name: string;
  serials: string[];
  when: dayjs.Dayjs;
  sourceId: string;
  note?: string;
}

export function ReservationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<HoldForm>();
  const [adding, setAdding] = useState(false);
  /**
   * Which machines are ticked, per hold.
   *
   * Keyed by hold id rather than one flat set, because two holds can be open
   * at once and a tick on one must not arm the Check out button on the other —
   * they go to different customers.
   */
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  /** The hold whose units dialog is open, or null. */
  const [managing, setManaging] = useState<Hold | null>(null);
  /**
   * Whether checking out part of a hold also lets the rest go.
   *
   * Off by default, and deliberately: a customer who collects two of three is
   * usually still coming back for the third, and a switch that quietly cancels
   * it would be the expensive default. Reset whenever the dialog opens, so a
   * decision made about one hold cannot carry into the next one.
   */
  const [releaseRest, setReleaseRest] = useState(false);
  /** The hold a DP is being recorded on (2026-10-27). */
  const [recording, setRecording] = useState<HoldRow | null>(null);
  /** The hold whose DP is being refunded or kept. */
  const [deciding, setDeciding] = useState<HoldRow | null>(null);
  /** Holds, or the bot's requests waiting on a person (2026-10-27). */
  const [tab, setTab] = useState<"holds" | "requests">("holds");

  /**
   * The holds themselves, read off the store.
   *
   * ## Why this is not the API any more (2026-09-08)
   *
   * It was, and the migration was right about what it fixed. What it could not
   * fix on its own is that the MACHINES a hold claims live in the store: the
   * till reads `db.units`, and so does Inventory, and so does QC. So a hold
   * created here marked a Postgres unit `DIRESERVASI` while the store's copy
   * of that same machine stayed `TERSEDIA` — and the till sold it, cheerfully,
   * out from under the customer it was being held for. A hold that does not
   * hold anything is worse than a hold nobody can see.
   *
   * That is the rule S/N Tracking came back under a day earlier: a screen may
   * not read from somewhere its own writes do not reach. This one writes units,
   * so it belongs where the units are until they move together.
   *
   * ⚠️ What this costs, stated plainly: a hold the WhatsApp agent books is a
   * real `Reservation` row and is invisible here. Today that is theoretical —
   * `packages/agent`'s `reserve` capability has exactly one caller, the worker,
   * and the worker is not deployed (it is optional on the Mac mini; see
   * docs/deploy-macmini.md §8). The day it ships, this page and the till move to the API
   * together, and `lib/reservationsApi.ts` is still here, tested, for it.
   *
   * The view model is deliberately the SERVER's shape — `Hold` and `HoldItem`
   * are imported as types from `lib/reservationsApi.ts` — so the render layer
   * below is untouched and the move back is a change to this block alone.
   */
  const db = useDb();

  const rows = useMemo((): HoldRow[] => {
    const holds = db.reservations.map((r): HoldRow => {
      const customer = db.customers.find((c) => c.id === r.customerId);
      const channel = db.reservationSources.find((s) => s.id === r.sourceId);
      return {
        id: r.id,
        code: r.code,
        customerId: r.customerId,
        customerName: customer ? customerLabel(customer) : fmtNone(),
        phone: customer?.phone ?? null,
        scheduledFor: r.when,
        note: r.note === "" ? null : r.note,
        // The header projection `lib/reservations.ts` derives. Mapped to the
        // schema's own vocabulary, which is what the tags are keyed on.
        status:
          r.status === "ACTIVE"
            ? "TERJADWAL"
            : r.status === "DONE"
              ? "SELESAI"
              : "BATAL",
        source: "STAF",
        reservationSourceId: r.sourceId ?? null,
        channelName: channel?.name ?? null,
        createdAt: r.when,
        items: r.items.map((i): HoldItem => {
          const unit = db.units.find((u) => u.serial === i.serial);
          const sku = db.skus.find((s) => s.id === unit?.skuId);
          return {
            id: i.id,
            serial: i.serial,
            productName: sku?.name ?? i.serial,
            variantLabel: sku?.variantLabel ?? null,
            grade: unit?.grade ?? null,
            unitStatus: unit?.status ?? null,
            // Never stored: whether a machine is held, bought or let go is a
            // fact about the MACHINE, and a second copy is the one that goes
            // stale. `itemState` is the same derivation the till uses.
            state: itemState(db, i, r),
          };
        }),
        ...(r.dp ? { dp: r.dp } : {}),
        ...(r.heldUntil ? { heldUntil: r.heldUntil } : {}),
        ...(r.dp ? { dpStage: dpStage(db, r) } : {}),
      };
    });
    return holds.sort(
      // Newest conversation first, and holds that still want something ahead
      // of ones that are finished with — a finished hold is a receipt, and a
      // receipt does not belong at the top of a work list.
      (a, b) =>
        Number(b.status === "TERJADWAL") - Number(a.status === "TERJADWAL") ||
        (b.scheduledFor ?? b.createdAt).localeCompare(
          a.scheduledFor ?? a.createdAt,
        ),
    );
  }, [db]);

  /** The channel list, from the same table the API's `/sources` reads. */
  const sourceOptions = useMemo(
    () =>
      db.reservationSources
        .filter((s) => s.active)
        .map((s) => ({ value: s.id, label: s.name })),
    [db.reservationSources],
  );

  /**
   * Sellable machines to offer in the create form.
   *
   * Filtered over the store and capped, rather than asked of the inventory
   * endpoint. The cap is why the search is applied BEFORE it and not by the
   * `Select`: a machine past the cap could otherwise not be found by typing
   * its serial and could not be reserved at all, and an empty dropdown reads
   * as "we do not have that" — the one answer that is certainly wrong.
   */
  const [unitQuery, setUnitQuery] = useState("");
  const availableMatches = useMemo(() => {
    const q = unitQuery.trim().toLowerCase();
    // On sale and not already reserved for somebody else (2026-10-27): a
    // hold without a DP leaves its unit TERSEDIA, and one unit promised to
    // two customers is the promise this page exists to keep.
    const reserved = softHolds(db);
    return db.units
      .filter((u) => u.status === "TERSEDIA" && !reserved.has(u.serial))
      .map((u) => ({ unit: u, sku: db.skus.find((s) => s.id === u.skuId) }))
      .filter(({ unit, sku }) => {
        if (q === "") return true;
        return (
          unit.serial.toLowerCase().includes(q) ||
          (sku?.name ?? "").toLowerCase().includes(q) ||
          (sku?.variantLabel ?? "").toLowerCase().includes(q)
        );
      });
  }, [db, unitQuery]);
  const UNIT_PICKER_CAP = 200;
  const unitOptions = availableMatches
    .slice(0, UNIT_PICKER_CAP)
    .map(({ unit, sku }) => ({
      value: unit.serial,
      label:
        `${unit.serial} — ${sku?.name ?? ""} ${sku?.variantLabel ?? ""}`.trim(),
    }));
  /** How many sellable machines the search matched but the list cannot show. */
  const unitsBeyondPage = Math.max(
    0,
    availableMatches.length - unitOptions.length,
  );

  /**
   * Reserve units for a customer.
   *
   * Since 2026-10-27 this holds NOTHING (owner: *"if reservation makes the
   * stock decrease and reduce sale, it is bad"*): the units stay `TERSEDIA`
   * and on sale, tagged *Reserved for {name}, not paid* at the till and in
   * Inventory. Only a DP holds — recorded on the row once staff have checked
   * the transfer (`RecordDpModal`), which writes the `DIRESERVASI` rows then.
   */
  const [saving, setSaving] = useState(false);
  const addHold = (v: HoldForm) => {
    setSaving(true);
    try {
      const code = docCode("RV");
      mutate((d) => {
        const phone = v.phone.trim();
        const name = v.name.trim();
        // Upsert on the number, matching what the create service does: a
        // cashier may put aside a machine for somebody the shop has never met.
        let customer = d.customers.find((c) => c.phone === phone);
        if (!customer) {
          customer = {
            id: nextId("c"),
            name: name === "" ? phone : name,
            phone,
            createdAt: new Date().toISOString(),
          };
          d.customers.push(customer);
        }
        d.reservations.push({
          id: nextId("rsv"),
          code,
          customerId: customer.id,
          when: v.when.toISOString(),
          note: v.note?.trim() ?? "",
          sourceId: v.sourceId,
          items: v.serials.map((serial) => ({
            id: nextId("rsvi"),
            serial,
          })),
          status: "ACTIVE",
        });
      });
      message.success(
        t(
          "reservations.reservedN",
          "{{count}} unit(s) reserved — still on sale until a DP is recorded.",
          { count: v.serials.length },
        ),
      );
      form.resetFields();
      setAdding(false);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Let machines go.
   *
   * Every held serial at once is what the row-level Cancel does, and it is one
   * mutation either way — so a hold cannot be left half-released by a failure
   * between two of them.
   */
  const releaseNow = (r: Hold, serials: readonly string[]) => {
    if (serials.length === 0) return Promise.resolve();
    const soft = new Set(
      r.items.filter((i) => i.state === "SOFT").map((i) => i.serial),
    );
    mutate((d) => {
      const hold = d.reservations.find((x) => x.id === r.id);
      // A unit held by a DP goes back with its ledger row; one reserved
      // unpaid was never off sale, so it only leaves the list (2026-10-27).
      for (const serial of serials) {
        if (soft.has(serial)) continue;
        appendEvent(d, serial, {
          type: "RESERVASI_BATAL",
          toStatus: "TERSEDIA",
          refCode: r.code,
        });
      }
      if (hold) {
        const wanted = heldOf(r).flatMap((i) => (i.serial ? [i.serial] : []));
        const everything = wanted.every((sn) => serials.includes(sn));
        if (everything && hold.dp === undefined) hold.status = "CANCELLED";
        else
          hold.items = hold.items.filter(
            (i) => !(soft.has(i.serial) && serials.includes(i.serial)),
          );
      }
      reprojectHolds(d, serials);
    });
    setPicked((p) => ({ ...p, [r.id]: [] }));
    setManaging(null);
    message.success(
      t("reservations.releasedN", "{{count}} unit(s) back in stock.", {
        count: serials.length,
      }),
    );
    return Promise.resolve();
  };

  const release = (r: Hold, serials: readonly string[]) => {
    if (serials.length === 0) return;
    modal.confirm({
      title:
        serials.length === heldOf(r).length
          ? t("reservations.cancelThisReservation", "Cancel this reservation?")
          : t("reservations.releaseSelected", "Release the selected units?"),
      content: t(
        "reservations.releaseBody",
        "{{units}} goes back into sellable stock straight away.",
        { units: serials.join(", ") },
      ),
      okText: t("reservations.release", "Release"),
      okButtonProps: { danger: true },
      cancelText: t("reservations.keepTheHold", "Keep the hold"),
      // Awaited, so the dialog stays up until the server has answered and a
      // refusal lands on the dialog rather than behind it. The success toast
      // and the dialog close are the mutation's job now.
      onOk: () => releaseNow(r, serials),
    });
  };

  /**
   * Take the ticked machines — or all of them — to the till.
   *
   * `alsoRelease` is the dialog's "let the rest go" switch. It is applied
   * before the navigation because the store write is the part that must
   * happen — not because the order is load-bearing: `navigate` schedules a
   * router state update rather than unmounting mid-handler, so both orders
   * work today. Writing first keeps it that way if this ever moves behind
   * something that does leave immediately.
   *
   * The release is not confirmed a second time. The switch was the consent,
   * and a confirm dialog on the way to the till is a dialog nobody reads.
   */
  const checkOut = async (
    r: Hold,
    serials: readonly string[],
    alsoRelease: readonly string[] = [],
  ) => {
    if (serials.length === 0) return;
    // AWAITED, unlike the mock version. The release is a network call now, and
    // navigating first would leave a 409 or a dropped connection landing on a
    // page that has already gone — the customer's other machines silently not
    // released, with nothing on screen to say so.
    if (alsoRelease.length > 0) await releaseNow(r, alsoRelease);
    navigate(
      `/stock/out?reservation=${r.id}&serials=${encodeURIComponent(serials.join(","))}`,
    );
  };

  /**
   * Close a visit: the customer came, or is not coming. One `mutate` on the
   * header alone — a visit holds no unit, so there is no ledger row to write.
   */
  const closeVisit = (r: Hold, status: "DONE" | "CANCELLED") => {
    mutate((d) => {
      const visit = d.reservations.find((x) => x.id === r.id);
      if (visit && visit.items.length === 0) visit.status = status;
    });
    message.success(
      status === "DONE"
        ? t("reservations.visitCame", "Visit marked as came.")
        : t("reservations.visitCancelled", "Visit cancelled."),
    );
  };

  const cancelVisit = (r: Hold) =>
    modal.confirm({
      title: t("reservations.cancelVisit", "Cancel this visit?"),
      content: t(
        "reservations.cancelVisitBody",
        "{{name}} is no longer expected. Nothing was held, so no unit moves.",
        { name: r.customerName },
      ),
      okText: t("reservations.cancelVisitOk", "Cancel the visit"),
      okButtonProps: { danger: true },
      cancelText: t("reservations.keepVisit", "Keep it"),
      onOk: () => closeVisit(r, "CANCELLED"),
    });

  /** Open the units dialog for one hold, with nothing assumed about it. */
  const manage = (r: Hold) => {
    setPicked((p) => ({ ...p, [r.id]: [] }));
    setReleaseRest(false);
    setManaging(r);
  };

  /**
   * The machines inside one hold, ticked for checkout.
   *
   * A table rather than a list, because every column answers a different
   * question and three of them are the ones the row promised — product,
   * serial, and what has happened to it. There is no per-machine note column:
   * the note belongs to the hold, not to one of the machines on it (owner
   * revision 2026-08-27), and it is already on the row behind this dialog.
   */
  const unitsTable = (r: Hold) => {
    const held = heldOf(r).flatMap((i) => (i.serial ? [i.serial] : []));
    const chosen = picked[r.id] ?? [];
    const allChosen = held.length > 0 && chosen.length === held.length;

    return (
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={r.items}
        columns={[
          {
            title: (
              <Checkbox
                checked={allChosen}
                indeterminate={chosen.length > 0 && !allChosen}
                disabled={held.length === 0}
                aria-label={t(
                  "reservations.selectAllAria",
                  "Select every unit still on hold",
                )}
                onChange={(e) =>
                  setPicked((p) => ({
                    ...p,
                    [r.id]: e.target.checked ? held : [],
                  }))
                }
              />
            ),
            key: "pick",
            width: COLUMN.tick,
            render: (_, item) => {
              const state = item.state;
              // `ReservationItem.unitId` is nullable in the schema, so an item
              // can in principle name no machine. Nothing creates one today —
              // a quantity-hold would — and it certainly cannot be checked out.
              const serial = item.serial;
              return (
                <Checkbox
                  checked={serial !== null && chosen.includes(serial)}
                  // Only a machine still on hold can be checked out. One
                  // already bought is history; one released is somebody
                  // else's to sell.
                  disabled={
                    (state !== "HELD" && state !== "SOFT") || serial === null
                  }
                  aria-label={t(
                    "reservations.selectAria",
                    "Select {{serial}}",
                    {
                      serial: serial ?? fmtNone(),
                    },
                  )}
                  onChange={(e) =>
                    setPicked((p) => {
                      const now = p[r.id] ?? [];
                      if (serial === null) return p;
                      return {
                        ...p,
                        [r.id]: e.target.checked
                          ? [...now, serial]
                          : now.filter((x) => x !== serial),
                      };
                    })
                  }
                />
              );
            },
          },
          {
            title: t("reservations.product", "Product"),
            key: "product",
            render: (_, item) => item.productName,
          },
          {
            title: t("reservations.serial", "Serial"),
            dataIndex: "serial",
            width: COLUMN.serial,
          },
          {
            // The dialog exists because picking among near-identical machines
            // is a decision (owner revision 2026-08-27), and the grade is
            // half of what that decision is made on.
            title: t("reservations.grade", "Grade"),
            key: "grade",
            width: COLUMN.grade,
            render: (_, item) => <GradeTag grade={item.grade ?? undefined} />,
          },
          {
            title: t("reservations.status", "Status"),
            key: "state",
            width: COLUMN.tag,
            render: (_, item) =>
              item.state === "SOFT" ? (
                <Tag color="gold" style={{ marginInline: 0 }}>
                  {t("dp.notPaid", "Not paid")}
                </Tag>
              ) : (
                <EnumTag
                  map={RESERVATION_STATUS}
                  value={ITEM_STATE[item.state]}
                />
              ),
          },
        ]}
      />
    );
  };

  /**
   * What the hold's money says, under its status (2026-10-27): no DP means
   * nothing is held; a DP holds until a date; a DP whose hold is over waits
   * for a decision; and what was decided.
   */
  const dpLine = (r: HoldRow) => {
    const small = { fontSize: 12 } as const;
    if (r.dp === undefined) {
      // Only where something is reserved unpaid: a hold made before
      // 2026-10-27 holds its units firmly, DP or not, and is left as it was.
      if (!r.items.some((i) => i.state === "SOFT")) return null;
      return (
        <Typography.Text type="warning" style={small}>
          {t("dp.noDpNotHeld", "No DP — still on sale")}
        </Typography.Text>
      );
    }
    const amount = fmtRp(r.dp.amount);
    switch (r.dpStage) {
      case "HOLDING":
        return (
          <Typography.Text type="secondary" style={small}>
            {t("dp.heldUntil", "DP {{amount}} · held until {{until}}", {
              amount,
              until: r.heldUntil ? fmtDate(r.heldUntil) : fmtNone(),
            })}
          </Typography.Text>
        );
      case "DECIDE":
        return (
          <Typography.Text type="danger" style={small}>
            {t("dp.waitingDecision", "DP {{amount}} · hold over, decide", {
              amount,
            })}
          </Typography.Text>
        );
      case "APPLIED":
        return (
          <Typography.Text type="secondary" style={small}>
            {t("dp.applied", "DP {{amount}} · on the sale", { amount })}
          </Typography.Text>
        );
      case "REFUNDED":
        return (
          <Typography.Text type="secondary" style={small}>
            {t("dp.refunded", "DP {{amount}} · refunded", { amount })}
          </Typography.Text>
        );
      case "KEPT":
        return (
          <Typography.Text type="secondary" style={small}>
            {t("dp.kept", "DP {{amount}} · kept (hangus)", { amount })}
          </Typography.Text>
        );
      default:
        return null;
    }
  };

  /** Refund the DP, out of the pot named, or keep it — and end the hold. */
  const [refundMethod, setRefundMethod] = useState<DpMethod>("TRANSFER");
  const decideDp = (r: HoldRow, how: "REFUND" | "KEEP") => {
    const at = new Date().toISOString();
    mutate((d) => {
      if (how === "REFUND")
        refundDp(
          d,
          r.id,
          { id: nextId("pay"), method: refundMethod, at },
          appendEvent,
        );
      else keepDp(d, r.id, at, appendEvent);
    });
    message.success(
      how === "REFUND"
        ? t("dp.refundedToast", "DP {{amount}} refunded to {{name}}.", {
            amount: fmtRp(r.dp?.amount ?? 0),
            name: r.customerName,
          })
        : t("dp.keptToast", "DP {{amount}} kept (hangus).", {
            amount: fmtRp(r.dp?.amount ?? 0),
          }),
    );
    setDeciding(null);
  };
  const openDecide = (r: HoldRow) => {
    setRefundMethod(
      (DP_METHODS as readonly string[]).includes(r.dp?.method ?? "")
        ? (r.dp!.method as DpMethod)
        : "TRANSFER",
    );
    setDeciding(r);
  };

  const pendingRequests = pendingRequestCount(db, new Date());
  const holdsCard = (
    <Card title={t("reservations.reservations", "Reservations")}>
      <ProTable<HoldRow>
        persistKey="reservations"
        rowKey="id"
        dataSource={rows}
        searchPlaceholder={t(
          "reservations.searchSerialProductOrCustomer",
          "Search serial, product or customer",
        )}
        columns={[
          {
            title: t("reservations.customer", "Customer"),
            key: "customer",
            width: COLUMN.code,
            searchable: true,
            facet: true,
            sortValue: (r) => r.customerName,
            render: (_, r) => (
              <Flex vertical>
                <strong>{r.customerName}</strong>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {r.code}
                </Typography.Text>
              </Flex>
            ),
          },
          {
            title: t("reservations.when", "When"),
            dataIndex: "scheduledFor",
            // A date with its time on a second line (2026-09-28: widths
            // are the least the content needs).
            width: COLUMN.date,
            // A hold made through chat may carry no appointment at all —
            // the customer never named one — so the cell has to say that
            // rather than render an empty box.
            render: (v) => (v ? fmtDateTime(v as string) : fmtNone()),
          },
          {
            title: t("reservations.product", "Product"),
            key: "product",
            width: 152,
            searchable: true,
            searchValue: (r) => r.items.map((i) => i.productName).join(" "),
            sortValue: (r) => r.items[0]?.productName ?? "",
            render: (_, r) =>
              isVisitRow(r) ? (
                <Tag color="cyan" style={{ marginInline: 0 }}>
                  {t("reservations.visit", "Visit")}
                </Tag>
              ) : (
                <Flex vertical gap={2}>
                  {r.items.map((i) => (
                    <span key={i.id}>{i.productName}</span>
                  ))}
                </Flex>
              ),
          },
          {
            // Deliberately a second column rather than a line under the
            // product: they line up row for row, so the reader can run a
            // finger across and match the third product to the third
            // serial. That is what "serial per product" asked for.
            title: t("reservations.serial", "Serial"),
            key: "serials",
            width: COLUMN.serial,
            searchable: true,
            searchValue: (r) => r.items.map((i) => i.serial).join(" "),
            render: (_, r) => (
              <Flex vertical gap={2}>
                {r.items.map((i) => (
                  <Typography.Text key={i.id} type="secondary">
                    {i.serial}
                  </Typography.Text>
                ))}
              </Flex>
            ),
          },
          {
            title: t("reservations.cameFrom", "Came from"),
            key: "source",
            width: COLUMN.tag,
            facet: true,
            sortValue: (r) => r.channelName ?? fmtNone(),
            render: (_, r) =>
              r.channelName ? <Tag>{r.channelName}</Tag> : fmtNone(),
          },
          {
            title: t("reservations.note", "Note"),
            dataIndex: "note",
            // A floor, not a size (2026-09-28): the sentence or two staff
            // write wraps over two lines here and takes a wider screen's
            // slack. 140 was the ellipsis nobody could read.
            width: 152,
            render: (v: string) => <LongText>{v}</LongText>,
          },
          {
            title: t("reservations.status", "Status"),
            dataIndex: "status",
            width: COLUMN.status,
            facet: true,
            sortValue: (r) => tagOf(RESERVATION_STATUS, r.status, t).label,
            render: (v: string, r) => {
              const p = holdProgress(r);
              return (
                <Flex vertical gap={2}>
                  <EnumTag map={RESERVATION_STATUS} value={v} />
                  {dpLine(r)}
                  {/* The count only earns its place on a hold that is
                          part-collected — on a single-machine hold the tag
                          above has already said everything. */}
                  {p.total > 1 && p.held > 0 && p.held < p.total && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t(
                        "reservations.heldOfTotal",
                        "{{held}} of {{total}} left",
                        { held: p.held, total: p.total },
                      )}
                    </Typography.Text>
                  )}
                </Flex>
              );
            },
          },
          {
            // Blank by convention: DataTable drops an untitled column to
            // the foot of the card on a phone, where buttons belong.
            title: "",
            key: "actions",
            // One small button, "Units" (2026-09-28: the least it needs).
            width: 112,
            render: (_, r) => {
              // A visit has nothing to sell from and nothing to release:
              // the customer came, or is not coming (2026-10-27).
              if (isVisitRow(r))
                return r.status === "TERJADWAL" ? (
                  <Flex gap={8} wrap>
                    <Button
                      type="primary"
                      size="small"
                      icon={<CheckOutlined />}
                      aria-label={t(
                        "reservations.cameAria",
                        "{{name}} came for {{code}}",
                        { name: r.customerName, code: r.code },
                      )}
                      onClick={() => closeVisit(r, "DONE")}
                    >
                      {t("reservations.came", "Came")}
                    </Button>
                    <Button
                      size="small"
                      danger
                      aria-label={t(
                        "reservations.cancelVisitAria",
                        "Cancel the visit {{code}}",
                        { code: r.code },
                      )}
                      onClick={() => cancelVisit(r)}
                    >
                      {t("reservations.cancel", "Cancel")}
                    </Button>
                  </Flex>
                ) : null;
              const held = heldOf(r).flatMap((i) =>
                i.serial ? [i.serial] : [],
              );
              const reservation = db.reservations.find((x) => x.id === r.id);
              // Only a DP holds (2026-10-27): record one once the
              // transfer is checked, and decide it once the hold is over.
              const canRecord =
                reservation !== undefined &&
                recordDpBlock(db, reservation) === undefined;
              const decide = r.dpStage === "DECIDE";
              if (held.length === 0 && !decide) return null;
              return (
                <Flex gap={8} wrap>
                  {decide && (
                    <Button
                      type="primary"
                      size="small"
                      danger
                      aria-label={t(
                        "dp.decideAria",
                        "Decide the DP on {{code}}",
                        { code: r.code },
                      )}
                      onClick={() => openDecide(r)}
                    >
                      {t("dp.decide", "Decide DP")}
                    </Button>
                  )}
                  {canRecord && (
                    <Button
                      size="small"
                      aria-label={t(
                        "dp.recordAria",
                        "Record a DP on {{code}}",
                        { code: r.code },
                      )}
                      onClick={() => setRecording(r)}
                    >
                      {t("dp.record", "Record DP")}
                    </Button>
                  )}
                  {held.length > 0 && (
                    // One button, and it opens the dialog rather than doing
                    // anything on its own (owner revision 2026-08-27). Two
                    // icon buttons used to sit here — sell everything, cancel
                    // everything — and both acted on a whole hold from a
                    // 100px column, with no step in between where an operator
                    // could see which machines they were about to commit.
                    <Flex gap={8}>
                      <Button
                        type="primary"
                        size="small"
                        icon={<ShoppingCartOutlined />}
                        aria-label={t(
                          "reservations.manageAria",
                          "Open the units on {{code}}",
                          { code: r.code },
                        )}
                        onClick={() => manage(r)}
                      >
                        {t("reservations.units", "Units")}
                      </Button>
                    </Flex>
                  )}
                </Flex>
              );
            },
          },
        ]}
      />
    </Card>
  );

  return (
    <PageContainer
      title={t("reservations.reservation", "Reservation")}
      actions={[
        {
          key: "add",
          label: t("reservations.addReservation", "Add reservation"),
          icon: <PlusOutlined />,
          type: "primary",
          onClick: () => setAdding(true),
        },
      ]}
    >
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as "holds" | "requests")}
        items={[
          {
            key: "holds",
            label: t("reservations.reservations", "Reservations"),
            children: holdsCard,
          },
          {
            // The bot's reservation requests (2026-10-27), waiting on a
            // person to approve or reject.
            key: "requests",
            label: (
              <Flex align="center" gap={6}>
                {t("requests.tab", "Requests")}
                <Badge count={pendingRequests} size="small" />
              </Flex>
            ),
            children: <RequestsTab />,
          },
        ]}
      />

      {/**
       * The units on one hold — the only place they can be picked among.
       *
       * Everything an operator can do to a hold lives here, which is the
       * point of the 2026-08-27 revision: the row shows what is on the hold
       * and this decides what happens to it. Three actions, in the order a
       * counter actually uses them — take everything, take some, or let it
       * all go.
       */}
      <Modal
        open={managing !== null}
        onCancel={() => setManaging(null)}
        title={
          managing
            ? t("reservations.unitsOnHold", "Units on {{code}}", {
                code: managing.code,
              })
            : ""
        }
        width={720}
        footer={null}
        destroyOnHidden
      >
        {managing &&
          (() => {
            // Re-read from `rows` rather than trusting the snapshot captured
            // when the dialog opened: releasing part of a hold mutates the
            // store, and a stale copy would keep offering machines that have
            // already gone back into stock.
            const r = rows.find((x) => x.id === managing.id) ?? managing;
            const held = heldOf(r).flatMap((i) => (i.serial ? [i.serial] : []));
            const chosen = (picked[r.id] ?? []).filter((sn) =>
              held.includes(sn),
            );
            const rest = held.filter((sn) => !chosen.includes(sn));

            return (
              <Flex vertical gap={16}>
                {unitsTable(r)}

                {r.note && (
                  <Typography.Text type="secondary">
                    {/* The hold's note, not any one machine's. It is what the
                        customer actually asked for, and it is the thing an
                        operator needs in front of them while deciding what to
                        hand over. */}
                    {r.note}
                  </Typography.Text>
                )}

                {/* Only ever shown when there IS a rest. With everything
                    ticked the switch would govern an empty set, and a control
                    that does nothing still reads as a control that might. */}
                {rest.length > 0 && chosen.length > 0 && (
                  <Flex align="center" gap={12}>
                    <Switch
                      checked={releaseRest}
                      onChange={setReleaseRest}
                      aria-label={t(
                        "reservations.releaseRestAria",
                        "Cancel the hold on the units not being taken",
                      )}
                    />
                    <Typography.Text>
                      {t(
                        "reservations.releaseRest",
                        "Cancel the hold on the other {{count}} and put them back in stock",
                        { count: rest.length },
                      )}
                    </Typography.Text>
                  </Flex>
                )}

                <Flex gap={8} wrap align="center" justify="flex-end">
                  <Typography.Text
                    type="secondary"
                    style={{ marginRight: "auto" }}
                  >
                    {t(
                      "reservations.pickedCount",
                      "{{picked}} of {{held}} still-held unit(s) selected",
                      { picked: chosen.length, held: held.length },
                    )}
                  </Typography.Text>
                  <Button
                    danger
                    icon={<StopOutlined />}
                    disabled={held.length === 0}
                    onClick={() => release(r, held)}
                  >
                    {t("reservations.cancelTheHold", "Cancel the hold")}
                  </Button>
                  {/* Buy all takes every held machine regardless of what is
                      ticked, so it is not a shortcut for "tick them all and
                      press the other button" — it is the common case, and it
                      never has a rest to release. */}
                  <Button
                    icon={<ShoppingCartOutlined />}
                    disabled={held.length === 0}
                    onClick={() => checkOut(r, held)}
                  >
                    {t("reservations.buyAll", "Buy all {{count}}", {
                      count: held.length,
                    })}
                  </Button>
                  <Button
                    type="primary"
                    icon={<ShoppingCartOutlined />}
                    disabled={chosen.length === 0}
                    onClick={() => checkOut(r, chosen, releaseRest ? rest : [])}
                  >
                    {t("reservations.checkOutSelected", "Check out {{count}}", {
                      count: chosen.length,
                    })}
                  </Button>
                </Flex>
              </Flex>
            );
          })()}
      </Modal>

      <RecordDpModal
        reservation={
          recording
            ? (db.reservations.find((x) => x.id === recording.id) ?? null)
            : null
        }
        customerName={recording?.customerName ?? ""}
        onClose={() => setRecording(null)}
      />

      {/* Refund or keep a DP (2026-10-27). Staff's decision, never the
          worker's: it can release the hold, it cannot move money. */}
      <Modal
        open={deciding !== null}
        onCancel={() => setDeciding(null)}
        title={t("dp.decideTitle", "Decide the DP — {{code}}", {
          code: deciding?.code ?? "",
        })}
        footer={null}
        destroyOnHidden
        width={520}
      >
        {deciding && (
          <Flex vertical gap={16}>
            <Typography.Text>
              {t(
                "dp.decideBody",
                "{{name}} paid a DP of {{amount}} and did not complete the purchase. Refund it, or keep it (hangus)?",
                {
                  name: deciding.customerName,
                  amount: fmtRp(deciding.dp?.amount ?? 0),
                },
              )}
            </Typography.Text>
            {deciding.dpStage === "HOLDING" && (
              <Typography.Text type="warning">
                {t(
                  "dp.decideEarly",
                  "The hold has not run out yet — deciding now puts its units back on sale.",
                )}
              </Typography.Text>
            )}
            <Flex align="center" gap={8} wrap>
              <Typography.Text>
                {t("dp.refundFrom", "Refund from")}
              </Typography.Text>
              <Segmented<DpMethod>
                value={refundMethod}
                onChange={setRefundMethod}
                options={DP_METHODS.map((m) => ({
                  value: m,
                  label:
                    m === "TRANSFER"
                      ? t("pos.methodTransfer", "Transfer")
                      : t("pos.methodCash", "Cash"),
                }))}
              />
            </Flex>
            <Flex gap={8} justify="flex-end" wrap>
              <Button onClick={() => decideDp(deciding, "KEEP")}>
                {t("dp.keep", "Keep (hangus)")}
              </Button>
              <Button
                type="primary"
                onClick={() => decideDp(deciding, "REFUND")}
              >
                {t("dp.refund", "Refund {{amount}}", {
                  amount: fmtRp(deciding.dp?.amount ?? 0),
                })}
              </Button>
            </Flex>
          </Flex>
        )}
      </Modal>

      <Modal
        open={adding}
        onCancel={() => setAdding(false)}
        onOk={() => form.submit()}
        okButtonProps={{ loading: saving }}
        okText={t("reservations.reserve", "Reserve")}
        title={t("reservations.addReservation", "Add reservation")}
        width={640}
        destroyOnHidden
      >
        <Form<HoldForm>
          form={form}
          layout="vertical"
          initialValues={{ when: dayjs().add(1, "day") }}
          onFinish={addHold}
        >
          {/* The number is the customer's identity: `Customer.phone` is unique,
              and the service upserts on it — create-only, so a hold made at the
              counter for somebody the shop already knows attaches to the
              existing row and never rewrites their name. */}
          <Flex gap={16} wrap>
            <Form.Item
              name="phone"
              label={t("customers.phone", "Phone")}
              rules={[
                {
                  required: true,
                  message: t("form.pickCustomer", "Pick a customer"),
                },
              ]}
              style={{ flex: "1 1 220px" }}
            >
              <Input placeholder="+62812..." maxLength={20} />
            </Form.Item>
            <Form.Item
              name="name"
              label={t("customers.name", "Name")}
              rules={[
                {
                  required: true,
                  message: t("form.pickCustomer", "Pick a customer"),
                },
              ]}
              style={{ flex: "1 1 220px" }}
            >
              <Input maxLength={120} />
            </Form.Item>
          </Flex>
          {/* The multi-select is the whole point of the modal: one hold, as
              many machines as the conversation covered. Only sellable units
              are offered — a machine already on hold for somebody else is not
              the shop's to promise twice. */}
          <Form.Item
            name="serials"
            label={t("reservations.units", "Units")}
            rules={[
              {
                required: true,
                message: t("form.pickUnit", "Pick at least one unit"),
              },
            ]}
          >
            <Select
              mode="multiple"
              showSearch
              // Filtered before the cap — see `availableMatches`. antd must
              // not filter as well, or it would narrow a list that has already
              // been narrowed and hide rows that genuinely matched.
              filterOption={false}
              onSearch={setUnitQuery}
              placeholder={t("reservations.availableUnit", "Available unit")}
              options={unitOptions}
              notFoundContent={t(
                "reservations.noUnitMatch",
                "No unit matches that.",
              )}
              popupRender={(menu) => (
                <>
                  {menu}
                  {unitsBeyondPage > 0 && (
                    <Typography.Text
                      type="secondary"
                      style={{ display: "block", padding: "4px 12px" }}
                    >
                      {t(
                        "reservations.moreUnits",
                        "{{count}} more match — keep typing to narrow it.",
                        { count: unitsBeyondPage },
                      )}
                    </Typography.Text>
                  )}
                </>
              )}
            />
          </Form.Item>
          <Flex gap={16} wrap>
            <Form.Item
              name="sourceId"
              label={t("reservations.cameFrom", "Came from")}
              rules={[
                {
                  required: true,
                  message: t("form.pickSource", "Where did this come from?"),
                },
              ]}
              style={{ flex: "1 1 220px" }}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder={t("reservations.cameFrom", "Came from")}
                options={sourceOptions}
              />
            </Form.Item>
            <Form.Item
              name="when"
              label={t("reservations.expectedOn", "Expected on")}
              rules={[
                { required: true, message: t("form.pickTime", "Pick a time") },
              ]}
              style={{ flex: "1 1 220px" }}
            >
              <DatePicker
                showTime
                format="DD MMM YYYY HH:mm"
                style={{ width: "100%" }}
              />
            </Form.Item>
          </Flex>
          <Form.Item name="note" label={t("reservations.note", "Note")}>
            {/* Two rows, not one line: what staff write here is "collecting
                Saturday, wants the charger checked first", and a single-line
                input hides the second half of it behind a caret. */}
            <Input.TextArea
              rows={2}
              maxLength={280}
              showCount
              placeholder={t(
                "reservations.notePlaceholder",
                "When they are collecting, what they asked for, anything the next person needs to know",
              )}
            />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
