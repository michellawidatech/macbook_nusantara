/**
 * Export stock — the dialog in front of `lib/stockExport.ts` (owner ask
 * 2026-09-19).
 *
 * > *"Option to include unit price and sell price, columns printed can be
 * > adjustable but by default is unit, qty, warehouse."*
 *
 * Three filters and a set of columns, and nothing else. Each filter is a
 * multi-select where EMPTY MEANS ALL — the grammar a stock take's scope
 * already taught staff — so the dialog opens ready to export the whole shop
 * and every choice narrows it. A running count under the choices says what
 * the file will hold before anybody downloads a sheet of nothing.
 *
 * The file is written in the browser (`lib/xlsxWrite.ts`) and handed over the
 * way Transaction History hands over its CSV: a Blob and a temporary
 * `<a download>`. Nothing is sent anywhere.
 *
 * The choices outlive the dialog for as long as the page is open — the tab
 * keeps the page mounted — so the second export of the day starts from the
 * first one's columns.
 */
import { useMemo, useState } from "react";
import { App, Checkbox, Flex, Form, Modal, Select, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useDb } from "../../mock/store.js";
import { useLayoutMode } from "../../layouts/useLayoutMode";
import {
  DEFAULT_STOCK_EXPORT_COLUMNS,
  REQUIRED_STOCK_EXPORT_COLUMN,
  stockExportFileName,
  stockReportFor,
  stockReportPdf,
  stockReportSheet,
  type StockExportColumn,
  type StockExportFilter,
  type StockExportFormat,
} from "../../lib/stockExport.js";
import { XLSX_MIME, xlsxFile } from "../../lib/xlsxWrite.js";
import { PDF_MIME } from "../../lib/pdfWrite.js";
import { SPACE, TYPE } from "../../theme/tokens";

