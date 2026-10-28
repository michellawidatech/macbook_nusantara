/**
 * Approve or reject a reservation REQUEST the bot filed (owner, 2026-10-27).
 * ONE component for both doors — the Requests tab on /reservations and the
 * strip under the conversation header in /chat — so the two cannot disagree
 * about what approving means.
 *
 * Approve: check the units (the ones still on sale; others can be swapped in)
 * and the time, tick *DP received* with its amount, method and date when the
 * customer paid, and choose whether the customer is told. One request to the
 * API books the reservation (a DP makes it a firm hold), links the request,
 * closes the chat's booking task and queues the WhatsApp line, in one
 * transaction. Reject: a reason, and the same choice about telling them.
 *
 * The line the customer gets is shown before it is sent — the same function
 * the server composes it with (`approvalMessage` / `rejectionMessage`,
 * packages/domain).
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import {
  Alert,
  App,
  Button,
  Checkbox,
  DatePicker,
  Flex,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Tag,
  Typography,
} from "antd";
import {
  approvalMessage,
  realName,
  rejectionMessage,
  SHOP_ADDRESS,
} from "@nusantara/domain";

/** The opening hours as the approval line says them (`STORE_HOURS`, packages/agent). */
const SHOP_HOURS = "setiap hari 10.00–20.00 WIB";
import { MoneyInput } from "./MoneyInput";
import { fmtDateTime } from "../lib/format.js";
import { ApiRequestError } from "../lib/api.js";
import { DP_METHODS, dpRule, type DpMethod } from "../lib/dp.js";
import { softHolds } from "../lib/reservations.js";
import {
  approveRequest,
  rejectRequest,
  unitName,
  type RequestRow,
} from "../lib/reservationRequests.js";
import { syncStoreNow, useDb } from "../mock/store.js";

/** The status a row shows: the decision, or what a pending one waits for. */
export function RequestStatusTag({ row }: { readonly row: RequestRow }) {
  const { t } = useTranslation();
  switch (row.status) {
    case "APPROVED":
      return <Tag color="green">{t("requests.approved", "Approved")}</Tag>;
    case "REJECTED":
      return <Tag color="red">{t("requests.rejected", "Rejected")}</Tag>;
    case "EXPIRED":
      return <Tag>{t("requests.expired", "Expired")}</Tag>;
    case "REPLACED":
      return <Tag>{t("requests.replaced", "Replaced")}</Tag>;
    default:
      break;
  }
  return (
    <Flex gap={4} wrap>
      <Tag color="gold">{t("requests.pending", "Pending")}</Tag>
      {row.waiting === "DP_PROOF" ? (
        <Tag color="blue">{t("requests.dpProofSent", "DP proof sent")}</Tag>
      ) : row.waiting === "WAITING_DP" ? (
        <Tag>{t("requests.waitingForDp", "Waiting for DP")}</Tag>
      ) : (
        <Tag>{t("requests.visitOnly", "Visit only")}</Tag>
      )}
    </Flex>
  );
}

const errorText = (e: unknown, fallback: string): string =>
  e instanceof ApiRequestError ? e.message : fallback;

interface ApproveForm {
  serials: string[];
  when: dayjs.Dayjs;
  dpReceived: boolean;
  dpAmount: number;
  dpMethod: DpMethod;
  dpDay: dayjs.Dayjs;
  tell: boolean;
}

