/**
 * Taking a customer's unit against the bill — "tukar tambah".
 *
 * ## What the owner asked for (2026-09-01)
 *
 * *"When taking trade-ins, display the following field: product (searchable
 * drop down), category, serial, grading & config, condition (new/second),
 * price — so it's like the normal Inbound & QC flow but just has to be in 1
 * flow."*
 *
 * A trade-in with a serial is not a discount — the shop has BOUGHT a unit,
 * and it enters stock at QC with the price as its cost. Everything asked here
 * — the variant, the condition, the grade, the description — is carried onto
 * the unit, so whoever picks it up at Inbound & QC is finishing an inspection
 * rather than starting one.
 *
 * ## Any order (owner revision 2026-09-19)
 *
 * *"There should not be like precedence in which I should input something
 * first … I could input in whatever order I want."* Nothing here waits for
 * anything else:
 *
 * - The **category** is its own box. Picking a product fills it, and picking
 *   it first narrows the product list — but the grading checklist only needs
 *   the category, so the unit can be graded before anybody has found its
 *   exact variant in the list.
 * - The **grade** is a letter picked by hand (A, B or C), always available on
 *   a second-hand unit. *Configure grade* folds the category's checklist
 *   open under it, the way the QC dialog does, and the checklist's answer
 *   fills the letter in — a helper, not a gate.
 *
 * ## Same revision: less on screen
 *
 * - The title is just *Trade-Ins*.
 * - One star per required field. The dialog used to draw its own `*` beside a
 *   label that the app-wide `requiredMark` (theme/requiredMark.tsx) already
 *   starred, so every required field carried two.
 * - A **New** unit shows no grading at all — not a disabled button and a
 *   sentence explaining why, just nothing. There is nothing to inspect in a
 *   sealed box (`lib/condition.ts`).
 * - The *We list it at* / *We have paid* cards, and the table behind them,
 *   are gone (owner: *"it is making it very complicated"*).
 *
 * ## One QC, at the till (owner ask 2026-10-31)
 *
 * *"They will only do 1 QC (input just like in inbound), but no need to put it
 * in inbound list … they always QC without making the transaction so we don't
 * need to put it in pending QC."* The dialog now asks what Inbound's unit
 * popup asks — serial, grade, battery, description, never serviced / opened,
 * sell price — plus what the shop is paying, and the unit the sale mints goes
 * straight onto the shelf (`QC_SELESAI`), never into Waiting for QC. The
 * category box, the condition switch (the grade IS the condition — New, A, B
 * or C, as at Inbound) and the free-text note are gone; the invoice's label
 * is the product's name.
 *
 * ## Everything the unit needs is required
 *
 * Product, serial, condition, grade (second-hand only), description and
 * price. An accessory has no serial anybody reads (owner brief 2026-09-19:
 * *"Accessories: do not have battery and serial"*) — a product whose category
 * is counted rather than tracked (`lib/serialTracking.ts`) gets no serial box,
 * and the till mints its `QTY-` handle the way Inbound does. The product is ENFORCED, not just starred: a unit is filed under a
 * variant, and the store refuses a unit with none (`skuId` is required in
 * `packages/store`) — which would have refused the whole sale with it.
 */
import { useEffect, useState } from "react";
import { isLiveSku } from "../../lib/skuCode.js";
import { Flex, Form, Input, Modal, Select } from "antd";
import { useTranslation } from "react-i18next";
import { BatteryFields } from "../../components/BatteryFields";
import { MoneyInput } from "../../components/MoneyInput";
import { NeverServicedField } from "../../components/NeverServicedField";
import { SkuPicker } from "../../components/SkuPicker";
import {
  BASE_MAX_LENGTH,
  BASE_MIN_LENGTH,
  normaliseScan,
  SERIAL_FIELD_MAX_LENGTH,
} from "../../lib/serialScan.js";
import { readSerialInput } from "../../lib/serialInput.js";
import { skuTracksSerial } from "../../lib/serialTracking.js";
import { wasScannedText } from "../../lib/scanner.js";
import {
  conditionOf,
  NEW_GRADE,
  needsDescription,
  type UnitCondition,
} from "../../lib/condition.js";
import { GRADES, type GradingSelection } from "../../lib/grading.js";
import {
  batteryDraftOf,
  batteryPatch,
  defaultBatteryModeOfSku,
  isBatteryDraftInRange,
  type BatteryDraft,
} from "../../lib/battery.js";
import { joinDescription, splitDescription } from "../../lib/inboundQc.js";
import type { TradeInQc } from "../../lib/pos.js";
import type { MockDb } from "../../mock/seed.js";
import { SPACE } from "../../theme/tokens";

