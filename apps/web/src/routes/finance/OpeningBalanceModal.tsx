/**
 * The opening balance — what was in the drawer and the bank on the day the
 * shop started counting here (owner ask 2026-10-21: "we should be able to set
 * the initial bank balance for the income and expense").
 *
 * `AppSettings.openingCash` / `openingBank` / `openingBalanceAt` (in
 * `AppSetting` as `finance.opening*`). The balance on Income & Expense starts
 * from these and moves only with what was settled AFTER the date, because the
 * figure typed here already contains everything before it.
 */
import { useEffect } from "react";
import { App, DatePicker, Form, Modal } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useTranslation } from "react-i18next";
import { MoneyInput } from "../../components/MoneyInput";
import { mutate, useDb } from "../../mock/store.js";

interface Values {
  cash?: number;
  bank?: number;
  at: Dayjs;
}

export function OpeningBalanceModal({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const db = useDb();
  const [form] = Form.useForm<Values>();

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      cash: db.settings.openingCash ?? undefined,
      bank: db.settings.openingBank ?? undefined,
      at: db.settings.openingBalanceAt
        ? dayjs(db.settings.openingBalanceAt)
        : dayjs().startOf("day"),
    });
  }, [open, form, db.settings]);

  const save = () =>
    form.validateFields().then((v) => {
      mutate((d) => {
        d.settings.openingCash = v.cash ?? 0;
        d.settings.openingBank = v.bank ?? 0;
        d.settings.openingBalanceAt = v.at.startOf("day").toISOString();
      });
      message.success(t("opening.saved", "Opening balance saved."));
      onClose();
    });

  return (
    <Modal
      open={open}
      title={t("opening.title", "Opening balance")}
      onCancel={onClose}
      onOk={save}
      okText={t("common.save", "Save")}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item name="bank" label={t("opening.bank", "Bank balance")}>
          <MoneyInput />
        </Form.Item>
        <Form.Item name="cash" label={t("opening.cash", "Cash in the drawer")}>
          <MoneyInput />
        </Form.Item>
        <Form.Item
          name="at"
          label={t("opening.at", "As of")}
          rules={[{ required: true }]}
          extra={t(
            "opening.atHint",
            "Money settled before this day is already inside these figures and does not move the balance again.",
          )}
        >
          <DatePicker format="DD/MM/YYYY" allowClear={false} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
