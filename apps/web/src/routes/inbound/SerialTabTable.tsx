/**
 * The two Inbound tabs that list serials rather than invoices (owner,
 * 2026-11-04): *Back from service* — a unit re-QC'd after a repair, with the
 * visit's note and charges and a *+ Charge* for the bill that arrives late —
 * and *Ready to accept*, every unit whose QC is complete, with Accept and
 * *Accept all*. Rows come from `lib/inboundTabs.ts`.
 */
import { App, Button, Flex, Typography } from "antd";
import { CheckOutlined, PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { ProTable } from "../../components/ProTable";
import { SerialLink } from "../../components/SerialLink";
import { GradeTag } from "../../components/GradeTag";
import { fmtNone, fmtRp } from "../../lib/format.js";
import type { SerialTabRow } from "../../lib/inboundTabs.js";
import { appendEvent, mutate } from "../../mock/store.js";
import { COLUMN } from "../../theme/tokens";

export function SerialTabTable({
  kind,
  rows,
  onQc,
  onCharge,
}: {
  readonly kind: "BACK" | "READY";
  readonly rows: readonly SerialTabRow[];
  /** Open the unit's QC popup. Absent for a unit on no invoice. */
  readonly onQc: (row: SerialTabRow) => void;
  readonly onCharge?: (row: SerialTabRow) => void;
}) {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();

  /** QC passed, for these serials, in one write. */
  const accept = (list: readonly SerialTabRow[]) =>
    mutate((d) => {
      for (const r of list)
        appendEvent(d, r.serial, {
          type: "QC_SELESAI",
          toStatus: "TERSEDIA",
          ...(r.poCode ? { refCode: r.poCode } : {}),
          note: "QC passed",
        });
    }).then(() =>
      message.success(
        t("inbound.acceptAllDone", "{{count}} unit(s) accepted into stock.", {
          count: list.length,
        }),
      ),
    );

  const acceptAll = () =>
    modal.confirm({
      title: t("inbound.acceptAllTitle", "Accept {{count}} unit(s)?", {
        count: rows.length,
      }),
      okText: t("inbound.acceptAllOk", "Accept them"),
      cancelText: t("inbound.cancel", "Cancel"),
      onOk: () => accept(rows),
    });

  return (
    <ProTable<SerialTabRow>
      lazy
      persistKey={kind === "BACK" ? "inbound.backFromService" : "inbound.ready"}
      rowKey="serial"
      dataSource={[...rows]}
      searchPlaceholder={t(
        "inbound.tab.searchSerial",
        "Search serial, product or invoice",
      )}
      extra={
        kind === "READY" && rows.length > 0 ? (
          <Button type="primary" icon={<CheckOutlined />} onClick={acceptAll}>
            {t("inbound.acceptAll", "Accept all ({{count}})", {
              count: rows.length,
            })}
          </Button>
        ) : undefined
      }
      columns={[
        {
          title: t("inbound.tab.serial", "Serial"),
          dataIndex: "serial",
          searchable: true,
          width: COLUMN.serial,
          render: (v: string) => <SerialLink serial={v} />,
        },
        {
          title: t("inbound.tab.product", "Product"),
          dataIndex: "product",
          searchable: true,
          render: (v: string) => v || fmtNone(),
        },
        {
          title: t("inbound.tab.invoice", "Invoice"),
          dataIndex: "poCode",
          searchable: true,
          width: COLUMN.code,
          render: (v?: string) => v ?? fmtNone(),
        },
        ...(kind === "BACK"
          ? [
              {
                title: t("inbound.tab.serviceNote", "Service"),
                key: "note",
                render: (_: unknown, r: SerialTabRow) =>
                  r.visit?.note || fmtNone(),
              },
              {
                title: t("inbound.tab.charges", "Charges"),
                key: "charges",
                align: "right" as const,
                width: COLUMN.money,
                render: (_: unknown, r: SerialTabRow) =>
                  fmtRp(r.visit?.charges ?? 0),
              },
            ]
          : [
              {
                title: t("inbound.tab.grade", "Grade"),
                dataIndex: "grade",
                width: COLUMN.grade,
                render: (_: unknown, r: SerialTabRow) =>
                  r.grade ? <GradeTag grade={r.grade} /> : fmtNone(),
              },
              {
                title: t("inbound.tab.battery", "Battery"),
                dataIndex: "battery",
                width: COLUMN.tag,
              },
              {
                title: t("inbound.tab.sellPrice", "Sell price"),
                dataIndex: "sellPrice",
                align: "right" as const,
                width: COLUMN.money,
                render: (v?: number) => fmtRp(v ?? 0),
              },
            ]),
        {
          title: "",
          key: "actions",
          align: "right",
          width: COLUMN.actionsWide,
          render: (_: unknown, r: SerialTabRow) => (
            <Flex gap={4} justify="end">
              {r.poId ? (
                <Button
                  size="small"
                  aria-label={t("inbound.tab.qcAria", "QC {{serial}}", {
                    serial: r.serial,
                  })}
                  onClick={() => onQc(r)}
                >
                  {t("inbound.tab.qc", "QC")}
                </Button>
              ) : (
                <Typography.Text type="secondary">
                  {t("inbound.tab.qcBelow", "QC below")}
                </Typography.Text>
              )}
              {kind === "BACK" && onCharge && (
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  aria-label={t(
                    "service.addFeeAria",
                    "Add a charge to {{serial}}",
                    { serial: r.serial },
                  )}
                  onClick={() => onCharge(r)}
                >
                  {t("service.charge", "Charge")}
                </Button>
              )}
              {kind === "READY" && (
                <Button
                  size="small"
                  type="primary"
                  aria-label={t("inbound.tab.acceptAria", "Accept {{serial}}", {
                    serial: r.serial,
                  })}
                  onClick={() => void accept([r])}
                >
                  {t("inbound.accept", "Accept")}
                </Button>
              )}
            </Flex>
          ),
        },
      ]}
    />
  );
}