export function ApproveRequestModal({
  row,
  onClose,
}: {
  /** The request to approve; null keeps the dialog shut. */
  readonly row: RequestRow | null;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const db = useDb();
  const rule = dpRule(db.settings);
  const [form] = Form.useForm<ApproveForm>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!row) return;
    form.setFieldsValue({
      // Only what is still on sale; a unit sold since is named below.
      serials: row.units
        .filter((u) => u.status === "TERSEDIA")
        .map((u) => u.serial),
      when: dayjs(row.request.when),
      dpReceived: row.waiting === "DP_PROOF",
      dpAmount: rule.amount,
      dpMethod: "TRANSFER",
      dpDay: dayjs(),
      tell: true,
    });
  }, [row?.request.id]);

  const gone = row?.units.filter((u) => u.status !== "TERSEDIA") ?? [];

  // On sale, and not already reserved for somebody else — the units the
  // request names are offered whatever, so the person sees what was asked.
  const options = useMemo(() => {
    const reserved = softHolds(db);
    const own = new Set(row?.units.map((u) => u.serial) ?? []);
    return db.units
      .filter(
        (u) =>
          u.status === "TERSEDIA" &&
          (own.has(u.serial) || !reserved.has(u.serial)),
      )
      .map((u) => {
        const named = unitName(db, u.serial);
        return {
          value: u.serial,
          label: `${named.name}${named.grade ? ` · ${named.grade}` : ""} — ${u.serial}`,
        };
      });
  }, [db, row?.request.id]);

  const serials = Form.useWatch("serials", form) ?? [];
  const when = Form.useWatch("when", form);
  const dpReceived = Form.useWatch("dpReceived", form) ?? false;
  const tell = Form.useWatch("tell", form) ?? true;
  const withDp = dpReceived && serials.length > 0;

  // What the customer will read (owner's template, 2026-10-28). The
  // address goes only when the chat does not have it yet — the server
  // decides, so the preview shows it and says so.
  const preview = when
    ? approvalMessage({
        unit:
          serials.map((s: string) => unitName(db, s).name).join(", ") || null,
        when: when.toDate(),
        name: realName(row?.request.custName),
        place: { address: SHOP_ADDRESS, hours: SHOP_HOURS },
      })
    : "";

  const save = async (v: ApproveForm) => {
    if (!row) return;
    setSaving(true);
    try {
      const now = dayjs();
      const out = await approveRequest(row.request.id, {
        serials: v.serials,
        scheduledFor: v.when.toISOString(),
        dp: withDp
          ? {
              amount: String(Math.round(v.dpAmount)),
              method: v.dpMethod,
              // The day picked, at the clock time it was recorded.
              paidAt: v.dpDay
                .hour(now.hour())
                .minute(now.minute())
                .second(now.second())
                .toISOString(),
            }
          : null,
        tell: v.tell,
      });
      await syncStoreNow();
      message.success(
        t("requests.approvedToast", "Booked as {{code}}.", {
          code: out.reservation.code,
        }),
      );
      if (out.windowClosed)
        message.warning(
          t(
            "requests.windowClosed",
            "The 24-hour WhatsApp window is closed, so nothing was sent — tell the customer another way.",
          ),
        );
      onClose();
    } catch (e) {
      message.error(
        errorText(e, t("requests.approveFailed", "Could not approve it.")),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={row !== null}
      title={t("requests.approveTitle", "Approve reservation — {{name}}", {
        name: row?.request.custName ?? "",
      })}
      okText={t("requests.approve", "Approve")}
      onOk={() => form.submit()}
      okButtonProps={{ loading: saving }}
      onCancel={onClose}
      destroyOnHidden
      width={560}
    >
      {gone.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={t(
            "requests.unitsGone",
            "No longer on sale: {{units}}. Pick another unit or approve it as a visit.",
            { units: gone.map((u) => `${u.name} (${u.serial})`).join(", ") },
          )}
        />
      )}
      <Form<ApproveForm>
        form={form}
        layout="vertical"
        onFinish={(v) => void save(v)}
      >
        <Form.Item
          name="serials"
          label={t("requests.units", "Unit(s)")}
          extra={t(
            "requests.unitsExtra",
            "Leave it empty to book a visit with no unit.",
          )}
        >
          <Select
            mode="multiple"
            allowClear
            showSearch
            optionFilterProp="label"
            options={options}
            aria-label={t("requests.units", "Unit(s)")}
          />
        </Form.Item>
        <Form.Item
          name="when"
          label={t("requests.time", "Time")}
          rules={[
            {
              required: true,
              message: t("requests.pickTime", "Pick the day and time."),
            },
          ]}
        >
          <DatePicker
            showTime={{ format: "HH:mm" }}
            format="DD MMM YYYY HH:mm"
            style={{ width: "100%" }}
          />
        </Form.Item>
        <Form.Item name="dpReceived" valuePropName="checked">
          <Checkbox disabled={serials.length === 0}>
            {t("requests.dpReceived", "DP received")}
          </Checkbox>
        </Form.Item>
        {withDp && (
          <Flex gap={12} wrap>
            <Form.Item
              name="dpAmount"
              label={t("dp.amount", "DP amount")}
              style={{ flex: "1 1 160px" }}
              rules={[
                {
                  required: true,
                  type: "number",
                  min: 1,
                  message: t("dp.amountNeeded", "Type the DP amount."),
                },
              ]}
            >
              <MoneyInput min={1} />
            </Form.Item>
            <Form.Item
              name="dpMethod"
              label={t("dp.method", "Paid by")}
              style={{ flex: "0 0 auto" }}
            >
              <Segmented<DpMethod>
                options={DP_METHODS.map((m) => ({
                  value: m,
                  label:
                    m === "TRANSFER"
                      ? t("pos.methodTransfer", "Transfer")
                      : t("pos.methodCash", "Cash"),
                }))}
              />
            </Form.Item>
            <Form.Item
              name="dpDay"
              label={t("dp.date", "DP date")}
              style={{ flex: "1 1 160px" }}
              rules={[
                {
                  required: true,
                  message: t("dp.pickDate", "Pick the DP's date."),
                },
              ]}
            >
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
          </Flex>
        )}
        <Form.Item
          name="tell"
          valuePropName="checked"
          style={{ marginBottom: 4 }}
        >
          <Checkbox>{t("requests.tellCustomer", "Tell the customer")}</Checkbox>
        </Form.Item>
        {tell && preview && (
          <Typography.Paragraph
            type="secondary"
            data-testid="request-preview"
            style={{ whiteSpace: "pre-line", marginBottom: 0 }}
          >
            {preview}
          </Typography.Paragraph>
        )}
        {tell && preview && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t(
              "requests.placeNote",
              "The address is left out if the chat already has it.",
            )}
          </Typography.Text>
        )}
      </Form>
    </Modal>
  );
}

