/**
 * Financial & Report → Approvals (2026-11-13) — the approver's desk.
 *
 * *"A separate page in Finance … to see all the requests where he can
 * approve or reject; only display ones he needs to do, the rest hidden
 * (separate tab for past approvals)."* So two tabs: **To approve** is what is
 * PENDING and nothing else; **History** is every decided one — approved,
 * rejected, or stale (the record changed after the request, so the change
 * was not applied and the requester asks again).
 *
 * Approve commits the request's changeset on the server as the approver
 * (`packages/db/src/changeRequests.ts`); every till sees the result on its
 * next poll. Reject asks an optional reason. The page is drawn for an
 * account with `canApprove` alone, and the API checks the same on both
 * buttons.
 */
import { useCallback, useEffect, useState } from "react";
import {
  App,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Modal,
  Result,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageContainer } from "../../components/PageContainer";
import { DataTable } from "../../components/DataTable";
import { useCanApprove } from "../../hooks/useCanApprove.js";
import { usePendingChangeRequests } from "../../hooks/useChangeRequests.js";
import {
  approveChangeRequest,
  listChangeRequests,
  rejectChangeRequest,
  type ChangeRequest,
  type ChangeRequestStatus,
} from "../../lib/changeRequestsApi.js";
import { ApiRequestError } from "../../lib/api.js";
import { fmtDateTime, fmtNone } from "../../lib/format.js";
import { COLUMN } from "../../theme/tokens";

type Tab = "pending" | "history";

/** Where the record a request is about can be looked at. */
function linkOf(r: ChangeRequest): string | undefined {
  if (r.target.purchaseOrderId !== null)
    return `/inbound/${r.target.purchaseOrderId}`;
  if (r.target.orderId !== null) return "/finance/transactions";
  if (r.target.expenseId !== null || r.target.manualIncomeId !== null)
    return "/finance/income-expense";
  return undefined;
}

