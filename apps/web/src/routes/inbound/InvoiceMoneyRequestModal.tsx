/**
 * *Request edit* on a purchase invoice's money (2026-11-13) — for a person
 * who cannot approve.
 *
 * QC stays open to everybody; what money has already gone out against does
 * not. This dialog holds exactly what the page locks for them: each line's
 * unit price and discount, each expense's amount (or its removal), and each
 * payment's amount (or its removal). The page turns the answers into the
 * same writes its own boxes make (`onSend` receives them) and files them as
 * one change request with why.
 */
import { useEffect, useMemo, useState } from "react";
import { App, Checkbox, Divider, Flex, Form, Modal, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { MoneyInput } from "../../components/MoneyInput";
import {
  RequestNoteField,
  requestFailedText,
} from "../../components/ChangeRequestParts";
import type { Po, PoFee, PoPayment, Sku } from "../../mock/seed.js";
import type { PurchaseLine } from "../../lib/invoiceLines.js";
import { fmtDate, fmtRp } from "../../lib/format.js";
import { SPACE } from "../../theme/tokens";

/** What the requester changed, by the page's own keys. */
export interface InvoiceMoneyEdits {
  readonly lines: readonly {
    readonly key: string;
    readonly unitCost: number;
    readonly discount: number;
  }[];
  readonly fees: readonly {
    readonly id: string;
    /** Null removes it. */
    readonly amount: number | null;
  }[];
  readonly payments: readonly {
    readonly id: string;
    /** Null removes it. */
    readonly amount: number | null;
  }[];
}

export interface InvoiceMoneyRequestModalProps {
  readonly open: boolean;
  readonly po: Po;
  readonly lines: readonly PurchaseLine[];
  readonly skus: readonly Sku[];
  readonly feeName: (fee: PoFee) => string;
  /** The payments this dialog may touch — not a deposit's or a return's. */
  readonly payments: readonly PoPayment[];
  readonly onClose: () => void;
  readonly onSend: (edits: InvoiceMoneyEdits, note: string) => Promise<unknown>;
}

export function InvoiceMoneyRequestModal({
  open,
  po,
  lines,
  skus,
  feeName,
  payments,
  onClose,
  onSend,
}: InvoiceMoneyRequestModalProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const priced = useMemo(() => lines.filter((l) => l.unitCost > 0), [lines]);
  const [cost, setCost] = useState<Record<string, number | null>>({});
  const [discount, setDiscount] = useState<Record<string, number | null>>({});
  const [fee, setFee] = useState<Record<string, number | null>>({});
  const [feeGone, setFeeGone] = useState<Record<string, boolean>>({});
  const [pay, setPay] = useState<Record<string, number | null>>({});
  const [payGone, setPayGone] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCost(Object.fromEntries(priced.map((l) => [l.key, l.unitCost])));
    setDiscount(Object.fromEntries(priced.map((l) => [l.key, l.discount])));
    setFee(Object.fromEntries(po.fees.map((f) => [f.id, f.amount])));
    setFeeGone({});
    setPay(Object.fromEntries(payments.map((p) => [p.id, p.amount])));
    setPayGone({});
    setNote("");
    setTried(false);
    // Seeded once per opening, like the page's other dialogs: re-running on
    // every store change would reset the boxes under somebody's hand.
  }, [open]);

  const productName = (skuId: string) => {
    const s = skus.find((k) => k.id === skuId);
    return s ? `${s.code} — ${s.name} ${s.variantLabel}`.trim() : skuId;
  };

  const edits = (): InvoiceMoneyEdits => ({
    lines: priced.flatMap((l) => {
      const c = cost[l.key] ?? l.unitCost;
      const d = discount[l.key] ?? 0;
      return c === l.unitCost && d === l.discount
        ? []
        : [{ key: l.key, unitCost: c, discount: d }];
    }),
    fees: po.fees.flatMap((f): InvoiceMoneyEdits["fees"][number][] =>
      feeGone[f.id]
        ? [{ id: f.id, amount: null }]
        : (fee[f.id] ?? f.amount) !== f.amount
          ? [{ id: f.id, amount: fee[f.id] ?? f.amount }]
          : [],
    ),
    payments: payments.flatMap((p): InvoiceMoneyEdits["payments"][number][] =>
      payGone[p.id]
        ? [{ id: p.id, amount: null }]
        : (pay[p.id] ?? p.amount) !== p.amount
          ? [{ id: p.id, amount: pay[p.id] ?? p.amount }]
          : [],
    ),
  });

  const send = async () => {
    setTried(true);
    if (note.trim() === "") return;
    const e = edits();
    if (e.lines.length + e.fees.length + e.payments.length === 0) {
      message.error(
        t(
          "changeReq.nothing",
          "Nothing has changed, so there is nothing to ask.",
        ),
      );
      return;
    }
    const tooBig = e.lines.find((x) => {
      const l = priced.find((y) => y.key === x.key);
      return l !== undefined && x.discount > x.unitCost * l.qty;
    });
    if (tooBig !== undefined || e.lines.some((x) => !(x.unitCost > 0))) {
      message.error(
        t(
          "changeReq.invoiceBadLine",
          "A unit price must be above zero, and a discount no more than its line is worth.",
        ),
      );
      return;
    }
    if (
      e.fees.some((x) => x.amount !== null && !(x.amount > 0)) ||
      e.payments.some((x) => x.amount !== null && !(x.amount > 0))
    ) {
      message.error(
        t(
          "changeReq.invoiceBadAmount",
          "An amount must be above zero — tick Remove to take one off.",
        ),
      );
      return;
    }
    setSending(true);
    try {
      await onSend(e, note);
      message.success(
        t("changeReq.sent", "Request sent. An approver will decide."),
      );
      onClose();
    } catch (err) {
      message.error(requestFailedText(err, t));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      width={760}
      title={t(
        "changeReq.invoiceTitle",
        "Ask to change the money on {{code}}",
        {
          code: po.code,
        },
      )}
      okText={t("changeReq.send", "Send request")}
      okButtonProps={{ loading: sending }}
      onOk={() => void send()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form layout="vertical">
        <Divider plain>{t("changeReq.invoiceLines", "Lines")}</Divider>
        {priced.length === 0 && (
          <Typography.Text type="secondary">
            {t("changeReq.invoiceNoLines", "No priced lines.")}
          </Typography.Text>
        )}
        {priced.map((l) => (
          <Flex key={l.key} gap={SPACE.sm} align="flex-end" wrap>
            <Form.Item
              label={`${productName(l.skuId)} × ${l.qty}`}
              style={{ flex: "2 1 260px", marginBottom: SPACE.sm }}
            >
              <MoneyInput
                value={cost[l.key] ?? undefined}
                min={1}
                aria-label={t(
                  "changeReq.lineCostAria",
                  "Unit price of {{product}}",
                  {
                    product: productName(l.skuId),
                  },
                )}
                onChange={(v) => setCost((m) => ({ ...m, [l.key]: v }))}
              />
            </Form.Item>
            <Form.Item
              label={t("inbound.lineDiscount", "Discount")}
              style={{ flex: "1 1 160px", marginBottom: SPACE.sm }}
            >
              <MoneyInput
                value={discount[l.key] ?? undefined}
                aria-label={t(
                  "changeReq.lineDiscountAria",
                  "Discount on {{product}}",
                  { product: productName(l.skuId) },
                )}
                onChange={(v) => setDiscount((m) => ({ ...m, [l.key]: v }))}
              />
            </Form.Item>
          </Flex>
        ))}

        {po.fees.length > 0 && (
          <>
            <Divider plain>
              {t("changeReq.invoiceExpenses", "Expenses")}
            </Divider>
            {po.fees.map((f) => (
              <Flex key={f.id} gap={SPACE.sm} align="center" wrap>
                <Form.Item
                  label={feeName(f)}
                  style={{ flex: "2 1 260px", marginBottom: SPACE.sm }}
                >
                  <MoneyInput
                    value={fee[f.id] ?? undefined}
                    min={1}
                    disabled={feeGone[f.id] === true}
                    aria-label={t("changeReq.feeAria", "Amount of {{name}}", {
                      name: feeName(f),
                    })}
                    onChange={(v) => setFee((m) => ({ ...m, [f.id]: v }))}
                  />
                </Form.Item>
                <Checkbox
                  checked={feeGone[f.id] === true}
                  onChange={(e) =>
                    setFeeGone((m) => ({ ...m, [f.id]: e.target.checked }))
                  }
                >
                  {t("changeReq.remove", "Remove")}
                </Checkbox>
              </Flex>
            ))}
          </>
        )}

        {payments.length > 0 && (
          <>
            <Divider plain>
              {t("changeReq.invoicePayments", "Payments")}
            </Divider>
            {payments.map((p) => (
              <Flex key={p.id} gap={SPACE.sm} align="center" wrap>
                <Form.Item
                  label={t("changeReq.paymentOn", "Paid {{date}}", {
                    date: fmtDate(p.at),
                  })}
                  style={{ flex: "2 1 260px", marginBottom: SPACE.sm }}
                >
                  <MoneyInput
                    value={pay[p.id] ?? undefined}
                    min={1}
                    disabled={payGone[p.id] === true}
                    aria-label={t(
                      "changeReq.paymentAria",
                      "Amount of the payment of {{amount}}",
                      { amount: fmtRp(p.amount) },
                    )}
                    onChange={(v) => setPay((m) => ({ ...m, [p.id]: v }))}
                  />
                </Form.Item>
                <Checkbox
                  checked={payGone[p.id] === true}
                  onChange={(e) =>
                    setPayGone((m) => ({ ...m, [p.id]: e.target.checked }))
                  }
                >
                  {t("changeReq.remove", "Remove")}
                </Checkbox>
              </Flex>
            ))}
          </>
        )}

        <div style={{ marginTop: SPACE.md }}>
          <RequestNoteField value={note} onChange={setNote} showError={tried} />
        </div>
      </Form>
    </Modal>
  );
}