interface RejectForm {
  reason: string;
  tell: boolean;
}

export function RejectRequestModal({
  row,
  onClose,
}: {
  readonly row: RequestRow | null;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<RejectForm>();
  const [saving, setSaving] = useState(false);
  const reason = Form.useWatch("reason", form) ?? "";
  const tell = Form.useWatch("tell", form) ?? true;

  useEffect(() => {
    if (row) form.setFieldsValue({ reason: "", tell: true });
  }, [row?.request.id]);

  const save = async (v: RejectForm) => {
    if (!row) return;
    setSaving(true);
    try {
      const out = await rejectRequest(row.request.id, {
        reason: v.reason.trim(),
        tell: v.tell,
      });
      await syncStoreNow();
      message.success(t("requests.rejectedToast", "Request rejected."));
      if (out.windowClosed)
        message.warning(
          t(
            "requests.windowClosed",
            "The 24-hour WhatsApp window is closed, so nothing was sent — tell the customer another way.",
          ),
        );
      onClose();
    } catch (e) {
      message.error(
        errorText(e, t("requests.rejectFailed", "Could not reject it.")),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={row !== null}
      title={t("requests.rejectTitle", "Reject reservation — {{name}}", {
        name: row?.request.custName ?? "",
      })}
      okText={t("requests.reject", "Reject")}
      okButtonProps={{ danger: true, loading: saving }}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnHidden
      width={480}
    >
      <Form<RejectForm>
        form={form}
        layout="vertical"
        onFinish={(v) => void save(v)}
      >
        <Form.Item
          name="reason"
          label={t("requests.reason", "Reason")}
          rules={[
            {
              required: true,
              whitespace: true,
              message: t("requests.reasonNeeded", "Say why, in a few words."),
            },
          ]}
        >
          <Input.TextArea rows={2} maxLength={280} showCount />
        </Form.Item>
        <Form.Item
          name="tell"
          valuePropName="checked"
          style={{ marginBottom: 4 }}
        >
          <Checkbox>{t("requests.tellCustomer", "Tell the customer")}</Checkbox>
        </Form.Item>
        {tell && (
          <Typography.Paragraph
            type="secondary"
            data-testid="request-preview"
            style={{ marginBottom: 0 }}
          >
            {rejectionMessage(reason)}
          </Typography.Paragraph>
        )}
      </Form>
    </Modal>
  );
}

/**
 * The strip under the conversation header in /chat: the thread's waiting
 * request — units, time, status — and the same two buttons.
 */
export function RequestStrip({
  row,
  onApprove,
  onReject,
}: {
  readonly row: RequestRow;
  readonly onApprove: () => void;
  readonly onReject: () => void;
}) {
  const { t } = useTranslation();
  const units = row.units.map((u) => u.name).join(", ");
  return (
    <Alert
      type="info"
      data-testid="request-strip"
      message={
        <Flex align="center" gap={8} wrap>
          <Typography.Text strong>
            {t("requests.stripTitle", "Reservation request")}
          </Typography.Text>
          <Typography.Text>
            {units || t("requests.visitOnly", "Visit only")} ·{" "}
            {fmtDateTime(row.request.when)}
          </Typography.Text>
          <RequestStatusTag row={row} />
        </Flex>
      }
      action={
        <Flex gap={8}>
          <Button size="small" type="primary" onClick={onApprove}>
            {t("requests.approve", "Approve")}
          </Button>
          <Button size="small" danger onClick={onReject}>
            {t("requests.reject", "Reject")}
          </Button>
        </Flex>
      }
    />
  );
}
