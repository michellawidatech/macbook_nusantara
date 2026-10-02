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
import { useEffect } from "react";
import { Flex, Form, Input, Modal, Segmented, Select } from "antd";
import { useTranslation } from "react-i18next";
import { MoneyInput } from "../../components/MoneyInput";
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
  canGrade,
  gradeForCondition,
  type UnitCondition,
} from "../../lib/condition.js";
import { GRADES, type GradingSelection } from "../../lib/grading.js";
import type { MockDb } from "../../mock/seed.js";
import { SPACE } from "../../theme/tokens";

/** What the dialog hands back. Mirrors `TradeInRec` minus its id. */
export interface TradeInDraft {
  /** The unit in words — what prints on the invoice. */
  label: string;
  serial?: string;
  value: number;
  note?: string;
  skuId?: string;
  condition?: UnitCondition;
  grade?: string;
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
  category?: string;
  serial?: string;
  condition: UnitCondition;
  grade?: string;
  label?: string;
  value?: number;
  note?: string;
}

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
  const category = Form.useWatch("category", form);
  /** A counted product — an accessory — carries no serial to ask for. */
  const counted = !!skuId && !skuTracksSerial(db, skuId);
  const condition = Form.useWatch("condition", form) ?? "SECOND";

  const categoryOfSku = (id: string | undefined) => {
    const sku = db.skus.find((s) => s.id === id);
    return db.models.find((m) => m.id === sku?.modelId)?.category;
  };

  const reset = () => {
    form.resetFields();
  };

  // Opening on an existing trade-in fills the form with what it said. The
  // grade box holds a LETTER; a sealed unit's stored grade is `NEW`, which is
  // the condition, not a letter, so it stays empty.
  useEffect(() => {
    if (!open || initial === undefined) return;
    form.setFieldsValue({
      skuId: initial.skuId,
      category: categoryOfSku(initial.skuId),
      serial: initial.serial,
      condition: initial.condition ?? "SECOND",
      grade:
        initial.condition === "NEW" || initial.grade === "NEW"
          ? undefined
          : initial.grade,
      label: initial.label,
      value: initial.value,
      note: initial.note,
    });
    // `categoryOfSku` reads `db`, which changes on every store write; the
    // form is filled once per opening, not again under somebody typing.
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
        condition: condition === "NEW" ? "NEW" : "SECOND",
      }),
    };
  };
  const serialOf = (raw: string | undefined): string => {
    const { typed, read } = readSerial(raw);
    return read.ok ? read.serial : typed;
  };

  /**
   * Keeps the product and the category agreeing, whichever was picked first.
   *
   * A product fills its category in. A category that the chosen product is
   * not in clears the product rather than keeping a pair that contradicts
   * itself — the list under it now offers that category's products.
   */
  const onValuesChange = (changed: Partial<TradeInFields>) => {
    if ("skuId" in changed) {
      const cat = categoryOfSku(changed.skuId);
      if (cat !== undefined && cat !== form.getFieldValue("category")) {
        form.setFieldValue("category", cat);
      }
    }
    if ("category" in changed) {
      const current = form.getFieldValue("skuId") as string | undefined;
      if (
        current !== undefined &&
        categoryOfSku(current) !== changed.category
      ) {
        form.setFieldValue("skuId", undefined);
      }
    }
    if ("condition" in changed && changed.condition === "NEW") {
      // A sealed unit has no letter to keep — `gradeForCondition`.
      form.setFieldValue("grade", undefined);
    }
  };

  const submit = () =>
    form
      .validateFields()
      .then((v) => {
        const grade = gradeForCondition(v.condition, v.grade);
        onAdd({
          // The typed description always wins. It is what prints on the
          // invoice, and the customer's unit is often not quite the variant
          // it resembles.
          label: (v.label ?? "").trim(),
          ...(counted ? {} : { serial: serialOf(v.serial) }),
          value: v.value ?? 0,
          ...(v.note?.trim() ? { note: v.note.trim() } : {}),
          ...(v.skuId ? { skuId: v.skuId } : {}),
          condition: v.condition,
          ...(grade ? { grade } : {}),
        });
        reset();
      })
      .catch(() => {
        // The fields say it themselves — `validateFields` rejects with the
        // messages the form has already painted under the boxes that failed.
      });

  const productOptions = db.skus
    .filter((k) => !category || categoryOfSku(k.id) === category)
    .map((k) => ({ value: k.id, label: `${k.name} ${k.variantLabel}` }));

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
      width={640}
    >
      <Form<TradeInFields>
        form={form}
        layout="vertical"
        initialValues={{ condition: "SECOND" }}
        onValuesChange={onValuesChange}
      >
        <Flex gap={SPACE.md} wrap>
          <Form.Item
            name="skuId"
            label={t("trade.product", "Product")}
            style={{ flex: "2 1 260px" }}
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
            <Select
              showSearch
              allowClear
              optionFilterProp="label"
              placeholder={t(
                "trade.searchProduct",
                "Search a product or variant",
              )}
              options={productOptions}
            />
          </Form.Item>
          <Form.Item
            name="category"
            label={t("trade.category", "Category")}
            required
            style={{ flex: "1 1 180px" }}
          >
            <Select
              showSearch
              allowClear
              placeholder={t("trade.pickCategory", "Pick a category")}
              options={db.categories.map((c) => ({
                value: c.name,
                label: c.name,
              }))}
            />
          </Form.Item>
        </Flex>

        <Flex gap={SPACE.md} wrap>
          {!counted && (
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
              // condition judges the serial again.
              dependencies={["condition"]}
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
              tooltip={t(
                "trade.serialHint",
                "The number printed on the unit. A new unit's is {{min}}–{{max}} characters; a second-hand unit's is taken as read. It enters QC under this serial, exactly as a unit off a purchase order would.",
                { min: BASE_MIN_LENGTH, max: BASE_MAX_LENGTH },
              )}
            >
              <Input
                maxLength={SERIAL_FIELD_MAX_LENGTH}
                placeholder={t("trade.scanOrType", "Scan or type it")}
                style={{ fontFamily: "monospace", textTransform: "uppercase" }}
              />
            </Form.Item>
          )}
          <Form.Item
            name="condition"
            label={t("trade.condition", "Condition")}
            required
            style={{ flex: "0 0 auto" }}
          >
            <Segmented
              options={[
                { value: "SECOND", label: t("trade.second", "Second") },
                { value: "NEW", label: t("trade.new", "New") },
              ]}
            />
          </Form.Item>
        </Flex>

        {/* Nothing at all for a sealed unit (owner ask 2026-09-19). */}
        {canGrade(condition) && (
          <Form.Item
            label={t("trade.gradeLabel", "Grade")}
            required
            style={{ marginBottom: SPACE.lg }}
          >
            {/* Picked by hand: the grading checklist is hidden (owner ask
                2026-09-20). `GradingChecklist` is untouched on disk. */}
            <Form.Item
              name="grade"
              noStyle
              rules={[
                {
                  required: true,
                  message: t(
                    "trade.gradeRequired",
                    "Pick a grade — A, B or C.",
                  ),
                },
              ]}
            >
              <Select
                showSearch
                allowClear
                style={{ width: "100%" }}
                placeholder={t("trade.gradePlaceholder", "A, B or C")}
                aria-label={t("trade.gradeLabel", "Grade")}
                options={GRADES.map((g) => ({ value: g, label: g }))}
              />
            </Form.Item>
          </Form.Item>
        )}

        <Form.Item
          name="label"
          label={t("trade.description", "Description")}
          rules={[
            {
              required: true,
              whitespace: true,
              message: t(
                "trade.descriptionRequired",
                "Describe the unit — its marks and its age.",
              ),
            },
          ]}
        >
          <Input
            placeholder={t(
              "trade.descriptionPlaceholder",
              "e.g. MacBook Air 2017 8/128, lecet di lid",
            )}
          />
        </Form.Item>

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
            name="note"
            label={t("trade.note", "Note")}
            style={{ flex: "1 1 260px", marginBottom: 0 }}
          >
            <Input
              placeholder={t(
                "trade.notePlaceholder",
                "Anything QC should know",
              )}
            />
          </Form.Item>
        </Flex>
      </Form>
    </Modal>
  );
}
