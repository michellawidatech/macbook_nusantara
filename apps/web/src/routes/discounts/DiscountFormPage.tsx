/**
 * Phase 8 — define a discount: % (with cap), a fixed amount, or a bundle price.
 *
 * The bundle is the shape the other two cannot express. "Any 2 accessories for
 * Rp1.000.000" does not reduce to a percentage or a fixed sum, because what it
 * takes off depends on which two units the customer picks — so it is stored as
 * what it is (a count and a price) and worked out against the real basket at
 * the till. See `lib/pricing.ts`.
 */
import { useNavigate, useParams } from "react-router-dom";
import dayjs from "dayjs";
import {
  App,
  Button,
  Card,
  DatePicker,
  Flex,
  Form,
  Input,
  InputNumber,
  Segmented,
  Select,
  Typography,
} from "antd";
import { PageContainer } from "../../components/PageContainer";
import { FooterToolbar } from "../../components/FooterToolbar";
import { MoneyInput } from "../../components/MoneyInput";
import { useDb, mutate, nextId } from "../../mock/store.js";
import type { Discount } from "../../mock/seed.js";
import { useTranslation } from "react-i18next";
import { draftKey, usePersistentState } from "../../hooks/usePersistentState";
import { useFormDraft } from "../../hooks/useFormDraft";
import { asOneOf, isRecord } from "../../lib/draftGuards.js";

type DiscountType = "PCT" | "NOMINAL" | "BUNDLE";

/**
 * The half-typed discount, kept on this device (owner ask 2026-09-21: "all the
 * things of the user input will be saved locally"). Its date window is a pair
 * of dayjs values in the form and a pair of ISO days in storage.
 */
const DISCOUNT_DRAFT = draftKey("discount.new");

/**
 * A count typed into the form, as the number the store's contract demands.
 *
 * The boxes were `<Input type="number">`, which hands the form a STRING —
 * and the store refuses a discount whose `pct` or `usageLimit` is one
 * ("Not saved — pct: Invalid input: expected number, received string", owner
 * report 2026-10-02). They are `InputNumber` now; this also mends a value
 * restored from a draft an older build kept as text. Empty is "not set".
 */
function countOf(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? Math.round(n) : undefined;
}
const toStored = (v: Record<string, unknown>) => ({
  ...v,
  range: Array.isArray(v.range)
    ? (v.range as (dayjs.Dayjs | null)[]).map((d) =>
        d ? d.format("YYYY-MM-DD") : null,
      )
    : undefined,
});
const fromStored = (v: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(v)) return undefined;
  const range = Array.isArray(v.range)
    ? v.range.map((d) => (typeof d === "string" ? dayjs(d) : null))
    : undefined;
  return { ...v, range };
};

/**
 * Adding a discount at `/discounts/new`, and correcting one at
 * `/discounts/:discountId/edit` (owner ask 2026-10-02) — the same form.
 *
 * The form is mounted only once the discount is in the store, and keyed by
 * it: its starting values and its kind are read once, at mount, so a form
 * that mounted before the store answered would open blank and stay blank.
 */
export function DiscountFormPage() {
  const { t } = useTranslation();
  const db = useDb();
  const { discountId } = useParams<{ discountId: string }>();
  if (discountId === undefined) return <DiscountForm />;
  const editing = db.discounts.find((d) => d.id === discountId);
  if (editing === undefined) {
    return (
      <PageContainer
        title={t("discount.editDiscount", "Edit Discount")}
        backTo="/discounts"
      >
        <Typography.Text type="secondary">
          {t("discount.notFound", "This discount does not exist.")}
        </Typography.Text>
      </PageContainer>
    );
  }
  return <DiscountForm key={editing.id} editing={editing} />;
}

