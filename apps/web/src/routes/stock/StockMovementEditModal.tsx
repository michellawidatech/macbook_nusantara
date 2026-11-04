/**
 * Correcting one row of the Stock Movement History (owner ask 2026-09-24:
 * *"make the movement log editable … each row is editable"*).
 *
 * The top of the dialog restates what the row IS and cannot become — the
 * direction, the unit or the counted product and its quantity, whose hand —
 * and the form below it holds what a correction may change: when, why, the
 * sentence. The battery reading left the form on 2026-11-03 (owner list) —
 * `applyStockHistoryEdit` still takes one. The rule, and what the unit does with the correction, is
 * `lib/stockHistory.ts`.
 *
 * A wrong quantity on a counted row is not corrected here, and the dialog
 * says so: the pieces are on the stock ledger, and the ledger takes another
 * adjustment rather than a rewrite.
 */
import { useOpenedWith } from "../../hooks/useUnchanged";
import { useEffect, useState } from "react";
import {
  App,
  Alert,
  AutoComplete,
  DatePicker,
  Descriptions,
  Flex,
  Form,
  Input,
  Modal,
  Tag,
  Typography,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";
import { fmtNone } from "../../lib/format.js";
import {
  applyStockHistoryEdit,
  stockHistorySkuId,
  type StockHistoryRow,
} from "../../lib/stockHistory.js";
import { ensureReason, mutate, reasonLabel, useDb } from "../../mock/store.js";
import { FORM_CENTRE, SPACE } from "../../theme/tokens";

export interface StockMovementEditModalProps {
  readonly open: boolean;
  readonly row: StockHistoryRow | null;
  readonly onClose: () => void;
}

export function StockMovementEditModal({
  open,
  row,
  onClose,
}: StockMovementEditModalProps) {
  const { t } = useTranslation();
  const db = useDb();
  const { message } = App.useApp();

  const [day, setDay] = useState<Dayjs>(dayjs());
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open || row === null) return;
    setDay(dayjs(row.at));
    setReason(reasonLabel(db, row.reasonId));
    setDescription(row.description);
  }, [open, row?.id]);
  /** Grey until something changes (2026-11-04). */
  const unchanged = useOpenedWith(
    { day: day.valueOf(), reason, description },
    open ? (row?.id ?? null) : null,
  );

  const skuId = row === null ? undefined : stockHistorySkuId(db, row);
  const sku =
    skuId === undefined ? undefined : db.skus.find((s) => s.id === skuId);
  const product = sku ? `${sku.name} ${sku.variantLabel}` : fmtNone();
  const counted = row?.counted;
  const adjustmentReasons = db.reasons.filter(
    (r) => r.activity === "ADJUSTMENT" && r.active,
  );

  const save = () => {
    if (row === null) return;
    const typed = reason.trim();
    if (typed === "") {
      message.error(
        t("stockHistoryEdit.reasonRequired", "A movement needs a reason."),
      );
      return;
    }
    let applied = false;
    mutate((d) => {
      const reasonId = ensureReason(d, "ADJUSTMENT", typed);
      applied = applyStockHistoryEdit(d, row, {
        at: day.toISOString(),
        reasonId,
        description,
      });
    });
    if (!applied) {
      message.error(
        t(
          "stockHistoryEdit.gone",
          "This movement is no longer in the history.",
        ),
      );
      onClose();
      return;
    }
    message.success(t("stockHistoryEdit.saved", "Stock movement updated."));
    onClose();
  };

  const kindTag =
    row === null ? null : (
      <Tag color={row.kind === "IN" ? "green" : "volcano"}>
        {row.kind === "IN" ? t("stock.in", "In") : t("stock.out", "Out")}
      </Tag>
    );

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={600}
      title={t("stockHistoryEdit.title", "Edit stock movement")}
      okText={t("stockHistoryEdit.save", "Save")}
      okButtonProps={{ disabled: unchanged }}
      onOk={save}
      destroyOnHidden
    >
      <Flex vertical gap={SPACE.md} style={FORM_CENTRE}>
        <Descriptions
          size="small"
          column={2}
          items={[
            {
              key: "type",
              label: t("stockHistoryEdit.type", "Type"),
              children: kindTag,
            },
            {
              key: "by",
              label: t("stockHistoryEdit.by", "By"),
              children: row?.staff ?? fmtNone(),
            },
            {
              key: "product",
              label: t("stockHistoryEdit.product", "Product"),
              children: product,
              span: counted === undefined ? 1 : 2,
            },
            ...(counted === undefined
              ? [
                  {
                    key: "serial",
                    label: t("stockHistoryEdit.serial", "Serial"),
                    children: row?.serial ?? fmtNone(),
                  },
                ]
              : [
                  {
                    key: "qty",
                    label: t("stockHistoryEdit.qty", "Quantity"),
                    children: <Typography.Text>×{counted.qty}</Typography.Text>,
                  },
                ]),
          ]}
        />

        {counted !== undefined && (
          <Alert
            type="info"
            showIcon
            title={t(
              "stockHistoryEdit.qtyFixed",
              "The quantity is on the stock ledger and cannot be changed here. Record another adjustment to correct it.",
            )}
          />
        )}

        <Form layout="vertical">
          <Flex gap={SPACE.md} wrap>
            <Form.Item
              label={t("stockHistoryEdit.when", "When")}
              required
              style={{ flex: "1 1 200px" }}
            >
              <DatePicker
                value={day}
                onChange={(v) => v && setDay(v)}
                allowClear={false}
                showTime
                format="DD MMM YYYY HH:mm"
                style={{ width: "100%" }}
                aria-label={t("stockHistoryEdit.when", "When")}
              />
            </Form.Item>
            <Form.Item
              label={t("stockHistoryEdit.reason", "Reason")}
              required
              style={{ flex: "1 1 220px" }}
            >
              <AutoComplete
                id="stock-history-reason"
                value={reason}
                onChange={(v: string) => setReason(v)}
                options={adjustmentReasons.map((r) => ({ value: r.label }))}
                filterOption={(input, option) =>
                  String(option?.value ?? "")
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
                placeholder={t(
                  "stock.searchAReasonOrType",
                  "Search a reason, or type a new one",
                )}
                aria-label={t("stockHistoryEdit.reason", "Reason")}
              />
            </Form.Item>
          </Flex>

          <Form.Item label={t("stockHistoryEdit.description", "Description")}>
            <Input.TextArea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-label={t("stockHistoryEdit.description", "Description")}
            />
          </Form.Item>
        </Form>
      </Flex>
    </Modal>
  );
}
