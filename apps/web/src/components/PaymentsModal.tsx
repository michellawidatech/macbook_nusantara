/**
 * Correcting what a customer paid.
 *
 * The top is `PaymentsPanel` — the same grid the till records a split on, so a
 * sale reads back the way it was entered. What the customer still owes is
 * derived there rather than typed (owner, 2026-09-23).
 *
 * The change log is still written, and still kept forever: the reason to allow
 * an edit at all is that somebody typed Rp5.000.000 when they meant Rp500.000,
 * and what finds it weeks later is the figure BEFORE the correction. It is
 * folded shut at the foot of the dialog rather than filling half of it, and it
 * no longer demands a sentence before saving.
 */
import { useEffect, useState } from "react";
import { Collapse, Empty, Flex, Modal, Timeline, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { PaymentsPanel } from "./PaymentsPanel";
import { fmtRp, fmtDateTime } from "../lib/format.js";
import type { PaymentLogEntry, SalePayment } from "../lib/salePayments.js";
import { SPACE, TYPE } from "../theme/tokens";

export interface PaymentsModalProps {
  readonly open: boolean;
  /** The sale being corrected — its id files the derived shortfall row. */
  readonly orderId: string;
  /** What the sale is called, for the title. */
  readonly code: string;
  readonly total: number;
  readonly payments: readonly SalePayment[];
  /** This sale's log, newest first. */
  readonly log: readonly PaymentLogEntry[];
  readonly onClose: () => void;
  readonly onSave: (next: SalePayment[]) => void;
}

export function PaymentsModal({
  open,
  orderId,
  code,
  total,
  payments,
  log,
  onClose,
  onSave,
}: PaymentsModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<SalePayment[]>([]);

  useEffect(() => {
    if (!open) return;
    setDraft(payments.map((p) => ({ ...p })));
    // Re-seeded on open, not on every change to `payments` — the store is
    // replace-on-write, so a dependency on the array would reset the draft
    // whenever anything else in the shop moved.
  }, [open, code]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={760}
      title={t("payEdit.title", "Payments — {{code}}", { code })}
      okText={t("payEdit.save", "Save")}
      onOk={() => onSave(draft)}
    >
      <Flex vertical gap={SPACE.md}>
        <PaymentsPanel
          orderId={orderId}
          total={total}
          value={draft}
          onChange={setDraft}
        />

        <Collapse
          ghost
          size="small"
          items={[
            {
              key: "log",
              label: t("payEdit.history", "Change history"),
              children:
                log.length === 0 ? (
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
                ),
            },
          ]}
        />
      </Flex>
    </Modal>
  );
}