function DiscountForm({ editing }: { editing?: Discount }) {
  const { t } = useTranslation();
  const db = useDb();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const discountId = editing?.id;
  // A half-typed correction is kept under its own key, so it never mixes
  // with a new discount's.
  const draftName =
    discountId === undefined
      ? DISCOUNT_DRAFT
      : draftKey(`discount.edit.${discountId}`);
  const [type, setType, clearType] = usePersistentState<DiscountType>(
    `${draftName}.type`,
    editing?.type ?? "PCT",
    asOneOf<DiscountType>(["PCT", "NOMINAL", "BUNDLE"]),
  );
  const draft = useFormDraft<Record<string, unknown>>(form, draftName, {
    save: toStored,
    load: fromStored,
  });
  /** Saved or cancelled, the draft is over — neither may come back. */
  const leave = () => {
    draft.clear();
    clearType();
    navigate("/discounts");
  };

  const submit = (v: {
    name: string;
    code: string;
    pct?: number;
    amountRp?: number;
    maxRp?: number;
    bundleQty?: number;
    bundlePriceRp?: number;
    usageLimit?: number;
    range?: [dayjs.Dayjs, dayjs.Dayjs];
    scope: string;
  }) => {
    if (
      db.discounts.some(
        (d) =>
          d.id !== editing?.id && d.code.toLowerCase() === v.code.toLowerCase(),
      )
    ) {
      return void message.warning(
        "That code already exists — codes are unique, case-insensitive.",
      );
    }
    const fields = {
      code: v.code.toUpperCase(),
      name: v.name,
      type,
      pct: type === "PCT" ? countOf(v.pct) : undefined,
      amountRp: type === "NOMINAL" ? v.amountRp : undefined,
      maxRp: type === "PCT" ? v.maxRp : undefined,
      bundleQty: type === "BUNDLE" ? countOf(v.bundleQty) : undefined,
      bundlePriceRp: type === "BUNDLE" ? v.bundlePriceRp : undefined,
      usageLimit: countOf(v.usageLimit),
      fromDate: v.range?.[0]?.format("YYYY-MM-DD"),
      toDate: v.range?.[1]?.format("YYYY-MM-DD"),
      scope: v.scope,
    };
    mutate((d) => {
      if (editing) {
        // What it has been used for and whether it is switched on are not
        // the form's to change: `used` is counted by sales, `active` is the
        // list's switch.
        const row = d.discounts.find((x) => x.id === editing.id)!;
        Object.assign(row, fields);
      } else {
        d.discounts.unshift({
          id: nextId("d"),
          ...fields,
          used: 0,
          active: true,
        });
      }
    });
    message.success("Discount saved.");
    leave();
  };

  return (
    <PageContainer
      title={
        editing
          ? t("discount.editDiscount", "Edit Discount")
          : t("discount.addDiscount", "Add Discount")
      }
      {...(editing ? { backTo: "/discounts" } : {})}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={
          editing
            ? {
                name: editing.name,
                code: editing.code,
                pct: editing.pct,
                amountRp: editing.amountRp,
                maxRp: editing.maxRp,
                bundleQty: editing.bundleQty,
                bundlePriceRp: editing.bundlePriceRp,
                usageLimit: editing.usageLimit,
                range: editing.fromDate
                  ? [
                      dayjs(editing.fromDate),
                      editing.toDate ? dayjs(editing.toDate) : null,
                    ]
                  : undefined,
                scope: editing.scope,
              }
            : undefined
        }
        onFinish={submit}
        onValuesChange={draft.onValuesChange}
        style={{ flex: 1 }}
      >
        <Flex vertical gap={16}>
          <Card title={t("discount.theDiscount", "The discount")}>
            <Flex gap={16} wrap>
              <Form.Item
                name="name"
                label={t("discount.name", "Name")}
                rules={[{ required: true }]}
                style={{ width: 320 }}
              >
                <Input
                  placeholder={`What staff will recognise it by — "Summer sale"`}
                />
              </Form.Item>
              <Form.Item
                name="code"
                label={t("discount.code", "Code")}
                rules={[{ required: true }]}
                style={{ width: 240 }}
              >
                <Input placeholder={t("discount.summer25", "SUMMER25")} />
              </Form.Item>
            </Flex>
            <Form.Item
              label={t("discount.howItIsWorkedOut", "How it is worked out")}
            >
              <Segmented
                value={type}
                onChange={(v) => setType(v as DiscountType)}
                options={[
                  {
                    value: "PCT",
                    label: t("discount.percentageOff", "Percentage off"),
                  },
                  {
                    value: "NOMINAL",
                    label: t("discount.fixedAmountOff", "Fixed amount off"),
                  },
                  {
                    value: "BUNDLE",
                    label: t("discount.bundlePrice", "Bundle price"),
                  },
                ]}
              />
            </Form.Item>
            <Flex gap={16} wrap>
              {type === "PCT" && (
                <>
                  <Form.Item
                    name="pct"
                    label={t("discount.percentageOff", "Percentage off")}
                    rules={[{ required: true }]}
                    style={{ width: 200 }}
                  >
                    <InputNumber
                      suffix="%"
                      min={1}
                      max={100}
                      precision={0}
                      style={{ width: "100%" }}
                    />
                  </Form.Item>
                  <Form.Item
                    name="maxRp"
                    label={t("discount.capTheAmountAt", "Cap the amount at")}
                    style={{ width: 260 }}
                  >
                    <MoneyInput
                      placeholder={t("discount.noCeiling", "No ceiling")}
                    />
                  </Form.Item>
                </>
              )}
              {type === "NOMINAL" && (
                <Form.Item
                  name="amountRp"
                  label={t("discount.amountOff", "Amount off")}
                  rules={[{ required: true }]}
                  style={{ width: 260 }}
                >
                  <MoneyInput />
                </Form.Item>
              )}
              {type === "BUNDLE" && (
                <>
                  <Form.Item
                    name="bundleQty"
                    label={t("discount.buyThisMany", "Buy this many")}
                    initialValue={2}
                    rules={[{ required: true }]}
                    style={{ width: 180 }}
                    tooltip={t(
                      "discount.howManyUnitsFromThe",
                      "How many units from the scope below make up one bundle",
                    )}
                  >
                    <InputNumber
                      min={2}
                      max={20}
                      precision={0}
                      suffix="units"
                      style={{ width: "100%" }}
                    />
                  </Form.Item>
                  <Form.Item
                    name="bundlePriceRp"
                    label={t("discount.forThisPrice", "…for this price")}
                    rules={[{ required: true }]}
                    style={{ width: 260 }}
                    tooltip={t(
                      "discount.whatTheWholeBundleCosts",
                      "What the whole bundle costs, instead of the sum of its units",
                    )}
                  >
                    <MoneyInput />
                  </Form.Item>
                </>
              )}
              <Form.Item
                name="usageLimit"
                label={t("discount.maxUses", "Max uses")}
                style={{ width: 160 }}
              >
                <InputNumber
                  min={1}
                  precision={0}
                  placeholder={t("discount.unlimited", "Unlimited")}
                  style={{ width: "100%" }}
                />
              </Form.Item>
            </Flex>
            {type === "BUNDLE" && (
              <Typography.Text type="secondary">
                A basket with more units than one bundle forms as many whole
                bundles as it can, taking the dearest qualifying units first,
                and charges the rest normally. Set "Applies to" below — a bundle
                over "All products" would price two MacBooks at the bundle
                figure.
              </Typography.Text>
            )}
          </Card>
          <Card
            title={t(
              "discount.whenAndWhatItApplies",
              "When and what it applies to",
            )}
          >
            <Flex gap={16} wrap>
              <Form.Item
                name="range"
                label={t("discount.activePeriod", "Active period")}
              >
                <DatePicker.RangePicker format="DD MMM YYYY" />
              </Form.Item>
              <Form.Item
                name="scope"
                label={t("discount.appliesTo", "Applies to")}
                initialValue="All products"
                style={{ width: 280 }}
              >
                <Select
                  options={[
                    {
                      value: "All products",
                      label: t("discount.allProducts", "All products"),
                    },
                    ...db.models.map((m) => ({ value: m.name, label: m.name })),
                    ...[...new Set(db.models.map((m) => m.category))].map(
                      (c) => ({
                        value: c,
                        label: `Category: ${c}`,
                      }),
                    ),
                  ]}
                />
              </Form.Item>
            </Flex>
            <Typography.Text type="secondary">
              Usage counts when a sale redeems the code in Stock Out.
              {type === "BUNDLE" &&
                " Stock Out also flags a basket that already qualifies for this bundle but has not claimed it."}
            </Typography.Text>
          </Card>
          <FooterToolbar>
            <Button onClick={leave}>{t("discount.cancel", "Cancel")}</Button>
            <Button type="primary" htmlType="submit">
              {t("discount.saveDiscount", "Save discount")}
            </Button>
          </FooterToolbar>
        </Flex>
      </Form>
    </PageContainer>
  );
}
