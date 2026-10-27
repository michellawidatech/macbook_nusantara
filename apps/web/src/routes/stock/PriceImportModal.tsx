/**
 * Import sell prices — the dialog in front of `lib/priceImport.ts` (owner ask
 * 2026-10-21). Pick the price list (Export stock with a price column, e.g.
 * "Harga IG"), read what it would do, then press the one button that does it.
 * Nothing is written before that press.
 */
import { useState } from "react";
import {
  Alert,
  App,
  Button,
  Flex,
  Modal,
  Switch,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { appendEvent, mutate, useDb } from "../../mock/store.js";
import { readXlsx } from "../../lib/xlsxRead.js";
import {
  planPriceImport,
  readPriceSheet,
  type PlannedRow,
  type PriceRow,
  type PriceRowStatus,
} from "../../lib/priceImport.js";
import { priceOf } from "../../lib/unitPrice.js";
import { fmtNone, fmtRp } from "../../lib/format.js";
import { COLUMN } from "../../theme/tokens";

export interface PriceImportModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function PriceImportModal({ open, onClose }: PriceImportModalProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const db = useDb();
  const [file, setFile] = useState<string | null>(null);
  const [sheet, setSheet] = useState<PriceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problemsOnly, setProblemsOnly] = useState(false);

  // Planned against the store as it is NOW, so a sale made while the dialog
  // is open is not repriced from a stale plan.
  const plan = sheet ? planPriceImport(db, sheet) : null;

  const reset = () => {
    setFile(null);
    setSheet(null);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const read = async (f: File) => {
    reset();
    setFile(f.name);
    try {
      const sheets = await readXlsx(new Uint8Array(await f.arrayBuffer()));
      for (const s of sheets) {
        const r = readPriceSheet(s.rows);
        if (!("error" in r) && r.rows.length > 0) {
          setSheet(r.rows);
          return;
        }
      }
      setError(
        t(
          "priceImport.noPrices",
          'No price column found. Use Export stock and add a price column (e.g. "Harga IG") beside Unit and Gudang.',
        ),
      );
    } catch {
      setError(
        t("priceImport.unreadable", "This file could not be read as .xlsx."),
      );
    }
  };

  const statusTag = (s: PriceRowStatus) => {
    switch (s) {
      case "OK":
        return <Tag color="green">{t("priceImport.ok", "Will update")}</Tag>;
      case "UNCHANGED":
        return <Tag>{t("priceImport.unchanged", "Already this price")}</Tag>;
      case "ONLY_QC":
        return (
          <Tag color="blue">
            {t("priceImport.onlyQc", "Still in QC — left")}
          </Tag>
        );
      case "NO_STOCK":
        return <Tag>{t("priceImport.noStock", "None in stock here")}</Tag>;
      case "NO_PRODUCT":
        return (
          <Tag color="orange">
            {t("priceImport.noProduct", "Product not found")}
          </Tag>
        );
      case "NO_WAREHOUSE":
        return (
          <Tag color="orange">
            {t("priceImport.noWarehouse", "Warehouse not found")}
          </Tag>
        );
      case "CONFLICT":
        return (
          <Tag color="red">
            {t("priceImport.conflict", "Two prices for the same units")}
          </Tag>
        );
    }
  };

  const apply = () => {
    if (!plan || plan.edits.length === 0) return;
    const source = file ?? "price list";
    mutate((d) => {
      for (const e of plan.edits) {
        const u = d.units.find((x) => x.serial === e.serial);
        // Re-checked inside the write: a unit sold or sent back to QC since
        // the preview is left alone.
        if (!u || !["TERSEDIA", "DIRESERVASI", "SERVIS"].includes(u.status)) {
          continue;
        }
        const sku = d.skus.find((s) => s.id === u.skuId);
        const before = priceOf(u, sku?.price ?? 0);
        const handTyped = u.marketPrice;
        u.price = e.price;
        if (handTyped !== undefined) u.marketPrice = undefined;
        appendEvent(d, e.serial, {
          type: "DICATAT",
          note: [
            `Price ${fmtRp(before)} → ${fmtRp(e.price)} (${source})`,
            handTyped === undefined
              ? undefined
              : `Marketplace price ${fmtRp(handTyped)} set by hand dropped — the variant's listing follows the rule`,
          ]
            .filter(Boolean)
            .join(" · "),
        });
      }
    });
    message.success(
      t("priceImport.done", "{{n}} units repriced.", { n: plan.edits.length }),
    );
    close();
  };

  const qcLeft = plan?.rows.reduce((n, r) => n + r.inQc, 0) ?? 0;
  const moved =
    plan?.rows.filter((r) => r.qty !== undefined && r.qty !== r.heldNow)
      .length ?? 0;
  const problems =
    plan?.rows.filter((r) => !["OK", "UNCHANGED"].includes(r.status)) ?? [];
  const shown = plan ? (problemsOnly ? problems : plan.rows) : [];

  return (
    <Modal
      open={open}
      title={t("priceImport.title", "Import sell prices")}
      width={1100}
      onCancel={close}
      onOk={apply}
      okText={t("priceImport.apply", "Update {{n}} units", {
        n: plan?.edits.length ?? 0,
      })}
      okButtonProps={{ disabled: !plan || plan.edits.length === 0 }}
      destroyOnHidden
    >
      <Flex vertical gap={12}>
        <Upload
          accept=".xlsx"
          maxCount={1}
          showUploadList={false}
          beforeUpload={(f) => {
            void read(f);
            return false;
          }}
        >
          <Button icon={<UploadOutlined />}>
            {file ?? t("priceImport.pick", "Choose the price list (.xlsx)")}
          </Button>
        </Upload>

        {error && <Alert type="error" showIcon message={error} />}

        {plan && (
          <>
            <Alert
              type={plan.edits.length > 0 ? "info" : "warning"}
              showIcon
              message={t(
                "priceImport.summary",
                "{{n}} units will get a new sell price, from {{rows}} rows of the list.",
                {
                  n: plan.edits.length,
                  rows: plan.rows.filter((r) => r.status === "OK").length,
                },
              )}
              description={
                <>
                  {qcLeft > 0 && (
                    <div>
                      {t(
                        "priceImport.qcLeft",
                        "{{n}} units still in QC are left alone — their price is set on their inbound invoice.",
                        { n: qcLeft },
                      )}
                    </div>
                  )}
                  {moved > 0 && (
                    <div>
                      {t(
                        "priceImport.moved",
                        "{{n}} rows hold a different number of units today than when the list was exported (highlighted). The price goes to what is in stock now.",
                        { n: moved },
                      )}
                    </div>
                  )}
                  {problems.length > 0 && (
                    <div>
                      {t(
                        "priceImport.problems",
                        "{{n}} rows changed nothing; their reason is beside them.",
                        { n: problems.length },
                      )}
                    </div>
                  )}
                </>
              }
            />
            <Flex gap={8} align="center">
              <Switch
                size="small"
                checked={problemsOnly}
                onChange={setProblemsOnly}
                aria-label={t(
                  "priceImport.problemsOnly",
                  "Only rows that changed nothing",
                )}
              />
              <Typography.Text>
                {t(
                  "priceImport.problemsOnly",
                  "Only rows that changed nothing",
                )}
              </Typography.Text>
            </Flex>
            <Table<PlannedRow>
              size="small"
              rowKey="rowNo"
              dataSource={shown}
              pagination={false}
              scroll={{ y: 420 }}
              columns={[
                {
                  title: t("priceImport.unit", "Unit"),
                  dataIndex: "unit",
                },
                {
                  title: t("priceImport.warehouse", "Warehouse"),
                  dataIndex: "warehouse",
                  width: COLUMN.choice,
                },
                {
                  title: t("priceImport.now", "Now"),
                  key: "before",
                  width: COLUMN.money,
                  align: "right",
                  render: (_, r) =>
                    r.before === null
                      ? fmtNone()
                      : r.before[0] === r.before[1]
                        ? fmtRp(r.before[0])
                        : `${fmtRp(r.before[0])} – ${fmtRp(r.before[1])}`,
                },
                {
                  title: t("priceImport.newPrice", "New price"),
                  dataIndex: "price",
                  width: COLUMN.money,
                  align: "right",
                  render: (v: number) => fmtRp(v),
                },
                {
                  title: t("priceImport.onList", "On list"),
                  key: "qty",
                  width: COLUMN.qty,
                  align: "right",
                  render: (_, r) => r.qty ?? fmtNone(),
                },
                {
                  title: t("priceImport.heldNow", "In stock now"),
                  key: "heldNow",
                  width: COLUMN.qty + 24,
                  align: "right",
                  render: (_, r) =>
                    r.qty !== undefined && r.qty !== r.heldNow ? (
                      <Typography.Text type="warning" strong>
                        {r.heldNow}
                      </Typography.Text>
                    ) : (
                      r.heldNow
                    ),
                },
                {
                  title: t("priceImport.units", "Repriced"),
                  key: "units",
                  width: COLUMN.qty,
                  align: "right",
                  render: (_, r) => r.serials.length,
                },
                {
                  title: t("priceImport.result", "Result"),
                  key: "status",
                  width: COLUMN.status + 40,
                  render: (_, r) => statusTag(r.status),
                },
              ]}
            />
          </>
        )}
      </Flex>
    </Modal>
  );
}