export function StockExportModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const db = useDb();
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { compact } = useLayoutMode();
  const [warehouseIds, setWarehouseIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [columns, setColumns] = useState<StockExportColumn[]>([
    ...DEFAULT_STOCK_EXPORT_COLUMNS,
  ]);
  /*
   * Which files to hand over (owner ask 2026-09-21: *"PDF or excel file or
   * both (the user can choose)"*). A set rather than a radio, because "both"
   * is one of the three answers and a radio cannot say it. The spreadsheet is
   * ticked to start with: it is what the export was until today, and what a
   * bookkeeper asks for.
   */
  const [formats, setFormats] = useState<StockExportFormat[]>(["xlsx"]);

  const filter: StockExportFilter = { warehouseIds, categories, modelIds };
  const report = useMemo(
    () => stockReportFor(db, filter, columns),
    // `filter` is rebuilt every render from the three lists below.
    [
      db.units,
      db.skus,
      db.models,
      db.warehouses,
      warehouseIds,
      categories,
      modelIds,
      columns,
    ],
  );

  const categoryNames = [
    ...new Set([
      ...db.categories.map((c) => c.name),
      ...db.models.map((m) => m.category),
    ]),
  ].sort((a, b) => a.localeCompare(b));
  // The products on offer follow the categories chosen, so the list is never
  // longer than the question.
  const models = db.models
    .filter((m) => categories.length === 0 || categories.includes(m.category))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  /**
   * The checkboxes, in the order people think of them — the owner's three
   * defaults first — which is not the order the sheet prints them in
   * (`STOCK_EXPORT_COLUMNS`).
   */
  const choices: { value: StockExportColumn; label: string }[] = [
    {
      value: "unit",
      label: t("stockExport.colUnit", "Unit (product & variant)"),
    },
    { value: "qty", label: t("stockExport.colQty", "Qty") },
    { value: "warehouse", label: t("stockExport.colWarehouse", "Warehouse") },
    { value: "unitPrice", label: t("stockExport.colUnitPrice", "Unit price") },
    { value: "sellPrice", label: t("stockExport.colSellPrice", "Sell price") },
    { value: "sku", label: t("stockExport.colSku", "SKU code") },
    { value: "grade", label: t("stockExport.colGrade", "Grade") },
  ];

  /** Hand one file to the browser, the way Transaction History hands over a CSV. */
  const handOver = (bytes: Uint8Array, mime: string, name: string) => {
    const blob = new Blob([bytes as BlobPart], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    // Revoked at once: the click has already handed the blob to the browser's
    // download, and an unrevoked URL keeps the file alive in memory for the
    // life of the tab.
    URL.revokeObjectURL(url);
  };

  const download = () => {
    const now = new Date();
    const options = {
      columns,
      shopName: db.settings.shopName,
      warehouseNames: warehouseIds.map(
        (id) => db.warehouses.find((w) => w.id === id)?.name ?? id,
      ),
      categoryNames: categories,
      productNames: modelIds.map(
        (id) => db.models.find((m) => m.id === id)?.name ?? id,
      ),
      now,
    };
    // In the order they are offered, so "both" always produces the same pair
    // of downloads whichever box was ticked first.
    if (formats.includes("xlsx")) {
      handOver(
        xlsxFile(stockReportSheet(report, options), now),
        XLSX_MIME,
        stockExportFileName(now, "xlsx"),
      );
    }
    if (formats.includes("pdf")) {
      handOver(
        stockReportPdf(report, options),
        PDF_MIME,
        stockExportFileName(now, "pdf"),
      );
    }
    message.success(
      t(
        "stockExport.done",
        "Stock exported: {{units}} units on {{rows}} rows.",
        {
          units: report.qty,
          rows: report.lineCount,
        },
      ),
    );
    onClose();
  };

  return (
    <Modal
      open={open}
      title={t("stockExport.title", "Export stock")}
      onCancel={onClose}
      onOk={download}
      okText={
        formats.length === 2
          ? t("stockExport.downloadBoth", "Download both")
          : formats[0] === "pdf"
            ? t("stockExport.downloadPdf", "Download .pdf")
            : t("stockExport.download", "Download .xlsx")
      }
      okButtonProps={{
        icon: <DownloadOutlined />,
        disabled: report.lineCount === 0 || formats.length === 0,
      }}
      width={compact ? "100%" : 560}
    >
      <Form layout="vertical">
        <Form.Item label={t("stockExport.warehouses", "Warehouses")}>
          <Select
            mode="multiple"
            allowClear
            value={warehouseIds}
            onChange={setWarehouseIds}
            placeholder={t("inventory.anyWarehouse", "Any warehouse")}
            options={db.warehouses.map((w) => ({ value: w.id, label: w.name }))}
            optionFilterProp="label"
          />
        </Form.Item>
        <Form.Item label={t("stockExport.categories", "Categories")}>
          <Select
            mode="multiple"
            allowClear
            value={categories}
            onChange={(v: string[]) => {
              setCategories(v);
              // A product outside the categories now chosen would be a filter
              // nobody can see, silently emptying the sheet.
              setModelIds((ids) =>
                ids.filter((id) => {
                  const m = db.models.find((x) => x.id === id);
                  return v.length === 0 || (m && v.includes(m.category));
                }),
              );
            }}
            placeholder={t("inventory.anyCategory", "Any category")}
            options={categoryNames.map((c) => ({ value: c, label: c }))}
          />
        </Form.Item>
        <Form.Item label={t("stockExport.products", "Products")}>
          <Select
            mode="multiple"
            allowClear
            showSearch
            optionFilterProp="label"
            value={modelIds}
            onChange={setModelIds}
            placeholder={t("inventory.anyProduct", "Any product")}
            options={models.map((m) => ({ value: m.id, label: m.name }))}
          />
        </Form.Item>
        <Form.Item
          label={t("stockExport.format", "File")}
          extra={t(
            "stockExport.formatHint",
            "The spreadsheet has real numbers to sort and sum; the PDF looks the same on every screen and cannot be edited. Tick both for one of each.",
          )}
        >
          <Checkbox.Group
            value={formats}
            onChange={(v) => setFormats(v as StockExportFormat[])}
          >
            <Flex gap={SPACE.md}>
              <Checkbox value="xlsx">
                {t("stockExport.formatXlsx", "Excel (.xlsx)")}
              </Checkbox>
              <Checkbox value="pdf">
                {t("stockExport.formatPdf", "PDF")}
              </Checkbox>
            </Flex>
          </Checkbox.Group>
        </Form.Item>
        <Form.Item
          label={t("stockExport.columns", "Columns")}
          extra={t(
            "stockExport.columnsHint",
            "With Warehouse, the sheet is grouped by warehouse with a total for each; without it, each product is one row across every warehouse. Grade gives each grade its own row.",
          )}
        >
          <Checkbox.Group
            value={[...new Set([REQUIRED_STOCK_EXPORT_COLUMN, ...columns])]}
            onChange={(v) => setColumns(v as StockExportColumn[])}
          >
            <Flex vertical gap={SPACE.xs}>
              {choices.map((c) => (
                <Checkbox
                  key={c.value}
                  value={c.value}
                  // A row is a product: the name cannot be left off.
                  disabled={c.value === REQUIRED_STOCK_EXPORT_COLUMN}
                >
                  {c.label}
                </Checkbox>
              ))}
            </Flex>
          </Checkbox.Group>
        </Form.Item>
      </Form>
      <Typography.Text
        type={
          report.lineCount === 0 || formats.length === 0
            ? "warning"
            : "secondary"
        }
        style={{ fontSize: TYPE.sm }}
        role="status"
      >
        {formats.length === 0
          ? t("stockExport.noFormat", "Pick at least one file to download.")
          : report.lineCount === 0
            ? t(
                "stockExport.nothing",
                "Nothing in stock matches these filters.",
              )
            : t(
                "stockExport.preview",
                "{{units}} units on {{rows}} rows will be exported.",
                { units: report.qty, rows: report.lineCount },
              )}
      </Typography.Text>
    </Modal>
  );
}
