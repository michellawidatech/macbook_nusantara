/**
 * Check a Shopee file for refunds, and turn each one into a return.
 *
 * > *"Also make it able to detect excel file (see the excel file I provided)
 * > to see refunds."* — owner, 2026-09-21
 *
 * The file the owner pointed at is the seller balance report (Saldo Penjual →
 * Export); the order export works too. `lib/shopeeRefunds.ts` does the
 * reading and the matching — see it for why a refund is judged by the order's
 * OWN payout row and never by what the order netted.
 *
 * Each refunded order is shown against the sale it was, with what the file
 * says about it. A sale whose units are all back already — or whose return
 * named the order number when it was recorded — reads "Return recorded";
 * anything else offers *Record return*, which opens the ordinary Add-return
 * form on that sale with its units still out ticked. Nothing in this dialog
 * writes anything by itself: the form is where a return is recorded, with a
 * reason, a date and a person looking at it.
 *
 * The file stays loaded while the form is open, so the next refund in it is
 * one click away when the dialog is opened again. Closing it forgets the file.
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Flex, Modal, Tag, Typography, Upload } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { DataTable } from "../../components/DataTable";
import { fmtRp, fmtNone } from "../../lib/format.js";
import { readXlsx, XlsxError, type XlsxSheet } from "../../lib/xlsxRead.js";
import {
  returnNamesOrder,
  saleOfRefund,
  scanShopeeRefunds,
  type ShopeeRefund,
} from "../../lib/shopeeRefunds.js";
import { returnableSerials } from "../../lib/returns.js";
import { useDb } from "../../mock/store.js";
import type { Order } from "../../mock/seed.js";
import { SPACE, TYPE } from "../../theme/tokens";

/** One refunded order, and the sale it was. */
interface RefundRow {
  readonly key: string;
  readonly refund: ShopeeRefund;
  readonly sale?: Order;
  /** The return is on the books: every unit is back, or a return named it. */
  readonly recorded: boolean;
}

/** A signed amount the way a statement writes one: "+Rp 10.000.000". */
const signed = (n: number) => `${n < 0 ? "−" : "+"}${fmtRp(Math.abs(n))}`;

