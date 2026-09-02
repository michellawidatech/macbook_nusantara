/**
 * Taking a customer's machine against the bill — "tukar tambah".
 *
 * ## What the owner asked for (2026-09-01)
 *
 * *"When taking trade-ins, display the following field: product (searchable
 * drop down), category, serial, grading & config, condition (new/second),
 * price (show the other unit base price) — so it's like the normal Inbound &
 * QC flow but just has to be in 1 flow."*
 *
 * That is exactly right, and it is what the old three-field dialog was
 * missing. A trade-in with a serial is not a discount — the shop has BOUGHT a
 * machine, and it enters stock at QC with the allowance as its cost. Every
 * question intake asks about a machine off a purchase order applies to this
 * one too; the only difference is that it is being asked at the counter with
 * the customer standing there, so it has to be one dialog rather than a
 * purchase order followed by a QC grid.
 *
 * ## The two shapes, still
 *
 * The serial remains what tells them apart, and that has not changed:
 *
 * - **With a serial** the shop is keeping the machine. It becomes a `Unit` in
 *   QC with `value` as its cost, and everything gathered here — the variant,
 *   the condition, the grade, the description — is carried onto it, so
 *   whoever picks it up at Inbound & QC is finishing an inspection rather than
 *   starting one.
 * - **Without one** it is a valuation of something the shop is not taking in:
 *   an old phone knocked off the price and given away with the box. Nothing is
 *   created, so nothing but the label and the allowance is asked for.
 *
 * The form does not hide the extra fields in the second case — a cashier does
 * not know which case they are in until the customer says.
 *
 * ## Everything is required now (owner revision 2026-09-01)
 *
 * Product, category, serial, condition, grading and price, each marked with a
 * star. The earlier cut asked for a description and a number and made the rest
 * optional, on the reasoning that a machine the shop is NOT keeping needs no
 * paperwork. The owner's answer is that the shop is nearly always keeping it,
 * and a trade-in taken without a grade is a machine that reaches the bench
 * with nothing on it — which is the same hole the QC grid exists to close.
 *
 * The grading dialog also reopens on the answers it was left with rather than
 * blank; `GradingModal.initialSelection` carries that, and this dialog keeps
 * the selection for it.
 *
 * ## "Show the other unit base price"
 *
 * Picking a variant puts the shop's own numbers for it on screen: what it
 * lists at, and what it has actually paid for the ones it holds. An allowance
 * is a negotiation, and the person making it is otherwise doing that
 * arithmetic from memory with a customer watching.
 */
import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Flex,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Table,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { MoneyInput } from "../../components/MoneyInput";
import { GradeTag } from "../../components/GradeTag";
import { GradingModal } from "../../components/GradingModal";
import { fmtRp } from "../../lib/format.js";
import {
  BASE_MAX_LENGTH,
  BASE_MIN_LENGTH,
  isStoreBarcode,
  normaliseScan,
  markTypedSerial,
  STORE_MAX_LENGTH,
  SUPPLIER_CODE_LENGTH,
  validateSerial,
} from "../../lib/serialScan.js";
import { gradeForCondition, type UnitCondition } from "../../lib/condition.js";
import type { GradingSelection } from "../../lib/grading.js";
import type { MockDb } from "../../mock/seed.js";

/** What the dialog hands back. Mirrors `TradeInRec` minus its id. */
export interface TradeInDraft {
  /** The machine in words — what prints on the invoice. */
  label: string;
  serial?: string;
  value: number;
  note?: string;
  skuId?: string;
  condition?: UnitCondition;
  grade?: string;
  /**
   * The grading checklist as answered, so reopening the dialog can show it.
   *
   * Held on the DRAFT rather than in the dialog's own state because a trade-in
   * can be edited after it is added to the sale, and the answers have to
   * survive the dialog being closed. It is never stored on the unit — a grade
   * is a conclusion, and prisma has no table for the working behind one.
   */
  gradingSelection?: GradingSelection;
}

/**
 * A required-field marker.
 *
 * The owner asked for a star on every required column (2026-09-01). It is
 * `aria-hidden` because "Serial star" is not what a required field is called —
 * the fact itself reaches assistive tech from the `required` rule on the
 * `Form.Item`, which is where a requirement belongs. Same arrangement the QC
 * grid uses for its own headers.
 */
function req(label: string) {
  return (
    <span>
      {label}{" "}
      <Typography.Text type="danger" aria-hidden>
        *
      </Typography.Text>
    </span>
  );
}

