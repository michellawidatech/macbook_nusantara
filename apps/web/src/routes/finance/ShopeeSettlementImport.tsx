/**
 * Upload a Shopee export and see what each waiting sale paid out.
 *
 * > *"For pending payment from shopee, add a upload excel. See the previous
 * > conversation about the cost structure in the md files. Then now the user
 * > can upload the file and the pending transaction will be calculated against
 * > the cost structure."*
 * > — owner, 2026-09-21
 *
 * > *"The user will upload this and then it will automatically edit like how
 * > much will we receive … the purpose of this file is to see what they
 * > actually receive, and the system will further add/breakdown what is the
 * > expense per pending payment based on rule base. However if there is
 * > discrepancies that are not mentioned in the rule just add like Biaya
 * > lainnya / additional payment."*
 * > — owner, later the same day, with the seller balance report attached
 *
 * Two documents stand behind this screen and both are worth reading before
 * changing it: `docs/shopee-fees.md` (the rates, where each came from, and
 * what the balance report settled) and `docs/shopee-settlement-import.md`
 * (which file to use, and why the obvious one cannot do the job).
 *
 * ## It takes any of three files, and says which it got
 *
 * | | what it carries | what this does |
 * |---|---|---|
 * | **Seller balance report** (Saldo Penjual → Export) | what each order paid into the Shopee balance | uses that figure; itemises it from the rates and names the rest |
 * | **Rincian Penghasilan** (Penghasilan Saya → Export) | Shopee's own payout per released order, often with its fee lines | uses the STATED payout; itemises from the stated fee columns, or from the rates, and names the rest |
 * | **Order.completed.*.xlsx** (Pesanan → Export) | 49 columns and not one fee | **estimates** from the rates, and says loudly that it did |
 *
 * The order export's `Total Pembayaran` is the BUYER's bill and is out by
 * −46.750 on one sampled order and +425.572 on another, so it is refused as a
 * payout column rather than offered (`ORDER_EXPORT_HEADERS`).
 *
 * ## The view (owner revision 2026-09-21)
 *
 * > *"Show all the transaction in the POS that are pending from shopee (ref
 * > number), then what is the received nominal in the excel file. If it does
 * > not match, highlight it as yellow row … surfaced at the top. So the
 * > structure of the table is Reference number | Order nominal | Receivable.
 * > For the Order nominal > Receivable, make like an arrow. Then, right next
 * > to the receivable add i detail button and when click it will show the
 * > deduction detail."*
 *
 * So the table is every waiting Shopee sale — in the file or not — and reads
 * left to right as the money moved: what the order was, an arrow carrying what
 * Shopee kept, and what landed, with an ⓘ that opens the deduction line by
 * line.
 *
 * **Yellow means "does not match"**: what Shopee paid is not what its published
 * fees predict — the difference is a Biaya Lainnya or a Pembayaran Tambahan —
 * or the row is not plain (a compensation beside the payout, nothing paid, a
 * number two sales share). Those rows go to the top. A sale that is simply not
 * in this file is not a mismatch: Shopee has not released it yet, and it sits
 * at the bottom, dimmed.
 *
 * ## What gets recorded
 *
 * `payoutRows` (lib/shopeeIncome.ts) does the deciding. On a stated payout the
 * deduction lines always close on Shopee's figure, so the pencil on the
 * Receivables row opens a deductions table that adds up to what landed, and
 * `SettlementLog` records any later correction exactly as it always has.
 *
 * Nothing unusual is ticked for the person — a compensation beside a payout, a
 * payout above what the rates allow for. A Biaya Lainnya on its own IS ticked:
 * the owner's rule is to name the difference and record it, and it is yellow so
 * that it is seen.
 *
 * The two conditional programmes — SPayLater XTRA and an affiliate's
 * commission — are switches only for ESTIMATED rows, the one case with no
 * figure of Shopee's to close on. That is the owner's 2026-09-20 rule kept
 * intact — *"the user should be the one adding the deduction"* — with the
 * shop's own published rates doing the typing.
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Flex,
  Modal,
  Popover,
  Select,
  Tag,
  theme,
  Typography,
  Upload,
} from "antd";
import {
  ArrowRightOutlined,
  InboxOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { DataTable } from "../../components/DataTable";
import { fmtRp, fmtNone } from "../../lib/format.js";
import { readXlsx, XlsxError, type XlsxSheet } from "../../lib/xlsxRead.js";
import {
  balanceLeftovers,
  detectIncomeLayout,
  incomeLines,
  normaliseOrderNo,
  payoutRows,
  reconcileIncome,
  type IncomeLayout,
  type IncomeLine,
  type IncomePart,
  type PayoutRow,
} from "../../lib/shopeeIncome.js";
import {
  EXTRA_PAYMENT_LABEL,
  OTHER_FEES_LABEL,
  feeWarnings,
  toSettlementFees,
  type EstimatedFee,
  type ShopeeSaleFacts,
  type SpayLaterTenor,
} from "../../lib/shopeeFees.js";
import type { SettlementDraft } from "../../lib/marketplace.js";
import { skuTracksSerial } from "../../lib/serialTracking.js";
import { nextId, useDb } from "../../mock/store.js";
import type { MockDb, Order } from "../../mock/seed.js";
import { COLUMN, SPACE, TYPE } from "../../theme/tokens";

/** One waiting Shopee payment, as this screen needs it. */
export interface PendingShopeePayment {
  readonly key: string;
  readonly order: Order;
  readonly paymentId: string;
  readonly ref?: string;
  readonly gross: number;
}