export function ApprovalsPage() {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const canApprove = useCanApprove();
  const pending = usePendingChangeRequests();
  const [tab, setTab] = useState<Tab>("pending");
  const [history, setHistory] = useState<readonly ChangeRequest[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ChangeRequest | null>(null);
  const [reason, setReason] = useState("");

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      setHistory(await listChangeRequests("history"));
    } catch {
      // Keep what is on screen.
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "history") void loadHistory();
  }, [tab, loadHistory]);

  const statusTag = (s: ChangeRequestStatus) =>
    s === "APPROVED" ? (
      <Tag color="green">{t("approvals.stApproved", "Approved")}</Tag>
    ) : s === "REJECTED" ? (
      <Tag color="red">{t("approvals.stRejected", "Rejected")}</Tag>
    ) : s === "STALE" ? (
      <Tag color="orange">{t("approvals.stStale", "Out of date")}</Tag>
    ) : (
      <Tag color="gold">{t("approvals.stPending", "Waiting")}</Tag>
    );

  const failed = (e: unknown) =>
    message.error(
      e instanceof ApiRequestError
        ? e.message
        : t("approvals.failed", "That did not go through. Try again."),
    );

  const approve = (r: ChangeRequest) =>
    modal.confirm({
      title: t("approvals.approveTitle", "Approve {{code}}?", { code: r.code }),
      content: t(
        "approvals.approveBody",
        "{{label}} — the change is made now, as you.",
        { label: r.label },
      ),
      okText: t("approvals.approve", "Approve"),
      onOk: async () => {
        setBusy(r.id);
        try {
          const done = await approveChangeRequest(r.id);
          if (done.status === "STALE")
            message.warning(
              t("approvals.stale", "{{code}} was not applied: {{why}}", {
                code: r.code,
                why: done.decisionNote ?? "",
              }),
            );
          else
            message.success(
              t("approvals.approved", "{{code}} approved.", { code: r.code }),
            );
        } catch (e) {
          failed(e);
        } finally {
          setBusy(null);
          void pending.reload();
          if (tab === "history") void loadHistory();
        }
      },
    });

  const reject = async () => {
    const r = rejecting;
    if (r === null) return;
    setBusy(r.id);
    try {
      await rejectChangeRequest(r.id, reason);
      message.success(
        t("approvals.rejected", "{{code}} rejected.", { code: r.code }),
      );
      setRejecting(null);
      setReason("");
    } catch (e) {
      failed(e);
    } finally {
      setBusy(null);
      void pending.reload();
    }
  };

  if (!canApprove)
    return (
      <PageContainer title={t("approvals.title", "Approvals")}>
        <Result
          status="403"
          title={t("approvals.lockedTitle", "Approvals are for an approver")}
          subTitle={t(
            "approvals.lockedBody",
            "Your requests are decided here by an account that can approve edits.",
          )}
        />
      </PageContainer>
    );

  const columns = (decided: boolean) => [
    {
      title: t("approvals.code", "Request"),
      key: "code",
      width: COLUMN.code,
      render: (_: unknown, r: ChangeRequest) => (
        <Flex vertical gap={2}>
          <Typography.Text strong>{r.code}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {fmtDateTime(r.requestedAt)}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: t("approvals.by", "By"),
      key: "by",
      width: COLUMN.choice,
      render: (_: unknown, r: ChangeRequest) => r.requestedBy.name,
    },
    {
      title: t("approvals.what", "What"),
      key: "what",
      render: (_: unknown, r: ChangeRequest) => {
        const to = linkOf(r);
        return (
          <Flex vertical gap={4} align="flex-start">
            <Flex gap={6} align="center" wrap>
              {r.kind === "DELETE" ? (
                <Tag color="red">{t("changeReq.kindDelete", "Delete")}</Tag>
              ) : (
                <Tag color="blue">{t("changeReq.kindEdit", "Edit")}</Tag>
              )}
              {to === undefined ? (
                <Typography.Text>{r.label}</Typography.Text>
              ) : (
                <Link to={to}>{r.label}</Link>
              )}
            </Flex>
            {r.summary.trim() !== "" && (
              <Typography.Text
                type="secondary"
                style={{ whiteSpace: "pre-wrap", fontSize: 12 }}
              >
                {r.summary}
              </Typography.Text>
            )}
          </Flex>
        );
      },
    },
    {
      title: t("approvals.note", "Why"),
      key: "note",
      render: (_: unknown, r: ChangeRequest) => (
        <Typography.Text style={{ whiteSpace: "pre-wrap" }}>
          {r.note}
        </Typography.Text>
      ),
    },
    decided
      ? {
          title: t("approvals.decision", "Decision"),
          key: "decision",
          width: COLUMN.actionsWide,
          render: (_: unknown, r: ChangeRequest) => (
            <Flex vertical gap={2} align="flex-start">
              {statusTag(r.status)}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {r.decidedBy?.name ?? fmtNone()}
                {r.decidedAt ? ` · ${fmtDateTime(r.decidedAt)}` : ""}
              </Typography.Text>
              {r.decisionNote && (
                <Typography.Text style={{ fontSize: 12 }}>
                  {r.decisionNote}
                </Typography.Text>
              )}
            </Flex>
          ),
        }
      : {
          title: "",
          key: "actions",
          width: COLUMN.actionsWide,
          render: (_: unknown, r: ChangeRequest) => (
            <Flex gap={8} justify="end">
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined aria-hidden />}
                loading={busy === r.id}
                aria-label={t("approvals.approveAria", "Approve {{code}}", {
                  code: r.code,
                })}
                onClick={() => approve(r)}
              >
                {t("approvals.approve", "Approve")}
              </Button>
              <Button
                size="small"
                danger
                icon={<CloseOutlined aria-hidden />}
                disabled={busy === r.id}
                aria-label={t("approvals.rejectAria", "Reject {{code}}", {
                  code: r.code,
                })}
                onClick={() => {
                  setReason("");
                  setRejecting(r);
                }}
              >
                {t("approvals.reject", "Reject")}
              </Button>
            </Flex>
          ),
        },
  ];

  return (
    <PageContainer title={t("approvals.title", "Approvals")}>
      <Card>
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as Tab)}
          items={[
            {
              key: "pending",
              label: t("approvals.toApprove", "To approve ({{count}})", {
                count: pending.count,
              }),
              children: (
                <DataTable<ChangeRequest>
                  rowKey="id"
                  dataSource={pending.requests}
                  columns={columns(false)}
                  locale={{
                    emptyText: t(
                      "approvals.nothingPending",
                      "Nothing waiting for you.",
                    ),
                  }}
                />
              ),
            },
            {
              key: "history",
              label: t("approvals.history", "History"),
              children: (
                <DataTable<ChangeRequest>
                  rowKey="id"
                  loading={loadingHistory}
                  dataSource={history}
                  columns={columns(true)}
                  locale={{
                    emptyText: t(
                      "approvals.noHistory",
                      "No request has been decided yet.",
                    ),
                  }}
                />
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={rejecting !== null}
        title={t("approvals.rejectTitle", "Reject {{code}}?", {
          code: rejecting?.code ?? "",
        })}
        okText={t("approvals.reject", "Reject")}
        okButtonProps={{ danger: true, loading: busy === rejecting?.id }}
        onOk={() => void reject()}
        onCancel={() => setRejecting(null)}
        destroyOnHidden
      >
        <Typography.Paragraph>{rejecting?.label}</Typography.Paragraph>
        <Form layout="vertical">
          <Form.Item
            label={t("approvals.reason", "Reason (optional)")}
            style={{ marginBottom: 0 }}
          >
            <Input.TextArea
              rows={2}
              value={reason}
              maxLength={1000}
              aria-label={t("approvals.reasonAria", "Why it is rejected")}
              onChange={(e) => setReason(e.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
