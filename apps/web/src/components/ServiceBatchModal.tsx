/**
 * Send units to service, or bring them back — several at once (owner ask
 * 2026-10-30: *"in service feature, make it so that they can add multiple
 * product"*). Stock out → Service and Stock in → Service open it with the
 * serials already typed; `SendToServiceModal` is this dialog with one serial.
 *
 * **One courier, many units.** A batch travels in one box, so the dialog asks
 * for ONE courier fee and how it was paid, and a switch decides where it goes:
 *
 * - **Split into each unit's cost** (on by default): the fee is divided evenly
 *   over the units that travel (`splitEvenly` — the rupiah that do not divide
 *   go to the first), each share a SHIPPING charge on that unit's visit, so it
 *   is in the unit's COGS exactly as a single unit's courier always was.
 * - **Off**: no unit's cost moves; the fee is ONE shop expense of kind
 *   `ONGKIR` ("Shipping / ongkir"). An expense is money that moved, so "Not
 *   paid yet" is not offered then.
 *
 * **No repair price** (owner 2026-10-30, "no price yet"). The repairer's bill
 * is added later on the Service page with *+ Charge*, which puts it in the
 * unit's COGS; the send asks only where, the courier, and a description.
 *
 * **A title for the batch** (owner ask 2026-11-11), asked on a send and
 * written on every visit of it, so the bench can tell two trips apart by
 * name rather than by the minute they left.
 *
 * **Back in stock asks what each unit's repair cost** (owner ask
 * 2026-11-11): a Repair cost box per row, with Fill down, and only the rows
 * with a cost typed go back — the button says how many. 0 is a cost (a free
 * repair); an empty box is "not back yet". Each cost is a LABOUR charge on
 * the unit's visit, so it reaches the unit's COGS like any *+ Charge*.
 *
 * **Back in stock is the cost and how it was paid, nothing more** (owner ask
 * 2026-11-13: *"they are expecting just to input the charge per unit and they
 * can fill down"*). The "What was done" box per unit is gone, Paid with sits
 * right under the costs, and the warehouse and courier follow. Opened on a
 * batch from the Service page (`fixed`) it lists that batch and nothing else:
 * no add box and no remove — a unit left blank simply stays at service.
 *
 * **Add back in stock** (owner ask 2026-11-13: *"I just need a button that
 * says 'Add back in stock'; when they scan, it will check if that unit is in
 * Service, they can add fee, and put all back in stock. That's it."*) is this
 * dialog opened empty from the Service page with `bringAll`: a serial scanned
 * or typed is checked at once, one that cannot come back is listed on its OWN
 * row with the reason (`backInStockBlock`) and counts for nothing, and every
 * unit that can come back does — a blank cost is no charge, because scanning
 * it in was the decision.
 *
 * Everything is read again INSIDE the mutation: a unit can be reserved, sold
 * or brought back in another tab between the render and the press, and such a
 * unit is skipped and named rather than written.
 */