/** One waiting Shopee sale, and what the file says of it. */
interface PreviewRow {
  readonly key: string;
  readonly code: string;
  /** The Shopee order number the sale carries, when it carries one. */
  readonly ref?: string;
  readonly gross: number;
  /** What the file says, when this sale is in it. */
  readonly worked?: PayoutRow<PendingShopeePayment>;
  /** Two waiting sales carry this number; which one it paid is not a guess. */
  readonly ambiguous: boolean;
  /** Yellow, at the top. See the header. */
  readonly mismatch: boolean;
  /** Sentences about fee lines Shopee printed. Only for those. */
  readonly warnings: readonly string[];
  readonly draft?: SettlementDraft;
}

/** How many unmatched order numbers the summary spells out. */
const UNMATCHED_SHOWN = 8;

/** The line no rule accounted for, when there is one. */
const leftoverOf = (fees: readonly EstimatedFee[]) =>
  fees.find(
    (f) => f.label === OTHER_FEES_LABEL || f.label === EXTRA_PAYMENT_LABEL,
  );

export function ShopeeSettlementImport({
  open,
  pending,
  settledRefs,
  onClose,
  onRecord,
}: {
  readonly open: boolean;
  readonly pending: readonly PendingShopeePayment[];
  /** Order numbers already recorded as received, so a re-upload says so. */
  readonly settledRefs: readonly string[];
  readonly onClose: () => void;
  /** Writes the settlements. `ReceivablesPage.record` — the same path a
   *  hand-typed withdrawal takes. */
  readonly onRecord: (drafts: readonly SettlementDraft[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const { token } = theme.useToken();
  const db = useDb();
  const [sheets, setSheets] = useState<XlsxSheet[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [spayLater, setSpayLater] = useState<SpayLaterTenor>("NONE");
  const [affiliate, setAffiliate] = useState(false);
  const [picked, setPicked] = useState<string[] | null>(null);
  /** Guards a second upload landing while the first is still being read. */
  const reading = useRef(false);

  const layout: IncomeLayout | undefined = useMemo(
    () => (sheets === null ? undefined : detectIncomeLayout(sheets)),
    [sheets],
  );
  const sheet: XlsxSheet | undefined =
    sheets === null || layout === undefined ? undefined : sheets[layout.sheet];
  const lines: IncomeLine[] = useMemo(
    () =>
      sheet === undefined || layout === undefined
        ? []
        : incomeLines(sheet, layout),
    [sheet, layout],
  );
  const leftovers = useMemo(
    () =>
      sheet === undefined || layout === undefined
        ? undefined
        : balanceLeftovers(sheet, layout),
    [sheet, layout],
  );

  /** Which admin band a sale falls in — an accessory pays 6,75%, not 5,25%. */
  const categoryOf = (order: Order): ShopeeSaleFacts["category"] => {
    const ids = [
      ...order.serials.map((s) => db.units.find((u) => u.serial === s)?.skuId),
      ...(order.lines ?? []).map((l) => l.skuId),
    ].filter((id): id is string => id !== undefined);
    if (ids.length === 0) return "LAPTOP";
    // Every line an accessory, or the sale is a laptop sale: a mixed order is
    // charged per item by Shopee, and the cheaper band under-states the fee,
    // which is the direction that over-states what the shop is owed.
    return ids.every((id) => !skuTracksSerial(db, id)) ? "ACCESSORY" : "LAPTOP";
  };

  const reconciliation = useMemo(
    () => reconcileIncome(lines, pending, (p) => p.ref, settledRefs),
    [lines, pending, settledRefs],
  );

  const rows = useMemo<PreviewRow[]>(() => {
    if (sheets === null) return [];
    const worked = new Map(
      payoutRows(
        reconciliation.matched,
        layout ?? {},
        (p) => p.gross,
        (p, estimating) => ({
          gross: p.gross,
          qty: Math.max(
            1,
            p.order.serials.length +
              (p.order.lines ?? []).reduce((n, l) => n + l.qty, 0),
          ),
          category: categoryOf(p.order),
          // The switches describe a sale nobody has a payout for yet. On a
          // stated payout they would only cut Biaya Lainnya into a guess.
          ...(estimating && spayLater !== "NONE" ? { spayLater } : {}),
          ...(estimating && affiliate ? { affiliate: true } : {}),
        }),
      ).map((w) => [w.pending.key, w]),
    );
    const shared = new Set(reconciliation.ambiguous.map((l) => l.orderNo));
    const all = pending.map((p): PreviewRow => {
      const w = worked.get(p.key);
      const ambiguous =
        w === undefined && p.ref !== undefined && shared.has(p.ref);
      const base = {
        key: p.key,
        code: p.order.code,
        ...(p.ref ? { ref: p.ref } : {}),
        gross: p.gross,
        ambiguous,
      };
      if (w === undefined) {
        return { ...base, mismatch: ambiguous, warnings: [] };
      }
      const fees = toSettlementFees(w.fees, () => nextId("fee"));
      return {
        ...base,
        worked: w,
        mismatch:
          !w.recordable ||
          w.review.length > 0 ||
          (w.status === "STATED" && leftoverOf(w.fees) !== undefined),
        warnings: w.feesStated
          ? feeWarnings(
              {
                gross: w.gross,
                qty: 1,
                category: categoryOf(p.order),
              },
              fees,
            )
          : [],
        draft: {
          paymentId: p.paymentId,
          orderId: p.order.id,
          gross: w.gross,
          fees,
          received: w.received,
          ...(w.status === "ESTIMATED"
            ? {
                reason: t(
                  "shopeeImport.estimatedReason",
                  "Estimated from Shopee's published rates — correct it when the payout lands.",
                ),
              }
            : {}),
        },
      };
    });
    // Yellow first, then what matched cleanly, then what this file does not
    // mention yet. Each group keeps the order the sales were made in.
    const rank = (r: PreviewRow) =>
      r.mismatch ? 0 : r.worked !== undefined ? 1 : 2;
    return all
      .map((r, i) => ({ r, i }))
      .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
      .map(({ r }) => r);
  }, [
    sheets,
    reconciliation,
    pending,
    layout,
    spayLater,
    affiliate,
    db.units,
    db.skus,
    db.models,
    db.categories,
    t,
  ]);

  const chosen =
    picked ?? rows.filter((r) => r.worked?.preselect).map((r) => r.key);
  const chosenRows = rows.filter(
    (r) => r.worked?.recordable === true && chosen.includes(r.key),
  );
  const estimatedCount = rows.filter(
    (r) => r.worked?.status === "ESTIMATED",
  ).length;
  const mismatchCount = rows.filter((r) => r.mismatch).length;

  const reset = () => {
    setSheets(null);
    setFileName("");
    setError(null);
    setPicked(null);
  };

  const take = async (file: File) => {
    if (reading.current) return;
    reading.current = true;
    try {
      setSheets(await readXlsx(await file.arrayBuffer()));
      setFileName(file.name);
      setError(null);
      setPicked(null);
    } catch (e) {
      setSheets(null);
      setError(
        e instanceof XlsxError
          ? e.message
          : t(
              "shopeeImport.unreadable",
              "That file could not be read as a spreadsheet.",
            ),
      );
    } finally {
      reading.current = false;
    }
  };

  const apply = () => {
    if (chosenRows.length === 0) return;
    onRecord(chosenRows.flatMap((r) => (r.draft ? [r.draft] : [])));
    reset();
    onClose();
  };

  /** "5,25%" in Indonesian, "5.25%" in English — beside the line it priced. */
  const rateText = (rate: number) =>
    `${rate.toLocaleString(i18n.language === "id" ? "id-ID" : "en-GB", {
      maximumFractionDigits: 2,
    })}%`;

  /** A signed amount the way a statement writes one: "+Rp 10.000.000". */
  const signed = (n: number) => `${n < 0 ? "−" : "+"}${fmtRp(Math.abs(n))}`;

  const partsText = (parts: readonly IncomePart[]) =>
    parts.map((x) => `${x.label} ${signed(x.amount)}`).join(" · ");

  /** Why a row is yellow, in a few words under its receivable. */
  const reasonOf = (r: PreviewRow): string | undefined => {
    if (r.ambiguous) {
      return t(
        "shopeeImport.reasonShared",
        "Two waiting sales carry this number",
      );
    }
    const w = r.worked;
    if (w === undefined || !r.mismatch) return undefined;
    if (w.status === "NOTHING_PAID") {
      return t(
        "shopeeImport.reasonNothing",
        "Nothing paid — a refund or a return",
      );
    }
    if (w.status === "UNREADABLE") {
      return t(
        "shopeeImport.reasonUnreadable",
        "Shopee's figure could not be read",
      );
    }
    if (w.review.some((x) => x.kind === "PARTS")) {
      return t("shopeeImport.reasonParts", "More than a plain payout");
    }
    const rest = leftoverOf(w.fees);
    if (rest === undefined) return undefined;
    // The line's own name and figure — the words the deduction will carry.
    return `${rest.label} ${
      rest.amount < 0 ? signed(-rest.amount) : fmtRp(rest.amount)
    }`;
  };

  /** Everything a person should read about a row, in full sentences. */
  const notesOf = (r: PreviewRow): string[] => {
    const w = r.worked;
    if (w === undefined) return [];
    if (w.status === "NOTHING_PAID") {
      return [
        t(
          "shopeeImport.nothingPaid",
          "Shopee paid nothing for this order ({{amount}}) — a refund or a return. Handle it on Returns, not here.",
          { amount: signed(w.received) },
        ),
      ];
    }
    if (w.status === "UNREADABLE") {
      return [
        t(
          "shopeeImport.unreadableRow",
          "Shopee's figure for this order could not be read. Record it by hand.",
        ),
      ];
    }
    return [
      ...w.review.map((x) =>
        x.kind === "PARTS"
          ? t(
              "shopeeImport.reviewParts",
              "More than a plain payout: {{parts}}. Check the sale, then tick it.",
              { parts: partsText(w.line.parts ?? []) },
            )
          : t(
              "shopeeImport.reviewAbove",
              "Shopee paid {{amount}} more than its fees leave room for. Check the sale's amount, then tick it.",
              { amount: fmtRp(x.amount) },
            ),
      ),
      ...r.warnings,
    ];
  };

  /** The deduction, line by line — what the ⓘ opens. */
  const detail = (r: PreviewRow): ReactNode => {
    const w = r.worked!;
    const deducted = w.gross - w.received;
    const notes = notesOf(r);
    return (
      <Flex vertical gap={SPACE.xs} style={{ width: 340, maxWidth: "80vw" }}>
        {w.fees.map((f, i) => (
          <Flex key={`${i}-${f.label}`} justify="space-between" gap={SPACE.md}>
            <Typography.Text
              type={leftoverOf([f]) !== undefined ? "warning" : undefined}
            >
              {f.label}
              {f.rate !== undefined && (
                <Typography.Text type="secondary">
                  {` · ${rateText(f.rate)}`}
                </Typography.Text>
              )}
            </Typography.Text>
            <Typography.Text>
              {f.amount < 0 ? signed(-f.amount) : fmtRp(f.amount)}
            </Typography.Text>
          </Flex>
        ))}
        {w.fees.length > 0 && (
          <Flex
            justify="space-between"
            gap={SPACE.md}
            style={{ borderTop: `1px solid ${token.colorBorderSecondary}` }}
          >
            <Typography.Text strong>
              {t("shopeeImport.totalDeducted", "Deducted")}
            </Typography.Text>
            <Typography.Text strong>{fmtRp(deducted)}</Typography.Text>
          </Flex>
        )}
        {(w.line.parts?.length ?? 0) > 1 && (
          <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
            {t("shopeeImport.inTheBalance", "In the balance: {{parts}}", {
              parts: partsText(w.line.parts ?? []),
            })}
          </Typography.Text>
        )}
        {w.line.released !== undefined && (
          <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
            {t("shopeeImport.paidIn", "Paid in {{when}}", {
              when: w.line.released,
            })}
          </Typography.Text>
        )}
        {notes.map((sentence) => (
          <Typography.Text
            key={sentence}
            type="warning"
            style={{ fontSize: TYPE.sm }}
          >
            {sentence}
          </Typography.Text>
        ))}
      </Flex>
    );
  };

  /** Order nominal → receivable: the arrow carries what Shopee kept. */
  const arrowCell = (r: PreviewRow): ReactNode => {
    const w = r.worked;
    if (w === undefined || w.status === "UNREADABLE") return null;
    const change = w.received - w.gross;
    return (
      <Flex vertical align="center" gap={0}>
        <Typography.Text
          type={change > 0 ? "success" : "secondary"}
          style={{ fontSize: TYPE.sm, whiteSpace: "nowrap" }}
        >
          {change === 0 ? "" : signed(change)}
        </Typography.Text>
        <ArrowRightOutlined
          aria-hidden
          style={{
            color:
              w.status === "NOTHING_PAID"
                ? token.colorError
                : token.colorTextTertiary,
          }}
        />
      </Flex>
    );
  };

  const receivableCell = (r: PreviewRow): ReactNode => {
    const w = r.worked;
    const reason = reasonOf(r);
    if (w === undefined) {
      return (
        <Flex vertical align="flex-end" gap={0}>
          <Typography.Text type="secondary">
            {r.ref === undefined
              ? t("shopeeImport.noRefYet", "No Shopee order number on the sale")
              : t("shopeeImport.notInFile", "Not in this file")}
          </Typography.Text>
          {reason !== undefined && (
            <Typography.Text type="warning" style={{ fontSize: TYPE.sm }}>
              {reason}
            </Typography.Text>
          )}
        </Flex>
      );
    }
    return (
      <Flex align="center" justify="flex-end" gap={SPACE.xs}>
        <Flex vertical align="flex-end" gap={0}>
          <Typography.Text
            strong
            type={w.status === "NOTHING_PAID" ? "danger" : undefined}
          >
            {/* An unreadable cell is not a zero: Rp 0 is what a refund says. */}
            {w.status === "UNREADABLE" ? fmtNone() : fmtRp(w.received)}
          </Typography.Text>
          {w.status === "ESTIMATED" && (
            <Tag color="orange" style={{ marginInlineEnd: 0 }}>
              {t("shopeeImport.estimated", "Estimated")}
            </Tag>
          )}
          {reason !== undefined && (
            <Typography.Text
              type="warning"
              style={{ fontSize: TYPE.sm, textAlign: "right" }}
            >
              {reason}
            </Typography.Text>
          )}
        </Flex>
        <Popover
          trigger="click"
          placement="left"
          title={t("shopeeImport.deductionDetail", "Deduction detail")}
          content={detail(r)}
        >
          <Button
            type="text"
            size="small"
            icon={<InfoCircleOutlined />}
            aria-label={t(
              "shopeeImport.detailFor",
              "Deduction detail for {{ref}}",
              { ref: r.ref ?? r.code },
            )}
          />
        </Popover>
      </Flex>
    );
  };

  const unmatched = reconciliation.unknown.map((l) => l.orderNo);

  return (
    <Modal
      open={open}
      width={920}
      title={t("shopeeImport.title", "Upload a Shopee report")}
      onCancel={() => {
        reset();
        onClose();
      }}
      okText={t("shopeeImport.record", "Record {{count}} payout(s)", {
        count: chosenRows.length,
      })}
      okButtonProps={{ disabled: chosenRows.length === 0 }}
      onOk={apply}
    >
      <Flex vertical gap={SPACE.md}>
        <Upload.Dragger
          accept=".xlsx"
          maxCount={1}
          showUploadList={false}
          beforeUpload={(file) => {
            void take(file as unknown as File);
            // Nothing is uploaded anywhere: the workbook is read in the
            // browser, exactly as the stock export is written in it.
            return false;
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">
            {fileName === ""
              ? t("shopeeImport.drop", "Drop the Shopee .xlsx here")
              : fileName}
          </p>
          <p className="ant-upload-hint">
            {t(
              "shopeeImport.which",
              "The seller balance report (Saldo Penjual → Export) or the income report (Penghasilan Saya → Export) has what Shopee actually paid. An order export works too, and is estimated from the published rates.",
            )}
          </p>
        </Upload.Dragger>

        {error !== null && <Alert type="error" showIcon title={error} />}

        {sheets !== null && layout?.orderExport === true && (
          <Alert
            type="warning"
            showIcon
            title={t(
              "shopeeImport.orderExportTitle",
              "This is the order export — it carries no payout",
            )}
            description={t(
              "shopeeImport.orderExportBody",
              "Its only money column is the buyer's bill, which is not what Shopee pays the shop. Every figure below is ESTIMATED from the published rates instead. Correct each one when the real payout lands.",
            )}
          />
        )}

        {sheets !== null && lines.length === 0 && (
          <Alert
            type="warning"
            showIcon
            title={t(
              "shopeeImport.noOrders",
              "No order numbers were found in that file.",
            )}
          />
        )}

        {sheets !== null && estimatedCount > 0 && (
          <Flex vertical gap={SPACE.xs}>
            <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
              {t(
                "shopeeImport.conditionalHint",
                "Two fee lines cannot be read from any export — whether the buyer took 0% instalments, and whether an affiliate sold it. They are the difference between a sale costing 6,9% and 12,0%, so they are asked rather than guessed.",
              )}
            </Typography.Text>
            <Flex gap={SPACE.md} wrap align="center">
              <Select<SpayLaterTenor>
                size="small"
                style={{ minWidth: 220 }}
                value={spayLater}
                onChange={setSpayLater}
                options={[
                  {
                    value: "NONE",
                    label: t("shopeeImport.noInstalment", "No 0% instalment"),
                  },
                  {
                    value: "THREE_MONTHS",
                    label: t(
                      "shopeeImport.spay3",
                      "SPayLater XTRA 0%, 3 months (2,5%)",
                    ),
                  },
                  {
                    value: "SIX_MONTHS",
                    label: t(
                      "shopeeImport.spay6",
                      "SPayLater XTRA 0%, 6 months (4,0%)",
                    ),
                  },
                ]}
              />
              <Checkbox
                checked={affiliate}
                onChange={(e) => setAffiliate(e.target.checked)}
              >
                {t(
                  "shopeeImport.affiliate",
                  "Sold through an affiliate (1% + PPN)",
                )}
              </Checkbox>
            </Flex>
          </Flex>
        )}

        {sheets !== null && mismatchCount > 0 && (
          <Typography.Text style={{ fontSize: TYPE.sm }}>
            <span className="shopee-legend-swatch" aria-hidden />
            {t(
              "shopeeImport.mismatchLegend",
              "{{count}} highlighted at the top: what Shopee paid does not match its published fees, or the row needs a look. The ⓘ beside a receivable shows the deduction.",
              { count: mismatchCount },
            )}
          </Typography.Text>
        )}

        {rows.length > 0 && (
          <DataTable<PreviewRow>
            rowKey="key"
            size="small"
            cards={false}
            paginated={false}
            dataSource={rows}
            rowClassName={(r) =>
              r.mismatch
                ? "shopee-row-mismatch"
                : r.worked === undefined
                  ? "shopee-row-absent"
                  : ""
            }
            rowSelection={{
              selectedRowKeys: chosen,
              onChange: (keys) => setPicked(keys.map(String)),
              getCheckboxProps: (r) => ({
                disabled: r.worked?.recordable !== true,
              }),
            }}
            columns={[
              {
                title: t("shopeeImport.refCol", "Reference number"),
                key: "ref",
                render: (_: unknown, r: PreviewRow) => (
                  <Flex vertical gap={0} align="flex-start">
                    <Typography.Text strong style={{ fontFamily: "monospace" }}>
                      {r.ref ?? t("piutang.noRef", "No reference")}
                    </Typography.Text>
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: TYPE.sm }}
                    >
                      {r.code}
                    </Typography.Text>
                  </Flex>
                ),
              },
              {
                title: t("shopeeImport.orderNominal", "Order nominal"),
                key: "gross",
                width: COLUMN.money,
                align: "right" as const,
                render: (_: unknown, r: PreviewRow) => fmtRp(r.gross),
              },
              {
                // The arrow between the two figures, carrying what Shopee kept.
                // Untitled: it belongs to the pair either side of it.
                title: "",
                key: "arrow",
                width: 120,
                align: "center" as const,
                render: (_: unknown, r: PreviewRow) => arrowCell(r),
              },
              {
                title: t("shopeeImport.receivable", "Receivable"),
                key: "receivable",
                width: 250,
                align: "right" as const,
                render: (_: unknown, r: PreviewRow) => receivableCell(r),
              },
            ]}
          />
        )}

        {rows.length > 0 && (
          <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
            {t(
              "shopeeImport.summary",
              "{{count}} of {{total}} selected · {{amount}} will be recorded as received.",
              {
                count: chosenRows.length,
                total: rows.filter((r) => r.worked?.recordable).length,
                amount: fmtRp(
                  chosenRows.reduce((n, r) => n + (r.worked?.received ?? 0), 0),
                ),
              },
            )}
          </Typography.Text>
        )}

        {sheets !== null && (
          <Flex vertical gap={SPACE.xs}>
            <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
              {t(
                "shopeeImport.leftovers",
                "{{unknown}} order number(s) in the file match no waiting sale, {{ambiguous}} match more than one, {{already}} were already recorded, and {{missing}} waiting sale(s) are not in the file.",
                {
                  unknown: unmatched.length,
                  ambiguous: reconciliation.ambiguous.length,
                  already: reconciliation.alreadySettled.length,
                  missing: reconciliation.missing.length,
                },
              )}
            </Typography.Text>
            {unmatched.length > 0 && (
              <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                {t(
                  "shopeeImport.unmatchedList",
                  "Not matched — a sale without this Shopee order number as its reference: {{list}}",
                  {
                    list:
                      unmatched.slice(0, UNMATCHED_SHOWN).join(", ") +
                      (unmatched.length > UNMATCHED_SHOWN
                        ? ` ${t("shopeeImport.andMore", "and {{count}} more", {
                            count: unmatched.length - UNMATCHED_SHOWN,
                          })}`
                        : ""),
                  },
                )}
              </Typography.Text>
            )}
            {leftovers !== undefined && leftovers.other.length > 0 && (
              <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                {t(
                  "shopeeImport.balanceOther",
                  "Also in the balance, and not recorded here: {{list}}.",
                  {
                    list: leftovers.other
                      .map(
                        (o) => `${o.label} ×${o.count} (${signed(o.amount)})`,
                      )
                      .join(" · "),
                  },
                )}
              </Typography.Text>
            )}
            {leftovers !== undefined && leftovers.notDone > 0 && (
              <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                {t(
                  "shopeeImport.notDone",
                  "{{count}} order row(s) have not finished moving and were left out.",
                  { count: leftovers.notDone },
                )}
              </Typography.Text>
            )}
          </Flex>
        )}
      </Flex>
    </Modal>
  );
}

/** Every Shopee payment still waiting, as this dialog wants them. */
export function pendingShopeePayments(
  db: MockDb,
  paymentsOf: (o: Order) => readonly {
    id: string;
    state: string;
    amount: number;
    channel?: string;
    ref?: string;
  }[],
): PendingShopeePayment[] {
  const out: PendingShopeePayment[] = [];
  for (const o of db.orders) {
    for (const p of paymentsOf(o)) {
      if (p.state !== "PENDING") continue;
      if ((p.channel ?? o.source) !== "SHOPEE") continue;
      out.push({
        key: `${o.id}-${p.id}`,
        order: o,
        paymentId: p.id,
        ...(p.ref ? { ref: normaliseOrderNo(p.ref) } : {}),
        gross: p.amount,
      });
    }
  }
  return out;
}
