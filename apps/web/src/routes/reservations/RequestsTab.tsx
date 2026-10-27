/**
 * The Requests tab on /reservations (owner, 2026-10-27): *"we can see the list
 * of who wants to reserve, the unit, the time, and the pending status which
 * they can then approve."*
 *
 * Customer · Unit(s) · Time · Status · actions (Open chat, Approve, Reject).
 * The oldest pending request first — it has waited longest — then the ones
 * dealt with, and the lapsed at the bottom, dimmed. Read off the store
 * (`db.reservationRequests`), so a request the bot files appears without a
 * reload; the decisions are `components/ReservationRequestDialogs`, the same
 * dialogs /chat opens.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button, Flex, Typography } from "antd";
import { MessageOutlined } from "@ant-design/icons";
import { ProTable } from "../../components/ProTable";
import { GradeTag } from "../../components/GradeTag";
import {
  ApproveRequestModal,
  RejectRequestModal,
  RequestStatusTag,
} from "../../components/ReservationRequestDialogs";
import { fmtDateTime } from "../../lib/format.js";
import { requestRows, type RequestRow } from "../../lib/reservationRequests.js";
import { useDb } from "../../mock/store.js";
import { COLUMN } from "../../theme/tokens";

export function RequestsTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const db = useDb();
  const rows = useMemo(() => requestRows(db, new Date()), [db]);
  const [approving, setApproving] = useState<RequestRow | null>(null);
  const [rejecting, setRejecting] = useState<RequestRow | null>(null);

  return (
    <>
      <ProTable<RequestRow>
        persistKey="reservationRequests"
        rowKey={(r) => r.request.id}
        dataSource={rows}
        rowClassName={(r) =>
          r.status === "EXPIRED" ? "request-row-expired" : ""
        }
        searchPlaceholder={t(
          "requests.search",
          "Search customer, phone or serial",
        )}
        columns={[
          {
            title: t("reservations.customer", "Customer"),
            key: "customer",
            width: COLUMN.code,
            searchable: true,
            searchValue: (r) => `${r.request.custName} ${r.request.phone}`,
            render: (_, r) => (
              <Flex vertical>
                <strong>{r.request.custName}</strong>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  +{r.request.phone}
                </Typography.Text>
              </Flex>
            ),
          },
          {
            title: t("requests.units", "Unit(s)"),
            key: "units",
            searchable: true,
            searchValue: (r) =>
              r.units.map((u) => `${u.name} ${u.serial}`).join(" "),
            render: (_, r) =>
              r.units.length === 0 ? (
                <Typography.Text type="secondary">
                  {t("requests.visitOnly", "Visit only")}
                </Typography.Text>
              ) : (
                <Flex vertical gap={2}>
                  {r.units.map((u) => (
                    <Flex key={u.serial} gap={6} align="center" wrap>
                      <GradeTag grade={u.grade} plain />
                      <span>{u.name}</span>
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12 }}
                      >
                        {u.serial}
                      </Typography.Text>
                    </Flex>
                  ))}
                </Flex>
              ),
          },
          {
            title: t("requests.time", "Time"),
            key: "when",
            width: COLUMN.date,
            render: (_, r) => fmtDateTime(r.request.when),
          },
          {
            title: t("requests.status", "Status"),
            key: "status",
            width: COLUMN.status,
            render: (_, r) => <RequestStatusTag row={r} />,
          },
          {
            title: "",
            key: "actions",
            width: 300,
            render: (_, r) => (
              <Flex gap={8} wrap>
                <Button
                  size="small"
                  icon={<MessageOutlined />}
                  onClick={() =>
                    navigate("/chat", { state: { openPhone: r.request.phone } })
                  }
                >
                  {t("requests.openChat", "Open chat")}
                </Button>
                {r.status === "PENDING" && (
                  <>
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => setApproving(r)}
                    >
                      {t("requests.approve", "Approve")}
                    </Button>
                    <Button size="small" danger onClick={() => setRejecting(r)}>
                      {t("requests.reject", "Reject")}
                    </Button>
                  </>
                )}
              </Flex>
            ),
          },
        ]}
      />
      <ApproveRequestModal row={approving} onClose={() => setApproving(null)} />
      <RejectRequestModal row={rejecting} onClose={() => setRejecting(null)} />
    </>
  );
}