import { useEffect, useRef, useState } from "react";
import {
  App,
  AutoComplete,
  Button,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Switch,
  Table,
  Tooltip,
  Typography,
} from "antd";
import { DeleteOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { ServiceUnitPicker } from "./ServiceUnitPicker";
import { useTranslation } from "react-i18next";
import { RP_SYMBOL, moneyFormatter, moneyParser } from "./money";
import { usePaidWithLabel } from "./SendToServiceModal";
import {
  PAID_WITH,
  chargeExpense,
  localDay,
  planSendToService,
  sendToServiceBlock,
  type PaidWith,
} from "../lib/serviceActions.js";
import {
  backInStockBlock,
  openVisit,
  visitCost,
  type BackBlock,
  type ServiceRec,
} from "../lib/service.js";
import { resolveSerialQuery } from "../lib/serialInput.js";
import { UNIT_STATUS, tagOf } from "../i18n/enumLabels.js";
import { splitEvenly } from "../lib/stockReasons.js";
import { normaliseSerial } from "../lib/adjustmentBatch.js";
import { fmtRp } from "../lib/format.js";
import { warehouseLabel, warehouseLabelOf } from "../lib/warehouses.js";
import {
  appendEvent,
  currentStaffName,
  mutate,
  nextId,
  useDb,
} from "../mock/store.js";
import { COLUMN, SPACE, TYPE } from "../theme/tokens";
import type { MockDb } from "../mock/seed.js";

export interface ServiceBatchModalProps {
  /** SEND to service, or bring BACK into stock. */
  readonly mode: "SEND" | "BACK";
  /** The units it opens with; null while it is shut. */
  readonly serials: readonly string[] | null;
  /** Which desk sent it (SEND only). */
  readonly raisedBy?: ServiceRec["raisedBy"];
  /** The invoice, when QC sends it. */
  readonly poId?: string;
  /** The document the send event names — the invoice's code at QC. */
  readonly refCode?: string;
  /** One unit and no list — the single-unit door (`SendToServiceModal`). */
  readonly single?: boolean;
  /**
   * The units are a batch's and the list is not edited: no add box, no
   * remove (BACK from the Service page, 2026-11-13).
   */
  readonly fixed?: boolean;
  /**
   * BACK, opened empty from the Service page's *Add back in stock*
   * (2026-11-13): every unit listed goes back, a blank cost is no charge, and
   * a serial that cannot come back stays on its own row with the reason.
   */
  readonly bringAll?: boolean;
  readonly onClose: () => void;
  readonly zIndex?: number;
}

interface Row {
  readonly serial: string;
  description: string;
  /** BACK only: what the repair cost. Null = not filled = not going back. */
  cost: number | null;
  /** `bringAll` only: why this serial cannot come back. Never recorded. */
  block?: BackBlock;
}

const MONEY_INPUT = {
  min: 0,
  precision: 0,
  prefix: RP_SYMBOL,
  formatter: moneyFormatter,
  parser: moneyParser,
  style: { width: "100%" },
} as const;

/** May this unit be on the batch? */
function eligible(db: MockDb, mode: "SEND" | "BACK", serial: string): boolean {
  const u = db.units.find((x) => x.serial === serial);
  if (!u) return false;
  return mode === "SEND"
    ? sendToServiceBlock(u.status) === undefined
    : backInStockBlock(db, serial) === undefined;
}

export function ServiceBatchModal({
  mode,
  serials,
  raisedBy = "ADJUSTMENT",
  poId,
  refCode,
  single = false,
  fixed = false,
  bringAll = false,
  onClose,
  zIndex,
}: ServiceBatchModalProps) {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();
  const paidWord = usePaidWithLabel();
  const open = serials !== null;

  const [rows, setRows] = useState<Row[]>([]);
  const [adding, setAdding] = useState("");
  const [addMiss, setAddMiss] = useState<string | null>(null);
  const [dest, setDest] = useState<string | undefined>(undefined);
  const [fee, setFee] = useState<number | null>(null);
  const [paid, setPaid] = useState<PaidWith>("UNPAID");
  const [split, setSplit] = useState(true);
  /** SEND: the batch's name. */
  const [batchTitle, setBatchTitle] = useState("");
  /** BACK: how the repair costs were paid. */
  const [repairPaid, setRepairPaid] = useState<PaidWith>("UNPAID");
  /** The dialog's body, for putting the caret in the first cost box. */
  const bodyRef = useRef<HTMLDivElement>(null);
  /** The list picker (2026-11-10): any unit on a shelf or in QC. */
  const [picking, setPicking] = useState(false);
  /** Somebody chose the warehouse; the first unit scanned must not move it. */
  const [destTouched, setDestTouched] = useState(false);

  // A fresh batch each time it opens, from the serials it was handed. The ones
  // that cannot go are left off and named, rather than refused at the end.
  useEffect(() => {
    if (serials === null) return;
    const ok = serials.filter((s) => eligible(db, mode, s));
    const skipped = serials.filter((s) => !ok.includes(s));
    setRows(ok.map((serial) => ({ serial, description: "", cost: null })));
    setAdding("");
    setAddMiss(null);
    setFee(null);
    setPaid("UNPAID");
    setSplit(true);
    setBatchTitle("");
    setRepairPaid("UNPAID");
    setDestTouched(false);
    const first = ok[0] ? db.units.find((u) => u.serial === ok[0]) : undefined;
    setDest(
      mode === "SEND"
        ? (first?.locationId ?? db.myWarehouseId)
        : (openVisit(ok[0] ?? "", db.services)?.fromLocationId ??
            db.myWarehouseId),
    );
    if (skipped.length > 0)
      message.warning(
        mode === "SEND"
          ? t(
              "serviceBatch.skippedSend",
              "Left off — not in QC or on the shelf: {{serials}}",
              { serials: skipped.join(", ") },
            )
          : t(
              "serviceBatch.skippedBack",
              "Left off — not at service: {{serials}}",
              { serials: skipped.join(", ") },
            ),
      );
    // Opening is the event; the store moving under an open dialog is not.
  }, [serials]);

  /*
   * Back in stock opens typing (owner 2026-11-13: "they can open that,
   * immediately start typing, done"): the caret goes to the first unit's
   * cost box, and Enter walks down them (KeyboardNav). After the open, not
   * `autoFocus` — the Modal's focus trap takes the caret to its first button.
   */
  useEffect(() => {
    if (serials === null || mode !== "BACK") return;
    const timer = setTimeout(() => {
      // Opened empty to scan into (`bringAll`): the caret waits in the box.
      bodyRef.current
        ?.querySelector<HTMLInputElement>(
          serials.length === 0 && bringAll
            ? "input[data-scan-target]"
            : "input[data-repair-cost]",
        )
        ?.focus();
    }, 60);
    return () => clearTimeout(timer);
  }, [serials, mode]);

  const unitOf = (serial: string) => db.units.find((u) => u.serial === serial);
  const skuName = (serial: string) => {
    const k = db.skus.find((s) => s.id === unitOf(serial)?.skuId);
    return k ? `${k.name} · ${k.variantLabel}` : "";
  };
  /** Why a listed serial cannot come back, said on its row. */
  const blockReason = (r: Row): string => {
    switch (r.block) {
      case "UNKNOWN":
        return t("serviceBatch.blockUnknown", "No unit has this serial.");
      case "NOT_AT_SERVICE":
        return t(
          "serviceBatch.blockNotAtService",
          "Not at service — it is {{status}}.",
          {
            status: tagOf(
              UNIT_STATUS,
              unitOf(r.serial)?.status,
              t,
            ).label.toLowerCase(),
          },
        );
      case "NO_VISIT":
        return t(
          "serviceBatch.blockNoVisit",
          "No open service visit names it.",
        );
      default:
        return "";
    }
  };
  /**
   * The rows this press records: every row on a send; on Back in stock only
   * the ones with a repair cost typed (owner ask 2026-11-11).
   */
  const active =
    mode === "BACK"
      ? rows.filter((r) => (bringAll ? r.block === undefined : r.cost !== null))
      : rows;
  /** The units that change warehouse — the ones a courier carried. */
  const travellers = active.filter(
    (r) => dest !== undefined && unitOf(r.serial)?.locationId !== dest,
  );
  const feeAsked = travellers.length > 0;
  const hasFee = feeAsked && (fee ?? 0) > 0;

  const addSerial = (raw: string) => {
    const typed = normaliseSerial(raw);
    // A scan of a new unit's barcode carries the `S` its serial was filed
    // without: read it back to the stored serial, inventing nothing.
    const serial = bringAll
      ? resolveSerialQuery(
          typed,
          db.units.map((u) => u.serial),
        )
      : typed;
    if (!serial) return;
    if (rows.some((r) => r.serial === serial)) {
      setAdding("");
      return;
    }
    if (bringAll) {
      const block = backInStockBlock(db, serial);
      setAddMiss(null);
      // The warehouse it set out from, for the first unit that can come back
      // — unless somebody already chose one.
      if (
        block === undefined &&
        !destTouched &&
        !rows.some((r) => r.block === undefined)
      ) {
        const from = openVisit(serial, db.services)?.fromLocationId;
        if (from) setDest(from);
      }
      setRows((rs) =>
        rs.some((r) => r.serial === serial)
          ? rs
          : [
              ...rs,
              {
                serial,
                description: "",
                cost: null,
                ...(block ? { block } : {}),
              },
            ],
      );
      setAdding("");
      return;
    }
    if (!eligible(db, mode, serial)) {
      setAddMiss(serial);
      return;
    }
    setAddMiss(null);
    // Enter and the list's own select can both fire for one serial; the
    // updater sees the other's row, a closure over `rows` would not.
    setRows((rs) =>
      rs.some((r) => r.serial === serial)
        ? rs
        : [...rs, { serial, description: "", cost: null }],
    );
    setAdding("");
  };

  /** Units chosen from the list; ones that cannot go are skipped. */
  const addMany = (serials: readonly string[]) =>
    setRows((rs) => [
      ...rs,
      ...serials
        .filter((s) => eligible(db, mode, s) && !rs.some((r) => r.serial === s))
        .map((serial) => ({ serial, description: "", cost: null })),
    ]);

  const candidates = db.units
    .filter(
      (u) =>
        eligible(db, mode, u.serial) &&
        !rows.some((r) => r.serial === u.serial),
    )
    .map((u) => ({
      value: u.serial,
      label: u.serial,
      product: skuName(u.serial),
    }));

  const setDescription = (serial: string, description: string) =>
    setRows((rs) =>
      rs.map((r) => (r.serial === serial ? { ...r, description } : r)),
    );
  const setCost = (serial: string, cost: number | null) =>
    setRows((rs) => rs.map((r) => (r.serial === serial ? { ...r, cost } : r)));
  /** The first cost typed, copied into every empty box below it. */
  const fillDownCost = () =>
    setRows((rs) => {
      const i = rs.findIndex((r) => r.cost !== null);
      if (i < 0) return rs;
      const first = rs[i]!.cost;
      return rs.map((r, j) =>
        j > i && r.cost === null ? { ...r, cost: first } : r,
      );
    });
  const fillDown = () =>
    setRows((rs) => {
      const first = rs.find((r) => r.description.trim() !== "")?.description;
      return first === undefined
        ? rs
        : rs.map((r) =>
            r.description.trim() === "" ? { ...r, description: first } : r,
          );
    });

  const toggleSplit = (on: boolean) => {
    setSplit(on);
    // An expense is money that moved: off the units, "not paid yet" has
    // nowhere to be.
    if (!on && paid === "UNPAID") setPaid("TRANSFER");
  };

  const submit = () => {
    if (active.length === 0 || dest === undefined) return;
    const picked = active;
    const at = new Date().toISOString();
    const day = localDay(at);
    const staff = currentStaffName();
    const out = { done: [] as string[], refused: [] as string[] };
    const courier = hasFee ? (fee ?? 0) : 0;
    void mutate((d) => {
      const going = picked.filter((r) => eligible(d, mode, r.serial));
      out.refused = picked
        .filter((r) => !going.includes(r))
        .map((r) => r.serial);
      const moving = going.filter(
        (r) => d.units.find((u) => u.serial === r.serial)?.locationId !== dest,
      );
      const shares = split ? splitEvenly(courier, moving.length) : [];
      const shareOf = (serial: string) => {
        const i = moving.findIndex((r) => r.serial === serial);
        return i < 0 ? 0 : (shares[i] ?? 0);
      };
      for (const r of going) {
        const u = d.units.find((x) => x.serial === r.serial)!;
        const share = shareOf(r.serial);
        if (mode === "SEND") {
          const plan = planSendToService({
            unit: { serial: r.serial, locationId: u.locationId },
            dest,
            shippingFee: share > 0 ? share : undefined,
            shippingPaid: paid,
            note: r.description,
            title: batchTitle,
            raisedBy,
            poId,
            at,
            staff,
            words: {
              shipLabel: t("inbound.serviceShipLabel", "Courier to service"),
              quoteLabel: t("service.quoteLabel", "Quoted when sent"),
              eventNote:
                dest !== u.locationId
                  ? `Sent to service — ${warehouseLabelOf(d.warehouses, dest) ?? dest}`
                  : "Sent to service",
            },
            nextId,
          });
          appendEvent(d, r.serial, {
            ...plan.event,
            ...(refCode ? { refCode } : {}),
          });
          if (plan.travelling) u.rackId = undefined;
          d.services.push(plan.visit);
          for (const e of plan.expenses) d.expenses.unshift(e);
        } else {
          const i = d.services.findIndex(
            (v) => v.serial === r.serial && v.closedAt === undefined,
          );
          let closed = i >= 0 ? d.services[i]! : undefined;
          // The repair, as a LABOUR charge on the visit, with its own line
          // on the unit's timeline (the *+ Charge* shape, SERVIS → SERVIS at
          // the same instant, which is how deleting the charge finds it).
          const cost = r.cost ?? 0;
          if (closed && cost > 0) {
            const repair = {
              id: nextId("svcf"),
              kind: "LABOUR" as const,
              label: t("service.repairLabel", "Repair"),
              amount: cost,
              at,
              staff,
              ...(repairPaid !== "UNPAID" ? { paid: true as const } : {}),
            };
            closed = { ...closed, fees: [...closed.fees, repair] };
            if (repairPaid !== "UNPAID")
              d.expenses.unshift(
                chargeExpense({
                  id: nextId("exp"),
                  serial: r.serial,
                  fee: repair,
                  method: repairPaid,
                  day,
                  createdAt: at,
                }),
              );
            appendEvent(d, r.serial, {
              type: "DICATAT",
              at,
              note: `Service charge ${fmtRp(cost)} — ${repair.label}`,
            });
          }
          if (closed) {
            const transfer =
              share > 0
                ? {
                    id: nextId("svcf"),
                    kind: "SHIPPING" as const,
                    label: t("service.transferLabel", "Transfer out"),
                    amount: share,
                    at,
                    staff,
                    ...(paid !== "UNPAID" ? { paid: true as const } : {}),
                  }
                : undefined;
            closed = {
              ...closed,
              fees: transfer ? [...closed.fees, transfer] : closed.fees,
              closedAt: at,
              toLocationId: dest,
            };
            d.services[i] = closed;
            if (transfer && paid !== "UNPAID")
              d.expenses.unshift(
                chargeExpense({
                  id: nextId("exp"),
                  serial: r.serial,
                  fee: transfer,
                  method: paid,
                  day,
                  createdAt: at,
                }),
              );
          }
          // Back to QC for a re-check, never straight onto the shelf
          // (owner, 2026-11-04: "every serviced unit will go to QC").
          appendEvent(d, r.serial, {
            type: "DICATAT",
            toStatus: "QC",
            toLocationId: dest,
            at,
            note: [
              `Back from service — ${warehouseLabelOf(d.warehouses, dest) ?? dest}`,
              r.description.trim(),
              closed ? `repair cost ${fmtRp(visitCost(closed))}` : undefined,
            ]
              .filter(Boolean)
              .join(" · "),
          });
          u.rackId = undefined;
        }
        out.done.push(r.serial);
      }
      // The courier kept as the shop's own cost, once for the whole box.
      if (!split && courier > 0 && moving.length > 0 && paid !== "UNPAID")
        d.expenses.unshift({
          id: nextId("exp"),
          kind: "ONGKIR",
          amount: courier,
          date: day,
          method: paid,
          note: `${mode === "SEND" ? "Courier to service" : "Courier back from service"} · ${moving.map((r) => r.serial).join(", ")}`,
          createdAt: at,
        });
    });
    if (out.refused.length > 0)
      message.warning(
        t(
          "serviceBatch.refused",
          "Not recorded — they changed in the meantime: {{serials}}",
          { serials: out.refused.join(", ") },
        ),
      );
    if (out.done.length > 0)
      message.success(
        mode === "SEND"
          ? t("serviceBatch.sent", "{{count}} unit(s) sent to service.", {
              count: out.done.length,
            })
          : t("serviceBatch.back", "{{count}} unit(s) back in stock.", {
              count: out.done.length,
            }),
      );
    onClose();
  };

  const destOptions = db.warehouses
    .filter((w) => w.active || w.id === dest)
    .map((w) => ({ value: w.id, label: warehouseLabel(w) }));
  /*
   * The single-unit door stays one unit's dialog only while it holds one
   * unit (2026-11-04: "when they want to add multiple unit to service we
   * cannot"). Its add box is always drawn; a second unit turns it into the
   * batch dialog, with the table of units and one description each.
   */
  const asOne = single && rows.length <= 1;
  const oneSerial = asOne ? (rows[0]?.serial ?? serials?.[0] ?? "") : "";

  const title =
    mode === "SEND"
      ? asOne
        ? t("service.sendTitle", "Send {{serial}} to service", {
            serial: oneSerial,
          })
        : t("serviceBatch.sendTitle", "Send units to service")
      : asOne
        ? t("service.backTitle", "Put {{serial}} back in stock", {
            serial: oneSerial,
          })
        : bringAll
          ? t("serviceBatch.addBackTitle", "Add back in stock")
          : t("serviceBatch.backTitle", "Bring units back from service");

  const descriptionLabel =
    mode === "SEND"
      ? t("serviceBatch.description", "Description")
      : t("service.backNote", "What was done");

  return (
    <Modal
      open={open}
      centered
      zIndex={zIndex}
      width={asOne ? 520 : 860}
      title={title}
      okText={
        mode === "SEND"
          ? t("inbound.serviceOk", "Send to service")
          : asOne
            ? t("service.backOk", "Back in stock")
            : t("service.batchBack", "Back in stock ({{count}})", {
                count: active.length,
              })
      }
      okButtonProps={{ disabled: active.length === 0 || dest === undefined }}
      onCancel={onClose}
      onOk={submit}
      destroyOnHidden
    >
      <div ref={bodyRef}>
        <Form layout="vertical">
          {mode === "SEND" && (
            <Form.Item label={t("serviceBatch.title", "Batch name")}>
              <Input
                aria-label={t("serviceBatch.title", "Batch name")}
                placeholder={t(
                  "serviceBatch.titleHint",
                  "e.g. Screens to Pak Budi",
                )}
                maxLength={80}
                value={batchTitle}
                onChange={(e) => setBatchTitle(e.target.value)}
              />
            </Form.Item>
          )}
          {
            <Flex vertical gap={SPACE.xs} style={{ marginBottom: SPACE.md }}>
              {!fixed && (
                <Flex gap={SPACE.xs}>
                  <AutoComplete
                    style={{ flex: 1 }}
                    value={adding}
                    options={candidates}
                    defaultActiveFirstOption={false}
                    optionRender={(opt) => (
                      <Flex vertical>
                        <span>{String(opt.value)}</span>
                        <Typography.Text
                          type="secondary"
                          style={{ fontSize: TYPE.sm }}
                        >
                          {String(opt.data.product ?? "")}
                        </Typography.Text>
                      </Flex>
                    )}
                    filterOption={(input, opt) =>
                      `${opt?.value ?? ""} ${opt?.product ?? ""}`
                        .toLowerCase()
                        .includes(input.trim().toLowerCase())
                    }
                    onChange={(v: string) => {
                      const text = normaliseSerial(v);
                      setAddMiss(null);
                      // A whole serial, and not the head of a longer one, goes in at
                      // once — the till's rule (`serialNamedBy`): a scan lands
                      // without anybody reaching for Enter.
                      const whole = candidates.some((c) => c.value === text);
                      const longer = candidates.some(
                        (c) => c.value !== text && c.value.startsWith(text),
                      );
                      if (whole && !longer) addSerial(text);
                      else setAdding(v.toUpperCase());
                    }}
                    onSelect={(v: string) => addSerial(v)}
                  >
                    <Input
                      aria-label={t("serviceBatch.addSerial", "Add a unit")}
                      placeholder={t(
                        "serviceBatch.addSerialHint",
                        "Scan or type a serial, then Enter",
                      )}
                      onPressEnter={(e) => {
                        e.preventDefault();
                        addSerial(adding);
                      }}
                      data-scan-target=""
                    />
                  </AutoComplete>
                  {mode === "SEND" && (
                    <Button
                      icon={<UnorderedListOutlined />}
                      onClick={() => setPicking(true)}
                    >
                      {t("servicePicker.open", "Choose from list")}
                    </Button>
                  )}
                </Flex>
              )}
              {addMiss !== null && (
                <Typography.Text type="danger" style={{ fontSize: TYPE.sm }}>
                  {mode === "SEND"
                    ? t(
                        "serviceBatch.cannotSend",
                        "{{serial}} cannot go to service — it is not in QC or on the shelf.",
                        { serial: addMiss },
                      )
                    : t(
                        "serviceBatch.cannotBack",
                        "{{serial}} is not at service.",
                        { serial: addMiss },
                      )}
                </Typography.Text>
              )}
              {!asOne && (
                <Table<Row>
                  size="small"
                  rowKey="serial"
                  pagination={false}
                  dataSource={rows}
                  locale={{
                    emptyText: t("serviceBatch.noUnits", "No units yet."),
                  }}
                  columns={[
                    {
                      title: t("serviceBatch.unit", "Unit"),
                      key: "unit",
                      render: (_, r) => (
                        <Flex vertical>
                          <span style={{ fontFamily: "monospace" }}>
                            {r.serial}
                          </span>
                          <Typography.Text
                            type="secondary"
                            style={{ fontSize: TYPE.sm }}
                          >
                            {skuName(r.serial)}
                          </Typography.Text>
                        </Flex>
                      ),
                    },
                    ...(mode === "BACK"
                      ? [
                          {
                            title: (
                              <Flex align="center" gap={SPACE.xs}>
                                <span>
                                  {t("serviceBatch.repairCost", "Repair cost")}
                                </span>
                                {rows.length > 1 && (
                                  <Button
                                    size="small"
                                    type="link"
                                    onClick={fillDownCost}
                                  >
                                    {t("serviceBatch.fillDown", "Fill down")}
                                  </Button>
                                )}
                              </Flex>
                            ),
                            key: "cost",
                            width: 200,
                            render: (_: unknown, r: Row) =>
                              r.block ? (
                                <Typography.Text
                                  type="danger"
                                  data-refused={r.serial}
                                  style={{ fontSize: TYPE.sm }}
                                >
                                  {blockReason(r)}
                                </Typography.Text>
                              ) : (
                                <InputNumber
                                  {...MONEY_INPUT}
                                  aria-label={t(
                                    "serviceBatch.repairCostOf",
                                    "Repair cost of {{serial}}",
                                    { serial: r.serial },
                                  )}
                                  data-repair-cost=""
                                  placeholder={
                                    bringAll
                                      ? t("serviceBatch.noCharge", "No charge")
                                      : t(
                                          "serviceBatch.repairCostHint",
                                          "0 if free",
                                        )
                                  }
                                  value={r.cost}
                                  onChange={(v) =>
                                    setCost(
                                      r.serial,
                                      typeof v === "number" ? v : null,
                                    )
                                  }
                                />
                              ),
                          },
                        ]
                      : []),
                    ...(mode === "SEND"
                      ? [
                          {
                            title: (
                              <Flex align="center" gap={SPACE.xs}>
                                <span>{descriptionLabel}</span>
                                {rows.length > 1 && (
                                  <Button
                                    size="small"
                                    type="link"
                                    onClick={fillDown}
                                  >
                                    {t("serviceBatch.fillDown", "Fill down")}
                                  </Button>
                                )}
                              </Flex>
                            ),
                            key: "description",
                            width: 360,
                            render: (_: unknown, r: Row) => (
                              <Input
                                aria-label={t(
                                  "serviceBatch.descriptionOf",
                                  "Description of {{serial}}",
                                  { serial: r.serial },
                                )}
                                value={r.description}
                                onChange={(e) =>
                                  setDescription(r.serial, e.target.value)
                                }
                              />
                            ),
                          },
                        ]
                      : []),
                    ...(fixed
                      ? []
                      : [
                          {
                            title: "",
                            key: "remove",
                            width: COLUMN.action,
                            render: (_: unknown, r: Row) => (
                              <Tooltip
                                title={t(
                                  "stock.removeThisLine",
                                  "Remove this line",
                                )}
                              >
                                <Button
                                  type="text"
                                  aria-label={t(
                                    "stock.removeThisLine",
                                    "Remove this line",
                                  )}
                                  icon={<DeleteOutlined />}
                                  onClick={() =>
                                    setRows((rs) =>
                                      rs.filter((x) => x.serial !== r.serial),
                                    )
                                  }
                                />
                              </Tooltip>
                            ),
                          },
                        ]),
                  ]}
                />
              )}
            </Flex>
          }

          {mode === "BACK" && asOne && rows[0] && (
            <Form.Item
              label={t("serviceBatch.repairCost", "Repair cost")}
              required
            >
              <InputNumber
                {...MONEY_INPUT}
                aria-label={t("serviceBatch.repairCost", "Repair cost")}
                data-repair-cost=""
                placeholder={t("serviceBatch.repairCostHint", "0 if free")}
                value={rows[0].cost}
                onChange={(v) =>
                  setCost(rows[0]!.serial, typeof v === "number" ? v : null)
                }
              />
            </Form.Item>
          )}
          {mode === "BACK" && (bringAll ? active : rows).length > 0 && (
            <Form.Item label={t("service.paidWith", "Paid with")}>
              <Radio.Group
                aria-label={t("service.paidWith", "Paid with")}
                optionType="button"
                size="small"
                value={repairPaid}
                onChange={(e) => setRepairPaid(e.target.value as PaidWith)}
                options={PAID_WITH.map((p) => ({
                  value: p,
                  label: paidWord(p),
                }))}
              />
            </Form.Item>
          )}
          <Form.Item
            label={
              mode === "SEND"
                ? t("service.whereServiced", "Where is it serviced?")
                : t("service.backTo", "Which warehouse")
            }
            required
          >
            <Select
              aria-label={
                mode === "SEND"
                  ? t("service.whereServiced", "Where is it serviced?")
                  : t("service.backTo", "Which warehouse")
              }
              style={{ width: "100%" }}
              value={dest}
              options={destOptions.map((o) =>
                mode === "SEND" &&
                asOne &&
                o.value === unitOf(oneSerial)?.locationId
                  ? {
                      ...o,
                      label: t(
                        "inbound.serviceStaysHere",
                        "{{name}} (stays here)",
                        { name: o.label },
                      ),
                    }
                  : o,
              )}
              onChange={(v: string) => {
                setDest(v);
                setDestTouched(true);
              }}
            />
          </Form.Item>

          {feeAsked && (
            <>
              <Form.Item
                label={
                  mode === "SEND"
                    ? t(
                        "inbound.serviceShippingFee",
                        "Cost of getting it there",
                      )
                    : t("service.transferFee", "Cost of moving it back")
                }
              >
                <InputNumber
                  {...MONEY_INPUT}
                  aria-label={
                    mode === "SEND"
                      ? t(
                          "inbound.serviceShippingFee",
                          "Cost of getting it there",
                        )
                      : t("service.transferFee", "Cost of moving it back")
                  }
                  value={fee}
                  onChange={(v) => setFee(v ?? null)}
                />
              </Form.Item>
              {hasFee && (
                <>
                  <Form.Item style={{ marginBottom: SPACE.md }}>
                    <Flex align="center" gap={SPACE.sm}>
                      <Switch
                        checked={split}
                        onChange={toggleSplit}
                        aria-label={t(
                          "serviceBatch.splitFee",
                          "Split the courier fee into each unit's cost",
                        )}
                      />
                      <span>
                        {t(
                          "serviceBatch.splitFee",
                          "Split the courier fee into each unit's cost",
                        )}
                      </span>
                    </Flex>
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: TYPE.sm }}
                    >
                      {split
                        ? t(
                            "serviceBatch.splitOn",
                            "{{amount}} per unit, added to each unit's COGS.",
                            {
                              amount: fmtRp(
                                Math.floor((fee ?? 0) / travellers.length),
                              ),
                            },
                          )
                        : t(
                            "serviceBatch.splitOff",
                            "Recorded once as a shop expense (Shipping / ongkir). No unit's cost changes.",
                          )}
                    </Typography.Text>
                  </Form.Item>
                  <Form.Item
                    label={t("service.courierPaidWith", "Courier paid with")}
                  >
                    <Radio.Group
                      aria-label={t(
                        "service.courierPaidWith",
                        "Courier paid with",
                      )}
                      optionType="button"
                      size="small"
                      value={paid}
                      onChange={(e) => setPaid(e.target.value as PaidWith)}
                      options={PAID_WITH.filter(
                        (p) => split || p !== "UNPAID",
                      ).map((p) => ({ value: p, label: paidWord(p) }))}
                    />
                  </Form.Item>
                </>
              )}
            </>
          )}

          {mode === "SEND" && asOne && rows[0] && (
            <Form.Item label={descriptionLabel}>
              <Input.TextArea
                rows={2}
                aria-label={descriptionLabel}
                value={rows[0].description}
                onChange={(e) =>
                  setDescription(rows[0]!.serial, e.target.value)
                }
              />
            </Form.Item>
          )}
        </Form>
      </div>
      <ServiceUnitPicker
        open={picking}
        exclude={rows.map((r) => r.serial)}
        onPick={addMany}
        onClose={() => setPicking(false)}
        zIndex={(zIndex ?? 1000) + 10}
      />
    </Modal>
  );
}