/** What the dialog hands back. Mirrors `TradeInLine` minus its id. */
export interface TradeInDraft {
  /** The unit in words — what prints on the invoice. */
  label: string;
  serial?: string;
  value: number;
  note?: string;
  skuId?: string;
  condition?: UnitCondition;
  grade?: string;
  /** The QC taken here, for the unit the sale mints. */
  qc?: TradeInQc;
  /**
   * ⚠️ Nothing sets this since 2026-09-20 — the grading checklist is hidden
   * (owner ask). Kept on the type because the trade-in record carries it and
   * the checklist is one switch away. Never stored on the unit — a grade is
   * a conclusion, and prisma has no table for the working behind one.
   */
  gradingSelection?: GradingSelection;
}

/** The form's own fields. */
interface TradeInFields {
  skuId?: string;
  serial?: string;
  /** `NEW`, `A`, `B` or `C` — the condition and the letter in one box. */
  grade?: string;
  description?: string[];
  neverServiced?: boolean;
  value?: number;
  price?: number;
}

/** The grade box's choices: sealed first, then the letters. */
const GRADE_CHOICES = [NEW_GRADE, ...GRADES] as const;

export function TradeInDialog({
  open,
  db,
  initial,
  onCancel,
  onAdd,
}: {
  open: boolean;
  db: MockDb;
  /**
   * A trade-in already on the sale, to correct (owner ask 2026-10-02: *"they
   * are supposed to be able to edit the unit trade-ins"*). The dialog opens
   * on its answers and hands back the corrected draft through `onAdd`; the
   * caller puts it back in the same place. Absent, the dialog adds a new one.
   */
  initial?: TradeInDraft;
  onCancel: () => void;
  onAdd: (draft: TradeInDraft) => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm<TradeInFields>();
  const skuId = Form.useWatch("skuId", form);
  const grade = Form.useWatch("grade", form);
  /** The battery boxes, outside the form: `BatteryFields` owns its draft. */
  const [battery, setBattery] = useState<BatteryDraft>({});
  const [batteryBad, setBatteryBad] = useState(false);
  /** A counted product — an accessory — carries no serial to ask for. */
  const counted = !!skuId && !skuTracksSerial(db, skuId);
  const condition: UnitCondition = conditionOf(grade);
  const batteryMode = defaultBatteryModeOfSku(db, skuId ?? "");

  const reset = () => {
    form.resetFields();
    setBattery({});
    setBatteryBad(false);
  };

  // Opening on an existing trade-in fills the form with what it said.
  useEffect(() => {
    if (!open || initial === undefined) return;
    form.setFieldsValue({
      skuId: initial.skuId,
      serial: initial.serial,
      grade:
        initial.condition === "NEW" ? NEW_GRADE : (initial.grade ?? undefined),
      description: splitDescription(initial.qc?.description ?? ""),
      neverServiced: initial.qc?.neverServiced,
      value: initial.value,
      price: initial.qc?.price,
    });
    setBattery(batteryDraftOf(initial.qc ?? {}));
  }, [open, initial, form]);

  const close = () => {
    reset();
    onCancel();
  };

  /**
   * What the field means — the same reader as every other serial box
   * (`lib/serialInput.ts`). A trade-in mints a unit exactly as intake does, so
   * it is judged exactly as intake judges (owner rules 2026-09-21): a NEW
   * unit's scan must be `S` and ten to twelve and loses its `S`, its typed
   * serial is ten to twelve, `I`/`O` read as `1`/`0`; a second-hand one — a
   * customer's own machine, almost always — is taken as read.
   */
  const readSerial = (raw: string | undefined) => {
    const typed = normaliseScan(raw ?? "");
    return {
      typed,
      read: readSerialInput(typed, {
        scanned: wasScannedText(typed),
        condition,
      }),
    };
  };
  const serialOf = (raw: string | undefined): string => {
    const { typed, read } = readSerial(raw);
    return read.ok ? read.serial : typed;
  };

  const skuName = (id: string | undefined) => {
    const sku = db.skus.find((s) => s.id === id);
    return sku ? `${sku.name} ${sku.variantLabel}`.trim() : "";
  };

  const submit = () => {
    const batteryOk = counted || isBatteryDraftInRange(battery, batteryMode);
    setBatteryBad(!batteryOk);
    return form
      .validateFields()
      .then((v) => {
        if (!batteryOk) return;
        const isNewUnit = v.grade === NEW_GRADE;
        const reading = counted ? {} : batteryPatch(battery, batteryMode);
        const description = joinDescription(
          (v.description ?? []).map((p) => p.trim()).filter(Boolean),
        );
        const qc: TradeInQc = {
          ...(reading.batteryHealth !== undefined
            ? { batteryHealth: reading.batteryHealth }
            : {}),
          ...(reading.cycleCount !== undefined
            ? { cycleCount: reading.cycleCount }
            : {}),
          ...(reading.fcc !== undefined ? { fcc: reading.fcc } : {}),
          ...(description !== "" ? { description } : {}),
          ...(v.neverServiced !== undefined
            ? { neverServiced: v.neverServiced }
            : {}),
          ...(v.price ? { price: v.price } : {}),
        };
        onAdd({
          // The product's own name is what prints on the invoice.
          label: skuName(v.skuId),
          ...(counted ? {} : { serial: serialOf(v.serial) }),
          value: v.value ?? 0,
          ...(v.skuId ? { skuId: v.skuId } : {}),
          condition: isNewUnit ? "NEW" : "SECOND",
          ...(v.grade ? { grade: v.grade } : {}),
          qc,
        });
        reset();
      })
      .catch(() => {
        // The fields say it themselves — `validateFields` rejects with the
        // messages the form has already painted under the boxes that failed.
      });
  };

  const pickable = db.skus.filter((k) => isLiveSku(k));

  return (
    <Modal
      open={open}
      title={
        initial
          ? t("trade.editTitle", "Edit trade-in")
          : t("trade.title", "Trade-Ins")
      }
      okText={initial ? t("trade.save", "Save") : t("trade.add", "Add it")}
      onCancel={close}
      onOk={submit}
      width={720}
    >
      <Form<TradeInFields> form={form} layout="vertical">
        <Flex gap={SPACE.md} wrap>
          <Form.Item
            name="skuId"
            label={t("trade.product", "Product")}
            style={{ flex: "2 1 300px" }}
            rules={[
              {
                required: true,
                message: t(
                  "trade.productRequired",
                  "Pick the product — the unit is filed under it.",
                ),
              },
            ]}
          >
            {/* The shop's product code in the box — `AIR 13" 2020 I5
                8/256` — and the model under it, as Inbound picks one
                (owner ask 2026-10-08). Searchable by either. */}
            <SkuPicker
              skus={pickable}
              aria-label={t("trade.product", "Product")}
              // The Form.Item supplies the real value and onChange.
              onChange={() => undefined}
            />
          </Form.Item>
          <Form.Item
            name="grade"
            label={t("trade.gradeLabel", "Grade")}
            style={{ flex: "1 1 140px" }}
            rules={[
              {
                required: true,
                message: t(
                  "trade.gradeRequiredNew",
                  "Pick a grade — New, A, B or C.",
                ),
              },
            ]}
          >
            <Select<string>
              showSearch
              allowClear
              optionFilterProp="label"
              placeholder={t("trade.gradePlaceholderNew", "New, A, B or C")}
              aria-label={t("trade.gradeLabel", "Grade")}
              options={GRADE_CHOICES.map((g) => ({
                value: g,
                label: g === NEW_GRADE ? t("inbound.gradeNew", "New") : g,
              }))}
            />
          </Form.Item>
        </Flex>

        {!counted && (
          <Flex gap={SPACE.md} wrap>
            <Form.Item
              name="serial"
              label={t("trade.serial", "Serial")}
              style={{ flex: "1 1 220px" }}
              /*
               * On blur, not on every keystroke: every prefix of a valid serial
               * is an invalid one, so validating as it is typed would put the
               * box in red from the first character to the last.
               */
              validateTrigger={["onBlur"]}
              // New and second-hand are held to different rules, so a change of
              // grade judges the serial again.
              dependencies={["grade"]}
              // Capitals whatever the keyboard is doing (owner ask 2026-09-01).
              normalize={(v: string) => v.toUpperCase()}
              rules={[
                {
                  required: true,
                  message: t(
                    "trade.serialRequired",
                    "Scan or type the unit's serial.",
                  ),
                },
                {
                  // The shape rule the whole app runs on, and the collision, on
                  // the field itself so the red outline points at the box.
                  validator: (_, value: string) => {
                    const { typed, read } = readSerial(value);
                    // `required` above owns the empty case.
                    if (typed === "") return Promise.resolve();
                    if (!read.ok) {
                      return Promise.reject(
                        new Error(
                          read.reason === "no-marker" && read.source === "scan"
                            ? t(
                                "trade.serialScanNoMarker",
                                "That is not the serial barcode — a Mac carries several. Look for the one printed under an S.",
                              )
                            : t(
                                "trade.serialShape",
                                "“{{serial}}” is not a new unit's serial. Type the {{min}}–{{max}} characters printed on it, or scan its barcode.",
                                {
                                  serial: typed,
                                  min: BASE_MIN_LENGTH,
                                  max: BASE_MAX_LENGTH,
                                },
                              ),
                        ),
                      );
                    }
                    if (db.units.some((u) => u.serial === read.serial)) {
                      return Promise.reject(
                        new Error(
                          t(
                            "trade.serialTaken",
                            "{{serial}} already belongs to a unit we carry.",
                            { serial: read.serial },
                          ),
                        ),
                      );
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <Input
                maxLength={SERIAL_FIELD_MAX_LENGTH}
                placeholder={t("trade.scanOrType", "Scan or type it")}
                style={{ fontFamily: "monospace", textTransform: "uppercase" }}
              />
            </Form.Item>
            <Form.Item
              label={t("inbound.battery", "Battery Health")}
              style={{ flex: "1 1 260px" }}
              {...(batteryBad
                ? {
                    validateStatus: "error" as const,
                    help: t(
                      "trade.batteryOutOfRange",
                      "That is not a reading the battery boxes take.",
                    ),
                  }
                : {})}
            >
              <BatteryFields
                fallback={batteryMode}
                value={battery}
                onChange={(next) => {
                  setBattery(next);
                  setBatteryBad(false);
                }}
                size="middle"
                idPrefix="trade-battery"
              />
            </Form.Item>
          </Flex>
        )}

        <Form.Item
          name="description"
          label={t("trade.description", "Description")}
          rules={[
            {
              // A second-hand unit cannot go on the shelf without one —
              // `qcReady`, the gate Inbound's Accept uses.
              validator: (_, value: string[] | undefined) =>
                !needsDescription(condition) || (value ?? []).length > 0
                  ? Promise.resolve()
                  : Promise.reject(
                      new Error(
                        t(
                          "trade.descriptionRequired",
                          "Describe the unit — its marks and its age.",
                        ),
                      ),
                    ),
            },
          ]}
          dependencies={["grade"]}
          required={needsDescription(condition)}
        >
          {/* The same phrase list Inbound's description box offers. */}
          <Select<string[]>
            mode="tags"
            tokenSeparators={[","]}
            aria-label={t("trade.description", "Description")}
            placeholder={t(
              "inbound.conditionPlaceholder",
              "Condition, marks, what is in the box…",
            )}
            options={db.qcDescriptions
              .filter((d) => d.active)
              .map((d) => ({ value: d.label }))}
          />
        </Form.Item>

        {!counted && (
          <Form.Item
            name="neverServiced"
            label={t("qc.neverServiced", "Never serviced / opened")}
          >
            <NeverServicedField
              value={form.getFieldValue("neverServiced")}
              onChange={(next) => form.setFieldValue("neverServiced", next)}
            />
          </Form.Item>
        )}

        <Flex gap={SPACE.md} wrap>
          <Form.Item
            name="value"
            label={t("trade.price", "Price")}
            style={{ flex: "1 1 220px", marginBottom: 0 }}
            rules={[
              {
                required: true,
                message: t(
                  "trade.priceRequired",
                  "Say what the shop is paying for it.",
                ),
              },
            ]}
            tooltip={t(
              "trade.priceHint",
              "Comes off what the customer pays, and becomes the unit's cost when it enters stock.",
            )}
          >
            <MoneyInput style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="price"
            label={t("inbound.sellPrice", "Sell price")}
            style={{ flex: "1 1 220px", marginBottom: 0 }}
          >
            <MoneyInput
              style={{ width: "100%" }}
              aria-label={t("inbound.sellPrice", "Sell price")}
            />
          </Form.Item>
        </Flex>
      </Form>
    </Modal>
  );
}