export function ShopeeRefundCheck({
  open,
  onClose,
  onRecordReturn,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Open the Add-return form on this sale, its units still out ticked. */
  readonly onRecordReturn: (saleId: string) => void;
}) {
  const { t } = useTranslation();
  const db = useDb();
  const [sheets, setSheets] = useState<XlsxSheet[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Guards a second upload landing while the first is still being read. */
  const reading = useRef(false);

  const scan = useMemo(
    () => (sheets === null ? undefined : scanShopeeRefunds(sheets)),
    [sheets],
  );

  const unitBySerial = useMemo(
    () => new Map(db.units.map((u) => [u.serial, u])),
    [db.units],
  );
  const skuById = useMemo(
    () => new Map(db.skus.map((s) => [s.id, s])),
    [db.skus],
  );
  /** Serials already on a customer return that has not been received yet. */
  const pending = useMemo(
    () =>
      new Set(
        db.returns
          .filter((r) => r.kind === "CUSTOMER" && r.status === "PENDING")
          .map((r) => r.serial),
      ),
    [db.returns],
  );

  const rows = useMemo<RefundRow[]>(
    () =>
      (scan?.refunds ?? []).map((refund) => {
        const match = saleOfRefund(refund.orderNo, db.orders);
        const sale = match?.order;
        const out =
          sale === undefined
            ? []
            : returnableSerials(
                sale,
                db.orders,
                (s) => unitBySerial.get(s)?.status,
                pending,
              );
        const countedOut = (sale?.lines ?? []).filter(
          (l) => l.qty - (l.returnedQty ?? 0) > 0,
        );
        return {
          key: refund.orderNo,
          refund,
          ...(sale === undefined ? {} : { sale }),
          recorded:
            match !== undefined &&
            (match.via === "ADJUSTMENT" ||
              returnNamesOrder(match.order, refund.orderNo) ||
              (out.length === 0 && countedOut.length === 0)),
        };
      }),
    [scan, db.orders, unitBySerial, pending],
  );

  const reset = () => {
    setSheets(null);
    setFileName("");
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const take = async (file: File) => {
    if (reading.current) return;
    reading.current = true;
    try {
      setSheets(await readXlsx(await file.arrayBuffer()));
      setFileName(file.name);
      setError(null);
    } catch (e) {
      setSheets(null);
      setError(
        e instanceof XlsxError
          ? e.message
          : t(
              "shopeeImport.unreadable",
              "That file could not be read as a spreadsheet.",
            ),
      );
    } finally {
      reading.current = false;
    }
  };

  const customerName = (o: Order) =>
    db.customers.find((c) => c.id === o.customerId)?.name;

  /** What the sale was: its units and its counted lines, one per line. */
  const saleCell = (r: RefundRow): ReactNode => {
    const sale = r.sale;
    if (sale === undefined) {
      return (
        <Typography.Text type="secondary">
          {t("shopeeRefund.noSale", "No sale carries this order number")}
        </Typography.Text>
      );
    }
    const items = [
      ...sale.serials.map((serial) => {
        const sku = skuById.get(unitBySerial.get(serial)?.skuId ?? "");
        return sku ? `${sku.name} ${sku.variantLabel} · ${serial}` : serial;
      }),
      ...(sale.lines ?? []).map((l) => {
        const sku = skuById.get(l.skuId);
        return `${sku ? `${sku.name} ${sku.variantLabel}` : l.skuId} ×${l.qty}`;
      }),
    ];
    return (
      <Flex vertical gap={0}>
        <Typography.Text strong>
          {[sale.code, customerName(sale)].filter(Boolean).join(" · ")}
        </Typography.Text>
        {items.map((item, i) => (
          <Typography.Text
            key={`${i}-${item}`}
            type="secondary"
            style={{ fontSize: TYPE.sm }}
          >
            {item}
          </Typography.Text>
        ))}
      </Flex>
    );
  };

  /** What the file says: the order's balance rows, or its return status. */
  const fileCell = (r: RefundRow): ReactNode => (
    <Flex vertical gap={0}>
      {r.refund.parts.map((p, i) => (
        <Typography.Text
          key={`${i}-${p.label}`}
          type={p.payout ? "danger" : undefined}
        >
          {/* The label may wrap; the amount stays in one piece. */}
          {p.label}{" "}
          <span style={{ whiteSpace: "nowrap" }}>{signed(p.amount)}</span>
        </Typography.Text>
      ))}
      {r.refund.status !== undefined && (
        <Typography.Text type="danger">{r.refund.status}</Typography.Text>
      )}
      {r.refund.returnedQty !== undefined && (
        <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
          {t("shopeeRefund.returnedQty", "Returned quantity: {{count}}", {
            count: r.refund.returnedQty,
          })}
        </Typography.Text>
      )}
    </Flex>
  );

  const actionCell = (r: RefundRow): ReactNode => {
    if (r.sale === undefined) {
      return <Typography.Text type="secondary">{fmtNone()}</Typography.Text>;
    }
    if (r.recorded) {
      return (
        <Tag color="green" style={{ marginInlineEnd: 0 }}>
          {t("shopeeRefund.recorded", "Return recorded")}
        </Tag>
      );
    }
    const saleId = r.sale.id;
    return (
      <Button
        size="small"
        type="primary"
        aria-label={t(
          "shopeeRefund.recordFor",
          "Record the return of {{code}}",
          { code: r.sale.code },
        )}
        onClick={() => onRecordReturn(saleId)}
      >
        {t("returnCustomer.recordReturn", "Record return")}
      </Button>
    );
  };

  return (
    <Modal
      open={open}
      // As wide as the four columns need, and never wider than the screen.
      width="min(980px, calc(100vw - 32px))"
      title={t("shopeeRefund.title", "Refunds in a Shopee file")}
      onCancel={close}
      footer={<Button onClick={close}>{t("common.close", "Close")}</Button>}
    >
      <Flex vertical gap={SPACE.md}>
        <Upload.Dragger
          accept=".xlsx"
          maxCount={1}
          showUploadList={false}
          beforeUpload={(file) => {
            void take(file as unknown as File);
            // Nothing is uploaded anywhere: the workbook is read in the
            // browser, as the Receivables import reads it.
            return false;
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">
            {fileName === ""
              ? t("shopeeImport.drop", "Drop the Shopee .xlsx here")
              : fileName}
          </p>
          <p className="ant-upload-hint">
            {t(
              "shopeeRefund.which",
              "The seller balance report (Saldo Penjual → Export) shows every order Shopee refunded. The order export works too.",
            )}
          </p>
        </Upload.Dragger>

        {error !== null && <Alert type="error" showIcon title={error} />}

        {scan?.kind === "OTHER" && (
          <Alert
            type="warning"
            showIcon
            title={t(
              "shopeeRefund.notShopee",
              "This does not look like Shopee's seller balance report or order export.",
            )}
          />
        )}

        {scan !== undefined &&
          scan.kind !== "OTHER" &&
          scan.refunds.length === 0 && (
            <Alert
              type="success"
              showIcon
              title={t(
                "shopeeRefund.none",
                "No refunds in this file — {{count}} order(s) checked.",
                { count: scan.orders },
              )}
            />
          )}

        {rows.length > 0 && (
          <>
            <Typography.Text type="secondary" style={{ fontSize: TYPE.sm }}>
              {t(
                "shopeeRefund.summary",
                "{{count}} refunded order(s) in this file. Nothing is recorded until you record the return.",
                { count: rows.length },
              )}
            </Typography.Text>
            <DataTable<RefundRow>
              rowKey="key"
              size="small"
              paginated={false}
              dataSource={rows}
              columns={[
                {
                  title: t("shopeeRefund.orderCol", "Shopee order number"),
                  key: "order",
                  render: (_: unknown, r: RefundRow) => (
                    <Typography.Text strong style={{ fontFamily: "monospace" }}>
                      {r.refund.orderNo}
                    </Typography.Text>
                  ),
                },
                {
                  title: t("shopeeRefund.saleCol", "Sale"),
                  key: "sale",
                  render: (_: unknown, r: RefundRow) => saleCell(r),
                },
                {
                  title: t("shopeeRefund.fileCol", "In the file"),
                  key: "file",
                  render: (_: unknown, r: RefundRow) => fileCell(r),
                },
                {
                  title: t("shopeeRefund.returnCol", "Return"),
                  key: "action",
                  align: "right" as const,
                  render: (_: unknown, r: RefundRow) => actionCell(r),
                },
              ]}
            />
          </>
        )}
      </Flex>
    </Modal>
  );
}
