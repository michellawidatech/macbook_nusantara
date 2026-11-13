/**
 * *Waiting for your approval* on Today (owner ask 2026-11-13: *"in Ko Ersen's
 * daily report, all the requests to edit/delete a transaction as well"*).
 *
 * A card of the edit and delete requests still pending, newest first, with a
 * link to Approvals (`/finance/approvals`), where they are decided. It
 * decides nothing itself: approving a change is reading what it changes, and
 * that is the Approvals page's dialog, not a one-line row on a dashboard.
 *
 * Takes its rows as a prop rather than reading them, so Today does not depend
 * on how the requests are fetched — Part B's `usePendingChangeRequests()` is
 * wired in at the call site.
 */
import { Card, Empty, Flex, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { fmtDateTime } from "../../lib/format.js";
import { SPACE, TYPE } from "../../theme/tokens";

export interface TodayApprovalRequest {
  readonly id: string;
  /** CR-… */
  readonly code: string;
  readonly kind: "EDIT" | "DELETE";
  /** What it is about, as the request shows it (a sale's code, an invoice). */
  readonly label: string;
  /** Why, in the requester's words. */
  readonly note: string;
  readonly requestedByName: string;
  /** ISO instant. */
  readonly requestedAt: string;
}

/** How many rows the card lists before it points at Approvals for the rest. */
const SHOWN = 5;

export function TodayApprovalsCard({
  requests,
}: {
  readonly requests: readonly TodayApprovalRequest[];
}) {
  const { t } = useTranslation();
  const newest = [...requests].sort((a, b) =>
    b.requestedAt.localeCompare(a.requestedAt),
  );
  return (
    <Card
      size="small"
      style={{ flex: "1 1 300px", minWidth: 0 }}
      data-testid="today-approvals"
      title={
        <Flex align="center" gap={SPACE.xs}>
          {t("today.approvalsTitle", "Waiting for your approval")}
          {requests.length > 0 && <Tag color="orange">{requests.length}</Tag>}
        </Flex>
      }
      extra={
        <Link to="/finance/approvals">
          {t("today.openApprovals", "Open Approvals")}
        </Link>
      }
    >
      {newest.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("today.noApprovals", "Nothing is waiting for you.")}
        />
      ) : (
        <Flex vertical gap={SPACE.sm}>
          {newest.slice(0, SHOWN).map((r) => (
            <Flex key={r.id} vertical gap={0} data-request={r.code}>
              <Flex align="center" gap={SPACE.xs} wrap>
                <Tag
                  color={r.kind === "DELETE" ? "red" : "blue"}
                  style={{ marginInlineEnd: 0 }}
                >
                  {r.kind === "DELETE"
                    ? t("today.requestDelete", "Delete")
                    : t("today.requestEdit", "Edit")}
                </Tag>
                <Typography.Text strong>{r.label}</Typography.Text>
              </Flex>
              {r.note.trim() !== "" && (
                <Typography.Text style={{ fontSize: TYPE.sm }}>
                  {r.note}
                </Typography.Text>
              )}
              <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
                {t("today.requestedBy", "{{code}} · {{name}} · {{when}}", {
                  code: r.code,
                  name: r.requestedByName,
                  when: fmtDateTime(r.requestedAt),
                })}
              </Typography.Text>
            </Flex>
          ))}
          {newest.length > SHOWN && (
            <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
              {t("today.moreApprovals", "and {{count}} more on Approvals", {
                count: newest.length - SHOWN,
              })}
            </Typography.Text>
          )}
        </Flex>
      )}
    </Card>
  );
}