export function TradeInDialog({
  open,
  db,
  onCancel,
  onAdd,
}: {
  open: boolean;
  db: MockDb;
  onCancel: () => void;
  onAdd: (draft: TradeInDraft) => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm<{
    label: string;
    serial?: string;
    value?: number;
    note?: string;
  }>();
  const [skuId, setSkuId] = useState<string>();
  const [condition, setCondition] = useState<UnitCondition>("SECOND");
  const [grade, setGrade] = useState<string>();
  /**
   * The checklist as answered, kept so the dialog can reopen on it.
   *
   * The owner's complaint: *"when I grade & I finish and I want to edit, it
   * literally resets the grading, but I need it to tell me what is the last
   * state grading."* `GradingModal` cannot keep this itself — it is unmounted
   * between openings and, more importantly, a stored GRADE is a letter with no
   * checklist behind it. Only a caller that watched the answers being given
   * can hand them back.
   */
  const [selection, setSelection] = useState<GradingSelection>({});
  const [gradingOpen, setGradingOpen] = useState(false);
  /** Which of the two price cards is expanded into a table. */
  const [basisOpen, setBasisOpen] = useState<"COST" | "LIST" | null>(null);
  const [error, setError] = useState<string>();

  const sku = db.skus.find((s) => s.id === skuId);
  const model = db.models.find((m) => m.id === sku?.modelId);
  /** A grade is only asked of a machine there is something to inspect on. */
  const gradeRequired = condition === "SECOND";

  /**
   * What the shop's own stock of this variant cost it, unit by unit.
   *
   * The owner asked for the DETAIL behind "we have paid" (2026-09-01): which
   * machine, what grade, and what was paid for it. A range answered "roughly
   * what do these cost us" and left the obvious follow-up — *which* one went
   * for that — with nowhere to go.
   *
   * Machines already sold are included. What the shop paid is what the shop
   * paid, and excluding the ones that moved would bias the picture towards the
   * stock nobody wants.
   */
  const held = useMemo(
    () =>
      sku
        ? db.units
            .filter((u) => u.skuId === sku.id && u.buy > 0)
            .sort((a, b) => a.buy - b.buy)
        : [],
    [db.units, sku],
  );
  const costs = held.map((u) => u.buy);
  const low = costs[0];
  const high = costs[costs.length - 1];

  const reset = () => {
    form.resetFields();
    setSkuId(undefined);
    setCondition("SECOND");
    setGrade(undefined);
    setSelection({});
    setError(undefined);
  };

  const close = () => {
    reset();
    onCancel();
  };

  /**
   * What the field means, whichever barcode was put in it.
   *
   * Either barcode is taken, exactly as the scanner and the QC field take it:
   * the machine in the customer's hands may already carry somebody's sticker.
   * What comes back is always Apple's serial, because that is what a unit is
   * filed under.
   */
  const serialOf = (raw: string | undefined): string => {
    const typed = normaliseScan(raw ?? "");
    const codes = db.suppliers.map((x) => x.code ?? "");
    const inner = isStoreBarcode(typed, codes)
      ? typed.slice(SUPPLIER_CODE_LENGTH)
      : typed;
    /*
     * Always the typed route here, unlike Inbound & QC.
     *
     * The owner's 2026-09-01 rule marks a typed serial and refuses an unmarked
     * scan, and telling the two apart is a question about typing speed — which
     * is worth asking at the bench, where a scanner is registered and a burst
     * is how machines actually arrive. This dialog has no scan target: a
     * customer's machine turns up with no paperwork and no sticker, its serial
     * is read off the case, and every other field in the form has to be
     * answered by hand anyway. Nothing is lost by not asking — a scanned
     * barcode carries its own `S`, so `markTypedSerial` leaves it exactly as
     * it found it.
     */
    return markTypedSerial(inner);
  };

  const submit = () =>
    form
      .validateFields()
      .then((v) => {
        // The shape and the collision are the field's own rules now — see the
        // validator on the serial item. By here they have both passed.
        const serial = serialOf(v.serial);
        if (gradeRequired && !grade) {
          setError(
            t(
              "trade.gradeRequired",
              "Run the grading checklist — a second-hand machine reaches the bench with nothing on it otherwise.",
            ),
          );
          return;
        }
        onAdd({
          // The typed description always wins. It is what prints on the invoice,
          // and the customer's machine is often not quite the variant it
          // resembles — "MacBook Air 2017, dent on the lid" says more than the
          // SKU name.
          label: v.label.trim(),
          serial,
          value: v.value ?? 0,
          ...(v.note?.trim() ? { note: v.note.trim() } : {}),
          ...(skuId ? { skuId } : {}),
          condition,
          // `gradeForCondition` is what stops a sealed machine keeping a letter
          // and a second-hand one keeping `NEW` — see lib/condition.ts.
          ...(() => {
            const g = gradeForCondition(condition, grade);
            return g ? { grade: g } : {};
          })(),
          gradingSelection: selection,
        });
        reset();
      })
      .catch(() => {
        /*
         * The fields say it themselves.
         *
         * `validateFields` rejects with the same messages the form has already
         * painted under the boxes that failed, so there is nothing here left to
         * tell anybody — but an uncaught rejection is still an error in the
         * console, and since the serial's shape moved onto the field this is the
         * ORDINARY path rather than a rarity worth logging.
         */
      });

  /**
   * One of the two price cards.
   *
   * A button rather than a `Statistic`, because the owner asked for them to be
   * clickable and a figure that opens something has to look like it does. The
   * whole card is the target — a number with a small "details" link beside it
   * is two things where there is one.
   */
  const priceCard = (
    key: "LIST" | "COST",
    title: string,
    value: string,
    hint: string,
  ) => (
    <button
      type="button"
      onClick={() => setBasisOpen(key)}
      style={{
        flex: "1 1 180px",
        textAlign: "start",
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid rgba(0,0,0,0.12)",
        background: "transparent",
        cursor: "pointer",
        font: "inherit",
        color: "inherit",
      }}
    >
      <Flex vertical gap={2}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {title}
        </Typography.Text>
        <Typography.Text strong style={{ fontSize: 18 }}>
          {value}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {hint}
        </Typography.Text>
      </Flex>
    </button>
  );

  return (
    <>
      <Modal
        open={open}
        title={t("trade.title", "Take a machine against the bill")}
        okText={t("trade.add", "Add it")}
        onCancel={close}
        onOk={submit}
        width={640}
      >
        <Form form={form} layout="vertical">
          {error && (
            <Alert
              type="error"
              showIcon
              closable
              style={{ marginBottom: 16 }}
              title={error}
              onClose={() => setError(undefined)}
            />
          )}

          {/*
           * The variant first, because everything under it reads better once
           * the machine has a name — the category appears, the shop's own
           * numbers appear, and the grading checklist knows which criteria to
           * offer.
           */}
          <Form.Item
            label={req(t("trade.product", "Product"))}
            required
            tooltip={t(
              "trade.productHint",
              "The machine enters QC already knowing what it is — and picking it shows what the shop pays for the same variant.",
            )}
            validateStatus={skuId === undefined ? undefined : "success"}
          >
            <Select
              showSearch
              allowClear
              value={skuId}
              onChange={setSkuId}
              optionFilterProp="label"
              placeholder={t(
                "trade.searchProduct",
                "Search a product or variant",
              )}
              options={db.skus.map((k) => ({
                value: k.id,
                label: `${k.name} ${k.variantLabel}`,
              }))}
            />
          </Form.Item>

          <Flex gap={12} wrap>
            <Form.Item
              label={req(t("trade.category", "Category"))}
              required
              style={{ flex: "1 1 200px" }}
              // Shown, never asked: a category is a fact about the model, and
              // a second control for it would be a second answer that can
              // disagree with the first. The star says it must be answered;
              // picking the product is how.
              extra={
                model
                  ? undefined
                  : t("trade.categoryFromProduct", "Comes from the product.")
              }
            >
              <Input
                readOnly
                value={model?.category ?? ""}
                placeholder={t("trade.pickAProductFirst", "Pick a product")}
              />
            </Form.Item>
            <Form.Item
              name="serial"
              label={req(t("trade.serial", "Serial"))}
              style={{ flex: "1 1 220px" }}
              /*
               * On blur, not on every keystroke.
               *
               * A serial is thirteen characters typed one at a time, and every
               * prefix of a valid one is an invalid one — validating as it is
               * typed would put the field in red from the first character and
               * keep it there until the last. Blur is also where the QC grid
               * commits, so the two fields refuse at the same moment.
               */
              validateTrigger={["onBlur"]}
              // Capitals whatever the keyboard is doing (owner ask
              // 2026-09-01). `normalize` rather than an `onChange`, because
              // the value is owned by the Form: rewriting it anywhere else
              // would fight whatever the Form put there.
              normalize={(v: string) => v.toUpperCase()}
              rules={[
                {
                  required: true,
                  message: t(
                    "trade.serialRequired",
                    "Scan or type the machine's serial.",
                  ),
                },
                {
                  /*
                   * The shape rule the whole app runs on, and the collision,
                   * both on the field itself (owner ask 2026-09-01).
                   *
                   * They were an `Alert` at the top of a dialog that scrolls,
                   * which named a serial without pointing at the box holding
                   * it. A trade-in mints a unit exactly as intake does, so it
                   * is held to exactly the same serial — and now it says so in
                   * the same place, with the same red outline.
                   */
                  validator: (_, value: string) => {
                    const serial = serialOf(value);
                    // `required` above owns the empty case. Saying it twice
                    // would stack two messages under one field.
                    if (serial === "") return Promise.resolve();
                    if (validateSerial(serial) !== null) {
                      return Promise.reject(
                        new Error(
                          t(
                            "trade.serialShape",
                            "“{{serial}}” is not a serial. Type the {{min}}–{{max}} characters printed on the machine, or scan the barcode.",
                            {
                              serial,
                              min: BASE_MIN_LENGTH,
                              max: BASE_MAX_LENGTH,
                            },
                          ),
                        ),
                      );
                    }
                    if (db.units.some((u) => u.serial === serial)) {
                      return Promise.reject(
                        new Error(
                          t(
                            "trade.serialTaken",
                            "{{serial}} already belongs to a unit we carry.",
                            { serial },
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
                "The number printed on the machine — {{min}}–{{max}} characters. Type it without the S; the app puts that back. It enters QC under this serial, exactly as a machine off a purchase order would.",
                { min: BASE_MIN_LENGTH, max: BASE_MAX_LENGTH },
              )}
            >
              <Input
                maxLength={STORE_MAX_LENGTH}
                placeholder={t("trade.scanOrType", "Scan or type it")}
                style={{ fontFamily: "monospace" }}
              />
            </Form.Item>
          </Flex>

          <Flex gap={12} wrap align="flex-end">
            <Form.Item
              label={req(t("trade.condition", "Condition"))}
              required
              style={{ flex: "0 0 auto" }}
            >
              <Segmented
                value={condition}
                onChange={(v) => {
                  const next = v as UnitCondition;
                  setCondition(next);
                  // A sealed machine has no letter to keep. Same one-way rule
                  // the QC grid applies — see `gradeForCondition`.
                  if (next === "NEW") {
                    setGrade(undefined);
                    setSelection({});
                  }
                }}
                options={[
                  { value: "SECOND", label: t("trade.second", "Second") },
                  { value: "NEW", label: t("trade.new", "New") },
                ]}
              />
            </Form.Item>
            <Form.Item
              label={
                gradeRequired
                  ? req(t("trade.grading", "Grading & config"))
                  : t("trade.grading", "Grading & config")
              }
              required={gradeRequired}
              style={{ flex: "1 1 240px" }}
              // Required only on a second-hand machine, and that is not a
              // softening of the owner's ask: `lib/condition.ts` is explicit
              // that a sealed machine has nothing to inspect, and the QC grid
              // does not draw the button for one either. Demanding a checklist
              // for an unopened box would be asking somebody to invent one.
              extra={
                condition === "NEW"
                  ? t(
                      "trade.gradeNotForNew",
                      "Nothing to inspect in a sealed box.",
                    )
                  : undefined
              }
            >
              <Flex gap={8} align="center">
                <Button
                  disabled={condition === "NEW" || !model}
                  onClick={() => setGradingOpen(true)}
                >
                  {grade
                    ? t("trade.regrade", "Change grade")
                    : t("trade.grade", "Run the checklist")}
                </Button>
                <GradeTag grade={gradeForCondition(condition, grade)} plain />
                {condition === "SECOND" && !model && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t(
                      "trade.gradeNeedsProduct",
                      "Pick a product first — the checklist is per category.",
                    )}
                  </Typography.Text>
                )}
              </Flex>
            </Form.Item>
          </Flex>

          <Form.Item
            name="label"
            label={req(t("trade.description", "Description"))}
            rules={[
              {
                required: true,
                message: t(
                  "trade.descriptionRequired",
                  "Describe the machine — its marks and its age.",
                ),
              },
            ]}
            tooltip={t(
              "trade.descriptionHint",
              "In words, as it will read on the invoice — the marks and the age, not just the model.",
            )}
          >
            <Input
              placeholder={t(
                "trade.descriptionPlaceholder",
                "e.g. MacBook Air 2017 8/128, lecet di lid",
              )}
            />
          </Form.Item>

          {/*
           * The shop's own numbers for this variant, beside the box where the
           * price is typed. This is the owner's "show the other unit base
           * price", and both cards open the detail behind them.
           */}
          {sku && (
            <Flex gap={12} wrap style={{ marginBottom: 16 }}>
              {priceCard(
                "LIST",
                t("trade.weListAt", "We list it at"),
                fmtRp(sku.price),
                t("trade.seeStock", "See the machines behind this"),
              )}
              {held.length > 0 &&
                priceCard(
                  "COST",
                  t("trade.wePay", "We have paid ({{count}})", {
                    count: held.length,
                  }),
                  low === high
                    ? fmtRp(low ?? 0)
                    : `${fmtRp(low ?? 0)} – ${fmtRp(high ?? 0)}`,
                  t("trade.seeWhatWePaid", "See what each one cost"),
                )}
            </Flex>
          )}

          <Flex gap={12} wrap>
            <Form.Item
              name="value"
              label={req(t("trade.price", "Price"))}
              style={{ flex: "1 1 220px" }}
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
                "Comes off what the customer pays, and becomes the machine's cost when it enters stock.",
              )}
            >
              <MoneyInput style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name="note"
              label={t("trade.note", "Note")}
              style={{ flex: "1 1 260px" }}
            >
              <Input
                placeholder={t(
                  "trade.notePlaceholder",
                  "Anything QC should know",
                )}
              />
            </Form.Item>
          </Flex>

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t(
              "trade.entersQc",
              "The machine enters QC at this price as its cost, exactly as one off a purchase order does.",
            )}
          </Typography.Text>
        </Form>
      </Modal>

      {/*
       * The detail behind a price card (owner ask 2026-09-01).
       *
       * One dialog for both, because the table is the same either way — which
       * machine, what grade, what it cost — and only the heading differs. The
       * list price has no per-unit detail of its own, so its view is the same
       * machines with the shop's asking price beside them: the honest answer
       * to "what does this variant mean" in both directions.
       */}
      <Modal
        open={basisOpen !== null}
        onCancel={() => setBasisOpen(null)}
        footer={null}
        width={560}
        title={
          basisOpen === "COST"
            ? t("trade.whatWePaidTitle", "What we paid for these")
            : t("trade.whatWeListTitle", "What we list these at")
        }
      >
        <Flex vertical gap={12}>
          <Typography.Text type="secondary">
            {sku ? `${sku.name} ${sku.variantLabel}` : ""}
          </Typography.Text>
          <Table
            rowKey="serial"
            size="small"
            pagination={false}
            dataSource={held}
            locale={{
              emptyText: t(
                "trade.noneHeld",
                "The shop has never taken one of these in.",
              ),
            }}
            columns={[
              {
                title: t("trade.unit", "Unit"),
                dataIndex: "serial",
                render: (v: string) => (
                  <Typography.Text style={{ fontFamily: "monospace" }}>
                    {v}
                  </Typography.Text>
                ),
              },
              {
                title: t("trade.grade", "Grade"),
                key: "grade",
                width: 100,
                render: (_: unknown, u: (typeof held)[number]) => (
                  <GradeTag grade={u.grade} plain />
                ),
              },
              {
                title:
                  basisOpen === "COST"
                    ? t("trade.bought", "Bought for")
                    : t("trade.listedAt", "Listed at"),
                key: "money",
                align: "right" as const,
                render: (_: unknown, u: (typeof held)[number]) =>
                  basisOpen === "COST" ? fmtRp(u.buy) : fmtRp(sku?.price ?? 0),
              },
            ]}
          />
        </Flex>
      </Modal>

      <GradingModal
        open={gradingOpen}
        onClose={() => setGradingOpen(false)}
        category={model?.category ?? ""}
        subject={
          <Typography.Text type="secondary">
            {sku ? `${sku.name} ${sku.variantLabel}` : ""}
          </Typography.Text>
        }
        {...(grade ? { currentGrade: grade } : {})}
        // Reopens on the answers it was left with, which is the owner's ask.
        initialSelection={selection}
        onApply={(g, _inspection, picked) => {
          setGrade(g);
          setSelection(picked);
          setGradingOpen(false);
        }}
      />
    </>
  );
}
