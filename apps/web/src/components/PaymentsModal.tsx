/**
 * Correcting what a customer paid, with the log that makes it safe.
 *
 * > *"For the transaction, we should also be able to edit how much the user
 * > have paid, for error handling, but keep a log for it. So each transaction
 * > should also have their own transaction history and is editable."*
 * > — owner, 2026-09-08
 *
 * Two halves, and the second is the reason the first is allowed to exist. The
 * top is `PaymentsPanel` — the same grid the till records a split on, so a
 * sale reads back the way it was entered. The bottom is every change ever made
 * to this sale's money, oldest last.
 *
 * ## Why the log is not optional
 *
 * The reason to permit an edit at all is that somebody typed Rp5.000.000 when
 * they meant Rp500.000. That is found weeks later, by a customer disputing a
 * balance — and what finds it is the number BEFORE the correction, which is
 * precisely what an in-place edit destroys. So a save writes one log row per
 * changed payment, carrying both figures, and the dialog will not save a
 * changed AMOUNT without a reason: a bare correction of somebody else's number
 * is the one this shop cannot reconstruct.
 *
 * Nothing is deleted. A payment somebody removes leaves a REMOVED row behind
 * it, which is the same rule the rest of this database follows.
 */
import { useEffect, useState } from "react";
import {
  Alert,
  Divider,
  Empty,
  Flex,
  Input,
  Modal,
  Timeline,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { PaymentsPanel } from "./PaymentsPanel";
import { fmtRp, fmtDateTime } from "../lib/format.js";
import {
  saleBalance,
  type PaymentLogEntry,
  type SalePayment,
} from "../lib/salePayments.js";
import { SPACE, TYPE } from "../theme/tokens";

export interface PaymentsModalProps {
  readonly open: boolean;
  /** What the sale is called, for the title. */
  readonly code: string;
  readonly total: number;
  readonly payments: readonly SalePayment[];
  /** This sale's log, newest first. */
  readonly log: readonly PaymentLogEntry[];
  /** Codes and labels, as `PaymentsPanel` takes them. */
  readonly methods: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly onClose: () => void;
  readonly onSave: (next: SalePayment[], reason: string) => void;
}

export function PaymentsModal({
  open,
  code,
  total,
  payments,
  log,
  methods,
  onClose,
  onSave,
}: PaymentsModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<SalePayment[]>([]);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(payments.map((p) => ({ ...p })));
    setReason("");
    // Re-seeded on open, not on every change to `payments` — the store is
    // replace-on-write, so a dependency on the array would reset the draft
    // whenever anything else in the shop moved. This project's eslint config
    // has no exhaustive-deps rule to disable, so the reason is stated rather
    // than suppressed.
  }, [open, code]);

  const before = new Map(payments.map((p) => [p.id, p]));
  /**
   * Did an AMOUNT change?
   *
   * Only an amount demands a sentence. Correcting a state (the marketplace
   * paid out, so PENDING becomes SETTLED) or a note is ordinary work, and
   * asking for a reason on every one of those trains people to type "x".
   */
  const amountsMoved = draft.some(
    (p) => (before.get(p.id)?.amount ?? null) !== p.amount,
  );
  const removed = payments.filter((p) => !draft.some((d) => d.id === p.id));
  const needsReason = amountsMoved || removed.length > 0;
  const balance = saleBalance(total, draft);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={880}
      title={t("payEdit.title", "Payments — {{code}}", { code })}
      okText={t("payEdit.save", "Save the correction")}
      okButtonProps={{ disabled: needsReason && reason.trim() === "" }}
      onOk={() => onSave(draft, reason.trim())}
    >
      <Flex vertical gap={SPACE.md}>
        <Typography.Text type="secondary">
          {t("payEdit.bill", "The bill is {{total}}.", {
            total: fmtRp(total),
          })}
        </Typography.Text>

        <PaymentsPanel
          total={total}
          value={draft}
          onChange={setDraft}
          methods={methods}
        />

        {balance.unaccounted > 0 && (
          <Alert
            type="warning"
            showIcon
            message={t(
              "payEdit.unaccounted",
              "{{amount}} of this bill has no payment against it.",
              { amount: fmtRp(balance.unaccounted) },
            )}
            description={t(
              "payEdit.unaccountedHint",
              "That is not the same as a debt somebody promised — add a row saying who owes it and when.",
            )}
          />
        )}

        {needsReason && (
          <Flex vertical gap={SPACE.xs}>
            <Typography.Text>
              {t("payEdit.why", "Why is this being corrected?")}
            </Typography.Text>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label={t("payEdit.whyAria", "Reason for the correction")}
              placeholder={t(
                "payEdit.whyPlaceholder",
                "Typed a zero too many, customer paid the rest in cash…",
              )}
            />
            <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
              {t(
                "payEdit.whyHint",
                "Kept forever beside the old figure. It is what answers a customer disputing this balance next month.",
              )}
            </Typography.Text>
          </Flex>
        )}

        <Divider style={{ margin: 0 }}>
          {t("payEdit.history", "This sale's payment history")}
        </Divider>

        {log.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t(
              "payEdit.noHistory",
              "Nothing has been corrected on this sale.",
            )}
          />
        ) : (
          <Timeline
            items={log.map((e) => ({
              key: e.id,
              color:
                e.action === "REMOVED"
                  ? "red"
                  : e.action === "ADDED"
                    ? "green"
                    : "blue",
              children: (
                <Flex vertical gap={2}>
                  <Typography.Text>
                    {e.action === "ADDED"
                      ? t("payEdit.added", "Added {{amount}}", {
                          amount: fmtRp(e.after?.amount ?? 0),
                        })
                      : e.action === "REMOVED"
                        ? t("payEdit.removed", "Removed {{amount}}", {
                            amount: fmtRp(e.before?.amount ?? 0),
                          })
                        : t("payEdit.amended", "{{from}} → {{to}}", {
                            from: fmtRp(e.before?.amount ?? 0),
                            to: fmtRp(e.after?.amount ?? 0),
                          })}
                  </Typography.Text>
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: TYPE.sm }}
                  >
                    {[fmtDateTime(e.at), e.staff, e.reason]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography.Text>
                </Flex>
              ),
            }))}
          />
        )}
      </Flex>
    </Modal>
  );
}
